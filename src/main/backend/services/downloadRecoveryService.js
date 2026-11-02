import { getDatabase } from '../config/database.js'
import { getSavedDownloadPath } from './downloadSettingsService.js'
import { getDefaultDownloadPath } from './downloadPathService.js'
import { cleanupJobTemporaryFiles, verifyJobPartialDownload } from './downloadCleanupService.js'
import { enqueueDownloadJob, getQueueStatus } from './downloadQueueService.js'

// In-memory set to guarantee strict idempotency within the session
const sessionRecoveredJobIds = new Set()

export function resetRecoveryTrackingForTesting() {
  sessionRecoveredJobIds.clear()
}

/**
 * Step 09 (Phase 04) — Automatic Download Recovery (Option A: Resume Existing Job).
 *
 * Scans SQLite for incomplete downloads from previous application sessions.
 * 1. For interrupted 'downloading' jobs:
 *    - Verifies whether real, non-empty partial download files exist on disk.
 *    - If valid partial files exist: preserves the original Job ID, valid progress,
 *      and downloaded bytes, and transitions status to 'queued' for seamless resumption.
 *    - If partial files are missing or empty: resets progress/bytes to 0 and transitions
 *      to 'queued' to safely restart from the beginning with the SAME Job ID.
 * 2. For interrupted 'queued' jobs:
 *    - Restores them to the active scheduler in predictable FIFO order.
 * 3. Enqueues all recovered jobs in FIFO order (createdAt ASC, id ASC) into the download queue.
 *
 * @param {object} [options={}]
 * @param {boolean} [options.autoEnqueue=true] - Whether to immediately submit recovered jobs to queue
 * @param {Function} [options.enqueue] - Custom enqueue callback for testing/dependency injection
 * @returns {Promise<{ interruptedDownloads: number, interruptedQueuedJobs: number, recoveredJobIds: Array<number> }>}
 */
export async function recoverInterruptedDownloadJobs(options = {}) {
  const sequelize = getDatabase()
  const DownloadJob = sequelize.models.DownloadJob
  const AppSetting = sequelize.models.AppSetting

  const autoEnqueue = options?.autoEnqueue ?? true
  const enqueue = typeof options?.enqueue === 'function' ? options.enqueue : enqueueDownloadJob

  // 1. Resolve configured download folder for verifying partial files
  let downloadPath = null
  try {
    const savedPath = await getSavedDownloadPath(AppSetting)
    downloadPath = savedPath || (await getDefaultDownloadPath())
  } catch {
    downloadPath = null
  }

  // 2. Query incomplete jobs within an immediate transaction to guard against concurrent startup
  const { downloadingJobs, queuedJobs } = await sequelize.transaction(async (transaction) => {
    const dJobs = await DownloadJob.findAll({
      where: {
        status: 'downloading'
      },
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC']
      ],
      transaction
    })

    const qJobs = await DownloadJob.findAll({
      where: {
        status: 'queued'
      },
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC']
      ],
      transaction
    })

    return {
      downloadingJobs: dJobs,
      queuedJobs: qJobs
    }
  })

  // Check currently scheduled jobs in the queue to maintain strict idempotency
  const currentQueueStatus = getQueueStatus()
  const alreadyScheduled = new Set(currentQueueStatus?.scheduledJobIds || [])

  let recoveredDownloadsCount = 0
  let recoveredQueuedCount = 0
  const recoveredJobIds = []

  // 3. Process interrupted downloading jobs
  for (const job of downloadingJobs) {
    if (sessionRecoveredJobIds.has(job.id) || alreadyScheduled.has(job.id)) {
      continue
    }

    sessionRecoveredJobIds.add(job.id)

    let hasValidPartial = false

    if (downloadPath) {
      try {
        const partialResult = await verifyJobPartialDownload(job.id, downloadPath)
        hasValidPartial = Boolean(partialResult.isValid && !partialResult.isUnsafe)
      } catch {
        hasValidPartial = false
      }
    }

    if (hasValidPartial) {
      // Option A: Preserve valid progress snapshot and downloaded bytes
      await job.update({
        status: 'queued',
        error_message: null
      })
      console.log(
        `[recovery] Resumable job ${job.id} preserved (progress: ${job.progress}%, bytes: ${job.downloaded_bytes})`
      )
    } else {
      // No valid partial download: safely clean any 0-byte or corrupted fragments and restart from 0
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
  }

  // 4. Process interrupted queued jobs (only if not already scheduled or recovered)
  for (const job of queuedJobs) {
    if (sessionRecoveredJobIds.has(job.id) || alreadyScheduled.has(job.id)) {
      continue
    }

    sessionRecoveredJobIds.add(job.id)

    await job.update({
      status: 'queued',
      error_message: null
    })

    recoveredQueuedCount++
    recoveredJobIds.push(job.id)
  }

  // 5. Submit recovered jobs to download queue in FIFO order
  if (autoEnqueue && recoveredJobIds.length > 0) {
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
