import { getDatabase } from '../config/database.js'
import { spawn, execFile } from 'node:child_process'
import { getSavedDownloadPath } from './downloadSettingsService.js'
import { getDefaultDownloadPath, resolveValidatedDownloadPath } from './downloadPathService.js'
import { stat, lstat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { Op, Transaction } from 'sequelize'
import { analyzeMedia } from './mediaAnalyzerService.js'
import { validateMediaUrl } from './mediaUrlSecurityService.js'
import { promisify } from 'node:util'
import {
  DownloadError,
  DOWNLOAD_ERROR_CODES,
  DEFAULT_ERROR_MESSAGES,
  classifyDownloadError,
  formatDownloadErrorMessage,
  isTransientNetworkError
} from './downloadErrorService.js'
import {
  prepareJobTemporaryWorkspace,
  cleanupJobTemporaryFiles,
  verifyJobPartialDownload,
  isPartialDownloadResumable
} from './downloadCleanupService.js'
import {
  validateDownloadFolder,
  verifyDownloadFolderWritable,
  checkDownloadDiskSpace,
  assertNoJobOutputFileConflict,
  assertPathInsideDirectory,
  assertRealPathInsideDirectory,
  removeJobOwnedOutputFile
} from './downloadFileSafetyService.js'
import {
  resolveYtDlpPath,
  resolveFFprobePath,
  resolveFFmpegLocationDirectory,
  resolveJavaScriptRuntimeOption
} from './executablePathService.js'
import { scheduleJobRetry, clearJobRetryState } from './networkRecoveryService.js'
import { withJobOperationLock } from './downloadJobOperationLock.js'
import {
  gracefullyInterruptProcess,
  terminateProcessTree,
  resolveCtrlBreakHelperPath
} from './processInterruptionService.js'

export {
  DownloadError,
  DOWNLOAD_ERROR_CODES,
  DEFAULT_ERROR_MESSAGES,
  classifyDownloadError,
  formatDownloadErrorMessage,
  validateDownloadFolder,
  verifyDownloadFolderWritable,
  checkDownloadDiskSpace,
  assertNoJobOutputFileConflict,
  assertPathInsideDirectory,
  assertRealPathInsideDirectory,
  removeJobOwnedOutputFile,
  resolveMp4FormatSelector
}

const execFileAsync = promisify(execFile)

// Supported MP3 output bitrates (kbps)
export const SUPPORTED_MP3_BITRATES = Object.freeze([128, 192, 320])

// Track yt-dlp processes for actively running jobs
const activeDownloadProcesses = new Map()

// Helper to detect transient SQLite lock/busy errors across Sequelize and sqlite3 driver
export function isSqliteBusyError(error) {
  if (!error) return false
  const message = String(error?.message || '').toLowerCase()
  const name = String(error?.name || '').toLowerCase()
  const originalMessage = String(
    error?.original?.message || error?.parent?.message || ''
  ).toLowerCase()
  const code = String(
    error?.original?.code || error?.parent?.code || error?.code || ''
  ).toUpperCase()

  return (
    name.includes('timeout') ||
    code === 'SQLITE_BUSY' ||
    code === 'SQLITE_LOCKED' ||
    message.includes('sqlite_busy') ||
    message.includes('database is locked') ||
    message.includes('database locked') ||
    originalMessage.includes('sqlite_busy') ||
    originalMessage.includes('database is locked') ||
    originalMessage.includes('database locked')
  )
}

// In-memory queue to serialize download completion write transactions
let completionWriteQueue = Promise.resolve()

export function withCompletionWriteLock(task) {
  const next = completionWriteQueue.then(
    () => task(),
    () => task()
  )
  completionWriteQueue = next.catch(() => {})
  return next
}

// Custom error to distinguish intentional cancellation from unexpected errors
export class DownloadCancelledError extends Error {
  constructor(message = 'Download was cancelled') {
    super(message)
    this.name = 'DownloadCancelledError'
  }
}

// Step 09.G - Custom error to distinguish application shutdown from user cancellation
export class DownloadInterruptedError extends Error {
  constructor(message = 'Download was interrupted by application shutdown') {
    super(message)
    this.name = 'DownloadInterruptedError'
  }
}

// Custom error to distinguish manual user pause from unexpected interruption or cancellation
export class DownloadPausedError extends Error {
  constructor(message = 'Download was paused by user') {
    super(message)
    this.name = 'DownloadPausedError'
  }
}

// Step 09.F - Detect yt-dlp resume/range incompatibility (HTTP 416 / Requested Range Not Satisfiable)
export function isResumeIncompatibilityError(error) {
  if (!error) return false
  const raw = String(error?.cause?.stderr || error?.message || error?.stderr || '').toLowerCase()

  return (
    raw.includes('416') ||
    raw.includes('range not satisfiable') ||
    raw.includes('requested range not satisfiable')
  )
}

// Step 09.G - Gracefully interrupt a download process before forceful termination
export async function gracefullyInterruptDownloadProcess(childProcessOrEntry, timeoutMs = 3000) {
  const processEntry = childProcessOrEntry?.childProcess
    ? childProcessOrEntry
    : { childProcess: childProcessOrEntry, closed: false }

  return await gracefullyInterruptProcess(processEntry, timeoutMs)
}

// Step 09.G - Graceful shutdown of all active download processes
export async function shutdownActiveDownloads({ timeoutMs = 5000 } = {}) {
  const jobEntries = Array.from(activeDownloadProcesses.entries())
  if (jobEntries.length === 0) {
    return
  }

  console.log(`[download] Shutting down ${jobEntries.length} active download process(es)...`)

  for (const [, processEntry] of jobEntries) {
    processEntry.shutdownRequested = true
  }

  await Promise.allSettled(
    jobEntries.map(async ([jobId, processEntry]) => {
      try {
        await gracefullyInterruptDownloadProcess(processEntry, timeoutMs)
      } catch (err) {
        console.error(`[download] Error interrupting job ${jobId} during shutdown:`, err)
      }
    })
  )

  try {
    await withCompletionWriteLock(async () => {})
  } catch {
    // Ignore
  }
}

// Safely terminate process tree (including yt-dlp and ffmpeg subprocesses)
export async function terminateDownloadProcessTree(childProcessOrEntry, timeoutMs = 3000) {
  const processEntry = childProcessOrEntry?.childProcess
    ? childProcessOrEntry
    : { childProcess: childProcessOrEntry, closed: false }

  return await terminateProcessTree(processEntry, timeoutMs)
}

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

  if (outputFormat === 'mp4' && (typeof quality !== 'string' || !/^\d+p$/.test(quality))) {
    throw new Error('A valid video quality is required')
  }

  if (outputFormat === 'mp3' && !SUPPORTED_MP3_BITRATES.includes(audioBitrateKbps)) {
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

export function buildJobOutputTemplate({
  jobId,
  outputFormat,
  quality = null,
  audioBitrateKbps = null
}) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  if (!['mp4', 'mp3'].includes(outputFormat)) {
    throw new Error('Output format must be mp4 or mp3')
  }

  let variant = ''

  if (outputFormat === 'mp3') {
    if (!SUPPORTED_MP3_BITRATES.includes(audioBitrateKbps)) {
      throw new Error('A valid audio bitrate is required')
    }
    variant = `${audioBitrateKbps}kbps`
  } else if (outputFormat === 'mp4') {
    if (typeof quality !== 'string' || !/^\d+p$/.test(quality)) {
      throw new Error('A valid video quality is required')
    }
    variant = quality
  }

  return `%(title).150B [%(id)s] [${variant}] [job-${jobId}].%(ext)s`
}

export function buildYtDlpArgs({
  sourceUrl,
  outputFormat,
  quality = null,
  audioBitrateKbps = null,
  downloadPath,
  mp4FormatSelector = null,
  jobId = null,
  tempPath = null,
  jsRuntimeOption = 'node',
  ffmpegLocation = null
}) {
  if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) {
    throw new Error('A valid source URL is required')
  }

  if (typeof downloadPath !== 'string' || !downloadPath.trim()) {
    throw new Error('A valid download folder is required')
  }

  // Use unique job output template if a valid Job ID is provided, otherwise fall back to legacy template
  const outputTemplate =
    Number.isSafeInteger(jobId) && jobId > 0
      ? buildJobOutputTemplate({
          jobId,
          outputFormat,
          quality,
          audioBitrateKbps
        })
      : '%(title).180B [%(id)s].%(ext)s'

  const args = [
    '--js-runtimes',
    jsRuntimeOption || 'node',
    '--encoding',
    'utf-8',
    '--no-playlist',
    '--no-simulate',
    '--progress',
    '--newline',
    '--continue',

    // Structured download progress output
    '--progress-template',
    'download:[download] %(progress._percent_str)s APPLAN2_PROGRESS:%(progress.{status,downloaded_bytes,total_bytes,total_bytes_estimate,filename})j',

    // Structured post-processing events
    '--progress-template',
    'postprocess:APPLAN2_POSTPROCESS:%(progress.{status,postprocessor})j',

    // Keep the existing download folder and filename format
    '-P',
    downloadPath
  ]

  // Step 04.43 - Configure packaged or custom FFmpeg binary location for yt-dlp post-processing
  if (typeof ffmpegLocation === 'string' && ffmpegLocation.trim()) {
    args.push('--ffmpeg-location', ffmpegLocation.trim())
  }

  // Route temporary fragments and intermediate files to the job-owned temporary workspace
  if (typeof tempPath === 'string' && tempPath.trim()) {
    args.push('-P', `temp:${tempPath.trim()}`)
  }

  args.push('-o', outputTemplate)

  if (outputFormat === 'mp4') {
    if (typeof quality !== 'string' || !/^\d+p$/.test(quality)) {
      throw new Error('A valid video quality is required')
    }

    const height = Number.parseInt(quality, 10)

    // Prefer the exact MP4 source formats selected
    // from the media analyzer.
    const formatSelector =
      typeof mp4FormatSelector === 'string' && mp4FormatSelector.trim()
        ? mp4FormatSelector
        : `bv[height=${height}][ext=mp4]+ba[ext=m4a]/b[height=${height}][ext=mp4]`

    args.push('-f', formatSelector, '--merge-output-format', 'mp4')
  } else if (outputFormat === 'mp3') {
    if (!SUPPORTED_MP3_BITRATES.includes(audioBitrateKbps)) {
      throw new Error('A valid audio bitrate is required')
    }

    args.push('-f', 'ba', '-x', '--audio-format', 'mp3', '--audio-quality', `${audioBitrateKbps}K`)
  } else {
    throw new Error('Unsupported output format')
  }

  args.push('--print', 'after_move:APPLAN2_FINAL_FILE:%(filepath)s')
  args.push(sourceUrl.trim())

  return args
}

export function runYtDlp(args, onProgress = null, onOutputLine = null, options = {}) {
  if (!Array.isArray(args) || args.length === 0 || !args.every((arg) => typeof arg === 'string')) {
    throw new Error('Valid yt-dlp arguments are required')
  }

  return new Promise((resolve, reject) => {
    // Step 04.43 - Dynamically resolve packaged or dev yt-dlp executable path
    Promise.resolve(options?.executablePath || resolveYtDlpPath())
      .then((ytDlpExecutable) => {
        const spawnOptions = {
          windowsHide: true,
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8'
          }
        }

        let spawnExe = ytDlpExecutable
        let spawnArgs = args

        // On Windows, use the native send-ctrl-break launcher helper which creates the yt-dlp
        // process with hidden AllocConsole and CREATE_NEW_PROCESS_GROUP. This grants yt-dlp
        // its own isolated console session, prevents signal leakage to parent/terminal,
        // and enables AttachConsole + GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT) to target
        // this process group safely and reliably.
        if (process.platform === 'win32') {
          const helperPath = resolveCtrlBreakHelperPath()
          if (!helperPath) {
            throw new DownloadError(
              DOWNLOAD_ERROR_CODES.UNKNOWN_ERROR,
              'Windows pause helper executable (send-ctrl-break.exe) was not found. Please verify application installation.',
              { details: { platform: 'win32' } }
            )
          }
          spawnExe = helperPath
          spawnArgs = ['spawn', ytDlpExecutable, ...args]
        }

        const child = spawn(spawnExe, spawnArgs, spawnOptions)

        let closeResolver
        const closePromise = new Promise((resolve) => {
          closeResolver = resolve
        })

        let pausePersistedResolver
        const pausePersistedPromise = new Promise((resolve) => {
          pausePersistedResolver = resolve
        })

        let cancelPersistedResolver
        const cancelPersistedPromise = new Promise((resolve) => {
          cancelPersistedResolver = resolve
        })

        let readyResolver
        const readyPromise = new Promise((resolve) => {
          readyResolver = resolve
        })
        if (process.platform !== 'win32') {
          readyResolver(true)
        }

        const processEntry = {
          jobId: options?.jobId,
          managedByJobExecutor: Boolean(options?.managedByJobExecutor),
          childProcess: child,
          actualPid: null,
          pgid: null,
          cancelRequested: false,
          pauseRequested: false,
          pausePromise: null,
          shutdownRequested: false,
          // 'downloading' | 'finalizing' — set to 'finalizing' when all streams finish
          // so the Pause endpoint can return 'already_finishing' instead of interrupting
          phase: 'downloading',
          closed: false,
          exitCode: null,
          signal: null,
          closePromise,
          pausePersistedPromise,
          cancelPersistedPromise,
          readyPromise,
          markClosed(code, sig) {
            if (this.closed) return
            this.closed = true
            this.exitCode = code
            this.signal = sig
            closeResolver({ code, signal: sig })
          },
          markPausePersisted(success, data) {
            pausePersistedResolver({ success, data })
          },
          markCancelPersisted(success, data) {
            cancelPersistedResolver({ success, data })
          }
        }

        if (options?.jobId) {
          const existingEntry = activeDownloadProcesses.get(options.jobId)
          if (existingEntry) {
            processEntry.executionToken = existingEntry.executionToken
            processEntry.cancelRequested = Boolean(existingEntry.cancelRequested)
            processEntry.pauseRequested = Boolean(existingEntry.pauseRequested)
            if (existingEntry.cancelPersistedPromise) {
              processEntry.cancelPersistedPromise = existingEntry.cancelPersistedPromise
              processEntry.markCancelPersisted = existingEntry.markCancelPersisted
            }
            if (existingEntry.pausePersistedPromise) {
              processEntry.pausePersistedPromise = existingEntry.pausePersistedPromise
              processEntry.markPausePersisted = existingEntry.markPausePersisted
            }
          }
          activeDownloadProcesses.set(options.jobId, processEntry)
        }

        let isSettled = false

        const settleReject = (err) => {
          if (isSettled) return
          isSettled = true

          reject(err)
        }

        if (processEntry.cancelRequested) {
          terminateDownloadProcessTree(processEntry, 2000).catch(() => {})
          settleReject(new DownloadCancelledError('Download was cancelled'))
          return
        }

        const settleResolve = (val) => {
          if (isSettled) return
          isSettled = true

          resolve(val)
        }

        let errorOutput = ''
        let stdoutBuffer = ''
        let finalFilePath = null

        const fileMarker = 'APPLAN2_FINAL_FILE:'

        const pidMarker = 'APPLAN2_PID:'
        const pgidMarker = 'APPLAN2_PGID:'

        // Process one complete output line
        const handleOutputLine = (line) => {
          const cleanLine = line.trim()

          if (!cleanLine) {
            return
          }

          if (cleanLine.startsWith(pidMarker)) {
            const parsedPid = parseInt(cleanLine.slice(pidMarker.length).trim(), 10)
            if (Number.isSafeInteger(parsedPid) && parsedPid > 0) {
              processEntry.actualPid = parsedPid
              if (!processEntry.pgid) {
                processEntry.pgid = parsedPid
              }
              readyResolver(true)
            }
            return
          }

          if (cleanLine.startsWith(pgidMarker)) {
            const parsedPgid = parseInt(cleanLine.slice(pgidMarker.length).trim(), 10)
            if (Number.isSafeInteger(parsedPgid) && parsedPgid > 0) {
              processEntry.pgid = parsedPgid
              readyResolver(true)
            }
            return
          }

          if (
            cleanLine.includes('APPLAN2_POSTPROCESS:{"status": "started"}') ||
            cleanLine.includes('[Merger]') ||
            cleanLine.includes('[ffmpeg]') ||
            cleanLine.includes('[FixupM4a]')
          ) {
            processEntry.phase = 'finalizing'
          }

          if (cleanLine.startsWith(fileMarker)) {
            finalFilePath = cleanLine.slice(fileMarker.length).trim()

            console.log('[yt-dlp] Final file:', finalFilePath)
          } else {
            // Print the yt-dlp output
            console.log('[yt-dlp]', cleanLine)

            // Forward structured output lines to the caller
            if (typeof onOutputLine === 'function') {
              try {
                onOutputLine(cleanLine)
              } catch (error) {
                console.error('[yt-dlp] Output line callback error:', error)
              }
            }

            // Extract download percentage from the line
            const percent = parseYtDlpProgressLine(cleanLine)

            // Send progress to the caller if a callback exists
            if (percent !== null && typeof onProgress === 'function') {
              try {
                onProgress(percent)
              } catch (callbackError) {
                console.error('[yt-dlp] Progress callback error:', callbackError)
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
          readyResolver(false)
          processEntry.markClosed(1, 'ERROR')

          if (processEntry.shutdownRequested) {
            settleReject(
              new DownloadInterruptedError('Download was interrupted by application shutdown')
            )
            return
          }

          if (processEntry.pauseRequested) {
            settleReject(new DownloadPausedError('Download was paused by user'))
            return
          }

          if (processEntry.cancelRequested) {
            settleReject(new DownloadCancelledError('Download was cancelled'))
            return
          }

          const classified = classifyDownloadError(error, { target: 'yt-dlp' })
          settleReject(new DownloadError(classified.code, classified.message, { cause: error }))
        })

        // Handle process completion
        child.once('close', (exitCode, signal) => {
          readyResolver(false)
          processEntry.markClosed(exitCode, signal)

          // Process any remaining output FIRST (before checking exit status)
          if (stdoutBuffer.trim()) {
            handleOutputLine(stdoutBuffer)
          }

          if (processEntry.shutdownRequested) {
            settleReject(
              new DownloadInterruptedError('Download was interrupted by application shutdown')
            )
            return
          }

          // SUCCESSFUL COMPLETION takes absolute precedence over late pause/cancel requests.
          // If yt-dlp exits 0, the download completed — a Pause or Cancel that arrived
          // milliseconds before the process closed must not convert a completed job to 'failed'.
          if (exitCode === 0) {
            settleResolve({
              success: true,
              exitCode,
              finalFilePath
            })
            return
          }

          // Only after ruling out successful completion, honor pause/cancel signals
          if (processEntry.pauseRequested) {
            settleReject(new DownloadPausedError('Download was paused by user'))
            return
          }

          if (processEntry.cancelRequested) {
            settleReject(new DownloadCancelledError('Download was cancelled'))
            return
          }

          const reason = signal ? `signal ${signal}` : `exit code ${exitCode}`

          const classified = classifyDownloadError(new Error(`yt-dlp failed (${reason})`), {
            target: 'yt-dlp',
            stderr: errorOutput
          })

          settleReject(
            new DownloadError(classified.code, classified.message, {
              cause: {
                exitCode,
                signal,
                stderr: errorOutput.trim()
              }
            })
          )
        })
      })
      .catch((pathError) => {
        reject(pathError)
      })
  })
}

export async function claimQueuedDownloadJob(jobId) {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  const DownloadJob = getDatabase().models.DownloadJob

  const job = await DownloadJob.findByPk(jobId)
  if (!job || job.status !== 'queued') {
    return null
  }

  const updatePayload = {
    status: 'downloading',
    error_message: null
  }

  // Step 09.I - Preserve existing progress & downloaded bytes if job has existing progress (resuming job)
  if (job.progress == null || job.progress <= 0) {
    updatePayload.progress = 0
    updatePayload.downloaded_bytes = 0
  }

  const [updatedCount] = await DownloadJob.update(updatePayload, {
    where: {
      id: jobId,
      status: 'queued'
    }
  })

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

  clearJobRetryState(jobId)

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

  const formattedMessage = formatDownloadErrorMessage(error)

  const errorMessage =
    formattedMessage.trim().slice(0, 2000) ||
    `[${DOWNLOAD_ERROR_CODES.UNKNOWN_ERROR}] ${DEFAULT_ERROR_MESSAGES.UNKNOWN_ERROR}`

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
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

      clearJobRetryState(jobId)

      return await DownloadJob.findByPk(jobId)
    } catch (updateError) {
      if (isSqliteBusyError(updateError) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt))
        continue
      }
      throw updateError
    }
  }
}

export async function markDownloadJobCancelled(jobId) {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  const DownloadJob = getDatabase().models.DownloadJob

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const [updatedCount] = await DownloadJob.update(
        {
          status: 'cancelled',
          progress: 0,
          downloaded_bytes: 0,
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

      clearJobRetryState(jobId)

      return await DownloadJob.findByPk(jobId)
    } catch (updateError) {
      if (isSqliteBusyError(updateError) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt))
        continue
      }
      throw updateError
    }
  }
}

export async function cancelRunningDownload(jobId, timeoutMs = 4000) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  const processEntry = activeDownloadProcesses.get(jobId)

  if (!processEntry || processEntry.closed) {
    return {
      success: false,
      reason: 'not_running'
    }
  }

  // Prevent duplicate termination requests
  if (processEntry.cancelRequested) {
    return {
      success: true,
      alreadyCancelling: true
    }
  }

  processEntry.cancelRequested = true

  // If in starting phase (process not spawned yet), await cancelPersistedPromise from executeDownloadJob
  if (processEntry.phase === 'starting') {
    if (processEntry.managedByJobExecutor && processEntry.cancelPersistedPromise) {
      const persistResult = await Promise.race([
        processEntry.cancelPersistedPromise,
        new Promise((resolve) =>
          setTimeout(() => resolve({ success: false, timeout: true }), timeoutMs)
        )
      ])

      if (!persistResult?.success) {
        return {
          success: false,
          reason:
            persistResult?.data?.outcome ||
            (persistResult?.timeout ? 'persistence_timeout' : 'persistence_failed'),
          error: persistResult?.data?.message || 'Cancellation persistence could not be verified'
        }
      }
    }

    clearJobRetryState(jobId)

    return {
      success: true
    }
  }

  if (!processEntry.childProcess) {
    return {
      success: false,
      reason: 'not_running'
    }
  }

  try {
    const termResult = await terminateDownloadProcessTree(processEntry, timeoutMs)
    if (!termResult.success) {
      processEntry.cancelRequested = false
      return {
        success: false,
        reason: 'termination_failed',
        error: termResult.error || 'Failed to terminate download process tree'
      }
    }
  } catch (error) {
    processEntry.cancelRequested = false
    console.error(`[download] Error terminating process for job ${jobId}:`, error)
    return {
      success: false,
      reason: 'termination_failed',
      error: error.message
    }
  }

  // Await SQLite persistence & cleanup completion from executeDownloadJob catch block
  if (processEntry.managedByJobExecutor && processEntry.cancelPersistedPromise) {
    const persistResult = await Promise.race([
      processEntry.cancelPersistedPromise,
      new Promise((resolve) =>
        setTimeout(() => resolve({ success: false, timeout: true }), timeoutMs)
      )
    ])

    if (!persistResult?.success) {
      return {
        success: false,
        reason:
          persistResult?.data?.outcome ||
          (persistResult?.timeout ? 'persistence_timeout' : 'persistence_failed'),
        error: persistResult?.data?.message || 'Cancellation persistence could not be verified'
      }
    }
  }

  clearJobRetryState(jobId)

  return {
    success: true
  }
}

export async function pauseRunningDownload(jobId, timeoutMs = 4000) {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  const processEntry = activeDownloadProcesses.get(jobId)

  if (!processEntry || processEntry.closed) {
    return {
      success: false,
      reason: 'not_running'
    }
  }

  // If in starting phase (process not spawned yet), await pausePersistedPromise from executeDownloadJob
  if (processEntry.phase === 'starting') {
    processEntry.pauseRequested = true
    if (processEntry.managedByJobExecutor && processEntry.pausePersistedPromise) {
      const persistResult = await Promise.race([
        processEntry.pausePersistedPromise,
        new Promise((resolve) =>
          setTimeout(() => resolve({ success: false, timeout: true }), timeoutMs)
        )
      ])

      if (!persistResult?.success) {
        return {
          success: false,
          reason: persistResult?.timeout ? 'persistence_timeout' : 'validation_failed',
          error: persistResult?.data?.message || 'Failed to verify or persist paused checkpoint'
        }
      }
    }

    clearJobRetryState(jobId)

    return {
      success: true
    }
  }

  if (!processEntry.childProcess) {
    return {
      success: false,
      reason: 'not_running'
    }
  }

  // If the download has already entered the finalization phase (FFmpeg merge / post-processing),
  // it cannot be safely paused. Return a specific outcome so callers can inform the user.
  if (processEntry.phase === 'finalizing') {
    return {
      success: false,
      reason: 'already_finishing'
    }
  }

  // Prevent duplicate pause requests / deduplicate in-flight operations
  if (processEntry.pausePromise) {
    return await processEntry.pausePromise
  }

  if (processEntry.pauseRequested) {
    return {
      success: true,
      alreadyPausing: true
    }
  }

  const pauseOp = (async () => {
    processEntry.pauseRequested = true

    // On Windows, if processEntry.actualPid is not yet known (helper handshake still pending),
    // await processEntry.readyPromise with a 3000ms timeout before attempting signaling.
    if (process.platform === 'win32' && !processEntry.actualPid && processEntry.readyPromise) {
      await Promise.race([
        processEntry.readyPromise,
        new Promise((resolve) => setTimeout(resolve, 3000))
      ])
    }

    try {
      const interruptResult = await gracefullyInterruptDownloadProcess(processEntry, timeoutMs)
      if (!interruptResult.success) {
        processEntry.pauseRequested = false
        return {
          success: false,
          reason: 'interruption_failed',
          error: interruptResult.error || 'Graceful pause did not complete within timeout'
        }
      }
    } catch (error) {
      processEntry.pauseRequested = false
      console.error(`[download] Error interrupting process for pausing job ${jobId}:`, error)
      return {
        success: false,
        reason: 'interruption_failed',
        error: error.message
      }
    }

    // Await SQLite persistence & checkpoint verification from executeDownloadJob catch block
    if (processEntry.managedByJobExecutor && processEntry.pausePersistedPromise) {
      const persistResult = await Promise.race([
        processEntry.pausePersistedPromise,
        new Promise((resolve) =>
          setTimeout(() => resolve({ success: false, timeout: true }), timeoutMs)
        )
      ])

      if (!persistResult.success) {
        return {
          success: false,
          reason: persistResult.timeout ? 'persistence_timeout' : 'validation_failed',
          error: persistResult.data?.message || 'Failed to verify or persist paused checkpoint'
        }
      }
    }

    clearJobRetryState(jobId)

    return {
      success: true
    }
  })()

  processEntry.pausePromise = pauseOp
  try {
    return await pauseOp
  } finally {
    processEntry.pausePromise = null
  }
}

export function getActiveDownloadProcess(jobId) {
  return activeDownloadProcesses.get(jobId) || null
}

export function setActiveDownloadProcessForTesting(jobId, entry) {
  if (!entry) {
    activeDownloadProcesses.delete(jobId)
  } else {
    activeDownloadProcesses.set(jobId, entry)
  }
}

let executionHooksForTesting = null

export function setExecutionHooksForTesting(hooks = null) {
  executionHooksForTesting = hooks && typeof hooks === 'object' ? { ...hooks } : null
}

export function resetExecutionHooksForTesting() {
  executionHooksForTesting = null
}

/**
 * Universal MP4 format selector across all supported platforms.
 * Resolves optimal format selector string and calculates estimated required disk space.
 *
 * @param {object} availableFormats - Available formats object from mediaAnalyzerService
 * @param {string} requestedQuality - Target quality (e.g. '1080p', '720p')
 * @param {string|null} [platform=null] - Optional platform identifier (kept for backwards compatibility)
 * @returns {{ selector: string, type: 'separate_merge'|'combined_stream', formatSelector: string, estimatedRequiredBytes: number|null, videoFormat: object, audioFormat: object|null }}
 */
function resolveMp4FormatSelector(availableFormats, requestedQuality) {
  const mp4Formats = Array.isArray(availableFormats?.mp4Formats) ? availableFormats.mp4Formats : []
  const audioFormats = Array.isArray(availableFormats?.audioFormats)
    ? availableFormats.audioFormats
    : []

  const hasFormatId = (format) =>
    typeof format?.formatId === 'string' && format.formatId.trim().length > 0

  const matchingVideos = mp4Formats.filter(
    (format) => format?.quality === requestedQuality && hasFormatId(format)
  )

  // 1. Prefer video-only MP4 with separate compatible audio
  const videoOnly = [...matchingVideos].reverse().find((format) => format.audioIncluded === false)

  const isPreferredAudio = (format) => {
    if (!hasFormatId(format)) return false
    const ext = String(format.extension || '').toLowerCase()
    const codec = String(format.audioCodec || '').toLowerCase()
    return (
      ext === 'm4a' ||
      ext === 'mp4' ||
      ext === 'aac' ||
      codec.includes('aac') ||
      codec.includes('mp4a')
    )
  }

  const compatibleAudio =
    [...audioFormats].reverse().find(isPreferredAudio) ||
    [...audioFormats].reverse().find(hasFormatId)

  // 2. Otherwise use a combined MP4 stream containing audio
  const combinedVideo = [...matchingVideos]
    .reverse()
    .find((format) => format.audioIncluded === true)

  if (videoOnly && compatibleAudio) {
    const selector = `${videoOnly.formatId}+${compatibleAudio.formatId}`
    const vSize = Number(videoOnly.fileSize) || 0
    const aSize = Number(compatibleAudio.fileSize) || 0
    const estimatedRequiredBytes = vSize > 0 || aSize > 0 ? Math.ceil((vSize + aSize) * 2.5) : null

    return {
      selector,
      type: 'separate_merge',
      formatSelector: selector,
      estimatedRequiredBytes,
      videoFormat: videoOnly,
      audioFormat: compatibleAudio
    }
  } else if (combinedVideo) {
    const selector = combinedVideo.formatId
    const cSize = Number(combinedVideo.fileSize) || 0
    const estimatedRequiredBytes = cSize > 0 ? Math.ceil(cSize * 2.0) : null

    return {
      selector,
      type: 'combined_stream',
      formatSelector: selector,
      estimatedRequiredBytes,
      videoFormat: combinedVideo,
      audioFormat: null
    }
  }

  // 3. Reject unsupported quality with descriptive error
  const qualityExists = mp4Formats.some((format) => format?.quality === requestedQuality)
  if (!qualityExists) {
    const availableQualities = Array.isArray(availableFormats?.mp4Qualities)
      ? availableFormats.mp4Qualities
      : []
    const qualityList = availableQualities.length ? availableQualities.join(', ') : 'None available'
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.FORMAT_UNAVAILABLE,
      `Unsupported MP4 quality "${requestedQuality}". Available MP4 qualities: ${qualityList}`
    )
  }

  throw new DownloadError(
    DOWNLOAD_ERROR_CODES.FORMAT_UNAVAILABLE,
    `No compatible MP4 video/audio format found for quality "${requestedQuality}"`
  )
}

export async function prepareDownloadJobExecution(jobId) {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  const { DownloadJob, MediaItem, AppSetting } = getDatabase().models

  // Get the download job
  const job = await DownloadJob.findByPk(jobId)

  if (!job) {
    throw new Error('Download Job not found')
  }

  if (job.status !== 'queued' && job.status !== 'downloading') {
    throw new Error('Only queued or preparing download jobs can start')
  }

  // Get the related media item
  const media = await MediaItem.findByPk(job.media_id)

  if (!media || !media.source_url) {
    throw new Error('Media Item or source URL not found')
  }

  // Step 04.40 - Preflight URL security validation before network execution
  await validateMediaUrl(media.source_url)

  // Get the selected or default download folder
  const savedPath = await getSavedDownloadPath(AppSetting)

  const downloadPath = savedPath || (await getDefaultDownloadPath())

  // Step 04.37 - Validate folder safety and verify write permissions
  await validateDownloadFolder(downloadPath)
  await verifyDownloadFolderWritable(downloadPath)

  // Check for existing valid job output for adoption or conflict
  const existingValidFile = await assertNoJobOutputFileConflict(downloadPath, job.id, {
    allowAdoption: true,
    expectedFormat: job.output_format
  })

  // Select exact MP4 video and audio source formats
  let mp4FormatSelector = null
  let estimatedRequiredBytes = null

  if (job.output_format === 'mp4') {
    const analysis = await analyzeMedia(media.source_url)
    const availableFormats = analysis.availableFormats ?? {}

    const resolved = resolveMp4FormatSelector(availableFormats, job.quality)
    mp4FormatSelector = resolved.selector
    estimatedRequiredBytes = resolved.estimatedRequiredBytes
  } else if (job.output_format === 'mp3') {
    if (Number.isFinite(media.duration_seconds) && media.duration_seconds > 0) {
      // Audio stream size estimation: duration (seconds) * bitrate (kbps * 1000 / 8)
      const approxAudioBytes = Math.ceil(
        media.duration_seconds * ((job.audio_bitrate_kbps * 1000) / 8)
      )
      // 2.5x to account for downloaded source stream + converted mp3 output
      estimatedRequiredBytes = Math.ceil(approxAudioBytes * 2.5)
    }
  }

  // Step 04.37 - Insufficient disk space preflight detection
  const diskCheck = await checkDownloadDiskSpace({
    downloadPath,
    estimatedRequiredBytes
  })

  if (!diskCheck.sufficient) {
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.DISK_FULL,
      'Not enough disk space to complete the download.'
    )
  }

  // Create a dedicated temporary workspace for this download job
  const tempPath = await prepareJobTemporaryWorkspace(job.id, downloadPath)

  // Step 04.43 - Resolve packaged/dev FFmpeg location and JS runtime options
  const jsRuntimeOption = await resolveJavaScriptRuntimeOption()
  const ffmpegLocation = await resolveFFmpegLocationDirectory()

  // Prepare yt-dlp arguments
  const args = buildYtDlpArgs({
    sourceUrl: media.source_url,
    outputFormat: job.output_format,
    quality: job.quality,
    audioBitrateKbps: job.audio_bitrate_kbps,
    downloadPath,
    mp4FormatSelector,
    jobId: job.id,
    tempPath,
    jsRuntimeOption,
    ffmpegLocation
  })

  return {
    jobId: job.id,
    downloadPath,
    tempPath,
    args,
    existingValidFile
  }
}

export async function verifyDownloadedFile(finalFilePath, options = {}) {
  // Validate the file path
  if (typeof finalFilePath !== 'string' || !finalFilePath.trim()) {
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
      'A valid final file path is required'
    )
  }

  const filePath = finalFilePath.trim()

  // Step 04.37 - Guard against path traversal if expected download folder is provided
  if (options?.downloadPath) {
    await assertRealPathInsideDirectory(filePath, options.downloadPath)
  }

  // Step 04.37 - Ensure the downloaded output is not a symbolic link or junction
  try {
    const lstatInfo = await lstat(filePath)
    if (lstatInfo.isSymbolicLink()) {
      throw new DownloadError(
        DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
        'Downloaded file cannot be a symbolic link'
      )
    }
  } catch (lstatErr) {
    if (lstatErr instanceof DownloadError) {
      throw lstatErr
    }
    // If lstat throws, subsequent stat check will handle ENOENT / permissions
  }

  let fileStats

  // Read file information from the operating system
  try {
    fileStats = await stat(filePath)
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw new DownloadError(
        DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
        'Downloaded file does not exist',
        { cause: error }
      )
    }

    if (['EACCES', 'EPERM'].includes(error.code)) {
      throw new DownloadError(
        DOWNLOAD_ERROR_CODES.PERMISSION_DENIED,
        'The application does not have permission to access the downloaded file',
        { cause: error }
      )
    }

    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
      `Could not verify downloaded file: ${error.message}`,
      { cause: error }
    )
  }

  // Ensure the path points to a regular file
  if (!fileStats.isFile()) {
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
      'Downloaded path is not a file'
    )
  }

  // Reject empty files
  if (fileStats.size <= 0) {
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
      'Downloaded file is empty'
    )
  }

  // Verify ownership via job marker [job-ID]
  if (options?.jobId) {
    const marker = `[job-${options.jobId}]`
    if (!basename(filePath).includes(marker)) {
      throw new DownloadError(
        DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
        `Downloaded file does not belong to job ${options.jobId}`
      )
    }
  }

  // Verify expected output format extension if provided
  if (options?.expectedFormat) {
    const ext = extname(filePath).slice(1).toLowerCase()
    if (ext !== options.expectedFormat.toLowerCase()) {
      throw new DownloadError(
        DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
        `Downloaded file format does not match the job (expected: ${options.expectedFormat}, got: ${ext})`
      )
    }
  }

  return {
    exists: true,
    filePath,
    fileSizeBytes: fileStats.size
  }
}

export async function verifyFinalMediaContent(filePath, expectedFormat) {
  // Step 04.43 - Dynamically resolve packaged or dev ffprobe executable path inside protected error handling
  let ffprobeExecutable
  try {
    ffprobeExecutable = await resolveFFprobePath()
  } catch (resolveErr) {
    if (
      resolveErr?.code === 'ENOENT' ||
      resolveErr?.code === DOWNLOAD_ERROR_CODES.FFPROBE_NOT_FOUND
    ) {
      throw new DownloadError(
        DOWNLOAD_ERROR_CODES.FFPROBE_NOT_FOUND,
        'FFprobe executable was not found. FFmpeg tools must be available in PATH',
        { cause: resolveErr }
      )
    }
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.FFPROBE_FAILED,
      `FFprobe executable could not be resolved: ${resolveErr.message}`,
      { cause: resolveErr }
    )
  }

  let stdout
  try {
    const res = await execFileAsync(
      ffprobeExecutable,
      [
        '-v',
        'error',
        '-show_entries',
        'format=format_name:stream=codec_type,codec_name',
        '-of',
        'json',
        filePath
      ],
      {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024
      }
    )
    stdout = res.stdout
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new DownloadError(
        DOWNLOAD_ERROR_CODES.FFPROBE_NOT_FOUND,
        'FFprobe executable was not found. FFmpeg tools must be available in PATH',
        { cause: error }
      )
    }

    const isOperationalFailure =
      ['EACCES', 'EPERM', 'ETIMEDOUT', 'EPIPE'].includes(error?.code) ||
      error?.killed === true ||
      Boolean(error?.signal)

    if (!isOperationalFailure) {
      const stderr = String(error?.stderr || error?.message || '')
      if (
        /invalid data found when processing input|moov atom not found|corrupt(?:ed)? input|error reading header|end of file/i.test(
          stderr
        )
      ) {
        throw new DownloadError(
          DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
          `Media file is corrupted or invalid: ${stderr.trim().split('\n')[0]}`,
          { cause: error }
        )
      }
    }

    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.FFPROBE_FAILED,
      `FFprobe inspection failed: ${error.message}`,
      { cause: error }
    )
  }

  let probeData
  try {
    probeData = JSON.parse(stdout)
  } catch (parseError) {
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.FFPROBE_FAILED,
      `FFprobe returned malformed JSON output: ${parseError.message}`,
      { cause: parseError }
    )
  }

  const containerNames = String(probeData?.format?.format_name ?? '').split(',')

  const streams = Array.isArray(probeData?.streams) ? probeData.streams : []

  const audioStreams = streams.filter(
    (stream) =>
      stream?.codec_type === 'audio' &&
      typeof stream.codec_name === 'string' &&
      stream.codec_name !== 'unknown'
  )

  const videoStreams = streams.filter(
    (stream) =>
      stream?.codec_type === 'video' &&
      typeof stream.codec_name === 'string' &&
      stream.codec_name !== 'unknown'
  )

  if (expectedFormat === 'mp3') {
    const validMp3 =
      containerNames.includes('mp3') && audioStreams.some((stream) => stream.codec_name === 'mp3')

    if (!validMp3) {
      throw new DownloadError(
        DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
        'Final MP3 verification failed: invalid MP3 audio'
      )
    }
  } else if (expectedFormat === 'mp4') {
    const validMp4 =
      containerNames.includes('mp4') && videoStreams.length > 0 && audioStreams.length > 0

    if (!validMp4) {
      throw new DownloadError(
        DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
        'Final MP4 verification failed: video or audio stream is missing'
      )
    }
  } else {
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.FORMAT_UNAVAILABLE,
      'Unsupported final media format'
    )
  }

  return true
}

//save download file in downloadfile table
export async function saveDownloadedFile(
  jobId,
  finalFilePath,
  transaction = null,
  preVerifiedFile = null
) {
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

  // 5. Verify the actual downloaded file if not already pre-verified outside transaction
  const verifiedFile = preVerifiedFile || (await verifyDownloadedFile(finalFilePath))

  // 6. Check whether the file format matches the job
  const fileFormat = extname(verifiedFile.filePath).slice(1).toLowerCase()

  if (fileFormat !== job.output_format) {
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
      'Downloaded file format does not match the job'
    )
  }

  // Verify actual media container and streams before saving if not already pre-verified
  if (!preVerifiedFile) {
    await verifyFinalMediaContent(verifiedFile.filePath, job.output_format)
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

export async function executeDownloadJob(jobId, options = {}) {
  // If an active process entry already exists for this job ID, check if it is shutting down / winding down
  const existingEntry = activeDownloadProcesses.get(jobId)
  if (existingEntry) {
    if (existingEntry.pauseRequested || existingEntry.cancelRequested || existingEntry.closed) {
      // The previous execution for this job is in the middle of shutting down / winding down.
      // Wait briefly for the previous execution to clear its registration.
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        if (!activeDownloadProcesses.has(jobId)) break
      }
    }
  }

  if (activeDownloadProcesses.has(jobId)) {
    console.warn(
      `[download] Job ${jobId} already has an active execution process; skipping duplicate startup.`
    )
    return null
  }

  // Generate unique execution ownership token
  const executionToken = Symbol(`execution_${jobId}`)

  let cancelPersistedResolver
  const cancelPersistedPromise = new Promise((resolve) => {
    cancelPersistedResolver = resolve
  })

  let pausePersistedResolver
  const pausePersistedPromise = new Promise((resolve) => {
    pausePersistedResolver = resolve
  })

  let cancelSettled = false
  const settleCancel = (success, data) => {
    if (!cancelSettled) {
      cancelSettled = true
      cancelPersistedResolver({ success, data })
    }
  }

  let pauseSettled = false
  const settlePause = (success, data) => {
    if (!pauseSettled) {
      pauseSettled = true
      pausePersistedResolver({ success, data })
    }
  }

  const startupEntry = {
    jobId,
    executionToken,
    phase: 'starting',
    cancelRequested: false,
    pauseRequested: false,
    childProcess: null,
    managedByJobExecutor: true,
    cancelPersistedPromise,
    markCancelPersisted: settleCancel,
    pausePersistedPromise,
    markPausePersisted: settlePause
  }

  const settleStartupFailure = (outcome, message) => {
    const data = { outcome, message }
    settlePause(false, data)
    settleCancel(false, data)

    const currentEntry = activeDownloadProcesses.get(jobId)
    if (currentEntry?.executionToken === executionToken) {
      activeDownloadProcesses.delete(jobId)
    }
  }

  let claimedJob = null
  let claimError = null
  await withJobOperationLock(jobId, async () => {
    // Register startup reservation atomically with claiming the queued job under the per-job lock
    // so concurrent cancel/pause observes a consistent job state and startup entry.
    activeDownloadProcesses.set(jobId, startupEntry)

    try {
      claimedJob = await claimQueuedDownloadJob(jobId)
    } catch (claimErr) {
      claimError = claimErr
      settleStartupFailure('startup_claim_failed', claimErr.message)
      return
    }

    if (!claimedJob) {
      console.log(`[download] Job ${jobId} is no longer queued; skipping execution.`)
      settleStartupFailure('startup_not_claimed', 'Download job was not available for execution')
      if (activeDownloadProcesses.get(jobId) === startupEntry) {
        activeDownloadProcesses.delete(jobId)
      }
    }
  })

  if (claimError) {
    throw claimError
  }

  if (!claimedJob) {
    return null
  }

  if (typeof executionHooksForTesting?.afterClaim === 'function') {
    await executionHooksForTesting.afterClaim({ jobId, claimedJob, startupEntry })
  }

  // Main download lifecycle variables
  let execution = null
  let finalFilePath = null
  let verificationFailed = false
  let progressWriteChain = Promise.resolve()
  let lastScheduledProgress = claimedJob.progress || 0
  let progressWriteError = null
  let lastScheduledBytes = claimedJob.downloaded_bytes || 0
  let latestObservedBytes = claimedJob.downloaded_bytes || 0
  let lastBytesWriteAt = 0
  let lastScheduledTotalBytes = null
  let lastScheduledTotalIsEstimate = false
  let latestObservedTotalBytes = null
  let latestObservedTotalIsEstimate = false

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

        await updateDownloadJobProgress(jobId, nextProgress)
      })
      .catch((error) => {
        progressWriteError ??= error
      })
  }

  const scheduleDownloadedBytes = (
    downloadedBytes,
    force = false,
    totalBytes = null,
    totalBytesIsEstimate = false
  ) => {
    // Validate byte count
    if (!Number.isSafeInteger(downloadedBytes) || downloadedBytes < 0) {
      return
    }

    // Remember the latest observed network bytes
    latestObservedBytes = Math.max(latestObservedBytes, downloadedBytes)

    if (Number.isFinite(totalBytes) && totalBytes > 0) {
      latestObservedTotalBytes = totalBytes
      latestObservedTotalIsEstimate = Boolean(totalBytesIsEstimate)
    }

    const currentTotalBytes =
      Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : latestObservedTotalBytes
    const currentTotalIsEstimate =
      Number.isFinite(totalBytes) && totalBytes > 0
        ? Boolean(totalBytesIsEstimate)
        : latestObservedTotalIsEstimate

    const totalChanged =
      currentTotalBytes !== null &&
      (currentTotalBytes !== lastScheduledTotalBytes ||
        currentTotalIsEstimate !== lastScheduledTotalIsEstimate)

    // Never schedule a lower or duplicate value unless total has changed or force is true
    if (downloadedBytes <= lastScheduledBytes && !totalChanged && !force) {
      return
    }

    const BYTE_UPDATE_STEP = 1024 * 1024
    const MIN_UPDATE_INTERVAL_MS = 1000

    const now = Date.now()

    const reachedCheckpoint = downloadedBytes - lastScheduledBytes >= BYTE_UPDATE_STEP

    const intervalElapsed = now - lastBytesWriteAt >= MIN_UPDATE_INTERVAL_MS

    // Limit unnecessary SQLite updates
    if (!force && !totalChanged && (!reachedCheckpoint || !intervalElapsed)) {
      return
    }

    lastScheduledBytes = downloadedBytes
    lastScheduledTotalBytes = currentTotalBytes
    lastScheduledTotalIsEstimate = currentTotalIsEstimate
    lastBytesWriteAt = now

    // Preserve the existing ordered database queue
    progressWriteChain = progressWriteChain
      .then(async () => {
        if (progressWriteError) {
          return
        }

        await updateDownloadJobDownloadedBytes(
          jobId,
          downloadedBytes,
          currentTotalBytes,
          currentTotalIsEstimate
        )
      })
      .catch((error) => {
        progressWriteError ??= error
      })
  }

  let executionErrorPersisted = false

  try {
    if (typeof executionHooksForTesting?.beforePrepareWorkspace === 'function') {
      await executionHooksForTesting.beforePrepareWorkspace({ jobId, startupEntry })
    }

    // Check for early cancellation or pause requested before preparation
    if (startupEntry.cancelRequested) {
      throw new DownloadCancelledError('Download was cancelled before preparation')
    }
    if (startupEntry.pauseRequested) {
      throw new DownloadPausedError('Download was paused before preparation')
    }

    try {
      execution = await prepareDownloadJobExecution(jobId)

      if (typeof executionHooksForTesting?.afterPrepareWorkspace === 'function') {
        await executionHooksForTesting.afterPrepareWorkspace({ jobId, execution, startupEntry })
      }

      if (startupEntry.cancelRequested) {
        throw new DownloadCancelledError('Download was cancelled during preparation')
      }

      if (startupEntry.pauseRequested) {
        throw new DownloadPausedError('Download was paused during preparation')
      }

      const currentDbJob = await getDatabase().models.DownloadJob.findByPk(jobId)
      if (currentDbJob?.status === 'cancelled') {
        throw new DownloadCancelledError('Download was cancelled during preparation')
      }
      if (currentDbJob?.status === 'paused') {
        throw new DownloadPausedError('Download was paused during preparation')
      }
    } catch (error) {
      if (error instanceof DownloadCancelledError || error instanceof DownloadPausedError) {
        throw error
      }

      if (startupEntry?.cancelRequested) {
        throw new DownloadCancelledError('Download was cancelled during preparation')
      }

      if (startupEntry?.pauseRequested) {
        throw new DownloadPausedError('Download was paused during preparation')
      }

      const checkDbJob = await getDatabase()
        .models.DownloadJob.findByPk(jobId)
        .catch(() => null)
      if (checkDbJob?.status === 'cancelled') {
        throw new DownloadCancelledError('Download was cancelled during preparation')
      }
      if (checkDbJob?.status === 'paused') {
        throw new DownloadPausedError('Download was paused during preparation')
      }

      const isTransient =
        isTransientNetworkError(error) ||
        error?.code === 'NETWORK_ERROR' ||
        error?.code === 'DNS_LOOKUP_FAILED' ||
        /\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)\b|network is unreachable|timed out|Temporary failure in name resolution|getaddrinfo\s+(?:ENOTFOUND|failed)|unable to connect/i.test(
          String(error?.message || '') + ' ' + String(error?.stderr || '')
        )

      if (isTransient) {
        if (startupEntry?.cancelRequested) {
          throw new DownloadCancelledError(
            'Download was cancelled before retrying transient failure'
          )
        }
        if (startupEntry?.pauseRequested) {
          throw new DownloadPausedError('Download was paused before retrying transient failure')
        }

        console.warn(
          `[download] Job ${jobId} encountered transient network/DNS error during preparation. Transitioning to 'interrupted' and scheduling retry.`
        )
        try {
          const DownloadJob = getDatabase().models.DownloadJob
          const [transientUpdatedCount] = await DownloadJob.update(
            {
              status: 'interrupted',
              error_message:
                'Internet connection or DNS was lost during preparation. Retrying automatically...'
            },
            {
              where: { id: jobId, status: 'downloading' }
            }
          )

          if (startupEntry?.cancelRequested) {
            throw new DownloadCancelledError('Download was cancelled during interrupted transition')
          }
          if (startupEntry?.pauseRequested) {
            throw new DownloadPausedError('Download was paused during interrupted transition')
          }

          if (transientUpdatedCount === 1) {
            scheduleJobRetry(jobId)
          } else {
            const latestJob = await DownloadJob.findByPk(jobId).catch(() => null)
            if (latestJob?.status === 'cancelled') {
              throw new DownloadCancelledError('Download was cancelled during preparation')
            }
            if (latestJob?.status === 'paused') {
              throw new DownloadPausedError('Download was paused during preparation')
            }
          }
        } catch (statusError) {
          if (
            statusError instanceof DownloadCancelledError ||
            statusError instanceof DownloadPausedError
          ) {
            throw statusError
          }
          console.error(
            `[download] Failed to persist interrupted state for job ${jobId}:`,
            statusError
          )
        }
        throw error
      }

      // Clean up any partially created temporary workspace if non-transient preparation failed
      try {
        const fallbackPath =
          execution?.downloadPath ||
          (await resolveValidatedDownloadPath(getDatabase().models.AppSetting))

        if (fallbackPath) {
          await cleanupJobTemporaryFiles(jobId, fallbackPath)
        }
      } catch {
        // Ignore fallback cleanup errors during preparation failure
      }

      // Re-check cancellation or pause after async path resolution and cleanup waits
      if (startupEntry?.cancelRequested) {
        throw new DownloadCancelledError(
          'Download was cancelled during preparation failure handling'
        )
      }
      if (startupEntry?.pauseRequested) {
        throw new DownloadPausedError('Download was paused during preparation failure handling')
      }

      // Mark only a still-downloading job as failed
      try {
        const failedJob = await markDownloadJobFailed(jobId, error, 'downloading')

        if (startupEntry?.cancelRequested) {
          throw new DownloadCancelledError('Download was cancelled as preparation failed')
        }
        if (startupEntry?.pauseRequested) {
          throw new DownloadPausedError('Download was paused as preparation failed')
        }

        if (failedJob) {
          executionErrorPersisted = true
        } else {
          const latestJob = await getDatabase()
            .models.DownloadJob.findByPk(jobId)
            .catch(() => null)
          if (latestJob?.status === 'cancelled') {
            throw new DownloadCancelledError('Download was cancelled during preparation failure')
          }
          if (latestJob?.status === 'paused') {
            throw new DownloadPausedError('Download was paused during preparation failure')
          }
          console.warn('[download] Job was not in preparing state when preparation failed:', jobId)
        }
      } catch (statusError) {
        if (
          statusError instanceof DownloadCancelledError ||
          statusError instanceof DownloadPausedError
        ) {
          throw statusError
        }
        console.error('[download] Failed to save preparation error:', statusError)
      }

      throw error
    }

    // Step 04.38 - Adopt pre-existing valid output file if application previously stopped after yt-dlp moved file
    if (execution.existingValidFile) {
      let candidateVerified = null
      try {
        candidateVerified = await verifyDownloadedFile(execution.existingValidFile, {
          downloadPath: execution.downloadPath,
          jobId,
          expectedFormat: claimedJob.output_format
        })
        await verifyFinalMediaContent(candidateVerified.filePath, claimedJob.output_format)
      } catch (adoptionErr) {
        if (adoptionErr?.code === DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED) {
          console.warn(
            `[download] Job ${jobId} candidate output file confirmed invalid: ${adoptionErr.message}. Removing invalid orphan.`
          )
          await removeJobOwnedOutputFile(execution.existingValidFile, execution.downloadPath, jobId)
          candidateVerified = null
        } else {
          // Operational verification failure (e.g. FFprobe missing/failed) -> preserve output file and mark job failed
          console.warn(
            `[download] Job ${jobId} candidate output file inspection error: ${adoptionErr.message}. Output preserved.`
          )
          try {
            await markDownloadJobFailed(jobId, adoptionErr)
          } catch (statusErr) {
            console.error(
              `[download] Failed to persist failed state for job ${jobId} during adoption error:`,
              statusErr
            )
          }
          throw adoptionErr
        }
      }

      if (candidateVerified) {
        console.log(
          `[download] Job ${jobId} adopted valid pre-existing final output file: ${candidateVerified.filePath}`
        )
        let completionResult
        try {
          completionResult = await withCompletionWriteLock(async () => {
            return await getDatabase().transaction(
              { type: Transaction.TYPES.IMMEDIATE },
              async (transaction) => {
                const saved = await saveDownloadedFile(
                  jobId,
                  candidateVerified.filePath,
                  transaction,
                  candidateVerified
                )
                const completed = await markDownloadJobCompleted(jobId, transaction)
                return { savedFile: saved, completedJob: completed }
              }
            )
          })
        } catch (dbError) {
          console.error(
            `[download] Database failure recording adopted job ${jobId} completion:`,
            dbError
          )
          const classifiedDbError = new DownloadError(
            DOWNLOAD_ERROR_CODES.DATABASE_ERROR,
            `Failed to record download completion in database: ${dbError.message}`,
            { cause: dbError }
          )
          try {
            await markDownloadJobFailed(jobId, classifiedDbError)
          } catch (statusErr) {
            console.error(
              `[download] Failed to persist failed state for job ${jobId} after adoption DB error:`,
              statusErr
            )
          }
          throw classifiedDbError
        }

        try {
          await cleanupJobTemporaryFiles(jobId, execution.downloadPath)
        } catch {
          // ignore
        }

        return {
          job: completionResult.completedJob,
          file: completionResult.savedFile
        }
      }
    }

    // Both MP3 and MP4 use structured download information
    const streamTracker = createMultiStreamProgressTracker()

    // 6. Execute yt-dlp with MP3 and MP4 callbacks
    const result = await runYtDlp(
      execution.args,

      // Existing MP3 percentage callback
      (streamPercent) => {
        if (claimedJob.output_format !== 'mp3') {
          return
        }

        const overallPercent = calculateOverallDownloadProgress('mp3', streamPercent)

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
        const totalDownloadedBytes = snapshot.streams.reduce((total, stream) => {
          return total + stream.downloadedBytes
        }, 0)

        const allStreamsFinished =
          snapshot.streams.length > 0 &&
          snapshot.streams.every((stream) => stream.status === 'finished')

        // Transition to 'finalizing' phase when all streams complete so that
        // a concurrent Pause request can detect this and return 'already_finishing'
        // rather than interrupting yt-dlp's FFmpeg merge/post-process step.
        if (allStreamsFinished) {
          const activeEntry = activeDownloadProcesses.get(jobId)
          if (activeEntry && activeEntry.phase === 'downloading') {
            activeEntry.phase = 'finalizing'
          }
        }

        const totals = aggregateStreamTotals(snapshot.streams)

        // Save downloaded bytes and total bytes for both formats
        scheduleDownloadedBytes(
          totalDownloadedBytes,
          allStreamsFinished,
          totals.totalBytes,
          totals.totalBytesIsEstimate
        )

        // MP4 needs separate overall progress calculation
        if (claimedJob.output_format === 'mp4') {
          const overallPercent = calculateMp4OverallProgress(snapshot)

          scheduleOverallProgress(overallPercent)
        }
      },

      // Options for process tracking & safe cancellation
      { jobId, managedByJobExecutor: true }
    )

    // Flush any remaining downloaded bytes and total bytes
    scheduleDownloadedBytes(
      latestObservedBytes,
      true,
      latestObservedTotalBytes,
      latestObservedTotalIsEstimate
    )

    // Wait until all progress and byte writes finish
    await progressWriteChain

    if (progressWriteError) {
      throw progressWriteError
    }

    // 8. Verify final path
    if (!result.finalFilePath) {
      throw new DownloadError(
        DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
        'yt-dlp did not return a final file path'
      )
    }

    finalFilePath = result.finalFilePath

    // Verify final media file outside any transaction to avoid holding database locks during ffprobe
    let verifiedFile
    try {
      verifiedFile = await verifyDownloadedFile(finalFilePath, {
        downloadPath: execution.downloadPath,
        jobId,
        expectedFormat: claimedJob.output_format
      })
      const fileFormat = extname(verifiedFile.filePath).slice(1).toLowerCase()

      if (fileFormat !== claimedJob.output_format) {
        throw new DownloadError(
          DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
          'Downloaded file format does not match the job'
        )
      }

      await verifyFinalMediaContent(verifiedFile.filePath, claimedJob.output_format)
    } catch (verifyErr) {
      verificationFailed = verifyErr?.code === DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED
      throw verifyErr
    }

    // 9. Save file record and complete job atomically with serialized write and bounded retries
    const MAX_COMPLETION_RETRIES = 5
    let completionAttempt = 0
    let savedFile = null
    let completedJob = null

    while (completionAttempt < MAX_COMPLETION_RETRIES) {
      completionAttempt += 1

      try {
        const completionResult = await withCompletionWriteLock(async () => {
          return await getDatabase().transaction(
            { type: Transaction.TYPES.IMMEDIATE },
            async (transaction) => {
              // Save the downloaded file record (using preVerifiedFile to avoid re-running ffprobe)
              const saved = await saveDownloadedFile(
                jobId,
                result.finalFilePath,
                transaction,
                verifiedFile
              )

              // Complete the job within the same transaction
              const completed = await markDownloadJobCompleted(jobId, transaction)

              if (!completed) {
                throw new Error('Could not mark Download Job as completed')
              }

              return {
                savedFile: saved,
                completedJob: completed
              }
            }
          )
        })

        savedFile = completionResult.savedFile
        completedJob = completionResult.completedJob
        break
      } catch (completionError) {
        // If it's a transient SQLite busy/lock error and we have retries left, wait with backoff and retry
        if (isSqliteBusyError(completionError) && completionAttempt < MAX_COMPLETION_RETRIES) {
          const delayMs = 150 * completionAttempt + Math.floor(Math.random() * 100)
          console.warn(
            `[download] SQLite busy during completion for job ${jobId} (attempt ${completionAttempt}/${MAX_COMPLETION_RETRIES}). Retrying in ${delayMs}ms...`
          )
          await new Promise((resolve) => setTimeout(resolve, delayMs))
          continue
        }

        // If it's an SQLite lock or engine error, classify clearly as DATABASE_ERROR
        if (
          isSqliteBusyError(completionError) ||
          completionError?.name?.startsWith?.('Sequelize') ||
          completionError?.code?.startsWith?.('SQLITE_') ||
          completionError?.original?.code?.startsWith?.('SQLITE_') ||
          completionError?.parent?.code?.startsWith?.('SQLITE_')
        ) {
          throw new DownloadError(
            DOWNLOAD_ERROR_CODES.DATABASE_ERROR,
            `Database error recording download completion: ${completionError.message}`,
            { cause: completionError }
          )
        }

        throw completionError
      }
    }

    // Safely clean up job-owned temporary workspace after successful completion
    try {
      await cleanupJobTemporaryFiles(jobId, execution.downloadPath)
    } catch (cleanupError) {
      console.warn(
        `[download] Failed to clean temporary workspace for completed job ${jobId}:`,
        cleanupError
      )
    }

    return {
      job: completedJob,
      file: savedFile
    }
  } catch (error) {
    // Complete any pending progress database writes
    await progressWriteChain

    // Step 04.38 - Remove invalid orphan output file if verification failed
    if (verificationFailed && finalFilePath && execution?.downloadPath) {
      try {
        console.warn(
          `[download] Output verification failed for job ${jobId}. Removing invalid output file: ${finalFilePath}`
        )
        await removeJobOwnedOutputFile(finalFilePath, execution.downloadPath, jobId)
      } catch (cleanErr) {
        console.warn(`[download] Failed to remove invalid output file for job ${jobId}:`, cleanErr)
      }
    }

    // Handle manual pause request
    if (error instanceof DownloadPausedError) {
      try {
        try {
          scheduleDownloadedBytes(latestObservedBytes, true)
          await progressWriteChain
        } catch {
          // ignore flush error
        }

        const DownloadJob = getDatabase().models.DownloadJob
        const cleanPath =
          execution?.downloadPath ||
          (await resolveValidatedDownloadPath(getDatabase().models.AppSetting))

        const latestJob = (await DownloadJob.findByPk(jobId)) || claimedJob
        const currentBytes = Math.max(latestJob.downloaded_bytes || 0, latestObservedBytes || 0)
        const currentProgress = latestJob.progress || 0

        let hasValidPartial = false
        let reconciledBytes = currentBytes
        let partialInspectionError = null

        if (cleanPath && (currentProgress > 0 || currentBytes > 0)) {
          try {
            const partialResult = await verifyJobPartialDownload(jobId, cleanPath, {
              savedDownloadedBytes: currentBytes,
              savedProgress: currentProgress
            })
            hasValidPartial = isPartialDownloadResumable(partialResult)
            if (hasValidPartial && partialResult.reconciledBytes > 0) {
              reconciledBytes = partialResult.reconciledBytes
            }
          } catch (partErr) {
            hasValidPartial = false
            partialInspectionError = partErr
          }
        } else if (currentProgress === 0 && currentBytes === 0) {
          // Special case: If the download is at 0% and has no partial bytes, allow valid paused checkpoint at 0%
          hasValidPartial = true
          reconciledBytes = 0
        }

        const currentEntry = activeDownloadProcesses.get(jobId)

        if (!hasValidPartial && (currentProgress > 0 || currentBytes > 0)) {
          console.warn(
            `[download] Pause validation failed for job ${jobId}: partial checkpoint is missing or invalid.`
          )
          await DownloadJob.update(
            {
              status: 'failed',
              error_message:
                'Download pause failed: partial download checkpoint is missing or invalid'
            },
            {
              where: { id: jobId }
            }
          )
          if (currentEntry && typeof currentEntry.markPausePersisted === 'function') {
            currentEntry.markPausePersisted(
              false,
              partialInspectionError || new Error('Invalid partial file')
            )
          }
          throw new DownloadError(
            DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
            'Partial download verification failed during pause'
          )
        }

        const updatePayload = {
          status: 'paused',
          error_message: null
        }
        if (reconciledBytes > 0 || currentProgress === 0) {
          updatePayload.downloaded_bytes = reconciledBytes
        }

        await DownloadJob.update(updatePayload, {
          where: {
            id: jobId
          }
        })
        clearJobRetryState(jobId)
        console.log(
          `[download] Job ${jobId} safely transitioned to 'paused' (verified bytes: ${reconciledBytes})`
        )

        if (currentEntry && typeof currentEntry.markPausePersisted === 'function') {
          currentEntry.markPausePersisted(true, { reconciledBytes })
        }
      } catch (statusError) {
        console.error(`[download] Failed to persist paused state for job ${jobId}:`, statusError)
        const currentEntry = activeDownloadProcesses.get(jobId)
        if (currentEntry && typeof currentEntry.markPausePersisted === 'function') {
          currentEntry.markPausePersisted(false, statusError)
        }
      }

      // Preserve partial files and temporary workspace across pause
      throw error
    }

    // Step 09.G - Handle application shutdown interruption
    if (error instanceof DownloadInterruptedError) {
      try {
        const DownloadJob = getDatabase().models.DownloadJob
        await DownloadJob.update(
          {
            status: 'queued',
            error_message: null
          },
          {
            where: {
              id: jobId,
              status: 'downloading'
            }
          }
        )
        console.log(`[download] Job ${jobId} safely transitioned to 'queued' for resume on restart`)
      } catch (statusError) {
        console.error(
          `[download] Failed to persist queued state for interrupted job ${jobId}:`,
          statusError
        )
      }

      // Preserve partial files and temporary workspace across shutdown
      throw error
    }

    // Step 09 Section B - Handle transient network failure (Internet disconnection)
    if (isTransientNetworkError(error)) {
      console.warn(
        `[download] Job ${jobId} encountered transient network failure. Transitioning to 'interrupted' without deleting partial files.`
      )
      try {
        try {
          scheduleDownloadedBytes(latestObservedBytes, true)
          await progressWriteChain
        } catch {
          // ignore flush error
        }

        const DownloadJob = getDatabase().models.DownloadJob
        const cleanPath =
          execution?.downloadPath ||
          (await resolveValidatedDownloadPath(getDatabase().models.AppSetting))

        const latestJob = (await DownloadJob.findByPk(jobId)) || claimedJob
        const currentBytes = Math.max(latestJob.downloaded_bytes || 0, latestObservedBytes || 0)
        const currentProgress = latestJob.progress || 0

        let hasValidPartial = false
        let reconciledBytes = 0
        try {
          const partialResult = await verifyJobPartialDownload(jobId, cleanPath, {
            savedDownloadedBytes: currentBytes,
            savedProgress: currentProgress
          })
          hasValidPartial = isPartialDownloadResumable(partialResult)
          if (hasValidPartial) {
            reconciledBytes = partialResult.reconciledBytes
          }
        } catch {
          hasValidPartial = false
        }

        const updatePayload = {
          status: 'interrupted',
          error_message: 'Internet connection was lost. Waiting for network connection to resume...'
        }

        if (hasValidPartial) {
          updatePayload.downloaded_bytes = reconciledBytes
        } else {
          let cleanupFailed = false
          let cleanupErrorMsg = null
          if (!cleanPath) {
            cleanupFailed = true
            cleanupErrorMsg = 'Unable to resolve valid download folder path'
          } else {
            try {
              const cleanResult = await cleanupJobTemporaryFiles(jobId, cleanPath)
              if (cleanResult && cleanResult.success === false) {
                cleanupFailed = true
                cleanupErrorMsg = cleanResult.error || 'Failed to cleanup temporary files'
              }
            } catch (cleanErr) {
              cleanupFailed = true
              cleanupErrorMsg = cleanErr.message
            }
          }

          if (cleanupFailed) {
            updatePayload.status = 'failed'
            updatePayload.error_message = `Network interruption cleanup failed: ${cleanupErrorMsg}`
          } else {
            updatePayload.progress = 0
            updatePayload.downloaded_bytes = 0
          }
        }

        const [interruptedUpdatedCount] = await DownloadJob.update(updatePayload, {
          where: {
            id: jobId,
            status: 'downloading'
          }
        })

        if (interruptedUpdatedCount === 1 && updatePayload.status === 'interrupted') {
          scheduleJobRetry(jobId)
        }
      } catch (statusError) {
        console.error(
          `[download] Failed to persist interrupted state for job ${jobId}:`,
          statusError
        )
      }

      // Preserve partial files and temporary workspace across network loss
      throw error
    }

    // Step 09.F - Handle sources that do not support resume (HTTP 416 / Range Not Satisfiable)
    let activeError = error

    if (
      isResumeIncompatibilityError(error) &&
      !options?.isResumeRetry &&
      !startupEntry?.cancelRequested &&
      !startupEntry?.pauseRequested
    ) {
      console.warn(
        `[download] Job ${jobId} failed with resume range incompatibility. Cleaning partial artifacts and retrying fresh once...`
      )
      try {
        const cleanPath =
          execution?.downloadPath ||
          (await resolveValidatedDownloadPath(getDatabase().models.AppSetting))

        let cleanupFailed = false
        let cleanupErrorMsg = null
        if (!cleanPath) {
          cleanupFailed = true
          cleanupErrorMsg = 'Unable to resolve valid download folder path'
        } else {
          try {
            const cleanResult = await cleanupJobTemporaryFiles(jobId, cleanPath)
            if (cleanResult && cleanResult.success === false) {
              cleanupFailed = true
              cleanupErrorMsg = cleanResult.error || 'Failed to cleanup temporary files'
            }
          } catch (cleanErr) {
            cleanupFailed = true
            cleanupErrorMsg = cleanErr.message
          }
        }

        if (startupEntry?.cancelRequested) {
          throw new DownloadCancelledError('Download was cancelled during resume fallback cleanup')
        }
        if (startupEntry?.pauseRequested) {
          throw new DownloadPausedError('Download was paused during resume fallback cleanup')
        }

        const DownloadJob = getDatabase().models.DownloadJob
        if (cleanupFailed) {
          await DownloadJob.update(
            {
              status: 'failed',
              error_message: `Resume range fallback cleanup failed: ${cleanupErrorMsg}`
            },
            {
              where: {
                id: jobId,
                status: 'downloading'
              }
            }
          )
          throw new Error(`Resume range fallback cleanup failed: ${cleanupErrorMsg}`)
        }

        const [requeuedCount] = await DownloadJob.update(
          {
            status: 'queued',
            progress: 0,
            downloaded_bytes: 0,
            error_message: null
          },
          {
            where: {
              id: jobId,
              status: 'downloading'
            }
          }
        )

        if (
          requeuedCount === 1 &&
          !startupEntry?.cancelRequested &&
          !startupEntry?.pauseRequested
        ) {
          return await executeDownloadJob(jobId, { isResumeRetry: true })
        }
      } catch (retryError) {
        if (
          retryError instanceof DownloadCancelledError ||
          retryError instanceof DownloadPausedError
        ) {
          activeError = retryError
        } else {
          console.error(`[download] Fallback fresh retry for job ${jobId} failed:`, retryError)
        }
      }
    }

    if (
      activeError instanceof DownloadCancelledError ||
      (!(activeError instanceof DownloadPausedError) && startupEntry?.cancelRequested)
    ) {
      // 1. Confirm child process termination if process was spawned
      const currentEntry = activeDownloadProcesses.get(jobId)
      if (currentEntry?.childProcess && !currentEntry.closed) {
        try {
          await terminateDownloadProcessTree(currentEntry, 3000)
        } catch {
          // Ignore termination error if already exited
        }
      }

      // 2. Resolve validated download path
      const cleanPath =
        execution?.downloadPath ||
        (await resolveValidatedDownloadPath(getDatabase().models.AppSetting))

      // 3. Clean up job-owned temporary workspace and partial files
      let cleanupSuccess = false
      let cleanupErrorMsg = null
      if (cleanPath) {
        try {
          const cleanResult = await cleanupJobTemporaryFiles(jobId, cleanPath)
          if (cleanResult && cleanResult.success === true) {
            cleanupSuccess = true
          } else {
            cleanupSuccess = false
            cleanupErrorMsg = cleanResult?.error || 'Temporary file cleanup reported incomplete'
          }
        } catch (cleanErr) {
          cleanupSuccess = false
          cleanupErrorMsg = cleanErr.message
        }
      } else {
        cleanupSuccess = false
        cleanupErrorMsg = 'Unable to resolve valid download folder path'
      }

      const DownloadJob = getDatabase().models.DownloadJob

      // 4. Require cleanupResult.success === true to mark as cancelled
      if (cleanupSuccess) {
        try {
          const [cancelUpdatedCount] = await DownloadJob.update(
            {
              status: 'cancelled',
              progress: 0,
              downloaded_bytes: 0,
              error_message: null
            },
            {
              where: {
                id: jobId,
                status: ['queued', 'downloading', 'paused', 'interrupted', 'failed']
              }
            }
          )
          clearJobRetryState(jobId)

          let persistedCancelled = cancelUpdatedCount === 1
          let currentDbStatus = null
          if (!persistedCancelled) {
            const latestJob = await DownloadJob.findByPk(jobId)
            currentDbStatus = latestJob?.status ?? null
            persistedCancelled = currentDbStatus === 'cancelled'
          }

          if (persistedCancelled) {
            console.log(
              `[download] Job ${jobId} safely transitioned to 'cancelled' with partial cleanup verified.`
            )
            if (currentEntry && typeof currentEntry.markCancelPersisted === 'function') {
              currentEntry.markCancelPersisted(true, { outcome: 'cancelled' })
            }
          } else if (currentEntry && typeof currentEntry.markCancelPersisted === 'function') {
            currentEntry.markCancelPersisted(false, {
              outcome: 'persistence_failed',
              message: `Unexpected job status after cancel update: ${currentDbStatus ?? 'missing'}`
            })
          }
        } catch (statusError) {
          console.error(
            `[download] Failed to persist cancelled status for job ${jobId}:`,
            statusError
          )
          if (currentEntry && typeof currentEntry.markCancelPersisted === 'function') {
            currentEntry.markCancelPersisted(false, {
              outcome: 'persistence_failed',
              message: statusError.message
            })
          }
        }
      } else {
        // Cleanup failed: DO NOT mark as cancelled! Mark as failed with diagnostic error
        console.warn(
          `[download] Cleanup failed during cancellation for job ${jobId}: ${cleanupErrorMsg}. Marking as failed.`
        )
        try {
          await DownloadJob.update(
            {
              status: 'failed',
              error_message: `Cancellation cleanup failed: ${cleanupErrorMsg}`
            },
            {
              where: {
                id: jobId,
                status: ['queued', 'downloading', 'paused', 'interrupted']
              }
            }
          )
          clearJobRetryState(jobId)
        } catch (statusError) {
          console.error(
            `[download] Failed to persist failed state for job ${jobId} after cleanup failure:`,
            statusError
          )
        }
        if (currentEntry && typeof currentEntry.markCancelPersisted === 'function') {
          currentEntry.markCancelPersisted(false, {
            outcome: 'cleanup_failed',
            message: cleanupErrorMsg
          })
        }
      }

      throw activeError
    }

    if (!executionErrorPersisted) {
      try {
        const failedJob = await markDownloadJobFailed(jobId, activeError)

        if (!failedJob) {
          console.error('Could not mark Download Job as failed:', jobId)
        }
      } catch (statusError) {
        console.error('Could not save failed job status:', statusError)
      }

      // Safely clean up job-owned temporary workspace after failure
      try {
        const cleanPath =
          execution?.downloadPath ||
          (await resolveValidatedDownloadPath(getDatabase().models.AppSetting))

        if (cleanPath) {
          await cleanupJobTemporaryFiles(jobId, cleanPath)
        }
      } catch (cleanupError) {
        console.warn(
          `[download] Failed to clean temporary workspace for failed job ${jobId}:`,
          cleanupError
        )
      }
    }

    throw activeError
  } finally {
    const curProc = activeDownloadProcesses.get(jobId)
    if (!curProc || !curProc.executionToken || curProc.executionToken === executionToken) {
      // Never orphan a caller awaiting cancelPersistedPromise if an unexpected exception skipped cancellation handling
      if (curProc?.cancelRequested && typeof curProc.markCancelPersisted === 'function') {
        try {
          const latestJob = await getDatabase().models.DownloadJob.findByPk(jobId)
          if (latestJob?.status === 'cancelled') {
            curProc.markCancelPersisted(true, { outcome: 'cancelled' })
          } else {
            curProc.markCancelPersisted(false, {
              outcome: 'persistence_failed',
              message: `Execution ended with status ${latestJob?.status ?? 'missing'} before cancellation completed`
            })
          }
        } catch (finalCancelErr) {
          curProc.markCancelPersisted(false, {
            outcome: 'persistence_failed',
            message: finalCancelErr.message
          })
        }
      }
      activeDownloadProcesses.delete(jobId)
    }
  }
}

export async function getDownloadJobDetails(jobId) {
  // 1. Validate Download Job ID
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  // 2. Get Sequelize models
  const { DownloadJob, DownloadFile } = getDatabase().models

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
  const { DownloadJob, DownloadFile, MediaItem } = getDatabase().models

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

  const mediaIds = [...new Set(jobs.map((job) => job.media_id))]

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
  const fileByJobId = new Map(files.map((file) => [file.download_job_id, file.toJSON()]))

  const mediaById = new Map(mediaItems.map((media) => [media.id, media.toJSON()]))

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
  const match = cleanLine.match(/^\[download\]\s+(\d+(?:\.\d+)?)%/)

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

export async function updateDownloadJobProgress(jobId, overallPercent) {
  // 1. Validate the Download Job ID
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  // 2. Validate the overall progress percentage
  if (!Number.isFinite(overallPercent) || overallPercent < 0 || overallPercent > 100) {
    throw new Error('A valid progress percentage is required')
  }

  // 3. Keep progress below 100 until job completion
  const safePercent = Math.min(99, Math.round(overallPercent * 10) / 10)

  // 4. Get the DownloadJob model
  const DownloadJob = getDatabase().models.DownloadJob

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
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
    } catch (updateError) {
      if (isSqliteBusyError(updateError) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt))
        continue
      }
      throw updateError
    }
  }
}

export async function updateDownloadJobDownloadedBytes(
  jobId,
  downloadedBytes,
  totalBytes = null,
  totalBytesIsEstimate = false
) {
  // Validate incoming values
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error('A valid Download Job ID is required')
  }

  if (!Number.isSafeInteger(downloadedBytes) || downloadedBytes < 0) {
    throw new Error('Valid downloaded bytes are required')
  }

  const DownloadJob = getDatabase().models.DownloadJob

  const updateFields = {
    downloaded_bytes: downloadedBytes
  }

  if (Number.isFinite(totalBytes) && totalBytes > 0) {
    updateFields.total_bytes = totalBytes
    updateFields.total_bytes_is_estimate = Boolean(totalBytesIsEstimate)
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Update only an active job with higher byte count or newly known/changed total bytes
      const whereConditions = [
        {
          downloaded_bytes: {
            [Op.lt]: downloadedBytes
          }
        }
      ]

      if (Number.isFinite(totalBytes) && totalBytes > 0) {
        whereConditions.push({
          total_bytes: null
        })
        whereConditions.push({
          total_bytes: {
            [Op.ne]: totalBytes
          }
        })
      }

      const [updatedCount] = await DownloadJob.update(updateFields, {
        where: {
          id: jobId,
          status: 'downloading',
          [Op.or]: whereConditions
        }
      })

      if (updatedCount !== 1) {
        return null
      }

      return await DownloadJob.findByPk(jobId)
    } catch (updateError) {
      if (isSqliteBusyError(updateError) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt))
        continue
      }
      throw updateError
    }
  }
}

export function calculateOverallDownloadProgress(outputFormat, streamPercent) {
  // 1. Validate output format
  if (!['mp3', 'mp4'].includes(outputFormat)) {
    throw new Error('Unsupported output format')
  }

  // 2. Validate stream percentage
  if (!Number.isFinite(streamPercent) || streamPercent < 0 || streamPercent > 100) {
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
          data = JSON.parse(line.slice(downloadIndex + downloadMarker.length).trim())
        } catch {
          return null
        }

        // Each stream needs a valid filename
        if (!data || typeof data.filename !== 'string' || !data.filename) {
          return null
        }

        // Find previous progress for this stream
        const previous = streams.get(data.filename)

        // Extract downloaded bytes
        const downloadedBytes =
          Number.isFinite(data.downloaded_bytes) && data.downloaded_bytes >= 0
            ? data.downloaded_bytes
            : (previous?.downloadedBytes ?? 0)

        // Extract total bytes when available
        const hasExactTotal = Number.isFinite(data.total_bytes) && data.total_bytes > 0
        const hasEstimateTotal =
          Number.isFinite(data.total_bytes_estimate) && data.total_bytes_estimate > 0

        let totalBytes = null
        let totalBytesIsEstimate = false

        if (hasExactTotal) {
          totalBytes = data.total_bytes
          totalBytesIsEstimate = false
        } else if (hasEstimateTotal) {
          totalBytes = data.total_bytes_estimate
          totalBytesIsEstimate = true
        } else if (previous?.totalBytes) {
          totalBytes = previous.totalBytes
          totalBytesIsEstimate = previous.totalBytesIsEstimate ?? false
        }

        // Reuse the existing percentage parser
        const percent = parseYtDlpProgressLine(line)

        // Update only this stream's information
        streams.set(data.filename, {
          filename: data.filename,
          status: typeof data.status === 'string' ? data.status : (previous?.status ?? 'unknown'),
          downloadedBytes,
          totalBytes,
          totalBytesIsEstimate,
          percent: percent ?? previous?.percent ?? null
        })

        return getSnapshot()
      }

      // 6. Handle a structured postprocessing event
      if (postprocessIndex !== -1) {
        let data

        try {
          data = JSON.parse(line.slice(postprocessIndex + postprocessMarker.length).trim())
        } catch {
          return null
        }

        if (!data || typeof data.status !== 'string') {
          return null
        }

        postprocess = {
          status: data.status,
          postprocessor: typeof data.postprocessor === 'string' ? data.postprocessor : null
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

/**
 * Aggregates total transfer bytes and estimate indicator across active/finished streams.
 *
 * @param {Array<object>} streams
 * @returns {{ totalBytes: number|null, totalBytesIsEstimate: boolean }}
 */
export function aggregateStreamTotals(streams) {
  if (!Array.isArray(streams) || streams.length === 0) {
    return { totalBytes: null, totalBytesIsEstimate: false }
  }

  let aggregatedTotal = 0
  let isEstimate = false

  for (const stream of streams) {
    if (stream.status === 'finished') {
      const streamTotal =
        Number.isFinite(stream.totalBytes) && stream.totalBytes > 0
          ? stream.totalBytes
          : Number.isFinite(stream.downloadedBytes) && stream.downloadedBytes > 0
            ? stream.downloadedBytes
            : null

      if (streamTotal === null) {
        return { totalBytes: null, totalBytesIsEstimate: false }
      }
      aggregatedTotal += streamTotal
      if (stream.totalBytesIsEstimate) {
        isEstimate = true
      }
    } else {
      if (!Number.isFinite(stream.totalBytes) || stream.totalBytes <= 0) {
        return { totalBytes: null, totalBytesIsEstimate: false }
      }
      aggregatedTotal += stream.totalBytes
      if (stream.totalBytesIsEstimate) {
        isEstimate = true
      }
    }
  }

  return {
    totalBytes: aggregatedTotal > 0 ? aggregatedTotal : null,
    totalBytesIsEstimate: isEstimate
  }
}

//MP4 Overall Download Progress Calculator
export function calculateMp4OverallProgress(snapshot) {
  // 1. Validate the tracker snapshot
  if (!snapshot || !Array.isArray(snapshot.streams)) {
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

    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return null
    }

    return percent
  }

  // 5. Read progress for the two download stages
  const firstStreamPercent = getStreamPercent(streams[0])

  const secondStreamPercent = streams.length === 2 ? getStreamPercent(streams[1]) : 0

  if (firstStreamPercent === null || secondStreamPercent === null) {
    return null
  }

  // 6. Allocate 45% to each download stream
  let overallPercent = firstStreamPercent * 0.45 + secondStreamPercent * 0.45

  // 7. Reserve the remaining progress for processing
  const postprocess = snapshot.postprocess

  if (['Merger', 'FFmpegMerger'].includes(postprocess?.postprocessor)) {
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
  return Math.min(99, Math.round(overallPercent * 10) / 10)
}
