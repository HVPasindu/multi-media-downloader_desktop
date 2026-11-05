import https from 'node:https'
import { getDatabase } from '../config/database.js'
import { resolveValidatedDownloadPath } from './downloadPathService.js'
import {
  verifyJobPartialDownload,
  cleanupJobTemporaryFiles,
  isPartialDownloadResumable
} from './downloadCleanupService.js'
import { enqueueDownloadJob, getQueueStatus } from './downloadQueueService.js'

let monitoringTimer = null
let isMonitoring = false
let currentBackoffMs = 5000
let lastKnownOnline = null
let isRecovering = false
let customConnectivityChecker = null

// Trusted, fixed HTTPS endpoints for external connectivity verification
const PRIMARY_CONNECTIVITY_ENDPOINT = 'https://www.google.com/generate_204'
const FALLBACK_CONNECTIVITY_ENDPOINT = 'https://cloudflare.com/cdn-cgi/trace'

/**
 * Probes a specific HTTPS endpoint with a strict timeout, proper socket teardown,
 * and timer cleanup. Accepts standard HTTP success/redirect status codes (200..399).
 *
 * @param {string} endpointUrl
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function probeHttpsEndpoint(endpointUrl, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    let req = null

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    timer = setTimeout(() => {
      if (!settled) {
        settled = true
        cleanup()
        if (req) {
          req.destroy(new Error('Connection timed out'))
        }
        resolve(false)
      }
    }, timeoutMs)

    try {
      req = https.get(
        endpointUrl,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        },
        (res) => {
          if (!settled) {
            settled = true
            cleanup()
            // Drain data to free socket resources cleanly
            res.resume()
            const isSuccess =
              typeof res.statusCode === 'number' && res.statusCode >= 200 && res.statusCode < 400
            resolve(isSuccess)
          }
        }
      )

      req.on('error', () => {
        if (!settled) {
          settled = true
          cleanup()
          resolve(false)
        }
      })
    } catch {
      if (!settled) {
        settled = true
        cleanup()
        resolve(false)
      }
    }
  })
}

/**
 * Checks live internet connectivity using genuine HTTPS requests.
 * Uses primary Google generate_204 endpoint and falls back to Cloudflare trace endpoint.
 *
 * @param {object} [options={}]
 * @param {number} [options.timeoutMs=3000]
 * @returns {Promise<boolean>}
 */
export async function checkNetworkConnectivity(options = {}) {
  if (typeof customConnectivityChecker === 'function') {
    return await customConnectivityChecker()
  }

  const timeoutMs = options.timeoutMs || 3000

  // 1. Check primary endpoint
  const primaryOnline = await probeHttpsEndpoint(PRIMARY_CONNECTIVITY_ENDPOINT, timeoutMs)
  if (primaryOnline) {
    return true
  }

  // 2. Check fallback endpoint
  const fallbackOnline = await probeHttpsEndpoint(FALLBACK_CONNECTIVITY_ENDPOINT, timeoutMs)
  return fallbackOnline
}

/**
 * Test hook to inject simulated connectivity state.
 *
 * @param {Function|null} checker - Async function returning boolean, or null to reset
 */
export function setConnectivityCheckerForTesting(checker) {
  customConnectivityChecker = checker
}

/**
 * Step 09.B (Phase 04) — Resume Interrupted Network Jobs.
 *
 * Scans SQLite for jobs stuck in 'interrupted' status and transitions them back to 'queued'
 * for execution by the FIFO download queue once internet connectivity is confirmed.
 *
 * Enforces Global FIFO ordering (createdAt ASC, id ASC).
 * Adheres strictly to Option A: Resume Existing Job (preserves original Job ID,
 * does not create duplicates, preserves valid partial progress).
 *
 * @param {object} [options={}]
 * @param {Function} [options.enqueue] - Custom queue enqueue function for testing
 * @param {boolean} [options.autoEnqueue=true]
 * @returns {Promise<{ resumedCount: number, resumedJobIds: number[], jobIds: number[] }>}
 */
export async function resumeInterruptedNetworkJobs(options = {}) {
  if (isRecovering) {
    console.log('[network-recovery] Recovery cycle already in progress, skipping duplicate pass')
    return { resumedCount: 0, resumedJobIds: [], jobIds: [] }
  }

  isRecovering = true

  try {
    const isOnline = await checkNetworkConnectivity()
    if (!isOnline) {
      console.log('[network-recovery] Internet is still offline. Cannot resume downloads.')
      return { resumedCount: 0, resumedJobIds: [], jobIds: [] }
    }

    const sequelize = getDatabase()
    if (!sequelize?.models?.DownloadJob) {
      return { resumedCount: 0, resumedJobIds: [], jobIds: [] }
    }

    const { DownloadJob, AppSetting } = sequelize.models
    const enqueue = typeof options.enqueue === 'function' ? options.enqueue : enqueueDownloadJob

    let downloadPath = null
    try {
      downloadPath = await resolveValidatedDownloadPath(AppSetting)
    } catch {
      downloadPath = null
    }

    // 1. Fetch all interrupted jobs ordered by createdAt ASC, id ASC (Global FIFO)
    const interruptedJobs = await DownloadJob.findAll({
      where: {
        status: 'interrupted'
      },
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC']
      ]
    })

    if (interruptedJobs.length === 0) {
      return { resumedCount: 0, resumedJobIds: [], jobIds: [] }
    }

    console.log(
      `[network-recovery] Network restored! Resuming ${interruptedJobs.length} interrupted download job(s)...`
    )

    const currentQueue = getQueueStatus()
    const alreadyScheduled = new Set(currentQueue?.scheduledJobIds || [])
    const resumedJobIds = []

    for (const job of interruptedJobs) {
      if (alreadyScheduled.has(job.id)) {
        continue
      }

      if (!downloadPath) {
        await job.update({
          status: 'failed',
          error_message: 'Network recovery failed: Unable to resolve valid download folder path'
        })
        console.warn(
          `[network-recovery] Job ${job.id} failed: Unable to resolve valid download folder path.`
        )
        continue
      }

      let hasValidPartial = false
      let reconciledBytes = 0

      if (downloadPath) {
        try {
          const partialResult = await verifyJobPartialDownload(job.id, downloadPath, {
            savedDownloadedBytes: job.downloaded_bytes,
            savedProgress: job.progress
          })
          hasValidPartial = isPartialDownloadResumable(partialResult)
          if (hasValidPartial) {
            reconciledBytes = partialResult.reconciledBytes
          }
        } catch {
          hasValidPartial = false
        }
      }

      if (hasValidPartial) {
        // Option A: Preserve valid partial data and original Job ID
        await job.update({
          status: 'queued',
          downloaded_bytes: reconciledBytes,
          error_message: null
        })
        console.log(
          `[network-recovery] Job ${job.id} restored to 'queued' (progress: ${job.progress}%, bytes: ${reconciledBytes})`
        )
      } else {
        // Unverified partial file: safely clean any corrupted artifacts and restart from 0 with SAME Job ID
        let cleanupFailed = false
        let cleanupErrorMsg = null
        if (downloadPath) {
          try {
            const cleanResult = await cleanupJobTemporaryFiles(job.id, downloadPath)
            if (cleanResult && cleanResult.success === false) {
              cleanupFailed = true
              cleanupErrorMsg = cleanResult.error || 'Failed to cleanup temporary files'
            }
          } catch (cleanErr) {
            cleanupFailed = true
            cleanupErrorMsg = cleanErr.message
          }
        }

        if (cleanupFailed) {
          await job.update({
            status: 'failed',
            error_message: `Network recovery cleanup failed: ${cleanupErrorMsg}`
          })
          console.warn(
            `[network-recovery] Job ${job.id} cleanup failed: ${cleanupErrorMsg}. Marked as failed.`
          )
          continue
        }

        await job.update({
          status: 'queued',
          progress: 0,
          downloaded_bytes: 0,
          error_message: null
        })
        console.log(`[network-recovery] Unverified job ${job.id} reset to zero for fresh restart`)
      }

      resumedJobIds.push(job.id)
    }

    // 2. Submit recovered jobs to queue in FIFO order
    for (const jobId of resumedJobIds) {
      try {
        enqueue(jobId)
      } catch (enqueueErr) {
        console.warn(
          `[network-recovery] Failed to enqueue resumed job ${jobId}:`,
          enqueueErr.message
        )
      }
    }

    return {
      resumedCount: resumedJobIds.length,
      resumedJobIds,
      jobIds: resumedJobIds
    }
  } finally {
    isRecovering = false
  }
}

/**
 * Starts background network connectivity monitoring with capped backoff.
 *
 * @param {object} [options={}]
 * @param {number} [options.baseIntervalMs=5000]
 * @param {number} [options.maxBackoffMs=30000]
 * @param {number} [options.initialDelayMs]
 * @param {Function} [options.enqueue]
 */
export function startNetworkMonitoring(options = {}) {
  if (isMonitoring) return
  isMonitoring = true

  const baseIntervalMs = options.baseIntervalMs || 5000
  const maxBackoffMs = options.maxBackoffMs || 30000
  const backoffStepMs = options.backoffStepMs || baseIntervalMs
  currentBackoffMs = baseIntervalMs

  // Establish initial online state using genuine connectivity check
  void checkNetworkConnectivity().then((initialOnline) => {
    if (!isMonitoring) return
    lastKnownOnline = initialOnline
    if (!initialOnline) {
      console.log(
        '[network-recovery] Application started in offline state. Network monitoring active.'
      )
    }
  })

  async function checkCycle() {
    if (!isMonitoring) return

    try {
      const isOnline = await checkNetworkConnectivity()

      if (isOnline) {
        if (lastKnownOnline === false) {
          console.log('[network-recovery] Internet connection re-established!')
          await resumeInterruptedNetworkJobs(options)
        }
        lastKnownOnline = true
        currentBackoffMs = baseIntervalMs
      } else {
        if (lastKnownOnline === true) {
          console.log('[network-recovery] Internet connection lost. Entering backoff monitoring...')
        }
        lastKnownOnline = false
        // Exponential-like backoff capped at maxBackoffMs
        currentBackoffMs = Math.min(currentBackoffMs + backoffStepMs, maxBackoffMs)
      }
    } catch (cycleErr) {
      console.warn('[network-recovery] Monitoring cycle error:', cycleErr)
    } finally {
      if (isMonitoring) {
        monitoringTimer = setTimeout(checkCycle, currentBackoffMs)
      }
    }
  }

  const initialDelayMs = options.initialDelayMs ?? baseIntervalMs
  monitoringTimer = setTimeout(checkCycle, initialDelayMs)
}

/**
 * Stops network monitoring cleanly on application shutdown.
 */
export function stopNetworkMonitoring() {
  isMonitoring = false
  if (monitoringTimer) {
    clearTimeout(monitoringTimer)
    monitoringTimer = null
  }
}

/**
 * Resets network monitoring internal state for testing.
 */
export function resetNetworkMonitoringForTesting() {
  stopNetworkMonitoring()
  resetJobRetryStateForTesting()
  lastKnownOnline = null
  currentBackoffMs = 5000
  isRecovering = false
  customConnectivityChecker = null
}

/**
 * Returns whether network was online on last check.
 *
 * @returns {boolean}
 */
const jobRetryState = new Map()

/**
 * Resumes a single interrupted job by ID, validating partial files and re-enqueueing.
 *
 * @param {number} jobId
 * @returns {Promise<boolean>} True if resumed, false otherwise
 */
export async function resumeSingleInterruptedJob(jobId) {
  const sequelize = getDatabase()
  if (!sequelize?.models?.DownloadJob) return false
  const { DownloadJob, AppSetting } = sequelize.models
  const job = await DownloadJob.findByPk(jobId)
  if (!job || job.status !== 'interrupted') return false

  let downloadPath = null
  try {
    downloadPath = await resolveValidatedDownloadPath(AppSetting)
  } catch {
    downloadPath = null
  }

  if (!downloadPath) {
    await job.update({
      status: 'failed',
      error_message: 'Network recovery failed: Unable to resolve valid download folder path'
    })
    return false
  }

  let hasValidPartial = false
  let reconciledBytes = 0
  try {
    const partialResult = await verifyJobPartialDownload(job.id, downloadPath, {
      savedDownloadedBytes: job.downloaded_bytes,
      savedProgress: job.progress
    })
    hasValidPartial = isPartialDownloadResumable(partialResult)
    if (hasValidPartial) {
      reconciledBytes = partialResult.reconciledBytes
    }
  } catch {
    hasValidPartial = false
  }

  if (hasValidPartial) {
    await job.update({
      status: 'queued',
      downloaded_bytes: reconciledBytes,
      error_message: null
    })
  } else {
    await job.update({
      status: 'queued',
      progress: 0,
      downloaded_bytes: 0,
      error_message: null
    })
  }

  enqueueDownloadJob(job.id)
  return true
}

/**
 * Schedules an exponential backoff retry for an interrupted job.
 * Avoids continuous retry loops by capping retries at 5.
 *
 * @param {number} jobId
 * @param {number|null} [customDelayMs=null]
 */
export function scheduleJobRetry(jobId, customDelayMs = null) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) return

  const existing = jobRetryState.get(jobId) || { retryCount: 0, timer: null }
  if (existing.timer) {
    clearTimeout(existing.timer)
    existing.timer = null
  }

  const MAX_RETRIES = 5
  if (existing.retryCount >= MAX_RETRIES) {
    console.warn(
      `[network-recovery] Job ${jobId} exceeded max DNS/network preparation retries (${MAX_RETRIES}).`
    )
    try {
      const DownloadJob = getDatabase()?.models?.DownloadJob
      if (DownloadJob) {
        void DownloadJob.findByPk(jobId).then((j) => {
          if (j && j.status === 'interrupted') {
            void j.update({
              status: 'failed',
              error_message:
                'Download preparation failed after multiple retries: DNS or network unreachable'
            })
          }
        })
      }
    } catch {
      // ignore
    }
    jobRetryState.delete(jobId)
    return
  }

  existing.retryCount += 1
  const delayMs = customDelayMs ?? Math.min(2000 * Math.pow(2, existing.retryCount - 1), 30000)
  console.log(
    `[network-recovery] Scheduling retry for job ${jobId} in ${delayMs}ms (attempt ${existing.retryCount}/${MAX_RETRIES})`
  )

  existing.timer = setTimeout(async () => {
    existing.timer = null
    try {
      await resumeSingleInterruptedJob(jobId)
    } catch (err) {
      console.warn(`[network-recovery] Auto-retry failed for job ${jobId}: ${err.message}`)
    }
  }, delayMs)

  jobRetryState.set(jobId, existing)
}

/**
 * Clears retry tracking state for a specific job.
 *
 * @param {number} jobId
 */
export function clearJobRetryState(jobId) {
  const existing = jobRetryState.get(jobId)
  if (existing?.timer) {
    clearTimeout(existing.timer)
  }
  jobRetryState.delete(jobId)
}

/**
 * Resets all retry tracking state for testing.
 */
export function resetJobRetryStateForTesting() {
  for (const [, state] of jobRetryState) {
    if (state.timer) clearTimeout(state.timer)
  }
  jobRetryState.clear()
}

export function isNetworkOnline() {
  return lastKnownOnline === true
}
