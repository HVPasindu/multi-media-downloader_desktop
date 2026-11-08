import { formatMediaDuration, formatBytes } from './mediaMetadata.js'
import { getFriendlyErrorInfo } from './errorPresentation.js'

export { formatBytes } from './mediaMetadata.js'

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
 * Calculates remaining seconds based on remaining bytes and download speed.
 *
 * @param {number|null|undefined} remainingBytes - Bytes left to download
 * @param {number|null|undefined} speedBps - Current speed in bytes per second
 * @returns {number|null} Estimated seconds remaining or null if unavailable
 */
export function calculateEtaSeconds(remainingBytes, speedBps) {
  if (
    !Number.isFinite(remainingBytes) ||
    remainingBytes <= 0 ||
    !Number.isFinite(speedBps) ||
    speedBps <= 1024
  ) {
    return null
  }
  return Math.round(remainingBytes / speedBps)
}

/**
 * Formats an ETA duration in seconds into a user-friendly string (e.g. "~23 seconds", "~2m 15s").
 *
 * @param {number|null|undefined} etaSeconds - Seconds remaining
 * @returns {string|null} Formatted duration or null
 */
export function formatEta(etaSeconds) {
  if (!Number.isFinite(etaSeconds) || etaSeconds <= 0) return null
  if (etaSeconds < 60) {
    return `~${etaSeconds} seconds`
  }
  if (etaSeconds < 3600) {
    const mins = Math.floor(etaSeconds / 60)
    const secs = etaSeconds % 60
    return secs > 0 ? `~${mins}m ${secs}s` : `~${mins}m`
  }
  const hours = Math.floor(etaSeconds / 3600)
  const mins = Math.floor((etaSeconds % 3600) / 60)
  return mins > 0 ? `~${hours}h ${mins}m` : `~${hours}h`
}

/**
 * Calculates estimated remaining time (ETA) based on remaining bytes and speed.
 * Returns a human-friendly remaining string (e.g. "~23 seconds remaining" or "2m 45s left").
 *
 * @param {number|null|undefined} remainingBytes - Bytes left to download
 * @param {number|null|undefined} speedBps - Current speed in bytes per second
 * @returns {string|null} Formatted ETA or null
 */
export function calculateEta(remainingBytes, speedBps) {
  const seconds = calculateEtaSeconds(remainingBytes, speedBps)
  if (seconds === null) {
    return null
  }
  if (seconds <= 0) return '0s remaining'
  if (seconds < 60) return `~${seconds} seconds remaining`
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return secs > 0 ? `~${mins}m ${secs}s remaining` : `~${mins}m remaining`
  }
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return mins > 0 ? `~${hours}h ${mins}m remaining` : `~${hours}h remaining`
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
  const isPaused = job.status === 'paused'

  // Clear speed tracker samples when not actively downloading to avoid stale speeds on resume
  if (!isDownloading && speedTracker && typeof speedTracker.delete === 'function') {
    speedTracker.delete(job.id)
  }

  // Format label: 'MP4' or 'MP3'
  const formatLabel = (job.output_format || 'mp4').toUpperCase()

  // Quality or Bitrate display
  let qualityLabel = '—'
  if (job.output_format === 'mp3') {
    qualityLabel = job.audio_bitrate_kbps ? `${job.audio_bitrate_kbps} kbps` : '192 kbps'
  } else if (job.quality) {
    qualityLabel = job.quality
  }

  // Determine total bytes (preferring actual output file_size once completed,
  // otherwise live total_bytes from yt-dlp streams, falling back to file_size)
  const hasLiveTotal =
    job.total_bytes !== null &&
    job.total_bytes !== undefined &&
    Number.isFinite(Number(job.total_bytes)) &&
    Number(job.total_bytes) > 0

  const validFileSizeFallback =
    job.file?.file_size !== null &&
    job.file?.file_size !== undefined &&
    Number.isFinite(Number(job.file.file_size)) &&
    Number(job.file.file_size) > 0
      ? Number(job.file.file_size)
      : null

  const hasCompletedOutputFileSize = isCompleted && validFileSizeFallback !== null

  const totalBytes = hasCompletedOutputFileSize
    ? validFileSizeFallback
    : hasLiveTotal
      ? Number(job.total_bytes)
      : validFileSizeFallback

  const totalBytesIsEstimate =
    !hasCompletedOutputFileSize &&
    hasLiveTotal &&
    (job.total_bytes_is_estimate === true ||
      job.total_bytes_is_estimate === 1 ||
      job.total_bytes_is_estimate === '1')

  const downloadedBytes =
    job.downloaded_bytes !== null &&
    job.downloaded_bytes !== undefined &&
    Number.isFinite(Number(job.downloaded_bytes))
      ? Number(job.downloaded_bytes)
      : 0

  const downloadedBytesFormatted = formatBytes(downloadedBytes)
  const totalBytesFormatted = totalBytes
    ? `${totalBytesIsEstimate ? '~' : ''}${formatBytes(totalBytes)}`
    : null

  // Size display
  const fileSizeFormatted =
    totalBytesFormatted || (downloadedBytes > 0 ? downloadedBytesFormatted : '—')

  // Progress text (e.g. "25 MB / ~52 MB" or "25 MB downloaded" or "0 B" or "52 MB" on completion)
  let progressText = '0 B'
  if (isCancelled) {
    progressText = '0 B'
  } else if (hasCompletedOutputFileSize) {
    progressText = formatBytes(validFileSizeFallback)
  } else if (totalBytes && downloadedBytes > 0) {
    progressText = `${downloadedBytesFormatted} / ${totalBytesFormatted}`
  } else if (downloadedBytes > 0) {
    progressText = `${downloadedBytesFormatted} downloaded`
  } else if (totalBytes) {
    progressText = totalBytesFormatted
  }

  // Progress percentage (0 - 100) — cancelled jobs are strictly normalized to 0%
  const progress = isCancelled
    ? 0
    : Math.min(100, Math.max(0, Math.round(Number(job.progress) || 0)))

  // Distinguish resuming state for recovered downloads waiting in queue or reporting resuming status
  const isResuming = !isCancelled && (job.status === 'resuming' || (isQueued && progress > 0))
  const isInterrupted = !isCancelled && job.status === 'interrupted'

  // Download speed & ETA computation (only when downloading)
  let speedText = null
  let etaText = null
  let etaDisplay = null

  if (isDownloading) {
    if (speedTracker && typeof speedTracker.get === 'function') {
      const prevSample = speedTracker.get(job.id)
      const speedResult = calculateDownloadSpeed(downloadedBytes, prevSample)
      speedTracker.set(job.id, speedResult.sample)
      speedText = speedResult.speedText

      if (downloadedBytes >= totalBytes && totalBytes > 0) {
        // Transfer phase complete; muxing or final file processing in progress
        etaText = 'Finalizing...'
        etaDisplay = 'Finalizing...'
      } else if (totalBytes && downloadedBytes && speedResult.speedBps) {
        const remainingBytes = totalBytes - downloadedBytes
        etaText = calculateEta(remainingBytes, speedResult.speedBps)
        const seconds = calculateEtaSeconds(remainingBytes, speedResult.speedBps)
        etaDisplay = formatEta(seconds)
      } else if (!speedResult.speedBps || !speedText || speedText === '—') {
        etaText = 'Calculating...'
        etaDisplay = 'Calculating...'
      } else if (!totalBytes) {
        etaText = 'ETA unavailable'
        etaDisplay = 'ETA unavailable'
      }
    } else {
      etaText = 'Calculating...'
      etaDisplay = 'Calculating...'
    }
  } else {
    // Invalidate stale speed samples when not actively downloading so recovery/restart recalculates cleanly
    if (speedTracker && typeof speedTracker.delete === 'function') {
      speedTracker.delete(job.id)
    }
    if (isCancelled) {
      speedText = null
      etaText = null
      etaDisplay = null
    } else if (isInterrupted) {
      speedText = '0 KB/s'
      etaText = 'Waiting for connection'
      etaDisplay = 'Waiting for connection'
    } else if (isPaused) {
      speedText = '0 KB/s'
      etaText = 'Paused'
      etaDisplay = 'Paused'
    } else if (isResuming) {
      speedText = null
      etaText = 'Resuming...'
      etaDisplay = 'Resuming...'
    }
  }

  // Build user-friendly status text and display status
  let statusText = job.status
  let displayStatus = job.status
  let errorInfo = null
  if (isDownloading) {
    const details = []
    if (speedText && speedText !== '—' && speedText !== 'Calculating...') details.push(speedText)
    if (etaText && !['Finalizing...', 'Calculating...', 'ETA unavailable'].includes(etaText)) {
      details.push(etaText)
    }
    statusText = details.length > 0 ? `Downloading (${details.join(' • ')})` : 'Downloading'
    displayStatus = 'downloading'
  } else if (isPaused) {
    statusText = `Paused (${progress}%)`
    displayStatus = 'paused'
  } else if (isResuming) {
    statusText = `Resuming (${progress}% saved)`
    displayStatus = 'resuming'
  } else if (isInterrupted) {
    statusText = job.error_message || 'Interrupted – Waiting for internet connection'
    displayStatus = 'interrupted'
  } else if (isQueued) {
    statusText = 'Queued'
    displayStatus = 'queued'
  } else if (isCompleted) {
    statusText = 'Completed'
    displayStatus = 'completed'
  } else if (isFailed) {
    errorInfo = getFriendlyErrorInfo(job.error_message)
    const reason = errorInfo.guidance || errorInfo.message
    statusText = errorInfo.title ? `${errorInfo.title} – ${reason}` : job.error_message || 'Failed'
    displayStatus = 'failed'
  } else if (isCancelled) {
    statusText = 'Cancelled'
    displayStatus = 'cancelled'
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
    fileBytes: job.file?.file_size || null,
    filePath: job.file?.file_path || null,
    totalBytes,
    totalBytesFormatted,
    totalBytesIsEstimate,
    downloadedBytes: isCancelled ? 0 : downloadedBytes,
    downloadedBytesFormatted: isCancelled ? '0 B' : downloadedBytesFormatted,
    progress: isCancelled ? 0 : progress,
    progressText: isCancelled ? '0 B' : progressText,
    speedText: isCancelled ? null : speedText,
    etaText: isCancelled ? null : etaText,
    etaDisplay: isCancelled ? null : etaDisplay,
    displayStatus,
    status: job.status,
    statusText,
    errorMessage: job.error_message,
    errorInfo,
    fileStatus: job.file_status || null,
    createdAt: job.createdAt
  }
}
