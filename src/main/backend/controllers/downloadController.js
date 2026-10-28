
import {
  createDownloadJob,
  getDownloadJobDetails,
  listDownloadJobs,
  SUPPORTED_MP3_BITRATES
} from '../services/downloadService.js'

import { enqueueDownloadJob } from '../services/downloadQueueService.js'

import { getDatabase } from '../config/database.js'
import { analyzeMedia } from '../services/mediaAnalyzerService.js'

export async function createDownloadJobController(req, res, next) {
  try {
    const {
      mediaItemId,
      outputFormat,
      quality,
      audioBitrateKbps
    } = req.body ?? {}

    // Validate the incoming request
    const invalidMediaId =
      !Number.isInteger(mediaItemId) || mediaItemId <= 0

    const invalidFormat =
      !['mp4', 'mp3'].includes(outputFormat)

    const invalidQuality =
      outputFormat === 'mp4' &&
      (typeof quality !== 'string' || !/^\d+p$/.test(quality))

    const invalidBitrate =
      outputFormat === 'mp3' &&
      !SUPPORTED_MP3_BITRATES.includes(audioBitrateKbps)

    if (
      invalidMediaId ||
      invalidFormat ||
      invalidQuality ||
      invalidBitrate
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid download job details'
      })
    }


    // Validate the requested MP4 quality before creating a job
    if (outputFormat === 'mp4') {
      const MediaItem = getDatabase().models.MediaItem

      const media = await MediaItem.findByPk(mediaItemId)

      if (!media) {
        return res.status(404).json({
          success: false,
          message: 'Media Item not found'
        })
      }

      if (
        typeof media.source_url !== 'string' ||
        !media.source_url.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: 'Media source URL is missing'
        })
      }

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


    // Create the download job in SQLite
    const job = await createDownloadJob({
      mediaItemId,
      outputFormat,
      quality,
      audioBitrateKbps
    })

    // Add the new download job to the managed queue
    enqueueDownloadJob(job.id)

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
    if (
      typeof rawJobId !== 'string' ||
      !/^[1-9]\d*$/.test(rawJobId)
    ) {
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

    // 3. Get job and file details from SQLite
    const details = await getDownloadJobDetails(jobId)

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



export async function listDownloadJobsController(req, res, next) {
  try {
    // 1. Get the latest download jobs from SQLite
    const jobs = await listDownloadJobs()

    // 2. Return the download history
    return res.status(200).json({
      success: true,
      data: jobs
    })

  } catch (error) {
    // 3. Forward unexpected errors to Express
    next(error)
  }
}
