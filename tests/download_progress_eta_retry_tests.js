import assert from 'node:assert/strict'
import {
  estimateMp4QualitySize,
  estimateMp3BitrateSize
} from '../src/renderer/src/utils/mediaMetadata.js'
import {
  calculateEta,
  calculateEtaSeconds,
  formatEta,
  normalizeDownloadJob
} from '../src/renderer/src/utils/downloadPresentation.js'
import {
  aggregateStreamTotals,
  updateDownloadJobDownloadedBytes
} from '../src/main/backend/services/downloadService.js'
import {
  retryDownloadJob,
  clearRetryJobTracking
} from '../src/main/backend/services/downloadRetryService.js'
import { clearDownloadHistory } from '../src/main/backend/services/downloadHistoryService.js'
import { createTestDatabase } from './helpers/testDatabase.js'

async function runProgressEtaRetryTests() {
  console.log('================================================================')
  console.log(' Order 10: Progress, ETA, File Size, Same-Job Retry & Clear Test')
  console.log('================================================================\n')

  // --------------------------------------------------------------------------
  // SECTION 1: MP4 Quality Size Estimation Tests
  // --------------------------------------------------------------------------
  console.log('--- Section 1: MP4 Quality Size Estimation ---')

  const mediaWithFormats = {
    durationSeconds: 120,
    availableFormats: {
      mp4Qualities: ['1080p', '720p', '480p'],
      mp4Formats: [
        // 1080p separate video (approximate)
        {
          formatId: 'v1080',
          quality: '1080p',
          height: 1080,
          audioIncluded: false,
          fileSize: 40 * 1024 * 1024,
          isApproximate: true
        },
        // 720p combined video (exact)
        {
          formatId: 'c720',
          quality: '720p',
          height: 720,
          audioIncluded: true,
          fileSize: 25 * 1024 * 1024,
          isApproximate: false
        },
        // 480p separate video without fileSize
        {
          formatId: 'v480',
          quality: '480p',
          height: 480,
          audioIncluded: false,
          fileSize: null,
          isApproximate: false
        }
      ],
      audioFormats: [
        {
          formatId: 'a140',
          extension: 'm4a',
          audioCodec: 'mp4a.40.2',
          fileSize: 10 * 1024 * 1024,
          isApproximate: false
        }
      ]
    }
  }

  // 1.1 Best option (resolves to highest quality: 1080p video + compatible audio = 50 MB, approx)
  const bestSize = estimateMp4QualitySize(mediaWithFormats, 'best')
  assert.equal(bestSize, '~50 MB', '1.1: Best quality correctly computes ~50 MB')

  // 1.2 Combined stream (720p combined = 25 MB, exact)
  const p720Size = estimateMp4QualitySize(mediaWithFormats, '720p')
  assert.equal(p720Size, '25 MB', '1.2: Combined 720p computes 25 MB without tilde')

  // 1.3 Missing video size (480p)
  const p480Size = estimateMp4QualitySize(mediaWithFormats, '480p')
  assert.equal(p480Size, 'Size unavailable', '1.3: Missing video size yields Size unavailable')

  // 1.4 Missing audio format for separate video
  const mediaNoAudio = {
    availableFormats: {
      mp4Qualities: ['1080p'],
      mp4Formats: [
        {
          formatId: 'v1080',
          quality: '1080p',
          audioIncluded: false,
          fileSize: 50 * 1024 * 1024
        }
      ],
      audioFormats: []
    }
  }
  const noAudioSize = estimateMp4QualitySize(mediaNoAudio, '1080p')
  assert.equal(noAudioSize, 'Size unavailable', '1.4: Missing audio yields Size unavailable')

  // 1.5 Null or empty media
  assert.equal(
    estimateMp4QualitySize(null),
    'Size unavailable',
    '1.5: Null media yields Size unavailable'
  )

  // --- Dedicated Estimation Scenarios 1 - 7 ---

  // Scenario 1: Exact MP4 file size (Combined 1080p with exact 18 MB fileSize)
  const mediaExact = {
    availableFormats: {
      mp4Qualities: ['1080p'],
      mp4Formats: [
        {
          formatId: 'c1080',
          quality: '1080p',
          height: 1080,
          audioIncluded: true,
          fileSize: 18000000,
          isApproximate: false
        }
      ]
    }
  }
  assert.equal(
    estimateMp4QualitySize(mediaExact, '1080p'),
    '17.2 MB',
    'Scenario 1: Exact MP4 file size formats without tilde'
  )

  // Scenario 2: Approximate MP4 file size (Combined 1080p with approximate 18 MB fileSize)
  const mediaApprox = {
    availableFormats: {
      mp4Qualities: ['1080p'],
      mp4Formats: [
        {
          formatId: 'c1080',
          quality: '1080p',
          height: 1080,
          audioIncluded: true,
          fileSize: 18000000,
          isApproximate: true
        }
      ]
    }
  }
  assert.equal(
    estimateMp4QualitySize(mediaApprox, '1080p'),
    '~17.2 MB',
    'Scenario 2: Approximate MP4 file size includes tilde'
  )

  // Scenario 3: Combined MP4 bitrate estimation
  // (2000 kbps * 60s * 1000) / 8 = 15,000,000 bytes = ~14.3 MB
  const mediaCombinedBitrate = {
    durationSeconds: 60,
    availableFormats: {
      mp4Qualities: ['720p'],
      mp4Formats: [
        {
          formatId: 'c720',
          quality: '720p',
          height: 720,
          audioIncluded: true,
          fileSize: null,
          totalBitrateKbps: 2000
        }
      ]
    }
  }
  assert.equal(
    estimateMp4QualitySize(mediaCombinedBitrate, '720p'),
    '~14.3 MB',
    'Scenario 3: Combined MP4 bitrate estimation'
  )

  // Scenario 4: Separate video + audio bitrate estimation
  // Video: (2500 kbps * 60s * 1000) / 8 = 18,750,000 bytes
  // Audio: (128 kbps * 60s * 1000) / 8 = 960,000 bytes
  // Total: 19,710,000 bytes = ~18.8 MB
  const mediaSeparateBitrate = {
    durationSeconds: 60,
    availableFormats: {
      mp4Qualities: ['1080p'],
      mp4Formats: [
        {
          formatId: 'v1080',
          quality: '1080p',
          height: 1080,
          audioIncluded: false,
          fileSize: null,
          videoBitrateKbps: 2500
        }
      ],
      audioFormats: [
        {
          formatId: 'a128',
          extension: 'm4a',
          audioCodec: 'aac',
          fileSize: null,
          audioBitrateKbps: 128
        }
      ]
    }
  }
  assert.equal(
    estimateMp4QualitySize(mediaSeparateBitrate, '1080p'),
    '~18.8 MB',
    'Scenario 4: Separate video + audio bitrate estimation'
  )

  // Scenario 5: Equivalent same-quality format fallback (X real-world test case)
  // Selected video: hls-11347 (1920p, no size, no bitrate)
  // Equivalent video: http-10368 (1920p, fileSize: 19,470,000, approx)
  // Audio: hls-audio-128000-Audio (128 kbps, 15s = 240,000 bytes)
  // Total: 19,470,000 + 240,000 = 19,710,000 bytes = ~18.8 MB
  const mediaXRealWorld = {
    durationSeconds: 15,
    availableFormats: {
      mp4Qualities: ['1920p'],
      mp4Formats: [
        {
          formatId: 'http-10368',
          quality: '1920p',
          height: 1920,
          audioIncluded: false,
          fileSize: 19470000,
          isApproximate: true
        },
        {
          formatId: 'hls-11347',
          quality: '1920p',
          height: 1920,
          audioIncluded: false,
          fileSize: null,
          isApproximate: false
        }
      ],
      audioFormats: [
        {
          formatId: 'hls-audio-128000-Audio',
          extension: 'mp4',
          audioCodec: 'aac',
          fileSize: null,
          audioBitrateKbps: 128
        }
      ]
    }
  }
  assert.equal(
    estimateMp4QualitySize(mediaXRealWorld, '1920p'),
    '~18.8 MB',
    'Scenario 5: Equivalent same-quality format fallback (X Twitter real-world case)'
  )

  // Scenario 6: Missing file size and missing bitrate
  const mediaMissingInfo = {
    durationSeconds: 60,
    availableFormats: {
      mp4Qualities: ['1080p'],
      mp4Formats: [
        {
          formatId: 'c1080',
          quality: '1080p',
          height: 1080,
          audioIncluded: true,
          fileSize: null,
          totalBitrateKbps: null
        }
      ]
    }
  }
  assert.equal(
    estimateMp4QualitySize(mediaMissingInfo, '1080p'),
    'Size unavailable',
    'Scenario 6: Missing file size and missing bitrate yields Size unavailable'
  )

  // Scenario 7: Missing duration when bitrate is present
  const mediaMissingDuration = {
    durationSeconds: null,
    availableFormats: {
      mp4Qualities: ['1080p'],
      mp4Formats: [
        {
          formatId: 'c1080',
          quality: '1080p',
          height: 1080,
          audioIncluded: true,
          fileSize: null,
          totalBitrateKbps: 2000
        }
      ]
    }
  }
  assert.equal(
    estimateMp4QualitySize(mediaMissingDuration, '1080p'),
    'Size unavailable',
    'Scenario 7: Missing duration with bitrate yields Size unavailable'
  )

  // Scenario 7b: Facebook live format structure with URL-derived bitrate
  // (580 kbps * 74s * 1000) / 8 = 5,365,000 bytes = ~5.1 MB
  const mediaFbUrlBitrate = {
    durationSeconds: 74,
    availableFormats: {
      mp4Qualities: ['720p', '360p'],
      mp4Formats: [
        {
          formatId: 'sd',
          quality: '360p',
          height: 360,
          audioIncluded: true,
          fileSize: null,
          totalBitrateKbps: 127
        },
        {
          formatId: 'hd',
          quality: '720p',
          height: 720,
          audioIncluded: true,
          fileSize: null,
          totalBitrateKbps: 580
        }
      ]
    }
  }
  assert.equal(
    estimateMp4QualitySize(mediaFbUrlBitrate, '720p'),
    '~5.1 MB',
    'Scenario 7b: Facebook 720p with URL-derived bitrate yields ~5.1 MB'
  )
  assert.equal(
    estimateMp4QualitySize(mediaFbUrlBitrate, 'best'),
    '~5.1 MB',
    'Scenario 7b: Facebook best quality yields ~5.1 MB'
  )
  assert.equal(
    estimateMp4QualitySize(mediaFbUrlBitrate, '360p'),
    '~1.1 MB',
    'Scenario 7b: Facebook 360p yields ~1.1 MB'
  )

  // Scenario 7c: Generic Future Platform normalized structure
  // (3500 kbps * 90s * 1000) / 8 = 39,375,000 bytes = ~37.6 MB
  const mediaGeneric = {
    durationSeconds: 90,
    availableFormats: {
      mp4Qualities: ['1080p'],
      mp4Formats: [
        {
          formatId: 'generic-1080',
          quality: '1080p',
          height: 1080,
          audioIncluded: true,
          fileSize: null,
          totalBitrateKbps: 3500
        }
      ]
    }
  }
  assert.equal(
    estimateMp4QualitySize(mediaGeneric, '1080p'),
    '~37.6 MB',
    'Scenario 7c: Generic future platform estimates ~37.6 MB without platform-specific rules'
  )

  // Scenario 7d: TikTok real-world progressive stream structure
  const mediaTikTokProgressive = {
    durationSeconds: 24,
    availableFormats: {
      mp4Qualities: ['1920p', '960p'],
      mp4Formats: [
        {
          formatId: 'bytevc1_1080p_1094429-1',
          quality: '1920p',
          height: 1920,
          audioIncluded: true,
          fileSize: 3360445,
          totalBitrateKbps: 1094
        },
        {
          formatId: 'h264_540p_377700-0',
          quality: '960p',
          height: 960,
          audioIncluded: true,
          fileSize: 1159730,
          totalBitrateKbps: 377
        }
      ],
      audioFormats: [
        {
          formatId: 'audio',
          fileSize: null,
          audioBitrateKbps: null
        }
      ]
    }
  }
  assert.equal(
    estimateMp4QualitySize(mediaTikTokProgressive, '1920p'),
    '3.2 MB',
    'Scenario 7d: TikTok progressive 1920p estimates exact 3.2 MB'
  )
  assert.equal(
    estimateMp4QualitySize(mediaTikTokProgressive, 'best'),
    '3.2 MB',
    'Scenario 7d: TikTok progressive best estimates exact 3.2 MB'
  )

  // Scenario 7e: Instagram zero duration + duration_string fallback
  const mediaInstagramZeroDur = {
    duration: 0,
    duration_string: '0:30',
    availableFormats: {
      mp4Qualities: ['1080p'],
      mp4Formats: [
        {
          formatId: '0',
          quality: '1080p',
          height: 1080,
          audioIncluded: true,
          fileSize: null,
          totalBitrateKbps: 2500
        }
      ]
    }
  }
  assert.equal(
    estimateMp4QualitySize(mediaInstagramZeroDur, '1080p'),
    '~8.9 MB',
    'Scenario 7e: Instagram duration: 0 + duration_string: "0:30" estimates ~8.9 MB'
  )

  // Scenario 7f: Instagram authentic DASH streams with durationSeconds = 19
  const mediaInstagramDash = {
    durationSeconds: 19,
    availableFormats: {
      mp4Qualities: ['1280p', '960p', '640p'],
      mp4Formats: [
        {
          formatId: 'dash-983317638155918v',
          quality: '1280p',
          height: 1280,
          audioIncluded: false,
          fileSize: null,
          totalBitrateKbps: 2281.975
        },
        {
          formatId: 'dash-983317648155917v',
          quality: '960p',
          height: 960,
          audioIncluded: false,
          fileSize: null,
          totalBitrateKbps: 393.562
        },
        {
          formatId: 'dash-983317644822584v',
          quality: '640p',
          height: 640,
          audioIncluded: false,
          fileSize: null,
          totalBitrateKbps: 105.512
        }
      ],
      audioFormats: [
        {
          formatId: 'dash-983309768156705a',
          extension: 'm4a',
          audioCodec: 'mp4a.40.5',
          fileSize: null,
          audioBitrateKbps: 66.215,
          totalBitrateKbps: 66.215
        }
      ]
    }
  }

  assert.equal(
    estimateMp4QualitySize(mediaInstagramDash, '1280p'),
    '~5.3 MB',
    'Scenario 7f: Instagram MP4 1280p estimates ~5.3 MB'
  )
  assert.equal(
    estimateMp4QualitySize(mediaInstagramDash, '960p'),
    '~1 MB',
    'Scenario 7f: Instagram MP4 960p estimates ~1 MB'
  )
  assert.equal(
    estimateMp4QualitySize(mediaInstagramDash, '640p'),
    '~398.3 KB',
    'Scenario 7f: Instagram MP4 640p estimates ~398.3 KB'
  )
  console.log('✓ Section 1 Passed: MP4 quality file size estimation verified.\n')

  // --------------------------------------------------------------------------
  // SECTION 2: MP3 Bitrate Size Estimation Tests
  // --------------------------------------------------------------------------
  console.log('--- Section 2: MP3 Bitrate Output Size Estimation ---')

  const mediaDuration = { durationSeconds: 220 } // 220 seconds

  // 220s * 128 kbps * 1000 / 8 = 3,520,000 bytes = ~3.4 MB
  const mp3_128 = estimateMp3BitrateSize(mediaDuration, 128)
  assert.equal(mp3_128, '~3.4 MB', '2.1: 128 kbps calculation matches formula')

  // 220s * 192 kbps * 1000 / 8 = 5,280,000 bytes = ~5 MB
  const mp3_192 = estimateMp3BitrateSize(mediaDuration, 192)
  assert.equal(mp3_192, '~5 MB', '2.2: 192 kbps calculation matches formula')

  // 220s * 320 kbps * 1000 / 8 = 8,800,000 bytes = ~8.4 MB
  const mp3_320 = estimateMp3BitrateSize(mediaDuration, 320)
  assert.equal(mp3_320, '~8.4 MB', '2.3: 320 kbps calculation matches formula')

  // Missing duration
  assert.equal(
    estimateMp3BitrateSize({ durationSeconds: null }, 192),
    'Size unavailable',
    '2.4: Missing duration'
  )
  assert.equal(estimateMp3BitrateSize(null, 192), 'Size unavailable', '2.5: Null media')

  // --- Dedicated Estimation Scenarios 8 - 10 (Facebook 16:10 = 970s duration) ---
  const fbMedia = { durationSeconds: 970 }

  // Scenario 8: MP3 128 kbps (970s * 128 * 1000 / 8 = 15,520,000 bytes = ~14.8 MB)
  assert.equal(
    estimateMp3BitrateSize(fbMedia, 128),
    '~14.8 MB',
    'Scenario 8: MP3 128 kbps calculation (970s)'
  )

  // Scenario 9: MP3 192 kbps (970s * 192 * 1000 / 8 = 23,280,000 bytes = ~22.2 MB)
  assert.equal(
    estimateMp3BitrateSize(fbMedia, 192),
    '~22.2 MB',
    'Scenario 9: MP3 192 kbps calculation (970s)'
  )

  // Scenario 10: MP3 320 kbps (970s * 320 * 1000 / 8 = 38,800,000 bytes = ~37 MB)
  assert.equal(
    estimateMp3BitrateSize(fbMedia, 320),
    '~37 MB',
    'Scenario 10: MP3 320 kbps calculation (970s)'
  )

  // Fallback to duration_string in MP3 calculation
  const mediaWithDurString = { duration_string: '16:10' }
  assert.equal(
    estimateMp3BitrateSize(mediaWithDurString, 128),
    '~14.8 MB',
    'Duration string fallback: 16:10 parsed to 970s for 128 kbps MP3'
  )

  // Scenario 11: Numeric string duration (e.g. duration: "970")
  assert.equal(
    estimateMp3BitrateSize({ duration: '970' }, 128),
    '~14.8 MB',
    'Scenario 11: Numeric string duration "970" parses to 970s for 128 kbps MP3'
  )

  // Scenario 12: Generic future platform MP3
  assert.equal(
    estimateMp3BitrateSize({ durationSeconds: 90 }, 192),
    '~2.1 MB',
    'Scenario 12: Generic future platform 90s 192 kbps MP3 yields ~2.1 MB'
  )

  // Scenario 13: Instagram duration: 0 with duration_string fallback for MP3
  const igZeroMedia = { duration: 0, duration_string: '0:30' }
  assert.equal(
    estimateMp3BitrateSize(igZeroMedia, 128),
    '~468.8 KB',
    'Scenario 13: Instagram duration: 0 + duration_string: "0:30" 128 kbps yields ~468.8 KB'
  )
  assert.equal(
    estimateMp3BitrateSize(igZeroMedia, 192),
    '~703.1 KB',
    'Scenario 13: Instagram duration: 0 + duration_string: "0:30" 192 kbps yields ~703.1 KB'
  )
  assert.equal(
    estimateMp3BitrateSize(igZeroMedia, 320),
    '~1.1 MB',
    'Scenario 13: Instagram duration: 0 + duration_string: "0:30" 320 kbps yields ~1.1 MB'
  )

  // Scenario 13b: Instagram authentic durationSeconds = 19 for MP3
  const ig19Media = { durationSeconds: 19 }
  assert.equal(
    estimateMp3BitrateSize(ig19Media, 128),
    '~296.9 KB',
    'Scenario 13b: Instagram 19s 128 kbps MP3 yields ~296.9 KB'
  )
  assert.equal(
    estimateMp3BitrateSize(ig19Media, 192),
    '~445.3 KB',
    'Scenario 13b: Instagram 19s 192 kbps MP3 yields ~445.3 KB'
  )
  assert.equal(
    estimateMp3BitrateSize(ig19Media, 320),
    '~742.2 KB',
    'Scenario 13b: Instagram 19s 320 kbps MP3 yields ~742.2 KB'
  )

  // Scenario 14: TikTok real-world duration 24s for MP3
  assert.equal(
    estimateMp3BitrateSize({ durationSeconds: 24 }, 128),
    '~375 KB',
    'Scenario 14: TikTok 24s 128 kbps MP3 yields ~375 KB'
  )
  console.log('✓ Section 2 Passed: MP3 bitrate output size estimation verified.\n')

  // --------------------------------------------------------------------------
  // SECTION 3: Multi-Stream Aggregate Totals Calculation
  // --------------------------------------------------------------------------
  console.log('--- Section 3: Aggregate Stream Totals Calculation ---')

  // 3.1 Two active streams with exact totals
  const streamsExact = [
    {
      filename: 'v.mp4',
      status: 'downloading',
      downloadedBytes: 1000,
      totalBytes: 5000,
      totalBytesIsEstimate: false
    },
    {
      filename: 'a.m4a',
      status: 'downloading',
      downloadedBytes: 500,
      totalBytes: 2000,
      totalBytesIsEstimate: false
    }
  ]
  const aggExact = aggregateStreamTotals(streamsExact)
  assert.equal(aggExact.totalBytes, 7000, '3.1: Sum of totals')
  assert.equal(aggExact.totalBytesIsEstimate, false, '3.1: Exact flag preserved')

  // 3.2 Two active streams where one is an estimate
  const streamsApprox = [
    {
      filename: 'v.mp4',
      status: 'downloading',
      downloadedBytes: 1000,
      totalBytes: 5000,
      totalBytesIsEstimate: true
    },
    {
      filename: 'a.m4a',
      status: 'downloading',
      downloadedBytes: 500,
      totalBytes: 2000,
      totalBytesIsEstimate: false
    }
  ]
  const aggApprox = aggregateStreamTotals(streamsApprox)
  assert.equal(aggApprox.totalBytes, 7000, '3.2: Sum of totals with estimate')
  assert.equal(aggApprox.totalBytesIsEstimate, true, '3.2: Estimate flag set to true')

  // 3.3 Active stream with unknown total -> aggregate total must be null
  const streamsUnknown = [
    { filename: 'v.mp4', status: 'downloading', downloadedBytes: 1000, totalBytes: null },
    { filename: 'a.m4a', status: 'downloading', downloadedBytes: 500, totalBytes: 2000 }
  ]
  const aggUnknown = aggregateStreamTotals(streamsUnknown)
  assert.equal(
    aggUnknown.totalBytes,
    null,
    '3.3: Unknown active stream total yields null aggregate'
  )

  // 3.4 One finished stream with no total uses downloadedBytes + active stream with total
  const streamsFinished = [
    { filename: 'v.mp4', status: 'finished', downloadedBytes: 5000, totalBytes: null },
    { filename: 'a.m4a', status: 'downloading', downloadedBytes: 500, totalBytes: 2000 }
  ]
  const aggFinished = aggregateStreamTotals(streamsFinished)
  assert.equal(
    aggFinished.totalBytes,
    7000,
    '3.4: Finished stream uses downloadedBytes when total was unreported'
  )
  console.log('✓ Section 3 Passed: Multi-stream total aggregation verified.\n')

  // --------------------------------------------------------------------------
  // SECTION 4: Live Speed, ETA and Presentation Normalization
  // --------------------------------------------------------------------------
  console.log('--- Section 4: Live Speed, ETA and Normalization ---')

  // 4.1 calculateEtaSeconds and formatEta
  const etaSeconds = calculateEtaSeconds(27 * 1024 * 1024, 1.2 * 1024 * 1024)
  assert.equal(etaSeconds, 23, '4.1: ~27 MB at 1.2 MB/s is ~23 seconds')
  assert.equal(formatEta(23), '~23 seconds', '4.1: formatEta 23s')
  assert.equal(formatEta(125), '~2m 5s', '4.1: formatEta 125s')

  // 4.2 calculateEta formatted
  const etaFormatted = calculateEta(27 * 1024 * 1024, 1.2 * 1024 * 1024)
  assert.equal(etaFormatted, '~23 seconds remaining', '4.2: calculateEta full text')

  // 4.3 normalizeDownloadJob during downloading with SpeedTracker
  const speedTracker = new Map()
  const activeJobRaw = {
    id: 101,
    status: 'downloading',
    output_format: 'mp4',
    quality: '1080p',
    progress: 48,
    downloaded_bytes: 25 * 1024 * 1024,
    total_bytes: 52 * 1024 * 1024,
    media: { title: 'Alan Walker – On My Way' }
  }

  // First sample: initializes speed tracker
  const norm1 = normalizeDownloadJob(activeJobRaw, speedTracker)
  assert.equal(norm1.displayStatus, 'downloading')
  assert.equal(norm1.progress, 48)
  assert.equal(norm1.progressText, '25 MB / 52 MB')
  assert.equal(norm1.etaDisplay, 'Calculating...', 'First sample yields Calculating...')

  // Simulate second sample 1 second later with +1.2 MB downloaded
  const sample1 = speedTracker.get(101)
  sample1.timestamp = Date.now() - 1000
  sample1.bytes = (25 - 1.2) * 1024 * 1024
  speedTracker.set(101, sample1)

  const norm2 = normalizeDownloadJob(activeJobRaw, speedTracker)
  assert.equal(norm2.speedText, '1.2 MB/s', 'Calculated speed matches 1.2 MB/s')
  assert.equal(norm2.etaDisplay, '~23 seconds', 'Calculated ETA display is ~23 seconds')
  assert.equal(
    norm2.etaText,
    '~23 seconds remaining',
    'Calculated ETA text is ~23 seconds remaining'
  )

  // 4.4 Finalizing state: downloaded_bytes >= total_bytes during downloading
  const finalizingJobRaw = {
    id: 102,
    status: 'downloading',
    downloaded_bytes: 52 * 1024 * 1024,
    total_bytes: 52 * 1024 * 1024
  }
  const normFinalizing = normalizeDownloadJob(finalizingJobRaw, speedTracker)
  assert.equal(normFinalizing.etaDisplay, 'Finalizing...', 'Finalizing state detected')

  // 4.5 Stale speed cache invalidation when transitioning away from downloading
  const interruptedJobRaw = {
    id: 101,
    status: 'interrupted',
    progress: 48,
    downloaded_bytes: 25 * 1024 * 1024,
    total_bytes: 52 * 1024 * 1024
  }
  const normInterrupted = normalizeDownloadJob(interruptedJobRaw, speedTracker)
  assert.equal(speedTracker.has(101), false, 'Speed sample deleted when not downloading')
  assert.equal(normInterrupted.speedText, '0 KB/s')
  assert.equal(normInterrupted.etaText, 'Waiting for connection')
  assert.equal(normInterrupted.etaDisplay, 'Waiting for connection')
  assert.equal(normInterrupted.displayStatus, 'interrupted')
  assert.equal(normInterrupted.statusText, 'Interrupted – Waiting for internet connection')
  assert.equal(normInterrupted.progress, 48, 'Interrupted progress is preserved')

  // 4.6 Estimated Total Size Indicator (ORDER 01)
  // Case A: Live estimated total (total_bytes_is_estimate: true)
  const estJob = {
    id: 103,
    status: 'downloading',
    downloaded_bytes: 25 * 1024 * 1024,
    total_bytes: 52 * 1024 * 1024,
    total_bytes_is_estimate: true
  }
  const normEst = normalizeDownloadJob(estJob)
  assert.equal(normEst.totalBytesIsEstimate, true, '4.6A: totalBytesIsEstimate is true')
  assert.equal(normEst.totalBytesFormatted, '~52 MB', '4.6A: totalBytesFormatted has tilde prefix')
  assert.equal(normEst.progressText, '25 MB / ~52 MB', '4.6A: progressText is 25 MB / ~52 MB')

  // Case B: Integer 1 estimate flag
  const estIntJob = {
    id: 104,
    status: 'downloading',
    downloaded_bytes: 10 * 1024 * 1024,
    total_bytes: 50 * 1024 * 1024,
    total_bytes_is_estimate: 1
  }
  const normEstInt = normalizeDownloadJob(estIntJob)
  assert.equal(normEstInt.totalBytesIsEstimate, true, '4.6B: integer 1 parsed as estimate')
  assert.equal(normEstInt.totalBytesFormatted, '~50 MB', '4.6B: ~50 MB formatted')

  // Case C: Exact total size (total_bytes_is_estimate: false)
  const exactJob = {
    id: 105,
    status: 'downloading',
    downloaded_bytes: 25 * 1024 * 1024,
    total_bytes: 52 * 1024 * 1024,
    total_bytes_is_estimate: false
  }
  const normExact = normalizeDownloadJob(exactJob)
  assert.equal(
    normExact.totalBytesIsEstimate,
    false,
    '4.6C: exact job totalBytesIsEstimate is false'
  )
  assert.equal(normExact.totalBytesFormatted, '52 MB', '4.6C: totalBytesFormatted has NO tilde')
  assert.equal(normExact.progressText, '25 MB / 52 MB', '4.6C: progressText is 25 MB / 52 MB')

  // Case D: Estimated total with 0 downloaded bytes
  const zeroEstJob = {
    id: 106,
    status: 'queued',
    downloaded_bytes: 0,
    total_bytes: 52 * 1024 * 1024,
    total_bytes_is_estimate: true
  }
  const normZeroEst = normalizeDownloadJob(zeroEstJob)
  assert.equal(
    normZeroEst.progressText,
    '~52 MB',
    '4.6D: 0 downloaded displays estimated total size'
  )

  // Case E: Unknown total with downloaded bytes > 0
  const unknownTotalJob = {
    id: 107,
    status: 'downloading',
    downloaded_bytes: 25 * 1024 * 1024,
    total_bytes: null
  }
  const normUnknown = normalizeDownloadJob(unknownTotalJob)
  assert.equal(normUnknown.totalBytes, null, '4.6E: totalBytes is null')
  assert.equal(normUnknown.totalBytesFormatted, null, '4.6E: totalBytesFormatted is null')
  assert.equal(
    normUnknown.progressText,
    '25 MB downloaded',
    '4.6E: progressText displays X downloaded'
  )

  // Case F: Completed job fallback to file.file_size (exact, no tilde even if flag was 1)
  const completedFallbackJob = {
    id: 108,
    status: 'completed',
    total_bytes: null,
    total_bytes_is_estimate: 1, // should be ignored when total_bytes is null and file.file_size is used
    file: { file_size: 52 * 1024 * 1024 }
  }
  const normFallback = normalizeDownloadJob(completedFallbackJob)
  assert.equal(
    normFallback.totalBytesIsEstimate,
    false,
    '4.6F: fallback file size is never estimated'
  )
  assert.equal(normFallback.totalBytesFormatted, '52 MB', '4.6F: completed file size has no tilde')

  // Case G (Order 01 Test A): Estimated total vs actual completed file size
  const completedActualJob = {
    id: 201,
    status: 'completed',
    downloaded_bytes: 52 * 1024 * 1024,
    total_bytes: 50 * 1024 * 1024,
    total_bytes_is_estimate: true,
    file: {
      file_size: 52 * 1024 * 1024
    }
  }
  const normCompletedActual = normalizeDownloadJob(completedActualJob)
  assert.equal(
    normCompletedActual.totalBytes,
    52 * 1024 * 1024,
    '4.6G: Actual completed file size overrides transfer estimate'
  )
  assert.equal(
    normCompletedActual.totalBytesIsEstimate,
    false,
    '4.6G: totalBytesIsEstimate is false for actual completed file'
  )
  assert.equal(
    normCompletedActual.totalBytesFormatted,
    '52 MB',
    '4.6G: totalBytesFormatted displays actual size without tilde'
  )
  assert.equal(
    normCompletedActual.progressText,
    '52 MB',
    '4.6G: progressText displays actual completed size'
  )
  assert.equal(
    normCompletedActual.fileSize,
    '52 MB',
    '4.6G: fileSize displays actual completed size'
  )

  // Case H (Order 01 Test B): MP3 output differs from source size
  const completedMp3Job = {
    id: 202,
    status: 'completed',
    output_format: 'mp3',
    audio_bitrate_kbps: 192,
    downloaded_bytes: 50 * 1024 * 1024,
    total_bytes: 50 * 1024 * 1024,
    total_bytes_is_estimate: true,
    file: {
      file_size: 8 * 1024 * 1024
    }
  }
  const normCompletedMp3 = normalizeDownloadJob(completedMp3Job)
  assert.equal(
    normCompletedMp3.totalBytes,
    8 * 1024 * 1024,
    '4.6H: Final MP3 output file size takes priority'
  )
  assert.equal(normCompletedMp3.totalBytesIsEstimate, false, '4.6H: MP3 output is not estimate')
  assert.equal(normCompletedMp3.totalBytesFormatted, '8 MB', '4.6H: MP3 formatted as 8 MB')
  assert.equal(normCompletedMp3.progressText, '8 MB', '4.6H: MP3 progressText is 8 MB')
  assert.equal(normCompletedMp3.fileSize, '8 MB', '4.6H: MP3 fileSize is 8 MB')

  // Case I (Order 01 Test C): Completed job without actual file size
  const completedNoFileJob = {
    id: 203,
    status: 'completed',
    downloaded_bytes: 50 * 1024 * 1024,
    total_bytes: 50 * 1024 * 1024,
    total_bytes_is_estimate: true,
    file: null
  }
  const normCompletedNoFile = normalizeDownloadJob(completedNoFileJob)
  assert.equal(
    normCompletedNoFile.totalBytes,
    50 * 1024 * 1024,
    '4.6I: Preserves existing live total'
  )
  assert.equal(normCompletedNoFile.totalBytesIsEstimate, true, '4.6I: Preserves estimate indicator')
  assert.equal(normCompletedNoFile.totalBytesFormatted, '~50 MB', '4.6I: Formats with tilde')
  assert.equal(normCompletedNoFile.fileSize, '~50 MB', '4.6I: fileSize displays ~50 MB')

  // Case J (Order 01 Test D): Active download does not switch to stale output file size
  const activeDownloadingJob = {
    id: 204,
    status: 'downloading',
    downloaded_bytes: 25 * 1024 * 1024,
    total_bytes: 50 * 1024 * 1024,
    total_bytes_is_estimate: true,
    file: {
      file_size: 52 * 1024 * 1024 // Stale or partial file object
    }
  }
  const normActive = normalizeDownloadJob(activeDownloadingJob)
  assert.equal(
    normActive.totalBytes,
    50 * 1024 * 1024,
    '4.6J: Active download uses live total_bytes'
  )
  assert.equal(
    normActive.totalBytesIsEstimate,
    true,
    '4.6J: Active download preserves live estimate flag'
  )
  assert.equal(normActive.totalBytesFormatted, '~50 MB', '4.6J: Active download formats ~50 MB')
  assert.equal(
    normActive.progressText,
    '25 MB / ~50 MB',
    '4.6J: Active progress text is 25 MB / ~50 MB'
  )

  // 4.7 Resuming State UI Normalization (ORDER 02)
  // Derived resuming from queued with existing progress
  const queuedWithProgressJob = {
    id: 109,
    status: 'queued',
    progress: 48,
    downloaded_bytes: 25 * 1024 * 1024,
    total_bytes: 52 * 1024 * 1024
  }
  const normResumingDerived = normalizeDownloadJob(queuedWithProgressJob, speedTracker)
  assert.equal(normResumingDerived.displayStatus, 'resuming', '4.7A: displayStatus is resuming')
  assert.equal(
    normResumingDerived.status,
    'queued',
    '4.7A: underlying backend status remains queued'
  )
  assert.equal(
    normResumingDerived.statusText,
    'Resuming (48% saved)',
    '4.7A: statusText shows saved progress'
  )
  assert.equal(
    normResumingDerived.speedText,
    null,
    '4.7A: speedText is null while waiting to resume'
  )
  assert.equal(normResumingDerived.etaText, 'Resuming...', '4.7A: etaText is Resuming...')
  assert.equal(normResumingDerived.etaDisplay, 'Resuming...', '4.7A: etaDisplay is Resuming...')
  assert.equal(normResumingDerived.progress, 48, '4.7A: progress is preserved')

  // Fresh queued job with progress 0
  const freshQueuedJob = {
    id: 110,
    status: 'queued',
    progress: 0
  }
  const normFreshQueued = normalizeDownloadJob(freshQueuedJob)
  assert.equal(normFreshQueued.displayStatus, 'queued', '4.7B: fresh queued remains queued')
  assert.equal(normFreshQueued.statusText, 'Queued', '4.7B: fresh queued statusText is Queued')
  assert.equal(normFreshQueued.speedText, null)
  assert.equal(normFreshQueued.etaDisplay, null)

  // 4.8 Fresh Reconnection & Speed Invalidation Flow
  const reconJob = {
    id: 111,
    status: 'downloading',
    downloaded_bytes: 20 * 1024 * 1024,
    total_bytes: 100 * 1024 * 1024
  }
  normalizeDownloadJob(reconJob, speedTracker)
  assert.ok(speedTracker.has(111), '4.8: speedTracker has entry during download')

  // Network drops -> interrupted
  normalizeDownloadJob({ ...reconJob, status: 'interrupted' }, speedTracker)
  assert.equal(speedTracker.has(111), false, '4.8: speedTracker cleared on interrupt')

  // Network restored -> resumes downloading
  // Tick 1 after restore: baseline created
  const reconNorm1 = normalizeDownloadJob(
    { ...reconJob, downloaded_bytes: 20 * 1024 * 1024 },
    speedTracker
  )
  assert.equal(
    reconNorm1.etaDisplay,
    'Calculating...',
    '4.8: First sample after resume is Calculating...'
  )

  // Tick 2 (1 second later, +2 MB downloaded):
  const sampleRecon = speedTracker.get(111)
  sampleRecon.timestamp = Date.now() - 1000
  sampleRecon.bytes = 18 * 1024 * 1024
  speedTracker.set(111, sampleRecon)

  const reconNorm2 = normalizeDownloadJob(
    { ...reconJob, downloaded_bytes: 20 * 1024 * 1024 },
    speedTracker
  )
  assert.equal(
    reconNorm2.speedText,
    '2 MB/s',
    '4.8: Fresh speed accurately computed at 2 MB/s without spike'
  )
  assert.ok(
    reconNorm2.etaDisplay.includes('seconds') || reconNorm2.etaDisplay.includes('m'),
    '4.8: Clean ETA computed'
  )

  // 4.9: Cancelled job normalization (Phase 2 fix: stale progress & bytes strictly reset to 0 / 0 B)
  const staleCancelledRaw = {
    id: 999,
    media_id: 1,
    status: 'cancelled',
    progress: 65,
    downloaded_bytes: 18 * 1024 * 1024,
    total_bytes: 30 * 1024 * 1024,
    output_format: 'mp4',
    quality: '720p',
    error_message: null
  }
  const cancelledNorm = normalizeDownloadJob(staleCancelledRaw, speedTracker)
  assert.equal(cancelledNorm.status, 'cancelled', '4.9: Status is cancelled')
  assert.equal(cancelledNorm.displayStatus, 'cancelled', '4.9: displayStatus is cancelled')
  assert.equal(cancelledNorm.statusText, 'Cancelled', '4.9: statusText is Cancelled')
  assert.equal(cancelledNorm.progress, 0, '4.9: Progress strictly reset to 0% for cancelled job')
  assert.equal(cancelledNorm.progressText, '0 B', '4.9: Progress text strictly reset to 0 B')
  assert.equal(cancelledNorm.downloadedBytes, 0, '4.9: Downloaded bytes strictly reset to 0')
  assert.equal(
    cancelledNorm.downloadedBytesFormatted,
    '0 B',
    '4.9: Downloaded bytes formatted strictly reset to 0 B'
  )
  assert.equal(cancelledNorm.speedText, null, '4.9: Speed text is null for cancelled job')
  assert.equal(cancelledNorm.etaText, null, '4.9: ETA text is null for cancelled job')
  assert.equal(cancelledNorm.etaDisplay, null, '4.9: ETA display is null for cancelled job')

  console.log('✓ Section 4 Passed: Live speed, ETA and presentation normalization verified.\n')

  // --------------------------------------------------------------------------
  // SECTION 5: Database Migration & Live Total Persistence
  // --------------------------------------------------------------------------
  console.log('--- Section 5: Database Migration & Live Total Persistence ---')

  const testDb = await createTestDatabase('progress-totals-test-')
  try {
    const { DownloadJob, MediaItem } = testDb.sequelize.models

    const media = await MediaItem.create({
      source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Test Song'
    })

    const job = await DownloadJob.create({
      media_id: media.id,
      status: 'downloading',
      output_format: 'mp4',
      downloaded_bytes: 1000
    })

    // Verify migration columns exist
    const desc = await testDb.sequelize.getQueryInterface().describeTable('download_jobs')
    assert.ok(desc.total_bytes, 'total_bytes column exists on download_jobs')
    assert.ok(
      desc.total_bytes_is_estimate,
      'total_bytes_is_estimate column exists on download_jobs'
    )

    // Update with live total bytes and estimate flag
    await updateDownloadJobDownloadedBytes(job.id, 25000000, 52000000, true)

    const reloaded = await DownloadJob.findByPk(job.id)
    assert.equal(Number(reloaded.downloaded_bytes), 25000000, 'downloaded_bytes persisted')
    assert.equal(Number(reloaded.total_bytes), 52000000, 'total_bytes persisted')
    assert.equal(reloaded.total_bytes_is_estimate, true, 'total_bytes_is_estimate persisted')
    console.log('✓ Section 5 Passed: Additive migration and live total persistence verified.\n')

    // --------------------------------------------------------------------------
    // SECTION 6: Same Job ID Retry Correction
    // --------------------------------------------------------------------------
    console.log('--- Section 6: Same Job ID Retry Correction ---')

    clearRetryJobTracking()

    const failedJob = await DownloadJob.create({
      media_id: media.id,
      status: 'failed',
      error_message: 'Network connection lost',
      output_format: 'mp4',
      quality: '720p',
      progress: 35,
      downloaded_bytes: 5000000
    })

    const enqueued = []
    const retryResult = await retryDownloadJob(failedJob.id, {
      enqueue: (id) => enqueued.push(id)
    })

    // Strict same-job assertion
    assert.equal(retryResult.outcome, 'created')
    assert.equal(retryResult.originalJobId, failedJob.id, '6.1: originalJobId matches')
    assert.equal(
      retryResult.retryJobId,
      failedJob.id,
      '6.1: retryJobId strictly equals originalJobId'
    )
    assert.deepEqual(enqueued, [failedJob.id], '6.1: Enqueued ID is original Job ID')

    // Verify database row count
    const rows = await DownloadJob.findAll({ where: { id: failedJob.id } })
    assert.equal(rows.length, 1, '6.2: Exactly one database row exists')
    assert.equal(rows[0].status, 'queued', '6.2: Status updated in-place to queued')
    assert.equal(rows[0].error_message, null, '6.2: Error message cleared')

    // Concurrency guard: immediate re-try of active job returns retry_in_progress
    const duplicateRetry = await retryDownloadJob(failedJob.id, {
      enqueue: (id) => enqueued.push(id)
    })
    assert.equal(duplicateRetry.outcome, 'retry_in_progress', '6.3: Double-click retry blocked')
    console.log('✓ Section 6 Passed: Same Job ID retry correction verified.\n')

    // --------------------------------------------------------------------------
    // SECTION 7: Clear Failed Button Functionality
    // --------------------------------------------------------------------------
    console.log('--- Section 7: Clear Failed Action ---')

    // Create 1 completed job, 1 failed job, 1 queued job
    const compJob = await DownloadJob.create({
      media_id: media.id,
      status: 'completed',
      output_format: 'mp4'
    })
    const failJob1 = await DownloadJob.create({
      media_id: media.id,
      status: 'failed',
      output_format: 'mp4'
    })
    const failJob2 = await DownloadJob.create({
      media_id: media.id,
      status: 'failed',
      output_format: 'mp4'
    })
    const qJob = await DownloadJob.create({
      media_id: media.id,
      status: 'queued',
      output_format: 'mp4'
    })

    const clearRes = await clearDownloadHistory({
      confirm: true,
      statuses: ['failed']
    })

    assert.equal(clearRes.deletedJobs, 2, '7.1: Both failed records deleted')

    // Verify completed and queued jobs are preserved
    const checkComp = await DownloadJob.findByPk(compJob.id)
    assert.ok(checkComp !== null, '7.2: Completed job preserved')

    const checkQ = await DownloadJob.findByPk(qJob.id)
    assert.ok(checkQ !== null, '7.3: Queued job preserved')

    const checkFail1 = await DownloadJob.findByPk(failJob1.id)
    assert.equal(checkFail1, null, '7.4: Failed job 1 removed')

    const checkFail2 = await DownloadJob.findByPk(failJob2.id)
    assert.equal(checkFail2, null, '7.5: Failed job 2 removed')

    console.log('✓ Section 7 Passed: Clear Failed removes only failed history.\n')

    console.log('================================================================')
    console.log(' ALL ORDER 10 VERIFICATION TESTS PASSED SUCCESSFULLY (100% PASS)')
    console.log('================================================================\n')
  } finally {
    await testDb.cleanup()
  }
}

runProgressEtaRetryTests().catch((err) => {
  console.error('\n❌ ORDER 10 TEST SUITE FAILED:', err)
  process.exit(1)
})
