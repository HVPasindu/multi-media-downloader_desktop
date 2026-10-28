
import { executeDownloadJob, cancelRunningDownload } from './downloadService.js'
import { getDatabase } from '../config/database.js'

// Maximum number of download jobs running at once
const MAX_CONCURRENT_DOWNLOADS = 2

// FIFO list of waiting download job IDs
const waitingJobIds = []

// Prevent scheduling the same job ID more than once
const scheduledJobIds = new Set()

// Number of jobs currently executing
let activeDownloadCount = 0

function processDownloadQueue() {
  while (
    activeDownloadCount < MAX_CONCURRENT_DOWNLOADS &&
    waitingJobIds.length > 0
  ) {
    const jobId = waitingJobIds.shift()

    // Reserve an execution slot immediately
    activeDownloadCount += 1

    void Promise.resolve()
      .then(() => executeDownloadJob(jobId))
      .catch((error) => {
        if (error?.name === 'DownloadCancelledError') {
          console.log(`[queue] Download Job ${jobId} was cancelled`)
          return
        }

        console.error(
          `Queued Download Job ${jobId} failed:`,
          error
        )
      })
      .finally(() => {
        // Always release the execution slot
        activeDownloadCount -= 1

        // Allow this job ID to leave the scheduler
        scheduledJobIds.delete(jobId)

        // Start the next waiting job if possible
        processDownloadQueue()
      })
  }
}

export function enqueueDownloadJob(jobId) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
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

  // 3. Handle Queued Job
  if (job.status === 'queued') {
    const queueIndex = waitingJobIds.indexOf(jobId)

    if (queueIndex !== -1) {
      // Remove from the in-memory waiting list immediately
      waitingJobIds.splice(queueIndex, 1)

      // Guarded update in SQLite: only update if still 'queued'
      const [updatedCount] = await DownloadJob.update(
        {
          status: 'cancelled',
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
      // Brief check to see if SQLite status updated to 'cancelled'
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        const currentJob = await DownloadJob.findByPk(jobId)
        if (currentJob?.status === 'cancelled') {
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

// Optional helper function to inspect queue state during testing and verification
export function getQueueStatus() {
  return {
    maxConcurrency: MAX_CONCURRENT_DOWNLOADS,
    activeCount: activeDownloadCount,
    waitingCount: waitingJobIds.length,
    waitingJobIds: [...waitingJobIds],
    scheduledJobIds: [...scheduledJobIds]
  }
}

