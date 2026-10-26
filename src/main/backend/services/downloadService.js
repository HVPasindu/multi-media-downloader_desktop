
import { getDatabase } from '../config/database.js'
import { spawn } from 'node:child_process'
import { getSavedDownloadPath } from './downloadSettingsService.js'
import { getDefaultDownloadPath } from './downloadPathService.js'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

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
    '--no-playlist',
    '--no-simulate',
    '--progress',
    '--newline',
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




export function runYtDlp(args) {
  if (
    !Array.isArray(args) ||
    args.length === 0 ||
    !args.every((arg) => typeof arg === 'string')
  ) {
    throw new Error('Valid yt-dlp arguments are required')
  }

  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', args, {
      windowsHide: true
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
        console.log('[yt-dlp]', cleanLine)
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


export async function markDownloadJobCompleted(jobId) {
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
      }
    }
  )

  if (updatedCount !== 1) {
    return null
  }

  return await DownloadJob.findByPk(jobId)
}



export async function markDownloadJobFailed(jobId, error) {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
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
        status: 'downloading'
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
export async function saveDownloadedFile(jobId, finalFilePath) {
  // 1. Validate Download Job ID
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  // 2. Get existing Sequelize models
  const { DownloadJob, DownloadFile } = getDatabase().models

  // 3. Find the related Download Job
  const job = await DownloadJob.findByPk(jobId)

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
    }
  })

  if (existingFile) {
    throw new Error('Download Job already has a saved file record')
  }

  // 8. Save downloaded file details in SQLite
  const downloadFile = await DownloadFile.create({
    download_job_id: jobId,
    file_name: basename(verifiedFile.filePath),
    file_path: verifiedFile.filePath,
    file_format: fileFormat,
    file_size: verifiedFile.fileSizeBytes
  })

  // 9. Return the saved Sequelize record
  return downloadFile
}



export async function executeDownloadJob(jobId) {
  // 1. Prepare download information
  const execution = await prepareDownloadJobExecution(jobId)

  // 2. Claim the queued job
  const claimedJob = await claimQueuedDownloadJob(jobId)

  if (!claimedJob) {
    throw new Error('Download Job is no longer queued')
  }

  try {
    // 3. Execute yt-dlp and get the final file path
    const result = await runYtDlp(execution.args)

    if (!result.finalFilePath) {
      throw new Error(
        'yt-dlp did not return a final file path'
      )
    }

    // 4. Verify the file and save details in SQLite
    const savedFile = await saveDownloadedFile(
      jobId,
      result.finalFilePath
    )

    // 5. Mark the job as completed
    const completedJob = await markDownloadJobCompleted(jobId)

    if (!completedJob) {
      throw new Error(
        'Could not mark Download Job as completed'
      )
    }

    // 6. Return the completed job and saved file
    return {
      job: completedJob,
      file: savedFile
    }

  } catch (error) {
    // 7. Mark the claimed job as failed
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

    // 8. Pass the original error to the caller
    throw error
  }
}
