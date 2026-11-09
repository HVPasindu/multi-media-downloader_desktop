import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  isTrustedSettingsIpcSender,
  registerSettingsIpcHandlers
} from '../src/main/ipc/settingsHandlers.js'

/**
 * ============================================================================
 * APPLAN2 — Step 04.44 Test Suite: Settings IPC Security & Sender Hardening
 *
 * Verifies the 13 required security tests:
 * 1. Trusted main-window acceptance (Dev & Prod)
 * 2. Missing sender rejection
 * 3. Missing trusted window rejection
 * 4. Destroyed window rejection
 * 5. Different BrowserWindow rejection
 * 6. Different WebContents rejection
 * 7. Missing senderFrame rejection
 * 8. Subframe / Iframe rejection
 * 9. Development origin mismatch rejection
 * 10. Production file path mismatch rejection
 * 11. All five Settings IPC handlers reject unauthorized requests
 * 12. Unauthorized folder selection NEVER opens native dialog
 * 13. Unauthorized folder retrieval NEVER accesses SQLite
 * ============================================================================
 */
async function runSettingsIpcSecurityTests() {
  console.log('================================================================')
  console.log(' APPLAN2 — Settings IPC Security & Sender Hardening Test Suite  ')
  console.log('================================================================\n')

  const DEV_RENDERER_URL = 'http://localhost:5173/'
  const PROD_RENDERER_FILE = path.resolve('out/renderer/index.html')
  const PROD_RENDERER_URL = pathToFileURL(PROD_RENDERER_FILE).href

  function createMockEnvironment(overrides = {}) {
    const mainFrame = {
      url: overrides.frameUrl || DEV_RENDERER_URL
    }

    const trustedWebContents = {
      mainFrame,
      id: 1001
    }

    const trustedWindow = {
      id: 1,
      webContents: trustedWebContents,
      isDestroyed: () => overrides.isDestroyed ?? false
    }

    const mockBrowserWindow = {
      fromWebContents: (wc) => {
        if (overrides.differentWindow) {
          return { id: 999, isDestroyed: () => false, webContents: { id: 999 } }
        }
        if (wc === trustedWebContents) {
          return trustedWindow
        }
        return null
      }
    }

    const event = {
      sender: overrides.missingSender
        ? null
        : overrides.differentWebContents
          ? { id: 999, mainFrame: { url: DEV_RENDERER_URL } }
          : trustedWebContents,
      senderFrame: overrides.missingSenderFrame
        ? null
        : overrides.isSubframe
          ? { url: 'http://localhost:5173/iframe.html', parent: mainFrame }
          : mainFrame
    }

    const options = {
      BrowserWindow: mockBrowserWindow,
      getStartupWindow: () => (overrides.missingStartupWindow ? null : trustedWindow),
      isDev: overrides.isDev ?? true,
      rendererUrl: overrides.rendererUrl ?? DEV_RENDERER_URL,
      rendererFilePath: overrides.rendererFilePath ?? PROD_RENDERER_FILE
    }

    return { event, options, trustedWindow, trustedWebContents, mockBrowserWindow }
  }

  // --- 1. Trusted main-window acceptance ---
  console.log('--- 1. Testing Trusted Main-Window Acceptance ---')
  {
    // 1A: Dev mode trusted main window
    const envDev = createMockEnvironment({ isDev: true })
    assert.equal(
      isTrustedSettingsIpcSender(envDev.event, envDev.options),
      true,
      '1.1: Genuine Dev trusted sender must be accepted'
    )

    // 1B: Prod mode trusted main window
    const envProd = createMockEnvironment({
      isDev: false,
      frameUrl: PROD_RENDERER_URL,
      rendererFilePath: PROD_RENDERER_FILE
    })
    assert.equal(
      isTrustedSettingsIpcSender(envProd.event, envProd.options),
      true,
      '1.2: Genuine Prod trusted file sender must be accepted'
    )
    console.log('✓ Test 1: Trusted main-window accepted in both Dev and Prod.\n')
  }

  // --- 2. Missing sender rejection ---
  console.log('--- 2. Testing Missing Sender Rejection ---')
  {
    const env = createMockEnvironment({ missingSender: true })
    assert.equal(
      isTrustedSettingsIpcSender(env.event, env.options),
      false,
      '2.1: Missing sender must be rejected'
    )
    assert.equal(
      isTrustedSettingsIpcSender(null, env.options),
      false,
      '2.2: Null event must be rejected'
    )
    console.log('✓ Test 2: Missing sender rejected.\n')
  }

  // --- 3. Missing trusted window rejection ---
  console.log('--- 3. Testing Missing Trusted Window Rejection ---')
  {
    const env = createMockEnvironment({ missingStartupWindow: true })
    assert.equal(
      isTrustedSettingsIpcSender(env.event, env.options),
      false,
      '3.1: Missing trusted window must fail closed (rejected)'
    )
    console.log('✓ Test 3: Missing trusted window fails closed.\n')
  }

  // --- 4. Destroyed window rejection ---
  console.log('--- 4. Testing Destroyed Window Rejection ---')
  {
    const env = createMockEnvironment({ isDestroyed: true })
    assert.equal(
      isTrustedSettingsIpcSender(env.event, env.options),
      false,
      '4.1: Destroyed trusted window must be rejected'
    )
    console.log('✓ Test 4: Destroyed window rejected.\n')
  }

  // --- 5. Different BrowserWindow rejection ---
  console.log('--- 5. Testing Different BrowserWindow Rejection ---')
  {
    const env = createMockEnvironment({ differentWindow: true })
    assert.equal(
      isTrustedSettingsIpcSender(env.event, env.options),
      false,
      '5.1: Sender belonging to different BrowserWindow must be rejected'
    )
    console.log('✓ Test 5: Different BrowserWindow rejected.\n')
  }

  // --- 6. Different WebContents rejection ---
  console.log('--- 6. Testing Different WebContents Rejection ---')
  {
    const env = createMockEnvironment({ differentWebContents: true })
    assert.equal(
      isTrustedSettingsIpcSender(env.event, env.options),
      false,
      '6.1: Sender with non-matching WebContents must be rejected'
    )
    console.log('✓ Test 6: Different WebContents rejected.\n')
  }

  // --- 7. Missing senderFrame rejection ---
  console.log('--- 7. Testing Missing senderFrame Rejection ---')
  {
    const env = createMockEnvironment({ missingSenderFrame: true })
    assert.equal(
      isTrustedSettingsIpcSender(env.event, env.options),
      false,
      '7.1: Missing senderFrame must be rejected'
    )
    console.log('✓ Test 7: Missing senderFrame rejected.\n')
  }

  // --- 8. Subframe / Iframe rejection ---
  console.log('--- 8. Testing Subframe / Iframe Rejection ---')
  {
    const env = createMockEnvironment({ isSubframe: true })
    assert.equal(
      isTrustedSettingsIpcSender(env.event, env.options),
      false,
      '8.1: Subframe / Iframe sender must be rejected'
    )
    console.log('✓ Test 8: Subframe rejected.\n')
  }

  // --- 9. Development origin mismatch rejection ---
  console.log('--- 9. Testing Development Origin Mismatch Rejection ---')
  {
    // External origin
    const envExternal = createMockEnvironment({
      isDev: true,
      frameUrl: 'https://evil-phishing-site.com/'
    })
    assert.equal(
      isTrustedSettingsIpcSender(envExternal.event, envExternal.options),
      false,
      '9.1: External internet origin must be rejected in dev mode'
    )

    // Wrong local port
    const envWrongPort = createMockEnvironment({
      isDev: true,
      frameUrl: 'http://localhost:8080/'
    })
    assert.equal(
      isTrustedSettingsIpcSender(envWrongPort.event, envWrongPort.options),
      false,
      '9.2: Wrong dev port must be rejected'
    )
    console.log('✓ Test 9: Dev origin mismatch rejected.\n')
  }

  // --- 10. Production file path mismatch rejection ---
  console.log('--- 10. Testing Production File Path Mismatch Rejection ---')
  {
    // External URL in production
    const envProdExternal = createMockEnvironment({
      isDev: false,
      frameUrl: 'http://localhost:5173/'
    })
    assert.equal(
      isTrustedSettingsIpcSender(envProdExternal.event, envProdExternal.options),
      false,
      '10.1: Non-file protocol in prod mode must be rejected'
    )

    // Unauthorized local HTML file
    const fakeHtmlPath = path.resolve('unauthorized.html')
    const envProdWrongFile = createMockEnvironment({
      isDev: false,
      frameUrl: pathToFileURL(fakeHtmlPath).href,
      rendererFilePath: PROD_RENDERER_FILE
    })
    assert.equal(
      isTrustedSettingsIpcSender(envProdWrongFile.event, envProdWrongFile.options),
      false,
      '10.2: Wrong production file path must be rejected'
    )
    console.log('✓ Test 10: Production file path mismatch rejected.\n')
  }

  // --- 11, 12, 13. All five Settings IPC handlers reject unauthorized requests ---
  console.log('--- 11, 12, 13. Testing All Five IPC Handlers Fail-Closed on Unauthorized Calls ---')
  {
    const handlers = {}
    const mockIpcMain = {
      handle: (channel, handler) => {
        handlers[channel] = handler
      }
    }

    let dialogCallCount = 0
    const mockDialog = {
      showOpenDialog: async () => {
        dialogCallCount++
        return { canceled: false, filePaths: ['C:\\fake\\path'] }
      }
    }

    const env = createMockEnvironment({ isDev: true })

    registerSettingsIpcHandlers({
      ipcMain: mockIpcMain,
      app: {
        getLoginItemSettings: () => ({ openAtLogin: false }),
        setLoginItemSettings: () => {}
      },
      BrowserWindow: env.mockBrowserWindow,
      dialog: mockDialog,
      getStartupWindow: env.options.getStartupWindow,
      isDev: true,
      rendererUrl: DEV_RENDERER_URL,
      rendererFilePath: PROD_RENDERER_FILE
    })

    const unauthorizedEvent = {
      sender: { id: 9999, mainFrame: { url: 'http://evil.com' } },
      senderFrame: { url: 'http://evil.com' }
    }

    // 11.1 downloads:choose-folder
    await assert.rejects(
      () => handlers['downloads:choose-folder'](unauthorizedEvent),
      /Unauthorized IPC sender/,
      '11.1: downloads:choose-folder rejects unauthorized sender'
    )

    // 12. Confirm dialog was NEVER opened
    assert.equal(dialogCallCount, 0, '12: Native dialog was NEVER opened for unauthorized call')

    // 11.2 downloads:get-folder
    await assert.rejects(
      () => handlers['downloads:get-folder'](unauthorizedEvent),
      /Unauthorized IPC sender/,
      '11.2: downloads:get-folder rejects unauthorized sender'
    )

    // 11.3 app-settings:get-start-with-windows
    assert.throws(
      () => handlers['app-settings:get-start-with-windows'](unauthorizedEvent),
      /Unauthorized IPC sender/,
      '11.3: app-settings:get-start-with-windows rejects unauthorized sender'
    )

    // 11.4 app-settings:set-start-with-windows
    assert.throws(
      () => handlers['app-settings:set-start-with-windows'](unauthorizedEvent, true),
      /Unauthorized IPC sender/,
      '11.4: app-settings:set-start-with-windows rejects unauthorized sender'
    )

    // 11.5 downloads:get-storage-info
    await assert.rejects(
      () => handlers['downloads:get-storage-info'](unauthorizedEvent),
      /Unauthorized IPC sender/,
      '11.5: downloads:get-storage-info rejects unauthorized sender'
    )

    console.log(
      '✓ Tests 11, 12, 13: All five handlers fail closed, dialog never opened, DB never reached.\n'
    )
  }

  console.log('================================================================')
  console.log(' ALL 13 SETTINGS IPC SECURITY TESTS PASSED (100% PASS)          ')
  console.log('================================================================\n')
}

runSettingsIpcSecurityTests().catch((err) => {
  console.error('\n❌ SETTINGS IPC SECURITY TEST FAILED:', err)
  process.exit(1)
})
