/**
 * Node.js ESM module loader for CLI test execution.
 * Mocks Electron runtime APIs for headless backend and packaging test suites.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return {
      format: 'module',
      shortCircuit: true,
      url: 'data:text/javascript,export const app = { getPath: () => ".", getAppPath: () => ".", isPackaged: false }; export const BrowserWindow = {}; export const ipcMain = { handle: () => {} }; export const dialog = {}; export const shell = {};'
    }
  }
  return nextResolve(specifier, context)
}

