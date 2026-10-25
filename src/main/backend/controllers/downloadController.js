
import { createDownloadJob } from '../services/downloadService.js'

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
      (!Number.isInteger(audioBitrateKbps) || audioBitrateKbps <= 0)

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

    // Create the download job in SQLite
    const job = await createDownloadJob({
      mediaItemId,
      outputFormat,
      quality,
      audioBitrateKbps
    })

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
