
import { executeDownloadJob } from './downloadService.js'

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

