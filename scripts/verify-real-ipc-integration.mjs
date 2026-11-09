import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { initializeDatabase, closeDatabase } from '../src/main/backend/config/database.js'
import { setStartupWindow, getStartupWindow } from '../src/main/ui/startupManager.js'
import {
  registerSettingsIpcHandlers,
  isTrustedSettingsIpcSender
} from '../src/main/ipc/settingsHandlers.js'

let mainWindow = null
let unauthorizedWindow = null
let tempRoot = null
let originalStartupSetting = null
let hasCapturedOriginalStartupSetting = false

async function run() {
  console.log('================================================================')
  console.log(' APPLAN2 — Real Windows Startup & Storage IPC Integration Tests ')
  console.log(' Scope: Renderer -> Preload (window.api) -> Production IPC -> Win32')
  console.log('================================================================\n')

  assert.equal(process.platform, 'win32', 'Tests must execute on Windows platform')

  // 1. Create unique temporary directory and initialize isolated SQLite database
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'applan2-settings-ipc-'))
  const databasePath = path.join(tempRoot, 'isolated_test.db')
  console.log(`[Database Isolation] Initializing isolated test database at: ${databasePath}`)

  const { databasePath: actualDbPath } = await initializeDatabase({
    storage: databasePath
  })

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

  // 3. Create real BrowserWindow with compiled preload script and production renderer file
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
    // Filter out cosmetic warnings from dev/eval
    if (!message.includes('Electron Security Warning')) {
      console.log(`[Renderer Console] ${message}`)
    }
  })

  // Set trusted startup window before registering IPC handlers and loading renderer
  setStartupWindow(mainWindow)

  // 4. Register production IPC handlers using shared production module with full security config
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

  // 5. Load production renderer index.html
  await mainWindow.loadFile(rendererFilePath)
  console.log('[Setup] Real BrowserWindow loaded production renderer file successfully.\n')

  try {
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
    // PHASE 05.3 — REAL UNAUTHORIZED IPC SENDER ISOLATION CHECKS
    // ------------------------------------------------------------------------
    console.log('--- PHASE 05.3: Real Unauthorized Window Isolation Checks ---')

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

    // Create an unauthorized second BrowserWindow with an untrusted origin
    console.log('Testing unauthorized second BrowserWindow rejection...')
    unauthorizedWindow = new BrowserWindow({
      width: 400,
      height: 300,
      show: false,
      webPreferences: {
        preload: preloadPath,
        sandbox: false,
        contextIsolation: true
      }
    })

    // Load an untrusted data URL to verify origin rejection
    await unauthorizedWindow.loadURL(
      'data:text/html,<!DOCTYPE html><html><body><h1>Untrusted</h1></body></html>'
    )

    const unauthStartupResult = await unauthorizedWindow.webContents.executeJavaScript(`
      window.api.getStartWithWindows().catch(err => ({ caught: true, message: err.message }))
    `)
    console.log('  Unauthorized Startup Call Result:', unauthStartupResult)
    assert.ok(
      unauthStartupResult.caught && unauthStartupResult.message.includes('Unauthorized IPC sender'),
      'Unauthorized second BrowserWindow must be rejected on startup read'
    )

    const unauthFolderResult = await unauthorizedWindow.webContents.executeJavaScript(`
      window.api.getDownloadFolder().catch(err => ({ caught: true, message: err.message }))
    `)
    console.log('  Unauthorized Folder Call Result:', unauthFolderResult)
    assert.ok(
      unauthFolderResult.caught && unauthFolderResult.message.includes('Unauthorized IPC sender'),
      'Unauthorized second BrowserWindow must be rejected on folder read'
    )

    const unauthStorageResult = await unauthorizedWindow.webContents.executeJavaScript(`
      window.api.getStorageInfo().catch(err => ({ caught: true, message: err.message }))
    `)
    console.log('  Unauthorized Storage Call Result:', unauthStorageResult)
    assert.ok(
      unauthStorageResult.caught && unauthStorageResult.message.includes('Unauthorized IPC sender'),
      'Unauthorized second BrowserWindow must be rejected on storage read'
    )

    console.log(
      '✓ Phase 05.3 Passed: Unauthorized window calls fail closed with Unauthorized IPC sender.\n'
    )

    console.log('================================================================')
    console.log(' ALL REAL IPC INTEGRATION TESTS PASSED SUCCESSFULLY (100% PASS)  ')
    console.log('================================================================\n')
  } finally {
    // 1. Safe restoration of original Windows startup setting
    try {
      if (hasCapturedOriginalStartupSetting) {
        console.log(
          `\n[Cleanup] Restoring original Windows startup setting (${originalStartupSetting}) via IPC...`
        )
        const restoreRes = await mainWindow.webContents.executeJavaScript(
          `window.api.setStartWithWindows(${originalStartupSetting})`
        )
        console.log('  Restore Response:', restoreRes)
        assert.equal(
          restoreRes.enabled,
          originalStartupSetting,
          'Restored enabled state must match original'
        )

        const verifyRestored = await mainWindow.webContents.executeJavaScript(
          'window.api.getStartWithWindows()'
        )
        assert.equal(
          verifyRestored.enabled,
          originalStartupSetting,
          'Final read-back must match original preference exactly'
        )
        console.log(
          `✓ [Cleanup] Original Windows startup preference successfully restored to ${originalStartupSetting}.\n`
        )
      }
    } catch (restoreErr) {
      console.error(
        'CRITICAL: Failed to restore Windows startup preference in cleanup:',
        restoreErr
      )
      process.exitCode = 1
    }

    // 2. Destroy windows
    try {
      if (unauthorizedWindow && !unauthorizedWindow.isDestroyed()) {
        unauthorizedWindow.destroy()
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.destroy()
      }
    } catch (winErr) {
      console.error('Failed to destroy test windows:', winErr)
    }

    // 3. Close isolated database
    try {
      console.log('[Cleanup] Closing isolated database connection...')
      await closeDatabase()
      console.log('[Cleanup] Isolated database closed.')
    } catch (dbCloseErr) {
      console.error('Failed to close isolated test database:', dbCloseErr)
    }

    // 4. Clean up temporary test directory
    try {
      if (tempRoot && fs.existsSync(tempRoot)) {
        console.log(`[Cleanup] Removing temporary test directory: ${tempRoot}`)
        fs.rmSync(tempRoot, { recursive: true, force: true })
        assert.ok(!fs.existsSync(tempRoot), 'Temporary test directory must be completely removed')
        console.log('[Cleanup] Temporary test directory removed successfully.')
      }
    } catch (rmErr) {
      console.error('Failed to remove temporary test directory:', rmErr)
    }

    // 5. Quit electron
    app.quit()
  }
}

app.whenReady().then(run)
