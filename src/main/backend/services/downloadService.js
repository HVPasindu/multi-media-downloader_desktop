
import { getDatabase } from '../config/database.js'
import { spawn } from 'node:child_process'
import { getSavedDownloadPath } from './downloadSettingsService.js'
import { getDefaultDownloadPath } from './downloadPathService.js'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { Op } from 'sequelize'

export async function createDownloadJob({
  mediaItemId,
  outputFormat,
  quality = null,
  audioBitrateKbps = null
}) {
  if (!Number.isInteger(mediaItemId) || mediaItemId <= 0) {
    throw new Error('A valid Media Item ID is required')
  }

  if (!['mp4', 'mp3'].includes(outputFormat)) {
    throw new Error('Output format must be mp4 or mp3')
  }

  if (
    outputFormat === 'mp4' &&
    (typeof quality !== 'string' || !/^\d+p$/.test(quality))
  ) {
    throw new Error('A valid video quality is required')
  }

  if (
    outputFormat === 'mp3' &&
    (!Number.isInteger(audioBitrateKbps) || audioBitrateKbps <= 0)
  ) {
    throw new Error('A valid audio bitrate is required')
  }

  const { MediaItem, DownloadJob } = getDatabase().models

  const media = await MediaItem.findByPk(mediaItemId)

  if (!media) {
    throw new Error('Media Item not found')
  }

  const job = await DownloadJob.create({
    media_id: mediaItemId,
    source_type: 'link',
    output_format: outputFormat,
    quality: outputFormat === 'mp4' ? quality : null,
    audio_bitrate_kbps: outputFormat === 'mp3' ? audioBitrateKbps : null,
    status: 'queued',
    progress: 0,
    downloaded_bytes: 0
  })

  return job
}



export function buildYtDlpArgs({
  sourceUrl,
  outputFormat,
  quality = null,
  audioBitrateKbps = null,
  downloadPath
}) {
  if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) {
    throw new Error('A valid source URL is required')
  }

  if (typeof downloadPath !== 'string' || !downloadPath.trim()) {
    throw new Error('A valid download folder is required')
  }



const args = [
  '--js-runtimes', 'node',
  '--encoding', 'utf-8',
  '--no-playlist',
  '--no-simulate',
  '--progress',
  '--newline',

  // Structured download progress output
  '--progress-template',
  'download:[download] %(progress._percent_str)s APPLAN2_PROGRESS:%(progress.{status,downloaded_bytes,total_bytes,total_bytes_estimate,filename})j',

  // Structured post-processing events
  '--progress-template',
  'postprocess:APPLAN2_POSTPROCESS:%(progress.{status,postprocessor})j',

  // Keep the existing download folder and filename format
  '-P', downloadPath,
  '-o', '%(title).180B [%(id)s].%(ext)s'
]



  if (outputFormat === 'mp4') {
    if (typeof quality !== 'string' || !/^\d+p$/.test(quality)) {
      throw new Error('A valid video quality is required')
    }

    const height = Number.parseInt(quality, 10)

    args.push(
      '-f',
      `bv[height=${height}][ext=mp4]+ba[ext=m4a]/b[height=${height}][ext=mp4]`,
      '--merge-output-format',
      'mp4'
    )

  } else if (outputFormat === 'mp3') {
    if (
      !Number.isInteger(audioBitrateKbps) ||
      audioBitrateKbps <= 0
    ) {
      throw new Error('A valid audio bitrate is required')
    }

    args.push(
      '-f', 'ba',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', `${audioBitrateKbps}K`
    )

  } else {
    throw new Error('Unsupported output format')
  }

  args.push('--print', 'after_move:APPLAN2_FINAL_FILE:%(filepath)s')
  args.push(sourceUrl.trim())

  return args
}




export function runYtDlp(args, onProgress = null,onOutputLine = null) {
  if (
    !Array.isArray(args) ||
    args.length === 0 ||
    !args.every((arg) => typeof arg === 'string')
  ) {
    throw new Error('Valid yt-dlp arguments are required')
  }

  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', args, {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8'
      }
    })

    let errorOutput = ''
    let stdoutBuffer = ''
    let finalFilePath = null

    const fileMarker = 'APPLAN2_FINAL_FILE:'

    // Process one complete output line
    const handleOutputLine = (line) => {
      const cleanLine = line.trim()

      if (!cleanLine) {
        return
      }

      if (cleanLine.startsWith(fileMarker)) {
        finalFilePath = cleanLine
          .slice(fileMarker.length)
          .trim()

        console.log('[yt-dlp] Final file:', finalFilePath)
      } else {
        // Print the yt-dlp output
        console.log('[yt-dlp]', cleanLine)

        // Forward structured output lines to the caller
      if (typeof onOutputLine === 'function') {
        try {
          onOutputLine(cleanLine)
        } catch (error) {
          console.error(
            '[yt-dlp] Output line callback error:',
            error
        )
        }
      }

        // Extract download percentage from the line
        const percent = parseYtDlpProgressLine(cleanLine)

        // Send progress to the caller if a callback exists
        if (
          percent !== null &&
          typeof onProgress === 'function'
        ) {
          try {
          onProgress(percent)
          } catch (callbackError) {
            console.error(
              '[yt-dlp] Progress callback error:',
            callbackError
        )
    }
  }
}
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    // Read stdout safely, line by line
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk

      const lines = stdoutBuffer.split(/\r?\n/)

      stdoutBuffer = lines.pop() ?? ''

      for (const line of lines) {
        handleOutputLine(line)
      }
    })

    // Read errors and warnings
    child.stderr.on('data', (text) => {
      errorOutput = (errorOutput + text).slice(-2000)

      console.error('[yt-dlp]', text.trimEnd())
    })

    // Handle failure to start yt-dlp
    child.once('error', (error) => {
      reject(
        new Error(`Could not start yt-dlp: ${error.message}`)
      )
    })

    // Handle process completion
    child.once('close', (exitCode, signal) => {
      // Process any remaining output
      if (stdoutBuffer.trim()) {
        handleOutputLine(stdoutBuffer)
      }

      if (exitCode === 0) {
        resolve({
          success: true,
          exitCode,
          finalFilePath
        })

        return
      }

      const reason = signal
        ? `signal ${signal}`
        : `exit code ${exitCode}`

      reject(
        new Error(
          `yt-dlp failed (${reason}). ${errorOutput.trim()}`
        )
      )
    })
  })
}




export async function claimQueuedDownloadJob(jobId) {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  const DownloadJob = getDatabase().models.DownloadJob

  const [updatedCount] = await DownloadJob.update(
    {
      status: 'downloading',
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

  if (updatedCount !== 1) {
    return null
  }

  return await DownloadJob.findByPk(jobId)
}


export async function markDownloadJobCompleted(jobId, transaction = null) {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  const DownloadJob = getDatabase().models.DownloadJob

  const [updatedCount] = await DownloadJob.update(
  {
    status: 'completed',
    progress: 100,
    error_message: null
  },
  {
    where: {
      id: jobId,
      status: 'downloading'
    },
    transaction
  }
)

  if (updatedCount !== 1) {
    return null
  }

  return await DownloadJob.findByPk(jobId, {
  transaction
})
}



export async function markDownloadJobFailed(jobId, error, expectedStatus = 'downloading') {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  if (!['queued', 'downloading'].includes(expectedStatus)) {
  throw new Error('Invalid status for marking a job as failed')
}

  const DownloadJob = getDatabase().models.DownloadJob

  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''

  const errorMessage =
    rawMessage.trim().slice(0, 2000) ||
    'An unknown download error occurred'

  const [updatedCount] = await DownloadJob.update(
    {
      status: 'failed',
      error_message: errorMessage
    },
    {
      where: {
        id: jobId,
        status: expectedStatus
      }
    }
  )

  if (updatedCount !== 1) {
    return null
  }

  return await DownloadJob.findByPk(jobId)
}


export async function prepareDownloadJobExecution(jobId) {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  const { DownloadJob, MediaItem, AppSetting } =
    getDatabase().models

  // Get the download job
  const job = await DownloadJob.findByPk(jobId)

  if (!job) {
    throw new Error('Download Job not found')
  }

  if (job.status !== 'queued') {
    throw new Error('Only queued download jobs can start')
  }

  // Get the related media item
  const media = await MediaItem.findByPk(job.media_id)

  if (!media || !media.source_url) {
    throw new Error('Media Item or source URL not found')
  }

  // Get the selected or default download folder
  const savedPath = await getSavedDownloadPath(AppSetting)

  const downloadPath =
    savedPath || await getDefaultDownloadPath()

  // Prepare yt-dlp arguments
  const args = buildYtDlpArgs({
    sourceUrl: media.source_url,
    outputFormat: job.output_format,
    quality: job.quality,
    audioBitrateKbps: job.audio_bitrate_kbps,
    downloadPath
  })

  return {
    jobId: job.id,
    downloadPath,
    args
  }
}


export async function verifyDownloadedFile(finalFilePath) {
  // Validate the file path
  if (
    typeof finalFilePath !== 'string' ||
    !finalFilePath.trim()
  ) {
    throw new Error('A valid final file path is required')
  }

  const filePath = finalFilePath.trim()

  let fileStats

  // Read file information from the operating system
  try {
    fileStats = await stat(filePath)
  } catch (error) {
    if (
      error.code === 'ENOENT' ||
      error.code === 'ENOTDIR'
    ) {
      throw new Error('Downloaded file does not exist')
    }

    throw error
  }

  // Ensure the path points to a regular file
  if (!fileStats.isFile()) {
    throw new Error('Downloaded path is not a file')
  }

  // Reject empty files
  if (fileStats.size <= 0) {
    throw new Error('Downloaded file is empty')
  }

  return {
    exists: true,
    filePath,
    fileSizeBytes: fileStats.size
  }
}



//save download file in downloadfile table
export async function saveDownloadedFile(jobId, finalFilePath, transaction = null) {
  // 1. Validate Download Job ID
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  // 2. Get existing Sequelize models
  const { DownloadJob, DownloadFile } = getDatabase().models

  // 3. Find the related Download Job
  const job = await DownloadJob.findByPk(jobId, {
    transaction
  })

  if (!job) {
    throw new Error('Download Job not found')
  }

  // 4. Only save files for an active download
  if (job.status !== 'downloading') {
    throw new Error('Download Job must be downloading')
  }

  // 5. Verify the actual downloaded file
  const verifiedFile = await verifyDownloadedFile(finalFilePath)

  // 6. Check whether the file format matches the job
  const fileFormat = extname(verifiedFile.filePath)
    .slice(1)
    .toLowerCase()

  if (fileFormat !== job.output_format) {
    throw new Error('Downloaded file format does not match the job')
  }

  // 7. Prevent multiple file records for the same job
  const existingFile = await DownloadFile.findOne({
    where: {
      download_job_id: jobId
    },
    transaction
  })

  if (existingFile) {
    throw new Error('Download Job already has a saved file record')
  }

  // 8. Save downloaded file details in SQLite
  const downloadFile = await DownloadFile.create(
  {
    download_job_id: jobId,
    file_name: basename(verifiedFile.filePath),
    file_path: verifiedFile.filePath,
    file_format: fileFormat,
    file_size: verifiedFile.fileSizeBytes
  },
  {
    transaction
  }
)

  // 9. Return the saved Sequelize record
  return downloadFile
}





export async function executeDownloadJob(jobId) {

  // 1. Prepare download information safely
  let execution

  try {
    execution = await prepareDownloadJobExecution(jobId)
  } catch (error) {
    // Mark only a still-queued job as failed
    try {
      const failedJob = await markDownloadJobFailed(
        jobId,
        error,
        'queued'
      )

      if (!failedJob) {
        console.warn(
          '[download] Job was not queued when preparation failed:',
          jobId
        )
      }
    } catch (statusError) {
      console.error(
        '[download] Failed to save preparation error:',
        statusError
      )
    }

    throw error
  }


  // 2. Claim the queued job
  const claimedJob = await claimQueuedDownloadJob(jobId)

  if (!claimedJob) {
    throw new Error('Download Job is no longer queued')
  }

  // 3. Prepare ordered progress database updates
  let progressWriteChain = Promise.resolve()
  let lastScheduledProgress = 0
  let progressWriteError = null



  // Both MP3 and MP4 use structured download information
  const streamTracker = createMultiStreamProgressTracker()

  // Last scheduled network byte count
  let lastScheduledBytes = 0
  let latestObservedBytes = 0
  let lastBytesWriteAt = 0

  // 5. Schedule progress updates safely
  const scheduleOverallProgress = (overallPercent) => {
    if (overallPercent === null) {
      return
    }

    // Regular downloading: update every 5%
    // Processing stages: preserve 90%, 95%, 97%, 99%
    const nextProgress =
      overallPercent >= 90
        ? Math.round(overallPercent * 10) / 10
        : Math.floor(overallPercent / 5) * 5

    if (nextProgress <= lastScheduledProgress) {
      return
    }

    lastScheduledProgress = nextProgress

    progressWriteChain = progressWriteChain
      .then(async () => {
        if (progressWriteError) {
          return
        }

        await updateDownloadJobProgress(
          jobId,
          nextProgress
        )
      })
      .catch((error) => {
        progressWriteError ??= error
      })
  }


  // Schedule downloaded byte updates

const scheduleDownloadedBytes = (
  downloadedBytes,
  force = false
) => {
  // Validate byte count
  if (
    !Number.isSafeInteger(downloadedBytes) ||
    downloadedBytes < 0
  ) {
    return
  }

  // Remember the latest observed network bytes
  latestObservedBytes = Math.max(
    latestObservedBytes,
    downloadedBytes
  )

  // Never schedule a lower or duplicate value
  if (downloadedBytes <= lastScheduledBytes) {
    return
  }

  const BYTE_UPDATE_STEP = 1024 * 1024
  const MIN_UPDATE_INTERVAL_MS = 1000

  const now = Date.now()

  const reachedCheckpoint =
    downloadedBytes - lastScheduledBytes >=
    BYTE_UPDATE_STEP

  const intervalElapsed =
    now - lastBytesWriteAt >=
    MIN_UPDATE_INTERVAL_MS

  // Limit unnecessary SQLite updates
  if (
    !force &&
    (!reachedCheckpoint || !intervalElapsed)
  ) {
    return
  }

  lastScheduledBytes = downloadedBytes
  lastBytesWriteAt = now

  // Preserve the existing ordered database queue
  progressWriteChain = progressWriteChain
    .then(async () => {
      if (progressWriteError) {
        return
      }

      await updateDownloadJobDownloadedBytes(
        jobId,
        downloadedBytes
      )
    })
    .catch((error) => {
      progressWriteError ??= error
    })
}



  try {
    // 6. Execute yt-dlp with MP3 and MP4 callbacks
    const result = await runYtDlp(
      execution.args,

      // Existing MP3 percentage callback
      (streamPercent) => {
        if (claimedJob.output_format !== 'mp3') {
          return
        }

        const overallPercent =
          calculateOverallDownloadProgress(
            'mp3',
            streamPercent
          )

        scheduleOverallProgress(overallPercent)
      },

      // New MP4 structured output callback

// Structured output callback for both MP3 and MP4
(line) => {
  const snapshot = streamTracker.consumeLine(line)

  if (!snapshot) {
    return
  }

  // Sum downloaded network bytes from tracked streams
  const totalDownloadedBytes = snapshot.streams.reduce(
    (total, stream) => {
      return total + stream.downloadedBytes
    },
    0
  )

  const allStreamsFinished =
    snapshot.streams.length > 0 &&
    snapshot.streams.every(
      (stream) => stream.status === 'finished'
    )

  // Save downloaded bytes for both formats
  scheduleDownloadedBytes(
    totalDownloadedBytes,
    allStreamsFinished
  )

  // MP4 needs separate overall progress calculation
  if (claimedJob.output_format === 'mp4') {
    const overallPercent =
      calculateMp4OverallProgress(snapshot)

    scheduleOverallProgress(overallPercent)
  }
}

    )

    // Flush any remaining downloaded bytes
scheduleDownloadedBytes(
  latestObservedBytes,
  true
)

// Wait until all progress and byte writes finish
await progressWriteChain

    if (progressWriteError) {
      throw progressWriteError
    }

    // 8. Verify final path
    if (!result.finalFilePath) {
      throw new Error(
        'yt-dlp did not return a final file path'
      )
    }


    // 9. Save file record and complete job atomically
    const { savedFile, completedJob } =
      await getDatabase().transaction(
        async (transaction) => {

          // Save the downloaded file record
          const savedFile = await saveDownloadedFile(
            jobId,
            result.finalFilePath,
            transaction
          )

          // Complete the job within the same transaction
          const completedJob = await markDownloadJobCompleted(
            jobId,
            transaction
          )

          if (!completedJob) {
            throw new Error(
              'Could not mark Download Job as completed'
            )
          }

          return {
            savedFile,
            completedJob
          }
        }
      )


    return {
      job: completedJob,
      file: savedFile
    }

  } catch (error) {
    // Complete any pending progress database writes
    await progressWriteChain

    try {
      const failedJob = await markDownloadJobFailed(
        jobId,
        error
      )

      if (!failedJob) {
        console.error(
          'Could not mark Download Job as failed:',
          jobId
        )
      }

    } catch (statusError) {
      console.error(
        'Could not save failed job status:',
        statusError
      )
    }

    throw error
  }
}




export async function getDownloadJobDetails(jobId) {
  // 1. Validate Download Job ID
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  // 2. Get Sequelize models
  const { DownloadJob, DownloadFile } =
    getDatabase().models

  // 3. Find the Download Job
  const job = await DownloadJob.findByPk(jobId)

  if (!job) {
    return null
  }

  // 4. Find the related downloaded file
  const file = await DownloadFile.findOne({
    where: {
      download_job_id: jobId
    }
  })

  // 5. Return both records
  return {
    job: job.toJSON(),
    file: file ? file.toJSON() : null
  }
}





export async function listDownloadJobs() {
  // 1. Get existing Sequelize models
  const { DownloadJob, DownloadFile, MediaItem } =
    getDatabase().models

  // 2. Get latest 50 download jobs
  const jobs = await DownloadJob.findAll({
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC']
    ],
    limit: 50
  })

  // 3. Return empty history if no jobs exist
  if (jobs.length === 0) {
    return []
  }

  // 4. Collect Job IDs and unique Media IDs
  const jobIds = jobs.map((job) => job.id)

  const mediaIds = [
    ...new Set(jobs.map((job) => job.media_id))
  ]

  // 5. Get related files and media records
  const files = await DownloadFile.findAll({
    where: {
      download_job_id: jobIds
    }
  })

  const mediaItems = await MediaItem.findAll({
    where: {
      id: mediaIds
    }
  })

  // 6. Build lookup Maps
  const fileByJobId = new Map(
    files.map((file) => [
      file.download_job_id,
      file.toJSON()
    ])
  )

  const mediaById = new Map(
    mediaItems.map((media) => [
      media.id,
      media.toJSON()
    ])
  )

  // 7. Combine Job + File + Media
  return jobs.map((job) => ({
    ...job.toJSON(),
    file: fileByJobId.get(job.id) ?? null,
    media: mediaById.get(job.media_id) ?? null
  }))
}



//get precentage
export function parseYtDlpProgressLine(line) {
  // 1. Validate the input
  if (typeof line !== 'string') {
    return null
  }

  // 2. Remove unnecessary spaces
  const cleanLine = line.trim()

  // 3. Find yt-dlp download percentage
  const match = cleanLine.match(
    /^\[download\]\s+(\d+(?:\.\d+)?)%/
  )

  // 4. Return null if no percentage was found
  if (!match) {
    return null
  }

  // 5. Convert the percentage into a number
  const percent = Number(match[1])

  if (!Number.isFinite(percent)) {
    return null
  }

  // 6. Return the extracted percentage
  return percent
}




export async function updateDownloadJobProgress(
  jobId,
  overallPercent
) {
  // 1. Validate the Download Job ID
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  // 2. Validate the overall progress percentage
  if (
    !Number.isFinite(overallPercent) ||
    overallPercent < 0 ||
    overallPercent > 100
  ) {
    throw new Error('A valid progress percentage is required')
  }

  // 3. Keep progress below 100 until job completion
  const safePercent = Math.min(
    99,
    Math.round(overallPercent * 10) / 10
  )

  // 4. Get the DownloadJob model
  const DownloadJob = getDatabase().models.DownloadJob

  // 5. Update only an active job with lower progress
  const [updatedCount] = await DownloadJob.update(
    {
      progress: safePercent
    },
    {
      where: {
        id: jobId,
        status: 'downloading',
        progress: {
          [Op.lt]: safePercent
        }
      }
    }
  )

  // 6. Return null if nothing was updated
  if (updatedCount !== 1) {
    return null
  }



  // 7. Return the updated Download Job
  return await DownloadJob.findByPk(jobId)
}



export async function updateDownloadJobDownloadedBytes(
  jobId,
  downloadedBytes
) {
  // Validate incoming values
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  if (
    !Number.isSafeInteger(downloadedBytes) ||
    downloadedBytes < 0
  ) {
    throw new Error('Valid downloaded bytes are required')
  }

  const DownloadJob = getDatabase().models.DownloadJob

  // Update only an active job with higher byte count
  const [updatedCount] = await DownloadJob.update(
    {
      downloaded_bytes: downloadedBytes
    },
    {
      where: {
        id: jobId,
        status: 'downloading',
        downloaded_bytes: {
          [Op.lt]: downloadedBytes
        }
      }
    }
  )

  if (updatedCount !== 1) {
    return null
  }

  return await DownloadJob.findByPk(jobId)
}



export function calculateOverallDownloadProgress(
  outputFormat,
  streamPercent
) {
  // 1. Validate output format
  if (!['mp3', 'mp4'].includes(outputFormat)) {
    throw new Error('Unsupported output format')
  }

  // 2. Validate stream percentage
  if (
    !Number.isFinite(streamPercent) ||
    streamPercent < 0 ||
    streamPercent > 100
  ) {
    return null
  }

  // 3. MP4 needs separate multi-stream progress handling
  if (outputFormat === 'mp4') {
    return null
  }

  // 4. Map MP3 audio download from 0-100% to 0-90%
  const overallPercent = streamPercent * 0.9

  // 5. Round to one decimal place
  return Math.round(overallPercent * 10) / 10
}



export function createMultiStreamProgressTracker() {
  // 1. Store each download stream separately
  const streams = new Map()

  // 2. Store the latest postprocessing event
  let postprocess = null

  // 3. Return a safe copy of current progress information
  const getSnapshot = () => ({
    streams: Array.from(streams.values(), (stream) => ({
      ...stream
    })),
    postprocess: postprocess ? { ...postprocess } : null
  })

  return {
    consumeLine(line) {
      // 4. Validate input
      if (typeof line !== 'string') {
        return null
      }

      const downloadMarker = 'APPLAN2_PROGRESS:'
      const postprocessMarker = 'APPLAN2_POSTPROCESS:'

      const downloadIndex = line.indexOf(downloadMarker)
      const postprocessIndex = line.indexOf(postprocessMarker)

      // 5. Handle a structured download event
      if (downloadIndex !== -1) {
        let data

        try {
          data = JSON.parse(
            line.slice(
              downloadIndex + downloadMarker.length
            ).trim()
          )
        } catch {
          return null
        }

        // Each stream needs a valid filename
        if (
          !data ||
          typeof data.filename !== 'string' ||
          !data.filename
        ) {
          return null
        }

        // Find previous progress for this stream
        const previous = streams.get(data.filename)

        // Extract downloaded bytes
        const downloadedBytes =
          Number.isFinite(data.downloaded_bytes) &&
          data.downloaded_bytes >= 0
            ? data.downloaded_bytes
            : (previous?.downloadedBytes ?? 0)

        // Extract total bytes when available
        const reportedTotal =
          data.total_bytes ?? data.total_bytes_estimate

        const totalBytes =
          Number.isFinite(reportedTotal) &&
          reportedTotal >= 0
            ? reportedTotal
            : (previous?.totalBytes ?? null)

        // Reuse the existing percentage parser
        const percent = parseYtDlpProgressLine(line)

        // Update only this stream's information
        streams.set(data.filename, {
          filename: data.filename,
          status:
            typeof data.status === 'string'
              ? data.status
              : (previous?.status ?? 'unknown'),
          downloadedBytes,
          totalBytes,
          percent: percent ?? previous?.percent ?? null
        })

        return getSnapshot()
      }

      // 6. Handle a structured postprocessing event
      if (postprocessIndex !== -1) {
        let data

        try {
          data = JSON.parse(
            line.slice(
              postprocessIndex + postprocessMarker.length
            ).trim()
          )
        } catch {
          return null
        }

        if (
          !data ||
          typeof data.status !== 'string'
        ) {
          return null
        }

        postprocess = {
          status: data.status,
          postprocessor:
            typeof data.postprocessor === 'string'
              ? data.postprocessor
              : null
        }

        return getSnapshot()
      }

      // 7. Ignore unrelated yt-dlp output
      return null
    },

    // 8. Read current tracker state whenever needed
    getSnapshot
  }
}


//MP4 Overall Download Progress Calculator
export function calculateMp4OverallProgress(snapshot) {
  // 1. Validate the tracker snapshot
  if (
    !snapshot ||
    !Array.isArray(snapshot.streams)
  ) {
    return null
  }

  const streams = snapshot.streams

  // 2. No download stream information yet
  if (streams.length === 0) {
    return null
  }

  // 3. This version supports up to two streams
  if (streams.length > 2) {
    return null
  }

  // 4. Read a stream's progress safely
  const getStreamPercent = (stream) => {
    if (!stream || typeof stream !== 'object') {
      return null
    }

    // A finished stream has reached 100%
    if (stream.status === 'finished') {
      return 100
    }

    const percent = stream.percent

    if (
      !Number.isFinite(percent) ||
      percent < 0 ||
      percent > 100
    ) {
      return null
    }

    return percent
  }

  // 5. Read progress for the two download stages
  const firstStreamPercent = getStreamPercent(
    streams[0]
  )

  const secondStreamPercent =
    streams.length === 2
      ? getStreamPercent(streams[1])
      : 0

  if (
    firstStreamPercent === null ||
    secondStreamPercent === null
  ) {
    return null
  }

  // 6. Allocate 45% to each download stream
  let overallPercent =
    firstStreamPercent * 0.45 +
    secondStreamPercent * 0.45

  // 7. Reserve the remaining progress for processing
  const postprocess = snapshot.postprocess

  if (
  ['Merger', 'FFmpegMerger'].includes(
    postprocess?.postprocessor
  )
) {
    if (postprocess.status === 'started') {
      overallPercent = Math.max(overallPercent, 90)
    }

    if (postprocess.status === 'finished') {
      overallPercent = Math.max(overallPercent, 95)
    }
  }

  // 8. Track final file moving
  if (postprocess?.postprocessor === 'MoveFiles') {
    if (postprocess.status === 'started') {
      overallPercent = Math.max(overallPercent, 97)
    }

    if (postprocess.status === 'finished') {
      overallPercent = Math.max(overallPercent, 99)
    }
  }

  // 9. Keep 100% reserved for completed jobs
  return Math.min(
    99,
    Math.round(overallPercent * 10) / 10
  )
}
