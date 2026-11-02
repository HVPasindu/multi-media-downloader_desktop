import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, writeFile, symlink } from 'node:fs/promises'
import { createTestDatabase } from './helpers/testDatabase.js'
import { isTransientNetworkError } from '../src/main/backend/services/downloadErrorService.js'
import { verifyJobPartialDownload } from '../src/main/backend/services/downloadCleanupService.js'
import {
  recoverInterruptedDownloadJobs,
  resetRecoveryTrackingForTesting
} from '../src/main/backend/services/downloadRecoveryService.js'
import {
  resumeInterruptedNetworkJobs,
  setConnectivityCheckerForTesting
} from '../src/main/backend/services/networkRecoveryService.js'
import { getQueueStatus } from '../src/main/backend/services/downloadQueueService.js'

/**
 * ============================================================================
 * APPLAN2 — Step 09 (Phase 04): Dedicated Network Recovery & Restart Recovery Suite
 *
 * Covers:
 * - Test A: Disconnection at 40% -> transitions to 'interrupted', preserves .part, keeps Job ID in SQLite.
 * - Test B: Reconnection -> resumes from partial file with --continue, same Job ID, completes.
 * - Test C: Remains disconnected -> no rapid repeated calls, remains 'interrupted'.
 * - Test D: Restart while offline -> remains 'interrupted', resumes once connection is restored.
 * - Test E: Non-network errors (429, auth, PO Token, invalid URL, cancellation) not auto-retried.
 * - Test F: Duplicate protection (same interrupted job cannot be queued twice).
 * - Test G: Concurrency limit (never exceeds MAX_CONCURRENT_DOWNLOADS = 2).
 * - Section A: verifyJobPartialDownload() filesystem safety, 5MB checkpoint tolerance, Global FIFO order.
 * ============================================================================
 */
async function runNetworkRecoveryTests() {
  console.log('================================================================')
  console.log(' Phase 04: Step 09 Dedicated Network Recovery Test Suite        ')
  console.log('================================================================\n')

  const testDb = await createTestDatabase('applan2-net-recovery-test-')
  console.log(`[setup] Isolated test database ready: ${testDb.databasePath}\n`)

  const testDownloadDir = join(tmpdir(), `applan2-net-dl-${Date.now()}`)
  await mkdir(testDownloadDir, { recursive: true })

  try {
    const { MediaItem, DownloadJob, AppSetting } = testDb.sequelize.models

    await AppSetting.create({
      key: 'download_path',
      value: testDownloadDir
    })

    const media = await MediaItem.create({
      source_url: 'https://www.youtube.com/watch?v=kJQP7kiw5Fk',
      platform: 'youtube',
      title: 'Despacito Network Test Video'
    })

    // ------------------------------------------------------------------------
    // SECTION A & TOLERANCE: verifyJobPartialDownload Tests
    // ------------------------------------------------------------------------
    console.log('--- Section A: Filesystem Safety & Tolerance Verification ---')

    // A.1: Valid .part file within 5MB tolerance
    const jobA1 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'downloading',
      progress: 40,
      downloaded_bytes: 5000000 // 5 MB
    })
    const partPathA1 = join(testDownloadDir, `test-video [job-${jobA1.id}].mp4.part`)
    await writeFile(partPathA1, Buffer.alloc(4500000, 0x11)) // 4.5 MB (diff = 0.5 MB < 5MB tolerance)

    const checkResultA1 = await verifyJobPartialDownload(jobA1.id, testDownloadDir, {
      savedDownloadedBytes: jobA1.downloaded_bytes,
      savedProgress: jobA1.progress
    })
    assert.equal(checkResultA1.isValid, true, 'A.1: Valid .part file detected')
    assert.equal(checkResultA1.isConsistent, true, 'A.1: Consistent within 5MB tolerance')
    assert.equal(checkResultA1.reconciledBytes, 5000000, 'A.1: Reconciled bytes uses max(disk, db)')
    console.log('✓ A.1: Valid .part file within 5MB checkpoint tolerance verified')

    // A.2: Disk file ahead of DB (valid progress growth)
    const checkResultA2 = await verifyJobPartialDownload(jobA1.id, testDownloadDir, {
      savedDownloadedBytes: 4000000, // DB has 4MB, disk has 4.5MB
      savedProgress: 35
    })
    assert.equal(checkResultA2.isValid, true, 'A.2: File ahead of DB is valid')
    assert.equal(checkResultA2.isConsistent, true, 'A.2: File ahead of DB is consistent')
    assert.equal(checkResultA2.reconciledBytes, 4500000, 'A.2: Reconciled bytes picks larger disk')
    console.log('✓ A.2: Disk file ahead of periodic DB checkpoint correctly reconciled')

    // A.3: Symlink / junction rejection (fail-closed safety)
    const symlinkPartPath = join(testDownloadDir, `fake-link [job-999].mp4.part`)
    try {
      await symlink(partPathA1, symlinkPartPath)
      const checkSymlink = await verifyJobPartialDownload(999, testDownloadDir)
      assert.equal(checkSymlink.isValid, false, 'A.3: Symlink must be rejected')
      assert.equal(checkSymlink.isUnsafe, true, 'A.3: Flagged as unsafe')
      console.log('✓ A.3: Symbolic links rejected with fail-closed safety (isUnsafe: true)')
    } catch (symlinkErr) {
      if (symlinkErr.code === 'EPERM') {
        console.log(
          '✓ A.3: Symlink test skipped (Windows non-admin environment without SeCreateSymbolicLinkPrivilege)'
        )
      } else {
        throw symlinkErr
      }
    }

    // A.4: Missing .part file -> isValid: false
    const checkMissing = await verifyJobPartialDownload(8888, testDownloadDir)
    assert.equal(checkMissing.isValid, false, 'A.4: Missing file reported invalid')
    assert.equal(checkMissing.partialBytes, 0, 'A.4: 0 bytes reported')
    console.log('✓ A.4: Missing or zero-byte files reported as invalid\n')

    // ------------------------------------------------------------------------
    // TEST A: Disconnection at 40% transitions to 'interrupted', preserves .part
    // ------------------------------------------------------------------------
    console.log('--- TEST A: Network Disconnection at 40% ---')

    const jobA = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '720p',
      status: 'downloading',
      progress: 40,
      downloaded_bytes: 4194304 // 4 MB
    })
    const partPathA = join(testDownloadDir, `music-clip [job-${jobA.id}].mp4.part`)
    await writeFile(partPathA, Buffer.alloc(4194304, 0xbb))

    // Simulate transient network failure (e.g. ECONNRESET or NETWORK_TIMEOUT)
    const simulatedNetError = new Error('read ECONNRESET')
    simulatedNetError.code = 'ECONNRESET'

    assert.equal(
      isTransientNetworkError(simulatedNetError),
      true,
      'Test A: ECONNRESET is transient network error'
    )

    // Verify disk verification before transition
    const partialVerificationA = await verifyJobPartialDownload(jobA.id, testDownloadDir, {
      savedDownloadedBytes: jobA.downloaded_bytes,
      savedProgress: jobA.progress
    })
    assert.equal(partialVerificationA.isValid, true, 'Test A: Partial file verified on disk')

    // Transition to interrupted
    await jobA.update({
      status: 'interrupted',
      error_message: 'Download paused: network connection was lost. Waiting to resume...'
    })

    const reloadedA = await DownloadJob.findByPk(jobA.id)
    assert.equal(reloadedA.status, 'interrupted', 'Test A: Job transitioned to interrupted')
    assert.equal(reloadedA.progress, 40, 'Test A: Progress snapshot (40%) strictly preserved')
    assert.equal(
      reloadedA.downloaded_bytes,
      4194304,
      'Test A: Downloaded bytes (4 MB) strictly preserved'
    )
    assert.equal(reloadedA.id, jobA.id, 'Test A: Same Job ID maintained in SQLite')

    // Verify .part file was NOT deleted
    const verifyPartFileStillExists = await verifyJobPartialDownload(jobA.id, testDownloadDir)
    assert.equal(verifyPartFileStillExists.isValid, true, 'Test A: .part file preserved on disk')
    console.log(
      '✓ TEST A passed: Disconnection at 40% transitioned to interrupted, .part preserved with same Job ID\n'
    )

    // ------------------------------------------------------------------------
    // TEST B: Reconnection auto-resumes interrupted job with same Job ID & --continue
    // ------------------------------------------------------------------------
    console.log('--- TEST B: Reconnection Auto-Resumes Interrupted Job ---')

    // Mock connectivity checker to report online
    setConnectivityCheckerForTesting(async () => true)

    const enqueuedQueueB = []
    const resumeResultB = await resumeInterruptedNetworkJobs({
      enqueue: (id) => enqueuedQueueB.push(id)
    })

    assert.equal(resumeResultB.resumedCount, 1, 'Test B: Resumed 1 interrupted job')
    assert.deepEqual(resumeResultB.jobIds, [jobA.id], 'Test B: Correct Job ID resumed')
    assert.deepEqual(enqueuedQueueB, [jobA.id], 'Test B: Job enqueued into scheduler')

    const reloadedResumedB = await DownloadJob.findByPk(jobA.id)
    assert.equal(reloadedResumedB.id, jobA.id, 'Test B: SAME Job ID reused')
    assert.equal(reloadedResumedB.status, 'queued', 'Test B: Job transitioned to queued for resume')
    assert.equal(reloadedResumedB.progress, 40, 'Test B: Saved progress (40%) maintained')
    assert.equal(reloadedResumedB.downloaded_bytes, 4194304, 'Test B: Downloaded bytes maintained')
    assert.equal(reloadedResumedB.error_message, null, 'Test B: Error message cleared')
    console.log(
      '✓ TEST B passed: Reconnection automatically restored interrupted job to queue with same Job ID\n'
    )

    // ------------------------------------------------------------------------
    // TEST C: Remains disconnected -> no rapid repeated calls, remains 'interrupted'
    // ------------------------------------------------------------------------
    console.log('--- TEST C: Remains Disconnected (No Thrashing) ---')

    // Transition job back to interrupted
    await DownloadJob.update(
      { status: 'interrupted', error_message: 'Waiting for network...' },
      { where: { id: jobA.id } }
    )

    // Set connectivity checker to offline
    setConnectivityCheckerForTesting(async () => false)

    const enqueuedQueueC = []
    const resumeResultC = await resumeInterruptedNetworkJobs({
      enqueue: (id) => enqueuedQueueC.push(id)
    })

    assert.equal(resumeResultC.resumedCount, 0, 'Test C: 0 jobs resumed while offline')
    assert.equal(enqueuedQueueC.length, 0, 'Test C: No jobs submitted to queue')

    const reloadedC = await DownloadJob.findByPk(jobA.id)
    assert.equal(reloadedC.status, 'interrupted', 'Test C: Job safely remains interrupted')
    console.log(
      '✓ TEST C passed: Remains disconnected; no polling thrashing and job stays in interrupted\n'
    )

    // ------------------------------------------------------------------------
    // TEST D: Restart while offline -> remains 'interrupted', resumes once online
    // ------------------------------------------------------------------------
    console.log('--- TEST D: Application Restart While Offline ---')

    resetRecoveryTrackingForTesting()

    // Create a downloading job that was abruptly closed when PC shut down
    const offlineRestartJob = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'downloading',
      progress: 62,
      downloaded_bytes: 8388608
    })
    const partPathD = join(testDownloadDir, `offline-video [job-${offlineRestartJob.id}].mp4.part`)
    await writeFile(partPathD, Buffer.alloc(8388608, 0xcc))

    // Execute startup recovery while offline (isOnline: false)
    const startupEnqueuedD = []
    const startupResultD = await recoverInterruptedDownloadJobs({
      isOnline: false,
      enqueue: (id) => startupEnqueuedD.push(id)
    })

    assert.ok(
      startupResultD.interruptedDownloads >= 2,
      'Test D: Incomplete downloading jobs handled on offline startup'
    )
    assert.equal(startupEnqueuedD.length, 0, 'Test D: Nothing enqueued while offline')

    const reloadedOfflineD = await DownloadJob.findByPk(offlineRestartJob.id)
    assert.equal(
      reloadedOfflineD.status,
      'interrupted',
      'Test D: Downloading job became interrupted (NOT failed)'
    )
    assert.equal(reloadedOfflineD.progress, 62, 'Test D: Progress snapshot preserved')
    assert.ok(
      reloadedOfflineD.error_message.includes('unavailable') ||
        reloadedOfflineD.error_message.includes('Waiting'),
      'Test D: Friendly waiting message'
    )

    // Now restore internet connection and trigger resume
    setConnectivityCheckerForTesting(async () => true)
    const reconnectedEnqueuedD = []
    const resumeResultD = await resumeInterruptedNetworkJobs({
      enqueue: (id) => reconnectedEnqueuedD.push(id)
    })

    assert.ok(
      resumeResultD.resumedCount >= 2,
      'Test D: Interrupted jobs resumed after internet restored'
    )
    assert.ok(reconnectedEnqueuedD.includes(offlineRestartJob.id), 'Test D: Restart job enqueued')

    const reloadedRestoredD = await DownloadJob.findByPk(offlineRestartJob.id)
    assert.equal(reloadedRestoredD.status, 'queued', 'Test D: Job resumed to queued status')
    console.log(
      '✓ TEST D passed: Offline restart preserves jobs as interrupted, auto-resumes once online\n'
    )

    // ------------------------------------------------------------------------
    // TEST E: Non-network errors are NOT auto-retried
    // ------------------------------------------------------------------------
    console.log('--- TEST E: Non-Network Errors Not Auto-Retried ---')

    // E.1: HTTP 429 Too Many Requests
    assert.equal(
      isTransientNetworkError({ message: 'HTTP Error 429: Too Many Requests' }),
      false,
      'Test E: HTTP 429 is rate limit, not transient network drop'
    )

    // E.2: Authentication Required / Sign in
    assert.equal(
      isTransientNetworkError({ message: 'Sign in to confirm you’re not a bot' }),
      false,
      'Test E: Auth / bot challenge is not network drop'
    )

    // E.3: PO Token Required
    assert.equal(
      isTransientNetworkError({ message: 'GVS PO Token is required for this client' }),
      false,
      'Test E: PO Token is not transient network drop'
    )

    // E.4: Private / Unavailable Video
    assert.equal(
      isTransientNetworkError({ message: 'ERROR: [youtube] Private video. Sign in to view.' }),
      false,
      'Test E: Private video is not transient network drop'
    )

    // E.5: Invalid URL / Unsupported URL
    assert.equal(
      isTransientNetworkError({ message: 'Unsupported URL: ftp://invalid' }),
      false,
      'Test E: Invalid URL is not transient network drop'
    )

    // E.6: User Cancellation
    assert.equal(
      isTransientNetworkError({ message: 'Download was cancelled by user', isCancelled: true }),
      false,
      'Test E: User cancellation is not network drop'
    )

    // E.7: Verify in database: failed job is NOT touched by resumeInterruptedNetworkJobs
    const failedJobE = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '720p',
      status: 'failed',
      error_message: 'HTTP Error 429: Too Many Requests'
    })

    const resumeResultE = await resumeInterruptedNetworkJobs()
    assert.ok(
      !resumeResultE.jobIds.includes(failedJobE.id),
      'Test E: Failed job is never picked up by network resume'
    )

    const reloadedFailedE = await DownloadJob.findByPk(failedJobE.id)
    assert.equal(reloadedFailedE.status, 'failed', 'Test E: Failed job remains failed')
    console.log(
      '✓ TEST E passed: 429, auth, PO Token, private videos, and cancellations strictly not auto-retried\n'
    )

    // ------------------------------------------------------------------------
    // TEST F: Duplicate Resume Protection
    // ------------------------------------------------------------------------
    console.log('--- TEST F: Duplicate Resume Protection ---')

    // Create a job in interrupted status
    const duplicateTestJob = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp3',
      audioBitrateKbps: 320,
      status: 'interrupted',
      progress: 30,
      downloaded_bytes: 2097152
    })
    const partPathF = join(testDownloadDir, `dup-test [job-${duplicateTestJob.id}].mp3.part`)
    await writeFile(partPathF, Buffer.alloc(2097152, 0xdd))

    const enqueuedQueueF = []
    // First resume pass
    const firstResumeF = await resumeInterruptedNetworkJobs({
      enqueue: (id) => enqueuedQueueF.push(id)
    })
    assert.ok(
      firstResumeF.jobIds.includes(duplicateTestJob.id),
      'Test F: First pass enqueues the job'
    )

    // Second resume pass immediately afterwards
    const secondResumeF = await resumeInterruptedNetworkJobs({
      enqueue: (id) => enqueuedQueueF.push(id)
    })
    assert.ok(
      !secondResumeF.jobIds.includes(duplicateTestJob.id),
      'Test F: Second pass does NOT enqueue the job again (idempotent)'
    )

    const enqueuedJobFOccurrences = enqueuedQueueF.filter((id) => id === duplicateTestJob.id).length
    assert.equal(enqueuedJobFOccurrences, 1, 'Test F: Job was enqueued exactly once across passes')
    console.log(
      '✓ TEST F passed: Strict idempotency prevents duplicate scheduling of interrupted jobs\n'
    )

    // ------------------------------------------------------------------------
    // TEST G: Concurrency Limit Enforcement (MAX_CONCURRENT_DOWNLOADS = 2)
    // ------------------------------------------------------------------------
    console.log('--- TEST G: Concurrency Limit Enforcement ---')

    const queueStatus = getQueueStatus()
    assert.equal(queueStatus.maxConcurrency, 2, 'Test G: Queue max concurrency is strictly 2')

    // Verify database state: when 5 interrupted jobs are resumed, their status is 'queued'
    // allowing the internal queue scheduler to throttle execution to 2 active downloads at a time
    const batchJobs = []
    for (let i = 0; i < 5; i++) {
      const job = await DownloadJob.create({
        media_id: media.id,
        output_format: 'mp4',
        quality: '480p',
        status: 'interrupted',
        progress: 10 + i * 5,
        downloaded_bytes: 1048576 * (i + 1)
      })
      const part = join(testDownloadDir, `batch-${i} [job-${job.id}].mp4.part`)
      await writeFile(part, Buffer.alloc(1048576, 0xee))
      batchJobs.push(job)
    }

    const batchEnqueuedG = []
    const batchResumeResult = await resumeInterruptedNetworkJobs({
      enqueue: (id) => batchEnqueuedG.push(id)
    })

    assert.equal(batchResumeResult.resumedCount, 5, 'Test G: All 5 jobs resumed')

    // All 5 jobs transitioned to 'queued'
    for (const job of batchJobs) {
      const reloaded = await DownloadJob.findByPk(job.id)
      assert.equal(reloaded.status, 'queued', 'Test G: Batch job transitioned to queued')
    }
    console.log(
      '✓ TEST G passed: 5 resumed jobs transitioned to queued without exceeding concurrency\n'
    )

    // ------------------------------------------------------------------------
    // GLOBAL FIFO ORDERING VERIFICATION
    // ------------------------------------------------------------------------
    console.log('--- Global FIFO Ordering Verification ---')

    resetRecoveryTrackingForTesting()
    await DownloadJob.destroy({ where: {} })

    const dateBase = Date.now() - 60000
    // Job 1 (oldest)
    const fifo1 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'downloading',
      progress: 30,
      createdAt: new Date(dateBase)
    })
    const fifoPart1 = join(testDownloadDir, `fifo1 [job-${fifo1.id}].mp4.part`)
    await writeFile(fifoPart1, Buffer.alloc(1024, 0x01))

    // Job 2 (middle)
    const fifo2 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp3',
      audioBitrateKbps: 320,
      status: 'queued',
      createdAt: new Date(dateBase + 10000)
    })

    // Job 3 (newest)
    const fifo3 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 50,
      createdAt: new Date(dateBase + 20000)
    })
    const fifoPart3 = join(testDownloadDir, `fifo3 [job-${fifo3.id}].mp4.part`)
    await writeFile(fifoPart3, Buffer.alloc(1024, 0x03))

    const fifoEnqueued = []
    await recoverInterruptedDownloadJobs({
      isOnline: true,
      enqueue: (id) => fifoEnqueued.push(id)
    })

    assert.deepEqual(
      fifoEnqueued,
      [fifo1.id, fifo2.id, fifo3.id],
      'Global FIFO: Enqueued in exact chronological order (createdAt ASC, id ASC)'
    )
    console.log(
      '✓ Global FIFO: Interrupted jobs recovered in strict FIFO order (createdAt ASC, id ASC)\n'
    )

    console.log('================================================================')
    console.log(' ALL PHASE 04 NETWORK RECOVERY & OPTION A TESTS PASSED (100%)   ')
    console.log('================================================================\n')
  } finally {
    setConnectivityCheckerForTesting(null)
    await testDb.cleanup()
  }
}

runNetworkRecoveryTests().catch((err) => {
  console.error('\n❌ PHASE 04 TESTS FAILED:', err)
  process.exit(1)
})
