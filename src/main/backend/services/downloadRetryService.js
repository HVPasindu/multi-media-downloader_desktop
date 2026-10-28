
import { getDatabase } from '../config/database.js'
import {
  createDownloadJob,
  markDownloadJobFailed
} from './downloadService.js'
import { enqueueDownloadJob } from './downloadQueueService.js'
import { findActiveDuplicateDownload } from './downloadDuplicateService.js'

// Track currently processing retry requests to prevent concurrent double-click requests
const retryRequestsInProgress = new Set()

// Track active retry jobs: Map(originalJobId => activeRetryJobId)
const activeRetryJobs = new Map()

export async function retryDownloadJob(originalJobId) {
  if (!Number.isSafeInteger(originalJobId) || originalJobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  // 1. Concurrency guard: check if a retry request for this originalJobId is currently in progress
  if (retryRequestsInProgress.has(originalJobId)) {
    return {
      outcome: 'retry_in_progress',
      message: 'A retry is already in progress for this job'
    }
  }

  // Synchronously reserve this originalJobId
  retryRequestsInProgress.add(originalJobId)

  try {
    const { DownloadJob, MediaItem } = getDatabase().models

    // 2. Check if a previously created retry for this job is still queued or downloading
    if (activeRetryJobs.has(originalJobId)) {
      const existingRetryJobId = activeRetryJobs.get(originalJobId)
      const existingRetryJob = await DownloadJob.findByPk(existingRetryJobId)

      if (
        existingRetryJob &&
        ['queued', 'downloading'].includes(existingRetryJob.status)
      ) {
        return {
          outcome: 'retry_in_progress',
          message: 'A retry is already in progress for this job'
        }
      }

      // If existing retry is finished (completed, failed, or cancelled), clear it
      activeRetryJobs.delete(originalJobId)
    }

    // 3. Find the original Download Job
    const originalJob = await DownloadJob.findByPk(originalJobId)

    if (!originalJob) {
      return {
        outcome: 'not_found',
        message: 'Download Job not found'
      }
    }

    // 4. Validate retry eligibility: only 'failed' or 'cancelled'
    const canRetry = ['failed', 'cancelled'].includes(originalJob.status)

    if (!canRetry) {
      return {
        outcome: 'not_retryable',
        status: originalJob.status,
        message: 'Only failed or cancelled downloads can be retried'
      }
    }

    // 5. Verify the related MediaItem exists
    const media = await MediaItem.findByPk(originalJob.media_id)

    if (
      !media ||
      typeof media.source_url !== 'string' ||
      !media.source_url.trim()
    ) {
      return {
        outcome: 'media_missing',
        message: 'Related media item or source URL not found'
      }
    }

    // Check if an equivalent download is already active (queued or downloading)
    const activeDuplicate = await findActiveDuplicateDownload({
      sourceUrl: media.source_url,
      mediaItemId: originalJob.media_id,
      outputFormat: originalJob.output_format,
      quality: originalJob.quality,
      audioBitrateKbps: originalJob.audio_bitrate_kbps
    })

    if (activeDuplicate) {
      activeRetryJobs.set(originalJobId, activeDuplicate.id)
      return {
        outcome: 'retry_in_progress',
        message: 'An equivalent download is already in progress'
      }
    }

    // 6. Create the NEW download job reusing original settings
    const newJob = await createDownloadJob({
      mediaItemId: originalJob.media_id,
      outputFormat: originalJob.output_format,
      quality: originalJob.quality,
      audioBitrateKbps: originalJob.audio_bitrate_kbps
    })

    // 7. Submit the new job to the existing queue
    try {
      enqueueDownloadJob(newJob.id)
    } catch (queueError) {
      console.error(
        `Failed to enqueue retry job ${newJob.id}:`,
        queueError
      )

      try {
        await markDownloadJobFailed(newJob.id, queueError, 'queued')
      } catch (markError) {
        console.error(
          `Could not mark retry job ${newJob.id} as failed:`,
          markError
        )
      }

      throw queueError
    }

    // 8. Associate original job with the new active retry job
    activeRetryJobs.set(originalJobId, newJob.id)

    return {
      outcome: 'created',
      originalJobId: originalJob.id,
      retryJobId: newJob.id,
      status: 'queued',
      message: 'Download retry job created successfully'
    }

  } finally {
    // Release the concurrency lock
    retryRequestsInProgress.delete(originalJobId)
  }
}

