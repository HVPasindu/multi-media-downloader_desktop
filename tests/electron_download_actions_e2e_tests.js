// Ensure DOM Element classes exist in Node test environment for SweetAlert2 parameter checks
class MockElement {}
globalThis.Element = globalThis.Element || MockElement
globalThis.HTMLElement = globalThis.HTMLElement || MockElement

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToString } from 'react-dom/server'
import Swal from 'sweetalert2'

// Track all SweetAlert notifications in memory for assertions
const notificationsCaptured = []
let confirmResponseOverride = true

const origMixin = Swal.mixin
Swal.mixin = function (mixinDefaults) {
  const SubClass = origMixin.call(this, mixinDefaults)
  SubClass.fire = function (...args) {
    const opts =
      typeof args[0] === 'object' && args[0] !== null
        ? args[0]
        : { title: args[0], text: args[1], icon: args[2] }
    const merged = { ...mixinDefaults, ...opts }
    notificationsCaptured.push(merged)
    return Promise.resolve({
      isConfirmed: confirmResponseOverride,
      value: confirmResponseOverride
    })
  }
  return SubClass
}

import { createTestDatabase } from './helpers/testDatabase.js'
import { registerDownloadFileHandlers } from '../src/main/ipc/downloadFileHandlers.js'
import {
  getDownloadHistoryDetails,
  deleteDownloadHistoryRecord
} from '../src/main/backend/services/downloadHistoryService.js'

async function runElectronDownloadActionsE2ETests() {
  console.log(
    '=================================================================================================='
  )
  console.log(
    ' APPLAN2: Order 13: React Download Actions Hook Integration Test (Simulated Desktop UI Workflow) '
  )
  console.log(' Task 09: React Hook Mutex, Polling, IPC Handlers & File Safety ')
  console.log(
    '==================================================================================================\n'
  )

  const originalWindow = globalThis.window
  const originalCustomEvent = globalThis.CustomEvent

  const testDb = await createTestDatabase('e2e-electron-actions-')

  try {
    const { DownloadJob, MediaItem, DownloadFile, AppSetting } = testDb.sequelize.models

    await AppSetting.create({
      key: 'download_path',
      value: testDb.tempDir
    })

    const sampleMedia = await MediaItem.create({
      source_url: 'https://example.com/test-media.mp4',
      title: 'E2E Completed Media Test'
    })

    // -------------------------------------------------------------------------
    // 1. REAL UI ACTION HOOK MUTEX & CROSS-ACTION LOCKING
    // -------------------------------------------------------------------------
    console.log('--- 1. Testing useDownloadJobActions Hook Cross-Action Lock & Dedup ---')

    class MockCustomEvent {
      constructor(type, eventInitDict) {
        this.type = type
        this.detail = eventInitDict?.detail
      }
    }

    globalThis.CustomEvent = globalThis.CustomEvent || MockCustomEvent

    let capturedRequests = []
    let mockResponsesByPath = new Map()
    let toastNotifications = []
    let errorNotifications = []
    let refreshTriggeredCount = 0

    globalThis.window = {
      api: {
        request: async (opts) => {
          capturedRequests.push(opts)
          const handler = mockResponsesByPath.get(opts.path)
          if (typeof handler === 'function') {
            return await handler(opts)
          }
          if (handler) {
            return handler
          }
          return { ok: true, status: 200, data: { success: true, data: { id: 1, status: 'ok' } } }
        }
      },
      dispatchEvent: (event) => {
        if (event.type === 'applan2:toast') {
          toastNotifications.push(event.detail)
        } else if (event.type === 'applan2:error-dialog') {
          errorNotifications.push(event.detail)
        }
        return true
      },
      addEventListener: () => {},
      removeEventListener: () => {}
    }

    // Dynamically load hook after window and Swal mixin are configured
    const { useDownloadJobActions } =
      await import('../src/renderer/src/hooks/useDownloadJobActions.js')

    // Mount hook inside React server-rendering harness to get live hook instance
    let hookInstance = null
    function TestHookHarness({ onRefresh, fetchGlobalCounts }) {
      hookInstance = useDownloadJobActions({ onRefresh, fetchGlobalCounts })
      return React.createElement('div', null, 'Hook Harness')
    }

    renderToString(
      React.createElement(TestHookHarness, {
        onRefresh: () => {
          refreshTriggeredCount++
        },
        fetchGlobalCounts: () => {}
      })
    )

    assert.ok(hookInstance, '1.1: Hook mounted and returned actions object')
    assert.equal(typeof hookInstance.handlePauseJob, 'function', '1.2: handlePauseJob exists')
    assert.equal(typeof hookInstance.handleResumeJob, 'function', '1.3: handleResumeJob exists')
    assert.equal(typeof hookInstance.handleCancelJob, 'function', '1.4: handleCancelJob exists')
    assert.equal(typeof hookInstance.handleRetryJob, 'function', '1.5: handleRetryJob exists')

    // 1.1 Cross-Action Lock: Concurrent Actions on Same Job ID
    console.log('[Hook Test] Testing cross-action mutex blocks concurrent clicks on same job...')
    capturedRequests = []
    let pauseResolve
    const pauseRequestPromise = new Promise((resolve) => {
      pauseResolve = resolve
    })

    mockResponsesByPath.set('/api/downloads/101/pause', async () => {
      await pauseRequestPromise
      return { ok: true, status: 200, data: { success: true, data: { id: 101, status: 'paused' } } }
    })

    // Start handlePauseJob on Job 101 (in flight)
    const inFlightPausePromise = hookInstance.handlePauseJob(101)

    // Attempt concurrent handleResumeJob on Job 101 while pause is in flight -> MUST BE REJECTED
    await hookInstance.handleResumeJob(101)
    assert.equal(
      capturedRequests.filter((r) => r.path === '/api/downloads/101/resume').length,
      0,
      '1.6: handleResumeJob was rejected by mutex while handlePauseJob was in flight'
    )

    // Attempt concurrent handleCancelJob on Job 101 while pause is in flight -> MUST BE REJECTED
    await hookInstance.handleCancelJob(101)
    assert.equal(
      capturedRequests.filter((r) => r.path === '/api/downloads/101/cancel').length,
      0,
      '1.7: handleCancelJob was rejected by mutex while handlePauseJob was in flight'
    )

    // Attempt concurrent double-click handlePauseJob on Job 101 -> MUST BE REJECTED
    await hookInstance.handlePauseJob(101)
    assert.equal(
      capturedRequests.filter((r) => r.path === '/api/downloads/101/pause').length,
      1,
      '1.8: Second duplicate handlePauseJob click was rejected by mutex'
    )

    // Settle pause request
    pauseResolve()
    await inFlightPausePromise

    // After settlement, mutex must release and allow subsequent action
    mockResponsesByPath.set('/api/downloads/101/resume', {
      ok: true,
      status: 200,
      data: { success: true, data: { id: 101, status: 'downloading' } }
    })
    await hookInstance.handleResumeJob(101)
    assert.equal(
      capturedRequests.filter((r) => r.path === '/api/downloads/101/resume').length,
      1,
      '1.9: Mutex unlocked after in-flight action settled'
    )

    console.log('✓ Section 1 Passed: Cross-action mutex and double-click protection verified.\n')

    // -------------------------------------------------------------------------
    // 2. SERVER STATUS POLLING & ASYNC CONFIRMATION
    // -------------------------------------------------------------------------
    console.log('--- 2. Testing waitForJobStatus Polling & Failure Notification ---')

    // 2.1 202 Accepted -> Polling succeeds
    capturedRequests = []
    toastNotifications = []
    errorNotifications = []
    refreshTriggeredCount = 0

    let pollAttempts = 0
    mockResponsesByPath.set('/api/downloads/201/pause', {
      ok: true,
      status: 202,
      data: { success: true, data: { id: 201, status: 'pause_pending' } }
    })
    mockResponsesByPath.set('/api/downloads/201', () => {
      pollAttempts++
      if (pollAttempts >= 2) {
        return {
          ok: true,
          status: 200,
          data: { success: true, data: { id: 201, status: 'paused' } }
        }
      }
      return {
        ok: true,
        status: 200,
        data: { success: true, data: { id: 201, status: 'downloading' } }
      }
    })

    await hookInstance.handlePauseJob(201)
    assert.ok(pollAttempts >= 2, '2.1: Poller polled status until matched')
    assert.ok(
      notificationsCaptured.some((t) => t.toast && t.title === 'Download paused'),
      '2.2: Success toast displayed after poll confirmed paused state'
    )
    assert.ok(refreshTriggeredCount >= 1, '2.3: Data refresh triggered after status confirmation')

    // 2.2 202 Accepted -> Polling failure / timeout notification
    capturedRequests = []
    refreshTriggeredCount = 0

    mockResponsesByPath.set('/api/downloads/202/pause', {
      ok: true,
      status: 202,
      data: { success: true, data: { id: 202, status: 'pause_pending' } }
    })
    // Server returns an unconfirmed status continuously
    mockResponsesByPath.set('/api/downloads/202', {
      ok: true,
      status: 200,
      data: { success: true, data: { id: 202, status: 'downloading' } }
    })

    // Test the unconfirmed/timeout polling path using virtual time acceleration
    const origNow = Date.now
    let timeOffset = 0
    Date.now = () => origNow() + timeOffset

    mockResponsesByPath.set('/api/downloads/202', () => {
      timeOffset += 6000 // fast-forward past 5000ms timeout
      return {
        ok: true,
        status: 200,
        data: { success: true, data: { id: 202, job: { status: 'downloading' } } }
      }
    })

    try {
      await hookInstance.handlePauseJob(202)
      assert.ok(
        notificationsCaptured.some((e) => e.icon === 'error' && e.title === 'Action Not Confirmed'),
        '2.4: Action Not Confirmed error displayed when status is not confirmed by server'
      )
      assert.ok(refreshTriggeredCount >= 1, '2.5: UI refresh triggered to synchronize state')
    } finally {
      Date.now = origNow
    }

    // 2.3 Cancel job with confirmation prompt
    capturedRequests = []
    confirmResponseOverride = false // User clicks Cancel on confirm modal
    await hookInstance.handleCancelJob(301)
    assert.equal(
      capturedRequests.filter((r) => r.path === '/api/downloads/301/cancel').length,
      0,
      '2.6: Cancellation request aborted when user declines confirmation dialog'
    )

    confirmResponseOverride = true // User clicks Confirm
    mockResponsesByPath.set('/api/downloads/301/cancel', {
      ok: true,
      status: 200,
      data: { success: true, data: { id: 301, status: 'cancelled' } }
    })
    await hookInstance.handleCancelJob(301)
    assert.equal(
      capturedRequests.filter((r) => r.path === '/api/downloads/301/cancel').length,
      1,
      '2.7: Cancellation request sent when user confirms'
    )
    assert.ok(
      notificationsCaptured.some((t) => t.toast && t.title === 'Download cancelled'),
      '2.8: Download cancelled toast displayed'
    )

    // 2.4 Retry job
    capturedRequests = []
    mockResponsesByPath.set('/api/downloads/401/retry', {
      ok: true,
      status: 201,
      data: { success: true, data: { id: 401, status: 'queued' } }
    })
    await hookInstance.handleRetryJob(401)
    assert.equal(
      capturedRequests.filter((r) => r.path === '/api/downloads/401/retry').length,
      1,
      '2.9: Retry request dispatched to server'
    )
    assert.ok(
      notificationsCaptured.some((t) => t.toast && t.title === 'Download queued for retry'),
      '2.10: Download queued for retry toast displayed'
    )

    console.log('✓ Section 2 Passed: Server status polling & failure alerts verified.\n')

    // -------------------------------------------------------------------------
    // 3. COMPLETED FILE ACTIONS & HISTORY IPC (Open File, Open Folder, Delete)
    // -------------------------------------------------------------------------
    console.log('--- 3. Testing Completed File Actions: Open File, Open Folder & Delete ---')

    // Prepare a genuine MP4 file on disk for the completed job
    const completedJobFilePath = path.join(testDb.tempDir, 'sample_completed_video.mp4')
    fs.writeFileSync(completedJobFilePath, Buffer.from('FAKE-MP4-CONTENT-FOR-IPC-TESTS'))

    const completedJob = await DownloadJob.create({
      media_id: sampleMedia.id,
      source_type: 'link',
      output_format: 'mp4',
      quality: '720p',
      status: 'completed',
      progress: 100,
      downloaded_bytes: 32
    })

    await DownloadFile.create({
      download_job_id: completedJob.id,
      file_path: completedJobFilePath,
      file_name: path.basename(completedJobFilePath),
      file_size_bytes: 32,
      file_format: 'mp4'
    })

    // Create an IPC harness with mocks for shell
    const registeredIpcHandlers = new Map()
    const ipcMainMock = {
      handle: (channel, handler) => {
        registeredIpcHandlers.set(channel, handler)
      }
    }

    let openedFilePath = null
    let shownInFolderPath = null

    const shellMock = {
      openPath: async (targetPath) => {
        openedFilePath = targetPath
        return null // null indicates success in Electron shell.openPath
      },
      showItemInFolder: (targetPath) => {
        shownInFolderPath = targetPath
      }
    }

    const mockTrustedWindow = {
      isDestroyed: () => false,
      webContents: {
        mainFrame: {}
      }
    }

    const mockIpcSenderEvent = {
      sender: mockTrustedWindow.webContents,
      senderFrame: mockTrustedWindow.webContents.mainFrame
    }

    const mockBrowserWindow = {
      fromWebContents: (sender) =>
        sender === mockTrustedWindow.webContents ? mockTrustedWindow : null
    }

    registerDownloadFileHandlers({
      ipcMain: ipcMainMock,
      BrowserWindow: mockBrowserWindow,
      shell: shellMock,
      getDownloadHistoryDetails,
      getTrustedWindow: () => mockTrustedWindow,
      isDev: true,
      rendererUrl: 'http://localhost:5173'
    })

    assert.ok(
      registeredIpcHandlers.has('shell:open-file'),
      '3.1: shell:open-file handler registered'
    )
    assert.ok(
      registeredIpcHandlers.has('shell:open-folder'),
      '3.2: shell:open-folder handler registered'
    )

    // Mock sender URL for trusted origin validation
    mockIpcSenderEvent.senderFrame.url = 'http://localhost:5173/index.html'

    // 3.1 Test shell:open-file
    const openFileHandler = registeredIpcHandlers.get('shell:open-file')
    const openFileResult = await openFileHandler(mockIpcSenderEvent, completedJob.id)
    assert.equal(openFileResult.success, true, '3.3: shell:open-file returns success: true')
    assert.equal(
      openedFilePath,
      completedJobFilePath,
      '3.4: shell.openPath was called with verified file path'
    )

    // 3.2 Test shell:open-folder
    const openFolderHandler = registeredIpcHandlers.get('shell:open-folder')
    const openFolderResult = await openFolderHandler(mockIpcSenderEvent, completedJob.id)
    assert.equal(openFolderResult.success, true, '3.5: shell:open-folder returns success: true')
    assert.equal(
      shownInFolderPath,
      completedJobFilePath,
      '3.6: shell.showItemInFolder was called with verified file path'
    )

    // 3.3 Test shell:open-file with invalid job
    const invalidJobResult = await openFileHandler(mockIpcSenderEvent, 99999)
    assert.equal(
      invalidJobResult.success,
      false,
      '3.7: Open file for non-existent job returns success: false'
    )

    // 3.4 Test Delete Record (CRITICAL: DB record deleted, physical file remains intact!)
    console.log(
      '[History Test] Deleting history record and asserting disk file remains untouched...'
    )
    assert.ok(fs.existsSync(completedJobFilePath), '3.8: Physical file exists before deletion')

    const deleteResult = await deleteDownloadHistoryRecord(completedJob.id)
    assert.equal(
      deleteResult.outcome,
      'success',
      '3.9: deleteDownloadHistoryRecord returned outcome: success'
    )

    // Verify DB records are gone
    const deletedJobInDb = await DownloadJob.findByPk(completedJob.id)
    assert.equal(deletedJobInDb, null, '3.10: DownloadJob record destroyed in SQLite')

    const deletedFileInDb = await DownloadFile.findOne({
      where: { download_job_id: completedJob.id }
    })
    assert.equal(deletedFileInDb, null, '3.11: DownloadFile record destroyed in SQLite')

    // CRITICAL ASSERTION: The actual downloaded file MUST remain on disk!
    assert.ok(
      fs.existsSync(completedJobFilePath),
      '3.12: Physical media file on disk is STRICTLY PRESERVED after deleting history record'
    )

    console.log(
      '✓ Section 3 Passed: Completed file actions and physical file preservation confirmed.\n'
    )

    // -------------------------------------------------------------------------
    // 4. MAIN PROCESS REGISTRATION CONTRACT CHECK
    // -------------------------------------------------------------------------
    console.log('--- 4. Checking src/main/index.js IPC Handler Registrations ---')
    const mainIndexPath = path.resolve('src/main/index.js')
    const mainIndexContent = fs.readFileSync(mainIndexPath, 'utf8')

    assert.ok(
      mainIndexContent.includes('registerDownloadFileHandlers'),
      '4.1: src/main/index.js registers download file handlers'
    )
    assert.ok(
      mainIndexContent.includes('getStartupWindow'),
      '4.2: src/main/index.js supplies getStartupWindow to handlers'
    )

    console.log('✓ Section 4 Passed: Main process contracts verified.\n')

    console.log('================================================================')
    console.log(' ALL ELECTRON UI & E2E INTEGRATION TESTS PASSED (100% PASS)')
    console.log(' React Hook Mutex, Polling, IPC Handlers & File Safety Verified  ')
    console.log('================================================================\n')
  } finally {
    globalThis.window = originalWindow
    globalThis.CustomEvent = originalCustomEvent
    await testDb.cleanup()
  }
}

runElectronDownloadActionsE2ETests().catch((err) => {
  console.error('\n❌ ELECTRON DOWNLOAD ACTIONS E2E TESTS FAILED:', err)
  process.exit(1)
})
