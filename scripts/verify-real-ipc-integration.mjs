import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { initializeDatabase, closeDatabase } from '../src/main/backend/config/database.js'
import {
  setStartupWindow,
  getStartupWindow,
  getStartupStatus
} from '../src/main/ui/startupManager.js'
import {
  registerSettingsIpcHandlers,
  isTrustedSettingsIpcSender
} from '../src/main/ipc/settingsHandlers.js'
import { getWindowsLoginItemOptions } from '../src/main/loginItemHelper.js'

// Prevent Electron from auto-quitting prematurely when all test windows are closed,
// which would trigger node::FreeEnvironment before async database and file cleanup finish.
app.on('window-all-closed', (e) => {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault()
  }
})

async function run() {
  console.log('================================================================')
  console.log(' APPLAN2 — Real Windows Startup & Storage IPC Integration Tests ')
  console.log(' Scope: Renderer -> Preload (window.api) -> Production IPC -> Win32')
  console.log('================================================================\n')

  assert.equal(process.platform, 'win32', 'Tests must execute on Windows platform')

  let mainWindow = null
  let unauthorizedOriginWindow = null
  let differentWindow = null
  let tempRoot = null
  let databaseInitialized = false

  let originalStartupSetting = null
  let hasCapturedOriginalStartupSetting = false

  let testError = null
  const cleanupErrors = []

  try {
    // 1. Create unique temporary directory and initialize isolated SQLite database
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'applan2-settings-ipc-'))
    const databasePath = path.join(tempRoot, 'isolated_test.db')
    console.log(`[Database Isolation] Initializing isolated test database at: ${databasePath}`)

    const { databasePath: actualDbPath } = await initializeDatabase({
      storage: databasePath
    })
    databaseInitialized = true

    assert.equal(
      path.resolve(actualDbPath),
      path.resolve(databasePath),
      'Actual database path must strictly match isolated temporary path'
    )
    assert.ok(
      actualDbPath.includes('applan2-settings-ipc-'),
      'Database must reside inside the unique temporary test directory'
    )
    console.log('[Database Isolation] Isolated database initialized successfully with migrations.')

    // 2. Validate production build artifacts
    const preloadPath = path.resolve('out/preload/index.js')
    const rendererFilePath = path.resolve('out/renderer/index.html')

    assert.ok(
      fs.existsSync(preloadPath),
      `Compiled preload script must exist at ${preloadPath}. Run npm run build first.`
    )
    assert.ok(
      fs.existsSync(rendererFilePath),
      `Compiled renderer index.html must exist at ${rendererFilePath}. Run npm run build first.`
    )
    console.log('[Artifacts] Verified compiled preload and renderer files exist.')

    // 3. Register production startup status IPC handler so the renderer's App/Splash mounts cleanly
    ipcMain.handle('startup:get-status', () => {
      return getStartupStatus()
    })

    // 4. Create real BrowserWindow with compiled preload script and production renderer file
    mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        preload: preloadPath,
        sandbox: false,
        contextIsolation: true
      }
    })

    mainWindow.webContents.on('console-message', (_, level, message) => {
      if (!message.includes('Electron Security Warning')) {
        console.log(`[Renderer Console] ${message}`)
      }
    })

    // Set trusted startup window before registering IPC handlers and loading renderer
    setStartupWindow(mainWindow)

    // 5. Register production IPC handlers using shared production module with full security config
    registerSettingsIpcHandlers({
      ipcMain,
      app,
      BrowserWindow,
      dialog,
      getStartupWindow,
      isDev: false,
      rendererUrl: undefined,
      rendererFilePath
    })
    console.log(
      '[Setup] Registered production IPC handlers with production origin & file path security.'
    )

    // 6. Load production renderer index.html
    await mainWindow.loadFile(rendererFilePath)
    console.log('[Setup] Real BrowserWindow loaded production renderer file successfully.\n')

    // ------------------------------------------------------------------------
    // VERIFY PRELOAD BRIDGE INTEGRITY
    // ------------------------------------------------------------------------
    console.log('--- Checking Preload Bridge Integrity ---')
    const apiType = await mainWindow.webContents.executeJavaScript('typeof window.api')
    assert.equal(apiType, 'object', 'window.api must be exposed on renderer window')

    const bridgeFunctions = await mainWindow.webContents.executeJavaScript(`({
      getStartWithWindows: typeof window.api.getStartWithWindows === 'function',
      setStartWithWindows: typeof window.api.setStartWithWindows === 'function',
      getStorageInfo: typeof window.api.getStorageInfo === 'function',
      getDownloadFolder: typeof window.api.getDownloadFolder === 'function',
      chooseDownloadFolder: typeof window.api.chooseDownloadFolder === 'function'
    })`)

    assert.equal(bridgeFunctions.getStartWithWindows, true)
    assert.equal(bridgeFunctions.setStartWithWindows, true)
    assert.equal(bridgeFunctions.getStorageInfo, true)
    assert.equal(bridgeFunctions.getDownloadFolder, true)
    assert.equal(bridgeFunctions.chooseDownloadFolder, true)
    console.log('✓ Preload bridge contracts verified (all 5 methods available).\n')

    // ------------------------------------------------------------------------
    // PHASE 05.1 — REAL WINDOWS STARTUP IPC INTEGRATION TESTS
    // ------------------------------------------------------------------------
    console.log('--- PHASE 05.1: Real Windows Startup IPC Integration ---')

    // Test A: Read current startup setting through window.api
    console.log('Test A: Reading initial startup setting via window.api.getStartWithWindows()...')
    const initialRes = await mainWindow.webContents.executeJavaScript(
      'window.api.getStartWithWindows()'
    )
    console.log('  Initial Response:', initialRes)
    assert.equal(typeof initialRes, 'object', 'Response must be an object')
    assert.equal(initialRes.supported, true, 'Supported must be true on Windows')
    assert.equal(typeof initialRes.enabled, 'boolean', 'Enabled must be a strict boolean')
    assert.equal(initialRes.error, undefined, 'Error must be undefined on success')

    // Capture original preference safely BEFORE any mutation
    originalStartupSetting = initialRes.enabled
    hasCapturedOriginalStartupSetting = true
    console.log(
      `✓ Test A Passed: Startup read successful via IPC. Original enabled = ${originalStartupSetting}\n`
    )

    // Test B: Startup ON through IPC
    console.log('Test B: Toggling Startup -> ON via window.api.setStartWithWindows(true)...')
    const setOnRes = await mainWindow.webContents.executeJavaScript(
      'window.api.setStartWithWindows(true)'
    )
    console.log('  Set ON Response:', setOnRes)
    assert.equal(setOnRes.supported, true, 'Supported must be true')
    assert.equal(setOnRes.enabled, true, 'Enabled must be confirmed true')

    const verifyOnRes = await mainWindow.webContents.executeJavaScript(
      'window.api.getStartWithWindows()'
    )
    console.log('  Read-back ON Response:', verifyOnRes)
    assert.equal(verifyOnRes.enabled, true, 'Read-back must confirm enabled === true')
    console.log('✓ Test B Passed: Startup ON successfully applied and read back via IPC.\n')

    // Test C: Startup OFF through IPC
    console.log('Test C: Toggling Startup -> OFF via window.api.setStartWithWindows(false)...')
    const setOffRes = await mainWindow.webContents.executeJavaScript(
      'window.api.setStartWithWindows(false)'
    )
    console.log('  Set OFF Response:', setOffRes)
    assert.equal(setOffRes.supported, true, 'Supported must be true')
    assert.equal(setOffRes.enabled, false, 'Enabled must be confirmed false')

    const verifyOffRes = await mainWindow.webContents.executeJavaScript(
      'window.api.getStartWithWindows()'
    )
    console.log('  Read-back OFF Response:', verifyOffRes)
    assert.equal(verifyOffRes.enabled, false, 'Read-back must confirm enabled === false')
    console.log('✓ Test C Passed: Startup OFF successfully applied and read back via IPC.\n')

    // ------------------------------------------------------------------------
    // PHASE 05.2 — REAL STORAGE INFORMATION & DOWNLOAD FOLDER IPC TESTS
    // ------------------------------------------------------------------------
    console.log('--- PHASE 05.2: Real Storage Information & Download Folder IPC ---')

    // Retrieve saved download folder via IPC
    console.log('Test 1: Retrieving saved download folder via window.api.getDownloadFolder()...')
    const folderPath = await mainWindow.webContents.executeJavaScript(
      'window.api.getDownloadFolder()'
    )
    console.log('  Saved Download Folder:', folderPath)
    assert.equal(typeof folderPath, 'string', 'Download folder must be a string')
    assert.ok(folderPath.length > 0, 'Download folder must not be empty')
    console.log('✓ Test 1 Passed: Download folder retrieved successfully via IPC.\n')

    // Retrieve real storage information via IPC
    console.log('Test 2: Retrieving real storage info via window.api.getStorageInfo()...')
    const storageInfo = await mainWindow.webContents.executeJavaScript(
      'window.api.getStorageInfo()'
    )
    console.log('  Storage Info Response:', storageInfo)

    assert.equal(typeof storageInfo, 'object', 'Storage response must be an object')
    assert.equal(typeof storageInfo.available, 'boolean', 'available must be boolean')
    assert.equal(storageInfo.available, true, 'Drive containing download folder must be accessible')
    assert.equal(storageInfo.folderPath, folderPath, 'folderPath must match saved download folder')
    assert.equal(typeof storageInfo.resolvedPath, 'string', 'resolvedPath must be string')
    assert.ok(fs.existsSync(storageInfo.resolvedPath), 'resolvedPath must physically exist')

    assert.ok(storageInfo.totalBytes > 0, 'totalBytes must be > 0')
    assert.ok(storageInfo.usedBytes >= 0, 'usedBytes must be >= 0')
    assert.ok(storageInfo.freeBytes >= 0, 'freeBytes must be >= 0')
    assert.equal(
      storageInfo.totalBytes,
      storageInfo.usedBytes + storageInfo.freeBytes,
      'Byte arithmetic: totalBytes === usedBytes + freeBytes'
    )

    const percentUsed = Math.round((storageInfo.usedBytes / storageInfo.totalBytes) * 100)
    assert.ok(percentUsed >= 0 && percentUsed <= 100, 'Percent used must be 0-100')
    console.log(
      `  Calculation: total=${storageInfo.totalBytes}, used=${storageInfo.usedBytes}, free=${storageInfo.freeBytes} (${percentUsed}% used)`
    )
    console.log('✓ Test 2 Passed: Real filesystem storage info verified via IPC.\n')

    // ------------------------------------------------------------------------
    // PHASE 05.3 — REAL UNAUTHORIZED PRODUCTION ORIGIN & WINDOW ISOLATION CHECKS
    // ------------------------------------------------------------------------
    console.log('--- PHASE 05.3: Real Unauthorized Origin & Window Isolation Checks ---')

    // Direct helper security checks
    assert.equal(
      isTrustedSettingsIpcSender({}, { BrowserWindow, getStartupWindow }),
      false,
      'Empty event must be rejected'
    )
    assert.equal(
      isTrustedSettingsIpcSender({ sender: null }, { BrowserWindow, getStartupWindow }),
      false,
      'Null sender must be rejected'
    )

    // Check 1: Real Production File-Path Validation
    // A window registered as trusted startup window, but loading an unauthorized local HTML file
    console.log('Testing unauthorized local HTML file rejection (production file-path check)...')
    const untrustedHtmlPath = path.join(tempRoot, 'untrusted-renderer.html')
    fs.writeFileSync(
      untrustedHtmlPath,
      '<!doctype html><html><body><h1>Unauthorized test page</h1></body></html>'
    )

    unauthorizedOriginWindow = new BrowserWindow({
      width: 400,
      height: 300,
      show: false,
      webPreferences: {
        preload: preloadPath,
        sandbox: false,
        contextIsolation: true
      }
    })

    // Deliberately set as trusted window so Checks 1-4 pass and Check 6 (file-path validation) is reached
    setStartupWindow(unauthorizedOriginWindow)
    await unauthorizedOriginWindow.loadFile(untrustedHtmlPath)

    const unauthOriginResult = await unauthorizedOriginWindow.webContents.executeJavaScript(`
      window.api.getStartWithWindows()
        .then(value => ({ success: true, value }))
        .catch(error => ({
          success: false,
          message: error.message
        }))
    `)
    console.log('  Unauthorized Local HTML Origin Result:', unauthOriginResult)
    assert.equal(
      unauthOriginResult.success,
      false,
      'Unauthorized HTML file must not succeed in invoking IPC'
    )
    assert.ok(
      unauthOriginResult.message.includes('Unauthorized IPC sender'),
      'Unauthorized local HTML file must be rejected by production file-path validation'
    )

    // Restore original startup window reference
    setStartupWindow(mainWindow)
    unauthorizedOriginWindow.destroy()
    unauthorizedOriginWindow = null
    console.log('✓ Test passed: Unauthorized local HTML file rejected by file-path validation.\n')

    // Check 2: Different BrowserWindow Rejection
    console.log('Testing unauthorized different BrowserWindow rejection...')
    differentWindow = new BrowserWindow({
      width: 400,
      height: 300,
      show: false,
      webPreferences: {
        preload: preloadPath,
        sandbox: false,
        contextIsolation: true
      }
    })

    await differentWindow.loadURL(
      'data:text/html,<!DOCTYPE html><html><body><h1>Untrusted Window</h1></body></html>'
    )

    const diffStartupResult = await differentWindow.webContents.executeJavaScript(`
      window.api.getStartWithWindows().catch(err => ({ caught: true, message: err.message }))
    `)
    console.log('  Different Window Startup Result:', diffStartupResult)
    assert.ok(
      diffStartupResult.caught && diffStartupResult.message.includes('Unauthorized IPC sender'),
      'Different BrowserWindow must be rejected on startup read'
    )

    const diffFolderResult = await differentWindow.webContents.executeJavaScript(`
      window.api.getDownloadFolder().catch(err => ({ caught: true, message: err.message }))
    `)
    console.log('  Different Window Folder Result:', diffFolderResult)
    assert.ok(
      diffFolderResult.caught && diffFolderResult.message.includes('Unauthorized IPC sender'),
      'Different BrowserWindow must be rejected on folder read'
    )

    const diffStorageResult = await differentWindow.webContents.executeJavaScript(`
      window.api.getStorageInfo().catch(err => ({ caught: true, message: err.message }))
    `)
    console.log('  Different Window Storage Result:', diffStorageResult)
    assert.ok(
      diffStorageResult.caught && diffStorageResult.message.includes('Unauthorized IPC sender'),
      'Different BrowserWindow must be rejected on storage read'
    )

    differentWindow.destroy()
    differentWindow = null
    console.log('✓ Test passed: Different BrowserWindow rejected with Unauthorized IPC sender.\n')
  } catch (err) {
    testError = err
    console.error('[REAL IPC TEST FAILURE]', err)
  } finally {
    // 1. Safe restoration of Windows startup setting if captured
    if (hasCapturedOriginalStartupSetting) {
      let restored = false

      // Preferred path: Restore via mainWindow IPC
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          console.log(
            `\n[Cleanup] Restoring original Windows startup setting (${originalStartupSetting}) via IPC...`
          )
          const restoreRes = await mainWindow.webContents.executeJavaScript(
            `window.api.setStartWithWindows(${originalStartupSetting})`
          )
          if (restoreRes && restoreRes.enabled === originalStartupSetting) {
            const finalReadBack = await mainWindow.webContents.executeJavaScript(
              'window.api.getStartWithWindows()'
            )
            if (finalReadBack && finalReadBack.enabled === originalStartupSetting) {
              restored = true
              console.log(
                `✓ [Cleanup] Original Windows startup preference successfully restored to ${originalStartupSetting} via IPC.\n`
              )
            }
          }
        } catch (ipcErr) {
          console.warn(
            '[Cleanup] IPC restoration failed or window unavailable, falling back to native API:',
            ipcErr?.message || ipcErr
          )
        }
      }

      // Fallback path: Native Electron API restoration
      if (!restored) {
        try {
          console.log(
            `[Cleanup] Fallback: Restoring original Windows startup preference (${originalStartupSetting}) via native Electron API...`
          )
          const options = getWindowsLoginItemOptions(app)
          app.setLoginItemSettings({
            openAtLogin: originalStartupSetting,
            ...options
          })
          const nativeReadBack = app.getLoginItemSettings(options)
          if (nativeReadBack && nativeReadBack.openAtLogin === originalStartupSetting) {
            restored = true
            console.log(
              `✓ [Cleanup] Fallback succeeded: Restored Windows startup preference to ${originalStartupSetting} via native API.\n`
            )
          } else {
            const err = new Error(
              `Native read-back verification failed: expected ${originalStartupSetting}, got ${nativeReadBack?.openAtLogin}`
            )
            cleanupErrors.push(err)
            console.error(
              'CRITICAL: Failed to restore Windows startup preference via native API:',
              err
            )
          }
        } catch (nativeErr) {
          cleanupErrors.push(nativeErr)
          console.error(
            'CRITICAL: Failed to restore Windows startup preference via native API:',
            nativeErr
          )
        }
      }

      if (!restored) {
        cleanupErrors.push(
          new Error(
            `Failed to restore original Windows startup setting to ${originalStartupSetting}`
          )
        )
      }
    }

    // 2. Remove all registered IPC handlers to stop receiving renderer requests
    try {
      ipcMain.removeHandler('startup:get-status')
      ipcMain.removeHandler('downloads:choose-folder')
      ipcMain.removeHandler('downloads:get-folder')
      ipcMain.removeHandler('app-settings:get-start-with-windows')
      ipcMain.removeHandler('app-settings:set-start-with-windows')
      ipcMain.removeHandler('downloads:get-storage-info')
      console.log('[Cleanup] Removed all registered IPC handlers.')
    } catch (ipcRemoveErr) {
      cleanupErrors.push(ipcRemoveErr)
      console.error('Failed to remove IPC handlers:', ipcRemoveErr)
    }

    // 3. Destroy test windows safely and clear startup window reference
    try {
      if (unauthorizedOriginWindow && !unauthorizedOriginWindow.isDestroyed()) {
        unauthorizedOriginWindow.destroy()
      }
      if (differentWindow && !differentWindow.isDestroyed()) {
        differentWindow.destroy()
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.destroy()
      }
      setStartupWindow(null)
      console.log('[Cleanup] All test BrowserWindows destroyed.')
    } catch (winErr) {
      cleanupErrors.push(winErr)
      console.error('Failed to destroy test windows:', winErr)
    }

    // 4. Close isolated database
    if (databaseInitialized) {
      try {
        console.log('[Cleanup] Closing isolated database connection...')
        await closeDatabase()
        console.log('[Cleanup] Isolated database closed.')
      } catch (dbCloseErr) {
        cleanupErrors.push(dbCloseErr)
        console.error('Failed to close isolated test database:', dbCloseErr)
      }
    }

    // 5. Remove temporary test directory with bounded retries
    if (tempRoot && fs.existsSync(tempRoot)) {
      try {
        console.log(`[Cleanup] Removing temporary test directory: ${tempRoot}`)
        await fs.promises.rm(tempRoot, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100
        })
        assert.equal(
          fs.existsSync(tempRoot),
          false,
          'Temporary test directory must be completely removed'
        )
        console.log('[Cleanup] Temporary test directory removed successfully.')
      } catch (rmErr) {
        cleanupErrors.push(rmErr)
        console.error('Failed to remove temporary test directory:', rmErr)
      }
    }

    // 6. Explicitly quit Electron
    app.quit()
  }

  // Determine final result and report only AFTER all cleanup has executed
  if (testError || cleanupErrors.length > 0) {
    process.exitCode = 1
    console.error('================================================================')
    console.error(' REAL IPC INTEGRATION TEST: FAILED                              ')
    console.error('================================================================')
    if (testError) {
      console.error('[TEST ERROR]', testError)
    }
    for (const error of cleanupErrors) {
      console.error('[CLEANUP ERROR]', error)
    }
    return
  }

  console.log('================================================================')
  console.log(' ALL REAL IPC INTEGRATION TESTS PASSED SUCCESSFULLY (100% PASS)  ')
  console.log('================================================================\n')
}

app
  .whenReady()
  .then(run)
  .catch((err) => {
    console.error('[FATAL IPC TEST ERROR]', err)
    process.exitCode = 1
    app.quit()
  })
