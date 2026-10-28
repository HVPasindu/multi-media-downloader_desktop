// Machine-readable download error codes
export const DOWNLOAD_ERROR_CODES = Object.freeze({
  NETWORK_ERROR: 'NETWORK_ERROR',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  RATE_LIMITED: 'RATE_LIMITED',
  MEDIA_UNAVAILABLE: 'MEDIA_UNAVAILABLE',
  SOURCE_ACCESS_DENIED: 'SOURCE_ACCESS_DENIED',
  FORMAT_UNAVAILABLE: 'FORMAT_UNAVAILABLE',
  YT_DLP_NOT_FOUND: 'YT_DLP_NOT_FOUND',
  FFMPEG_NOT_FOUND: 'FFMPEG_NOT_FOUND',
  FFPROBE_NOT_FOUND: 'FFPROBE_NOT_FOUND',
  YT_DLP_FAILED: 'YT_DLP_FAILED',
  FFMPEG_FAILED: 'FFMPEG_FAILED',
  DISK_FULL: 'DISK_FULL',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  OUTPUT_VERIFICATION_FAILED: 'OUTPUT_VERIFICATION_FAILED',
  DATABASE_ERROR: 'DATABASE_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
})

// Safe, user-facing error messages corresponding to each error code
export const DEFAULT_ERROR_MESSAGES = Object.freeze({
  [DOWNLOAD_ERROR_CODES.NETWORK_ERROR]:
    'Network connection failed. Check your internet connection and try again.',
  [DOWNLOAD_ERROR_CODES.NETWORK_TIMEOUT]: 'The download connection timed out. Please try again.',
  [DOWNLOAD_ERROR_CODES.RATE_LIMITED]:
    'The media provider is temporarily limiting requests. Please try again later.',
  [DOWNLOAD_ERROR_CODES.MEDIA_UNAVAILABLE]: 'This media is unavailable or cannot be accessed.',
  [DOWNLOAD_ERROR_CODES.SOURCE_ACCESS_DENIED]:
    'This media requires access that is not available to the downloader.',
  [DOWNLOAD_ERROR_CODES.FORMAT_UNAVAILABLE]:
    'The requested media format or quality is not available.',
  [DOWNLOAD_ERROR_CODES.YT_DLP_NOT_FOUND]:
    'yt-dlp executable was not found. Please ensure yt-dlp is installed and available in PATH.',
  [DOWNLOAD_ERROR_CODES.FFMPEG_NOT_FOUND]:
    'FFmpeg executable was not found. Please ensure FFmpeg is installed and available in PATH.',
  [DOWNLOAD_ERROR_CODES.FFPROBE_NOT_FOUND]:
    'FFprobe executable was not found. FFmpeg tools must be available in PATH.',
  [DOWNLOAD_ERROR_CODES.YT_DLP_FAILED]:
    'Download engine encountered an error while processing the media.',
  [DOWNLOAD_ERROR_CODES.FFMPEG_FAILED]: 'Audio or video processing failed.',
  [DOWNLOAD_ERROR_CODES.DISK_FULL]: 'Not enough disk space to complete the download.',
  [DOWNLOAD_ERROR_CODES.PERMISSION_DENIED]:
    'The application does not have permission to write to the selected location.',
  [DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED]:
    'Downloaded file could not be verified or is corrupted.',
  [DOWNLOAD_ERROR_CODES.DATABASE_ERROR]:
    'The database was temporarily busy and could not record the download. Please retry.',
  [DOWNLOAD_ERROR_CODES.UNKNOWN_ERROR]: 'The download failed due to an unexpected error.'
})

/**
 * Custom error class for classified download failures.
 * Encapsulates machine-readable error codes and safe user messages while preserving internal causes.
 */
export class DownloadError extends Error {
  constructor(code, message = null, options = {}) {
    const defaultMsg = DEFAULT_ERROR_MESSAGES[code] || DEFAULT_ERROR_MESSAGES.UNKNOWN_ERROR
    const finalMsg = message || defaultMsg

    super(finalMsg, { cause: options.cause })

    this.name = 'DownloadError'
    this.code = code
    this.userMessage = finalMsg
    this.details = options.details ?? null
  }
}

/**
 * Classifies an unknown error or child process failure into a structured category.
 *
 * @param {Error|string|object} error
 * @param {object} [context={}]
 * @param {string} [context.target] - Target tool or process name ('yt-dlp', 'ffmpeg', 'ffprobe')
 * @param {string} [context.step] - Step name ('file_verification', 'preparation', etc.)
 * @param {string} [context.stderr] - Process stderr diagnostics
 * @returns {{ code: string, message: string, isCancelled?: boolean, technicalDetails?: string }}
 */
export function classifyDownloadError(error, context = {}) {
  // 1. Preserve intentional download cancellation
  if (
    error?.name === 'DownloadCancelledError' ||
    error?.isCancelled === true ||
    context?.isCancelled === true
  ) {
    return {
      code: 'CANCELLED',
      message: 'Download was cancelled',
      isCancelled: true
    }
  }

  // 2. Already classified DownloadError
  if (error instanceof DownloadError) {
    return {
      code: error.code,
      message:
        error.userMessage ||
        DEFAULT_ERROR_MESSAGES[error.code] ||
        DEFAULT_ERROR_MESSAGES.UNKNOWN_ERROR,
      technicalDetails: error.message
    }
  }

  // 3. Already formatted message check: "[CODE] Message"
  const rawErrorMessage = typeof error === 'string' ? error : error?.message
  if (typeof rawErrorMessage === 'string' && /^\[[A-Z_]+\]\s/.test(rawErrorMessage)) {
    const match = rawErrorMessage.match(/^\[([A-Z_]+)\]\s+(.*)$/)
    if (match && DOWNLOAD_ERROR_CODES[match[1]]) {
      return {
        code: match[1],
        message: match[2].trim(),
        technicalDetails: rawErrorMessage
      }
    }
  }

  // 4. Inspect Node.js system error codes
  const systemCode = error?.code || error?.cause?.code || context?.code

  if (systemCode === 'ENOSPC') {
    return {
      code: DOWNLOAD_ERROR_CODES.DISK_FULL,
      message: DEFAULT_ERROR_MESSAGES.DISK_FULL
    }
  }

  if (['EACCES', 'EPERM', 'EROFS'].includes(systemCode)) {
    return {
      code: DOWNLOAD_ERROR_CODES.PERMISSION_DENIED,
      message: DEFAULT_ERROR_MESSAGES.PERMISSION_DENIED
    }
  }

  if (systemCode === 'ENOENT') {
    const target = (context?.target || '').toLowerCase()
    const msg = (rawErrorMessage || '').toLowerCase()

    if (target === 'yt-dlp' || msg.includes('yt-dlp')) {
      return {
        code: DOWNLOAD_ERROR_CODES.YT_DLP_NOT_FOUND,
        message: DEFAULT_ERROR_MESSAGES.YT_DLP_NOT_FOUND
      }
    }

    if (target === 'ffmpeg' || msg.includes('ffmpeg')) {
      return {
        code: DOWNLOAD_ERROR_CODES.FFMPEG_NOT_FOUND,
        message: DEFAULT_ERROR_MESSAGES.FFMPEG_NOT_FOUND
      }
    }

    if (target === 'ffprobe' || msg.includes('ffprobe')) {
      return {
        code: DOWNLOAD_ERROR_CODES.FFPROBE_NOT_FOUND,
        message: DEFAULT_ERROR_MESSAGES.FFPROBE_NOT_FOUND
      }
    }

    if (context?.step === 'file_verification' || msg.includes('downloaded file does not exist')) {
      return {
        code: DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
        message: DEFAULT_ERROR_MESSAGES.OUTPUT_VERIFICATION_FAILED
      }
    }
  }

  if (
    [
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ENETUNREACH',
      'EHOSTUNREACH',
      'EPIPE'
    ].includes(systemCode)
  ) {
    return {
      code: DOWNLOAD_ERROR_CODES.NETWORK_ERROR,
      message: DEFAULT_ERROR_MESSAGES.NETWORK_ERROR
    }
  }

  if (systemCode === 'ETIMEDOUT') {
    return {
      code: DOWNLOAD_ERROR_CODES.NETWORK_TIMEOUT,
      message: DEFAULT_ERROR_MESSAGES.NETWORK_TIMEOUT
    }
  }

  // 5. Inspect combined text diagnostics (message + stderr)
  const rawTexts = [rawErrorMessage, context?.stderr, error?.cause?.message, context?.errorOutput]

  const combinedText = rawTexts.filter((t) => typeof t === 'string' && t.trim()).join(' ')
  const lowerText = combinedText.toLowerCase()

  // Rate Limiting (HTTP 429)
  if (
    lowerText.includes('429') ||
    lowerText.includes('too many requests') ||
    lowerText.includes('rate-limited') ||
    lowerText.includes('rate limited')
  ) {
    return {
      code: DOWNLOAD_ERROR_CODES.RATE_LIMITED,
      message: DEFAULT_ERROR_MESSAGES.RATE_LIMITED
    }
  }

  // Media Unavailable (404 / Video unavailable / Content removed)
  if (
    lowerText.includes('video unavailable') ||
    lowerText.includes('this video is unavailable') ||
    lowerText.includes('this video has been removed') ||
    lowerText.includes('video not found') ||
    lowerText.includes('content is not available') ||
    lowerText.includes('http error 404') ||
    lowerText.includes('404 not found') ||
    lowerText.includes('media item or source url not found') ||
    lowerText.includes('the playlist does not exist')
  ) {
    return {
      code: DOWNLOAD_ERROR_CODES.MEDIA_UNAVAILABLE,
      message: DEFAULT_ERROR_MESSAGES.MEDIA_UNAVAILABLE
    }
  }

  // Source Access Restrictions (401 / 403 / Login / Private)
  if (
    lowerText.includes('http error 401') ||
    lowerText.includes('http error 403') ||
    lowerText.includes('403 forbidden') ||
    lowerText.includes('sign in to confirm your age') ||
    lowerText.includes('login required') ||
    lowerText.includes('private video') ||
    lowerText.includes('this video requires payment') ||
    lowerText.includes('members-only') ||
    lowerText.includes('account has been terminated')
  ) {
    return {
      code: DOWNLOAD_ERROR_CODES.SOURCE_ACCESS_DENIED,
      message: DEFAULT_ERROR_MESSAGES.SOURCE_ACCESS_DENIED
    }
  }

  // Missing tools reported in process diagnostics
  if (lowerText.includes('ffprobe was not found') || lowerText.includes('ffprobe: not found')) {
    return {
      code: DOWNLOAD_ERROR_CODES.FFPROBE_NOT_FOUND,
      message: DEFAULT_ERROR_MESSAGES.FFPROBE_NOT_FOUND
    }
  }

  if (
    lowerText.includes('ffmpeg not found') ||
    lowerText.includes('ffmpeg was not found') ||
    lowerText.includes('please install ffmpeg')
  ) {
    return {
      code: DOWNLOAD_ERROR_CODES.FFMPEG_NOT_FOUND,
      message: DEFAULT_ERROR_MESSAGES.FFMPEG_NOT_FOUND
    }
  }

  if (lowerText.includes('yt-dlp: not found') || lowerText.includes('yt-dlp was not found')) {
    return {
      code: DOWNLOAD_ERROR_CODES.YT_DLP_NOT_FOUND,
      message: DEFAULT_ERROR_MESSAGES.YT_DLP_NOT_FOUND
    }
  }

  // Unsupported or unavailable media format
  if (
    lowerText.includes('requested format is not available') ||
    lowerText.includes('requested video quality') ||
    lowerText.includes('no compatible mp4 video/audio format found') ||
    lowerText.includes('unsupported mp4 quality') ||
    lowerText.includes('format is not available')
  ) {
    const isSpecific =
      typeof rawErrorMessage === 'string' &&
      (rawErrorMessage.includes('Requested video quality') ||
        rawErrorMessage.includes('Unsupported MP4 quality'))
    return {
      code: DOWNLOAD_ERROR_CODES.FORMAT_UNAVAILABLE,
      message: isSpecific ? rawErrorMessage : DEFAULT_ERROR_MESSAGES.FORMAT_UNAVAILABLE
    }
  }

  // Disk full reported in stderr
  if (
    lowerText.includes('no space left on device') ||
    lowerText.includes('disk full') ||
    lowerText.includes('not enough disk space')
  ) {
    return {
      code: DOWNLOAD_ERROR_CODES.DISK_FULL,
      message: DEFAULT_ERROR_MESSAGES.DISK_FULL
    }
  }

  // Filesystem permission denied reported in stderr
  if (lowerText.includes('permission denied') || lowerText.includes('operation not permitted')) {
    return {
      code: DOWNLOAD_ERROR_CODES.PERMISSION_DENIED,
      message: DEFAULT_ERROR_MESSAGES.PERMISSION_DENIED
    }
  }

  // FFmpeg Processing / Conversion failure
  if (
    lowerText.includes('error running ffmpeg') ||
    lowerText.includes('postprocessing: error') ||
    lowerText.includes('conversion failed') ||
    lowerText.includes('audio conversion failed') ||
    lowerText.includes('ffmpeg error')
  ) {
    return {
      code: DOWNLOAD_ERROR_CODES.FFMPEG_FAILED,
      message: DEFAULT_ERROR_MESSAGES.FFMPEG_FAILED
    }
  }

  // Network Timeout in stderr
  if (
    lowerText.includes('the read operation timed out') ||
    lowerText.includes('connection timed out') ||
    lowerText.includes('socket.timeout') ||
    lowerText.includes('operation timed out')
  ) {
    return {
      code: DOWNLOAD_ERROR_CODES.NETWORK_TIMEOUT,
      message: DEFAULT_ERROR_MESSAGES.NETWORK_TIMEOUT
    }
  }

  // Network Error in stderr
  if (
    lowerText.includes('unable to download webpage') ||
    lowerText.includes('getaddrinfo failed') ||
    lowerText.includes('failed to resolve') ||
    lowerText.includes('network is unreachable') ||
    lowerText.includes('connection reset by peer') ||
    lowerText.includes('remote end closed connection') ||
    lowerText.includes('incompleteread') ||
    lowerText.includes('network error')
  ) {
    return {
      code: DOWNLOAD_ERROR_CODES.NETWORK_ERROR,
      message: DEFAULT_ERROR_MESSAGES.NETWORK_ERROR
    }
  }

  // Output verification failure
  if (
    context?.step === 'file_verification' ||
    lowerText.includes('final mp3 verification failed') ||
    lowerText.includes('final mp4 verification failed') ||
    lowerText.includes('final media verification failed') ||
    lowerText.includes('downloaded file does not exist') ||
    lowerText.includes('downloaded path is not a file') ||
    lowerText.includes('downloaded file is empty') ||
    lowerText.includes('downloaded file format does not match') ||
    lowerText.includes('yt-dlp did not return a final file path')
  ) {
    return {
      code: DOWNLOAD_ERROR_CODES.OUTPUT_VERIFICATION_FAILED,
      message: DEFAULT_ERROR_MESSAGES.OUTPUT_VERIFICATION_FAILED
    }
  }

  // General yt-dlp execution error
  if (lowerText.includes('yt-dlp failed') || context?.target === 'yt-dlp') {
    return {
      code: DOWNLOAD_ERROR_CODES.YT_DLP_FAILED,
      message: DEFAULT_ERROR_MESSAGES.YT_DLP_FAILED
    }
  }

  // Database locking or access error (SQLite busy/locked or SequelizeTimeoutError)
  if (
    error?.name === 'SequelizeTimeoutError' ||
    error?.name === 'SequelizeDatabaseError' ||
    lowerText.includes('sqlite_busy') ||
    lowerText.includes('database is locked') ||
    lowerText.includes('database locked')
  ) {
    return {
      code: DOWNLOAD_ERROR_CODES.DATABASE_ERROR,
      message: DEFAULT_ERROR_MESSAGES.DATABASE_ERROR
    }
  }

  // Safe fallback for unclassified errors
  return {
    code: DOWNLOAD_ERROR_CODES.UNKNOWN_ERROR,
    message: DEFAULT_ERROR_MESSAGES.UNKNOWN_ERROR
  }
}

/**
 * Formats an error into a standardized, backwards-compatible string representation for SQLite storage.
 * e.g. "[NETWORK_TIMEOUT] The download connection timed out. Please try again."
 *
 * @param {Error|string|object} error
 * @param {object} [context={}]
 * @returns {string}
 */
export function formatDownloadErrorMessage(error, context = {}) {
  const classified = classifyDownloadError(error, context)
  if (classified.isCancelled) {
    return 'Download was cancelled'
  }
  return `[${classified.code}] ${classified.message}`
}
