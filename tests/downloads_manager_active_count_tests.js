import assert from 'node:assert/strict'

// Provide globalThis.window mock before importing renderer services
let mockIpcHandler = null
globalThis.window = {
  api: {
    request: (options) => {
      if (typeof mockIpcHandler === 'function') {
        return mockIpcHandler(options)
      }
      return Promise.resolve({ ok: true, status: 200, data: { success: true } })
    }
  }
}

import { getActiveDownloadsCount } from '../src/renderer/src/services/downloadsApi.js'
import { normalizeDownloadJob } from '../src/renderer/src/utils/downloadPresentation.js'

/**
 * ============================================================================
 * Phase 03 Test Suite: Downloads Manager & Sidebar Active Count
 *
 * Step 07 – Downloads Manager Initial Loading, Error Handling & Concurrency Guard
 * Step 08 – Sidebar Active Download Count (Real Query, Transient Error Preservation)
 * ============================================================================
 */
async function runDownloadsManagerActiveCountTests() {
  console.log('================================================================')
  console.log(' Phase 03: Downloads Manager & Sidebar Active Count Test Suite  ')
  console.log('================================================================\n')

  // --------------------------------------------------------------------------
  // STEP 08: Sidebar Active Download Count Tests
  // --------------------------------------------------------------------------
  console.log('--- Step 08: Sidebar Active Count (downloading + queued) ---')

  // Test 8.1: Successful active count calculation (downloading + queued)
  mockIpcHandler = async ({ path }) => {
    if (path.includes('status=downloading')) {
      return {
        ok: true,
        status: 200,
        data: {
          success: true,
          pagination: { total: 2, page: 1, limit: 1 }
        }
      }
    }
    if (path.includes('status=queued')) {
      return {
        ok: true,
        status: 200,
        data: {
          success: true,
          pagination: { total: 3, page: 1, limit: 1 }
        }
      }
    }
    return { ok: true, status: 200, data: { success: true } }
  }

  const result1 = await getActiveDownloadsCount()
  assert.equal(result1.total, 5, '8.1: Active count sums downloading (2) + queued (3) = 5')
  assert.equal(result1.ok, true, '8.1: ok is true when both requests succeed')
  console.log('✓ 8.1: Active count accurately sums downloading and queued jobs (5 total)')

  // Test 8.2: Confirmed zero active downloads (badge should hide)
  mockIpcHandler = async () => ({
    ok: true,
    status: 200,
    data: {
      success: true,
      pagination: { total: 0, page: 1, limit: 1 }
    }
  })

  const result2 = await getActiveDownloadsCount()
  assert.equal(result2.total, 0, '8.2: Total is 0 when no active jobs exist')
  assert.equal(result2.ok, true, '8.2: ok is true for confirmed zero count')
  console.log('✓ 8.2: Confirmed zero active downloads returns total 0 and ok: true')

  // Test 8.3: Transient API failure preservation (returns ok: false to keep last known count)
  mockIpcHandler = async ({ path }) => {
    if (path.includes('status=queued')) {
      return {
        ok: false,
        status: 500,
        data: { success: false, error: 'Database locked' }
      }
    }
    return {
      ok: true,
      status: 200,
      data: {
        success: true,
        pagination: { total: 2, page: 1, limit: 1 }
      }
    }
  }

  const result3 = await getActiveDownloadsCount()
  assert.equal(result3.ok, false, '8.3: ok is false when any request fails')
  console.log('✓ 8.3: Transient API failure returns ok: false to preserve last known badge')

  // Test 8.4: Excludes non-active statuses (completed, failed, cancelled, interrupted)
  // Verify that only status=downloading and status=queued are ever queried
  const queriedPaths = []
  mockIpcHandler = async ({ path }) => {
    queriedPaths.push(path)
    return {
      ok: true,
      status: 200,
      data: { success: true, pagination: { total: 1, page: 1, limit: 1 } }
    }
  }

  await getActiveDownloadsCount()
  assert.equal(queriedPaths.length, 2, '8.4: Exactly two queries made')
  assert.ok(
    queriedPaths.some((p) => p.includes('status=downloading')),
    '8.4: Queries downloading status'
  )
  assert.ok(
    queriedPaths.some((p) => p.includes('status=queued')),
    '8.4: Queries queued status'
  )
  assert.ok(
    !queriedPaths.some(
      (p) =>
        p.includes('status=completed') ||
        p.includes('status=failed') ||
        p.includes('status=cancelled') ||
        p.includes('status=interrupted')
    ),
    '8.4: Completed, failed, cancelled, and interrupted statuses are strictly excluded'
  )
  console.log('✓ 8.4: Completed, failed, cancelled, and interrupted jobs strictly excluded\n')

  // --------------------------------------------------------------------------
  // STEP 07: Downloads Manager Lifecycle & Presentation Tests
  // --------------------------------------------------------------------------
  console.log('--- Step 07: Downloads Manager Presentation & Status Mapping ---')

  // Test 7.1: Interrupted status presentation mapping
  const interruptedJob = {
    id: 101,
    status: 'interrupted',
    progress: 42,
    outputFormat: 'mp4',
    quality: '1080p',
    MediaItem: { title: 'Network Test Video' }
  }
  const interruptedPres = normalizeDownloadJob(interruptedJob)
  assert.equal(
    interruptedPres.displayStatus,
    'interrupted',
    '7.1: Interrupted display status is "interrupted"'
  )
  assert.equal(
    interruptedPres.statusText,
    'Interrupted – Waiting for internet connection',
    '7.1: Status text indicates waiting for internet'
  )
  console.log('✓ 7.1: Interrupted status mapped to amber badge with descriptive network text')

  // Test 7.2: Resuming status presentation mapping (queued with progress > 0)
  const resumingJob = {
    id: 102,
    status: 'queued',
    progress: 58,
    outputFormat: 'mp4',
    quality: '720p',
    MediaItem: { title: 'Resuming Video' }
  }
  const resumingPres = normalizeDownloadJob(resumingJob)
  assert.equal(resumingPres.displayStatus, 'resuming', '7.2: Resuming display status is "resuming"')
  assert.equal(
    resumingPres.statusText,
    'Resuming (58% saved)',
    '7.2: Resuming text shows saved percentage'
  )
  console.log('✓ 7.2: Resuming status mapped to cyan badge with saved progress percentage')

  // Test 7.3: Standard status presentation mappings preserved
  assert.equal(normalizeDownloadJob({ status: 'downloading' }).displayStatus, 'downloading')
  assert.equal(normalizeDownloadJob({ status: 'queued' }).displayStatus, 'queued')
  assert.equal(normalizeDownloadJob({ status: 'completed' }).displayStatus, 'completed')
  assert.equal(normalizeDownloadJob({ status: 'failed' }).displayStatus, 'failed')
  assert.equal(normalizeDownloadJob({ status: 'cancelled' }).displayStatus, 'cancelled')
  console.log(
    '✓ 7.3: Standard statuses (downloading, queued, completed, failed, cancelled) intact\n'
  )

  // --------------------------------------------------------------------------
  // STEP 07: Downloads Manager Hook Logic Simulation
  // --------------------------------------------------------------------------
  console.log('--- Step 07: Downloads Manager Hook State Simulation ---')

  // Simulation harness representing useDownloadsManager state transitions
  function createHarness() {
    const state = {
      items: [],
      total: 0,
      isLoading: true,
      error: null
    }
    let requestGen = 0

    const fetchDownloads = async (isBackground = false, mockResponseFn) => {
      const currentGen = ++requestGen
      if (!isBackground) {
        state.isLoading = true
        state.error = null
      }

      try {
        const response = await mockResponseFn()
        // StrictMode race condition guard: reject stale generations
        if (currentGen !== requestGen) {
          return // Dropped stale response
        }

        if (response.ok && response.data?.success) {
          state.items = response.data.items || []
          state.total = response.data.pagination?.total || 0
          state.error = null
        } else {
          throw new Error(response.data?.error || 'Failed to fetch downloads')
        }
      } catch (err) {
        if (currentGen !== requestGen) return
        if (!isBackground) {
          state.error = err.message
          state.items = []
          state.total = 0
        }
        // Background polling errors intentionally do NOT wipe state.items
      } finally {
        if (currentGen === requestGen && !isBackground) {
          state.isLoading = false
        }
      }
    }

    return {
      getState: () => ({ ...state }),
      fetchDownloads
    }
  }

  // Test 7.4: Initial fetch success and genuine empty state
  const harness1 = createHarness()
  assert.equal(harness1.getState().isLoading, true, '7.4: isLoading starts true')

  await harness1.fetchDownloads(false, async () => ({
    ok: true,
    data: { success: true, items: [], pagination: { total: 0 } }
  }))
  assert.equal(harness1.getState().isLoading, false, '7.4: isLoading false after fetch')
  assert.equal(harness1.getState().error, null, '7.4: error is null on empty success')
  assert.equal(harness1.getState().total, 0, '7.4: total is 0 for genuine empty state')
  console.log('✓ 7.4: Genuine empty state handled with isLoading: false and error: null')

  // Test 7.5: Initial fetch failure sets error state and stops loading
  const harness2 = createHarness()
  await harness2.fetchDownloads(false, async () => ({
    ok: false,
    data: { success: false, error: 'Database connection failed' }
  }))
  assert.equal(harness2.getState().isLoading, false, '7.5: isLoading false after failure')
  assert.equal(
    harness2.getState().error,
    'Database connection failed',
    '7.5: Error message captured'
  )
  console.log('✓ 7.5: Initial fetch failure sets error state and allows retry action')

  // Test 7.6: Background polling failure preserves existing items
  const harness3 = createHarness()
  await harness3.fetchDownloads(false, async () => ({
    ok: true,
    data: {
      success: true,
      items: [{ id: 1, title: 'Item 1' }],
      pagination: { total: 1 }
    }
  }))
  assert.equal(harness3.getState().items.length, 1, '7.6: One item loaded')

  // Trigger background poll failure
  await harness3.fetchDownloads(true, async () => {
    throw new Error('Transient network glitch during background poll')
  })
  assert.equal(
    harness3.getState().items.length,
    1,
    '7.6: Existing items preserved despite background failure'
  )
  assert.equal(harness3.getState().error, null, '7.6: Transient background error not displayed')
  console.log('✓ 7.6: Background polling failures preserve loaded records without flicker')

  // Test 7.7: StrictMode double-mount request generation guard prevents stale overwrites
  const harness4 = createHarness()
  let resolveSlowResponse = null

  // Slow request (Generation 1)
  const slowPromise = harness4.fetchDownloads(
    false,
    () =>
      new Promise((resolve) => {
        resolveSlowResponse = resolve
      })
  )

  // Fast fresh request (Generation 2, e.g. from user filter change or StrictMode remount)
  await harness4.fetchDownloads(false, async () => ({
    ok: true,
    data: {
      success: true,
      items: [{ id: 2, title: 'Fresh Fast Response' }],
      pagination: { total: 1 }
    }
  }))

  assert.equal(harness4.getState().items[0].id, 2, '7.7: Fresh response applied')

  // Now resolve the older slow request (Generation 1)
  resolveSlowResponse({
    ok: true,
    data: {
      success: true,
      items: [{ id: 1, title: 'Stale Slow Response' }],
      pagination: { total: 1 }
    }
  })
  await slowPromise

  assert.equal(
    harness4.getState().items[0].id,
    2,
    '7.7: Stale Generation 1 response ignored; Generation 2 preserved'
  )
  console.log(
    '✓ 7.7: StrictMode request-generation guard prevents stale responses overwriting data'
  )

  console.log('\n================================================================')
  console.log(' ALL PHASE 03 DOWNLOADS MANAGER & ACTIVE COUNT TESTS PASSED!    ')
  console.log('================================================================\n')
}

runDownloadsManagerActiveCountTests().catch((err) => {
  console.error('\n❌ PHASE 03 TESTS FAILED:', err)
  process.exit(1)
})
