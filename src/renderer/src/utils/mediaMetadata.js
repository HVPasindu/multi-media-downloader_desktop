/**
 * Media Metadata Utility Functions
 *
 * Pure helper functions for duration formatting and format availability extraction.
 */

/**
 * Formats a duration in seconds into a human-readable string (e.g. "0:45", "3:42", "1:01:05").
 *
 * @param {number|null|undefined} seconds - Total duration in seconds
 * @returns {string|null} Formatted duration or null if unavailable
 */
export function formatMediaDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return null
  }

  const totalSeconds = Math.floor(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const remainingSeconds = totalSeconds % 3600
  const minutes = Math.floor(remainingSeconds / 60)
  const secs = remainingSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * Extracts verified MP4-compatible qualities from media metadata.
 * Uses availableFormats.mp4Qualities as primary source, falling back to
 * availableFormats.mp4Formats when present.
 * Does not fall back to generic unverified videoQualities.
 * Deduplicates and sorts resolutions descending (highest to lowest).
 *
 * @param {object|null|undefined} analyzedMedia
 * @returns {string[]}
 */
export function extractMp4Qualities(analyzedMedia) {
  if (!analyzedMedia || typeof analyzedMedia !== 'object') {
    return []
  }

  let rawList = []
  if (
    Array.isArray(analyzedMedia.availableFormats?.mp4Qualities) &&
    analyzedMedia.availableFormats.mp4Qualities.length > 0
  ) {
    rawList = analyzedMedia.availableFormats.mp4Qualities
  } else if (
    Array.isArray(analyzedMedia.availableFormats?.mp4Formats) &&
    analyzedMedia.availableFormats.mp4Formats.length > 0
  ) {
    rawList = analyzedMedia.availableFormats.mp4Formats
      .map((f) => {
        if (typeof f?.quality === 'string' && f.quality.trim()) return f.quality.trim()
        if (Number.isInteger(f?.height) && f.height > 0) return `${f.height}p`
        return null
      })
      .filter(Boolean)
  }

  // Deduplicate and filter out any invalid string
  const unique = [...new Set(rawList.filter((q) => typeof q === 'string' && q.trim()))]

  // Sort resolutions from highest to lowest (e.g. 2160p -> 1440p -> 1080p -> 720p -> 480p)
  unique.sort((a, b) => {
    const numA = parseInt(a, 10) || 0
    const numB = parseInt(b, 10) || 0
    return numB - numA
  })

  return unique
}

/**
 * Extracts format availability from analyzed media metadata.
 *
 * MP4 is available if verified MP4 qualities exist.
 * MP3 is available if audioOptions includes 'mp3'.
 * When media has not been analyzed or is null, both formats are unavailable and defaultFormat is null.
 *
 * @param {object|null|undefined} analyzedMedia - Media object returned from backend
 * @returns {{
 *   mp4Available: boolean,
 *   mp3Available: boolean,
 *   mp4Qualities: string[],
 *   defaultFormat: 'mp4' | 'mp3' | null
 * }}
 */
export function getMediaFormatAvailability(analyzedMedia) {
  if (!analyzedMedia || typeof analyzedMedia !== 'object') {
    return {
      mp4Available: false,
      mp3Available: false,
      mp4Qualities: [],
      defaultFormat: null
    }
  }

  const mp4Qualities = extractMp4Qualities(analyzedMedia)
  const mp4Available = mp4Qualities.length > 0

  const audioOptions = Array.isArray(analyzedMedia.audioOptions) ? analyzedMedia.audioOptions : []
  const mp3Available = audioOptions.includes('mp3')

  let defaultFormat = null
  if (mp4Available && !mp3Available) {
    defaultFormat = 'mp4'
  } else if (!mp4Available && mp3Available) {
    defaultFormat = 'mp3'
  } else if (mp4Available && mp3Available) {
    defaultFormat = 'mp4'
  }

  return {
    mp4Available,
    mp3Available,
    mp4Qualities,
    defaultFormat
  }
}

/**
 * Formats a raw number of bytes into a human-readable string with units (e.g. 452 MB, 1.2 GB).
 *
 * @param {number|null|undefined} bytes - Total bytes
 * @param {number} [decimals=1] - Decimal precision
 * @returns {string|null} Formatted size string or null if invalid
 */
export function formatBytes(bytes, decimals = 1) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return null
  }
  if (bytes === 0) return '0 B'

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const clampedIndex = Math.min(i, sizes.length - 1)

  return `${parseFloat((bytes / Math.pow(k, clampedIndex)).toFixed(dm))} ${sizes[clampedIndex]}`
}

/**
 * Estimates the file size for an MP4 quality option based on analyzed metadata
 * and the backend's format-selection rules.
 *
 * @param {object|null|undefined} analyzedMedia
 * @param {string} [requestedQuality='best'] - Resolution string (e.g. '1080p') or 'best'
 * @returns {string} Formatted size (e.g. "~52 MB" or "Size unavailable")
 */
export function estimateMp4QualitySize(analyzedMedia, requestedQuality = 'best') {
  if (!analyzedMedia || typeof analyzedMedia !== 'object') {
    return 'Size unavailable'
  }

  const mp4Qualities = extractMp4Qualities(analyzedMedia)
  if (!mp4Qualities || mp4Qualities.length === 0) {
    return 'Size unavailable'
  }

  let targetQuality = requestedQuality
  if (
    !targetQuality ||
    targetQuality === 'best' ||
    targetQuality === 'Best' ||
    !mp4Qualities.includes(targetQuality)
  ) {
    targetQuality = mp4Qualities[0]
  }

  const availableFormats = analyzedMedia.availableFormats || {}
  const mp4Formats = Array.isArray(availableFormats.mp4Formats) ? availableFormats.mp4Formats : []
  const audioFormats = Array.isArray(availableFormats.audioFormats)
    ? availableFormats.audioFormats
    : []

  const hasFormatId = (format) =>
    typeof format?.formatId === 'string' && format.formatId.trim().length > 0

  const matchingVideos = mp4Formats.filter(
    (format) =>
      (format?.quality === targetQuality || `${format?.height}p` === targetQuality) &&
      hasFormatId(format)
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

  // 2. Combined stream
  const combinedVideo = [...matchingVideos]
    .reverse()
    .find((format) => format.audioIncluded === true)

  if (videoOnly && compatibleAudio) {
    const vSize = Number(videoOnly.fileSize)
    const aSize = Number(compatibleAudio.fileSize)
    if (!Number.isFinite(vSize) || vSize <= 0 || !Number.isFinite(aSize) || aSize <= 0) {
      return 'Size unavailable'
    }
    const totalBytes = vSize + aSize
    const isApprox = Boolean(videoOnly.isApproximate || compatibleAudio.isApproximate)
    const formatted = formatBytes(totalBytes)
    return formatted ? (isApprox ? `~${formatted}` : formatted) : 'Size unavailable'
  } else if (combinedVideo) {
    const cSize = Number(combinedVideo.fileSize)
    if (!Number.isFinite(cSize) || cSize <= 0) {
      return 'Size unavailable'
    }
    const isApprox = Boolean(combinedVideo.isApproximate)
    const formatted = formatBytes(cSize)
    return formatted ? (isApprox ? `~${formatted}` : formatted) : 'Size unavailable'
  }

  return 'Size unavailable'
}

/**
 * Estimates MP3 output file size based on duration and bitrate.
 * Formula: (durationSeconds * bitrateKbps * 1000) / 8
 *
 * @param {object|null|undefined} analyzedMedia
 * @param {number|string} bitrateKbps - e.g. 128, 192, 320
 * @returns {string} Formatted size (e.g. "~5.2 MB" or "Size unavailable")
 */
export function estimateMp3BitrateSize(analyzedMedia, bitrateKbps) {
  if (!analyzedMedia || typeof analyzedMedia !== 'object') {
    return 'Size unavailable'
  }

  const durationSeconds =
    Number.isFinite(analyzedMedia.durationSeconds) && analyzedMedia.durationSeconds > 0
      ? analyzedMedia.durationSeconds
      : Number.isFinite(analyzedMedia.duration) && analyzedMedia.duration > 0
        ? analyzedMedia.duration
        : null

  if (!durationSeconds) {
    return 'Size unavailable'
  }

  const numBitrate =
    typeof bitrateKbps === 'number'
      ? bitrateKbps
      : parseInt(String(bitrateKbps).replace(/\D+/g, ''), 10)

  if (!Number.isFinite(numBitrate) || numBitrate <= 0) {
    return 'Size unavailable'
  }

  const estimatedBytes = (durationSeconds * numBitrate * 1000) / 8
  const formatted = formatBytes(estimatedBytes)

  return formatted ? `~${formatted}` : 'Size unavailable'
}
