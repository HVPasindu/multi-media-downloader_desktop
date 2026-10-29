import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { Sequelize } from 'sequelize'
import { detectPlatform } from '../src/main/backend/providers/providerManager.js'
import {
  DownloadError,
  DOWNLOAD_ERROR_CODES,
  classifyDownloadError,
  formatDownloadErrorMessage
} from '../src/main/backend/services/downloadErrorService.js'
import {
  buildYtDlpArgs,
  SUPPORTED_MP3_BITRATES
} from '../src/main/backend/services/downloadService.js'
import { parseMediaMetadata } from '../src/main/backend/services/mediaAnalyzerService.js'
import defineMediaItem from '../src/main/backend/models/MediaItem.js'
import defineDownloadJob from '../src/main/backend/models/DownloadJob.js'
import defineDownloadFile from '../src/main/backend/models/DownloadFile.js'
import defineAppSetting from '../src/main/backend/models/AppSetting.js'

/**
 * ============================================================================
 * SYNTHETIC TEST FIXTURES (Legitimate yt-dlp JSON responses for 5 platforms)
 * NOTE: These fixtures are synthetic test data used to verify metadata parsing,
 * stream selection, and format compatibility without making external network calls.
 * ============================================================================
 */

// 1. YouTube synthetic fixture: separate adaptive video-only and audio-only streams
const YOUTUBE_SYNTHETIC_FIXTURE = Object.freeze({
  id: 'dQw4w9WgXcQ',
  title: 'Test YouTube Media Title',
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
      format_id: '135',
      ext: 'mp4',
      height: 480,
      vcodec: 'avc1.4d401e',
      acodec: 'none',
      filesize: 15000000
    },
    {
      format_id: '134',
      ext: 'mp4',
      height: 360,
      vcodec: 'avc1.4d4015',
      acodec: 'none',
      filesize: 8000000
    },
    {
      format_id: '140',
      ext: 'm4a',
      height: null,
      vcodec: 'none',
      acodec: 'mp4a.40.2',
      filesize: 3500000
    },
    {
      format_id: '251',
      ext: 'webm',
      height: null,
      vcodec: 'none',
      acodec: 'opus',
      filesize: 3200000
    },
    {
      format_id: '18',
      ext: 'mp4',
      height: 360,
      vcodec: 'avc1.42001E',
      acodec: 'mp4a.40.2',
      filesize: 12000000
    }
  ]
})

// 2. Facebook synthetic fixture: combined SD/HD formats and DASH video
const FACEBOOK_SYNTHETIC_FIXTURE = Object.freeze({
  id: '123456789012345',
  title: 'Test Facebook Public Video',
  thumbnail: 'https://scontent.xx.fbcdn.net/v/test.jpg',
  duration: 95,
  formats: [
    { format_id: 'hd', ext: 'mp4', height: 720, vcodec: 'h264', acodec: 'aac', filesize: 18000000 },
    { format_id: 'sd', ext: 'mp4', height: 360, vcodec: 'h264', acodec: 'aac', filesize: 8000000 }
  ]
})

// 3. Instagram synthetic fixture: pre-muxed combined MP4 Reel format
const INSTAGRAM_SYNTHETIC_FIXTURE = Object.freeze({
  id: 'C1234567890',
  title: 'Test Instagram Public Reel',
  thumbnail: 'https://instagram.xx.fbcdn.net/v/test.jpg',
  duration: 30,
  formats: [
    { format_id: '0', ext: 'mp4', height: 1080, vcodec: 'h264', acodec: 'aac', filesize: 12000000 }
  ]
})

// 4. TikTok synthetic fixture: pre-muxed vertical MP4 video with audio
const TIKTOK_SYNTHETIC_FIXTURE = Object.freeze({
  id: '7123456789012345678',
  title: 'Test TikTok Creator Video',
  thumbnail: 'https://p16-sign-va.tiktokcdn.com/tos-maliva-p-0068/test.jpg',
  duration: 15,
  formats: [
    {
      format_id: 'download',
      ext: 'mp4',
      height: 720,
      vcodec: 'h264',
      acodec: 'aac',
      filesize: 6000000
    }
  ]
})

// 5. X (Twitter) synthetic fixture: multi-bitrate combined MP4 streams
const TWITTER_SYNTHETIC_FIXTURE = Object.freeze({
  id: '1234567890123456789',
  title: 'Test X / Twitter Public Media Post',
  thumbnail: 'https://pbs.twimg.com/media/test.jpg',
  duration: 45,
  formats: [
    {
      format_id: 'http-720',
      ext: 'mp4',
      height: 720,
      vcodec: 'h264',
      acodec: 'aac',
      filesize: 9000000
    },
    {
      format_id: 'http-480',
      ext: 'mp4',
      height: 480,
      vcodec: 'h264',
      acodec: 'aac',
      filesize: 5000000
    },
    {
      format_id: 'http-270',
      ext: 'mp4',
      height: 270,
      vcodec: 'h264',
      acodec: 'aac',
      filesize: 2500000
    }
  ]
})

// 6. Silent video fixture (acodec === 'none'): no audio stream available
const SILENT_SYNTHETIC_FIXTURE = Object.freeze({
  id: 'silent12345',
  title: 'Silent Animated Video Clip',
  thumbnail: null,
  duration: 8,
  formats: [
    {
      format_id: 'vid-360',
      ext: 'mp4',
      height: 360,
      vcodec: 'h264',
      acodec: 'none',
      filesize: 2000000
    }
  ]
})

/**
 * Direct reference to production parseMediaMetadata in mediaAnalyzerService.js.
 * Eliminates duplicate testing logic by testing the real production parser.
 */
const parseSyntheticMetadata = parseMediaMetadata

/**
 * Stream selector simulation corresponding to prepareDownloadJobExecution in downloadService.js.
 */
function resolveMp4FormatSelector(availableFormats, requestedQuality) {
  const mp4Formats = Array.isArray(availableFormats?.mp4Formats) ? availableFormats.mp4Formats : []
  const audioFormats = Array.isArray(availableFormats?.audioFormats)
    ? availableFormats.audioFormats
    : []

  const hasFormatId = (format) =>
    typeof format?.formatId === 'string' && format.formatId.trim().length > 0

  const matchingVideos = mp4Formats.filter(
    (format) => format?.quality === requestedQuality && hasFormatId(format)
  )

  // 1. Prefer video-only MP4 with separate M4A audio
  const videoOnly = [...matchingVideos].reverse().find((format) => format.audioIncluded === false)
  const m4aAudio = [...audioFormats]
    .reverse()
    .find((format) => format?.extension === 'm4a' && hasFormatId(format))

  // 2. Otherwise use a combined MP4 stream containing audio
  const combinedVideo = [...matchingVideos]
    .reverse()
    .find((format) => format.audioIncluded === true)

  if (videoOnly && m4aAudio) {
    return { selector: `${videoOnly.formatId}+${m4aAudio.formatId}`, type: 'separate_merge' }
  } else if (combinedVideo) {
    return { selector: combinedVideo.formatId, type: 'combined_stream' }
  }

  const qualityExists = mp4Formats.some((format) => format?.quality === requestedQuality)
  if (!qualityExists) {
    const qualityList = availableFormats.mp4Qualities?.length
      ? availableFormats.mp4Qualities.join(', ')
      : 'None available'
    throw new DownloadError(
      DOWNLOAD_ERROR_CODES.FORMAT_UNAVAILABLE,
      `Unsupported MP4 quality "${requestedQuality}". Available MP4 qualities: ${qualityList}`
    )
  }

  throw new DownloadError(
    DOWNLOAD_ERROR_CODES.FORMAT_UNAVAILABLE,
    `No compatible MP4 video/audio format found for quality "${requestedQuality}"`
  )
}

/**
 * ============================================================================
 * MAIN TEST SUITE: Step 04.39 Supported Platform Download Tests
 * ============================================================================
 */
async function runPlatformDownloadTests() {
  console.log('================================================================')
  console.log(' APPLAN2 — Step 04.39 Supported Platform Download Tests')
  console.log('================================================================\n')

  const testTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'applan2-platform-test-'))
  console.log(`[setup] Isolated test workspace created: ${testTempDir}`)

  try {
    // ------------------------------------------------------------------------
    // TEST 1: URL Recognition for All 5 Supported Platforms
    // ------------------------------------------------------------------------
    console.log('\n--- 1. Testing URL Recognition (5 Platforms) ---')

    const platformUrlCases = [
      // YouTube
      {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        expected: 'youtube',
        label: 'YouTube Standard URL'
      },
      {
        url: 'https://youtu.be/dQw4w9WgXcQ',
        expected: 'youtube',
        label: 'YouTube youtu.be Short URL'
      },
      {
        url: 'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
        expected: 'youtube',
        label: 'YouTube Mobile Subdomain'
      },
      {
        url: 'https://youtube.com/shorts/abcdef12345',
        expected: 'youtube',
        label: 'YouTube Shorts URL'
      },

      // Facebook
      {
        url: 'https://www.facebook.com/watch/?v=123456789012345',
        expected: 'facebook',
        label: 'Facebook Standard Watch URL'
      },
      {
        url: 'https://facebook.com/reel/1234567890',
        expected: 'facebook',
        label: 'Facebook Reel URL'
      },
      {
        url: 'https://fb.watch/abcdef123/',
        expected: 'facebook',
        label: 'Facebook fb.watch Short URL'
      },
      {
        url: 'https://m.facebook.com/story.php?story_fbid=123',
        expected: 'facebook',
        label: 'Facebook Mobile Subdomain'
      },

      // Instagram
      {
        url: 'https://www.instagram.com/p/C1234567890/',
        expected: 'instagram',
        label: 'Instagram Post URL'
      },
      {
        url: 'https://instagram.com/reel/C1234567890/',
        expected: 'instagram',
        label: 'Instagram Reel URL'
      },
      {
        url: 'https://www.instagram.com/tv/C1234567890/',
        expected: 'instagram',
        label: 'Instagram IGTV URL'
      },

      // TikTok
      {
        url: 'https://www.tiktok.com/@creator/video/7123456789012345678',
        expected: 'tiktok',
        label: 'TikTok Creator Video URL'
      },
      {
        url: 'https://tiktok.com/@creator/video/7123456789012345678',
        expected: 'tiktok',
        label: 'TikTok Apex Domain URL'
      },
      {
        url: 'https://m.tiktok.com/v/7123456789012345678.html',
        expected: 'tiktok',
        label: 'TikTok Mobile Subdomain URL'
      },

      // X / Twitter (internal identifier remains 'twitter')
      {
        url: 'https://twitter.com/user/status/1234567890123456789',
        expected: 'twitter',
        label: 'Twitter Standard Tweet URL'
      },
      {
        url: 'https://www.twitter.com/user/status/1234567890123456789',
        expected: 'twitter',
        label: 'Twitter www Subdomain URL'
      },
      {
        url: 'https://x.com/user/status/1234567890123456789',
        expected: 'twitter',
        label: 'X.com Standard Post URL'
      },
      {
        url: 'https://www.x.com/user/status/1234567890123456789',
        expected: 'twitter',
        label: 'X.com www Subdomain URL'
      },

      // Case-insensitivity tests
      {
        url: 'HTTPS://WWW.YOUTUBE.COM/WATCH?V=XYZ',
        expected: 'youtube',
        label: 'YouTube Uppercase Protocol & Domain'
      },
      { url: 'https://X.COM/status/123', expected: 'twitter', label: 'X.com Uppercase Hostname' },

      // Non-matching / negative tests
      {
        url: 'https://notyoutube.com/video',
        expected: null,
        label: 'Unrelated domain containing "youtube"'
      },
      {
        url: 'https://fakefacebook.com/watch',
        expected: null,
        label: 'Unrelated domain containing "facebook"'
      },
      {
        url: 'https://faketiktok.com/video',
        expected: null,
        label: 'Unrelated domain containing "tiktok"'
      },
      { url: 'https://myx.com/post', expected: null, label: 'Unrelated domain containing "x.com"' },
      { url: 'ftp://youtube.com/video', expected: null, label: 'Disallowed FTP protocol' },
      { url: 'invalid-url-string', expected: null, label: 'Non-URL string' },
      { url: '', expected: null, label: 'Empty URL' }
    ]

    for (const testCase of platformUrlCases) {
      const detected = detectPlatform(testCase.url)
      assert.strictEqual(
        detected,
        testCase.expected,
        `URL recognition failed for ${testCase.label} (${testCase.url}): expected ${testCase.expected}, got ${detected}`
      )
    }
    console.log(
      `✓ All ${platformUrlCases.length} platform URL recognition cases passed (YouTube, Facebook, Instagram, TikTok, X/Twitter)`
    )

    // ------------------------------------------------------------------------
    // TEST 2: Metadata Extraction & Format Processing (5 Synthetic Fixtures)
    // ------------------------------------------------------------------------
    console.log('\n--- 2. Testing Metadata Extraction & Format Processing ---')

    // Platform 1: YouTube (Adaptive separate video + separate audio)
    const ytAnalysis = parseSyntheticMetadata(
      YOUTUBE_SYNTHETIC_FIXTURE,
      'youtube',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    )
    assert.strictEqual(ytAnalysis.id, 'dQw4w9WgXcQ')
    assert.strictEqual(ytAnalysis.platform, 'youtube')
    assert.strictEqual(ytAnalysis.title, 'Test YouTube Media Title')
    assert.strictEqual(ytAnalysis.durationSeconds, 212)
    assert.deepStrictEqual(ytAnalysis.videoQualities, ['1080p', '720p', '480p', '360p'])
    assert.deepStrictEqual(ytAnalysis.audioOptions, ['mp3'], 'YouTube should support MP3')
    assert.ok(ytAnalysis.availableFormats.audioFormats.some((a) => a.extension === 'm4a'))
    console.log(
      '✓ YouTube synthetic fixture: 1080p-360p video qualities and MP3 option parsed correctly'
    )

    // Platform 2: Facebook (Combined SD/HD formats)
    const fbAnalysis = parseSyntheticMetadata(
      FACEBOOK_SYNTHETIC_FIXTURE,
      'facebook',
      'https://www.facebook.com/watch/?v=123456789012345'
    )
    assert.strictEqual(fbAnalysis.id, '123456789012345')
    assert.strictEqual(fbAnalysis.platform, 'facebook')
    assert.deepStrictEqual(fbAnalysis.videoQualities, ['720p', '360p'])
    assert.deepStrictEqual(
      fbAnalysis.audioOptions,
      ['mp3'],
      'Facebook combined stream should support MP3'
    )
    assert.deepStrictEqual(fbAnalysis.availableFormats.mp4Qualities, ['720p', '360p'])
    console.log('✓ Facebook synthetic fixture: 720p/360p qualities and MP3 option parsed correctly')

    // Platform 3: Instagram (Combined Reel format)
    const igAnalysis = parseSyntheticMetadata(
      INSTAGRAM_SYNTHETIC_FIXTURE,
      'instagram',
      'https://www.instagram.com/reel/C1234567890/'
    )
    assert.strictEqual(igAnalysis.id, 'C1234567890')
    assert.strictEqual(igAnalysis.platform, 'instagram')
    assert.deepStrictEqual(igAnalysis.videoQualities, ['1080p'])
    assert.deepStrictEqual(
      igAnalysis.audioOptions,
      ['mp3'],
      'Instagram combined Reel should support MP3'
    )
    assert.strictEqual(igAnalysis.availableFormats.mp4Formats[0].audioIncluded, true)
    console.log('✓ Instagram synthetic fixture: 1080p Reel quality and MP3 option parsed correctly')

    // Platform 4: TikTok (Combined vertical video format)
    const ttAnalysis = parseSyntheticMetadata(
      TIKTOK_SYNTHETIC_FIXTURE,
      'tiktok',
      'https://www.tiktok.com/@creator/video/7123456789012345678'
    )
    assert.strictEqual(ttAnalysis.id, '7123456789012345678')
    assert.strictEqual(ttAnalysis.platform, 'tiktok')
    assert.deepStrictEqual(ttAnalysis.videoQualities, ['720p'])
    assert.deepStrictEqual(
      ttAnalysis.audioOptions,
      ['mp3'],
      'TikTok combined video should support MP3'
    )
    assert.strictEqual(ttAnalysis.availableFormats.mp4Formats[0].audioIncluded, true)
    console.log('✓ TikTok synthetic fixture: 720p video quality and MP3 option parsed correctly')

    // Platform 5: X / Twitter (Multi-bitrate combined video formats)
    const xAnalysis = parseSyntheticMetadata(
      TWITTER_SYNTHETIC_FIXTURE,
      'twitter',
      'https://x.com/user/status/1234567890123456789'
    )
    assert.strictEqual(xAnalysis.id, '1234567890123456789')
    assert.strictEqual(xAnalysis.platform, 'twitter')
    assert.deepStrictEqual(xAnalysis.videoQualities, ['720p', '480p', '270p'])
    assert.deepStrictEqual(
      xAnalysis.audioOptions,
      ['mp3'],
      'X/Twitter multi-stream should support MP3'
    )
    assert.deepStrictEqual(xAnalysis.availableFormats.mp4Qualities, ['720p', '480p', '270p'])
    console.log(
      '✓ X (Twitter) synthetic fixture: 720p/480p/270p qualities and MP3 option parsed correctly'
    )

    // Edge Case: Silent Video Fixture (no audio track available)
    const silentAnalysis = parseSyntheticMetadata(
      SILENT_SYNTHETIC_FIXTURE,
      'twitter',
      'https://x.com/user/status/silent12345'
    )
    assert.deepStrictEqual(silentAnalysis.videoQualities, ['360p'])
    assert.deepStrictEqual(silentAnalysis.audioOptions, [], 'Silent video MUST NOT offer MP3')
    console.log('✓ Silent video fixture: MP3 option correctly withheld when audio stream is absent')

    // Edge Case: Malformed metadata handling
    assert.throws(
      () => parseSyntheticMetadata(null, 'youtube', 'https://youtube.com/watch?v=1'),
      /Media metadata is missing required details/
    )
    assert.throws(
      () =>
        parseSyntheticMetadata(
          { id: '', title: 'Title' },
          'youtube',
          'https://youtube.com/watch?v=1'
        ),
      /Media metadata is missing required details/
    )
    assert.throws(
      () =>
        parseSyntheticMetadata(
          { id: '1', title: 'Title', formats: 'invalid' },
          'youtube',
          'https://youtube.com/watch?v=1'
        ),
      /Media metadata contains an invalid formats list/
    )
    console.log('✓ Malformed metadata strictly rejected with descriptive error')

    // ------------------------------------------------------------------------
    // TEST 3: MP4 Compatibility & Stream Selector Resolution
    // ------------------------------------------------------------------------
    console.log('\n--- 3. Testing MP4 Format Selector Resolution ---')

    // 1. YouTube 1080p: should resolve to separate video + separate m4a audio (137+140)
    const ytSelector1080 = resolveMp4FormatSelector(ytAnalysis.availableFormats, '1080p')
    assert.strictEqual(ytSelector1080.selector, '137+140')
    assert.strictEqual(ytSelector1080.type, 'separate_merge')

    // YouTube 720p: should resolve to 136+140
    const ytSelector720 = resolveMp4FormatSelector(ytAnalysis.availableFormats, '720p')
    assert.strictEqual(ytSelector720.selector, '136+140')
    assert.strictEqual(ytSelector720.type, 'separate_merge')
    console.log(
      '✓ YouTube MP4 selector: correctly selects separate video + m4a stream (137+140, 136+140)'
    )

    // 2. Facebook 720p: should resolve to combined format 'hd'
    const fbSelector720 = resolveMp4FormatSelector(fbAnalysis.availableFormats, '720p')
    assert.strictEqual(fbSelector720.selector, 'hd')
    assert.strictEqual(fbSelector720.type, 'combined_stream')
    console.log('✓ Facebook MP4 selector: correctly selects combined video format "hd"')

    // 3. Instagram 1080p: should resolve to combined format '0'
    const igSelector1080 = resolveMp4FormatSelector(igAnalysis.availableFormats, '1080p')
    assert.strictEqual(igSelector1080.selector, '0')
    assert.strictEqual(igSelector1080.type, 'combined_stream')
    console.log('✓ Instagram MP4 selector: correctly selects combined Reel format "0"')

    // 4. TikTok 720p: should resolve to combined format 'download'
    const ttSelector720 = resolveMp4FormatSelector(ttAnalysis.availableFormats, '720p')
    assert.strictEqual(ttSelector720.selector, 'download')
    assert.strictEqual(ttSelector720.type, 'combined_stream')
    console.log('✓ TikTok MP4 selector: correctly selects combined video format "download"')

    // 5. X / Twitter 720p and 480p: should resolve to respective combined format IDs
    const xSelector720 = resolveMp4FormatSelector(xAnalysis.availableFormats, '720p')
    assert.strictEqual(xSelector720.selector, 'http-720')
    assert.strictEqual(xSelector720.type, 'combined_stream')

    const xSelector480 = resolveMp4FormatSelector(xAnalysis.availableFormats, '480p')
    assert.strictEqual(xSelector480.selector, 'http-480')
    assert.strictEqual(xSelector480.type, 'combined_stream')
    console.log('✓ X (Twitter) MP4 selector: correctly selects distinct formats for 720p and 480p')

    // Unsupported quality rejection (e.g. asking for 1080p on TikTok which only has 720p)
    let unsupportedQualityCaught = false
    try {
      resolveMp4FormatSelector(ttAnalysis.availableFormats, '1080p')
    } catch (err) {
      unsupportedQualityCaught = true
      assert.strictEqual(err.code, DOWNLOAD_ERROR_CODES.FORMAT_UNAVAILABLE)
      assert.ok(err.message.includes('Available MP4 qualities: 720p'))
    }
    assert.strictEqual(
      unsupportedQualityCaught,
      true,
      'Unsupported quality strictly rejected with available list'
    )
    console.log('✓ Unsupported quality correctly rejected with FORMAT_UNAVAILABLE error')

    // ------------------------------------------------------------------------
    // TEST 4: MP3 Compatibility & yt-dlp Argument Generation
    // ------------------------------------------------------------------------
    console.log('\n--- 4. Testing MP3 Compatibility & Arguments ---')

    for (const bitrate of SUPPORTED_MP3_BITRATES) {
      const mp3Args = buildYtDlpArgs({
        sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        outputFormat: 'mp3',
        audioBitrateKbps: bitrate,
        downloadPath: testTempDir,
        jobId: 10
      })

      // Must include audio extraction and exact bitrate flags
      assert.ok(mp3Args.includes('-x'), 'MP3 args must include -x for extraction')
      assert.ok(mp3Args.includes('--audio-format'), 'MP3 args must include --audio-format')
      assert.ok(mp3Args.includes('mp3'), 'Audio format must be mp3')
      assert.ok(mp3Args.includes('--audio-quality'), 'MP3 args must include --audio-quality')
      assert.ok(mp3Args.includes(`${bitrate}K`), `Audio quality must match ${bitrate}K`)
    }
    console.log(
      '✓ All supported MP3 bitrates (128, 192, 320 kbps) generate correct yt-dlp conversion arguments'
    )

    // Verify invalid MP3 bitrate is rejected
    assert.throws(() => {
      buildYtDlpArgs({
        sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        outputFormat: 'mp3',
        audioBitrateKbps: 256, // Not in [128, 192, 320]
        downloadPath: testTempDir,
        jobId: 11
      })
    }, /A valid audio bitrate is required/)
    console.log('✓ Unsupported MP3 bitrate (256 kbps) strictly rejected')

    // ------------------------------------------------------------------------
    // TEST 5: Platform-Specific Failure Classification Across All 5 Platforms
    // ------------------------------------------------------------------------
    console.log('\n--- 5. Testing Platform Failure Classification ---')

    const errorClassificationCases = [
      // YouTube: Age-restricted or Sign in required
      {
        error: new Error(
          'ERROR: Sign in to confirm your age. This video may be inappropriate for some users.'
        ),
        expectedCode: DOWNLOAD_ERROR_CODES.SOURCE_ACCESS_DENIED,
        label: 'YouTube age-restricted / login required'
      },
      // YouTube: Private video
      {
        error: new Error(
          "ERROR: [youtube] dQw4w9WgXcQ: Private video. Sign in if you've been granted access to this video"
        ),
        expectedCode: DOWNLOAD_ERROR_CODES.SOURCE_ACCESS_DENIED,
        label: 'YouTube private video'
      },
      // Facebook: Content not available or removed
      {
        error: new Error('ERROR: [facebook] 12345: This video is unavailable or has been removed.'),
        expectedCode: DOWNLOAD_ERROR_CODES.MEDIA_UNAVAILABLE,
        label: 'Facebook video unavailable / removed'
      },
      // Instagram: Login required / Private account
      {
        error: new Error('ERROR: [instagram] Login required to view this post.'),
        expectedCode: DOWNLOAD_ERROR_CODES.SOURCE_ACCESS_DENIED,
        label: 'Instagram login required / private account'
      },
      // TikTok: Content is not available / HTTP 404
      {
        error: new Error(
          'ERROR: [tiktok] 7123456789: Video not found or HTTP Error 404: Not Found'
        ),
        expectedCode: DOWNLOAD_ERROR_CODES.MEDIA_UNAVAILABLE,
        label: 'TikTok video not found / 404'
      },
      // X / Twitter: Post unavailable or rate-limited
      {
        error: new Error('ERROR: [twitter] HTTP Error 429: Too Many Requests'),
        expectedCode: DOWNLOAD_ERROR_CODES.RATE_LIMITED,
        label: 'X/Twitter rate limited (HTTP 429)'
      },
      {
        error: new Error(
          'ERROR: [twitter] 12345: This Tweet has been deleted or is not available.'
        ),
        expectedCode: DOWNLOAD_ERROR_CODES.MEDIA_UNAVAILABLE,
        label: 'X/Twitter tweet deleted / unavailable'
      },
      // Network timeout across any platform
      {
        error: new Error('socket.timeout: The read operation timed out'),
        expectedCode: DOWNLOAD_ERROR_CODES.NETWORK_TIMEOUT,
        label: 'Network read timeout'
      },
      // Network unreachable / DNS failure
      {
        error: new Error(
          'ERROR: [youtube] Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>'
        ),
        expectedCode: DOWNLOAD_ERROR_CODES.NETWORK_ERROR,
        label: 'Network DNS failure (getaddrinfo)'
      }
    ]

    for (const testCase of errorClassificationCases) {
      const classified = classifyDownloadError(testCase.error, { target: 'yt-dlp' })
      assert.strictEqual(
        classified.code,
        testCase.expectedCode,
        `Classification failed for ${testCase.label}: expected ${testCase.expectedCode}, got ${classified.code}`
      )
      const formatted = formatDownloadErrorMessage(testCase.error, { target: 'yt-dlp' })
      assert.ok(formatted.startsWith(`[${testCase.expectedCode}]`))
    }
    console.log(
      `✓ All ${errorClassificationCases.length} platform failure classification cases mapped accurately`
    )

    // ------------------------------------------------------------------------
    // TEST 6: SQLite Model Consistency Across All 5 Platforms
    // ------------------------------------------------------------------------
    console.log('\n--- 6. Testing SQLite Consistency for All 5 Platforms ---')

    const dbPath = path.join(testTempDir, 'platform_test.db')
    const sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: dbPath,
      logging: false,
      dialectOptions: {
        busyTimeout: 30000
      }
    })

    const MediaItem = defineMediaItem(sequelize)
    const DownloadJob = defineDownloadJob(sequelize)
    const DownloadFile = defineDownloadFile(sequelize)
    defineAppSetting(sequelize)

    // Setup relationships
    MediaItem.hasMany(DownloadJob, {
      foreignKey: 'media_id',
      as: 'downloads',
      onDelete: 'RESTRICT'
    })
    DownloadJob.belongsTo(MediaItem, { foreignKey: 'media_id', as: 'media' })
    DownloadJob.hasOne(DownloadFile, {
      foreignKey: 'download_job_id',
      as: 'file',
      onDelete: 'RESTRICT'
    })
    DownloadFile.belongsTo(DownloadJob, { foreignKey: 'download_job_id', as: 'downloadJob' })

    await sequelize.sync({ force: true })

    const platforms = ['youtube', 'facebook', 'instagram', 'tiktok', 'twitter']

    for (const platform of platforms) {
      // 1. Create MediaItem
      const mediaItem = await MediaItem.create({
        platform,
        source_url: `https://${platform}.com/test-media-${platform}`,
        title: `Test ${platform} Media Title`,
        thumbnail_url: `https://${platform}.com/thumb.jpg`,
        duration_seconds: 120
      })
      assert.strictEqual(mediaItem.platform, platform, `MediaItem platform must match ${platform}`)

      // 2. Create MP4 DownloadJob
      const mp4Job = await DownloadJob.create({
        media_id: mediaItem.id,
        source_type: 'link',
        output_format: 'mp4',
        quality: '720p',
        status: 'completed',
        progress: 100,
        downloaded_bytes: 10485760,
        total_bytes: 10485760
      })
      assert.strictEqual(mp4Job.output_format, 'mp4')

      // 3. Create DownloadFile record
      const mp4FileName = `Test ${platform} [job-${mp4Job.id}].mp4`
      const mp4FilePath = path.join(testTempDir, mp4FileName)
      const mp4File = await DownloadFile.create({
        download_job_id: mp4Job.id,
        file_name: mp4FileName,
        file_path: mp4FilePath,
        file_format: 'mp4',
        file_size: 10485760
      })
      assert.strictEqual(mp4File.file_format, 'mp4')
      assert.strictEqual(mp4File.download_job_id, mp4Job.id)

      // 4. Create MP3 DownloadJob
      const mp3Job = await DownloadJob.create({
        media_id: mediaItem.id,
        source_type: 'link',
        output_format: 'mp3',
        audio_bitrate_kbps: 192,
        status: 'completed',
        progress: 100,
        downloaded_bytes: 3145728,
        total_bytes: 3145728
      })
      assert.strictEqual(mp3Job.output_format, 'mp3')
      assert.strictEqual(mp3Job.audio_bitrate_kbps, 192)

      // 5. Create DownloadFile record for MP3
      const mp3FileName = `Test ${platform} [job-${mp3Job.id}].mp3`
      const mp3FilePath = path.join(testTempDir, mp3FileName)
      const mp3File = await DownloadFile.create({
        download_job_id: mp3Job.id,
        file_name: mp3FileName,
        file_path: mp3FilePath,
        file_format: 'mp3',
        file_size: 3145728
      })
      assert.strictEqual(mp3File.file_format, 'mp3')
      assert.strictEqual(mp3File.download_job_id, mp3Job.id)
    }

    const totalMedia = await MediaItem.count()
    const totalJobs = await DownloadJob.count()
    const totalFiles = await DownloadFile.count()

    assert.strictEqual(totalMedia, 5, 'Should have 5 MediaItems (one per platform)')
    assert.strictEqual(totalJobs, 10, 'Should have 10 DownloadJobs (MP4 + MP3 per platform)')
    assert.strictEqual(totalFiles, 10, 'Should have 10 DownloadFiles (MP4 + MP3 per platform)')

    await sequelize.close()
    console.log(
      '✓ SQLite database consistency verified for all 5 platforms (5 MediaItems, 10 Jobs, 10 Files)'
    )

    console.log('\n================================================================')
    console.log(' ALL STEP 04.39 PLATFORM DOWNLOAD TESTS PASSED SUCCESSFULLY! ')
    console.log('================================================================')
  } finally {
    try {
      await fs.rm(testTempDir, { recursive: true, force: true })
    } catch {
      // Best effort cleanup
    }
  }
}

runPlatformDownloadTests().catch((error) => {
  console.error('\n❌ Platform Download Test Suite Failed:', error)
  process.exit(1)
})
