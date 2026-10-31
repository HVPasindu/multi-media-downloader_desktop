import { formatMediaDuration } from './mediaMetadata'

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
 * Formats download speed into readable string (e.g. "12.5 MB/s", "450 KB/s").
 *
 * @param {number|null|undefined} bytesPerSec - Speed in bytes per second
 * @returns {string} Formatted speed or placeholder
 */
export function formatDownloadSpeed(bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
    return '—'
  }
  return `${formatBytes(bytesPerSec, 1)}/s`
}

/**
 * Calculates download speed by comparing successive downloaded_bytes readings.
 * Returns null if insufficient sample data is available.
 *
 * @param {number|null|undefined} currentBytes - Latest downloaded_bytes from backend
 * @param {{ bytes: number, timestamp: number, speedBps?: number }|null|undefined} prevSample - Previous reading
 * @returns {{ speedBps: number|null, speedText: string|null, sample: { bytes: number, timestamp: number, speedBps: number|null } }}
 */
export function calculateDownloadSpeed(currentBytes, prevSample) {
  const now = Date.now()

  if (
    currentBytes === null ||
    currentBytes === undefined ||
    !Number.isFinite(currentBytes) ||
    currentBytes < 0
  ) {
    return { speedBps: null, speedText: null, sample: { bytes: 0, timestamp: now, speedBps: null } }
  }

  if (
    !prevSample ||
    !Number.isFinite(prevSample.bytes) ||
    !Number.isFinite(prevSample.timestamp) ||
    prevSample.timestamp <= 0
  ) {
    return {
      speedBps: null,
      speedText: null,
      sample: { bytes: currentBytes, timestamp: now, speedBps: null }
    }
  }

  const deltaTimeSec = (now - prevSample.timestamp) / 1000

  // Minimum 0.5s interval required to calculate meaningful speed
  if (deltaTimeSec < 0.5) {
    return {
      speedBps: prevSample.speedBps ?? null,
      speedText: prevSample.speedBps ? formatDownloadSpeed(prevSample.speedBps) : null,
      sample: prevSample
    }
  }

  const deltaBytes = currentBytes - prevSample.bytes

  if (deltaBytes <= 0) {
    return {
      speedBps: null,
      speedText: null,
      sample: { bytes: currentBytes, timestamp: now, speedBps: null }
    }
  }

  const instantSpeed = deltaBytes / deltaTimeSec

  // Apply light smoothing with previous speed if available
  const smoothedSpeed = prevSample.speedBps
    ? prevSample.speedBps * 0.35 + instantSpeed * 0.65
    : instantSpeed

  return {
    speedBps: smoothedSpeed,
    speedText: formatDownloadSpeed(smoothedSpeed),
    sample: { bytes: currentBytes, timestamp: now, speedBps: smoothedSpeed }
  }
}

/**
 * Calculates estimated remaining time (ETA) based on remaining bytes and speed.
 * Only returns a string when genuine total-size and speed exist.
 *
 * @param {number|null|undefined} remainingBytes - Bytes left to download
 * @param {number|null|undefined} speedBps - Current speed in bytes per second
 * @returns {string|null} Formatted ETA (e.g. "2m 45s left") or null
 */
export function calculateEta(remainingBytes, speedBps) {
  if (
    !Number.isFinite(remainingBytes) ||
    remainingBytes <= 0 ||
    !Number.isFinite(speedBps) ||
    speedBps <= 1024
  ) {
    return null
  }

  const totalSeconds = Math.round(remainingBytes / speedBps)

  if (totalSeconds <= 0) return '0s left'
  if (totalSeconds < 60) return `${totalSeconds}s left`
  if (totalSeconds < 3600) {
    const mins = Math.floor(totalSeconds / 60)
    const secs = totalSeconds % 60
    return `${mins}m ${secs}s left`
  }

  const hours = Math.floor(totalSeconds / 3600)
  const mins = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}h ${mins}m left`
}

/**
 * Normalizes a raw backend download job into presentation-ready properties for UI components.
 *
 * @param {object} job - Raw download job from backend GET /api/downloads
 * @param {Map<number, { bytes: number, timestamp: number, speedBps?: number }>} [speedTracker] - Optional mutable speed tracker map
 * @returns {object} Normalized download item
 */
export function normalizeDownloadJob(job, speedTracker = null) {
  if (!job || typeof job !== 'object') {
    return null
  }

  const isDownloading = job.status === 'downloading'
  const isQueued = job.status === 'queued'
  const isCompleted = job.status === 'completed'
  const isFailed = job.status === 'failed'
  const isCancelled = job.status === 'cancelled'

  // Format label: 'MP4' or 'MP3'
  const formatLabel = (job.output_format || 'mp4').toUpperCase()

  // Quality or Bitrate display
  let qualityLabel = '—'
  if (job.output_format === 'mp3') {
    qualityLabel = job.audio_bitrate_kbps ? `${job.audio_bitrate_kbps} kbps` : '192 kbps'
  } else if (job.quality) {
    qualityLabel = job.quality
  }

  // Size display
  const fileSizeFormatted =
    formatBytes(job.file?.file_size) ||
    (job.downloaded_bytes ? formatBytes(job.downloaded_bytes) : '—')

  // Progress text (e.g. "452 MB / 668 MB" or "452 MB downloaded" or "0 B")
  let progressText = '0 B'
  if (job.file?.file_size && job.downloaded_bytes) {
    progressText = `${formatBytes(job.downloaded_bytes)} / ${formatBytes(job.file.file_size)}`
  } else if (job.downloaded_bytes && job.downloaded_bytes > 0) {
    progressText = `${formatBytes(job.downloaded_bytes)} downloaded`
  } else if (job.file?.file_size) {
    progressText = formatBytes(job.file.file_size)
  }

  // Progress percentage (0 - 100)
  const progress = Math.min(100, Math.max(0, Math.round(Number(job.progress) || 0)))

  // Download speed & ETA computation (only when downloading)
  let speedText = null
  let etaText = null

  if (isDownloading && speedTracker && typeof speedTracker.get === 'function') {
    const prevSample = speedTracker.get(job.id)
    const speedResult = calculateDownloadSpeed(job.downloaded_bytes, prevSample)
    speedTracker.set(job.id, speedResult.sample)
    speedText = speedResult.speedText

    // Check if total file size is known for ETA
    if (job.file?.file_size && job.downloaded_bytes && speedResult.speedBps) {
      const remainingBytes = job.file.file_size - job.downloaded_bytes
      etaText = calculateEta(remainingBytes, speedResult.speedBps)
    }
  }

  // Build user-friendly status text
  let statusText = job.status
  if (isDownloading) {
    const details = []
    if (speedText && speedText !== '—') details.push(speedText)
    if (etaText) details.push(etaText)
    statusText = details.length > 0 ? `Downloading (${details.join(' • ')})` : 'Downloading'
  } else if (isQueued) {
    statusText = 'Queued'
  } else if (isCompleted) {
    statusText = 'Completed'
  } else if (isFailed) {
    statusText = job.error_message || 'Failed'
  } else if (isCancelled) {
    statusText = 'Cancelled'
  }

  return {
    id: job.id,
    mediaId: job.media_id,
    title: job.media?.title || job.file?.file_name || `Download #${job.id}`,
    platform: job.media?.platform || 'web',
    thumbnail: job.media?.thumbnail_url || null,
    duration:
      job.media?.duration_seconds !== null && job.media?.duration_seconds !== undefined
        ? formatMediaDuration(job.media.duration_seconds)
        : null,
    format: formatLabel,
    quality: qualityLabel,
    size: fileSizeFormatted,
    fileSize: fileSizeFormatted,
    filePath: job.file?.file_path || null,
    progress,
    progressText,
    speedText,
    etaText,
    status: job.status,
    statusText,
    errorMessage: job.error_message,
    fileStatus: job.file_status || null,
    createdAt: job.createdAt
  }
}

