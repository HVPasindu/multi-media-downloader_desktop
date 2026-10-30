import { apiRequest } from './api'

/**
 * Media Analysis API Service
 * Communicates with the local Express backend strictly through the secure Electron IPC bridge.
 *
 * Endpoint: POST /api/media/analyze
 */

/**
 * Analyzes a media URL and retrieves platform metadata and available formats.
 *
 * @param {string} url - Valid media URL from supported platforms (YouTube, Facebook, Instagram, TikTok, X).
 * @returns {Promise<{ status: number, ok: boolean, data: { success: boolean, data?: object, message?: string } }>}
 */
export function analyzeMedia(url) {
  return apiRequest({
    path: '/api/media/analyze',
    method: 'POST',
    body: { url }
  })
}

