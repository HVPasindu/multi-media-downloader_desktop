import {
  executeDownloadJob,
  cancelRunningDownload,
  pauseRunningDownload
} from './downloadService.js'
import { isTransientNetworkError } from './downloadErrorService.js'
import { getDatabase } from '../config/database.js'
import {
  checkNetworkConnectivity,
  scheduleJobRetry,
  clearJobRetryState
} from './networkRecoveryService.js'
import { resolveValidatedDownloadPath } from './downloadPathService.js'
import {
  verifyJobPartialDownload,
  cleanupJobTemporaryFiles,
  isPartialDownloadResumable
} from './downloadCleanupService.js'

// Maximum number of download jobs running at once
const MAX_CONCURRENT_DOWNLOADS = 2

// FIFO list of waiting download job IDs
const waitingJobIds = []

// Prevent scheduling the same job ID more than once
const scheduledJobIds = new Set()

// Number of jobs currently executing
let activeDownloadCount = 0

// Step 09.G - Prevent new queue dispatches during application shutdown
let isShuttingDown = false

// Testing override executor hook
let overrideExecutor = null

export function setExecutorForTesting(fn) {
  overrideExecutor = fn
}

export function resetExecutorForTesting() {
  overrideExecutor = null
}

export function stopQueueForShutdown() {
  isShuttingDown = true
}

export function resetQueueForTesting() {
  isShuttingDown = false
  waitingJobIds.length = 0
  scheduledJobIds.clear()
  activeDownloadCount = 0
  overrideExecutor = null
}

function processDownloadQueue() {
  if (isShuttingDown) {
    return
  }

  while (
    !isShuttingDown &&
    activeDownloadCount < MAX_CONCURRENT_DOWNLOADS &&
    waitingJobIds.length > 0
  ) {
    const jobId = waitingJobIds.shift()

    // Reserve an execution slot immediately
    activeDownloadCount += 1

    void Promise.resolve()
      .then(() => (overrideExecutor || executeDownloadJob)(jobId))
      .catch((error) => {
        if (error?.name === 'DownloadCancelledError') {
          console.log(`[queue] Download Job ${jobId} was cancelled`)
          return
        }

        if (error?.name === 'DownloadPausedError') {
          console.log(`[queue] Download Job ${jobId} was paused`)
          return
        }

        if (error?.name === 'DownloadInterruptedError') {
          console.log(`[queue] Download Job ${jobId} was interrupted by shutdown`)
          return
        }

        if (isTransientNetworkError(error)) {
          console.log(`[queue] Download Job ${jobId} was interrupted by network loss`)
          return
        }

        console.error(`Queued Download Job ${jobId} failed:`, error)
      })
      .finally(() => {
        // Always release the execution slot
        activeDownloadCount -= 1

        // Allow this job ID to leave the scheduler
        scheduledJobIds.delete(jobId)

        // Start the next waiting job if possible
        if (!isShuttingDown) {
          processDownloadQueue()
        }
      })
  }
}

export function enqueueDownloadJob(jobId) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  // Step 09.G - Prevent queueing when shutdown is active
  if (isShuttingDown) {
    return false
  }

  // Do not schedule the same job ID twice
  if (scheduledJobIds.has(jobId)) {
    return false
  }

  scheduledJobIds.add(jobId)
  waitingJobIds.push(jobId)

  // Start available jobs without blocking the caller
  processDownloadQueue()

  return true
}

export async function cancelDownloadJob(jobId) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  const { DownloadJob } = getDatabase().models

  // 1. Fetch current job record from SQLite
  const job = await DownloadJob.findByPk(jobId)

  if (!job) {
    return {
      outcome: 'not_found'
    }
  }

  // 2. Check terminal states
  if (job.status === 'completed') {
    return {
      outcome: 'conflict',
      status: 'completed',
      message: 'This download job cannot be cancelled'
    }
  }

  if (job.status === 'failed') {
    return {
      outcome: 'conflict',
      status: 'failed',
      message: 'This download job cannot be cancelled'
    }
  }

  if (job.status === 'cancelled') {
    return {
      outcome: 'already_cancelled',
      status: 'cancelled',
      message: 'Download is already cancelled'
    }
  }

  // Handle Paused Job
  if (job.status === 'paused') {
    try {
      const cleanPath = await resolveValidatedDownloadPath(getDatabase().models.AppSetting)
      if (cleanPath) {
        const cleanupResult = await cleanupJobTemporaryFiles(jobId, cleanPath)
        if (cleanupResult && cleanupResult.success === false) {
          return {
            outcome: 'cleanup_failed',
            status: 'paused',
            message: cleanupResult.error || 'Failed to clean partial files during cancellation'
          }
        }
      }
    } catch (cleanErr) {
      return {
        outcome: 'cleanup_failed',
        status: 'paused',
        message: cleanErr.message || 'Failed to clean partial files during cancellation'
      }
    }

    const queueIndex = waitingJobIds.indexOf(jobId)
    if (queueIndex !== -1) {
      waitingJobIds.splice(queueIndex, 1)
    }
    scheduledJobIds.delete(jobId)

    const [updatedCount] = await DownloadJob.update(
      {
        status: 'cancelled',
        progress: 0,
        downloaded_bytes: 0,
        error_message: null
      },
      {
        where: {
          id: jobId,
          status: 'paused'
        }
      }
    )

    if (updatedCount === 1) {
      clearJobRetryState(jobId)
      return {
        outcome: 'cancelled',
        status: 'cancelled',
        message: 'Download cancelled successfully'
      }
    }
  }

  // Step 09.B - Handle Interrupted Job (cancellation while waiting for network)
  if (job.status === 'interrupted') {
    try {
      const cleanPath = await resolveValidatedDownloadPath(getDatabase().models.AppSetting)
      if (cleanPath) {
        const cleanupResult = await cleanupJobTemporaryFiles(jobId, cleanPath)
        if (cleanupResult && cleanupResult.success === false) {
          return {
            outcome: 'cleanup_failed',
            status: 'interrupted',
            message: cleanupResult.error || 'Failed to clean partial files during cancellation'
          }
        }
      }
    } catch (cleanErr) {
      return {
        outcome: 'cleanup_failed',
        status: 'interrupted',
        message: cleanErr.message || 'Failed to clean partial files during cancellation'
      }
    }

    const queueIndex = waitingJobIds.indexOf(jobId)
    if (queueIndex !== -1) {
      waitingJobIds.splice(queueIndex, 1)
    }
    scheduledJobIds.delete(jobId)

    const [updatedCount] = await DownloadJob.update(
      {
        status: 'cancelled',
        progress: 0,
        downloaded_bytes: 0,
        error_message: null
      },
      {
        where: {
          id: jobId,
          status: 'interrupted'
        }
      }
    )

    if (updatedCount === 1) {
      clearJobRetryState(jobId)
      return {
        outcome: 'cancelled',
        status: 'cancelled',
        message: 'Download cancelled successfully'
      }
    }
  }

  // 3. Handle Queued Job
  if (job.status === 'queued') {
    try {
      const cleanPath = await resolveValidatedDownloadPath(getDatabase().models.AppSetting)
      if (cleanPath) {
        const cleanupResult = await cleanupJobTemporaryFiles(jobId, cleanPath)
        if (cleanupResult && cleanupResult.success === false) {
          return {
            outcome: 'cleanup_failed',
            status: 'queued',
            message: cleanupResult.error || 'Failed to clean partial files during cancellation'
          }
        }
      }
    } catch (cleanErr) {
      return {
        outcome: 'cleanup_failed',
        status: 'queued',
        message: cleanErr.message || 'Failed to clean partial files during cancellation'
      }
    }
    const queueIndex = waitingJobIds.indexOf(jobId)

    if (queueIndex !== -1) {
      // Remove from the in-memory waiting list immediately
      waitingJobIds.splice(queueIndex, 1)

      // Guarded update in SQLite: only update if still 'queued'
      const [updatedCount] = await DownloadJob.update(
        {
          status: 'cancelled',
          progress: 0,
          downloaded_bytes: 0,
          error_message: null
        },
        {
          where: {
            id: jobId,
            status: 'queued'
          }
        }
      )

      if (updatedCount === 1) {
        scheduledJobIds.delete(jobId)

        return {
          outcome: 'cancelled',
          status: 'cancelled',
          message: 'Download cancelled successfully'
        }
      }

      // If guarded update failed (race with job execution starting), restore position
      waitingJobIds.splice(queueIndex, 0, jobId)
    }

    // Re-check status in database in case it transitioned to 'downloading'
    const recheckedJob = await DownloadJob.findByPk(jobId)

    if (recheckedJob?.status === 'downloading') {
      job.status = 'downloading'
    } else if (recheckedJob?.status === 'queued') {
      // Job was not in the current in-memory queue (e.g. from previous application session)
      const [updatedCount] = await DownloadJob.update(
        {
          status: 'cancelled',
          progress: 0,
          downloaded_bytes: 0,
          error_message: null
        },
        {
          where: {
            id: jobId,
            status: 'queued'
          }
        }
      )

      if (updatedCount === 1) {
        return {
          outcome: 'cancelled',
          status: 'cancelled',
          message: 'Download cancelled successfully'
        }
      }
    } else {
      return {
        outcome: recheckedJob?.status === 'cancelled' ? 'already_cancelled' : 'conflict',
        status: recheckedJob?.status ?? 'conflict',
        message: 'This download job cannot be cancelled'
      }
    }
  }

  // 4. Handle Running Job (status === 'downloading')
  if (job.status === 'downloading') {
    const cancelResult = await cancelRunningDownload(jobId)

    if (cancelResult.success) {
      const currentJob = await DownloadJob.findByPk(jobId)
      if (currentJob?.status === 'cancelled') {
        return {
          outcome: 'cancelled',
          status: 'cancelled',
          message: 'Download cancelled successfully'
        }
      }

      // Brief check to see if SQLite status updated to 'cancelled'
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        const recheckJob = await DownloadJob.findByPk(jobId)
        if (recheckJob?.status === 'cancelled') {
          return {
            outcome: 'cancelled',
            status: 'cancelled',
            message: 'Download cancelled successfully'
          }
        }
      }

      return {
        outcome: 'cancellation_requested',
        status: 'cancellation_requested',
        message: 'Download cancellation is in progress'
      }
    }

    if (cancelResult.reason === 'not_running') {
      const refreshedJob = await DownloadJob.findByPk(jobId)

      if (refreshedJob?.status === 'cancelled') {
        return {
          outcome: 'already_cancelled',
          status: 'cancelled',
          message: 'Download is already cancelled'
        }
      }

      return {
        outcome: 'conflict',
        status: refreshedJob?.status ?? 'downloading',
        message: 'This download job cannot be cancelled'
      }
    }

    throw new Error(cancelResult.error || 'Failed to cancel running download process')
  }

  return {
    outcome: 'conflict',
    status: job.status,
    message: 'This download job cannot be cancelled'
  }
}

export async function pauseDownloadJob(jobId) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  const { DownloadJob } = getDatabase().models

  // 1. Fetch current job record from SQLite
  const job = await DownloadJob.findByPk(jobId)

  if (!job) {
    return {
      outcome: 'not_found'
    }
  }

  // 2. Check terminal states
  if (['completed', 'failed', 'cancelled'].includes(job.status)) {
    return {
      outcome: 'conflict',
      status: job.status,
      message: 'This download job cannot be paused'
    }
  }

  if (job.status === 'paused') {
    return {
      outcome: 'already_paused',
      status: 'paused',
      message: 'Download is already paused'
    }
  }

  // 3. Handle Interrupted Job (manual pause prevents auto-resume on network restore)
  if (job.status === 'interrupted') {
    clearJobRetryState(jobId)
    const queueIndex = waitingJobIds.indexOf(jobId)
    if (queueIndex !== -1) {
      waitingJobIds.splice(queueIndex, 1)
    }
    scheduledJobIds.delete(jobId)

    const [updatedCount] = await DownloadJob.update(
      {
        status: 'paused',
        error_message: null
      },
      {
        where: {
          id: jobId,
          status: 'interrupted'
        }
      }
    )

    if (updatedCount === 1) {
      return {
        outcome: 'paused',
        status: 'paused',
        message: 'Download paused successfully'
      }
    }
  }

  // 4. Handle Queued Job
  if (job.status === 'queued') {
    const queueIndex = waitingJobIds.indexOf(jobId)

    if (queueIndex !== -1) {
      waitingJobIds.splice(queueIndex, 1)

      const [updatedCount] = await DownloadJob.update(
        {
          status: 'paused',
          error_message: null
        },
        {
          where: {
            id: jobId,
            status: 'queued'
          }
        }
      )

      if (updatedCount === 1) {
        scheduledJobIds.delete(jobId)

        return {
          outcome: 'paused',
          status: 'paused',
          message: 'Download paused successfully'
        }
      }

      // If update failed (race with job execution starting), restore position
      waitingJobIds.splice(queueIndex, 0, jobId)
    }

    // Re-check status in database in case it transitioned to 'downloading'
    const recheckedJob = await DownloadJob.findByPk(jobId)

    if (recheckedJob?.status === 'downloading') {
      job.status = 'downloading'
    } else if (recheckedJob?.status === 'queued') {
      const [updatedCount] = await DownloadJob.update(
        {
          status: 'paused',
          error_message: null
        },
        {
          where: {
            id: jobId,
            status: 'queued'
          }
        }
      )

      if (updatedCount === 1) {
        return {
          outcome: 'paused',
          status: 'paused',
          message: 'Download paused successfully'
        }
      }
    } else {
      return {
        outcome: recheckedJob?.status === 'paused' ? 'already_paused' : 'conflict',
        status: recheckedJob?.status ?? 'conflict',
        message: 'This download job cannot be paused'
      }
    }
  }

  // 5. Handle Running Job (status === 'downloading')
  if (job.status === 'downloading') {
    const pauseResult = await pauseRunningDownload(jobId)

    if (pauseResult.success) {
      const currentJob = await DownloadJob.findByPk(jobId)
      if (currentJob?.status === 'paused') {
        return {
          outcome: 'paused',
          status: 'paused',
          message: 'Download paused successfully'
        }
      }

      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        const recheckJob = await DownloadJob.findByPk(jobId)
        if (recheckJob?.status === 'paused') {
          return {
            outcome: 'paused',
            status: 'paused',
            message: 'Download paused successfully'
          }
        }
      }

      // If still not paused in DB, report pause_pending rather than claiming false success
      const currentStatus = (await DownloadJob.findByPk(jobId))?.status || 'downloading'
      return {
        outcome: 'pause_pending',
        status: currentStatus,
        message: 'Download pause is in progress'
      }
    }

    if (pauseResult.reason === 'already_finishing') {
      // The download is in FFmpeg merge/post-processing — cannot pause safely.
      // The job will complete shortly; inform the caller without marking as failed.
      return {
        outcome: 'already_finishing',
        status: 'downloading',
        message: 'Download is finishing — it will complete momentarily and cannot be paused now'
      }
    }

    if (pauseResult.reason === 'not_running') {
      const refreshedJob = await DownloadJob.findByPk(jobId)

      if (refreshedJob?.status === 'paused') {
        return {
          outcome: 'already_paused',
          status: 'paused',
          message: 'Download is already paused'
        }
      }

      return {
        outcome: 'conflict',
        status: refreshedJob?.status ?? 'downloading',
        message: 'This download job cannot be paused'
      }
    }

    if (pauseResult.reason === 'validation_failed') {
      return {
        outcome: 'conflict',
        status: 'failed',
        message: pauseResult.error || 'Partial file verification failed during pause'
      }
    }

    return {
      outcome: 'interruption_failed',
      status: 'downloading',
      message: pauseResult.error || 'Failed to pause download process'
    }
  }

  return {
    outcome: 'conflict',
    status: job.status,
    message: 'This download job cannot be paused'
  }
}

export async function resumeDownloadJob(jobId, options = {}) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  const { DownloadJob, AppSetting } = getDatabase().models

  const job = await DownloadJob.findByPk(jobId)

  if (!job) {
    return {
      outcome: 'not_found'
    }
  }

  if (job.status === 'downloading') {
    return {
      outcome: 'already_running',
      status: 'downloading',
      message: 'Download is already running'
    }
  }

  if (job.status === 'queued') {
    return {
      outcome: 'already_queued',
      status: 'queued',
      message: 'Download is already queued'
    }
  }

  if (job.status !== 'paused') {
    return {
      outcome: 'conflict',
      status: job.status,
      message: 'This download job cannot be resumed'
    }
  }

  // Network check
  const isOnline =
    typeof options?.isOnline === 'boolean'
      ? options.isOnline
      : await checkNetworkConnectivity({ timeoutMs: 2500 })

  if (!isOnline) {
    // If offline, transition to interrupted and schedule network recovery without fake downloading state
    await DownloadJob.update(
      {
        status: 'interrupted',
        error_message: 'Internet connection was lost. Waiting for network connection to resume...'
      },
      {
        where: { id: jobId, status: 'paused' }
      }
    )
    scheduleJobRetry(jobId)

    return {
      outcome: 'interrupted',
      status: 'interrupted',
      message:
        'Internet connection is unavailable. Job marked as interrupted and will resume once connection is restored.'
    }
  }

  // Validate saved partial checkpoint if job has progress (Fix 04)
  let reconciledBytes = job.downloaded_bytes || 0
  let downloadPath = null
  try {
    downloadPath = await resolveValidatedDownloadPath(AppSetting)
  } catch {
    downloadPath = null
  }

  if (job.downloaded_bytes > 0 || job.progress > 0) {
    if (!downloadPath) {
      return {
        outcome: 'checkpoint_invalid',
        status: 'paused',
        message: 'Cannot resume: download folder path cannot be resolved'
      }
    }

    let isResumable = false
    try {
      const partialResult = await verifyJobPartialDownload(job.id, downloadPath, {
        savedDownloadedBytes: job.downloaded_bytes,
        savedProgress: job.progress
      })
      isResumable = isPartialDownloadResumable(partialResult)
      if (isResumable && partialResult.reconciledBytes > 0) {
        reconciledBytes = partialResult.reconciledBytes
      }
    } catch {
      isResumable = false
    }

    if (!isResumable) {
      console.warn(
        `[queue] Resume rejected for job ${jobId}: partial checkpoint is missing or invalid`
      )
      return {
        outcome: 'checkpoint_invalid',
        status: 'paused',
        message: 'Cannot resume: saved partial download checkpoint is missing or invalid'
      }
    }
  }

  // Transition job status to 'queued'
  const updatePayload = {
    status: 'queued',
    error_message: null
  }
  if (reconciledBytes > 0) {
    updatePayload.downloaded_bytes = reconciledBytes
  }

  const [updatedCount] = await DownloadJob.update(updatePayload, {
    where: {
      id: jobId,
      status: 'paused'
    }
  })

  if (updatedCount !== 1) {
    const currentJob = await DownloadJob.findByPk(jobId)
    return {
      outcome: 'conflict',
      status: currentJob?.status ?? 'conflict',
      message: 'Download job status changed before resume could complete'
    }
  }

  // Enqueue job into FIFO queue
  const enqueue = typeof options?.enqueue === 'function' ? options.enqueue : enqueueDownloadJob
  enqueue(jobId)

  return {
    outcome: 'resumed',
    status: 'queued',
    message: 'Download resumed successfully'
  }
}

// Optional helper function to inspect queue state during testing and verification
export function getQueueStatus() {
  return {
    maxConcurrency: MAX_CONCURRENT_DOWNLOADS,
    activeCount: activeDownloadCount,
    activeJobs: activeDownloadCount,
    waitingCount: waitingJobIds.length,
    waitingJobs: waitingJobIds.length,
    waitingJobIds: [...waitingJobIds],
    scheduledJobIds: [...scheduledJobIds]
  }
}
