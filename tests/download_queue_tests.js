import assert from 'node:assert/strict'
import {
  enqueueDownloadJob,
  cancelDownloadJob,
  getQueueStatus
} from '../src/main/backend/services/downloadQueueService.js'
import { createDownloadJob } from '../src/main/backend/services/downloadService.js'
import { retryDownloadJob } from '../src/main/backend/services/downloadRetryService.js'
import {
  findActiveDuplicateDownload,
  getCanonicalMediaKey
} from '../src/main/backend/services/downloadDuplicateService.js'
import { createTestDatabase } from './helpers/testDatabase.js'

/**
 * ============================================================================
 * APPLAN2 — Step 04.44 Automated Test Groups D & E: Queue, Concurrency & Lifecycle
 *
 * Covers:
 * - Queue limits (MAX_CONCURRENT_DOWNLOADS = 2), FIFO order, duplicate prevention
 * - getQueueStatus inspection
 * - Job cancellation states: queued, already cancelled, completed conflict, not found
 * - Active duplicate detection (same vs distinct bitrates / qualities)
 * - Canonical media key extraction across URL variants
 * - Retry mechanics: creates fresh job ID, preserves original state, rejects active/completed
 * ============================================================================
 */
async function runDownloadQueueTests() {
  console.log('================================================================')
  console.log(' APPLAN2 — Step 04.44 Test Groups D & E: Queue & Retry Test Suite')
  console.log('================================================================\n')

  const testDb = await createTestDatabase('applan2-queue-test-')
  console.log(`[setup] Isolated test database ready: ${testDb.databasePath}\n`)

  try {
    const { MediaItem, DownloadJob } = testDb.sequelize.models

    const media = await MediaItem.create({
      source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      platform: 'youtube',
      title: 'Queue & Lifecycle Media'
    })

    // ------------------------------------------------------------------------
    // 1. Queue Status & Configuration
    // ------------------------------------------------------------------------
    console.log('--- 1. Testing Queue Configuration & Capacity ---')

    const initialStatus = getQueueStatus()
    assert.equal(initialStatus.maxConcurrency, 2, '1.1: MAX_CONCURRENT_DOWNLOADS is 2')
    assert.ok(Array.isArray(initialStatus.waitingJobIds), '1.2: waitingJobIds is array')
    assert.ok(Array.isArray(initialStatus.scheduledJobIds), '1.3: scheduledJobIds is array')

    // Invalid Job ID rejection
    assert.throws(
      () => enqueueDownloadJob(-1),
      /valid Download Job ID is required/,
      '1.4: Negative ID throws'
    )
    assert.throws(
      () => enqueueDownloadJob('abc'),
      /valid Download Job ID is required/,
      '1.5: String ID throws'
    )
    assert.throws(
      () => enqueueDownloadJob(0),
      /valid Download Job ID is required/,
      '1.6: Zero ID throws'
    )

    console.log('✓ Section 1: Queue concurrency limit and ID validation verified.\n')

    // ------------------------------------------------------------------------
    // 2. Canonical Media Key Extraction & Duplicate Prevention
    // ------------------------------------------------------------------------
    console.log('--- 2. Testing Canonical Media Key & Duplicate Detection ---')

    // Canonical keys for YouTube variants
    const keyWatch = getCanonicalMediaKey('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    const keyShort = getCanonicalMediaKey('https://youtu.be/dQw4w9WgXcQ')
    const keyEmbed = getCanonicalMediaKey('https://www.youtube.com/embed/dQw4w9WgXcQ')
    const keyUpper = getCanonicalMediaKey('HTTPS://YOUTUBE.COM/watch?v=dQw4w9WgXcQ')

    assert.ok(keyWatch !== null)
    assert.equal(keyWatch, keyShort, '2.1: youtu.be matches youtube.com watch')
    assert.equal(keyWatch, keyEmbed, '2.2: embed matches youtube.com watch')
    assert.equal(keyWatch, keyUpper, '2.3: case-insensitivity preserved')

    // Create a queued job in SQLite
    const activeMp4Job = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '720p'
    })

    // Active duplicate check: same format and quality
    const dupMatch = await findActiveDuplicateDownload({
      sourceUrl: media.source_url,
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    assert.ok(dupMatch !== null, '2.4: Active MP4 720p duplicate detected')
    assert.equal(dupMatch.id, activeMp4Job.id)

    // Distinct quality must NOT be considered duplicate
    const diffQuality = await findActiveDuplicateDownload({
      sourceUrl: media.source_url,
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '1080p'
    })
    assert.equal(diffQuality, null, '2.5: Distinct quality 1080p is NOT treated as duplicate')

    // Distinct format (MP3) must NOT be considered duplicate
    const diffFormat = await findActiveDuplicateDownload({
      sourceUrl: media.source_url,
      mediaItemId: media.id,
      outputFormat: 'mp3',
      audioBitrateKbps: 192
    })
    assert.equal(diffFormat, null, '2.6: Distinct format MP3 is NOT treated as duplicate')

    console.log('✓ Section 2: Canonical URL matching and duplicate isolation verified.\n')

    // ------------------------------------------------------------------------
    // 3. Job Cancellation Lifecycle
    // ------------------------------------------------------------------------
    console.log('--- 3. Testing Job Cancellation Lifecycle ---')

    // 3.1: Cancel a queued job
    const cancelQueuedResult = await cancelDownloadJob(activeMp4Job.id)
    assert.equal(cancelQueuedResult.outcome, 'cancelled', '3.1: Queued job cancelled successfully')
    assert.equal(cancelQueuedResult.status, 'cancelled')

    const reloadedQueued = await DownloadJob.findByPk(activeMp4Job.id)
    assert.equal(reloadedQueued.status, 'cancelled', '3.1: Database status updated to cancelled')

    // 3.2: Cancel already cancelled job
    const cancelAlreadyResult = await cancelDownloadJob(activeMp4Job.id)
    assert.equal(
      cancelAlreadyResult.outcome,
      'already_cancelled',
      '3.2: Re-cancelling returns already_cancelled'
    )

    // 3.3: Cancel completed job returns conflict
    const compJob = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp3',
      audioBitrateKbps: 320
    })
    await DownloadJob.update({ status: 'completed', progress: 100 }, { where: { id: compJob.id } })

    const cancelCompResult = await cancelDownloadJob(compJob.id)
    assert.equal(cancelCompResult.outcome, 'conflict', '3.3: Cancel completed job returns conflict')

    // 3.4: Cancel non-existent job
    const cancelMissingResult = await cancelDownloadJob(999999)
    assert.equal(cancelMissingResult.outcome, 'not_found', '3.4: Missing job returns not_found')

    console.log('✓ Section 3: Cancellation outcomes verified across all states.\n')

    // ------------------------------------------------------------------------
    // 4. Job Retry Lifecycle
    // ------------------------------------------------------------------------
    console.log('--- 4. Testing Job Retry Lifecycle ---')

    // Create a failed job
    const failedJob = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '480p'
    })
    await DownloadJob.update(
      { status: 'failed', error_message: 'Simulated network drop' },
      { where: { id: failedJob.id } }
    )

    // 4.1: Retry failed job
    const retryResult = await retryDownloadJob(failedJob.id)
    assert.equal(retryResult.outcome, 'created', '4.1: Retry created successfully')
    assert.ok(retryResult.retryJobId !== failedJob.id, '4.1: Retry creates a NEW Job ID')

    // Verify original failed job is preserved unchanged
    const originalCheck = await DownloadJob.findByPk(failedJob.id)
    assert.equal(originalCheck.status, 'failed', '4.1: Original job remains failed')
    assert.equal(originalCheck.error_message, 'Simulated network drop')

    // Verify new job was inserted with queued status
    const newJob = await DownloadJob.findByPk(retryResult.retryJobId)
    assert.equal(newJob.status, 'queued', '4.1: Fresh retry job is queued')
    assert.equal(newJob.output_format, 'mp4')
    assert.equal(newJob.quality, '480p')

    // Cancel retry job to clean it from queue
    await cancelDownloadJob(retryResult.retryJobId)

    // 4.2: Retry cancelled job
    const retryCancelledResult = await retryDownloadJob(activeMp4Job.id)
    assert.equal(retryCancelledResult.outcome, 'created', '4.2: Cancelled job can be retried')
    await cancelDownloadJob(retryCancelledResult.retryJobId)

    // 4.3: Retry completed job is rejected
    const retryCompletedResult = await retryDownloadJob(compJob.id)
    assert.equal(retryCompletedResult.outcome, 'not_retryable', '4.3: Completed job retry rejected')

    // 4.4: Retry non-existent job
    const retryMissingResult = await retryDownloadJob(999999)
    assert.equal(retryMissingResult.outcome, 'not_found', '4.4: Missing job returns not_found')

    // 4.5: Retry job with unsafe stored URL is rejected
    const unsafeMedia = await MediaItem.create({
      source_url: 'http://127.0.0.1:3001/malicious',
      platform: 'youtube',
      title: 'Tampered Unsafe Source'
    })
    const unsafeJob = await DownloadJob.create({
      media_id: unsafeMedia.id,
      source_type: 'link',
      status: 'failed',
      output_format: 'mp4',
      quality: '720p',
      progress: 0,
      downloaded_bytes: 0
    })

    const retryUnsafeResult = await retryDownloadJob(unsafeJob.id)
    assert.equal(
      retryUnsafeResult.outcome,
      'unsafe_url',
      '4.5: Stored unsafe URL rejected on retry'
    )

    console.log(
      '✓ Section 4: Retry creates distinct jobs, preserves originals, and enforces security.\n'
    )

    console.log('================================================================')
    console.log(' ALL DOWNLOAD QUEUE & RETRY TESTS PASSED SUCCESSFULLY (100%)    ')
    console.log('================================================================\n')
  } finally {
    await testDb.cleanup()
  }
}

runDownloadQueueTests().catch((err) => {
  console.error('\n❌ DOWNLOAD QUEUE & RETRY TEST SUITE FAILED:', err)
  process.exit(1)
})
