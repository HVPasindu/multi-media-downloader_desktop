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
 * Classifies an error thrown by yt-dlp or the analyzer into a structured error.
 * Ensures internal paths or raw child_process stderr are never leaked directly to users.
 *
 * @param {Error|any} error - The caught error
 * @param {string} [platform] - The target platform ('youtube', etc.)
 * @returns {{ code: string, userMessage: string, retryAfterSeconds: number|null }}
 */
export function classifyAnalysisError(error, platform) {
  const message = String(error?.message || '')
  const stderr = String(error?.stderr || '')
  const combined = `${message} ${stderr} ${platform || ''}`

  // 1. YouTube / Generic Rate Limiting (429)
  if (/429|Too Many Requests|rate[- ]limit/i.test(combined)) {
    return {
      code: 'YOUTUBE_RATE_LIMITED',
      userMessage: 'YouTube rate limit encountered. Please wait a moment before trying again.',
      retryAfterSeconds: 60
    }
  }

  // 2. YouTube Bot Verification / Auth Required
  if (
    /Sign in to confirm you(?:'|’)?re not a bot|bot verification|Sign in to confirm your age|Private video|Sign in to confirm/i.test(
      combined
    )
  ) {
    return {
      code: 'YOUTUBE_AUTH_REQUIRED',
      userMessage:
        'YouTube requires authentication or bot verification. This media cannot be extracted directly.',
      retryAfterSeconds: null
    }
  }

  // 3. YouTube PO Token / Visitor Data
  if (/visitor data|po[-_ ]token|Proof of Origin/i.test(combined)) {
    return {
      code: 'YOUTUBE_PO_TOKEN_REQUIRED',
      userMessage: 'YouTube requires a Proof of Origin (PO) token for this video.',
      retryAfterSeconds: null
    }
  }

  // 4. Network / Connectivity Error
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network is unreachable|timed out|Temporary failure in name resolution|getaddrinfo/i.test(
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

export async function analyzeMedia(sourceUrl) {
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
    const err = new Error('YouTube rate limit cooldown active. Please wait before retrying.')
    err.code = 'YOUTUBE_RATE_LIMITED'
    err.userMessage = 'YouTube rate limit cooldown active. Please wait before retrying.'
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
        if (classified.code === 'YOUTUBE_RATE_LIMITED') {
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

  //quality_video
  const qualityHeights = new Set()

  for (const format of formats) {
    const isTwitterHttp =
      platform === 'twitter' &&
      format &&
      typeof format === 'object' &&
      typeof format.format_id === 'string' &&
      format.format_id.startsWith('http-')

    if (
      format &&
      typeof format === 'object' &&
      ((typeof format.vcodec === 'string' && format.vcodec !== 'none') || isTwitterHttp) &&
      Number.isInteger(format.height) &&
      format.height > 0
    ) {
      qualityHeights.add(format.height)
    }
  }

  const videoQualities = [...qualityHeights].sort((a, b) => b - a).map((height) => `${height}p`)

  const isTwitterAudioFormat = (format) =>
    platform === 'twitter' &&
    format &&
    typeof format === 'object' &&
    format.vcodec === 'none' &&
    (format.resolution === 'audio only' ||
      (typeof format.format_id === 'string' && format.format_id.startsWith('hls-audio-')) ||
      format.audio_ext === 'mp4' ||
      (typeof format.format_note === 'string' &&
        format.format_note.toLowerCase().includes('audio')) ||
      (Number.isFinite(format.abr) && format.abr > 0))

  //MP3 option
  const hasAudioStream = formats.some(
    (format) =>
      format &&
      typeof format === 'object' &&
      ((typeof format.acodec === 'string' && format.acodec !== 'none') ||
        isTwitterAudioFormat(format))
  )

  const audioOptions = hasAudioStream ? ['mp3'] : []

  // Identify actual downloadable source formats
  const validFormats = formats.filter(
    (format) => format && typeof format === 'object' && !Array.isArray(format)
  )

  // Audio-only source formats
  const audioFormats = validFormats
    .filter(
      (format) =>
        (format.vcodec === 'none' &&
          typeof format.acodec === 'string' &&
          format.acodec !== 'none') ||
        isTwitterAudioFormat(format)
    )
    .map((format) => ({
      formatId: format.format_id ?? null,
      extension: format.ext ?? null,
      audioCodec:
        typeof format.acodec === 'string' && format.acodec !== 'none'
          ? format.acodec
          : platform === 'twitter'
            ? 'aac'
            : null,
      fileSize: format.filesize ?? format.filesize_approx ?? null
    }))

  // Our current MP4 download selector uses M4A audio
  const hasM4aAudio = audioFormats.some((format) => format.extension === 'm4a')
  const hasTwitterAudio = platform === 'twitter' && audioFormats.length > 0

  // Find MP4 video sources compatible with our selector
  const mp4Formats = validFormats
    .filter((format) => {
      const isTwitterHttp =
        platform === 'twitter' &&
        typeof format.format_id === 'string' &&
        format.format_id.startsWith('http-')

      const hasVideo =
        (typeof format.vcodec === 'string' && format.vcodec !== 'none') || isTwitterHttp

      const hasAudio =
        (typeof format.acodec === 'string' && format.acodec !== 'none') ||
        (isTwitterHttp && hasAudioStream)

      return (
        format.ext === 'mp4' &&
        hasVideo &&
        Number.isInteger(format.height) &&
        format.height > 0 &&
        (hasAudio || hasM4aAudio || hasTwitterAudio)
      )
    })
    .map((format) => {
      const isTwitterHttp =
        platform === 'twitter' &&
        typeof format.format_id === 'string' &&
        format.format_id.startsWith('http-')

      return {
        formatId: format.format_id ?? null,
        quality: `${format.height}p`,
        height: format.height,
        videoCodec: format.vcodec ?? (isTwitterHttp ? 'h264' : null),
        audioIncluded:
          (typeof format.acodec === 'string' && format.acodec !== 'none') ||
          (isTwitterHttp && hasAudioStream),
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
