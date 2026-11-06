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
 * Safely parses and validates a positive numeric value.
 * Rejects null, undefined, empty strings, NaN, Infinity, and numbers <= 0.
 *
 * @param {any} val
 * @returns {number|null}
 */
function validPositiveNumber(val) {
  if (val === null || val === undefined || val === '') return null
  const num = Number(val)
  if (!Number.isFinite(num) || num <= 0) return null
  return num
}

/**
 * Safely parses a media duration string (e.g. "16:10", "0:30", "1:05:30") into total seconds.
 *
 * @param {string|any} durationStr
 * @returns {number|null} Total seconds or null if invalid
 */
function parseDurationString(durationStr) {
  if (typeof durationStr !== 'string') return null
  const trimmed = durationStr.trim()
  if (!trimmed) return null

  const parts = trimmed.split(':')
  if (parts.length < 2 || parts.length > 3) return null

  const numbers = []
  for (const part of parts) {
    const p = part.trim()
    if (!/^\d+$/.test(p)) return null
    numbers.push(parseInt(p, 10))
  }

  if (parts.length === 2) {
    const [minutes, seconds] = numbers
    if (seconds >= 60 && minutes > 0) return null
    return minutes * 60 + seconds
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = numbers
    if (minutes >= 60 || seconds >= 60) return null
    return hours * 3600 + minutes * 60 + seconds
  }

  return null
}

/**
 * Universal media duration resolver for frontend estimation.
 * Supports durationSeconds, numeric duration, numeric-string duration, and duration_string.
 *
 * @param {object|null|undefined} media
 * @returns {number|null} Total seconds or null
 */
export function resolveMediaDuration(media) {
  if (!media || typeof media !== 'object') return null

  const candidates = [
    media.durationSeconds,
    media.duration,
    media.duration_string,
    media.formats?.[0]?.duration,
    media.formats?.[0]?.duration_string
  ]

  for (const cand of candidates) {
    if (cand === null || cand === undefined || cand === '') continue

    // 1. Direct finite positive number
    if (typeof cand === 'number' && Number.isFinite(cand) && cand > 0) {
      return Math.floor(cand)
    }

    // 2. String representation
    if (typeof cand === 'string') {
      const trimmed = cand.trim()
      if (!trimmed) continue

      // Numeric string e.g. "74.304" or "970"
      if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
        const num = parseFloat(trimmed)
        if (Number.isFinite(num) && num > 0) {
          return Math.floor(num)
        }
      }

      // Colon-separated string e.g. "16:10", "0:30", "1:05:30"
      const parsed = parseDurationString(trimmed)
      if (parsed !== null && parsed > 0) {
        return parsed
      }
    }
  }

  return null
}

/**
 * Finds an equivalent same-quality format fallback (Section 5.4).
 * Same height/quality, same stream role (audioIncluded), compatible extension/codec,
 * with valid positive fileSize or valid bitrate.
 *
 * @param {object} targetFormat
 * @param {object[]} mp4Formats
 * @returns {object|null}
 */
function findEquivalentVideoFormat(targetFormat, mp4Formats) {
  if (!targetFormat || !Array.isArray(mp4Formats)) return null

  for (const candidate of mp4Formats) {
    if (!candidate) continue
    if (candidate === targetFormat) continue
    if (
      candidate.formatId &&
      targetFormat.formatId &&
      candidate.formatId === targetFormat.formatId
    ) {
      continue
    }

    // Same height & quality
    if (candidate.height !== targetFormat.height) continue
    if (candidate.quality !== targetFormat.quality) continue

    // Same video stream role (both video-only or both combined)
    if (Boolean(candidate.audioIncluded) !== Boolean(targetFormat.audioIncluded)) continue

    // Must have a valid positive fileSize or valid bitrate
    const cSize = validPositiveNumber(candidate.fileSize)
    const cBitrate =
      validPositiveNumber(candidate.videoBitrateKbps) ??
      validPositiveNumber(candidate.totalBitrateKbps)
    if (!cSize && !cBitrate) continue

    // Compatible container/extension
    const tExt = String(candidate.extension || 'mp4').toLowerCase()
    const cExt = String(targetFormat.extension || 'mp4').toLowerCase()
    if (tExt !== cExt && tExt !== 'mp4' && cExt !== 'mp4') continue

    // Compatible codec if both known
    const tCodec = String(targetFormat.videoCodec || '').toLowerCase()
    const cCodec = String(candidate.videoCodec || '').toLowerCase()
    if (tCodec && cCodec) {
      const isAvcT = tCodec.includes('avc') || tCodec.includes('h264')
      const isAvcC = cCodec.includes('avc') || cCodec.includes('h264')
      if (isAvcT && !isAvcC) continue
      if (!isAvcT && isAvcC) continue
    }

    return candidate
  }

  return null
}

/**
 * Estimates the file size for an MP4 quality option based on analyzed metadata
 * and the backend's format-selection rules.
 *
 * Universal Priority:
 * 1. Exact filesize
 * 2. filesize_approx
 * 3. Bitrate + duration calculation
 * 4. Verified equivalent same-quality format fallback
 * 5. Size unavailable
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

  if (matchingVideos.length === 0) {
    return 'Size unavailable'
  }

  const durationSeconds = resolveMediaDuration(analyzedMedia)

  // 1. Prefer video-only MP4 with separate compatible audio (following backend resolveMp4FormatSelector)
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
  const combinedVideos = matchingVideos.filter((format) => format.audioIncluded === true)
  const combinedVideo =
    [...combinedVideos].reverse().find((format) => {
      const hasSize = validPositiveNumber(format.fileSize)
      const hasBitrate =
        validPositiveNumber(format.totalBitrateKbps) ??
        (validPositiveNumber(format.videoBitrateKbps) &&
          validPositiveNumber(format.audioBitrateKbps))
      return Boolean(hasSize || hasBitrate)
    }) || [...combinedVideos].reverse()[0]

  // Scenario 1: Separate video + audio streams
  if (videoOnly && compatibleAudio) {
    let videoBytes = null
    let videoIsApprox = false

    const vExact = validPositiveNumber(videoOnly.fileSize)
    if (vExact) {
      videoBytes = vExact
      videoIsApprox = Boolean(videoOnly.isApproximate)
    } else if (durationSeconds) {
      const vBitrate =
        validPositiveNumber(videoOnly.videoBitrateKbps) ??
        validPositiveNumber(videoOnly.totalBitrateKbps)
      if (vBitrate) {
        videoBytes = (vBitrate * durationSeconds * 1000) / 8
        videoIsApprox = true
      }
    }

    // Equivalent same-quality format fallback (e.g. X Twitter HTTP format for HLS video)
    if (!videoBytes) {
      const equivVideo = findEquivalentVideoFormat(videoOnly, mp4Formats)
      if (equivVideo) {
        const equivSize = validPositiveNumber(equivVideo.fileSize)
        if (equivSize) {
          videoBytes = equivSize
          videoIsApprox = true
        } else if (durationSeconds) {
          const equivBitrate =
            validPositiveNumber(equivVideo.videoBitrateKbps) ??
            validPositiveNumber(equivVideo.totalBitrateKbps)
          if (equivBitrate) {
            videoBytes = (equivBitrate * durationSeconds * 1000) / 8
            videoIsApprox = true
          }
        }
      }
    }

    // Audio calculation
    let audioBytes = null
    let audioIsApprox = false

    const aExact = validPositiveNumber(compatibleAudio.fileSize)
    if (aExact) {
      audioBytes = aExact
      audioIsApprox = Boolean(compatibleAudio.isApproximate)
    } else if (durationSeconds) {
      const aBitrate =
        validPositiveNumber(compatibleAudio.audioBitrateKbps) ??
        validPositiveNumber(compatibleAudio.totalBitrateKbps)
      if (aBitrate) {
        audioBytes = (aBitrate * durationSeconds * 1000) / 8
        audioIsApprox = true
      }
    }

    if (videoBytes !== null && audioBytes !== null) {
      const totalBytes = videoBytes + audioBytes
      const isApprox = videoIsApprox || audioIsApprox
      const formatted = formatBytes(totalBytes)
      return formatted ? (isApprox ? `~${formatted}` : formatted) : 'Size unavailable'
    }
  }

  // Scenario 2: Combined video/audio stream
  if (combinedVideo) {
    let combinedBytes = null
    let combinedIsApprox = false

    const cExact = validPositiveNumber(combinedVideo.fileSize)
    if (cExact) {
      combinedBytes = cExact
      combinedIsApprox = Boolean(combinedVideo.isApproximate)
    } else if (durationSeconds) {
      const totalBitrate =
        validPositiveNumber(combinedVideo.totalBitrateKbps) ??
        (validPositiveNumber(combinedVideo.videoBitrateKbps) &&
        validPositiveNumber(combinedVideo.audioBitrateKbps)
          ? combinedVideo.videoBitrateKbps + combinedVideo.audioBitrateKbps
          : null)

      if (totalBitrate) {
        combinedBytes = (totalBitrate * durationSeconds * 1000) / 8
        combinedIsApprox = true
      }
    }

    // Equivalent same-quality format fallback
    if (!combinedBytes) {
      const equivCombined = findEquivalentVideoFormat(combinedVideo, mp4Formats)
      if (equivCombined) {
        const equivSize = validPositiveNumber(equivCombined.fileSize)
        if (equivSize) {
          combinedBytes = equivSize
          combinedIsApprox = true
        } else if (durationSeconds) {
          const equivBitrate =
            validPositiveNumber(equivCombined.totalBitrateKbps) ??
            (validPositiveNumber(equivCombined.videoBitrateKbps) &&
            validPositiveNumber(equivCombined.audioBitrateKbps)
              ? equivCombined.videoBitrateKbps + equivCombined.audioBitrateKbps
              : null)
          if (equivBitrate) {
            combinedBytes = (equivBitrate * durationSeconds * 1000) / 8
            combinedIsApprox = true
          }
        }
      }
    }

    if (combinedBytes !== null) {
      const formatted = formatBytes(combinedBytes)
      return formatted ? (combinedIsApprox ? `~${formatted}` : formatted) : 'Size unavailable'
    }
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

  const durationSeconds = resolveMediaDuration(analyzedMedia)

  if (!durationSeconds || durationSeconds <= 0) {
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
