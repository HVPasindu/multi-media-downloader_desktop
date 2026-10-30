/**
 * Startup Manager
 * Tracks application initialization lifecycle states and broadcasts
 * genuine status updates to the Electron renderer window.
 */

let mainWindowRef = null

let currentStatus = {
  state: 'launching',
  message: 'Preparing desktop environment...',
  error: null,
  timestamp: Date.now()
}

/**
 * Registers the active BrowserWindow to receive status broadcasts.
 *
 * @param {import('electron').BrowserWindow|null} window
 */
export function setStartupWindow(window) {
  mainWindowRef = window
}

/**
 * Retrieves the latest startup status snapshot.
 * Useful for the renderer when mounting or polling initial state.
 *
 * @returns {{ state: string, message: string, error: string|null, timestamp: number }}
 */
export function getStartupStatus() {
  return { ...currentStatus }
}

/**
 * Updates the current startup state and emits an event to the renderer.
 *
 * @param {'launching'|'initializing_database'|'recovering_downloads'|'starting_backend'|'ready'|'error'} state
 * @param {string} message - Human-readable status description
 * @param {string|null} [error=null] - Error message if in failure state
 */
export function updateStartupStatus(state, message, error = null) {
  currentStatus = {
    state,
    message,
    error: error ? String(error) : null,
    timestamp: Date.now()
  }

  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    try {
      mainWindowRef.webContents.send('startup:status-changed', getStartupStatus())
    } catch (sendError) {
      console.warn('Could not deliver startup status to window:', sendError)
    }
  }
}

/**
 * Performs a clean Electron relaunch if startup encountered a fatal error.
 *
 * @param {import('electron').App} app
 */
export function restartApplication(app) {
  try {
    app.relaunch()
    app.exit(0)
  } catch (relaunchError) {
    console.error('Failed to relaunch application:', relaunchError)
    app.quit()
  }
}

