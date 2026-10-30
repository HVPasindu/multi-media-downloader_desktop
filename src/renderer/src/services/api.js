/**
 * API Service for Renderer
 * Communicates with the local Express backend strictly through the secure
 * Electron preload IPC bridge (window.api.request).
 */

/**
 * Sends an API request through the Electron IPC bridge.
 *
 * @param {object} options
 * @param {string} options.path - API path starting with /api/
 * @param {'GET'|'POST'|'PATCH'|'DELETE'} [options.method='GET'] - HTTP method
 * @param {object|null} [options.body=null] - Request body
 * @returns {Promise<{ status: number, ok: boolean, data: any }>}
 */
export async function apiRequest({ path, method = 'GET', body = null }) {
  if (!window.api || typeof window.api.request !== 'function') {
    throw new Error('Electron API IPC bridge is not available')
  }

  const response = await window.api.request({ path, method, body })
  return response
}

/**
 * Verifies backend health and connectivity via GET /api/health.
 *
 * @returns {Promise<{ ok: boolean, message: string, data?: any }>}
 */
export async function checkApiHealth() {
  try {
    const response = await apiRequest({
      path: '/api/health',
      method: 'GET'
    })

    if (response.ok && response.data?.status === 'ok') {
      return {
        ok: true,
        message: response.data.message || 'API is healthy',
        data: response.data
      }
    }

    return {
      ok: false,
      message: response.data?.message || `API returned status ${response.status}`,
      data: response.data
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Prompts user to choose a download directory.
 *
 * @returns {Promise<string|null>}
 */
export async function chooseDownloadFolder() {
  if (!window.api || typeof window.api.chooseDownloadFolder !== 'function') {
    throw new Error('Folder selection IPC is not available')
  }
  return await window.api.chooseDownloadFolder()
}

/**
 * Retrieves the currently configured download folder.
 *
 * @returns {Promise<string>}
 */
export async function getDownloadFolder() {
  if (!window.api || typeof window.api.getDownloadFolder !== 'function') {
    throw new Error('Download folder retrieval IPC is not available')
  }
  return await window.api.getDownloadFolder()
}

