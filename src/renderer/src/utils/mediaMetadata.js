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
 * Extracts format availability from analyzed media metadata.
 *
 * MP4 is available if availableFormats.mp4Qualities has at least one quality option.
 * MP3 is available if audioOptions includes 'mp3'.
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
      mp4Available: true,
      mp3Available: true,
      mp4Qualities: [],
      defaultFormat: 'mp4'
    }
  }

  const mp4Qualities = Array.isArray(analyzedMedia.availableFormats?.mp4Qualities)
    ? analyzedMedia.availableFormats.mp4Qualities
    : []

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
