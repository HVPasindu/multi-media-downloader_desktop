import assert from 'node:assert/strict'
import {
  analyzeMedia,
  clearMediaAnalysisCache
} from '../src/main/backend/services/mediaAnalyzerService.js'

/**
 * ============================================================================
 * Step 01 Automated Test Suite: In-Memory Analysis Cache & Deduplication
 * ============================================================================
 */

const SAMPLE_YT_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

const SYNTHETIC_FIXTURE = {
  id: 'dQw4w9WgXcQ',
  title: 'Rick Astley - Never Gonna Give You Up (Official Music Video)',
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
  duration: 212,
  formats: [
    {
      format_id: '137',
      ext: 'mp4',
      height: 1080,
      vcodec: 'avc1.640028',
      acodec: 'none',
      filesize: 50000000
    },
    {
      format_id: '136',
      ext: 'mp4',
      height: 720,
      vcodec: 'avc1.4d401f',
      acodec: 'none',
      filesize: 25000000
    },
    {
      format_id: '140',
      ext: 'm4a',
      vcodec: 'none',
      acodec: 'mp4a.40.2',
      abr: 128,
      filesize: 3000000
    }
  ]
}

async function runAnalysisCacheTests() {
  console.log('================================================================')
  console.log(' APPLAN2 — Step 01: In-Memory Media Analysis Cache Test Suite')
  console.log('================================================================\n')

  let execFileCallCount = 0
  let simulateError = null
  let execDelayMs = 0

  // Configure child_process mock handler via globalThis
  globalThis.__mockChildProcess = {
    execFile: (executable, args, options, callback) => {
      if (typeof options === 'function') {
        callback = options
        options = {}
      }

      const argsList = Array.isArray(args) ? args : []
      if (argsList.includes('--dump-single-json')) {
        execFileCallCount++

        const deliver = () => {
          if (simulateError) {
            const err = new Error(simulateError.message || 'Simulated extraction error')
            err.stderr = simulateError.stderr || ''
            if (typeof callback === 'function') {
              callback(err, { stdout: '', stderr: err.stderr })
            }
            return
          }

          if (typeof callback === 'function') {
            callback(null, {
              stdout: JSON.stringify(SYNTHETIC_FIXTURE),
              stderr: ''
            })
          }
        }

        if (execDelayMs > 0) {
          setTimeout(deliver, execDelayMs)
        } else {
          process.nextTick(deliver)
        }
        return {}
      }

      if (typeof callback === 'function') {
        process.nextTick(() => callback(null, { stdout: '', stderr: '' }))
      }
      return {}
    }
  }

  try {
    // ------------------------------------------------------------------------
    // Test 1: Successful metadata extraction & caching
    // ------------------------------------------------------------------------
    console.log('--- 1. Testing Metadata Caching & Child Process Avoidance ---')
    clearMediaAnalysisCache()
    execFileCallCount = 0
    simulateError = null

    const firstResult = await analyzeMedia(SAMPLE_YT_URL)
    assert.equal(firstResult.id, 'dQw4w9WgXcQ')
    assert.equal(firstResult.title, SYNTHETIC_FIXTURE.title)
    assert.equal(execFileCallCount, 1, 'Initial analysis must invoke child process once')
    console.log('✓ Test 1 Passed: Initial metadata extraction succeeded.')

    // ------------------------------------------------------------------------
    // Test 2: Reusing cached metadata (no second child process execution)
    // ------------------------------------------------------------------------
    console.log('--- 2. Testing Cache Hit for Repeated Analysis of Same URL ---')
    const secondResult = await analyzeMedia(SAMPLE_YT_URL)
    assert.equal(secondResult.id, 'dQw4w9WgXcQ')
    assert.equal(secondResult.title, SYNTHETIC_FIXTURE.title)
    assert.equal(
      execFileCallCount,
      1,
      'Second analysis of same URL must use cached metadata without calling yt-dlp'
    )
    console.log('✓ Test 2 Passed: Repeated analysis retrieved from cache without spawning yt-dlp.')

    // ------------------------------------------------------------------------
    // Test 3: In-flight simultaneous request deduplication
    // ------------------------------------------------------------------------
    console.log('--- 3. Testing Simultaneous In-Flight Request Deduplication ---')
    clearMediaAnalysisCache()
    execFileCallCount = 0
    execDelayMs = 40 // Add latency to test concurrent in-flight deduplication

    const [parallelRes1, parallelRes2] = await Promise.all([
      analyzeMedia(SAMPLE_YT_URL),
      analyzeMedia(SAMPLE_YT_URL)
    ])

    assert.equal(parallelRes1.id, 'dQw4w9WgXcQ')
    assert.equal(parallelRes2.id, 'dQw4w9WgXcQ')
    assert.equal(
      execFileCallCount,
      1,
      'Concurrent in-flight requests must share identical promise (called only once)'
    )
    execDelayMs = 0
    console.log('✓ Test 3 Passed: Simultaneous requests shared single execution promise.')

    // ------------------------------------------------------------------------
    // Test 4: Ensuring failed analysis results are NOT cached
    // ------------------------------------------------------------------------
    console.log('--- 4. Testing Failed Extractions Are Not Cached as Valid ---')
    clearMediaAnalysisCache()
    execFileCallCount = 0
    simulateError = {
      message: 'Failed to extract media information',
      stderr: 'ERROR: Video unavailable'
    }

    let errorCaught = false
    try {
      await analyzeMedia(SAMPLE_YT_URL)
    } catch {
      errorCaught = true
    }
    assert.equal(errorCaught, true, 'Failed extraction must throw an error')
    assert.ok(execFileCallCount >= 1, 'Child process must have been called for failure')

    // Now clear the error so subsequent request succeeds
    simulateError = null
    const recoveryCountBefore = execFileCallCount
    const recoveredResult = await analyzeMedia(SAMPLE_YT_URL)
    assert.equal(recoveredResult.id, 'dQw4w9WgXcQ')
    assert.ok(
      execFileCallCount > recoveryCountBefore,
      'Subsequent request must retry extraction rather than returning cached failure'
    )
    console.log(
      '✓ Test 4 Passed: Failed extraction was not cached; subsequent request retried successfully.'
    )

    // ------------------------------------------------------------------------
    // Test 5: Cache clearing via clearMediaAnalysisCache()
    // ------------------------------------------------------------------------
    console.log('--- 5. Testing Explicit Cache Clearing via clearMediaAnalysisCache() ---')
    assert.equal(execFileCallCount > 0, true)
    const countBeforeClear = execFileCallCount

    // Hit cache first to confirm it is currently cached
    await analyzeMedia(SAMPLE_YT_URL)
    assert.equal(execFileCallCount, countBeforeClear, 'Cache hit confirmed')

    // Now explicitly clear cache
    clearMediaAnalysisCache()

    // Next call must invoke child process again
    await analyzeMedia(SAMPLE_YT_URL)
    assert.equal(
      execFileCallCount,
      countBeforeClear + 1,
      'After clearing cache, child process must be invoked again'
    )
    console.log(
      '✓ Test 5 Passed: clearMediaAnalysisCache() successfully reset the in-memory cache.'
    )

    console.log('\n================================================================')
    console.log(' ALL STEP 01 ANALYSIS CACHE TESTS PASSED SUCCESSFULLY (100% PASS)')
    console.log('================================================================\n')
  } finally {
    clearMediaAnalysisCache()
    delete globalThis.__mockChildProcess
  }
}

runAnalysisCacheTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Step 01 Cache Test Failure:', err)
    process.exit(1)
  })
