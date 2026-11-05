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

  const isAudioOnlyFormat = (format) => {
    if (!format || typeof format !== 'object') return false
    const vcodec = typeof format.vcodec === 'string' ? format.vcodec.toLowerCase() : ''
    const acodec = typeof format.acodec === 'string' ? format.acodec.toLowerCase() : ''
    const resolution = typeof format.resolution === 'string' ? format.resolution.toLowerCase() : ''
    const formatNote =
      typeof format.format_note === 'string' ? format.format_note.toLowerCase() : ''
    const formatId = typeof format.format_id === 'string' ? format.format_id.toLowerCase() : ''

    if (Number.isInteger(format.height) && format.height > 0) {
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

  const isVideoFormat = (format) => {
    if (!format || typeof format !== 'object') return false
    const vcodec = typeof format.vcodec === 'string' ? format.vcodec.toLowerCase() : ''
    if (vcodec === 'none') return false
    if (Number.isInteger(format.height) && format.height > 0) return true
    return Boolean(vcodec && vcodec !== 'none')
  }

  const hasAudioTrack = (format) => {
    if (!format || typeof format !== 'object') return false
    if (isAudioOnlyFormat(format)) return true
    const acodec = typeof format.acodec === 'string' ? format.acodec.toLowerCase() : ''
    if (acodec && acodec !== 'none') return true
    if (
      (!format.vcodec || format.vcodec === 'none') &&
      Number.isFinite(format.abr) &&
      format.abr > 0
    ) {
      return true
    }
    return false
  }

  // Quality heights
  const qualityHeights = new Set()

  for (const format of formats) {
    if (isVideoFormat(format) && Number.isInteger(format.height) && format.height > 0) {
      qualityHeights.add(format.height)
    }
  }

  const videoQualities = [...qualityHeights].sort((a, b) => b - a).map((height) => `${height}p`)

  // MP3 option
  const hasAudioStream = formats.some((format) => hasAudioTrack(format))

  const audioOptions = hasAudioStream ? ['mp3'] : []

  // Identify actual downloadable source formats
  const validFormats = formats.filter(
    (format) => format && typeof format === 'object' && !Array.isArray(format)
  )

  // Audio-only source formats
  const audioFormats = validFormats
    .filter((format) => isAudioOnlyFormat(format))
    .map((format) => ({
      formatId: format.format_id ?? null,
      extension: format.ext ?? null,
      audioCodec:
        typeof format.acodec === 'string' && format.acodec !== 'none'
          ? format.acodec
          : format.audio_ext === 'mp4' || format.ext === 'mp4' || format.ext === 'm4a'
            ? 'aac'
            : null,
      fileSize: format.filesize ?? format.filesize_approx ?? null
    }))

  const hasSeparateAudio = audioFormats.length > 0

  // Find MP4 video sources compatible with universal selector
  const mp4Formats = validFormats
    .filter((format) => {
      if (format.ext !== 'mp4') return false
      if (!isVideoFormat(format)) return false
      if (!Number.isInteger(format.height) || format.height <= 0) return false

      const acodec = typeof format.acodec === 'string' ? format.acodec.toLowerCase() : ''
      const isExplicitCombined = Boolean(acodec && acodec !== 'none')
      const isProgressiveCombined =
        !acodec &&
        hasAudioStream &&
        (format.protocol === 'https' || format.protocol === 'http' || !format.protocol)

      return isExplicitCombined || isProgressiveCombined || hasSeparateAudio
    })
    .map((format) => {
      const acodec = typeof format.acodec === 'string' ? format.acodec.toLowerCase() : ''
      const isExplicitCombined = Boolean(acodec && acodec !== 'none')
      const isProgressiveCombined =
        !acodec &&
        hasAudioStream &&
        (format.protocol === 'https' || format.protocol === 'http' || !format.protocol)
      const audioIncluded = isExplicitCombined || isProgressiveCombined

      return {
        formatId: format.format_id ?? null,
        quality: `${format.height}p`,
        height: format.height,
        videoCodec: format.vcodec ?? 'h264',
        audioIncluded,
        fileSize: format.filesize ?? format.filesize_approx ?? null
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
    durationSeconds:
      Number.isFinite(metadata.duration) && metadata.duration >= 0
        ? Math.floor(metadata.duration)
        : null,
    videoQualities,
    audioOptions,
    availableFormats
  }
}
