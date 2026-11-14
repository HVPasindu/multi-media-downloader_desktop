/**
 * Shared helper for consistent Windows Login Item options between
 * the application main process and Windows startup integration tests.
 *
 * In development mode (when app is unpackaged), Electron requires passing
 * process.execPath and the application path in args so that Windows creates
 * the registry entry pointing to the Electron development executable
 * with the project directory as argument.
 *
 * In production/packaged mode, Electron uses the installed executable directly.
 *
 * @param {import('electron').App} app - Electron application instance
 * @returns {import('electron').Settings | {}}
 */
export function getWindowsLoginItemOptions(app) {
  if (app && !app.isPackaged) {
    return {
      path: process.execPath,
      args: typeof app.getAppPath === 'function' ? [app.getAppPath()] : []
    }
  }

  return {}
}
