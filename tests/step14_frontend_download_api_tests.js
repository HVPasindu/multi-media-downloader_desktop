import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  validateHistoryFilters,
  listDownloadHistory,
  getDownloadHistoryDetails,
  checkFileAvailability
} from '../src/main/backend/services/downloadHistoryService.js'
import { createDownloadJob } from '../src/main/backend/services/downloadService.js'
import { cancelDownloadJob } from '../src/main/backend/services/downloadQueueService.js'
import { retryDownloadJob } from '../src/main/backend/services/downloadRetryService.js'
import { normalizeDownloadJob } from '../src/renderer/src/utils/downloadPresentation.js'
import {
  getFriendlyErrorInfo,
  getSafeFriendlyErrorInfo,
  containsUnsafeErrorDetails,
  extractErrorCode,
  extractCleanMessage
} from '../src/renderer/src/utils/errorPresentation.js'
import {
  getRetryButtonState,
  createRetryGuard
} from '../src/renderer/src/utils/retryButtonState.js'
import { registerDownloadFileHandlers } from '../src/main/ipc/downloadFileHandlers.js'
import {
  seedKnownFailures,
  notifyLiveJobFailure
} from '../src/renderer/src/utils/notificationService.js'
import { createTestDatabase } from './helpers/testDatabase.js'

async function runStep14Tests() {
  console.log('================================================================')
  console.log(' APPLAN2 — Step 14: Desktop Frontend & E2E Integration Suite')
  console.log('================================================================\n')

  // ----------------------------------------------------------------
  // 1. Production Frontend API Contract & Parameter Serialization (FIX 05)
  // ----------------------------------------------------------------
  console.log('--- 1. Testing Production Frontend API Contracts (listDownloads, cancel, retry) ---')

  class MockCustomEvent {
    constructor(type, eventInitDict) {
      this.type = type
      this.detail = eventInitDict?.detail
    }
  }

  const originalWindow = globalThis.window
  const originalCustomEvent = globalThis.CustomEvent

  let capturedApiRequest = null
  let mockApiResponse = { ok: true, status: 200, data: { success: true, data: [] } }
  let dispatchedEvents = []

  globalThis.CustomEvent = globalThis.CustomEvent || MockCustomEvent
  globalThis.window = {
    api: {
      request: async (options) => {
        capturedApiRequest = options
        return mockApiResponse
      }
    },
    dispatchEvent: (event) => {
      dispatchedEvents.push(event)
      return true
    }
  }

  let listDownloads, cancelDownload, retryDownload
  try {
    const downloadsApi = await import('../src/renderer/src/services/downloadsApi.js')
    listDownloads = downloadsApi.listDownloads
    cancelDownload = downloadsApi.cancelDownload
    retryDownload = downloadsApi.retryDownload

    // 1.1 Test listDownloads URL query serialization
    capturedApiRequest = null
    mockApiResponse = { ok: true, status: 200, data: { success: true, data: [] } }

    await listDownloads({
      status: 'downloading',
      statuses: ['failed', 'cancelled'],
      search: '  rock concert  ',
      outputFormat: 'mp4',
      sourceType: 'link',
      from: '2026-11-01',
      to: '2026-11-06',
      limit: 20,
      offset: 40
    })

    assert.ok(capturedApiRequest, 'listDownloads must dispatch a request to window.api.request')
    assert.equal(capturedApiRequest.method, 'GET')
    assert.ok(capturedApiRequest.path.startsWith('/api/downloads?'))
    const parsedUrl = new URL(`http://localhost${capturedApiRequest.path}`)
    assert.equal(parsedUrl.searchParams.get('status'), 'downloading')
    assert.equal(parsedUrl.searchParams.get('statuses'), 'failed,cancelled')
    assert.equal(parsedUrl.searchParams.get('search'), 'rock concert', 'Search should be trimmed')
    assert.equal(parsedUrl.searchParams.get('outputFormat'), 'mp4')
    assert.equal(parsedUrl.searchParams.get('sourceType'), 'link')
    assert.equal(parsedUrl.searchParams.get('from'), '2026-11-01')
    assert.equal(parsedUrl.searchParams.get('to'), '2026-11-06')
    assert.equal(parsedUrl.searchParams.get('limit'), '20')
    assert.equal(parsedUrl.searchParams.get('offset'), '40')

    // 1.2 Test cancelDownload frontend API call & state-change dispatch
    // HTTP 200 OK
    dispatchedEvents = []
    capturedApiRequest = null
    mockApiResponse = {
      ok: true,
      status: 200,
      data: { success: true, data: { id: 17, status: 'cancelled' } }
    }
    const c200 = await cancelDownload(17)
    assert.equal(capturedApiRequest.method, 'POST')
    assert.equal(capturedApiRequest.path, '/api/downloads/17/cancel')
    assert.equal(c200.status, 200)
    assert.equal(dispatchedEvents.length, 1, '200 response must emit state-changed event')
    assert.equal(dispatchedEvents[0].type, 'applan2:download-state-changed')

    // HTTP 202 Accepted
    dispatchedEvents = []
    mockApiResponse = {
      ok: true,
      status: 202,
      data: { success: true, data: { id: 17, status: 'cancellation_requested' } }
    }
    const c202 = await cancelDownload(17)
    assert.equal(c202.status, 202)
    assert.equal(dispatchedEvents.length, 1, '202 response must emit state-changed event')

    // HTTP 409 Conflict (should NOT emit state-change event)
    dispatchedEvents = []
    mockApiResponse = {
      ok: false,
      status: 409,
      data: { success: false, message: 'Cannot cancel completed download' }
    }
    const c409 = await cancelDownload(17)
    assert.equal(c409.status, 409)
    assert.equal(dispatchedEvents.length, 0, '409 conflict must not emit state-changed event')

    // HTTP 404 Not Found
    dispatchedEvents = []
    mockApiResponse = {
      ok: false,
      status: 404,
      data: { success: false, message: 'Download Job not found' }
    }
    const c404 = await cancelDownload(999)
    assert.equal(c404.status, 404)
    assert.equal(dispatchedEvents.length, 0, '404 not found must not emit state-changed event')

    // 1.3 Test retryDownload frontend API call & state-change dispatch
    // HTTP 201 Created
    dispatchedEvents = []
    capturedApiRequest = null
    mockApiResponse = {
      ok: true,
      status: 201,
      data: { success: true, data: { id: 17, status: 'queued' } }
    }
    const r201 = await retryDownload(17)
    assert.equal(capturedApiRequest.method, 'POST')
    assert.equal(capturedApiRequest.path, '/api/downloads/17/retry')
    assert.equal(r201.status, 201)
    assert.equal(dispatchedEvents.length, 1, '201 response must emit state-changed event')

    // HTTP 409 Conflict (e.g. already queued)
    dispatchedEvents = []
    mockApiResponse = {
      ok: false,
      status: 409,
      data: { success: false, message: 'Job is already active' }
    }
    const r409 = await retryDownload(17)
    assert.equal(r409.status, 409)
    assert.equal(dispatchedEvents.length, 0, '409 conflict must not emit state-changed event')

    console.log('✓ Group 1 passed: Production frontend API contracts & event dispatch verified.\n')
  } finally {
    globalThis.window = originalWindow
    globalThis.CustomEvent = originalCustomEvent
  }

  // ----------------------------------------------------------------
  // 2. Client History Filter Validation
  // ----------------------------------------------------------------
  console.log('--- 2. Testing History Date Range Validation & Filters ---')

  const v1 = validateHistoryFilters({
    from: '2026-11-01',
    to: '2026-11-06',
    search: 'tutorial',
    limit: '20',
    offset: '0'
  })
  assert.ok(v1.isValid, 'Valid date range, search, limit, and offset should pass validation')
  assert.ok(v1.normalized.fromDate instanceof Date, 'Normalized fromDate should be a Date instance')
  assert.ok(v1.normalized.toDate instanceof Date, 'Normalized toDate should be a Date instance')
  assert.equal(v1.normalized.search, 'tutorial', 'Normalized search query should match')
  assert.equal(v1.normalized.limit, 20, 'Normalized limit should be 20')
  assert.equal(v1.normalized.offset, 0, 'Normalized offset should be 0')

  const v2 = validateHistoryFilters({
    from: '2026-11-10',
    to: '2026-11-01'
  })
  assert.equal(v2.isValid, false, 'Range with fromDate > toDate must fail validation')
  assert.ok(v2.errors.dateRange, 'dateRange error message must be present')

  const v3 = validateHistoryFilters({
    from: 'not-a-valid-date'
  })
  assert.equal(v3.isValid, false, 'Invalid date string must fail validation')
  assert.ok(v3.errors.from, 'from error message must be present')

  console.log('✓ Group 2 passed: Date range and query filter validation confirmed.\n')

  // ----------------------------------------------------------------
  // 3. Database Integration: Date Range Filtering with SQLite
  // ----------------------------------------------------------------
  console.log('--- 3. Testing SQLite Date Range Filtering in Download History ---')
  const testDb = await createTestDatabase('applan2-step14-test-')
  console.log(`[setup] Isolated test database: ${testDb.databasePath}`)

  try {
    const { MediaItem, DownloadJob, DownloadFile } = testDb.sequelize.models

    const testMedia = await MediaItem.create({
      source_url: 'https://youtube.com/watch?v=step14test',
      platform: 'youtube',
      title: 'Step 14 Frontend Verification Video'
    })

    const dates = [
      new Date('2026-10-15T12:00:00.000Z'),
      new Date('2026-11-02T10:00:00.000Z'),
      new Date('2026-11-05T15:30:00.000Z'),
      new Date('2026-11-20T08:00:00.000Z')
    ]

    const createdJobs = []
    for (let i = 0; i < dates.length; i++) {
      const job = await createDownloadJob({
        mediaItemId: testMedia.id,
        outputFormat: 'mp4',
        quality: '1080p'
      })
      await DownloadJob.update(
        {
          status: 'completed',
          progress: 100,
          createdAt: dates[i]
        },
        { where: { id: job.id } }
      )
      await DownloadFile.create({
        download_job_id: job.id,
        file_name: `video_${i + 1}.mp4`,
        file_path: path.join(testDb.tempDir, `video_${i + 1}.mp4`),
        file_format: 'mp4',
        file_size: 1024 * 1024 * (i + 1)
      })
      createdJobs.push(job.id)
    }

    const rangeFilters = validateHistoryFilters({
      from: '2026-11-01',
      to: '2026-11-06',
      limit: 50,
      offset: 0
    })
    assert.ok(rangeFilters.isValid, 'Range filter normalization should be valid')

    const historyResult = await listDownloadHistory(rangeFilters.normalized)

    assert.equal(
      historyResult.jobs.length,
      2,
      'Date range filter must return exactly 2 jobs within November 1-6'
    )
    assert.equal(
      historyResult.pagination.total,
      2,
      'Pagination total must reflect filtered count of 2'
    )
    const returnedIds = historyResult.jobs.map((j) => j.id)
    assert.ok(returnedIds.includes(createdJobs[1]), 'Job 2 must be returned')
    assert.ok(returnedIds.includes(createdJobs[2]), 'Job 3 must be returned')
    assert.ok(!returnedIds.includes(createdJobs[0]), 'Job 1 (October) must be excluded')
    assert.ok(!returnedIds.includes(createdJobs[3]), 'Job 4 (Late November) must be excluded')

    console.log(
      '✓ Group 3 passed: SQLite date range filtering accurately isolates target records.\n'
    )

    // ----------------------------------------------------------------
    // 4. Cancellation Flow & Resuming Download Support (FIX 01)
    // ----------------------------------------------------------------
    console.log('--- 4. Testing Cancellation Flow & Resuming Download Support (FIX 01) ---')

    // 4.1 Backend cancellation tests
    const queuedJob = await createDownloadJob({
      mediaItemId: testMedia.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    const cancelRes1 = await cancelDownloadJob(queuedJob.id)
    assert.equal(
      cancelRes1.outcome,
      'cancelled',
      'Queued job cancellation outcome must be cancelled'
    )
    const reloadedQueued = await DownloadJob.findByPk(queuedJob.id)
    assert.equal(reloadedQueued.status, 'cancelled', 'Queued job in DB must have status cancelled')

    const cancelRes2 = await cancelDownloadJob(queuedJob.id)
    assert.equal(
      cancelRes2.outcome,
      'already_cancelled',
      'Cancelling an already cancelled job must return already_cancelled'
    )

    const completedJob = await createDownloadJob({
      mediaItemId: testMedia.id,
      outputFormat: 'mp3',
      audioBitrateKbps: 320
    })
    await DownloadJob.update(
      { status: 'completed', progress: 100 },
      { where: { id: completedJob.id } }
    )
    const cancelRes3 = await cancelDownloadJob(completedJob.id)
    assert.equal(cancelRes3.outcome, 'conflict', 'Cancelling a completed job must return conflict')

    const cancelRes4 = await cancelDownloadJob(999999)
    assert.equal(
      cancelRes4.outcome,
      'not_found',
      'Cancelling non-existent job must return not_found'
    )

    // 4.2 Frontend canCancel logic verification across all 7 job states (FIX 01)
    function computeCanCancel(item) {
      const isDownloading = item.status === 'downloading'
      const isInterrupted = item.status === 'interrupted'
      const isResuming = item.displayStatus === 'resuming'
      const isQueued = item.status === 'queued' && !isResuming
      return isDownloading || isQueued || isInterrupted || isResuming
    }

    const testStates = [
      { raw: { id: 1, status: 'downloading', progress: 30 }, expected: true, label: 'Downloading' },
      { raw: { id: 2, status: 'queued', progress: 0 }, expected: true, label: 'Queued (0%)' },
      { raw: { id: 3, status: 'interrupted', progress: 40 }, expected: true, label: 'Interrupted' },
      {
        raw: { id: 4, status: 'queued', progress: 65 },
        expected: true,
        label: 'Resuming (queued + 65%)'
      },
      { raw: { id: 5, status: 'completed', progress: 100 }, expected: false, label: 'Completed' },
      { raw: { id: 6, status: 'failed', progress: 20 }, expected: false, label: 'Failed' },
      { raw: { id: 7, status: 'cancelled', progress: 10 }, expected: false, label: 'Cancelled' }
    ]

    for (const testCase of testStates) {
      const normalized = normalizeDownloadJob(testCase.raw)
      const canCancel = computeCanCancel(normalized)
      assert.equal(
        canCancel,
        testCase.expected,
        `Cancel button availability for ${testCase.label} must be ${testCase.expected}`
      )
    }

    console.log(
      '✓ Group 4 passed: Cancellation flow and all 7 states (including resuming) verified.\n'
    )

    // ----------------------------------------------------------------
    // 5. Retry Flow & Loading-State Consistency (FIX 04)
    // ----------------------------------------------------------------
    console.log('--- 5. Testing Retry Flow & Double-Click Protection Simulation (FIX 04) ---')

    const failedJob = await createDownloadJob({
      mediaItemId: testMedia.id,
      outputFormat: 'mp4',
      quality: '1080p'
    })
    await DownloadJob.update(
      { status: 'failed', error_message: '[NETWORK_ERROR] Network dropped' },
      { where: { id: failedJob.id } }
    )

    const retryRes1 = await retryDownloadJob(failedJob.id, { enqueue: () => {} })
    assert.equal(retryRes1.outcome, 'created', 'Retry outcome must be created')
    assert.equal(retryRes1.retryJobId, failedJob.id, 'Retry must preserve the exact same job ID')
    assert.equal(retryRes1.status, 'queued', 'Retried job must transition back to queued')

    const retryRes2 = await retryDownloadJob(failedJob.id, { enqueue: () => {} })
    assert.equal(
      retryRes2.outcome,
      'retry_in_progress',
      'Retrying an already queued retry job must return retry_in_progress (double-click protection)'
    )

    const retryRes3 = await retryDownloadJob(888888)
    assert.equal(retryRes3.outcome, 'not_found', 'Retrying non-existent job must return not_found')

    // 5.1 Test actual production helper getRetryButtonState (Task 03)
    assert.deepEqual(
      getRetryButtonState(null, 17),
      { disabled: false, isSpinning: false },
      'Initial state: not retrying, button enabled, no spin'
    )

    assert.deepEqual(
      getRetryButtonState(17, 17),
      { disabled: true, isSpinning: true },
      'Active retrying item: button disabled, spinning'
    )

    assert.deepEqual(
      getRetryButtonState(17, 20),
      { disabled: true, isSpinning: false },
      'Other item while retry in progress: button disabled, not spinning'
    )

    assert.deepEqual(
      getRetryButtonState(null, 20),
      { disabled: false, isSpinning: false },
      'Retry finished: all buttons re-enabled'
    )

    // 5.2 Test production createRetryGuard logic
    const retryGuard = createRetryGuard()
    assert.equal(retryGuard.tryStart(), true, 'First retry attempt acquires lock')
    assert.equal(retryGuard.tryStart(), false, 'Concurrent attempt while locked is rejected')
    assert.equal(retryGuard.tryStart(), false, 'Third attempt while locked is rejected')
    retryGuard.finish()
    assert.equal(retryGuard.tryStart(), true, 'Lock re-acquired after finish')
    retryGuard.finish()

    // 5.3 Test error release in try/catch/finally
    const failureGuard = createRetryGuard()
    assert.equal(failureGuard.tryStart(), true)
    try {
      throw new Error('Simulated network drop during retry')
    } catch {
      // Caught
    } finally {
      failureGuard.finish()
    }
    assert.equal(
      failureGuard.tryStart(),
      true,
      'Guard must be released on failure in finally block'
    )
    failureGuard.finish()

    // 5.4 Test independent guard instances for DownloadsPage and HistoryPage
    const downloadsGuard = createRetryGuard()
    const historyGuard = createRetryGuard()
    assert.equal(downloadsGuard.tryStart(), true)
    assert.equal(historyGuard.tryStart(), true, 'History page has its own independent guard')
    downloadsGuard.finish()
    historyGuard.finish()

    // 5.5 Verify both pages import and wire the shared production retry utilities
    const downloadsPageSource = await fs.readFile(
      path.resolve(process.cwd(), 'src/renderer/src/pages/DownloadsPage.jsx'),
      'utf-8'
    )
    const historyPageSource = await fs.readFile(
      path.resolve(process.cwd(), 'src/renderer/src/pages/HistoryPage.jsx'),
      'utf-8'
    )

    assert.ok(
      downloadsPageSource.includes(
        "import { getRetryButtonState, createRetryGuard } from '../utils/retryButtonState'"
      ),
      'DownloadsPage must import getRetryButtonState and createRetryGuard'
    )
    assert.ok(
      historyPageSource.includes(
        "import { getRetryButtonState, createRetryGuard } from '../utils/retryButtonState'"
      ),
      'HistoryPage must import getRetryButtonState and createRetryGuard'
    )
    assert.ok(
      downloadsPageSource.includes('retryGuardRef.current.tryStart()'),
      'DownloadsPage must guard retry handler with retryGuard'
    )
    assert.ok(
      historyPageSource.includes('retryGuardRef.current.tryStart()'),
      'HistoryPage must guard retry handler with retryGuard'
    )
    assert.ok(
      downloadsPageSource.includes('getRetryButtonState(retryingJobId, item.id)'),
      'DownloadsPage must calculate button state with getRetryButtonState'
    )
    assert.ok(
      historyPageSource.includes('getRetryButtonState(retryingJobId, item.id)'),
      'HistoryPage must calculate button state with getRetryButtonState'
    )

    console.log(
      '✓ Group 5 passed: Production retry state, concurrency guards, and page wiring confirmed.\n'
    )

    // ----------------------------------------------------------------
    // 6. Complete Safe Error Sanitization (Task 01)
    // ----------------------------------------------------------------
    console.log('--- 6. Testing Error Presentation & Complete Safe Sanitization (Task 01) ---')

    // 6.0 Backward compatibility preserved
    assert.equal(getFriendlyErrorInfo('[NETWORK_ERROR] legacy check').code, 'NETWORK_ERROR')

    // 6.1 Friendly error mapping for CANCELLED & NETWORK_ERROR
    const cancelErrInfo = getSafeFriendlyErrorInfo('[CANCELLED] Download was cancelled by user')
    assert.equal(cancelErrInfo.code, 'CANCELLED')
    assert.equal(cancelErrInfo.title, 'Download Cancelled')
    assert.ok(cancelErrInfo.isRetryable)

    const networkErrInfo = getSafeFriendlyErrorInfo('[NETWORK_ERROR] Connection reset by peer')
    assert.equal(networkErrInfo.code, 'NETWORK_ERROR')
    assert.equal(networkErrInfo.title, 'Network Connection Error')
    assert.equal(networkErrInfo.guidance, 'Check internet connection')
    assert.equal(networkErrInfo.message, 'Connection reset by peer')

    // 6.2 Code and clean message extraction
    assert.equal(extractErrorCode('[DATABASE_ERROR] SQLite database is locked'), 'DATABASE_ERROR')
    assert.equal(
      extractCleanMessage('[DATABASE_ERROR] SQLite database is locked'),
      'SQLite database is locked'
    )

    // 6.3 Required OS Path Sanitization Cases (Task 01 Table)
    const requiredPathInputs = [
      '/tmp/applan2/file.bin',
      '/root/private/file.bin',
      '/opt/application/file.db',
      '/srv/application/file.mp4',
      '/private/var/data/file.bin',
      '/run/application/session.json',
      '/proc/process/data',
      '/sys/device/config',
      '/dev/sda',
      '/Volumes/Drive/file.mp4',
      '/Applications/App/file.bin',
      'C:\\Users\\Admin\\secret.bin',
      'C:/Users/Admin/secret.bin',
      '\\\\SERVER\\Share\\secret.bin'
    ]

    for (const pathInput of requiredPathInputs) {
      assert.equal(
        containsUnsafeErrorDetails(pathInput),
        true,
        `Path input must be detected as unsafe: ${pathInput}`
      )
      const sanitized = getSafeFriendlyErrorInfo(pathInput)
      assert.ok(
        !sanitized.message.includes(pathInput),
        `Path must never appear in user message: ${pathInput}`
      )
    }

    // 6.4 Technical / stack / database / token sanitization
    const technicalInputs = [
      'Error: Download failed\n    at Object.<anonymous> (test.js:12:34)',
      'at Object.run (node:internal/modules/cjs/loader:123:45)',
      'SequelizeDatabaseError: table does not exist',
      'SQLITE_BUSY: database is locked',
      'SELECT * FROM users WHERE id = 1',
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'Authorization: Basic dXNlcjpwYXNz',
      'cookie: session_id=12345678',
      'password=supersecret',
      'a'.repeat(241)
    ]

    for (const techInput of technicalInputs) {
      assert.equal(
        containsUnsafeErrorDetails(techInput),
        true,
        `Technical input must be detected as unsafe: ${techInput.slice(0, 30)}`
      )
      const sanitized = getSafeFriendlyErrorInfo(techInput)
      assert.ok(
        !sanitized.message.includes('SQLITE_BUSY') &&
          !sanitized.message.includes('Sequelize') &&
          !sanitized.message.includes('node:internal') &&
          !sanitized.message.includes('Bearer ') &&
          !sanitized.message.includes('password='),
        'Unsafe details must be completely sanitized from user message'
      )
    }

    // 6.5 Safe fallback preservation
    const safeFallbackRes = getSafeFriendlyErrorInfo(
      'TypeError: internal failure',
      'Unable to load download history.'
    )
    assert.equal(
      safeFallbackRes.message,
      'Unable to load download history.',
      'Safe fallback message must be preserved when raw error is technical'
    )

    // 6.6 Unsafe fallback rejection
    const unsafeFallbackRes = getSafeFriendlyErrorInfo(
      'TypeError: internal failure',
      'Failed at C:\\Users\\Admin\\secret.db'
    )
    assert.ok(
      !unsafeFallbackRes.message.includes('secret.db'),
      'Unsafe fallback must be rejected in favor of default message'
    )
    assert.equal(unsafeFallbackRes.message, 'The download failed due to an unexpected error.')

    // 6.7 Safe plain user message preservation
    const plainSafeMsg = getSafeFriendlyErrorInfo(
      'The requested video is no longer available online.'
    )
    assert.equal(
      plainSafeMsg.message,
      'The requested video is no longer available online.',
      'Safe plain user message must be preserved'
    )

    // 6.8 HTTP/HTTPS URL preservation
    const urlSafeMsg = getSafeFriendlyErrorInfo('Unable to access https://example.com/video')
    assert.equal(
      urlSafeMsg.message,
      'Unable to access https://example.com/video',
      'Valid HTTP/HTTPS URL must not be mistaken for local filesystem path'
    )

    // 6.9 Historical failure popup suppression
    seedKnownFailures([101, 102])
    const popupResult1 = notifyLiveJobFailure(101, {
      title: 'Should be suppressed',
      message: 'Suppressed'
    })
    assert.equal(popupResult1, undefined, 'Pre-seeded historical failures must not trigger popups')

    console.log(
      '✓ Group 6 passed: Complete safe error sanitization and fallback protection verified.\n'
    )

    // ----------------------------------------------------------------
    // 7. Actual Main Process IPC Security Handler Testing (Task 02)
    // ----------------------------------------------------------------
    console.log('--- 7. Testing Actual Registered IPC Security Handlers (Task 02) ---')

    // Create a real completed test file
    const validTestFilePath = path.join(testDb.tempDir, 'valid_download_clip.mp4')
    await fs.writeFile(validTestFilePath, Buffer.from('test media content for verification'))

    const validCompletedJob = await createDownloadJob({
      mediaItemId: testMedia.id,
      outputFormat: 'mp4',
      quality: '1080p'
    })
    await DownloadJob.update(
      { status: 'completed', progress: 100 },
      { where: { id: validCompletedJob.id } }
    )
    await DownloadFile.create({
      download_job_id: validCompletedJob.id,
      file_name: 'valid_download_clip.mp4',
      file_path: validTestFilePath,
      file_format: 'mp4',
      file_size: 32
    })

    // Setup IPC test harness with real registered handlers
    const registeredHandlers = new Map()
    const ipcMainMock = {
      handle: (channel, handler) => {
        registeredHandlers.set(channel, handler)
      }
    }

    let openedPaths = []
    let shownFolders = []
    let openPathReturnError = null
    let shellShouldThrow = false

    const shellMock = {
      openPath: async (filePath) => {
        if (shellShouldThrow) throw new Error('OS shell error')
        openedPaths.push(filePath)
        return openPathReturnError
      },
      showItemInFolder: (filePath) => {
        if (shellShouldThrow) throw new Error('OS shell folder error')
        shownFolders.push(filePath)
      }
    }

    const trustedSender = { id: 1 }
    const untrustedSender = { id: 99 }
    const destroyedSender = { id: 2 }

    const mockBrowserWindow = {
      fromWebContents: (sender) => {
        if (sender === trustedSender) {
          return { isDestroyed: () => false }
        }
        if (sender === destroyedSender) {
          return { isDestroyed: () => true }
        }
        return null // untrusted sender has no owner window
      }
    }

    // Register the actual production handlers
    registerDownloadFileHandlers({
      ipcMain: ipcMainMock,
      BrowserWindow: mockBrowserWindow,
      shell: shellMock,
      getDownloadHistoryDetails
    })

    assert.ok(registeredHandlers.has('shell:open-file'), 'shell:open-file must be registered')
    assert.ok(registeredHandlers.has('shell:open-folder'), 'shell:open-folder must be registered')

    const openFileHandler = registeredHandlers.get('shell:open-file')
    const openFolderHandler = registeredHandlers.get('shell:open-folder')

    // Scenario 1: Valid completed Job ID -> File opens
    openedPaths = []
    const openRes = await openFileHandler({ sender: trustedSender }, validCompletedJob.id)
    assert.deepEqual(openRes, { success: true })
    assert.equal(openedPaths.length, 1)
    assert.equal(openedPaths[0], validTestFilePath)
    assert.equal(openRes.filePath, undefined, 'IPC response must NEVER expose filePath')

    // Scenario 2: Valid completed Job ID -> Folder opens
    shownFolders = []
    const folderRes = await openFolderHandler({ sender: trustedSender }, validCompletedJob.id)
    assert.deepEqual(folderRes, { success: true })
    assert.equal(shownFolders.length, 1)
    assert.equal(shownFolders[0], validTestFilePath)
    assert.equal(folderRes.filePath, undefined, 'IPC response must NEVER expose filePath')

    // Scenario 3: Invalid Job IDs (negative, zero, string "17", string path, object, null)
    openedPaths = []
    shownFolders = []
    const invalidIds = [
      -1,
      0,
      '17',
      'valid_download_clip.mp4',
      'C:\\Windows\\System32',
      null,
      undefined,
      {},
      NaN
    ]
    for (const badId of invalidIds) {
      const badFileRes = await openFileHandler({ sender: trustedSender }, badId)
      assert.equal(badFileRes.success, false, `Bad ID ${badId} must be rejected for open-file`)
      assert.equal(badFileRes.filePath, undefined)

      const badFolderRes = await openFolderHandler({ sender: trustedSender }, badId)
      assert.equal(badFolderRes.success, false, `Bad ID ${badId} must be rejected for open-folder`)
      assert.equal(badFolderRes.filePath, undefined)
    }
    assert.equal(openedPaths.length, 0, 'shell.openPath must never be called for invalid IDs')
    assert.equal(
      shownFolders.length,
      0,
      'shell.showItemInFolder must never be called for invalid IDs'
    )

    // Scenario 4: Non-existent Job ID
    const notFoundRes = await openFileHandler({ sender: trustedSender }, 999999)
    assert.equal(notFoundRes.success, false)
    assert.equal(openedPaths.length, 0)

    // Scenario 5: Job without DownloadFile record
    const noFileJob = await createDownloadJob({
      mediaItemId: testMedia.id,
      outputFormat: 'mp4',
      quality: '1080p'
    })
    await DownloadJob.update({ status: 'completed' }, { where: { id: noFileJob.id } })
    const noFileRes = await openFileHandler({ sender: trustedSender }, noFileJob.id)
    assert.equal(noFileRes.success, false)
    assert.equal(openedPaths.length, 0)

    // Scenario 6: Incomplete job
    const incompleteJob = await createDownloadJob({
      mediaItemId: testMedia.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    const incompleteRes = await openFileHandler({ sender: trustedSender }, incompleteJob.id)
    assert.equal(incompleteRes.success, false)
    assert.equal(openedPaths.length, 0)

    // Scenario 7: Missing file on disk
    const missingFilePath = path.join(testDb.tempDir, 'non_existent_file.mp4')
    const missingFileJob = await createDownloadJob({
      mediaItemId: testMedia.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    await DownloadJob.update(
      { status: 'completed', progress: 100 },
      { where: { id: missingFileJob.id } }
    )
    await DownloadFile.create({
      download_job_id: missingFileJob.id,
      file_name: 'non_existent_file.mp4',
      file_path: missingFilePath,
      file_format: 'mp4',
      file_size: 100
    })
    const missingRes = await openFileHandler({ sender: trustedSender }, missingFileJob.id)
    assert.equal(missingRes.success, false)
    assert.equal(openedPaths.length, 0)

    // Scenario 8: Relative path rejected
    const relativeJob = await createDownloadJob({
      mediaItemId: testMedia.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    await DownloadJob.update(
      { status: 'completed', progress: 100 },
      { where: { id: relativeJob.id } }
    )
    await DownloadFile.create({
      download_job_id: relativeJob.id,
      file_name: 'relative.mp4',
      file_path: 'relative/path/clip.mp4',
      file_format: 'mp4',
      file_size: 100
    })
    const relativeRes = await openFileHandler({ sender: trustedSender }, relativeJob.id)
    assert.equal(relativeRes.success, false)
    assert.equal(openedPaths.length, 0)
    assert.equal(
      await checkFileAvailability('relative/path/clip.mp4', 'completed'),
      'unavailable',
      'checkFileAvailability rejects relative paths'
    )

    // Scenario 9: Symlink file safety
    try {
      const symlinkPath = path.join(testDb.tempDir, 'symlink_clip.mp4')
      await fs.symlink(validTestFilePath, symlinkPath, 'file')
      const symlinkJob = await createDownloadJob({
        mediaItemId: testMedia.id,
        outputFormat: 'mp4',
        quality: '720p'
      })
      await DownloadJob.update(
        { status: 'completed', progress: 100 },
        { where: { id: symlinkJob.id } }
      )
      await DownloadFile.create({
        download_job_id: symlinkJob.id,
        file_name: 'symlink_clip.mp4',
        file_path: symlinkPath,
        file_format: 'mp4',
        file_size: 32
      })
      const symlinkRes = await openFileHandler({ sender: trustedSender }, symlinkJob.id)
      assert.equal(symlinkRes.success, false, 'Symlink download files must be rejected')
      assert.equal(openedPaths.length, 0, 'shell.openPath must never be called on symlinks')
      console.log('   ↳ Symlink security test: PASS (symlinks correctly rejected)')
    } catch (symlinkErr) {
      if (['EPERM', 'ENOSYS'].includes(symlinkErr.code)) {
        console.log('   ↳ Symlink creation not permitted in this OS environment: SKIPPED')
      } else {
        throw symlinkErr
      }
    }

    // Scenario 10: Destroyed BrowserWindow
    await assert.rejects(
      async () => openFileHandler({ sender: destroyedSender }, validCompletedJob.id),
      /Unauthorized IPC sender/
    )

    // Scenario 11: Unauthorized sender
    await assert.rejects(
      async () => openFileHandler({ sender: untrustedSender }, validCompletedJob.id),
      /Unauthorized IPC sender/
    )

    // Scenario 12: Electron openPath returns error string
    openPathReturnError = 'Failed to launch associated media player'
    const openPathErrRes = await openFileHandler({ sender: trustedSender }, validCompletedJob.id)
    assert.deepEqual(openPathErrRes, {
      success: false,
      error: 'The downloaded file could not be opened.'
    })
    openPathReturnError = null

    // Scenario 13: Electron shell throws exception
    shellShouldThrow = true
    const throwRes = await openFileHandler({ sender: trustedSender }, validCompletedJob.id)
    assert.deepEqual(throwRes, {
      success: false,
      error: 'The downloaded file could not be opened.'
    })
    shellShouldThrow = false

    // Scenario 14: Preload & Main Process IPC Contract
    const preloadPath = path.resolve(process.cwd(), 'src', 'preload', 'index.js')
    const preloadSource = await fs.readFile(preloadPath, 'utf-8')
    assert.ok(preloadSource.includes('openFile: (jobId)'), 'Preload must accept jobId for openFile')
    assert.ok(
      preloadSource.includes('openFolder: (jobId)'),
      'Preload must accept jobId for openFolder'
    )
    assert.ok(
      preloadSource.includes('chooseDownloadFolder'),
      'Preload must preserve chooseDownloadFolder'
    )
    assert.ok(
      preloadSource.includes('getDownloadFolder'),
      'Preload must preserve getDownloadFolder'
    )
    assert.ok(preloadSource.includes('request:'), 'Preload must preserve request')

    const mainIndexPath = path.resolve(process.cwd(), 'src', 'main', 'index.js')
    const mainIndexSource = await fs.readFile(mainIndexPath, 'utf-8')
    assert.ok(
      mainIndexSource.includes('registerDownloadFileHandlers'),
      'Main process must register handlers via registerDownloadFileHandlers'
    )

    console.log('✓ Group 7 passed: File & folder access validation and IPC contracts confirmed.\n')

    console.log('================================================================')
    console.log(' All Step 14 Frontend & Integration Tests Passed Successfully!')
    console.log('================================================================\n')
  } finally {
    await testDb.cleanup()
  }
}

runStep14Tests().catch((err) => {
  console.error('\n❌ Step 14 tests failed:', err)
  process.exit(1)
})
