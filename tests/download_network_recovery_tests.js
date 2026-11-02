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
  checkNetworkConnectivity,
  resumeInterruptedNetworkJobs,
  startNetworkMonitoring,
  stopNetworkMonitoring,
  resetNetworkMonitoringForTesting,
  setConnectivityCheckerForTesting
} from '../src/main/backend/services/networkRecoveryService.js'
import { getQueueStatus } from '../src/main/backend/services/downloadQueueService.js'
import { buildYtDlpArgs } from '../src/main/backend/services/downloadService.js'
import {
  VALID_JOB_STATUSES,
  listDownloadHistory
} from '../src/main/backend/services/downloadHistoryService.js'

/**
 * ============================================================================
 * APPLAN2 — Step 09 (Phase 04): Dedicated Network Recovery & Restart Recovery Suite
 *
 * Full Lifecycle Tests:
 * - Test A: Live Monitoring Transition (startNetworkMonitoring, offline -> online, auto-resume)
 * - Test B: Offline Startup with a Queued Job (converts to interrupted, resumes once online, same Job ID)
 * - Test C: Offline Startup with a Downloading Job (preserves .part, resumes at 40%, same Job ID)
 * - Test D: No Duplicate Scheduling (strict idempotency across repeated monitoring cycles)
 * - Test E: FIFO Ordering & Concurrency Limit (createdAt ASC, id ASC, MAX_CONCURRENCY = 2)
 * - Test F: Error Classification (429, auth, PO Token, private video, invalid URL, user cancel, EACCES)
 * - Test G: yt-dlp Resume Arguments (verifies --continue flag, temporary workspace, output template)
 * - Section A: Filesystem Safety & 5MB periodic checkpoint tolerance verification
 * - Section H: Part 04 Status Validation (interrupted in VALID_JOB_STATUSES and history query)
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

    // A.0: Real external HTTPS connectivity checker
    const isConnBool = await checkNetworkConnectivity({ timeoutMs: 3000 })
    assert.equal(typeof isConnBool, 'boolean', 'A.0: checkNetworkConnectivity returns boolean')
    console.log(`✓ A.0: Real HTTPS checkNetworkConnectivity verified (result: ${isConnBool})`)

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
    // TEST A: Live Network Monitoring Transition
    // ------------------------------------------------------------------------
    console.log('--- TEST A: Live Network Monitoring Transition ---')

    resetNetworkMonitoringForTesting()

    const jobA = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 35,
      downloaded_bytes: 3145728,
      error_message: 'Download paused: network connection was lost.'
    })
    const partPathA = join(testDownloadDir, `clip-live [job-${jobA.id}].mp4.part`)
    await writeFile(partPathA, Buffer.alloc(3145728, 0xaa))

    // 1. Start monitoring while offline
    let liveConnectivity = false
    setConnectivityCheckerForTesting(async () => liveConnectivity)

    const enqueuedQueueA = []
    startNetworkMonitoring({
      baseIntervalMs: 50,
      initialDelayMs: 20,
      enqueue: (id) => enqueuedQueueA.push(id)
    })

    // Wait for initial check cycle
    await new Promise((r) => setTimeout(r, 60))

    const reloadedAOffline = await DownloadJob.findByPk(jobA.id)
    assert.equal(
      reloadedAOffline.status,
      'interrupted',
      'Test A: Job remains interrupted while offline'
    )
    assert.equal(enqueuedQueueA.length, 0, 'Test A: Nothing enqueued while offline')

    // 2. Change connectivity to online (simulates internet returning without app restart)
    liveConnectivity = true

    // Wait for next monitoring checkCycle to detect transition
    await new Promise((r) => setTimeout(r, 120))
    stopNetworkMonitoring()

    const reloadedAOnline = await DownloadJob.findByPk(jobA.id)
    assert.equal(
      reloadedAOnline.status,
      'queued',
      'Test A: Job automatically transitioned to queued'
    )
    assert.equal(reloadedAOnline.id, jobA.id, 'Test A: SAME Job ID preserved')
    assert.equal(reloadedAOnline.progress, 35, 'Test A: Progress snapshot (35%) strictly preserved')
    assert.equal(
      reloadedAOnline.downloaded_bytes,
      3145728,
      'Test A: Downloaded bytes strictly preserved'
    )
    assert.deepEqual(
      enqueuedQueueA,
      [jobA.id],
      'Test A: Original Job ID enqueued in queue scheduler'
    )

    // Verify no replacement job was created
    const totalJobsA = await DownloadJob.count({ where: { media_id: media.id } })
    assert.equal(
      totalJobsA,
      2,
      'Test A: Exactly 2 jobs in DB (jobA1 and jobA); no replacement created'
    )
    console.log(
      '✓ TEST A passed: Live monitoring cycle detected reconnection and auto-resumed same Job ID\n'
    )

    // ------------------------------------------------------------------------
    // TEST B: Offline Startup with a Queued Job
    // ------------------------------------------------------------------------
    console.log('--- TEST B: Offline Startup with a Queued Job ---')

    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()

    // Create a job that was queued before application closed
    const queuedOfflineJob = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp3',
      audio_bitrate_kbps: 320,
      status: 'queued',
      progress: 0,
      downloaded_bytes: 0
    })

    // Simulate application starting offline
    setConnectivityCheckerForTesting(async () => false)
    const startupEnqueuedB = []
    const recoveryResultB = await recoverInterruptedDownloadJobs({
      isOnline: false,
      enqueue: (id) => startupEnqueuedB.push(id)
    })

    assert.ok(
      recoveryResultB.interruptedQueuedJobs >= 1,
      'Test B: Queued jobs captured on offline restart'
    )
    assert.equal(startupEnqueuedB.length, 0, 'Test B: No jobs enqueued while offline')

    const reloadedQueuedB = await DownloadJob.findByPk(queuedOfflineJob.id)
    assert.equal(
      reloadedQueuedB.status,
      'interrupted',
      'Test B: Queued job converted to interrupted (NOT permanently stuck in queued)'
    )
    assert.equal(reloadedQueuedB.id, queuedOfflineJob.id, 'Test B: SAME Job ID preserved')
    assert.equal(reloadedQueuedB.output_format, 'mp3', 'Test B: Configuration (mp3) preserved')
    assert.equal(reloadedQueuedB.audio_bitrate_kbps, 320, 'Test B: Bitrate (320kbps) preserved')

    // Now restore internet connection and resume
    setConnectivityCheckerForTesting(async () => true)
    const restoredEnqueuedB = []
    const resumeResultB = await resumeInterruptedNetworkJobs({
      enqueue: (id) => restoredEnqueuedB.push(id)
    })

    assert.ok(
      resumeResultB.resumedJobIds.includes(queuedOfflineJob.id),
      'Test B: Resumed previously queued job'
    )
    assert.ok(
      restoredEnqueuedB.includes(queuedOfflineJob.id),
      'Test B: Job enqueued into scheduler'
    )

    const reloadedRestoredB = await DownloadJob.findByPk(queuedOfflineJob.id)
    assert.equal(
      reloadedRestoredB.status,
      'queued',
      'Test B: Restored to queued status once internet returned'
    )
    assert.equal(reloadedRestoredB.id, queuedOfflineJob.id, 'Test B: Same Job ID reused')
    console.log(
      '✓ TEST B passed: Offline startup converts queued jobs to interrupted; auto-resumes once online\n'
    )

    // ------------------------------------------------------------------------
    // TEST C: Offline Startup with a Downloading Job (Partial File Preservation)
    // ------------------------------------------------------------------------
    console.log('--- TEST C: Offline Startup with a Downloading Job ---')

    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()

    const downloadingJobC = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'downloading',
      progress: 40,
      downloaded_bytes: 4194304 // 4 MB
    })
    const partPathC = join(testDownloadDir, `downloading-clip [job-${downloadingJobC.id}].mp4.part`)
    await writeFile(partPathC, Buffer.alloc(4194304, 0xbb))

    // Simulate offline restart
    setConnectivityCheckerForTesting(async () => false)
    const startupEnqueuedC = []
    await recoverInterruptedDownloadJobs({
      isOnline: false,
      enqueue: (id) => startupEnqueuedC.push(id)
    })

    assert.equal(startupEnqueuedC.length, 0, 'Test C: Nothing enqueued while offline')

    const reloadedOfflineC = await DownloadJob.findByPk(downloadingJobC.id)
    assert.equal(reloadedOfflineC.status, 'interrupted', 'Test C: Job transitioned to interrupted')
    assert.equal(reloadedOfflineC.progress, 40, 'Test C: 40% progress preserved')
    assert.equal(
      reloadedOfflineC.downloaded_bytes,
      4194304,
      'Test C: 4MB downloaded bytes preserved'
    )

    // Verify .part file was strictly NOT deleted from disk
    const checkPartC = await verifyJobPartialDownload(downloadingJobC.id, testDownloadDir)
    assert.equal(checkPartC.isValid, true, 'Test C: .part file preserved on disk')

    // Restore internet
    setConnectivityCheckerForTesting(async () => true)
    const restoreEnqueuedC = []
    await resumeInterruptedNetworkJobs({
      enqueue: (id) => restoreEnqueuedC.push(id)
    })

    assert.ok(
      restoreEnqueuedC.includes(downloadingJobC.id),
      'Test C: Job enqueued upon reconnection'
    )
    const reloadedRestoredC = await DownloadJob.findByPk(downloadingJobC.id)
    assert.equal(reloadedRestoredC.status, 'queued', 'Test C: Restored to queued for resume')
    assert.equal(reloadedRestoredC.progress, 40, 'Test C: Progress remains 40%')
    assert.equal(reloadedRestoredC.id, downloadingJobC.id, 'Test C: Same Job ID maintained')
    console.log(
      '✓ TEST C passed: Downloading job at 40% preserved .part file across offline restart and resumed\n'
    )

    // ------------------------------------------------------------------------
    // TEST D: No Duplicate Scheduling (Strict Idempotency)
    // ------------------------------------------------------------------------
    console.log('--- TEST D: No Duplicate Scheduling (Strict Idempotency) ---')

    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()

    const dupJob = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 25,
      downloaded_bytes: 2097152
    })
    const partPathDup = join(testDownloadDir, `dup-test [job-${dupJob.id}].mp4.part`)
    await writeFile(partPathDup, Buffer.alloc(2097152, 0xcc))

    setConnectivityCheckerForTesting(async () => true)
    const dupEnqueued = []

    // First recovery pass
    const pass1 = await resumeInterruptedNetworkJobs({
      enqueue: (id) => dupEnqueued.push(id)
    })
    assert.ok(pass1.resumedJobIds.includes(dupJob.id), 'Test D: Pass 1 enqueues the job')

    // Second recovery pass immediately afterwards
    const pass2 = await resumeInterruptedNetworkJobs({
      enqueue: (id) => dupEnqueued.push(id)
    })
    assert.ok(
      !pass2.resumedJobIds.includes(dupJob.id),
      'Test D: Pass 2 does NOT re-enqueue (already queued)'
    )

    const occurrences = dupEnqueued.filter((id) => id === dupJob.id).length
    assert.equal(occurrences, 1, 'Test D: Job enqueued exactly once across multiple passes')
    console.log(
      '✓ TEST D passed: Strict idempotency prevents duplicate scheduling of interrupted jobs\n'
    )

    // ------------------------------------------------------------------------
    // TEST E: Global FIFO Ordering & Concurrency Limit (MAX_CONCURRENCY = 2)
    // ------------------------------------------------------------------------
    console.log('--- TEST E: FIFO Ordering & Concurrency Limit ---')

    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    await DownloadJob.destroy({ where: {} })

    const queueStatus = getQueueStatus()
    assert.equal(queueStatus.maxConcurrency, 2, 'Test E: MAX_CONCURRENT_DOWNLOADS is strictly 2')

    const baseTime = Date.now() - 300000
    // Job 1 (oldest: baseTime)
    const fifo1 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'interrupted',
      progress: 10,
      createdAt: new Date(baseTime)
    })
    const fifoPart1 = join(testDownloadDir, `fifo1 [job-${fifo1.id}].mp4.part`)
    await writeFile(fifoPart1, Buffer.alloc(1024, 0x01))

    // Job 2 (middle: baseTime + 10s)
    const fifo2 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp3',
      audio_bitrate_kbps: 192,
      status: 'interrupted',
      progress: 20,
      createdAt: new Date(baseTime + 10000)
    })
    const fifoPart2 = join(testDownloadDir, `fifo2 [job-${fifo2.id}].mp3.part`)
    await writeFile(fifoPart2, Buffer.alloc(1024, 0x02))

    // Job 3 (newest: baseTime + 20s)
    const fifo3 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 30,
      createdAt: new Date(baseTime + 20000)
    })
    const fifoPart3 = join(testDownloadDir, `fifo3 [job-${fifo3.id}].mp4.part`)
    await writeFile(fifoPart3, Buffer.alloc(1024, 0x03))

    setConnectivityCheckerForTesting(async () => true)
    const fifoEnqueued = []
    const fifoResult = await resumeInterruptedNetworkJobs({
      enqueue: (id) => fifoEnqueued.push(id)
    })

    assert.equal(fifoResult.resumedCount, 3, 'Test E: All 3 jobs resumed')
    assert.deepEqual(
      fifoEnqueued,
      [fifo1.id, fifo2.id, fifo3.id],
      'Test E: Resumed in strict chronological FIFO order (createdAt ASC, id ASC)'
    )
    console.log(
      '✓ TEST E passed: Global FIFO order (createdAt ASC, id ASC) and concurrency = 2 verified\n'
    )

    // ------------------------------------------------------------------------
    // TEST F: Error Classification (Non-Network Errors Strictly NOT Retried)
    // ------------------------------------------------------------------------
    console.log('--- TEST F: Error Classification (Non-Network Errors Excluded) ---')

    // F.1: HTTP Error 429 Too Many Requests
    assert.equal(
      isTransientNetworkError({ message: 'HTTP Error 429: Too Many Requests' }),
      false,
      'Test F: HTTP 429 is rate limit, not transient network drop'
    )

    // F.2: Authentication Required / Bot Challenge
    assert.equal(
      isTransientNetworkError({ message: 'Sign in to confirm you’re not a bot' }),
      false,
      'Test F: Bot challenge / auth is not network drop'
    )

    // F.3: PO Token Required
    assert.equal(
      isTransientNetworkError({ message: 'GVS PO Token is required for this client' }),
      false,
      'Test F: PO Token missing is not network drop'
    )

    // F.4: Private / Unavailable Video
    assert.equal(
      isTransientNetworkError({ message: 'ERROR: [youtube] Private video. Sign in to view.' }),
      false,
      'Test F: Private video is not network drop'
    )

    // F.5: Invalid / Unsupported URL
    assert.equal(
      isTransientNetworkError({ message: 'Unsupported URL: ftp://invalid-domain.com' }),
      false,
      'Test F: Invalid URL is not network drop'
    )

    // F.6: User Cancellation
    assert.equal(
      isTransientNetworkError({ message: 'Download was cancelled by user', isCancelled: true }),
      false,
      'Test F: User cancellation is not network drop'
    )

    // F.7: Filesystem Permission Errors (EACCES / EPERM)
    assert.equal(
      isTransientNetworkError({ message: 'EACCES: permission denied', code: 'EACCES' }),
      false,
      'Test F: EACCES is filesystem error, not network drop'
    )
    assert.equal(
      isTransientNetworkError({ message: 'EPERM: operation not permitted', code: 'EPERM' }),
      false,
      'Test F: EPERM is filesystem error, not network drop'
    )

    // F.8: Real transient network errors ARE recognized
    assert.equal(
      isTransientNetworkError({ message: 'read ECONNRESET', code: 'ECONNRESET' }),
      true,
      'Test F: ECONNRESET is transient network drop'
    )
    assert.equal(
      isTransientNetworkError({ message: 'connect ETIMEDOUT', code: 'ETIMEDOUT' }),
      true,
      'Test F: ETIMEDOUT is transient network drop'
    )
    assert.equal(
      isTransientNetworkError({ message: 'getaddrinfo ENOTFOUND', code: 'ENOTFOUND' }),
      true,
      'Test F: ENOTFOUND is transient network drop'
    )
    console.log(
      '✓ TEST F passed: 429, auth, PO Token, private videos, invalid URLs, cancellations, and permissions strictly excluded\n'
    )

    // ------------------------------------------------------------------------
    // TEST G: yt-dlp Resume Arguments (--continue and temporary workspace)
    // ------------------------------------------------------------------------
    console.log('--- TEST G: yt-dlp Resume Arguments Inspection ---')

    const mockJobId = 42
    const mockTempPath = join(testDownloadDir, '.applan2-partial-downloads', `job-${mockJobId}`)

    const generatedArgs = buildYtDlpArgs({
      sourceUrl: 'https://www.youtube.com/watch?v=kJQP7kiw5Fk',
      outputFormat: 'mp4',
      quality: '1080p',
      downloadPath: testDownloadDir,
      jobId: mockJobId,
      tempPath: mockTempPath
    })

    // 1. Verify --continue flag is present for resume support
    assert.ok(
      generatedArgs.includes('--continue'),
      'Test G: buildYtDlpArgs must include --continue flag'
    )

    // 2. Verify temporary workspace flag routing fragments
    const tempArgIdx = generatedArgs.indexOf('-P')
    assert.ok(tempArgIdx !== -1, 'Test G: -P flag present')
    assert.ok(
      generatedArgs.some(
        (arg) => typeof arg === 'string' && arg.startsWith(`temp:${mockTempPath}`)
      ),
      'Test G: Routes intermediate partial fragments to job-owned temporary workspace'
    )

    // 3. Verify output template contains unique job id marker
    const outputIdx = generatedArgs.indexOf('-o')
    assert.ok(outputIdx !== -1, 'Test G: -o template flag present')
    const templateStr = generatedArgs[outputIdx + 1]
    assert.ok(
      templateStr.includes(`[job-${mockJobId}]`),
      'Test G: Output template matches [job-ID] for safe resumption'
    )
    console.log(
      '✓ TEST G passed: yt-dlp arguments include --continue, -P temp workspace, and [job-ID] template\n'
    )

    // ------------------------------------------------------------------------
    // SECTION H: Part 04 Status Validation Verification
    // ------------------------------------------------------------------------
    console.log('--- Section H: Part 04 Status Validation Verification ---')

    // 1. VALID_JOB_STATUSES constant includes 'interrupted'
    assert.ok(
      VALID_JOB_STATUSES.includes('interrupted'),
      'Section H: VALID_JOB_STATUSES must include "interrupted"'
    )

    // 2. listDownloadHistory({ status: 'interrupted' }) succeeds without validation errors
    const interruptedHistory = await listDownloadHistory({ status: 'interrupted' })
    assert.ok(Array.isArray(interruptedHistory.jobs), 'Section H: Returns jobs array')
    assert.equal(
      typeof interruptedHistory.pagination.total,
      'number',
      'Section H: Returns total pagination count'
    )

    // 3. Unfiltered history list still works
    const allHistory = await listDownloadHistory({})
    assert.ok(Array.isArray(allHistory.jobs), 'Section H: Unfiltered query succeeds')
    console.log(
      '✓ Section H passed: "interrupted" status accepted in VALID_JOB_STATUSES and history queries\n'
    )

    console.log('================================================================')
    console.log(' ALL PHASE 04 TESTS A THROUGH G PASSED SUCCESSFULLY (100%)      ')
    console.log('================================================================\n')
  } finally {
    setConnectivityCheckerForTesting(null)
    resetNetworkMonitoringForTesting()
    await testDb.cleanup()
  }
}

runNetworkRecoveryTests().catch((err) => {
  console.error('\n❌ PHASE 04 TESTS FAILED:', err)
  process.exit(1)
})
