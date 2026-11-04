import { Op } from 'sequelize'
import { getDatabase } from '../config/database.js'
import { getSavedDownloadPath } from './downloadSettingsService.js'
import { getDefaultDownloadPath } from './downloadPathService.js'
import {
  cleanupJobTemporaryFiles,
  verifyJobPartialDownload,
  isPartialDownloadResumable
} from './downloadCleanupService.js'
import { enqueueDownloadJob, getQueueStatus } from './downloadQueueService.js'
import { checkNetworkConnectivity } from './networkRecoveryService.js'

// In-memory set to guarantee strict idempotency within the session
const sessionRecoveredJobIds = new Set()

export function resetRecoveryTrackingForTesting() {
  sessionRecoveredJobIds.clear()
}

/**
 * Step 09 (Phase 04) — Automatic Download Recovery (Option A: Resume Existing Job).
 *
 * Scans SQLite for incomplete downloads from previous application sessions.
 * Enforces Global FIFO recovery order (createdAt ASC, id ASC).
 *
 * Handles both online startup and offline startup:
 * 1. Online:
 *    - Verifies disk partial files for interrupted downloading/interrupted jobs.
 *    - If valid: preserves original Job ID, valid progress, and downloaded bytes, restoring to 'queued'.
 *    - If unverified/missing: resets progress/bytes to 0 and restores to 'queued' with the SAME Job ID.
 *    - Enqueues all recovered jobs in global FIFO order.
 * 2. Offline (restarted without internet):
 *    - Preserves partial files and marks incomplete jobs as 'interrupted'.
 *    - Does NOT mark jobs as failed; network recovery service will auto-resume them once internet reconnects.
 *
 * @param {object} [options={}]
 * @param {boolean} [options.autoEnqueue=true] - Whether to immediately submit recovered jobs to queue
 * @param {Function} [options.enqueue] - Custom enqueue callback for testing/dependency injection
 * @param {boolean} [options.isOnline] - Explicit online override for testing
 * @returns {Promise<{ interruptedDownloads: number, interruptedQueuedJobs: number, recoveredJobIds: Array<number> }>}
 */
export async function recoverInterruptedDownloadJobs(options = {}) {
  const sequelize = getDatabase()
  const DownloadJob = sequelize.models.DownloadJob
  const AppSetting = sequelize.models.AppSetting

  const autoEnqueue = options?.autoEnqueue ?? true
  const enqueue = typeof options?.enqueue === 'function' ? options.enqueue : enqueueDownloadJob

  const isOnline =
    typeof options?.isOnline === 'boolean'
      ? options.isOnline
      : await checkNetworkConnectivity({ timeoutMs: 4000 })

  // 1. Resolve configured download folder for verifying partial files
  let downloadPath = null
  try {
    const savedPath = await getSavedDownloadPath(AppSetting)
    downloadPath = savedPath || (await getDefaultDownloadPath())
  } catch {
    downloadPath = null
  }

  // 2. Query all incomplete jobs globally ordered by createdAt ASC, id ASC (Global FIFO)
  const incompleteJobs = await sequelize.transaction(async (transaction) => {
    return await DownloadJob.findAll({
      where: {
        status: {
          [Op.in]: ['downloading', 'interrupted', 'queued']
        }
      },
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC']
      ],
      transaction
    })
  })

  // Check currently scheduled jobs in the queue to maintain strict idempotency
  const currentQueueStatus = getQueueStatus()
  const alreadyScheduled = new Set(currentQueueStatus?.scheduledJobIds || [])

  let recoveredDownloadsCount = 0
  let recoveredQueuedCount = 0
  const recoveredJobIds = []

  for (const job of incompleteJobs) {
    if (sessionRecoveredJobIds.has(job.id) || alreadyScheduled.has(job.id)) {
      continue
    }

    sessionRecoveredJobIds.add(job.id)

    // Handle offline startup
    if (!isOnline) {
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

      const updatePayload = {
        status: 'interrupted',
        error_message: 'Internet connection is unavailable. Waiting for network connection...'
      }
      if (hasValidPartial) {
        updatePayload.downloaded_bytes = reconciledBytes
      } else {
        if (downloadPath) {
          try {
            await cleanupJobTemporaryFiles(job.id, downloadPath)
          } catch {
            // Ignore fallback cleanup errors
          }
        }
        updatePayload.progress = 0
        updatePayload.downloaded_bytes = 0
      }

      const originalStatus = job.status
      await job.update(updatePayload)

      if (originalStatus === 'queued') {
        recoveredQueuedCount++
      } else {
        recoveredDownloadsCount++
      }
      continue
    }

    // Online recovery flow:
    if (job.status === 'downloading' || job.status === 'interrupted') {
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
        // Option A: Preserve valid progress and downloaded bytes
        await job.update({
          status: 'queued',
          downloaded_bytes: reconciledBytes,
          error_message: null
        })
        console.log(
          `[recovery] Resumable job ${job.id} preserved (progress: ${job.progress}%, bytes: ${reconciledBytes})`
        )
      } else {
        // No valid partial download: safely clean unusable fragments and restart from 0 with same Job ID
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
        console.log(`[recovery] Unverified job ${job.id} reset to zero for fresh restart`)
      }

      recoveredDownloadsCount++
      recoveredJobIds.push(job.id)
    } else if (job.status === 'queued') {
      await job.update({
        status: 'queued',
        error_message: null
      })

      recoveredQueuedCount++
      recoveredJobIds.push(job.id)
    }
  }

  // 3. Submit recovered jobs to download queue in global FIFO order
  if (isOnline && autoEnqueue && recoveredJobIds.length > 0) {
    for (const jobId of recoveredJobIds) {
      try {
        enqueue(jobId)
      } catch (enqueueErr) {
        console.warn(`[recovery] Failed to enqueue recovered job ${jobId}:`, enqueueErr.message)
      }
    }
  }

  return {
    interruptedDownloads: recoveredDownloadsCount,
    interruptedQueuedJobs: recoveredQueuedCount,
    recoveredJobIds
  }
}
