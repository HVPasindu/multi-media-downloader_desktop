import path from 'node:path'
import { pathToFileURL } from 'node:url'

const mockCpUrl = pathToFileURL(path.resolve('tests/helpers/mockChildProcess.js')).href

/**
 * Node.js ESM module loader for CLI test execution.
 * Mocks Electron runtime APIs for headless backend and packaging test suites,
 * and provides controllable child_process hooks for backend E2E tests.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return {
      format: 'module',
      shortCircuit: true,
      url: 'data:text/javascript,import os from "node:os"; export const app = { getPath: () => os.tmpdir(), getAppPath: () => ".", isPackaged: false }; export const BrowserWindow = {}; export const ipcMain = { handle: () => {} }; export const dialog = {}; export const shell = {};'
    }
  }

  if (
    (specifier === 'node:child_process' || specifier === 'child_process') &&
    context.parentURL &&
    !context.parentURL.includes('mockChildProcess.js')
  ) {
    return {
      format: 'module',
      shortCircuit: true,
      url: mockCpUrl
    }
  }

  return nextResolve(specifier, context)
}
