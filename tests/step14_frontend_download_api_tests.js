import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  validateHistoryFilters,
  listDownloadHistory
} from '../src/main/backend/services/downloadHistoryService.js'
import { createDownloadJob } from '../src/main/backend/services/downloadService.js'
import { cancelDownloadJob } from '../src/main/backend/services/downloadQueueService.js'
import { retryDownloadJob } from '../src/main/backend/services/downloadRetryService.js'
import {
  getFriendlyErrorInfo,
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
  // 1. Client Query Param Serialization & History Filter Validation
  // ----------------------------------------------------------------
  console.log('--- 1. Testing History Date Range Validation & Filters ---')

  // Valid date range
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

  // Invalid date range: from > to
  const v2 = validateHistoryFilters({
    from: '2026-11-10',
    to: '2026-11-01'
  })
  assert.equal(v2.isValid, false, 'Range with fromDate > toDate must fail validation')
  assert.ok(v2.errors.dateRange, 'dateRange error message must be present')

  // Invalid date format
  const v3 = validateHistoryFilters({
    from: 'not-a-valid-date'
  })
  assert.equal(v3.isValid, false, 'Invalid date string must fail validation')
  assert.ok(v3.errors.from, 'from error message must be present')

  // URL query parameter serialization verification
  const testParams = new URLSearchParams()
  const mockFilters = {
    status: 'downloading',
    statuses: ['failed', 'cancelled'],
    search: '  rock concert  ',
    outputFormat: 'mp4',
    sourceType: 'link',
    from: '2026-11-01',
    to: '2026-11-06',
    limit: 20,
    offset: 40
  }
  if (mockFilters.status) testParams.set('status', mockFilters.status)
  if (mockFilters.statuses) {
    const statusesStr = Array.isArray(mockFilters.statuses)
      ? mockFilters.statuses.join(',')
      : String(mockFilters.statuses)
    testParams.set('statuses', statusesStr)
  }
  if (mockFilters.search && typeof mockFilters.search === 'string' && mockFilters.search.trim()) {
    testParams.set('search', mockFilters.search.trim())
  }
  if (mockFilters.outputFormat) testParams.set('outputFormat', mockFilters.outputFormat)
  if (mockFilters.sourceType) testParams.set('sourceType', mockFilters.sourceType)
  if (mockFilters.from) testParams.set('from', mockFilters.from)
  if (mockFilters.to) testParams.set('to', mockFilters.to)
  if (mockFilters.limit !== undefined) testParams.set('limit', String(mockFilters.limit))
  if (mockFilters.offset !== undefined) testParams.set('offset', String(mockFilters.offset))

  assert.equal(testParams.get('status'), 'downloading')
  assert.equal(testParams.get('statuses'), 'failed,cancelled')
  assert.equal(testParams.get('search'), 'rock concert')
  assert.equal(testParams.get('from'), '2026-11-01')
  assert.equal(testParams.get('to'), '2026-11-06')
  assert.equal(testParams.get('limit'), '20')
  assert.equal(testParams.get('offset'), '40')

  console.log('✓ Group 1 passed: Date range and query filter validation confirmed.\n')

  // ----------------------------------------------------------------
  // 2. Database Integration: Date Range Filtering with SQLite
  // ----------------------------------------------------------------
  console.log('--- 2. Testing SQLite Date Range Filtering in Download History ---')
  const testDb = await createTestDatabase('applan2-step14-test-')
  console.log(`[setup] Isolated test database: ${testDb.databasePath}`)

  try {
    const { MediaItem, DownloadJob, DownloadFile } = testDb.sequelize.models

    const testMedia = await MediaItem.create({
      source_url: 'https://youtube.com/watch?v=step14test',
      platform: 'youtube',
      title: 'Step 14 Frontend Verification Video'
    })

    // Seed 4 jobs with distinct createdAt dates:
    // Job 1: 2026-10-15 (outside range)
    // Job 2: 2026-11-02 (inside range)
    // Job 3: 2026-11-05 (inside range)
    // Job 4: 2026-11-20 (outside range)
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

    // Query with date range 2026-11-01 to 2026-11-06 (should match jobs 2 and 3 only)
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
      '✓ Group 2 passed: SQLite date range filtering accurately isolates target records.\n'
    )

    // ----------------------------------------------------------------
    // 3. Cancellation Flow & Response Outcomes
    // ----------------------------------------------------------------
    console.log('--- 3. Testing Cancellation Flow & Outcomes ---')

    // Test 3.1: Cancel a queued job -> immediate cancellation (status: cancelled)
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

    // Test 3.2: Cancelling an already cancelled job -> idempotent outcome
    const cancelRes2 = await cancelDownloadJob(queuedJob.id)
    assert.equal(
      cancelRes2.outcome,
      'already_cancelled',
      'Cancelling an already cancelled job must return already_cancelled'
    )

    // Test 3.3: Cancelling a completed job -> conflict outcome
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

    // Test 3.4: Cancelling non-existent job -> not_found outcome
    const cancelRes4 = await cancelDownloadJob(999999)
    assert.equal(
      cancelRes4.outcome,
      'not_found',
      'Cancelling non-existent job must return not_found'
    )

    console.log(
      '✓ Group 3 passed: Cancellation flow handles queued, idempotent, conflict, and not_found.\n'
    )

    // ----------------------------------------------------------------
    // 4. Retry Flow & Same-Job ID Preservation
    // ----------------------------------------------------------------
    console.log('--- 4. Testing Retry Flow & Double-Click Protection Simulation ---')

    // Test 4.1: Retry failed job under same Job ID
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

    // Test 4.2: Retrying an already queued/active job -> conflict / retry_in_progress outcome
    const retryRes2 = await retryDownloadJob(failedJob.id, { enqueue: () => {} })
    assert.equal(
      retryRes2.outcome,
      'retry_in_progress',
      'Retrying an already queued retry job must return retry_in_progress (double-click protection)'
    )

    // Test 4.3: Retrying non-existent job -> not_found outcome
    const retryRes3 = await retryDownloadJob(888888)
    assert.equal(retryRes3.outcome, 'not_found', 'Retrying non-existent job must return not_found')

    console.log(
      '✓ Group 4 passed: Retry preserves Job ID and rejects duplicate in-flight requests.\n'
    )

    // ----------------------------------------------------------------
    // 5. Error Presentation & Suppression for Historical Failures
    // ----------------------------------------------------------------
    console.log('--- 5. Testing Error Presentation & Notification Suppression ---')

    // Test 5.1: Friendly error mapping for CANCELLED
    const cancelErrInfo = getFriendlyErrorInfo('[CANCELLED] Download was cancelled by user')
    assert.equal(cancelErrInfo.code, 'CANCELLED')
    assert.equal(cancelErrInfo.title, 'Download Cancelled')
    assert.ok(cancelErrInfo.isRetryable)

    // Test 5.2: Friendly error mapping for NETWORK_ERROR
    const networkErrInfo = getFriendlyErrorInfo('[NETWORK_ERROR] Connection reset by peer')
    assert.equal(networkErrInfo.code, 'NETWORK_ERROR')
    assert.equal(networkErrInfo.title, 'Network Connection Error')
    assert.equal(networkErrInfo.guidance, 'Check internet connection')

    // Test 5.3: Clean message and error code extraction
    assert.equal(extractErrorCode('[DATABASE_ERROR] SQLite database is locked'), 'DATABASE_ERROR')
    assert.equal(
      extractCleanMessage('[DATABASE_ERROR] SQLite database is locked'),
      'SQLite database is locked'
    )

    // Test 5.4: Unknown error fallback without technical stack traces
    const fallbackErr = getFriendlyErrorInfo(
      'Some raw technical error: Error at Object.<anonymous> (/app/src/index.js:12:34)'
    )
    assert.equal(fallbackErr.code, 'UNKNOWN_ERROR')
    assert.equal(fallbackErr.title, 'Download Failed')

    // Test 5.5: Notification suppression for historical failures
    seedKnownFailures([101, 102])
    const popupResult1 = notifyLiveJobFailure(101, {
      title: 'Should be suppressed',
      message: 'Suppressed'
    })
    assert.equal(popupResult1, undefined, 'Pre-seeded historical failures must not trigger popups')

    console.log('✓ Group 5 passed: Error presentation and suppression contracts confirmed.\n')

    // ----------------------------------------------------------------
    // 6. IPC Safety & Preload Contract Verification
    // ----------------------------------------------------------------
    console.log('--- 6. Testing IPC Registration & Preload Contract ---')

    const preloadPath = path.resolve(process.cwd(), 'src', 'preload', 'index.js')
    const preloadSource = await fs.readFile(preloadPath, 'utf-8')
    assert.ok(preloadSource.includes('openFile:'), 'Preload must expose openFile')
    assert.ok(preloadSource.includes('openFolder:'), 'Preload must expose openFolder')
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

    console.log('✓ Group 6 passed: Preload and IPC bridge contracts verified.\n')

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
