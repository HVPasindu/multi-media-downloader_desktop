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
