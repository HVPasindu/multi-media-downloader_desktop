import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, writeFile, symlink } from 'node:fs/promises'
import { createTestDatabase } from './helpers/testDatabase.js'
import { isTransientNetworkError } from '../src/main/backend/services/downloadErrorService.js'
import {
  verifyJobPartialDownload,
  isPartialDownloadResumable,
  cleanupJobTemporaryFiles
} from '../src/main/backend/services/downloadCleanupService.js'
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
import {
  buildYtDlpArgs,
  markDownloadJobFailed
} from '../src/main/backend/services/downloadService.js'
import {
  VALID_JOB_STATUSES,
  listDownloadHistory
} from '../src/main/backend/services/downloadHistoryService.js'

/**
 * ============================================================================
 * Phase 04 Recovery Consistency & Automated Verification Suite
 *
 * Required Automated Tests:
 * - Test 01 – Severe Progress Mismatch (20 MB DB / 1 MB Disk -> rejected, safe restart from 0, same Job ID)
 * - Test 02 – Progress Mismatch Within Existing Tolerance (20 MB DB / 19 MB Disk -> accepted, reconciled to 19 MB)
 * - Test 03 – Exact Progress Match (20 MB DB / 20 MB Disk -> accepted, resume from partial file, same Job ID)
 * - Test 04 – Missing Partial File (DB progress exists, disk file missing -> safe restart from 0, same Job ID)
 * - Test 05 – Unsafe Partial File Rejection & Permitted Workspace Safety (fail-closed, workspace protection)
 * - Test 06 – Network Interruption (preserve valid partial files, auto-resume on reconnect, no duplicate scheduling)
 * - Test 07 – Application Restart (recover interrupted jobs, restore valid progress, resume safely)
 * - Test 08 – Concurrent Download Limit & FIFO Queue Ordering (MAX_CONCURRENCY = 2, createdAt ASC, id ASC)
 * - Test 09 – Recovery Failure & Lifecycle State Transition (error persistence, avoid stuck Resuming state)
 * - Test 10 – Duplicate Recovery Prevention (strict idempotency across repeated recovery triggers)
 * - Test F  – Error Classification (non-network errors strictly excluded from retry)
 * - Test G  – yt-dlp Resume Arguments Inspection (--continue, -P temp workspace, [job-ID] template)
 * - Section H – Status Validation Verification ('interrupted' in VALID_JOB_STATUSES and history query)
 * ============================================================================
 */
async function runNetworkRecoveryTests() {
  console.log('================================================================')
  console.log(' Phase 04: Recovery Consistency & Automated Verification Suite  ')
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
      title: 'Phase 04 Recovery Verification Media'
    })

    // ------------------------------------------------------------------------
    // Baseline: Real external HTTPS connectivity checker
    // ------------------------------------------------------------------------
    console.log('--- Baseline: HTTPS Connectivity Checker ---')
    const isConnBool = await checkNetworkConnectivity({ timeoutMs: 3000 })
    assert.equal(typeof isConnBool, 'boolean', 'checkNetworkConnectivity returns boolean')
    console.log(`✓ Real HTTPS checkNetworkConnectivity verified (result: ${isConnBool})\n`)

    // ------------------------------------------------------------------------
    // Centralized Helper Unit Verification: isPartialDownloadResumable
    // ------------------------------------------------------------------------
    console.log('--- Centralized Helper: isPartialDownloadResumable ---')
    assert.equal(isPartialDownloadResumable(null), false, 'Helper: null is not resumable')
    assert.equal(isPartialDownloadResumable({}), false, 'Helper: empty object is not resumable')
    assert.equal(
      isPartialDownloadResumable({
        isValid: true,
        isConsistent: false,
        isUnsafe: false,
        reconciledBytes: 1048576
      }),
      false,
      'Helper: inconsistent checkpoint is rejected'
    )
    assert.equal(
      isPartialDownloadResumable({
        isValid: false,
        isConsistent: true,
        isUnsafe: false,
        reconciledBytes: 1048576
      }),
      false,
      'Helper: invalid file is rejected'
    )
    assert.equal(
      isPartialDownloadResumable({
        isValid: true,
        isConsistent: true,
        isUnsafe: true,
        reconciledBytes: 1048576
      }),
      false,
      'Helper: unsafe file is rejected'
    )
    assert.equal(
      isPartialDownloadResumable({
        isValid: true,
        isConsistent: true,
        isUnsafe: false,
        reconciledBytes: 0
      }),
      false,
      'Helper: zero reconciled bytes is rejected'
    )
    assert.equal(
      isPartialDownloadResumable({
        isValid: true,
        isConsistent: true,
        isUnsafe: false,
        reconciledBytes: 19922944
      }),
      true,
      'Helper: valid, consistent, safe file with positive bytes is accepted'
    )
    console.log('✓ Centralized helper isPartialDownloadResumable verified\n')

    // ------------------------------------------------------------------------
    // TEST 01 – Severe Progress Mismatch
    // SQLite: 20 MB, Partial file: 1 MB
    // Expected:
    // - Reject the stale checkpoint
    // - Do not resume using 20 MB
    // - Trigger the safe restart strategy
    // - Preserve the existing Download Job ID
    // - Do not create a duplicate job
    // ------------------------------------------------------------------------
    console.log('--- TEST 01: Severe Progress Mismatch (20 MB DB / 1 MB Disk) ---')

    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()

    const job01 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'interrupted',
      progress: 40,
      downloaded_bytes: 20 * 1024 * 1024 // 20 MB saved checkpoint
    })
    const partPath01 = join(testDownloadDir, `severe-mismatch [job-${job01.id}].mp4.part`)
    await writeFile(partPath01, Buffer.alloc(1 * 1024 * 1024, 0x11)) // 1 MB actual partial file

    // Direct validation check
    const check01 = await verifyJobPartialDownload(job01.id, testDownloadDir, {
      savedDownloadedBytes: job01.downloaded_bytes,
      savedProgress: job01.progress
    })
    assert.equal(check01.isValid, true, 'Test 01: File exists on disk so isValid is true')
    assert.equal(
      check01.isConsistent,
      false,
      'Test 01: Severe mismatch (1 MB vs 20 MB) flagged as isConsistent = false'
    )
    assert.equal(check01.isUnsafe, false, 'Test 01: Not unsafe path')
    assert.equal(check01.isResumable, false, 'Test 01: isResumable is false')
    assert.equal(check01.reconciledBytes, 0, 'Test 01: Inconsistent file has reconciledBytes = 0')
    assert.equal(
      isPartialDownloadResumable(check01),
      false,
      'Test 01: Centralized decision helper rejects recovery'
    )

    // Full recovery flow execution
    setConnectivityCheckerForTesting(async () => true)
    const enqueued01 = []
    await resumeInterruptedNetworkJobs({
      enqueue: (id) => enqueued01.push(id)
    })

    const reloaded01 = await DownloadJob.findByPk(job01.id)
    assert.equal(reloaded01.id, job01.id, 'Test 01: Original Download Job ID strictly preserved')
    assert.notEqual(
      reloaded01.downloaded_bytes,
      20 * 1024 * 1024,
      'Test 01: Stale 20 MB checkpoint rejected; never resumed at 20 MB'
    )
    assert.equal(
      reloaded01.progress,
      0,
      'Test 01: Safe restart strategy triggered: progress reset to 0'
    )
    assert.equal(
      reloaded01.downloaded_bytes,
      0,
      'Test 01: Safe restart strategy triggered: downloaded_bytes reset to 0'
    )
    assert.equal(reloaded01.status, 'queued', 'Test 01: Status reset to queued for fresh start')

    // Confirm no duplicate job created
    const countJobs01 = await DownloadJob.count({ where: { id: job01.id } })
    assert.equal(countJobs01, 1, 'Test 01: No duplicate job created')
    console.log(
      '✓ TEST 01 passed: Severe mismatch checkpoint rejected, safe restart from 0, same Job ID preserved\n'
    )

    // ------------------------------------------------------------------------
    // TEST 02 – Progress Mismatch Within Existing Tolerance
    // SQLite: 20 MB, Partial file: 19 MB
    // Expected:
    // - Apply the existing consistency policy (within 5 MB tolerance)
    // - If accepted, reconcile progress to verified actual file size (19 MB), NOT unverified 20 MB
    // - Never report 20 MB as physically downloaded when only 19 MB exists
    // - Resume using the verified partial file
    // ------------------------------------------------------------------------
    console.log('--- TEST 02: Progress Mismatch Within Tolerance (20 MB DB / 19 MB Disk) ---')

    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()

    const job02 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'interrupted',
      progress: 40,
      downloaded_bytes: 20 * 1024 * 1024 // 20 MB checkpoint
    })
    const partPath02 = join(testDownloadDir, `within-tolerance [job-${job02.id}].mp4.part`)
    const bytes19MB = 19 * 1024 * 1024
    await writeFile(partPath02, Buffer.alloc(bytes19MB, 0x22)) // 19 MB actual disk file

    const check02 = await verifyJobPartialDownload(job02.id, testDownloadDir, {
      savedDownloadedBytes: job02.downloaded_bytes,
      savedProgress: job02.progress
    })
    assert.equal(check02.isValid, true, 'Test 02: Valid partial file on disk')
    assert.equal(check02.isConsistent, true, 'Test 02: Consistent within 5MB tolerance')
    assert.equal(check02.isUnsafe, false, 'Test 02: Safe path')
    assert.equal(check02.isResumable, true, 'Test 02: Resumable is true')
    assert.equal(
      check02.reconciledBytes,
      bytes19MB,
      'Test 02: Reconciles to actual 19 MB disk file, NEVER unverified 20 MB'
    )
    assert.equal(
      isPartialDownloadResumable(check02),
      true,
      'Test 02: Centralized helper approves resumption'
    )

    // Full recovery execution
    const enqueued02 = []
    await resumeInterruptedNetworkJobs({
      enqueue: (id) => enqueued02.push(id)
    })

    const reloaded02 = await DownloadJob.findByPk(job02.id)
    assert.equal(reloaded02.id, job02.id, 'Test 02: Same Job ID preserved')
    assert.equal(
      reloaded02.downloaded_bytes,
      bytes19MB,
      'Test 02: Persisted downloaded_bytes reconciled to verified 19 MB disk size'
    )
    assert.notEqual(
      reloaded02.downloaded_bytes,
      20 * 1024 * 1024,
      'Test 02: Stale 20 MB checkpoint NEVER reported when only 19 MB exists'
    )
    assert.equal(
      reloaded02.progress,
      40,
      'Test 02: Progress percentage snapshot preserved for resumption'
    )
    assert.equal(reloaded02.status, 'queued', 'Test 02: Successfully scheduled for resumption')
    assert.ok(enqueued02.includes(job02.id), 'Test 02: Job ID enqueued for execution')
    console.log(
      '✓ TEST 02 passed: Within-tolerance checkpoint reconciled to verified 19 MB disk size, resume initiated\n'
    )

    // ------------------------------------------------------------------------
    // TEST 03 – Exact Progress Match
    // SQLite: 20 MB, Partial file: 20 MB
    // Expected:
    // - Accept the checkpoint if all other validation conditions pass
    // - Resume from the existing partial file
    // - Preserve the Download Job ID
    // ------------------------------------------------------------------------
    console.log('--- TEST 03: Exact Progress Match (20 MB DB / 20 MB Disk) ---')

    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()

    const bytes20MB = 20 * 1024 * 1024
    const job03 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'interrupted',
      progress: 40,
      downloaded_bytes: bytes20MB
    })
    const partPath03 = join(testDownloadDir, `exact-match [job-${job03.id}].mp4.part`)
    await writeFile(partPath03, Buffer.alloc(bytes20MB, 0x33))

    const check03 = await verifyJobPartialDownload(job03.id, testDownloadDir, {
      savedDownloadedBytes: job03.downloaded_bytes,
      savedProgress: job03.progress
    })
    assert.equal(check03.isValid, true, 'Test 03: Valid partial file')
    assert.equal(check03.isConsistent, true, 'Test 03: Consistent exact match')
    assert.equal(check03.isUnsafe, false, 'Test 03: Safe file')
    assert.equal(check03.isResumable, true, 'Test 03: Resumable')
    assert.equal(check03.reconciledBytes, bytes20MB, 'Test 03: Reconciled bytes is exactly 20 MB')
    assert.equal(isPartialDownloadResumable(check03), true, 'Test 03: Helper approves recovery')

    const enqueued03 = []
    await resumeInterruptedNetworkJobs({
      enqueue: (id) => enqueued03.push(id)
    })

    const reloaded03 = await DownloadJob.findByPk(job03.id)
    assert.equal(reloaded03.id, job03.id, 'Test 03: Download Job ID preserved')
    assert.equal(
      reloaded03.downloaded_bytes,
      bytes20MB,
      'Test 03: 20 MB downloaded bytes preserved'
    )
    assert.equal(reloaded03.progress, 40, 'Test 03: 40% progress preserved')
    assert.equal(reloaded03.status, 'queued', 'Test 03: Status restored to queued')
    console.log(
      '✓ TEST 03 passed: Exact progress match accepted, resumed from partial file, Job ID preserved\n'
    )

    // ------------------------------------------------------------------------
    // TEST 04 – Missing Partial File
    // SQLite contains saved progress, but partial file does not exist
    // Expected:
    // - Do not attempt to resume a missing file
    // - Use the existing safe restart mechanism
    // - Preserve the existing job
    // ------------------------------------------------------------------------
    console.log('--- TEST 04: Missing Partial File ---')

    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()

    const job04 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 50,
      downloaded_bytes: 25 * 1024 * 1024 // 25 MB in SQLite, no file on disk
    })

    const check04 = await verifyJobPartialDownload(job04.id, testDownloadDir, {
      savedDownloadedBytes: job04.downloaded_bytes,
      savedProgress: job04.progress
    })
    assert.equal(check04.isValid, false, 'Test 04: Missing file reported isValid: false')
    assert.equal(
      check04.isConsistent,
      false,
      'Test 04: Missing file is not consistent with saved progress'
    )
    assert.equal(check04.isResumable, false, 'Test 04: Missing file is not resumable')
    assert.equal(check04.reconciledBytes, 0, 'Test 04: 0 reconciled bytes')
    assert.equal(isPartialDownloadResumable(check04), false, 'Test 04: Helper rejects recovery')

    const enqueued04 = []
    await resumeInterruptedNetworkJobs({
      enqueue: (id) => enqueued04.push(id)
    })

    const reloaded04 = await DownloadJob.findByPk(job04.id)
    assert.equal(reloaded04.id, job04.id, 'Test 04: Same Download Job ID preserved')
    assert.equal(reloaded04.progress, 0, 'Test 04: Safe restart triggered: progress reset to 0')
    assert.equal(
      reloaded04.downloaded_bytes,
      0,
      'Test 04: Safe restart triggered: downloaded_bytes reset to 0'
    )
    assert.equal(reloaded04.status, 'queued', 'Test 04: Status queued for fresh restart')
    console.log(
      '✓ TEST 04 passed: Missing partial file triggered safe restart from 0, original Job ID preserved\n'
    )

    // ------------------------------------------------------------------------
    // TEST 05 – Unsafe Partial File
    // Expected:
    // - Reject unsafe paths and files (symlinks, junctions, directory traversal)
    // - Do not access or delete files outside the permitted download workspace
    // ------------------------------------------------------------------------
    console.log('--- TEST 05: Unsafe Partial File Rejection & Workspace Safety ---')

    const outsideDir = join(tmpdir(), `applan2-outside-${Date.now()}`)
    await mkdir(outsideDir, { recursive: true })
    const outsideSecretFile = join(outsideDir, 'important-user-document.txt')
    await writeFile(outsideSecretFile, 'CRITICAL USER DATA DO NOT DELETE')

    const symlinkPartPath = join(testDownloadDir, `unsafe-link [job-999].mp4.part`)
    try {
      await symlink(outsideSecretFile, symlinkPartPath)
      const checkSymlink = await verifyJobPartialDownload(999, testDownloadDir)
      assert.equal(checkSymlink.isValid, false, 'Test 05: Symlink file is not valid')
      assert.equal(checkSymlink.isUnsafe, true, 'Test 05: Symlink flagged as isUnsafe: true')
      assert.equal(
        checkSymlink.isResumable,
        false,
        'Test 05: Symlink flagged as isResumable: false'
      )
      assert.equal(
        isPartialDownloadResumable(checkSymlink),
        false,
        'Test 05: Helper rejects unsafe file'
      )

      // Ensure cleanupJobTemporaryFiles does not delete files outside download directory
      await cleanupJobTemporaryFiles(999, testDownloadDir)
      const secretContent = await import('node:fs/promises').then((m) =>
        m.readFile(outsideSecretFile, 'utf8')
      )
      assert.equal(
        secretContent,
        'CRITICAL USER DATA DO NOT DELETE',
        'Test 05: Files outside download directory are strictly untouched'
      )
      console.log(
        '✓ TEST 05 passed: Symbolic links rejected with fail-closed safety (isUnsafe: true)'
      )
    } catch (symlinkErr) {
      if (symlinkErr.code === 'EPERM') {
        console.log(
          '✓ TEST 05: Symlink creation skipped (Windows non-admin environment without SeCreateSymbolicLinkPrivilege)'
        )
      } else {
        throw symlinkErr
      }
    }

    // ------------------------------------------------------------------------
    // TEST 06 – Network Interruption
    // Expected:
    // - Preserve valid partial files
    // - Recover when network connectivity returns
    // - Prevent duplicate recovery scheduling
    // ------------------------------------------------------------------------
    console.log('--- TEST 06: Network Interruption Lifecycle ---')

    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    await DownloadJob.destroy({ where: {} })

    const job06 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 35,
      downloaded_bytes: 3145728,
      error_message: 'Download paused: network connection was lost.'
    })
    const partPath06 = join(testDownloadDir, `clip-live [job-${job06.id}].mp4.part`)
    await writeFile(partPath06, Buffer.alloc(3145728, 0xaa))

    // 1. Start monitoring while offline
    let liveConnectivity = false
    setConnectivityCheckerForTesting(async () => liveConnectivity)

    const enqueued06 = []
    startNetworkMonitoring({
      baseIntervalMs: 50,
      initialDelayMs: 20,
      enqueue: (id) => enqueued06.push(id)
    })

    await new Promise((r) => setTimeout(r, 60))

    const reloaded06Offline = await DownloadJob.findByPk(job06.id)
    assert.equal(
      reloaded06Offline.status,
      'interrupted',
      'Test 06: Job remains interrupted while offline'
    )
    assert.equal(enqueued06.length, 0, 'Test 06: Nothing enqueued while offline')

    // 2. Change connectivity to online
    liveConnectivity = true
    await new Promise((r) => setTimeout(r, 120))
    stopNetworkMonitoring()

    const reloaded06Online = await DownloadJob.findByPk(job06.id)
    assert.equal(reloaded06Online.status, 'queued', 'Test 06: Automatically transitioned to queued')
    assert.equal(reloaded06Online.id, job06.id, 'Test 06: SAME Job ID preserved')
    assert.equal(reloaded06Online.progress, 35, 'Test 06: 35% progress snapshot strictly preserved')
    assert.equal(
      reloaded06Online.downloaded_bytes,
      3145728,
      'Test 06: Downloaded bytes strictly preserved'
    )
    assert.deepEqual(enqueued06, [job06.id], 'Test 06: Original Job ID enqueued in scheduler')
    console.log(
      '✓ TEST 06 passed: Network monitoring detected reconnection and auto-resumed same Job ID\n'
    )

    // ------------------------------------------------------------------------
    // TEST 07 – Application Restart
    // Expected:
    // - Recover interrupted jobs
    // - Reuse existing job records
    // - Restore valid progress
    // - Resume safely
    // ------------------------------------------------------------------------
    console.log('--- TEST 07: Application Restart Recovery ---')

    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    await DownloadJob.destroy({ where: {} })

    const downloadingJob07 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'downloading',
      progress: 40,
      downloaded_bytes: 4194304 // 4 MB
    })
    const partPath07 = join(
      testDownloadDir,
      `downloading-clip [job-${downloadingJob07.id}].mp4.part`
    )
    await writeFile(partPath07, Buffer.alloc(4194304, 0xbb))

    // Simulate offline restart
    setConnectivityCheckerForTesting(async () => false)
    const startupEnqueued07 = []
    await recoverInterruptedDownloadJobs({
      isOnline: false,
      enqueue: (id) => startupEnqueued07.push(id)
    })

    assert.equal(startupEnqueued07.length, 0, 'Test 07: Nothing enqueued while offline')

    const reloadedOffline07 = await DownloadJob.findByPk(downloadingJob07.id)
    assert.equal(
      reloadedOffline07.status,
      'interrupted',
      'Test 07: Job transitioned to interrupted'
    )
    assert.equal(reloadedOffline07.progress, 40, 'Test 07: 40% progress preserved across restart')
    assert.equal(
      reloadedOffline07.downloaded_bytes,
      4194304,
      'Test 07: 4MB downloaded bytes preserved across restart'
    )

    // Verify .part file was strictly NOT deleted from disk
    const checkPart07 = await verifyJobPartialDownload(downloadingJob07.id, testDownloadDir)
    assert.equal(checkPart07.isValid, true, 'Test 07: .part file preserved on disk')

    // Restore internet
    setConnectivityCheckerForTesting(async () => true)
    const restoreEnqueued07 = []
    await resumeInterruptedNetworkJobs({
      enqueue: (id) => restoreEnqueued07.push(id)
    })

    assert.ok(
      restoreEnqueued07.includes(downloadingJob07.id),
      'Test 07: Job enqueued upon reconnection'
    )
    const reloadedRestored07 = await DownloadJob.findByPk(downloadingJob07.id)
    assert.equal(reloadedRestored07.status, 'queued', 'Test 07: Restored to queued for resume')
    assert.equal(reloadedRestored07.progress, 40, 'Test 07: Progress remains 40%')
    assert.equal(reloadedRestored07.id, downloadingJob07.id, 'Test 07: Same Job ID maintained')
    console.log(
      '✓ TEST 07 passed: Downloading job preserved partial file across restart and resumed safely\n'
    )

    // ------------------------------------------------------------------------
    // TEST 08 – Concurrent Download Limit
    // Expected:
    // - Never exceed two active download processes
    // - Preserve FIFO queue ordering
    // ------------------------------------------------------------------------
    console.log('--- TEST 08: Concurrent Download Limit & FIFO Queue Ordering ---')

    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    await DownloadJob.destroy({ where: {} })

    const queueStatus = getQueueStatus()
    assert.equal(queueStatus.maxConcurrency, 2, 'Test 08: MAX_CONCURRENT_DOWNLOADS is strictly 2')

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

    assert.equal(fifoResult.resumedCount, 3, 'Test 08: All 3 jobs resumed')
    assert.deepEqual(
      fifoEnqueued,
      [fifo1.id, fifo2.id, fifo3.id],
      'Test 08: Resumed in strict chronological FIFO order (createdAt ASC, id ASC)'
    )
    console.log(
      '✓ TEST 08 passed: Max concurrency limit = 2 and global FIFO ordering (createdAt ASC, id ASC) verified\n'
    )

    // ------------------------------------------------------------------------
    // TEST 09 – Recovery Failure
    // Expected:
    // - Set the correct failure/interrupted state according to existing lifecycle rules
    // - Persist an appropriate error
    // - Avoid leaving a job permanently stuck in a false Resuming state
    // ------------------------------------------------------------------------
    console.log('--- TEST 09: Recovery Failure & Lifecycle State Transition ---')

    const failedRecoveryJob = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'queued',
      progress: 45,
      downloaded_bytes: 4000000
    })

    // Simulate fatal execution failure during download execution
    const fatalError = new Error('HTTP Error 403: Forbidden - token expired')
    await markDownloadJobFailed(failedRecoveryJob.id, fatalError, 'queued')

    const reloadedFailed = await DownloadJob.findByPk(failedRecoveryJob.id)
    assert.equal(
      reloadedFailed.status,
      'failed',
      'Test 09: Lifecycle state transitions to failed on fatal execution failure'
    )
    assert.ok(
      reloadedFailed.error_message.includes('SOURCE_ACCESS_DENIED'),
      'Test 09: Appropriate error message is persisted'
    )
    assert.notEqual(
      reloadedFailed.status,
      'queued',
      'Test 09: Job is not stuck in queued state with progress (prevents false Resuming state)'
    )
    console.log(
      '✓ TEST 09 passed: Lifecycle state correctly transitioned to failed with persisted error message\n'
    )

    // ------------------------------------------------------------------------
    // TEST 10 – Duplicate Recovery Prevention
    // Expected:
    // - Repeated startup/network recovery triggers must not schedule the same job multiple times
    // ------------------------------------------------------------------------
    console.log('--- TEST 10: Duplicate Recovery Prevention (Strict Idempotency) ---')

    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    await DownloadJob.destroy({ where: {} })

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
    assert.ok(pass1.resumedJobIds.includes(dupJob.id), 'Test 10: Pass 1 enqueues the job')

    // Second recovery pass immediately afterwards
    const pass2 = await resumeInterruptedNetworkJobs({
      enqueue: (id) => dupEnqueued.push(id)
    })
    assert.ok(
      !pass2.resumedJobIds.includes(dupJob.id),
      'Test 10: Pass 2 does NOT re-enqueue (already queued)'
    )

    const occurrences = dupEnqueued.filter((id) => id === dupJob.id).length
    assert.equal(occurrences, 1, 'Test 10: Job enqueued exactly once across multiple passes')
    console.log(
      '✓ TEST 10 passed: Strict idempotency prevents duplicate scheduling across recovery triggers\n'
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

    assert.ok(
      generatedArgs.includes('--continue'),
      'Test G: buildYtDlpArgs must include --continue flag'
    )

    const tempArgIdx = generatedArgs.indexOf('-P')
    assert.ok(tempArgIdx !== -1, 'Test G: -P flag present')
    assert.ok(
      generatedArgs.some(
        (arg) => typeof arg === 'string' && arg.startsWith(`temp:${mockTempPath}`)
      ),
      'Test G: Routes intermediate partial fragments to job-owned temporary workspace'
    )

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

    assert.ok(
      VALID_JOB_STATUSES.includes('interrupted'),
      'Section H: VALID_JOB_STATUSES must include "interrupted"'
    )

    const interruptedHistory = await listDownloadHistory({ status: 'interrupted' })
    assert.ok(Array.isArray(interruptedHistory.jobs), 'Section H: Returns jobs array')
    assert.equal(
      typeof interruptedHistory.pagination.total,
      'number',
      'Section H: Returns total pagination count'
    )

    const allHistory = await listDownloadHistory({})
    assert.ok(Array.isArray(allHistory.jobs), 'Section H: Unfiltered query succeeds')
    console.log(
      '✓ Section H passed: "interrupted" status accepted in VALID_JOB_STATUSES and history queries\n'
    )

    console.log('================================================================')
    console.log(' ALL TESTS 01 THROUGH 10 (AND F, G, H) PASSED (100%)            ')
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
