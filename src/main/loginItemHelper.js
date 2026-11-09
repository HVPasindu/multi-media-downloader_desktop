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
 * @param {boolean} [isDev] - Whether running in development mode (defaults to !app.isPackaged)
 * @returns {import('electron').Settings | {}}
 */
export function getWindowsLoginItemOptions(app, isDev = !app?.isPackaged) {
  if (isDev) {
    return {
      path: process.execPath,
      args: [app.getAppPath()]
    }
  }

  return {}
}
