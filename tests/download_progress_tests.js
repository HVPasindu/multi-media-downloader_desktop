import assert from 'node:assert/strict'
import {
  parseYtDlpProgressLine,
  createMultiStreamProgressTracker,
  calculateMp4OverallProgress,
  calculateOverallDownloadProgress,
  updateDownloadJobProgress,
  updateDownloadJobDownloadedBytes,
  createDownloadJob,
  markDownloadJobCompleted,
  markDownloadJobCancelled,
  markDownloadJobFailed
} from '../src/main/backend/services/downloadService.js'
import { createTestDatabase } from './helpers/testDatabase.js'

/**
 * ============================================================================
 * APPLAN2 — Step 04.44 Automated Test Group C: Download Progress Tests
 *
 * Covers:
 * - Line-by-line yt-dlp stdout progress parsing (valid, 0%, 100%, malformed)
 * - Multi-stream MP4 progress tracking and weighted calculation
 * - Non-decreasing and <= 100% progress invariants
 * - Terminal job status protection (late progress events cannot resurrect terminal jobs)
 * - Downloaded bytes updates
 * ============================================================================
 */
async function runDownloadProgressTests() {
  console.log('================================================================')
  console.log(' APPLAN2 — Step 04.44 Test Group C: Download Progress Test Suite')
  console.log('================================================================\n')

  const testDb = await createTestDatabase('applan2-progress-test-')
  console.log(`[setup] Isolated test database ready: ${testDb.databasePath}\n`)

  try {
    const { MediaItem, DownloadJob } = testDb.sequelize.models

    // ------------------------------------------------------------------------
    // 1. Line-by-line progress parsing (parseYtDlpProgressLine)
    // ------------------------------------------------------------------------
    console.log('--- 1. Testing yt-dlp Progress Line Parsing ---')

    // Standard percentage parsing
    assert.equal(
      parseYtDlpProgressLine('[download]  45.5% of ~  20.00MiB at  2.50MiB/s ETA 00:04'),
      45.5,
      '1.1: Standard percentage parsed correctly'
    )

    // 0.0% starting percentage
    assert.equal(
      parseYtDlpProgressLine('[download]   0.0% of 10.00MiB at Unknown speed ETA Unknown'),
      0,
      '1.2: 0.0% progress parsed correctly'
    )

    // 100% completion percentage
    assert.equal(
      parseYtDlpProgressLine('[download] 100% of 15.00MiB in 00:02'),
      100,
      '1.3: 100% progress parsed correctly'
    )

    // Decimal with 100.0%
    assert.equal(
      parseYtDlpProgressLine('[download] 100.0% of 25.12MiB in 00:03 at 8.21MiB/s'),
      100,
      '1.4: 100.0% parsed as 100'
    )

    // Malformed and unrelated output lines must return null
    assert.equal(
      parseYtDlpProgressLine('[ffmpeg] Destination: output.mp4'),
      null,
      '1.5: FFmpeg line returns null'
    )
    assert.equal(
      parseYtDlpProgressLine('[info] Extracting URL: https://example.com'),
      null,
      '1.6: Info line returns null'
    )
    assert.equal(parseYtDlpProgressLine(''), null, '1.7: Empty line returns null')
    assert.equal(parseYtDlpProgressLine(null), null, '1.8: Null line returns null')
    assert.equal(parseYtDlpProgressLine(undefined), null, '1.9: Undefined line returns null')
    assert.equal(
      parseYtDlpProgressLine('[download] Destination: clip.f137.mp4'),
      null,
      '1.10: Destination line without percentage returns null'
    )

    console.log(
      '✓ Section 1: Progress line parsing verified for standard, edge, and malformed lines.\n'
    )

    // ------------------------------------------------------------------------
    // 2. Single-stream and overall progress calculation
    // ------------------------------------------------------------------------
    console.log('--- 2. Testing Single-Stream Progress Calculation ---')

    // MP3 single-stream progress maps 0-100% stream download to 0-90% overall (leaving 10% for FFmpeg conversion)
    assert.equal(
      calculateOverallDownloadProgress('mp3', 50),
      45,
      '2.1: MP3 stream 50% maps to 45% overall (0.9 weight)'
    )
    assert.equal(
      calculateOverallDownloadProgress('mp3', 100),
      90,
      '2.2: MP3 stream 100% maps to 90% overall'
    )

    // MP4 single-stream returns null because it requires multi-stream calculation
    assert.equal(
      calculateOverallDownloadProgress('mp4', 50),
      null,
      '2.3: MP4 returns null as it requires multi-stream calculation'
    )

    // Null or invalid stream percent returns null
    assert.equal(
      calculateOverallDownloadProgress('mp3', null),
      null,
      '2.4: Null stream percent returns null'
    )
    assert.equal(
      calculateOverallDownloadProgress('mp3', -5),
      null,
      '2.5: Negative stream percent returns null'
    )
    assert.equal(
      calculateOverallDownloadProgress('mp3', 150),
      null,
      '2.6: Over 100% stream percent returns null'
    )
    assert.throws(
      () => calculateOverallDownloadProgress('unsupported_format', 50),
      /Unsupported output format/,
      '2.7: Unsupported output format throws error'
    )

    console.log('✓ Section 2: Single-stream progress calculation and bounds verified.\n')

    // ------------------------------------------------------------------------
    // 3. Multi-stream MP4 Progress Tracker
    // ------------------------------------------------------------------------
    console.log('--- 3. Testing Multi-Stream MP4 Progress Tracker ---')

    const tracker = createMultiStreamProgressTracker()
    assert.ok(typeof tracker.consumeLine === 'function')
    assert.ok(typeof tracker.getSnapshot === 'function')

    // Initially empty snapshot
    const initialSnapshot = tracker.getSnapshot()
    assert.deepEqual(initialSnapshot.streams, [], '3.1: Initial multi-stream streams list is empty')

    // Stream 1 (video) event arrives
    const videoLine =
      '[download]  50.0% of ~  20.00MiB at  2.50MiB/s ETA 00:04 APPLAN2_PROGRESS: {"filename":"video.f137.mp4","status":"downloading","downloaded_bytes":10485760,"total_bytes":20971520}'
    const snap1 = tracker.consumeLine(videoLine)
    assert.ok(snap1 !== null, '3.2: Structured progress line consumed')
    assert.equal(snap1.streams.length, 1)
    assert.equal(snap1.streams[0].filename, 'video.f137.mp4')
    assert.equal(snap1.streams[0].percent, 50)

    const calc1 = calculateMp4OverallProgress(snap1)
    // 50% * 0.45 = 22.5%
    assert.equal(calc1, 22.5, '3.3: Video 50% yields 22.5% overall')

    // Stream 1 finishes
    const videoFinishLine =
      '[download] 100% of 20.00MiB in 00:05 APPLAN2_PROGRESS: {"filename":"video.f137.mp4","status":"finished","downloaded_bytes":20971520,"total_bytes":20971520}'
    const snap2 = tracker.consumeLine(videoFinishLine)
    const calc2 = calculateMp4OverallProgress(snap2)
    // 100% * 0.45 = 45%
    assert.equal(calc2, 45, '3.4: Video 100% yields 45% overall')

    // Stream 2 (audio) arrives
    const audioLine =
      '[download]  50.0% of ~  5.00MiB at  1.00MiB/s ETA 00:02 APPLAN2_PROGRESS: {"filename":"audio.f140.m4a","status":"downloading","downloaded_bytes":2621440,"total_bytes":5242880}'
    const snap3 = tracker.consumeLine(audioLine)
    const calc3 = calculateMp4OverallProgress(snap3)
    // 45% + 50% * 0.45 = 45 + 22.5 = 67.5%
    assert.equal(calc3, 67.5, '3.5: Video 100% + Audio 50% yields 67.5% overall')

    // Stream 2 finishes
    const audioFinishLine =
      '[download] 100% of 5.00MiB in 00:01 APPLAN2_PROGRESS: {"filename":"audio.f140.m4a","status":"finished","downloaded_bytes":5242880,"total_bytes":5242880}'
    const snap4 = tracker.consumeLine(audioFinishLine)
    const calc4 = calculateMp4OverallProgress(snap4)
    // 45% + 45% = 90%
    assert.equal(calc4, 90, '3.6: Both streams 100% yields 90% overall')

    // Postprocessor Merger event
    const postprocessLine = 'APPLAN2_POSTPROCESS: {"status":"finished","postprocessor":"Merger"}'
    const snap5 = tracker.consumeLine(postprocessLine)
    const calc5 = calculateMp4OverallProgress(snap5)
    assert.equal(calc5, 95, '3.7: Merger finished advances progress to 95%')

    // MoveFiles finished event advances to 99%
    const moveFilesLine = 'APPLAN2_POSTPROCESS: {"status":"finished","postprocessor":"MoveFiles"}'
    const snap6 = tracker.consumeLine(moveFilesLine)
    const calc6 = calculateMp4OverallProgress(snap6)
    assert.equal(calc6, 99, '3.8: MoveFiles finished advances to 99% (reserved for completion)')

    console.log('✓ Section 3: Multi-stream weighted progress tracking verified.\n')

    // ------------------------------------------------------------------------
    // 4. Terminal status protection against late progress events
    // ------------------------------------------------------------------------
    console.log('--- 4. Testing Terminal Job Status Protection ---')

    const media = await MediaItem.create({
      source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      platform: 'youtube',
      title: 'Terminal Status Test Clip'
    })

    // Case A: Completed Job must NOT be downgraded by late progress event
    const completedJob = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    // Move to downloading then completed
    await DownloadJob.update(
      { status: 'downloading', progress: 90 },
      { where: { id: completedJob.id } }
    )
    await markDownloadJobCompleted(completedJob.id)

    // Late progress event arrives (e.g. 50% from an asynchronous buffer flush)
    const updateCompletedResult = await updateDownloadJobProgress(completedJob.id, 50)
    assert.equal(
      updateCompletedResult,
      null,
      '4.1: Late progress rejected for completed job (returns null)'
    )

    const reloadedCompleted = await DownloadJob.findByPk(completedJob.id)
    assert.equal(reloadedCompleted.status, 'completed', '4.1: Status remains completed')
    assert.equal(reloadedCompleted.progress, 100, '4.1: Progress remains 100%')

    // Case B: Cancelled Job must NOT be resurrected to downloading
    const cancelledJob = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    await DownloadJob.update(
      { status: 'downloading', progress: 40 },
      { where: { id: cancelledJob.id } }
    )
    await markDownloadJobCancelled(cancelledJob.id)

    const updateCancelledResult = await updateDownloadJobProgress(cancelledJob.id, 60)
    assert.equal(
      updateCancelledResult,
      null,
      '4.2: Late progress rejected for cancelled job (returns null)'
    )

    const reloadedCancelled = await DownloadJob.findByPk(cancelledJob.id)
    assert.equal(reloadedCancelled.status, 'cancelled', '4.2: Status remains cancelled')

    // Case C: Failed Job must NOT be resurrected
    const failedJob = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    await DownloadJob.update(
      { status: 'downloading', progress: 20 },
      { where: { id: failedJob.id } }
    )
    await markDownloadJobFailed(failedJob.id, new Error('Network error'))

    const updateFailedResult = await updateDownloadJobProgress(failedJob.id, 30)
    assert.equal(
      updateFailedResult,
      null,
      '4.3: Late progress rejected for failed job (returns null)'
    )

    const reloadedFailed = await DownloadJob.findByPk(failedJob.id)
    assert.equal(reloadedFailed.status, 'failed', '4.3: Status remains failed')

    // ------------------------------------------------------------------------
    // 5. Downloaded bytes update
    // ------------------------------------------------------------------------
    console.log('--- 5. Testing Downloaded Bytes Update ---')

    const activeJob = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp3',
      audioBitrateKbps: 192
    })
    await DownloadJob.update({ status: 'downloading' }, { where: { id: activeJob.id } })

    const byteUpdate1 = await updateDownloadJobDownloadedBytes(activeJob.id, 1048576)
    assert.ok(byteUpdate1 !== null, '5.1: Downloaded bytes updated for active job')
    assert.equal(byteUpdate1.downloaded_bytes, 1048576, '5.1: Returned model has updated bytes')

    const reloadedActive = await DownloadJob.findByPk(activeJob.id)
    assert.equal(reloadedActive.downloaded_bytes, 1048576, '5.2: Downloaded bytes persisted')

    console.log('✓ Section 4 & 5: Terminal status protection and byte tracking verified.\n')

    console.log('================================================================')
    console.log(' ALL DOWNLOAD PROGRESS TESTS PASSED SUCCESSFULLY (100% PASS)')
    console.log('================================================================\n')
  } finally {
    await testDb.cleanup()
  }
}

runDownloadProgressTests().catch((err) => {
  console.error('\n❌ DOWNLOAD PROGRESS TEST SUITE FAILED:', err)
  process.exit(1)
})
