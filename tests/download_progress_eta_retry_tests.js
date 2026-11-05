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
    downloaded_bytes: 25 * 1024 * 1024,
    total_bytes: 52 * 1024 * 1024
  }
  const normInterrupted = normalizeDownloadJob(interruptedJobRaw, speedTracker)
  assert.equal(speedTracker.has(101), false, 'Speed sample deleted when not downloading')
  assert.equal(normInterrupted.speedText, '0 KB/s')
  assert.equal(normInterrupted.etaDisplay, 'Waiting for connection')

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
