import https from 'node:https'
import { getDatabase } from '../config/database.js'
import { getSavedDownloadPath } from './downloadSettingsService.js'
import { getDefaultDownloadPath } from './downloadPathService.js'
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
          timeout: timeoutMs,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MultiMediaDownloader/1.0'
          }
        },
        (res) => {
          // Drain response to ensure socket is returned/freed
          res.resume()
          if (!settled) {
            settled = true
            cleanup()
            const isSuccess = Boolean(res.statusCode >= 200 && res.statusCode < 400)
            resolve(isSuccess)
          }
        }
      )

      req.on('timeout', () => {
        if (!settled) {
          settled = true
          cleanup()
          req.destroy()
          resolve(false)
        }
      })

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
 * Step 09 Section B - Bounded network connectivity checker.
 * Uses Node.js built-in HTTPS to test genuine external connectivity against
 * fixed, trusted endpoints with a fallback, reasonable timeout, and complete socket cleanup.
 *
 * @param {object} [options={}]
 * @param {number} [options.timeoutMs=3000]
 * @returns {Promise<boolean>}
 */
export async function checkNetworkConnectivity({ timeoutMs = 3000 } = {}) {
  if (typeof customConnectivityChecker === 'function') {
    return await customConnectivityChecker()
  }

  // 1. Primary endpoint check (Google generate_204)
  const primaryOk = await probeHttpsEndpoint(PRIMARY_CONNECTIVITY_ENDPOINT, timeoutMs)
  if (primaryOk) {
    return true
  }

  // 2. Fallback endpoint check (Cloudflare trace)
  const fallbackOk = await probeHttpsEndpoint(FALLBACK_CONNECTIVITY_ENDPOINT, timeoutMs)
  return fallbackOk
}

/**
 * Allows automated tests to simulate network disconnection and reconnection deterministically.
 * Pass null to restore real network checks.
 *
 * @param {Function|null} checkerFn
 */
export function setConnectivityCheckerForTesting(checkerFn) {
  customConnectivityChecker = checkerFn
}

/**
 * Step 09 Section B - Finds all 'interrupted' jobs in SQLite, verifies their
 * physical partial files on disk, preserves progress and downloaded bytes,
 * restores them to 'queued' status, and enqueues them in FIFO order using the SAME Job ID.
 *
 * Guaranteed non-overlapping execution via an internal isRecovering lock.
 *
 * @param {object} [options={}]
 * @param {Function} [options.enqueue] - Custom enqueue callback for testing/dependency injection
 * @returns {Promise<{ resumedCount: number, resumedJobIds: Array<number>, jobIds: Array<number> }>}
 */
export async function resumeInterruptedNetworkJobs(options = {}) {
  if (isRecovering) {
    return { resumedCount: 0, resumedJobIds: [], jobIds: [] }
  }
  isRecovering = true

  try {
    const isOnline = await checkNetworkConnectivity()
    if (!isOnline) {
      console.log(
        '[network-recovery] Internet connection still unavailable. Interrupted jobs remain safe.'
      )
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
      const savedPath = await getSavedDownloadPath(AppSetting)
      downloadPath = savedPath || (await getDefaultDownloadPath())
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
export function isNetworkOnline() {
  return lastKnownOnline === true
}
