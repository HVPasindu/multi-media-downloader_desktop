import { apiRequest } from './api'

/**
 * Download Settings API Service
 * Manages persisted downloader preferences in SQLite via the local Express backend.
 *
 * Endpoints:
 * - GET   /api/settings/downloads
 * - PATCH /api/settings/downloads
 *
 * Note: Native folder dialog interactions (chooseDownloadFolder, getDownloadFolder)
 * are provided directly via Electron IPC in `./api.js` and are not duplicated here.
 */

/**
 * Retrieves the currently saved download settings from SQLite.
 *
 * @returns {Promise<{ status: number, ok: boolean, data: { success: boolean, data?: { downloadPath: string, defaultFormat: string, preferredMp4Quality: string, preferredMp3BitrateKbps: number } } }>}
 */
export function getDownloadSettings() {
  return apiRequest({
    path: '/api/settings/downloads',
    method: 'GET'
  })
}

/**
 * Partially updates download settings in SQLite.
 *
 * @param {object} settings - Settings to update
 * @param {string} [settings.downloadPath] - Directory path where downloads are saved
 * @param {'mp4'|'mp3'} [settings.defaultFormat] - Default output format
 * @param {string} [settings.preferredMp4Quality] - Preferred resolution (e.g. '1080p')
 * @param {number} [settings.preferredMp3BitrateKbps] - Preferred audio bitrate (128, 192, 320)
 * @returns {Promise<{ status: number, ok: boolean, data: { success: boolean, data?: object } }>}
 */
export function updateDownloadSettings(settings) {
  return apiRequest({
    path: '/api/settings/downloads',
    method: 'PATCH',
    body: settings
  })
}

