/**
 * Startup Service for Renderer
 * Bridges Electron main-process lifecycle state and API health verification
 * to provide a clear, real-time startup status for the React Splash Screen.
 */

import { checkApiHealth } from './api.js'

/**
 * Retrieves initial startup status from Electron main process.
 *
 * @returns {Promise<{ state: string, message: string, error: string|null, timestamp: number }>}
 */
export async function getInitialStartupStatus() {
  if (window.startup && typeof window.startup.getStatus === 'function') {
    try {
      return await window.startup.getStatus()
    } catch (err) {
      console.warn('Could not retrieve startup status from main process:', err)
    }
  }

  // Safe fallback if running outside Electron
  return {
    state: 'ready',
    message: 'Development runtime environment',
    error: null,
    timestamp: Date.now()
  }
}

/**
 * Subscribes to real-time startup status change events from Electron.
 *
 * @param {(status: { state: string, message: string, error: string|null, timestamp: number }) => void} callback
 * @returns {() => void} Unsubscribe function
 */
export function subscribeStartupStatus(callback) {
  if (window.startup && typeof window.startup.onStatusChange === 'function') {
    return window.startup.onStatusChange(callback)
  }
  return () => {}
}

/**
 * Triggers a clean application relaunch through the Electron startup bridge.
 */
export async function restartApplication() {
  if (window.startup && typeof window.startup.restartApplication === 'function') {
    return await window.startup.restartApplication()
  }
  window.location.reload()
}

/**
 * Verifies backend readiness and verifies GET /api/health through IPC.
 *
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function verifyBackendHealth() {
  return await checkApiHealth()
}

