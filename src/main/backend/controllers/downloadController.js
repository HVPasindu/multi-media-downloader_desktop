import {
  createDownloadJob,
  markDownloadJobFailed,
  SUPPORTED_MP3_BITRATES
} from '../services/downloadService.js'

import {
  listDownloadHistory,
  validateHistoryFilters,
  getDownloadHistoryDetails,
  deleteDownloadHistoryRecord,
  clearDownloadHistory
} from '../services/downloadHistoryService.js'

import { enqueueDownloadJob, cancelDownloadJob } from '../services/downloadQueueService.js'

import { retryDownloadJob } from '../services/downloadRetryService.js'

import {
  buildDownloadRequestIdentity,
  findActiveDuplicateDownload,
  withDownloadCreationGuard
} from '../services/downloadDuplicateService.js'

import { getDatabase } from '../config/database.js'
import { analyzeMedia } from '../services/mediaAnalyzerService.js'
import { validateMediaUrl } from '../services/mediaUrlSecurityService.js'

export async function createDownloadJobController(req, res, next) {
  try {
    const { mediaItemId, outputFormat, quality, audioBitrateKbps } = req.body ?? {}

    // Validate the incoming request
    const invalidMediaId = !Number.isInteger(mediaItemId) || mediaItemId <= 0

    const invalidFormat = !['mp4', 'mp3'].includes(outputFormat)

    const invalidQuality =
      outputFormat === 'mp4' && (typeof quality !== 'string' || !/^\d+p$/.test(quality))

    const invalidBitrate =
      outputFormat === 'mp3' && !SUPPORTED_MP3_BITRATES.includes(audioBitrateKbps)

    if (invalidMediaId || invalidFormat || invalidQuality || invalidBitrate) {
      return res.status(400).json({
        success: false,
        message: 'Invalid download job details'
      })
    }

    const MediaItem = getDatabase().models.MediaItem

    const media = await MediaItem.findByPk(mediaItemId)

    if (!media) {
      return res.status(404).json({
        success: false,
        message: 'Media Item not found'
      })
    }

    if (typeof media.source_url !== 'string' || !media.source_url.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Media source URL is missing'
      })
    }

    // Step 04.40 - Revalidate stored media source URL before scheduling download
    try {
      await validateMediaUrl(media.source_url)
    } catch (urlError) {
      return res.status(400).json({
        success: false,
        message: urlError.userMessage || 'Media source URL is invalid or unsafe'
      })
    }

    // Validate the requested MP4 quality before creating a job
    if (outputFormat === 'mp4') {
      // Reuse the existing analyzer
      const analysis = await analyzeMedia(media.source_url)

      const availableQualities = analysis.videoQualities

      // Reject unavailable video resolutions
      if (!availableQualities.includes(quality)) {
        return res.status(400).json({
          success: false,
          message: `Requested video quality ${quality} is not available`,
          availableQualities
        })
      }
    }

    // Build unique request identity for duplicate synchronization
    const requestIdentity = buildDownloadRequestIdentity({
      sourceUrl: media.source_url,
      outputFormat,
      quality,
      audioBitrateKbps
    })

    // Guard against simultaneous creation races and check for active duplicate jobs
    const { job, duplicate } = await withDownloadCreationGuard(requestIdentity, async () => {
      // Check if an equivalent download is already active (queued or downloading)
      const activeDuplicate = await findActiveDuplicateDownload({
        sourceUrl: media.source_url,
        mediaItemId,
        outputFormat,
        quality,
        audioBitrateKbps
      })

      if (activeDuplicate) {
        return {
          job: activeDuplicate,
          duplicate: true
        }
      }

      // Create the new download job in SQLite
      const newJob = await createDownloadJob({
        mediaItemId,
        outputFormat,
        quality,
        audioBitrateKbps
      })

      // Add the new download job to the managed queue
      try {
        enqueueDownloadJob(newJob.id)
      } catch (enqueueError) {
        try {
          await markDownloadJobFailed(newJob.id, enqueueError, 'queued')
        } catch (markError) {
          console.error(`Could not mark job ${newJob.id} as failed:`, markError)
        }
        throw enqueueError
      }

      return {
        job: newJob,
        duplicate: false
      }
    })

    // Return existing active job details if request is an active duplicate
    if (duplicate) {
      return res.status(200).json({
        success: true,
        data: job.toJSON(),
        duplicate: true,
        message: 'An equivalent download is already queued or running'
      })
    }

    // Return 201 Created for a genuinely new download job
    return res.status(201).json({
      success: true,
      data: job.toJSON()
    })
  } catch (error) {
    if (error.message === 'Media Item not found') {
      return res.status(404).json({
        success: false,
        message: 'Media Item not found'
      })
    }

    next(error)
  }
}

export async function getDownloadJobController(req, res, next) {
  try {
    // 1. Get the Download Job ID from the URL
    const rawJobId = req.params.id

    // 2. Validate the ID
    if (typeof rawJobId !== 'string' || !/^[1-9]\d*$/.test(rawJobId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid Download Job ID is required'
      })
    }

    const jobId = Number(rawJobId)

    if (!Number.isSafeInteger(jobId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid Download Job ID is required'
      })
    }

    // 3. Get job and file details from SQLite with file availability information
    const details = await getDownloadHistoryDetails(jobId)

    // 4. Return 404 if the job does not exist
    if (!details) {
      return res.status(404).json({
        success: false,
        message: 'Download Job not found'
      })
    }

    // 5. Return the download details
    return res.status(200).json({
      success: true,
      data: details
    })
  } catch (error) {
    next(error)
  }
}

export async function cancelDownloadJobController(req, res, next) {
  try {
    // 1. Get the Download Job ID from the URL
    const rawJobId = req.params.id

    // 2. Validate the ID
    if (typeof rawJobId !== 'string' || !/^[1-9]\d*$/.test(rawJobId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid Download Job ID is required'
      })
    }

    const jobId = Number(rawJobId)

    if (!Number.isSafeInteger(jobId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid Download Job ID is required'
      })
    }

    // 3. Orchestrate cancellation
    const result = await cancelDownloadJob(jobId)

    // 4. Handle results based on outcome
    if (result.outcome === 'not_found') {
      return res.status(404).json({
        success: false,
        message: 'Download Job not found'
      })
    }

    if (result.outcome === 'conflict') {
      return res.status(409).json({
        success: false,
        message: result.message || 'This download job cannot be cancelled',
        status: result.status
      })
    }

    if (result.outcome === 'cancellation_requested') {
      return res.status(202).json({
        success: true,
        data: {
          id: jobId,
          status: 'cancellation_requested',
          message: 'Download cancellation is in progress'
        }
      })
    }

    if (result.outcome === 'already_cancelled') {
      return res.status(200).json({
        success: true,
        data: {
          id: jobId,
          status: 'cancelled',
          message: result.message || 'Download is already cancelled'
        }
      })
    }

    // Default success: 200 OK with cancelled status
    return res.status(200).json({
      success: true,
      data: {
        id: jobId,
        status: 'cancelled',
        message: result.message || 'Download cancelled successfully'
      }
    })
  } catch (error) {
    next(error)
  }
}

export async function retryDownloadJobController(req, res, next) {
  try {
    // 1. Get the Download Job ID from the URL
    const rawJobId = req.params.id

    // 2. Validate the ID
    if (typeof rawJobId !== 'string' || !/^[1-9]\d*$/.test(rawJobId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid Download Job ID is required'
      })
    }

    const originalJobId = Number(rawJobId)

    if (!Number.isSafeInteger(originalJobId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid Download Job ID is required'
      })
    }

    // 3. Orchestrate retry
    const result = await retryDownloadJob(originalJobId)

    // 4. Handle results based on outcome
    if (result.outcome === 'not_found') {
      return res.status(404).json({
        success: false,
        message: 'Download Job not found'
      })
    }

    if (result.outcome === 'not_retryable') {
      return res.status(409).json({
        success: false,
        message: result.message || 'Only failed or cancelled downloads can be retried',
        status: result.status
      })
    }

    if (result.outcome === 'retry_in_progress') {
      return res.status(409).json({
        success: false,
        message: result.message || 'A retry is already in progress for this job'
      })
    }

    if (result.outcome === 'media_missing') {
      return res.status(404).json({
        success: false,
        message: result.message || 'Related media item or source URL not found'
      })
    }

    if (result.outcome === 'unsafe_url') {
      return res.status(400).json({
        success: false,
        message: result.message || 'Media source URL failed security validation'
      })
    }

    // Default success: 201 Created
    return res.status(201).json({
      success: true,
      data: {
        originalJobId: result.originalJobId,
        retryJobId: result.retryJobId,
        status: result.status,
        message: result.message || 'Download retry job created successfully'
      }
    })
  } catch (error) {
    next(error)
  }
}

export async function listDownloadJobsController(req, res, next) {
  try {
    // 1. Validate query filter parameters
    const filterValidation = validateHistoryFilters(req.query)

    if (!filterValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid history filter parameters',
        errors: filterValidation.errors
      })
    }

    // 2. Query filtered and paginated download history
    const { jobs, pagination } = await listDownloadHistory(filterValidation.normalized)

    // 3. Return the download history preserving data array shape
    return res.status(200).json({
      success: true,
      data: jobs,
      pagination
    })
  } catch (error) {
    // 4. Forward unexpected errors to Express
    next(error)
  }
}

export async function deleteDownloadHistoryController(req, res, next) {
  try {
    // 1. Validate incoming Download Job ID parameter
    const rawJobId = req.params.id

    if (typeof rawJobId !== 'string' || !/^[1-9]\d*$/.test(rawJobId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid Download Job ID is required'
      })
    }

    const jobId = Number(rawJobId)

    if (!Number.isSafeInteger(jobId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid Download Job ID is required'
      })
    }

    // 2. Delete history record safely in SQLite
    const result = await deleteDownloadHistoryRecord(jobId)

    if (result.outcome === 'not_found') {
      return res.status(404).json({
        success: false,
        message: 'Download Job not found'
      })
    }

    if (result.outcome === 'conflict') {
      return res.status(409).json({
        success: false,
        message: result.message || 'Cannot delete active download history',
        status: result.status
      })
    }

    return res.status(200).json({
      success: true,
      data: {
        id: jobId,
        deleted: true,
        physicalFileDeleted: false
      },
      message: 'Download history record deleted'
    })
  } catch (error) {
    next(error)
  }
}

export async function clearDownloadHistoryController(req, res, next) {
  try {
    const { confirm, statuses } = req.body ?? {}

    // 1. Require explicit confirmation
    if (confirm !== true) {
      return res.status(400).json({
        success: false,
        message: 'Explicit confirmation (confirm: true) is required to clear download history'
      })
    }

    // 2. Require non-empty array of statuses
    if (!Array.isArray(statuses) || statuses.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          'Statuses must be a non-empty array containing allowed terminal statuses: completed, failed, cancelled'
      })
    }

    // 3. Clear selected terminal statuses safely
    const result = await clearDownloadHistory({ confirm, statuses })

    return res.status(200).json({
      success: true,
      data: {
        deletedJobs: result.deletedJobs,
        physicalFilesDeleted: 0
      },
      message: 'Selected download history records cleared'
    })
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({
        success: false,
        message: error.message
      })
    }
    next(error)
  }
}
