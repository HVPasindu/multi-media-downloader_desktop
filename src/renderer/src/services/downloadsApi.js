import { apiRequest } from './api'

/**
 * Downloads Management API Service
 * Thin, modular client functions communicating strictly through the secure
 * Electron IPC bridge (window.api.request -> Express backend).
 */

/**
 * Creates and enqueues a new download job (or returns an active duplicate).
 *
 * @param {object} options
 * @param {number} options.mediaItemId - ID of the analyzed MediaItem in SQLite
 * @param {'mp4'|'mp3'} options.outputFormat - Desired format
 * @param {string} [options.quality] - Video resolution (e.g. '1080p', '720p') when outputFormat is 'mp4'
 * @param {number} [options.audioBitrateKbps] - Audio bitrate (128, 192, 320) when outputFormat is 'mp3'
 * @returns {Promise<{ status: number, ok: boolean, data: { success: boolean, duplicate?: boolean, data?: object } }>}
 */
export function createDownload(options) {
  return apiRequest({
    path: '/api/downloads',
    method: 'POST',
    body: options
  }).then((res) => {
    if (res.ok) notifyDownloadStateChanged()
    return res
  })
}

/**
 * Lists download jobs and history records with optional filtering and pagination.
 *
 * @param {object} [filters={}]
 * @param {string} [filters.status] - 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled'
 * @param {'mp4'|'mp3'} [filters.outputFormat] - Format filter
 * @param {string} [filters.sourceType] - 'link'
 * @param {string} [filters.from] - ISO date boundary
 * @param {string} [filters.to] - ISO date boundary
 * @param {number} [filters.limit=20] - Max records (default 20, max 100)
 * @param {number} [filters.offset=0] - Records to skip
 * @returns {Promise<{ status: number, ok: boolean, data: { success: boolean, data?: Array<object> } }>}
 */
export function listDownloads(filters = {}) {
  const params = new URLSearchParams()

  if (filters.status) params.set('status', filters.status)
  if (filters.outputFormat) params.set('outputFormat', filters.outputFormat)
  if (filters.sourceType) params.set('sourceType', filters.sourceType)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.limit !== undefined) params.set('limit', String(filters.limit))
  if (filters.offset !== undefined) params.set('offset', String(filters.offset))

  const queryString = params.toString()
  const path = queryString ? `/api/downloads?${queryString}` : '/api/downloads'

  return apiRequest({
    path,
    method: 'GET'
  })
}

/**
 * Retrieves full details and status for a single download job.
 *
 * @param {number|string} id - Download job ID
 * @returns {Promise<{ status: number, ok: boolean, data: { success: boolean, data?: { job: object, file?: object } } }>}
 */
export function getDownload(id) {
  return apiRequest({
    path: `/api/downloads/${id}`,
    method: 'GET'
  })
}

/**
 * Cancels a queued or currently running download job.
 *
 * @param {number|string} id - Download job ID
 * @returns {Promise<{ status: number, ok: boolean, data: { success: boolean, data?: object } }>}
 */
export function cancelDownload(id) {
  return apiRequest({
    path: `/api/downloads/${id}/cancel`,
    method: 'POST'
  }).then((res) => {
    if (res.ok) notifyDownloadStateChanged()
    return res
  })
}

/**
 * Retries a failed or cancelled download job by creating a new linked job.
 *
 * @param {number|string} id - Original failed or cancelled job ID
 * @returns {Promise<{ status: number, ok: boolean, data: { success: boolean, data?: object } }>}
 */
export function retryDownload(id) {
  return apiRequest({
    path: `/api/downloads/${id}/retry`,
    method: 'POST'
  }).then((res) => {
    if (res.ok) notifyDownloadStateChanged()
    return res
  })
}

/**
 * Deletes a single terminal download record from SQLite history.
 * Note: Never deletes physical media files from disk.
 *
 * @param {number|string} id - Terminal job ID
 * @returns {Promise<{ status: number, ok: boolean, data: { success: boolean, data?: object, message?: string } }>}
 */
export function deleteDownloadHistory(id) {
  return apiRequest({
    path: `/api/downloads/${id}`,
    method: 'DELETE'
  })
}

/**
 * Bulk clears terminal download history records from SQLite.
 *
 * @param {object} [options={}]
 * @param {boolean} [options.confirm=true] - Mandatory confirmation flag
 * @param {Array<string>} [options.statuses=['completed', 'failed', 'cancelled']] - Terminal statuses to clear
 * @returns {Promise<{ status: number, ok: boolean, data: { success: boolean, data?: object, message?: string } }>}
 */
export function clearDownloadHistory(options = {}) {
  const { confirm = true, statuses = ['completed', 'failed', 'cancelled'] } = options

  return apiRequest({
    path: '/api/downloads/history',
    method: 'DELETE',
    body: { confirm, statuses }
  })
}

/**
 * Dispatches a lightweight DOM event to notify active views that download state changed.
 */
export function notifyDownloadStateChanged() {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('applan2:download-state-changed'))
    } catch {
      // Ignore in non-browser testing contexts
    }
  }
}

/**
 * Retrieves active download counts (downloading + queued) using existing
 * backend GET /api/downloads pagination metadata without fabricating numbers.
 *
 * @returns {Promise<{ ok: boolean, total: number, downloading: number, queued: number, error?: any }>}
 */
export async function getActiveDownloadsCount() {
  try {
    const [downloadingRes, queuedRes] = await Promise.all([
      listDownloads({ status: 'downloading', limit: 1 }),
      listDownloads({ status: 'queued', limit: 1 })
    ])

    const downloadingTotal =
      downloadingRes.ok && downloadingRes.data?.success
        ? Number(downloadingRes.data?.pagination?.total) || 0
        : 0

    const queuedTotal =
      queuedRes.ok && queuedRes.data?.success ? Number(queuedRes.data?.pagination?.total) || 0 : 0

    return {
      ok: Boolean(downloadingRes.ok && queuedRes.ok),
      total: downloadingTotal + queuedTotal,
      downloading: downloadingTotal,
      queued: queuedTotal
    }
  } catch (err) {
    return {
      ok: false,
      total: 0,
      downloading: 0,
      queued: 0,
      error: err
    }
  }
}
