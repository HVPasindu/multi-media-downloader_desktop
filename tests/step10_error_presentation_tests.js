import assert from 'node:assert/strict'
import {
  extractErrorCode,
  extractCleanMessage,
  getFriendlyErrorInfo,
  ERROR_PRESENTATION_MAP
} from '../src/renderer/src/utils/errorPresentation.js'
import {
  seedKnownFailures,
  notifyLiveJobFailure,
  showSuccess,
  showError,
  showWarning,
  showConfirm,
  showToast
} from '../src/renderer/src/utils/notificationService.js'

async function runStep10Tests() {
  console.log('================================================================')
  console.log(' APPLAN2 — Step 10: Error Classification & Notifications Test')
  console.log('================================================================\n')

  // 1. Error Code Extraction
  console.log('--- 1. Testing Error Code Extraction ---')
  assert.equal(extractErrorCode('[NETWORK_ERROR] Network failed'), 'NETWORK_ERROR')
  assert.equal(extractErrorCode('[YOUTUBE_RATE_LIMITED] HTTP 429'), 'YOUTUBE_RATE_LIMITED')
  assert.equal(extractErrorCode('[DISK_FULL] Disk out of space'), 'DISK_FULL')
  assert.equal(extractErrorCode('No bracket code present'), null)
  assert.equal(extractErrorCode(null), null)
  assert.equal(extractErrorCode(undefined), null)
  assert.equal(
    extractCleanMessage('[NETWORK_ERROR] Network connection failed.'),
    'Network connection failed.'
  )
  console.log('✓ Test 1: extractErrorCode and extractCleanMessage pass')

  // 2. Required Error Mappings (Section 10.2 Table)
  console.log('--- 2. Testing Required Error Code Mappings ---')
  const requiredCodes = [
    {
      code: 'YOUTUBE_RATE_LIMITED',
      title: 'YouTube Rate Limited',
      guidance: 'Wait before retrying'
    },
    { code: 'RATE_LIMITED', title: 'Too Many Requests', guidance: 'Try again later' },
    {
      code: 'YOUTUBE_AUTH_REQUIRED',
      title: 'Authentication Required',
      guidance: 'Check access or verification'
    },
    { code: 'AUTH_REQUIRED', title: 'Login Required', guidance: 'Media requires authentication' },
    {
      code: 'YOUTUBE_PO_TOKEN_REQUIRED',
      title: 'YouTube PO Token Required',
      guidance: 'Additional verification data is required'
    },
    {
      code: 'NETWORK_ERROR',
      title: 'Network Connection Error',
      guidance: 'Check internet connection'
    },
    { code: 'NETWORK_TIMEOUT', title: 'Connection Timeout', guidance: 'Retry the operation' },
    { code: 'INVALID_URL', title: 'Invalid Media URL', guidance: 'Enter a supported link' },
    {
      code: 'UNSUPPORTED_PLATFORM',
      title: 'Unsupported Platform',
      guidance: 'Use a supported media platform'
    },
    {
      code: 'MEDIA_UNAVAILABLE',
      title: 'Media Unavailable',
      guidance: 'Check whether the media still exists'
    },
    {
      code: 'SOURCE_ACCESS_DENIED',
      title: 'Access Denied',
      guidance: 'Check privacy and access permissions'
    },
    {
      code: 'FORMAT_UNAVAILABLE',
      title: 'Quality Unavailable',
      guidance: 'Select an available quality'
    },
    { code: 'DISK_FULL', title: 'Storage Full', guidance: 'Free up disk space' },
    {
      code: 'PERMISSION_DENIED',
      title: 'Permission Denied',
      guidance: 'Check destination folder permissions'
    },
    {
      code: 'FFPROBE_FAILED',
      title: 'File Verification Failed',
      guidance: 'Retry verification/download as appropriate'
    },
    { code: 'FFMPEG_FAILED', title: 'Media Processing Failed', guidance: 'Retry the download' },
    {
      code: 'UNKNOWN_ERROR',
      title: 'Download Failed',
      guidance: 'Retry or check the error details'
    }
  ]

  for (const item of requiredCodes) {
    const mapped = ERROR_PRESENTATION_MAP[item.code]
    assert.ok(mapped, `Missing mapping for ${item.code}`)
    assert.equal(mapped.title, item.title, `Title mismatch for ${item.code}`)
    assert.equal(mapped.guidance, item.guidance, `Guidance mismatch for ${item.code}`)

    // Test getFriendlyErrorInfo with bracket string
    const infoFromString = getFriendlyErrorInfo(`[${item.code}] Something failed`)
    assert.equal(infoFromString.code, item.code)
    assert.equal(infoFromString.title, item.title)
    assert.equal(infoFromString.guidance, item.guidance)

    // Test getFriendlyErrorInfo with object
    const infoFromObj = getFriendlyErrorInfo({ code: item.code, message: 'Custom msg' })
    assert.equal(infoFromObj.code, item.code)
    assert.equal(infoFromObj.title, item.title)
  }
  console.log(`✓ Test 2: All ${requiredCodes.length} required error codes verified`)

  // 3. Fallback for Unknown Errors
  console.log('--- 3. Testing Unknown Error Fallback ---')
  const unknownInfo = getFriendlyErrorInfo('Some arbitrary non-bracketed error')
  assert.equal(unknownInfo.code, 'UNKNOWN_ERROR')
  assert.equal(unknownInfo.title, 'Download Failed')
  assert.equal(unknownInfo.message, 'Some arbitrary non-bracketed error')
  console.log('✓ Test 3: Unknown error fallback verified')

  // 4. Notification Service Verification
  console.log('--- 4. Testing Notification Service Exports & Deduplication ---')
  assert.equal(typeof showSuccess, 'function')
  assert.equal(typeof showError, 'function')
  assert.equal(typeof showWarning, 'function')
  assert.equal(typeof showConfirm, 'function')
  assert.equal(typeof showToast, 'function')

  // Deduplication: Pre-seeded failures should not trigger popups
  seedKnownFailures([101, 102])
  // notifyLiveJobFailure for pre-seeded ID 101 should return undefined without firing Swal
  const suppressedResult = notifyLiveJobFailure(101, { title: 'Failed', message: 'Pre-seeded' })
  assert.equal(suppressedResult, undefined, 'Pre-seeded failed job must not trigger notification')

  console.log('✓ Test 4: Notification deduplication verified')

  console.log('\n================================================================')
  console.log(' APPLAN2 — Step 10 Tests 100% PASSED')
  console.log('================================================================\n')
}

runStep10Tests().catch((err) => {
  console.error('Test execution failed:', err)
  process.exit(1)
})
