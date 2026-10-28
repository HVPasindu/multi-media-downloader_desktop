
import { Op } from 'sequelize'
import { getDatabase } from '../config/database.js'
import { SUPPORTED_MP3_BITRATES } from './downloadService.js'

// Track in-flight download creation requests to prevent simultaneous race conditions
const pendingDownloadRequests = new Map()

/**
 * Extracts a canonical media key from a source URL.
 * For YouTube, extracts the 11-character video ID across watch, youtu.be, shorts, and embed URLs.
 * For other platforms, performs conservative URL normalization (protocol, lowercase host, clean path, sorted query params).
 *
 * @param {string} sourceUrl
 * @returns {string|null}
 */
export function getCanonicalMediaKey(sourceUrl) {
  if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) {
    return null
  }

  const cleanUrl = sourceUrl.trim()

  let parsedUrl
  try {
    parsedUrl = new URL(cleanUrl)
  } catch {
    return `raw:${cleanUrl}`
  }

  const hostname = parsedUrl.hostname.toLowerCase()

  // 1. YouTube canonical identifier extraction
  const isYouTube =
    hostname === 'youtu.be' ||
    hostname.endsWith('.youtu.be') ||
    hostname === 'youtube.com' ||
    hostname.endsWith('.youtube.com')

  if (isYouTube) {
    let videoId = null

    if (hostname === 'youtu.be' || hostname.endsWith('.youtu.be')) {
      const candidate = parsedUrl.pathname.replace(/^\/+/, '').split('/')[0]
      if (candidate && /^[\w-]{11}$/.test(candidate)) {
        videoId = candidate
      }
    } else {
      const pathname = parsedUrl.pathname

      if (
        pathname.startsWith('/shorts/') ||
        pathname.startsWith('/embed/') ||
        pathname.startsWith('/v/')
      ) {
        const segments = pathname.split('/').filter(Boolean)
        const candidate = segments[1]
        if (candidate && /^[\w-]{11}$/.test(candidate)) {
          videoId = candidate
        }
      } else if (parsedUrl.searchParams.has('v')) {
        const candidate = parsedUrl.searchParams.get('v')
        if (candidate && /^[\w-]{11}$/.test(candidate)) {
          videoId = candidate
        }
      }
    }

    if (videoId) {
      return `youtube:${videoId}`
    }
  }

  // 2. Conservative URL normalization for other supported platforms
  const protocol = parsedUrl.protocol.toLowerCase()
  let normalizedHost = hostname
  if (normalizedHost.startsWith('www.')) {
    normalizedHost = normalizedHost.slice(4)
  }

  let pathname = parsedUrl.pathname.replace(/\/+/g, '/')
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1)
  }

  const searchParams = new URLSearchParams(parsedUrl.search)
  searchParams.sort()
  const search = searchParams.toString() ? `?${searchParams.toString()}` : ''

  return `url:${protocol}//${normalizedHost}${pathname}${search}`
}

/**
 * Builds a deterministic request identity string for duplicate detection and creation guards.
 *
 * @param {object} params
 * @param {string} params.sourceUrl
 * @param {string} params.outputFormat
 * @param {string|null} [params.quality]
 * @param {number|null} [params.audioBitrateKbps]
 * @returns {string}
 */
export function buildDownloadRequestIdentity({
  sourceUrl,
  outputFormat,
  quality = null,
  audioBitrateKbps = null
}) {
  if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) {
    throw new Error('A valid source URL is required to build download request identity')
  }

  if (!['mp4', 'mp3'].includes(outputFormat)) {
    throw new Error('Output format must be mp4 or mp3')
  }

  const mediaKey = getCanonicalMediaKey(sourceUrl)
  if (!mediaKey) {
    throw new Error('Could not determine canonical media key from source URL')
  }

  if (outputFormat === 'mp3') {
    if (!SUPPORTED_MP3_BITRATES.includes(audioBitrateKbps)) {
      throw new Error('A valid audio bitrate is required for MP3 download identity')
    }
    return `${mediaKey}:mp3:${audioBitrateKbps}kbps`
  }

  if (outputFormat === 'mp4') {
    if (typeof quality !== 'string' || !/^\d+p$/.test(quality)) {
      throw new Error('A valid video quality is required for MP4 download identity')
    }
    return `${mediaKey}:mp4:${quality}`
  }

  throw new Error('Unsupported output format')
}

/**
 * Checks SQLite for an existing download job that is currently 'queued' or 'downloading'
 * for the same canonical media source and identical format/quality/bitrate settings.
 * Completed, failed, and cancelled jobs are intentionally ignored.
 *
 * @param {object} params
 * @param {string|null} [params.sourceUrl]
 * @param {number|null} [params.mediaItemId]
 * @param {string} params.outputFormat
 * @param {string|null} [params.quality]
 * @param {number|null} [params.audioBitrateKbps]
 * @returns {Promise<object|null>} The active DownloadJob instance, or null if none found.
 */
export async function findActiveDuplicateDownload({
  sourceUrl = null,
  mediaItemId = null,
  outputFormat,
  quality = null,
  audioBitrateKbps = null
}) {
  if (!['mp4', 'mp3'].includes(outputFormat)) {
    return null
  }

  const { DownloadJob, MediaItem } = getDatabase().models

  // Resolve source URL if not directly provided
  let resolvedSourceUrl = typeof sourceUrl === 'string' && sourceUrl.trim()
    ? sourceUrl.trim()
    : null

  if (!resolvedSourceUrl && Number.isInteger(mediaItemId) && mediaItemId > 0) {
    const targetMedia = await MediaItem.findByPk(mediaItemId)
    if (targetMedia && typeof targetMedia.source_url === 'string') {
      resolvedSourceUrl = targetMedia.source_url.trim()
    }
  }

  const targetMediaKey = resolvedSourceUrl
    ? getCanonicalMediaKey(resolvedSourceUrl)
    : null

  // Search only active lifecycle states: 'queued' or 'downloading'
  const whereClause = {
    status: {
      [Op.in]: ['queued', 'downloading']
    },
    output_format: outputFormat
  }

  if (outputFormat === 'mp4') {
    if (typeof quality !== 'string') {
      return null
    }
    whereClause.quality = quality
  } else if (outputFormat === 'mp3') {
    if (!SUPPORTED_MP3_BITRATES.includes(audioBitrateKbps)) {
      throw new Error('A valid audio bitrate is required')
    }
    whereClause.audio_bitrate_kbps = audioBitrateKbps
  }

  // Retrieve active jobs matching format and settings
  const activeJobs = await DownloadJob.findAll({
    where: whereClause,
    include: [{
      model: MediaItem,
      as: 'media'
    }],
    order: [['id', 'ASC']]
  })

  if (!activeJobs || activeJobs.length === 0) {
    return null
  }

  // Find first matching active job by media ID or canonical media key
  for (const job of activeJobs) {
    // 1. Direct media_id match
    if (Number.isInteger(mediaItemId) && mediaItemId > 0 && job.media_id === mediaItemId) {
      return job
    }

    // 2. Canonical media key match (e.g. YouTube watch URL vs youtu.be short URL)
    if (targetMediaKey && job.media && typeof job.media.source_url === 'string') {
      const jobMediaKey = getCanonicalMediaKey(job.media.source_url)
      if (jobMediaKey && jobMediaKey === targetMediaKey) {
        return job
      }
    }
  }

  return null
}

/**
 * Synchronizes download creation requests per request identity using an in-memory lock map.
 * If another request for the same media and settings is already in-flight, subsequent requests
 * wait for the leader request's result and receive it as duplicate: true.
 *
 * @param {string} requestIdentity
 * @param {Function} createFn
 * @returns {Promise<{ job: object, duplicate: boolean }>}
 */
export async function withDownloadCreationGuard(requestIdentity, createFn) {
  if (typeof requestIdentity !== 'string' || !requestIdentity.trim()) {
    throw new Error('A valid request identity is required for creation guard')
  }

  const cleanIdentity = requestIdentity.trim()

  // 1. If another request for this exact media identity is already in flight, await its result
  if (pendingDownloadRequests.has(cleanIdentity)) {
    const inFlightPromise = pendingDownloadRequests.get(cleanIdentity)
    const result = await inFlightPromise
    return {
      job: result.job,
      duplicate: true
    }
  }

  // 2. Leader request: create a deferred promise for simultaneous followers
  let resolvePromise
  let rejectPromise
  const executionPromise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  pendingDownloadRequests.set(cleanIdentity, executionPromise)

  try {
    const result = await createFn()
    resolvePromise(result)
    return result
  } catch (error) {
    rejectPromise(error)
    throw error
  } finally {
    // Always release the lock
    pendingDownloadRequests.delete(cleanIdentity)
  }
}

