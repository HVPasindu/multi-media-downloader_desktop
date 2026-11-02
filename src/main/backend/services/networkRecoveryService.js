import dns from 'node:dns/promises'
import { getDatabase } from '../config/database.js'
import { getSavedDownloadPath } from './downloadSettingsService.js'
import { getDefaultDownloadPath } from './downloadPathService.js'
import { verifyJobPartialDownload, cleanupJobTemporaryFiles } from './downloadCleanupService.js'
import { enqueueDownloadJob, getQueueStatus } from './downloadQueueService.js'

let monitoringTimer = null
let isMonitoring = false
let currentBackoffMs = 5000
let lastKnownOnline = true
let customConnectivityChecker = null

/**
 * Step 09 Section B - Bounded network connectivity checker.
 * Uses built-in Node.js DNS resolution with a strict timeout to verify
 * real external internet reachability without third-party dependencies.
 *
 * @param {object} [options={}]
 * @param {number} [options.timeoutMs=3000]
 * @returns {Promise<boolean>}
 */
export async function checkNetworkConnectivity({ timeoutMs = 3000 } = {}) {
  if (typeof customConnectivityChecker === 'function') {
    return await customConnectivityChecker()
  }

  try {
    const dnsPromise = dns.lookup('1.1.1.1')
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Network lookup timed out')), timeoutMs)
    )
    await Promise.race([dnsPromise, timeoutPromise])
    return true
  } catch {
    // Secondary fallback check against standard domain
    try {
      const resolvePromise = dns.resolve('google.com')
      const timeoutPromise2 = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Network resolve timed out')), timeoutMs)
      )
      await Promise.race([resolvePromise, timeoutPromise2])
      return true
    } catch {
      return false
    }
  }
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
 * @param {object} [options={}]
 * @param {Function} [options.enqueue] - Custom enqueue callback for testing/dependency injection
 * @returns {Promise<{ resumedCount: number, resumedJobIds: Array<number> }>}
 */
export async function resumeInterruptedNetworkJobs(options = {}) {
  const isOnline = await checkNetworkConnectivity()
  if (!isOnline) {
    console.log(
      '[network-recovery] Internet connection still unavailable. Interrupted jobs remain safe.'
    )
    return { resumedCount: 0, resumedJobIds: [] }
  }

  const sequelize = getDatabase()
  if (!sequelize?.models?.DownloadJob) {
    return { resumedCount: 0, resumedJobIds: [] }
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
    let reconciledBytes = job.downloaded_bytes || 0

    if (downloadPath) {
      try {
        const partialResult = await verifyJobPartialDownload(job.id, downloadPath, {
          savedDownloadedBytes: job.downloaded_bytes,
          savedProgress: job.progress
        })
        hasValidPartial = Boolean(partialResult.isValid && !partialResult.isUnsafe)
        if (hasValidPartial && partialResult.reconciledBytes > 0) {
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
      if (downloadPath) {
        try {
          await cleanupJobTemporaryFiles(job.id, downloadPath)
        } catch {
          // Ignore fallback cleanup errors
        }
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
      console.warn(`[network-recovery] Failed to enqueue resumed job ${jobId}:`, enqueueErr.message)
    }
  }

  return {
    resumedCount: resumedJobIds.length,
    resumedJobIds,
    jobIds: resumedJobIds
  }
}

/**
 * Starts background network connectivity monitoring with capped backoff.
 *
 * @param {object} [options={}]
 * @param {number} [options.baseIntervalMs=5000]
 * @param {number} [options.maxBackoffMs=30000]
 */
export function startNetworkMonitoring(options = {}) {
  if (isMonitoring) return
  isMonitoring = true

  const baseIntervalMs = options.baseIntervalMs || 5000
  const maxBackoffMs = options.maxBackoffMs || 30000
  currentBackoffMs = baseIntervalMs

  async function checkCycle() {
    if (!isMonitoring) return

    try {
      const isOnline = await checkNetworkConnectivity()

      if (isOnline) {
        if (!lastKnownOnline) {
          console.log('[network-recovery] Internet connection re-established!')
          await resumeInterruptedNetworkJobs()
        }
        lastKnownOnline = true
        currentBackoffMs = baseIntervalMs
      } else {
        if (lastKnownOnline) {
          console.log('[network-recovery] Internet connection lost. Entering backoff monitoring...')
        }
        lastKnownOnline = false
        // Exponential-like backoff capped at maxBackoffMs
        currentBackoffMs = Math.min(currentBackoffMs + 5000, maxBackoffMs)
      }
    } catch (cycleErr) {
      console.warn('[network-recovery] Monitoring cycle error:', cycleErr)
    } finally {
      if (isMonitoring) {
        monitoringTimer = setTimeout(checkCycle, currentBackoffMs)
      }
    }
  }

  monitoringTimer = setTimeout(checkCycle, baseIntervalMs)
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
 * Returns whether network was online on last check.
 *
 * @returns {boolean}
 */
export function isNetworkOnline() {
  return lastKnownOnline
}
