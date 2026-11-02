import assert from 'node:assert/strict'
import {
  classifyAnalysisError,
  analyzeMedia,
  clearMediaAnalysisCache,
  getRateLimitCooldown
} from '../src/main/backend/services/mediaAnalyzerService.js'
import { isSafeThumbnailUrl } from '../src/renderer/src/utils/mediaUrlInput.js'

/**
 * ============================================================================
 * Step 02 Automated Test Suite: Error Classification, PO Token & Cooldown
 * ============================================================================
 */

const SAMPLE_YT_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

async function runErrorClassificationTests() {
  console.log('================================================================')
  console.log(' APPLAN2 — Step 02: Error Classification & PO Token Test Suite')
  console.log('================================================================\n')

  try {
    // ------------------------------------------------------------------------
    // Group 1: Unit Classification of yt-dlp Errors
    // ------------------------------------------------------------------------
    console.log('--- 1. Testing Individual Error Classification Types ---')

    // 1.1 HTTP 429 Rate Limit
    const rateLimitErr1 = {
      message: 'Command failed with exit code 1',
      stderr: 'ERROR: [youtube] dQw4w9WgXcQ: HTTP Error 429: Too Many Requests'
    }
    const c1 = classifyAnalysisError(rateLimitErr1, 'youtube')
    assert.equal(c1.code, 'YOUTUBE_RATE_LIMITED')
    assert.equal(c1.retryAfterSeconds, 60)
    console.log('✓ Test 1.1 Passed: HTTP Error 429 -> YOUTUBE_RATE_LIMITED with 60s cooldown')

    // 1.2 Bot Verification
    const botErr = {
      message: 'Command failed with exit code 1',
      stderr:
        'ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you’re not a bot. This helps protect our community.'
    }
    const c2 = classifyAnalysisError(botErr, 'youtube')
    assert.equal(c2.code, 'YOUTUBE_AUTH_REQUIRED')
    assert.equal(c2.retryAfterSeconds, null)
    console.log('✓ Test 1.2 Passed: Bot verification prompt -> YOUTUBE_AUTH_REQUIRED')

    // 1.3 Authentication Required / Private Video
    const authErr = {
      message: 'Command failed with exit code 1',
      stderr: 'ERROR: [youtube] dQw4w9WgXcQ: This video is private. Sign in to view this video.'
    }
    const c3 = classifyAnalysisError(authErr, 'youtube')
    assert.equal(c3.code, 'YOUTUBE_AUTH_REQUIRED')
    assert.equal(c3.retryAfterSeconds, null)
    console.log(
      '✓ Test 1.3 Passed: Private video / authentication required -> YOUTUBE_AUTH_REQUIRED'
    )

    // 1.4 Missing Visitor Data
    const visitorErr = {
      message: 'Command failed with exit code 1',
      stderr:
        'ERROR: [youtube] dQw4w9WgXcQ: missing visitor_data in extraction context. Please provide visitor_data.'
    }
    const c4 = classifyAnalysisError(visitorErr, 'youtube')
    assert.equal(c4.code, 'YOUTUBE_PO_TOKEN_REQUIRED')
    assert.equal(c4.retryAfterSeconds, null)
    console.log('✓ Test 1.4 Passed: Missing visitor data -> YOUTUBE_PO_TOKEN_REQUIRED')

    // 1.5 PO Token Required
    const poTokenErr = {
      message: 'Command failed with exit code 1',
      stderr:
        'ERROR: [youtube] dQw4w9WgXcQ: GVS PO Token is required to download this video stream. Use --po-token or browser provider.'
    }
    const c5 = classifyAnalysisError(poTokenErr, 'youtube')
    assert.equal(c5.code, 'YOUTUBE_PO_TOKEN_REQUIRED')
    assert.equal(c5.retryAfterSeconds, null)
    console.log('✓ Test 1.5 Passed: PO Token required -> YOUTUBE_PO_TOKEN_REQUIRED')

    // 1.6 Network Connection Errors
    const netErr1 = {
      message: 'getaddrinfo ENOTFOUND www.youtube.com',
      stderr: ''
    }
    const c6 = classifyAnalysisError(netErr1, 'youtube')
    assert.equal(c6.code, 'NETWORK_ERROR')
    assert.equal(c6.retryAfterSeconds, null)

    const netErr2 = {
      message: 'Command failed',
      stderr: 'ERROR: [youtube] Unable to connect: [Errno 110] Connection timed out'
    }
    const c7 = classifyAnalysisError(netErr2, 'youtube')
    assert.equal(c7.code, 'NETWORK_ERROR')
    console.log('✓ Test 1.6 Passed: Connection failure / DNS failure -> NETWORK_ERROR')

    // 1.7 General Analysis Errors
    const genErr = {
      message: 'Command failed with exit code 1',
      stderr: 'ERROR: [youtube] dQw4w9WgXcQ: Video unavailable'
    }
    const c8 = classifyAnalysisError(genErr, 'youtube')
    assert.equal(c8.code, 'ANALYSIS_FAILED')
    console.log('✓ Test 1.7 Passed: General yt-dlp error -> ANALYSIS_FAILED')

    // ------------------------------------------------------------------------
    // Group 2: Combined Error Output (PO Token & Auth Priority Over 429)
    // ------------------------------------------------------------------------
    console.log('\n--- 2. Testing Priority in Combined Warning/Error Outputs ---')

    // 2.1 Output contains 429 in a warning or format ID, but error is PO Token
    const combinedPoErr = {
      message: 'Extraction failure',
      stderr:
        'WARNING: [youtube] Web client fallback triggered (received HTTP 429 status code)\n' +
        'WARNING: [youtube] Format 429 requested\n' +
        'ERROR: [youtube] dQw4w9WgXcQ: GVS PO Token is required: please provide visitor_data and po_token'
    }
    const cCombined1 = classifyAnalysisError(combinedPoErr, 'youtube')
    assert.equal(
      cCombined1.code,
      'YOUTUBE_PO_TOKEN_REQUIRED',
      'PO Token error must take priority over incidental 429 warning substrings'
    )
    console.log(
      '✓ Test 2.1 Passed: PO Token priority preserved in combined output with 429 warning.'
    )

    // 2.2 Output contains format 429 or random 429 number, but error is bot verification
    const combinedBotErr = {
      message: 'Extraction failure on port 42900',
      stderr:
        'WARNING: Format 429 not available\n' +
        'ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you’re not a bot.'
    }
    const cCombined2 = classifyAnalysisError(combinedBotErr, 'youtube')
    assert.equal(
      cCombined2.code,
      'YOUTUBE_AUTH_REQUIRED',
      'Bot verification must take priority over format 429 number'
    )
    console.log('✓ Test 2.2 Passed: Bot verification priority preserved over numeric 429.')

    // ------------------------------------------------------------------------
    // Group 3: Cooldown Isolation (Only Rate-Limit Errors Set Cooldown)
    // ------------------------------------------------------------------------
    console.log('\n--- 3. Testing Cooldown Isolation Across Failure Scenarios ---')

    let mockStderr = ''
    globalThis.__mockChildProcess = {
      execFile: (executable, args, options, callback) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        const err = new Error('yt-dlp simulated execution error')
        err.stderr = mockStderr
        if (typeof callback === 'function') {
          process.nextTick(() => callback(err, { stdout: '', stderr: mockStderr }))
        }
        return {}
      }
    }

    // 3.1 PO Token error must NOT set cooldown
    clearMediaAnalysisCache()
    mockStderr = 'ERROR: [youtube] GVS PO Token is required'
    try {
      await analyzeMedia(SAMPLE_YT_URL)
    } catch (err) {
      assert.equal(err.code, 'YOUTUBE_PO_TOKEN_REQUIRED')
    }
    assert.equal(
      getRateLimitCooldown('youtube'),
      0,
      'PO Token failure must NOT activate rate-limit cooldown'
    )
    console.log('✓ Test 3.1 Passed: PO Token error does NOT trigger cooldown.')

    // 3.2 Bot verification error must NOT set cooldown
    clearMediaAnalysisCache()
    mockStderr = 'ERROR: [youtube] Sign in to confirm you’re not a bot'
    try {
      await analyzeMedia(SAMPLE_YT_URL)
    } catch (err) {
      assert.equal(err.code, 'YOUTUBE_AUTH_REQUIRED')
    }
    assert.equal(
      getRateLimitCooldown('youtube'),
      0,
      'Auth/Bot failure must NOT activate rate-limit cooldown'
    )
    console.log('✓ Test 3.2 Passed: Bot verification error does NOT trigger cooldown.')

    // 3.3 General failure must NOT set cooldown
    clearMediaAnalysisCache()
    mockStderr = 'ERROR: [youtube] Video unavailable'
    try {
      await analyzeMedia(SAMPLE_YT_URL)
    } catch (err) {
      assert.equal(err.code, 'ANALYSIS_FAILED')
    }
    assert.equal(
      getRateLimitCooldown('youtube'),
      0,
      'General analysis failure must NOT activate rate-limit cooldown'
    )
    console.log('✓ Test 3.3 Passed: General error does NOT trigger cooldown.')

    // 3.4 Genuine HTTP 429 MUST set cooldown
    clearMediaAnalysisCache()
    mockStderr = 'ERROR: [youtube] HTTP Error 429: Too Many Requests'
    try {
      await analyzeMedia(SAMPLE_YT_URL)
    } catch (err) {
      assert.equal(err.code, 'YOUTUBE_RATE_LIMITED')
      assert.equal(err.retryAfterSeconds, 60)
    }
    const cooldownRemaining = getRateLimitCooldown('youtube')
    assert.ok(
      cooldownRemaining > 50 && cooldownRemaining <= 60,
      'Genuine 429 rate limit MUST activate a 60-second cooldown'
    )
    console.log(
      `✓ Test 3.4 Passed: HTTP Error 429 activated active cooldown (${cooldownRemaining}s remaining).`
    )

    // 3.5 Active cooldown blocks subsequent request immediately
    let cooldownIntercepted = false
    try {
      await analyzeMedia(SAMPLE_YT_URL)
    } catch (err) {
      cooldownIntercepted = true
      assert.equal(err.code, 'YOUTUBE_RATE_LIMITED')
      assert.ok(err.retryAfterSeconds > 0)
    }
    assert.equal(
      cooldownIntercepted,
      true,
      'Subsequent request while in cooldown must be intercepted before calling yt-dlp'
    )
    console.log('✓ Test 3.5 Passed: Active cooldown immediately blocks repeated calls.')

    // ------------------------------------------------------------------------
    // Group 4: Network Error Retry Behavior
    // ------------------------------------------------------------------------
    console.log('\n--- 4. Testing Network Error Controlled Retry Behavior ---')

    // 4.1 Successful retry: Attempt 1 fails with NETWORK_ERROR, Attempt 2 succeeds
    clearMediaAnalysisCache()
    let retryAttempts = 0
    globalThis.__mockChildProcess = {
      execFile: (executable, args, options, callback) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        retryAttempts++
        if (retryAttempts === 1) {
          const netErr = new Error('getaddrinfo ENOTFOUND www.youtube.com')
          netErr.stderr = ''
          process.nextTick(() => callback(netErr, { stdout: '', stderr: '' }))
        } else {
          process.nextTick(() =>
            callback(null, {
              stdout:
                '{"id":"dQw4w9WgXcQ","title":"Synthetic Retry Test Video","thumbnail":"https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg","duration":120,"formats":[{"format_id":"137","ext":"mp4","height":1080,"vcodec":"avc1.640028","acodec":"none","filesize":50000000},{"format_id":"140","ext":"m4a","vcodec":"none","acodec":"mp4a.40.2","abr":128,"filesize":3000000}]}',
              stderr: ''
            })
          )
        }
        return {}
      }
    }

    const retrySuccessResult = await analyzeMedia(SAMPLE_YT_URL)
    assert.equal(retrySuccessResult.id, 'dQw4w9WgXcQ')
    assert.equal(retryAttempts, 2, 'Successful retry must complete on exactly attempt 2')
    console.log('✓ Test 4.1 Passed: Temporary network failure retried and succeeded on attempt 2.')

    // 4.2 Retry failure: Both attempts fail with NETWORK_ERROR, stops after max attempts
    clearMediaAnalysisCache()
    retryAttempts = 0
    globalThis.__mockChildProcess = {
      execFile: (executable, args, options, callback) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        retryAttempts++
        const netErr = new Error('Connection timed out')
        netErr.stderr = 'ERROR: [youtube] Unable to connect'
        process.nextTick(() => callback(netErr, { stdout: '', stderr: netErr.stderr }))
        return {}
      }
    }

    let retryFailCaught = false
    try {
      await analyzeMedia(SAMPLE_YT_URL)
    } catch (err) {
      retryFailCaught = true
      assert.equal(err.code, 'NETWORK_ERROR')
    }
    assert.equal(retryFailCaught, true, 'Persistent network failure must throw NETWORK_ERROR')
    assert.equal(retryAttempts, 2, 'Network retry must stop after maximum 2 attempts')
    console.log(
      '✓ Test 4.2 Passed: Persistent network failure stopped after 2 attempts with NETWORK_ERROR.'
    )

    // 4.3 Non-network errors do NOT trigger network retry
    // 4.3a PO Token error
    clearMediaAnalysisCache()
    retryAttempts = 0
    globalThis.__mockChildProcess = {
      execFile: (executable, args, options, callback) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        retryAttempts++
        const poErr = new Error('PO Token required')
        poErr.stderr = 'ERROR: [youtube] GVS PO Token is required'
        process.nextTick(() => callback(poErr, { stdout: '', stderr: poErr.stderr }))
        return {}
      }
    }
    try {
      await analyzeMedia(SAMPLE_YT_URL)
    } catch (err) {
      assert.equal(err.code, 'YOUTUBE_PO_TOKEN_REQUIRED')
    }
    assert.equal(retryAttempts, 1, 'PO Token error must NOT trigger network retry')
    console.log('✓ Test 4.3a Passed: PO Token error does NOT trigger network retry (1 attempt).')

    // 4.3b Bot verification error
    clearMediaAnalysisCache()
    retryAttempts = 0
    globalThis.__mockChildProcess = {
      execFile: (executable, args, options, callback) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        retryAttempts++
        const botErr = new Error('Bot verification required')
        botErr.stderr = 'ERROR: [youtube] Sign in to confirm you’re not a bot'
        process.nextTick(() => callback(botErr, { stdout: '', stderr: botErr.stderr }))
        return {}
      }
    }
    try {
      await analyzeMedia(SAMPLE_YT_URL)
    } catch (err) {
      assert.equal(err.code, 'YOUTUBE_AUTH_REQUIRED')
    }
    assert.equal(retryAttempts, 1, 'Bot verification error must NOT trigger network retry')
    console.log(
      '✓ Test 4.3b Passed: Bot verification error does NOT trigger network retry (1 attempt).'
    )

    // 4.3c HTTP 429 Rate Limit error
    clearMediaAnalysisCache()
    retryAttempts = 0
    globalThis.__mockChildProcess = {
      execFile: (executable, args, options, callback) => {
        if (typeof options === 'function') {
          callback = options
          options = {}
        }
        retryAttempts++
        const rlErr = new Error('HTTP 429')
        rlErr.stderr = 'ERROR: [youtube] HTTP Error 429: Too Many Requests'
        process.nextTick(() => callback(rlErr, { stdout: '', stderr: rlErr.stderr }))
        return {}
      }
    }
    try {
      await analyzeMedia(SAMPLE_YT_URL)
    } catch (err) {
      assert.equal(err.code, 'YOUTUBE_RATE_LIMITED')
    }
    assert.equal(retryAttempts, 1, 'HTTP 429 must NOT trigger network retry')
    console.log('✓ Test 4.3c Passed: HTTP 429 error does NOT trigger network retry (1 attempt).')

    // ------------------------------------------------------------------------
    // Group 5: Thumbnail Validation Verification (Task 02 / Task 03 C)
    // ------------------------------------------------------------------------
    console.log('\n--- 5. Testing Thumbnail Validation & Trailing-Dot Hostnames ---')

    // 5.1 Localhost with trailing dot is rejected
    assert.equal(
      isSafeThumbnailUrl('http://localhost./image.png'),
      false,
      '5.1a: localhost. rejected'
    )
    assert.equal(
      isSafeThumbnailUrl('https://localhost./image.jpg'),
      false,
      '5.1b: https localhost. rejected'
    )
    assert.equal(
      isSafeThumbnailUrl('http://localhost:8080./img.png'),
      false,
      '5.1c: localhost:8080. rejected'
    )

    // 5.2 Subdomains of localhost with trailing dot are rejected
    assert.equal(
      isSafeThumbnailUrl('http://sub.localhost./image.png'),
      false,
      '5.2a: sub.localhost. rejected'
    )
    assert.equal(
      isSafeThumbnailUrl('http://test.sub.localhost./image.png'),
      false,
      '5.2b: test.sub.localhost. rejected'
    )
    assert.equal(
      isSafeThumbnailUrl('http://sub.localhost/image.png'),
      false,
      '5.2c: sub.localhost rejected'
    )

    // 5.3 Normal public domains with trailing dot remain allowed
    assert.equal(
      isSafeThumbnailUrl('https://example.com./image.png'),
      true,
      '5.3a: example.com. allowed'
    )
    assert.equal(
      isSafeThumbnailUrl('https://i.ytimg.com./vi/dQw4w9WgXcQ/hqdefault.jpg'),
      true,
      '5.3b: i.ytimg.com. allowed'
    )
    assert.equal(
      isSafeThumbnailUrl('https://example.com/image.png'),
      true,
      '5.3c: normal example.com allowed'
    )
    assert.equal(
      isSafeThumbnailUrl('http://example.org/thumb.jpg'),
      true,
      '5.3d: normal example.org allowed'
    )

    // 5.4 Existing private IP and IPv6 protections still work
    assert.equal(
      isSafeThumbnailUrl('http://127.0.0.1/image.png'),
      false,
      '5.4a: loopback IPv4 rejected'
    )
    assert.equal(
      isSafeThumbnailUrl('http://127.0.0.1./image.png'),
      false,
      '5.4b: loopback IPv4 with dot rejected'
    )
    assert.equal(
      isSafeThumbnailUrl('http://192.168.1.1/image.png'),
      false,
      '5.4c: private IPv4 192.168 rejected'
    )
    assert.equal(
      isSafeThumbnailUrl('http://10.0.0.1/image.png'),
      false,
      '5.4d: private IPv4 10.x rejected'
    )
    assert.equal(
      isSafeThumbnailUrl('http://172.16.0.1/image.png'),
      false,
      '5.4e: private IPv4 172.16 rejected'
    )
    assert.equal(
      isSafeThumbnailUrl('http://[::1]/image.png'),
      false,
      '5.4f: loopback IPv6 rejected'
    )
    assert.equal(
      isSafeThumbnailUrl('http://[fe80::1]/image.png'),
      false,
      '5.4g: link-local IPv6 rejected'
    )
    assert.equal(
      isSafeThumbnailUrl('javascript:alert(1)'),
      false,
      '5.4h: javascript: scheme rejected'
    )
    assert.equal(isSafeThumbnailUrl('file:///C:/test.png'), false, '5.4i: file: scheme rejected')
    assert.equal(
      isSafeThumbnailUrl('data:image/png;base64,123'),
      false,
      '5.4j: data: scheme rejected'
    )
    assert.equal(
      isSafeThumbnailUrl('http://admin:pass@example.com/img.png'),
      false,
      '5.4k: credentials rejected'
    )

    console.log('✓ Test 5.1 Passed: Localhost with trailing dot is strictly rejected.')
    console.log('✓ Test 5.2 Passed: Subdomains of localhost with trailing dot are rejected.')
    console.log('✓ Test 5.3 Passed: Normal public domains with trailing dot remain allowed.')
    console.log(
      '✓ Test 5.4 Passed: Private IPv4, IPv6, loopback, and dangerous schemes remain blocked.'
    )

    console.log('\n================================================================')
    console.log(' ALL STEP 02 ERROR CLASSIFICATION & RETRY TESTS PASSED (100%)')
    console.log('================================================================\n')
  } finally {
    clearMediaAnalysisCache()
    delete globalThis.__mockChildProcess
  }
}

runErrorClassificationTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Step 02 Error Classification Test Failure:', err)
    process.exit(1)
  })
