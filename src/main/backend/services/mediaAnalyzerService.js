import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { detectPlatform } from '../providers/providerManager.js'
import { resolveYtDlpPath, resolveJavaScriptRuntimeOption } from './executablePathService.js'

const execFileAsync = promisify(execFile)

// Configuration constants for in-memory analysis cache
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes TTL
const MAX_CACHE_ENTRIES = 100

// In-memory cache for parsed metadata: cleanUrl -> { data, timestamp }
const metadataCache = new Map()

// In-flight pending analysis promises: cleanUrl -> Promise
const pendingAnalysisPromises = new Map()

// Rate-limiting cooldowns: platform -> cooldownUntil timestamp ms
const rateLimitCooldowns = new Map()

/**
 * Prunes expired cache entries and evicts oldest entries if capacity is exceeded.
 */
function pruneMetadataCache() {
  const now = Date.now()
  for (const [key, entry] of metadataCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      metadataCache.delete(key)
    }
  }

  while (metadataCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = metadataCache.keys().next().value
    if (oldestKey) {
      metadataCache.delete(oldestKey)
    } else {
      break
    }
  }
}

/**
 * Resets the in-memory analysis cache, pending promises, and cooldowns.
 * Used for testing and explicit cache clearing.
 */
export function clearMediaAnalysisCache() {
  metadataCache.clear()
  pendingAnalysisPromises.clear()
  rateLimitCooldowns.clear()
}

/**
 * Returns remaining cooldown seconds for a platform (0 if not in cooldown).
 * Used for testing and monitoring.
 *
 * @param {string} platform
 * @returns {number}
 */
export function getRateLimitCooldown(platform) {
  const cooldownUntil = rateLimitCooldowns.get(platform) || 0
  return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
}

/**
 * Classifies an error thrown by yt-dlp or the analyzer into a structured error.
 * Ensures internal paths or raw child_process stderr are never leaked directly to users.
 *
 * Priority order:
 * 1. PO Token / Visitor Data required (must NOT be masked by generic rate limit or auth)
 * 2. Bot verification / Authentication required
 * 3. HTTP 429 Rate limiting (explicit rate-limit indicators, not arbitrary 429 substrings)
 * 4. Network / Connectivity errors
 * 5. General analysis failure
 *
 * @param {Error|any} error - The caught error
 * @param {string} [platform] - The target platform ('youtube', etc.)
 * @returns {{ code: string, userMessage: string, retryAfterSeconds: number|null }}
 */
export function classifyAnalysisError(error, platform) {
  const message = String(error?.message || '')
  const stderr = String(error?.stderr || '')
  const combined = `${message} ${stderr}`
  const isYouTube =
    String(platform || '')
      .toLowerCase()
      .trim() === 'youtube'

  // 1. YouTube PO Token / Visitor Data Required (Priority 1 - Strictly YouTube)
  if (
    isYouTube &&
    /po[-_ ]token|proof[- ]of[- ]origin|visitor[-_ ]data|visitorData/i.test(combined)
  ) {
    return {
      code: 'YOUTUBE_PO_TOKEN_REQUIRED',
      userMessage:
        'YouTube requires additional verification data (PO Token). This video cannot be analyzed directly.',
      retryAfterSeconds: null
    }
  }

  // 2. Bot Verification / Authentication Required (Priority 2)
  if (
    /sign in to confirm (?:you(?:'|’)?re not a bot|your age)|confirm you(?:'|’)?re not a bot|bot verification|this video is private|private video|sign in to view this video|requires authentication|login required|members-only/i.test(
      combined
    )
  ) {
    if (isYouTube) {
      return {
        code: 'YOUTUBE_AUTH_REQUIRED',
        userMessage:
          'YouTube requires authentication or bot verification. This video cannot be analyzed directly.',
        retryAfterSeconds: null
      }
    }
    return {
      code: 'AUTH_REQUIRED',
      userMessage: 'This media requires authentication, login, or is private.',
      retryAfterSeconds: null
    }
  }

  // 3. HTTP 429 Rate Limiting (Priority 3 - Must match explicit HTTP 429 / Rate limit, not arbitrary 429 numbers)
  if (
    /(?:http\s*error\s*429|429\s*too\s*many\s*requests|too\s*many\s*requests|\brate[- ]limit(?:ed|ing)?\b|\b429\s+error\b)/i.test(
      combined
    )
  ) {
    if (isYouTube) {
      return {
        code: 'YOUTUBE_RATE_LIMITED',
        userMessage: 'YouTube rate limit encountered (HTTP 429). Please wait before retrying.',
        retryAfterSeconds: 60
      }
    }
    return {
      code: 'RATE_LIMITED',
      userMessage: 'Rate limit encountered (HTTP 429). Please wait before retrying.',
      retryAfterSeconds: 60
    }
  }

  // 4. Network / Connectivity Error (Priority 4)
  if (
    /\b(?:ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)\b|network is unreachable|timed out|Temporary failure in name resolution|getaddrinfo\s+(?:ENOTFOUND|failed)|unable to connect/i.test(
      combined
    )
  ) {
    return {
      code: 'NETWORK_ERROR',
      userMessage: 'Unable to connect to the media server. Please check your internet connection.',
      retryAfterSeconds: null
    }
  }

  // 5. Default analysis failure
  return {
    code: 'ANALYSIS_FAILED',
    userMessage:
      'Failed to extract media information from this link. Please check the URL and try again.',
    retryAfterSeconds: null
  }
}

let testAnalyzer = null

export function setAnalyzerForTesting(analyzer) {
  testAnalyzer = analyzer
}

export function resetAnalyzerForTesting() {
  testAnalyzer = null
}

export async function analyzeMedia(sourceUrl) {
  if (testAnalyzer) {
    return await testAnalyzer(sourceUrl)
  }
  const platform = detectPlatform(sourceUrl)

  if (!platform) {
    const err = new Error('Unsupported or invalid media URL')
    err.code = 'INVALID_URL'
    err.userMessage = 'Unsupported or invalid media URL'
    throw err
  }

  const cleanUrl = sourceUrl.trim()

  // 1. Check in-memory metadata cache (10m TTL)
  const cached = metadataCache.get(cleanUrl)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data
  }

  // 2. Deduplicate simultaneous in-flight requests for the same URL
  if (pendingAnalysisPromises.has(cleanUrl)) {
    return await pendingAnalysisPromises.get(cleanUrl)
  }

  // 3. Guard against active rate-limit cooldown
  const cooldownUntil = rateLimitCooldowns.get(platform) || 0
  if (Date.now() < cooldownUntil) {
    const remainingSeconds = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000))
    const isYt =
      String(platform || '')
        .toLowerCase()
        .trim() === 'youtube'
    const err = new Error(
      isYt
        ? 'YouTube rate limit cooldown active. Please wait before retrying.'
        : 'Rate limit cooldown active. Please wait before retrying.'
    )
    err.code = isYt ? 'YOUTUBE_RATE_LIMITED' : 'RATE_LIMITED'
    err.userMessage = err.message
    err.retryAfterSeconds = remainingSeconds
    throw err
  }

  // 4. Create and register the in-flight extraction promise
  const analysisPromise = (async () => {
    try {
      // Step 04.43 - Resolve executable and runtime for packaged/dev environment
      const ytDlpExecutable = await resolveYtDlpPath()
      const jsRuntimeOption = await resolveJavaScriptRuntimeOption()

      let stdout = null
      let lastExecError = null

      // Attempt extraction with a 1-shot retry for temporary network errors
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await execFileAsync(
            ytDlpExecutable,
            [
              '--js-runtimes',
              jsRuntimeOption,
              '--no-playlist',
              '--dump-single-json',
              '--skip-download',
              cleanUrl
            ],
            {
              windowsHide: true,
              timeout: 60000,
              maxBuffer: 20 * 1024 * 1024
            }
          )
          stdout = res.stdout
          break
        } catch (execErr) {
          lastExecError = execErr
          const classified = classifyAnalysisError(execErr, platform)
          if (classified.code === 'NETWORK_ERROR' && attempt === 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            continue
          }
          break
        }
      }

      if (!stdout) {
        const classified = classifyAnalysisError(lastExecError, platform)
        if (classified.code === 'YOUTUBE_RATE_LIMITED' || classified.code === 'RATE_LIMITED') {
          rateLimitCooldowns.set(platform, Date.now() + 60_000)
        }
        const err = new Error(classified.userMessage)
        err.code = classified.code
        err.userMessage = classified.userMessage
        err.retryAfterSeconds = classified.retryAfterSeconds
        throw err
      }

      // Parse yt-dlp metadata safely
      let metadata
      try {
        metadata = JSON.parse(stdout)
      } catch {
        const err = new Error('Media Analyzer returned invalid JSON metadata')
        err.code = 'ANALYSIS_FAILED'
        err.userMessage = 'Media Analyzer returned invalid JSON metadata'
        throw err
      }

      const parsed = parseMediaMetadata(metadata, platform, cleanUrl)

      // Prune and store in memory cache upon successful analysis
      pruneMetadataCache()
      metadataCache.set(cleanUrl, {
        data: parsed,
        timestamp: Date.now()
      })

      return parsed
    } finally {
      // Always remove from in-flight pending promises
      pendingAnalysisPromises.delete(cleanUrl)
    }
  })()

  pendingAnalysisPromises.set(cleanUrl, analysisPromise)
  return await analysisPromise
}

/**
 * Safely parses and validates a positive numeric value.
 * Rejects null, undefined, empty strings, NaN, Infinity, and numbers <= 0.
 *
 * @param {any} val
 * @returns {number|null}
 */
export function validPositiveNumber(val) {
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
export function parseDurationString(durationStr) {
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
 * Safely extracts and normalizes media duration into total integer seconds.
 * Priority:
 * 1. Valid numeric duration (metadata.duration)
 * 2. Valid numeric-string duration (e.g. "970" or "74.304")
 * 3. Valid duration_string (e.g. "16:10", "0:30", "1:05:30")
 * 4. Duration from metadata.durationSeconds or formats[0].duration / duration_string
 * 5. null if no reliable duration exists.
 *
 * @param {object} metadata
 * @returns {number|null} Total seconds or null
 */
export function resolveMediaDuration(metadata) {
  if (!metadata || typeof metadata !== 'object') return null

  const candidates = [
    metadata.durationSeconds,
    metadata.duration,
    metadata.duration_string,
    metadata.formats?.[0]?.duration,
    metadata.formats?.[0]?.duration_string
  ]

  for (const cand of candidates) {
    if (cand === null || cand === undefined || cand === '') continue

    // 1. Direct finite positive number
    if (typeof cand === 'number' && Number.isFinite(cand) && cand >= 0) {
      return Math.floor(cand)
    }

    // 2. String representation
    if (typeof cand === 'string') {
      const trimmed = cand.trim()
      if (!trimmed) continue

      // Numeric string e.g. "74.304" or "970"
      if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
        const num = parseFloat(trimmed)
        if (Number.isFinite(num) && num >= 0) {
          return Math.floor(num)
        }
      }

      // Colon-separated string e.g. "16:10", "0:30", "1:05:30"
      const parsed = parseDurationString(trimmed)
      if (parsed !== null && parsed >= 0) {
        return parsed
      }
    }
  }

  return null
}

/**
 * Resolves vertical resolution (height) in pixels across platforms and formats.
 * Checks format.height, format.resolution, format_note, format_id, and URL query tags.
 *
 * @param {object} format
 * @returns {number|null} Height integer or null
 */
export function resolveFormatHeight(format) {
  if (!format || typeof format !== 'object') return null

  // 1. Explicit numeric height
  if (Number.isInteger(format.height) && format.height > 0) {
    return format.height
  }

  // 2. From resolution string e.g. "1280x720", "320x568"
  if (typeof format.resolution === 'string') {
    const resMatch = format.resolution.match(/(\d+)\s*[xX]\s*(\d+)/)
    if (resMatch) {
      const h = parseInt(resMatch[2], 10)
      if (h > 0) return h
    }
    const pMatch = format.resolution.match(/(\d{3,4})p/i)
    if (pMatch) {
      const h = parseInt(pMatch[1], 10)
      if (h > 0) return h
    }
  }

  // 3. From format_note or format_id e.g. "1080p", "720p", "hd", "sd"
  const identifiers = [format.format_note, format.format_id].filter(
    (v) => typeof v === 'string' && v.trim()
  )
  for (const id of identifiers) {
    const pMatch = id.match(/(?:^|[._-])(\d{3,4})p?(?:[._-]|$)/i)
    if (pMatch) {
      const val = parseInt(pMatch[1], 10)
      if (val >= 144 && val <= 4320) return val
    }
    const lower = id.toLowerCase()
    if (lower === 'hd' || lower.includes('_hd') || lower.includes('-hd')) {
      return 720
    }
    if (lower === 'sd' || lower.includes('_sd') || lower.includes('-sd')) {
      return 360
    }
  }

  // 4. From URL query params (e.g. tag=hd, tag=sd)
  if (typeof format.url === 'string') {
    if (/[?&]tag=hd\b/i.test(format.url)) return 720
    if (/[?&]tag=sd\b/i.test(format.url)) return 360
  }

  return null
}

/**
 * Resolves horizontal resolution (width) in pixels across platforms and formats.
 *
 * @param {object} format
 * @returns {number|null} Width integer or null
 */
export function resolveFormatWidth(format) {
  if (!format || typeof format !== 'object') return null

  if (Number.isInteger(format.width) && format.width > 0) {
    return format.width
  }

  if (typeof format.resolution === 'string') {
    const resMatch = format.resolution.match(/(\d+)\s*[xX]\s*(\d+)/)
    if (resMatch) {
      const w = parseInt(resMatch[1], 10)
      if (w > 0) return w
    }
  }

  return null
}

/**
 * Extracts bitrate encoded in media URLs (e.g. Meta / Facebook / Instagram / CDN query params).
 * Supports bitrate=<bps|kbps> and br=<bps|kbps>.
 * Values > 10,000 are treated as bits per second and converted to kbps.
 *
 * @param {string|any} url
 * @returns {number|null} Bitrate in kbps or null
 */
export function extractUrlBitrateKbps(url) {
  if (typeof url !== 'string') return null
  const match = url.match(/[?&](?:bitrate|br)=(\d+)/i)
  if (!match) return null
  const raw = parseInt(match[1], 10)
  if (!Number.isFinite(raw) || raw <= 0) return null
  if (raw > 10000) {
    return Math.round(raw / 1000)
  }
  return raw
}

/**
 * Parses and validates raw yt-dlp metadata JSON object into structured media metadata.
 *
 * @param {object} metadata - Raw yt-dlp metadata object
 * @param {string} platform - Platform identifier (e.g. 'youtube', 'facebook')
 * @param {string} sourceUrl - Cleaned source URL
 * @returns {object} Structured media analysis result
 */
export function parseMediaMetadata(metadata, platform, sourceUrl) {
  // Validate required metadata fields
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    typeof metadata.id !== 'string' ||
    !metadata.id.trim() ||
    typeof metadata.title !== 'string' ||
    !metadata.title.trim()
  ) {
    throw new Error('Media metadata is missing required details')
  }

  // Validate the formats collection
  if (metadata.formats != null && !Array.isArray(metadata.formats)) {
    throw new Error('Media metadata contains an invalid formats list')
  }

  const formats = Array.isArray(metadata.formats) ? metadata.formats : []

  // Identify actual downloadable source formats
  const validFormats = formats.filter(
    (format) => format && typeof format === 'object' && !Array.isArray(format)
  )

  const isAudioOnlyFormat = (format) => {
    if (!format || typeof format !== 'object') return false
    const vcodec = typeof format.vcodec === 'string' ? format.vcodec.toLowerCase() : ''
    const acodec = typeof format.acodec === 'string' ? format.acodec.toLowerCase() : ''
    const resolution = typeof format.resolution === 'string' ? format.resolution.toLowerCase() : ''
    const formatNote =
      typeof format.format_note === 'string' ? format.format_note.toLowerCase() : ''
    const formatId = typeof format.format_id === 'string' ? format.format_id.toLowerCase() : ''

    const height = resolveFormatHeight(format)
    if (Number.isInteger(height) && height > 0 && vcodec !== 'none') {
      return false
    }

    if (resolution === 'audio only') return true
    if (formatId.startsWith('hls-audio-')) return true
    if (format.audio_ext === 'mp4' && (!vcodec || vcodec === 'none')) return true

    const hasNoVideo = !vcodec || vcodec === 'none'
    const hasAudio =
      (acodec && acodec !== 'none') ||
      formatNote.includes('audio') ||
      (Number.isFinite(format.abr) && format.abr > 0)

    return hasNoVideo && hasAudio
  }

  // Audio-only source formats (separate audio tracks)
  const audioFormats = validFormats
    .filter((format) => isAudioOnlyFormat(format))
    .map((format) => {
      const audioCodec =
        typeof format.acodec === 'string' && format.acodec !== 'none'
          ? format.acodec
          : format.audio_ext === 'mp4' || format.ext === 'mp4' || format.ext === 'm4a'
            ? 'aac'
            : null

      const exactSize = validPositiveNumber(format.filesize)
      const approximateSize = validPositiveNumber(format.filesize_approx)
      const fileSize = exactSize ?? approximateSize
      const isApproximate = !exactSize && Boolean(approximateSize)

      return {
        formatId: format.format_id ?? null,
        extension: format.ext ?? null,
        audioCodec,
        fileSize,
        isApproximate,
        audioBitrateKbps: validPositiveNumber(format.abr) ?? validPositiveNumber(format.tbr),
        totalBitrateKbps: validPositiveNumber(format.tbr) ?? validPositiveNumber(format.abr),
        protocol: format.protocol ?? null
      }
    })

  const hasSeparateAudio = audioFormats.length > 0

  const isVideoFormat = (format) => {
    if (!format || typeof format !== 'object') return false
    const vcodec = typeof format.vcodec === 'string' ? format.vcodec.toLowerCase() : ''
    if (vcodec === 'none') return false
    const height = resolveFormatHeight(format)
    if (Number.isInteger(height) && height > 0) return true
    if (vcodec && vcodec !== 'none') return true
    if (format.video_ext && format.video_ext !== 'none') return true
    if (format.ext === 'mp4' && !isAudioOnlyFormat(format)) return true
    return false
  }

  const hasAudioTrack = (format) => {
    if (!format || typeof format !== 'object') return false
    if (isAudioOnlyFormat(format)) return true
    const acodec = typeof format.acodec === 'string' ? format.acodec.toLowerCase().trim() : ''
    const audioExt =
      typeof format.audio_ext === 'string' ? format.audio_ext.toLowerCase().trim() : ''
    if (acodec === 'none') return false
    if (hasSeparateAudio && audioExt === 'none') return false
    if (acodec && acodec !== 'none') return true
    if (audioExt && audioExt !== 'none') return true
    if (Number.isFinite(format.abr) && format.abr > 0) return true
    if (
      !hasSeparateAudio &&
      (format.ext === 'mp4' || format.protocol === 'https' || format.protocol === 'http')
    ) {
      return true
    }
    return false
  }

  const isAudioIncluded = (format) => {
    if (!format || typeof format !== 'object') return false
    const acodec = typeof format.acodec === 'string' ? format.acodec.toLowerCase().trim() : ''
    const audioExt =
      typeof format.audio_ext === 'string' ? format.audio_ext.toLowerCase().trim() : ''

    // 1. Explicit no-audio indicators strictly take precedence
    if (acodec === 'none') {
      return false
    }

    // 2. If separate audio streams exist and format explicitly indicates audio_ext === 'none',
    // it is a video-only format designed to merge with separate audio (e.g. X/Twitter, adaptive streams)
    if (hasSeparateAudio && audioExt === 'none') {
      return false
    }

    // 3. Explicit audio codec present (and not 'none')
    if (acodec && acodec !== 'none') {
      return true
    }

    // 4. Explicit audio extension present (and not 'none')
    if (audioExt && audioExt !== 'none') {
      return true
    }

    // 5. Audio bitrate present
    if (Number.isFinite(format.abr) && format.abr > 0) {
      return true
    }

    // 6. Progressive stream fallback when no separate audio streams exist
    if (
      !hasSeparateAudio &&
      (format.ext === 'mp4' ||
        format.protocol === 'https' ||
        format.protocol === 'http' ||
        !format.protocol)
    ) {
      return true
    }

    return false
  }

  // Quality heights
  const qualityHeights = new Set()

  for (const format of formats) {
    if (isVideoFormat(format)) {
      const h = resolveFormatHeight(format)
      if (Number.isInteger(h) && h > 0) {
        qualityHeights.add(h)
      }
    }
  }

  const videoQualities = [...qualityHeights].sort((a, b) => b - a).map((height) => `${height}p`)

  // MP3 option
  const hasAudioStream = formats.some((format) => hasAudioTrack(format))

  const audioOptions = hasAudioStream ? ['mp3'] : []

  // Find MP4 video sources compatible with universal selector
  const mp4Formats = validFormats
    .filter((format) => {
      if (format.ext !== 'mp4') return false
      if (!isVideoFormat(format)) return false
      const height = resolveFormatHeight(format)
      if (!Number.isInteger(height) || height <= 0) return false

      const audioIncluded = isAudioIncluded(format)
      return audioIncluded || hasSeparateAudio
    })
    .map((format) => {
      const height = resolveFormatHeight(format)
      const width = resolveFormatWidth(format)
      const audioIncluded = isAudioIncluded(format)

      const exactSize = validPositiveNumber(format.filesize)
      const approximateSize = validPositiveNumber(format.filesize_approx)
      const fileSize = exactSize ?? approximateSize
      const isApproximate = !exactSize && Boolean(approximateSize)

      const urlBitrate = extractUrlBitrateKbps(format.url)
      const totalBitrateKbps =
        validPositiveNumber(format.tbr) ??
        urlBitrate ??
        (validPositiveNumber(format.vbr) && validPositiveNumber(format.abr)
          ? format.vbr + format.abr
          : null)

      return {
        formatId: format.format_id ?? null,
        quality: `${height}p`,
        height,
        width,
        extension: format.ext ?? null,
        videoCodec: format.vcodec ?? null,
        audioCodec: format.acodec ?? null,
        audioIncluded,
        fileSize,
        isApproximate,
        videoBitrateKbps: validPositiveNumber(format.vbr),
        audioBitrateKbps: validPositiveNumber(format.abr),
        totalBitrateKbps,
        protocol: format.protocol ?? null
      }
    })

  // Build unique MP4 quality options
  const mp4Qualities = [...new Set(mp4Formats.map((format) => format.height))]
    .sort((a, b) => b - a)
    .map((height) => `${height}p`)

  const availableFormats = {
    mp4Qualities,
    mp4Formats,
    audioFormats
  }

  return {
    id: metadata.id.trim(),
    platform,
    sourceUrl: typeof sourceUrl === 'string' ? sourceUrl.trim() : '',
    title: metadata.title.trim(),
    thumbnailUrl: typeof metadata.thumbnail === 'string' ? metadata.thumbnail : null,
    durationSeconds: resolveMediaDuration(metadata),
    videoQualities,
    audioOptions,
    availableFormats
  }
}
