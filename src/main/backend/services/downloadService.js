
import { getDatabase } from '../config/database.js'
import { spawn } from 'node:child_process'

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

  args.push('--print', 'after_move:filepath')
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

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    // Read normal yt-dlp output
    child.stdout.on('data', (text) => {
      console.log('[yt-dlp]', text.trimEnd())
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
      if (exitCode === 0) {
        resolve({
          success: true,
          exitCode
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
