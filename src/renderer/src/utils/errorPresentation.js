/**
 * Centralized Error Presentation & Classification Utility
 *
 * Responsibilities:
 * 1. Extract error code from backend responses or "[CODE] message" strings.
 * 2. Map known machine-readable error codes to user-friendly titles and guidance.
 * 3. Provide safe fallbacks for unknown errors without displaying raw technical stack traces.
 */

export const ERROR_PRESENTATION_MAP = Object.freeze({
  YOUTUBE_RATE_LIMITED: {
    code: 'YOUTUBE_RATE_LIMITED',
    title: 'YouTube Rate Limited',
    guidance: 'Wait before retrying',
    defaultMessage: 'YouTube is temporarily limiting requests. Please wait before retrying.',
    isRetryable: true
  },
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    title: 'Too Many Requests',
    guidance: 'Try again later',
    defaultMessage: 'The media provider is temporarily limiting requests. Please try again later.',
    isRetryable: true
  },
  YOUTUBE_AUTH_REQUIRED: {
    code: 'YOUTUBE_AUTH_REQUIRED',
    title: 'Authentication Required',
    guidance: 'Check access or verification',
    defaultMessage: 'This video requires YouTube authentication or age verification.',
    isRetryable: false
  },
  AUTH_REQUIRED: {
    code: 'AUTH_REQUIRED',
    title: 'Login Required',
    guidance: 'Media requires authentication',
    defaultMessage: 'This media requires login or account authentication.',
    isRetryable: false
  },
  YOUTUBE_PO_TOKEN_REQUIRED: {
    code: 'YOUTUBE_PO_TOKEN_REQUIRED',
    title: 'YouTube PO Token Required',
    guidance: 'Additional verification data is required',
    defaultMessage: 'YouTube requires a Proof of Origin (PO) token for this video.',
    isRetryable: false
  },
  NETWORK_ERROR: {
    code: 'NETWORK_ERROR',
    title: 'Network Connection Error',
    guidance: 'Check internet connection',
    defaultMessage: 'Network connection failed. Check your internet connection and try again.',
    isRetryable: true
  },
  NETWORK_TIMEOUT: {
    code: 'NETWORK_TIMEOUT',
    title: 'Connection Timeout',
    guidance: 'Retry the operation',
    defaultMessage: 'The connection timed out. Please retry the operation.',
    isRetryable: true
  },
  INVALID_URL: {
    code: 'INVALID_URL',
    title: 'Invalid Media URL',
    guidance: 'Enter a supported link',
    defaultMessage: 'Please provide a valid supported media URL.',
    isRetryable: false
  },
  UNSUPPORTED_PLATFORM: {
    code: 'UNSUPPORTED_PLATFORM',
    title: 'Unsupported Platform',
    guidance: 'Use a supported media platform',
    defaultMessage: 'This platform is not currently supported.',
    isRetryable: false
  },
  MEDIA_UNAVAILABLE: {
    code: 'MEDIA_UNAVAILABLE',
    title: 'Media Unavailable',
    guidance: 'Check whether the media still exists',
    defaultMessage: 'This media is unavailable or has been removed.',
    isRetryable: false
  },
  SOURCE_ACCESS_DENIED: {
    code: 'SOURCE_ACCESS_DENIED',
    title: 'Access Denied',
    guidance: 'Check privacy and access permissions',
    defaultMessage: 'This media is private or access has been denied.',
    isRetryable: false
  },
  FORMAT_UNAVAILABLE: {
    code: 'FORMAT_UNAVAILABLE',
    title: 'Quality Unavailable',
    guidance: 'Select an available quality',
    defaultMessage: 'The requested media format or quality is not available.',
    isRetryable: false
  },
  DISK_FULL: {
    code: 'DISK_FULL',
    title: 'Storage Full',
    guidance: 'Free up disk space',
    defaultMessage: 'Not enough disk space to complete the download.',
    isRetryable: true
  },
  PERMISSION_DENIED: {
    code: 'PERMISSION_DENIED',
    title: 'Permission Denied',
    guidance: 'Check destination folder permissions',
    defaultMessage: 'The application does not have permission to write to the selected location.',
    isRetryable: true
  },
  FFPROBE_FAILED: {
    code: 'FFPROBE_FAILED',
    title: 'File Verification Failed',
    guidance: 'Retry verification/download as appropriate',
    defaultMessage: 'Media verification failed. The output has been preserved for retry.',
    isRetryable: true
  },
  FFMPEG_FAILED: {
    code: 'FFMPEG_FAILED',
    title: 'Media Processing Failed',
    guidance: 'Retry the download',
    defaultMessage: 'Audio or video processing failed. Please retry.',
    isRetryable: true
  },
  OUTPUT_VERIFICATION_FAILED: {
    code: 'OUTPUT_VERIFICATION_FAILED',
    title: 'File Verification Failed',
    guidance: 'Downloaded file could not be verified or is corrupted',
    defaultMessage: 'Downloaded file could not be verified or is corrupted.',
    isRetryable: true
  },
  YT_DLP_FAILED: {
    code: 'YT_DLP_FAILED',
    title: 'Engine Error',
    guidance: 'Retry the download',
    defaultMessage: 'Download engine encountered an error while processing the media.',
    isRetryable: true
  },
  YT_DLP_NOT_FOUND: {
    code: 'YT_DLP_NOT_FOUND',
    title: 'Engine Not Found',
    guidance: 'Ensure yt-dlp is available in the installation',
    defaultMessage: 'yt-dlp executable was not found.',
    isRetryable: false
  },
  FFMPEG_NOT_FOUND: {
    code: 'FFMPEG_NOT_FOUND',
    title: 'FFmpeg Not Found',
    guidance: 'Ensure FFmpeg tools are available',
    defaultMessage: 'FFmpeg executable was not found.',
    isRetryable: false
  },
  FFPROBE_NOT_FOUND: {
    code: 'FFPROBE_NOT_FOUND',
    title: 'FFprobe Not Found',
    guidance: 'Ensure FFprobe is available in PATH',
    defaultMessage: 'FFprobe executable was not found.',
    isRetryable: false
  },
  DATABASE_ERROR: {
    code: 'DATABASE_ERROR',
    title: 'Database Busy',
    guidance: 'Retry the operation',
    defaultMessage: 'The database was temporarily busy and could not complete the operation.',
    isRetryable: true
  },
  ANALYSIS_FAILED: {
    code: 'ANALYSIS_FAILED',
    title: 'Analysis Failed',
    guidance: 'Verify the URL and try again',
    defaultMessage: 'Failed to analyze media link. Please verify the URL and try again.',
    isRetryable: true
  },
  CANCELLED: {
    code: 'CANCELLED',
    title: 'Download Cancelled',
    guidance: 'Retry if you want to download again',
    defaultMessage: 'The download was cancelled.',
    isRetryable: true
  },
  UNKNOWN_ERROR: {
    code: 'UNKNOWN_ERROR',
    title: 'Download Failed',
    guidance: 'Retry or check the error details',
    defaultMessage: 'The download failed due to an unexpected error.',
    isRetryable: true
  }
})

/**
 * Extracts error code from a formatted message "[CODE] message" or null.
 *
 * @param {string|null|undefined} message
 * @returns {string|null}
 */
export function extractErrorCode(message) {
  if (typeof message !== 'string') return null
  const match = /^\[([A-Z0-9_]+)\]\s*(.*)$/.exec(message.trim())
  return match ? match[1] : null
}

/**
 * Extracts the user message without the "[CODE]" prefix.
 *
 * @param {string|null|undefined} message
 * @returns {string}
 */
export function extractCleanMessage(message) {
  if (typeof message !== 'string') return ''
  const match = /^\[([A-Z0-9_]+)\]\s*(.*)$/.exec(message.trim())
  return match ? match[2].trim() : message.trim()
}

/**
 * Translates an error code, raw error message, or error object into user-friendly presentation details.
 *
 * @param {string|object|null|undefined} errorOrCode - Error code, formatted message, or error response object
 * @param {string} [fallbackMessage] - Optional custom fallback message
 * @returns {{ code: string, title: string, message: string, guidance: string, isRetryable: boolean }}
 */
export function getFriendlyErrorInfo(errorOrCode, fallbackMessage = null) {
  let code = null
  let extractedMessage = null

  if (typeof errorOrCode === 'string') {
    const trimmed = errorOrCode.trim()
    const bracketCode = extractErrorCode(trimmed)
    if (bracketCode) {
      code = bracketCode
      extractedMessage = extractCleanMessage(trimmed)
    } else if (ERROR_PRESENTATION_MAP[trimmed]) {
      code = trimmed
    } else {
      extractedMessage = trimmed
    }
  } else if (errorOrCode && typeof errorOrCode === 'object') {
    code =
      errorOrCode.code ||
      errorOrCode.data?.code ||
      extractErrorCode(errorOrCode.message || errorOrCode.errorMessage || errorOrCode.error_message)

    extractedMessage =
      errorOrCode.userMessage ||
      errorOrCode.message ||
      errorOrCode.errorMessage ||
      errorOrCode.error_message ||
      (errorOrCode.data && (errorOrCode.data.userMessage || errorOrCode.data.message))
  }

  const normalizedCode = code && ERROR_PRESENTATION_MAP[code] ? code : 'UNKNOWN_ERROR'
  const mapping = ERROR_PRESENTATION_MAP[normalizedCode]

  const cleanExtracted = extractedMessage ? extractCleanMessage(extractedMessage) : null
  const finalMessage = cleanExtracted || fallbackMessage || mapping.defaultMessage

  return {
    code: normalizedCode,
    title: mapping.title,
    message: finalMessage,
    guidance: mapping.guidance,
    isRetryable: mapping.isRetryable
  }
}

const UNSAFE_ERROR_PATTERNS = [
  /\b(?:node_modules|node:internal|Sequelize\w*Error|SQLITE_[A-Z_]+|SQLSTATE|TypeError|ReferenceError|SyntaxError)\b/i,
  /(?:^|\n)\s*at\s+.+:\d+:\d+/i,
  /\b(?:authorization|cookie|set-cookie|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[:=]\s*\S+/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/i,
  /(?:^|[\s("'=])(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+\\[^\\/\s]+)/i,
  /(?:^|[\s("'=])\/(?:[^/\s"'<>|]+\/)*[^/\s"'<>|]+/i,
  /\b(?:SELECT\s+[\s\S]+?\s+FROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM)\b/i
]

/**
 * Checks whether an error message contains internal technical details,
 * system paths, database errors, secrets, tokens, or excessive length.
 *
 * @param {string|null|undefined} value
 * @returns {boolean}
 */
export function containsUnsafeErrorDetails(value) {
  const message = String(value ?? '').trim()

  if (!message || message.length > 240) {
    return true
  }

  return UNSAFE_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

/**
 * Enhanced safe wrapper around getFriendlyErrorInfo.
 * Guarantees that internal stack traces, technical database exceptions,
 * internal filesystem paths, tokens, and secrets are never exposed to users.
 * Checks BOTH the extracted error message and any caller-provided fallback message.
 *
 * @param {string|object|null|undefined} errorOrCode
 * @param {string} [fallbackMessage]
 * @returns {{ code: string, title: string, message: string, guidance: string, isRetryable: boolean }}
 */
export function getSafeFriendlyErrorInfo(errorOrCode, fallbackMessage = null) {
  const info = getFriendlyErrorInfo(errorOrCode, fallbackMessage)

  if (!containsUnsafeErrorDetails(info.message)) {
    return info
  }

  const safeFallback =
    typeof fallbackMessage === 'string' && !containsUnsafeErrorDetails(fallbackMessage)
      ? fallbackMessage.trim()
      : null

  const mapping = ERROR_PRESENTATION_MAP[info.code] || ERROR_PRESENTATION_MAP.UNKNOWN_ERROR

  return {
    ...info,
    message: safeFallback || mapping.defaultMessage
  }
}
