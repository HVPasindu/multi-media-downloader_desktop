
import {
  createDownloadJob,
  executeDownloadJob,
  getDownloadJobDetails,
  listDownloadJobs
} from '../services/downloadService.js'


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


  void executeDownloadJob(job.id).catch((error) => {
    console.error(
      `Download Job ${job.id} execution failed:`,
      error
    )
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
