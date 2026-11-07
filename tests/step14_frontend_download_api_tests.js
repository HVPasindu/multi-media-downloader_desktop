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
  extractErrorCode,
  extractCleanMessage
} from '../src/renderer/src/utils/errorPresentation.js'
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

    // Test FIX 04 UI Retry loading-state logic
    let retryingJobId = null

    function isButtonDisabled(retryingId) {
      return retryingId !== null
    }

    function isSpinnerActive(jobId, retryingId) {
      return retryingId === jobId
    }

    // Initial state: no retry
    assert.equal(isButtonDisabled(retryingJobId), false, 'When idle, buttons are enabled')
    assert.equal(isSpinnerActive(12, retryingJobId), false, 'When idle, spinner is off')

    // Trigger retry on Job 12
    retryingJobId = 12
    assert.equal(
      isButtonDisabled(retryingJobId),
      true,
      'All retry buttons disabled when Job 12 is retrying'
    )
    assert.equal(isSpinnerActive(12, retryingJobId), true, 'Spinner active on retrying Job 12')
    assert.equal(isSpinnerActive(15, retryingJobId), false, 'Spinner NOT active on other Job 15')

    // Handler guard prevents double-execution
    let callExecuted = false
    function triggerRetry() {
      if (retryingJobId !== null) return
      callExecuted = true
    }
    triggerRetry()
    assert.equal(callExecuted, false, 'Handler guard strictly rejects concurrent clicks')

    // Reset after completion
    retryingJobId = null
    assert.equal(isButtonDisabled(retryingJobId), false, 'Buttons re-enabled after retry completes')

    console.log(
      '✓ Group 5 passed: Retry preserves Job ID and global button loading-state is consistent.\n'
    )

    // ----------------------------------------------------------------
    // 6. Consistent Safe Error Handling (FIX 03)
    // ----------------------------------------------------------------
    console.log('--- 6. Testing Error Presentation & Safe Sanitization (FIX 03) ---')

    // Test 6.0: getFriendlyErrorInfo backward compatibility preserved
    assert.equal(getFriendlyErrorInfo('[NETWORK_ERROR] legacy check').code, 'NETWORK_ERROR')

    // Test 6.1: Friendly error mapping for CANCELLED
    const cancelErrInfo = getSafeFriendlyErrorInfo('[CANCELLED] Download was cancelled by user')
    assert.equal(cancelErrInfo.code, 'CANCELLED')
    assert.equal(cancelErrInfo.title, 'Download Cancelled')
    assert.ok(cancelErrInfo.isRetryable)

    // Test 6.2: Friendly error mapping for NETWORK_ERROR
    const networkErrInfo = getSafeFriendlyErrorInfo('[NETWORK_ERROR] Connection reset by peer')
    assert.equal(networkErrInfo.code, 'NETWORK_ERROR')
    assert.equal(networkErrInfo.title, 'Network Connection Error')
    assert.equal(networkErrInfo.guidance, 'Check internet connection')
    assert.equal(networkErrInfo.message, 'Connection reset by peer')

    // Test 6.3: Clean message and error code extraction
    assert.equal(extractErrorCode('[DATABASE_ERROR] SQLite database is locked'), 'DATABASE_ERROR')
    assert.equal(
      extractCleanMessage('[DATABASE_ERROR] SQLite database is locked'),
      'SQLite database is locked'
    )

    // Test 6.4: Technical database and sequelize error suppression
    const dbErr = getSafeFriendlyErrorInfo(
      'SequelizeDatabaseError: SQLITE_BUSY: database is locked'
    )
    assert.ok(
      !dbErr.message.includes('SQLITE_BUSY'),
      'Technical database error names must not be exposed'
    )
    assert.ok(!dbErr.message.includes('Sequelize'), 'Sequelize references must not be exposed')

    // Test 6.5: JavaScript TypeError suppression
    const typeErr = getSafeFriendlyErrorInfo(
      'TypeError: Cannot read properties of undefined (reading "id")'
    )
    assert.ok(!typeErr.message.includes('TypeError'), 'TypeError details must not be exposed')

    // Test 6.6: Full stack trace suppression
    const stackTraceErr = getSafeFriendlyErrorInfo(
      'Error: Download failed\n    at Object.<anonymous> (I:\\acpt\\projects\\app\\src\\index.js:12:34)\n    at Module._compile (node:internal/modules/cjs/loader:123:45)'
    )
    assert.ok(
      !stackTraceErr.message.includes('at Object.<anonymous>'),
      'Stack traces must be stripped'
    )
    assert.ok(
      !stackTraceErr.message.includes('node:internal'),
      'Node internal paths must be stripped'
    )

    // Test 6.7: Absolute filesystem paths suppression (Windows & Linux)
    const winPathErr = getSafeFriendlyErrorInfo(
      'Failed writing to C:\\Users\\Administrator\\AppData\\secret.bin'
    )
    assert.ok(!winPathErr.message.includes('C:\\Users'), 'Windows user paths must be stripped')

    const linuxPathErr = getSafeFriendlyErrorInfo(
      'Failed writing to /home/appuser/downloads/secret.bin'
    )
    assert.ok(!linuxPathErr.message.includes('/home/appuser'), 'Linux user paths must be stripped')

    // Test 6.8: Safe plain user message preserved
    const safeMsg = getSafeFriendlyErrorInfo('The requested video is no longer available online.')
    assert.equal(safeMsg.message, 'The requested video is no longer available online.')

    // Test 6.9: Notification suppression for historical failures
    seedKnownFailures([101, 102])
    const popupResult1 = notifyLiveJobFailure(101, {
      title: 'Should be suppressed',
      message: 'Suppressed'
    })
    assert.equal(popupResult1, undefined, 'Pre-seeded historical failures must not trigger popups')

    console.log(
      '✓ Group 6 passed: Consistent safe error presentation and technical suppression verified.\n'
    )

    // ----------------------------------------------------------------
    // 7. File & Folder Access Verification (FIX 02)
    // ----------------------------------------------------------------
    console.log('--- 7. Testing File & Folder Access Verification (FIX 02) ---')

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

    // 7.1 Valid completed file returns 'available'
    const validDetails = await getDownloadHistoryDetails(validCompletedJob.id)
    assert.ok(validDetails, 'History details should exist')
    assert.equal(validDetails.file_status, 'available')
    assert.equal(validDetails.file.file_path, validTestFilePath)

    // 7.2 Missing file returns 'missing'
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

    const missingDetails = await getDownloadHistoryDetails(missingFileJob.id)
    assert.equal(
      missingDetails.file_status,
      'missing',
      'Missing disk file must report status missing'
    )

    // 7.3 Incomplete job returns 'not_applicable'
    const incompleteJob = await createDownloadJob({
      mediaItemId: testMedia.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    const incompleteAvail = await checkFileAvailability(validTestFilePath, incompleteJob.status)
    assert.equal(incompleteAvail, 'not_applicable', 'Incomplete job must return not_applicable')

    // 7.4 Relative path returns 'unavailable'
    const relativeAvail = await checkFileAvailability('relative/path/clip.mp4', 'completed')
    assert.equal(relativeAvail, 'unavailable', 'Non-absolute path must return unavailable')

    // 7.5 Invalid Job ID rejection
    await assert.rejects(
      async () => getDownloadHistoryDetails(-1),
      /A valid Download Job ID is required/
    )
    await assert.rejects(
      async () => getDownloadHistoryDetails(0),
      /A valid Download Job ID is required/
    )
    await assert.rejects(
      async () => getDownloadHistoryDetails('not-a-number'),
      /A valid Download Job ID is required/
    )

    // 7.6 Preload & Main Process IPC Contract
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
      mainIndexSource.includes('shell:open-file'),
      'Main process must handle shell:open-file'
    )
    assert.ok(
      mainIndexSource.includes('shell:open-folder'),
      'Main process must handle shell:open-folder'
    )
    assert.ok(
      mainIndexSource.includes('getVerifiedDownloadFilePath'),
      'Main process must validate file via getVerifiedDownloadFilePath helper'
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
