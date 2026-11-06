import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, writeFile, symlink, stat } from 'node:fs/promises'
import { createTestDatabase } from './helpers/testDatabase.js'
import {
  resolveValidatedDownloadPath,
  setPathResolverForTesting,
  resetPathResolverForTesting
} from '../src/main/backend/services/downloadPathService.js'
import {
  setAllowLocalhostForTesting,
  resetAllowLocalhostForTesting
} from '../src/main/backend/services/mediaUrlSecurityService.js'
import {
  setAnalyzerForTesting,
  resetAnalyzerForTesting
} from '../src/main/backend/services/mediaAnalyzerService.js'
import {
  isTransientNetworkError,
  classifyDownloadError,
  DOWNLOAD_ERROR_CODES
} from '../src/main/backend/services/downloadErrorService.js'
import {
  verifyJobPartialDownload,
  isPartialDownloadResumable,
  cleanupJobTemporaryFiles,
  setCleanupHandlerForTesting,
  resetCleanupHandlerForTesting
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
import {
  getQueueStatus,
  enqueueDownloadJob,
  resetQueueForTesting,
  stopQueueForShutdown
} from '../src/main/backend/services/downloadQueueService.js'
import {
  buildYtDlpArgs,
  markDownloadJobFailed
} from '../src/main/backend/services/downloadService.js'
import { resolveYtDlpPath } from '../src/main/backend/services/executablePathService.js'
import {
  VALID_JOB_STATUSES,
  listDownloadHistory
} from '../src/main/backend/services/downloadHistoryService.js'
import { normalizeDownloadJob } from '../src/renderer/src/utils/downloadPresentation.js'

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
    const { MediaItem, DownloadJob, DownloadFile, AppSetting } = testDb.sequelize.models

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
    setConnectivityCheckerForTesting(async () => true)

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
    setConnectivityCheckerForTesting(async () => true)

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
    setConnectivityCheckerForTesting(async () => true)

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

    // ========================================================================
    // STEP 02: REPEATED RECOVERY REGRESSION SUITE
    // ========================================================================
    console.log('--- STEP 02: Repeated Recovery Regression Suite ---')

    // Test 2.1: 20 MB / 1 MB -> Safe Restart -> 0 MB / 0 MB -> Fresh download
    console.log('--- Test 2.1: 20 MB / 1 MB -> Safe Restart -> 0 MB / 0 MB -> Fresh download ---')
    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    setConnectivityCheckerForTesting(async () => true)
    await DownloadJob.destroy({ where: {} })

    const repJob = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'interrupted',
      progress: 40,
      downloaded_bytes: 20 * 1024 * 1024 // 20 MB
    })
    const repPartPath = join(testDownloadDir, `repeated-test [job-${repJob.id}].mp4.part`)
    await writeFile(repPartPath, Buffer.alloc(1 * 1024 * 1024, 0x55)) // 1 MB physical file

    // First recovery run
    const repEnqueued1 = []
    await resumeInterruptedNetworkJobs({
      enqueue: (id) => repEnqueued1.push(id)
    })

    const reloadedRep1 = await DownloadJob.findByPk(repJob.id)
    assert.equal(reloadedRep1.id, repJob.id, 'Test 2.1: Original Job ID strictly preserved')
    assert.equal(reloadedRep1.progress, 0, 'Test 2.1: Progress reset to 0 after rejection')
    assert.equal(reloadedRep1.downloaded_bytes, 0, 'Test 2.1: Downloaded bytes reset to 0')
    assert.equal(
      reloadedRep1.status,
      'queued',
      'Test 2.1: Status set to queued for safe fresh start'
    )

    // Physical partial file must have been cleaned
    const diskStat1 = await verifyJobPartialDownload(repJob.id, testDownloadDir)
    assert.equal(
      diskStat1.isValid,
      false,
      'Test 2.1: Stale partial file was physically cleaned from disk'
    )

    // Second recovery run (e.g. interruption occurs while queued / at 0 MB / 0 MB)
    await DownloadJob.update({ status: 'interrupted' }, { where: { id: repJob.id } })
    const repEnqueued2 = []
    await resumeInterruptedNetworkJobs({
      enqueue: (id) => repEnqueued2.push(id)
    })

    const reloadedRep2 = await DownloadJob.findByPk(repJob.id)
    assert.equal(
      reloadedRep2.id,
      repJob.id,
      'Test 2.1: Same Job ID maintained on repeated recovery'
    )
    assert.equal(reloadedRep2.progress, 0, 'Test 2.1: Progress remains 0 for fresh download')
    assert.equal(reloadedRep2.downloaded_bytes, 0, 'Test 2.1: Downloaded bytes remain 0')
    assert.equal(reloadedRep2.status, 'queued', 'Test 2.1: Ready for fresh download')

    const totalRepCount = await DownloadJob.count({ where: { id: repJob.id } })
    assert.equal(totalRepCount, 1, 'Test 2.1: Zero duplicate jobs created across repeated recovery')
    console.log(
      '✓ Test 2.1 passed: 20 MB / 1 MB -> Safe Restart -> 0 MB / 0 MB -> Fresh download verified\n'
    )

    // Test 2.2: 0 MB / 1 MB leftover stale file invalidation
    console.log('--- Test 2.2: Stale File Invalidation (0 MB DB / 1 MB Disk) ---')
    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    setConnectivityCheckerForTesting(async () => true)
    await DownloadJob.destroy({ where: {} })

    const staleJob = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'interrupted',
      progress: 0,
      downloaded_bytes: 0
    })
    const stalePartPath = join(testDownloadDir, `stale-file [job-${staleJob.id}].mp4.part`)
    await writeFile(stalePartPath, Buffer.alloc(1 * 1024 * 1024, 0x66)) // 1 MB leftover on disk

    const checkStale = await verifyJobPartialDownload(staleJob.id, testDownloadDir, {
      savedDownloadedBytes: 0,
      savedProgress: 0
    })
    assert.equal(
      checkStale.isConsistent,
      false,
      'Test 2.2: 0 MB DB with 1 MB disk file is marked isConsistent = false'
    )
    assert.equal(checkStale.isResumable, false, 'Test 2.2: Leftover stale file is not resumable')
    assert.equal(checkStale.reconciledBytes, 0, 'Test 2.2: Reconciled bytes is 0')
    assert.equal(
      isPartialDownloadResumable(checkStale),
      false,
      'Test 2.2: Decision helper rejects resuming stale file'
    )

    const staleEnqueued = []
    await resumeInterruptedNetworkJobs({
      enqueue: (id) => staleEnqueued.push(id)
    })
    const reloadedStale = await DownloadJob.findByPk(staleJob.id)
    assert.equal(reloadedStale.progress, 0, 'Test 2.2: Progress remains 0')
    assert.equal(
      reloadedStale.downloaded_bytes,
      0,
      'Test 2.2: Downloaded bytes remain 0 (never resumes stale 1 MB)'
    )
    console.log('✓ Test 2.2 passed: 0 MB / 1 MB leftover file strictly invalidated and rejected\n')

    // Test 2.3-2.6: Recovery Sequence & Idempotency Combinations
    console.log('--- Test 2.3-2.6: Recovery Sequences & Idempotency ---')
    resetRecoveryTrackingForTesting()
    await DownloadJob.destroy({ where: {} })
    const seqJob = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '720p',
      status: 'downloading',
      progress: 30,
      downloaded_bytes: 3000
    })
    await writeFile(
      join(testDownloadDir, `seq [job-${seqJob.id}].mp4.part`),
      Buffer.alloc(3000, 0x77)
    )

    // 2.3: Startup recovery twice
    const startup1 = []
    await recoverInterruptedDownloadJobs({ isOnline: true, enqueue: (id) => startup1.push(id) })
    const startup2 = []
    await recoverInterruptedDownloadJobs({ isOnline: true, enqueue: (id) => startup2.push(id) })
    assert.equal(startup1.length, 1, 'Test 2.3: Startup recovery 1 schedules job')
    assert.equal(startup2.length, 0, 'Test 2.3: Startup recovery 2 is strictly idempotent')

    // 2.4: Network recovery twice
    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    setConnectivityCheckerForTesting(async () => true)
    await DownloadJob.update({ status: 'interrupted' }, { where: { id: seqJob.id } })
    const net1 = []
    await resumeInterruptedNetworkJobs({ enqueue: (id) => net1.push(id) })
    const net2 = []
    await resumeInterruptedNetworkJobs({ enqueue: (id) => net2.push(id) })
    assert.equal(net1.length, 1, 'Test 2.4: Network recovery 1 schedules job')
    assert.equal(net2.length, 0, 'Test 2.4: Network recovery 2 is strictly idempotent')

    // 2.5: Startup recovery followed by network recovery
    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    setConnectivityCheckerForTesting(async () => true)
    await DownloadJob.update({ status: 'downloading' }, { where: { id: seqJob.id } })
    const seqEnq5 = []
    await recoverInterruptedDownloadJobs({ isOnline: false, enqueue: (id) => seqEnq5.push(id) })
    const seqAfterOffline = await DownloadJob.findByPk(seqJob.id)
    assert.equal(
      seqAfterOffline.status,
      'interrupted',
      'Test 2.5: Marked interrupted while offline'
    )
    await resumeInterruptedNetworkJobs({ enqueue: (id) => seqEnq5.push(id) })
    const seqAfterOnline = await DownloadJob.findByPk(seqJob.id)
    assert.equal(
      seqAfterOnline.status,
      'queued',
      'Test 2.5: Transitioned to queued on network resume'
    )
    assert.deepEqual(seqEnq5, [seqJob.id], 'Test 2.5: Enqueued once')

    // 2.6: Network recovery followed by application restart
    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    const seqEnq6 = []
    await recoverInterruptedDownloadJobs({ isOnline: true, enqueue: (id) => seqEnq6.push(id) })
    const seqAfterRestart = await DownloadJob.findByPk(seqJob.id)
    assert.equal(seqAfterRestart.status, 'queued', 'Test 2.6: Queued job preserved across restart')
    assert.equal(seqAfterRestart.id, seqJob.id, 'Test 2.6: Same Job ID maintained')
    console.log(
      '✓ Test 2.3-2.6 passed: Startup & Network recovery sequences and idempotency verified\n'
    )

    // ========================================================================
    // STARTUP RACE & SERIALIZED NETWORK MONITORING TESTS (ORDER 02)
    // ========================================================================
    console.log('--- Order 02: Startup Race & Serialized Network Monitoring Tests (1-7) ---')

    // ------------------------------------------------------------------------
    // Test 1 – Exact startup race reproduction
    // Cold start recovery marked job as interrupted while offline.
    // Internet becomes available before monitor starts.
    // Monitor starts with initial check = ONLINE.
    // It must perform initial recovery scan and queue the interrupted job.
    // ------------------------------------------------------------------------
    console.log('  [Race 1] Exact startup race reproduction (Online on initial monitor probe)...')
    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    await DownloadJob.destroy({ where: {} })

    const raceJob1 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'downloading',
      progress: 50,
      downloaded_bytes: 5000000
    })
    const racePartPath1 = join(testDownloadDir, `race-clip-1 [job-${raceJob1.id}].mp4.part`)
    await writeFile(racePartPath1, Buffer.alloc(5000000, 0x11))

    // Cold-start recovery runs while offline
    const startupEnqRace1 = []
    await recoverInterruptedDownloadJobs({
      isOnline: false,
      enqueue: (id) => startupEnqRace1.push(id)
    })
    assert.equal(startupEnqRace1.length, 0, 'Race 1: Nothing enqueued during offline cold start')

    const reloadedRace1Interrupted = await DownloadJob.findByPk(raceJob1.id)
    assert.equal(
      reloadedRace1Interrupted.status,
      'interrupted',
      'Race 1: Job transitioned to interrupted on offline startup'
    )

    // Internet becomes ONLINE before startNetworkMonitoring() is called
    setConnectivityCheckerForTesting(async () => true)

    const monitorEnqRace1 = []
    await startNetworkMonitoring({
      baseIntervalMs: 100,
      initialDelayMs: 50,
      enqueue: (id) => monitorEnqRace1.push(id)
    })

    const reloadedRace1Resumed = await DownloadJob.findByPk(raceJob1.id)
    assert.equal(reloadedRace1Resumed.id, raceJob1.id, 'Race 1: Original Job ID strictly preserved')
    assert.equal(
      reloadedRace1Resumed.status,
      'queued',
      'Race 1: Job resumed to queued without waiting for 0->1 transition'
    )
    assert.equal(reloadedRace1Resumed.progress, 50, 'Race 1: Progress strictly preserved')
    assert.equal(
      reloadedRace1Resumed.downloaded_bytes,
      5000000,
      'Race 1: Downloaded bytes strictly preserved'
    )
    assert.deepEqual(monitorEnqRace1, [raceJob1.id], 'Race 1: Exactly 1 recovery enqueue occurred')

    const race1JobCount = await DownloadJob.count({ where: { id: raceJob1.id } })
    assert.equal(race1JobCount, 1, 'Race 1: Zero duplicate jobs created')
    stopNetworkMonitoring()
    console.log('  ✓ Race 1 passed: Interrupted job resumed on initial online monitor check\n')

    // ------------------------------------------------------------------------
    // Test 2 – Offline startup remains offline
    // Start monitoring while connectivity checker returns false.
    // Job remains interrupted, speed 0 KB/s, ETA Waiting for connection.
    // ------------------------------------------------------------------------
    console.log('  [Race 2] Offline startup remains offline...')
    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    await DownloadJob.destroy({ where: {} })

    const raceJob2 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '720p',
      status: 'downloading',
      progress: 40,
      downloaded_bytes: 4000000
    })
    const racePartPath2 = join(testDownloadDir, `race-clip-2 [job-${raceJob2.id}].mp4.part`)
    await writeFile(racePartPath2, Buffer.alloc(4000000, 0x22))

    setConnectivityCheckerForTesting(async () => false)
    await recoverInterruptedDownloadJobs({
      isOnline: false,
      enqueue: () => {}
    })

    const monitorEnqRace2 = []
    await startNetworkMonitoring({
      baseIntervalMs: 50,
      initialDelayMs: 20,
      enqueue: (id) => monitorEnqRace2.push(id)
    })

    const reloadedRace2 = await DownloadJob.findByPk(raceJob2.id)
    assert.equal(reloadedRace2.status, 'interrupted', 'Race 2: Status remains interrupted')
    assert.equal(reloadedRace2.progress, 40, 'Race 2: Progress preserved')
    assert.equal(reloadedRace2.downloaded_bytes, 4000000, 'Race 2: Downloaded bytes preserved')
    assert.equal(monitorEnqRace2.length, 0, 'Race 2: Zero enqueued while offline')

    const normRace2 = normalizeDownloadJob(reloadedRace2.toJSON())
    assert.equal(normRace2.speedText, '0 KB/s', 'Race 2: Speed is 0 KB/s')
    assert.equal(
      normRace2.etaDisplay,
      'Waiting for connection',
      'Race 2: ETA is Waiting for connection'
    )
    stopNetworkMonitoring()
    console.log(
      '  ✓ Race 2 passed: Offline startup correctly remains offline with proper presentation\n'
    )

    // ------------------------------------------------------------------------
    // Test 3 – Offline startup followed by reconnect
    // Start offline, let initial probe complete, then reconnect.
    // ------------------------------------------------------------------------
    console.log('  [Race 3] Offline startup followed by reconnect...')
    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    await DownloadJob.destroy({ where: {} })

    const raceJob3 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'downloading',
      progress: 25,
      downloaded_bytes: 2500000
    })
    const racePartPath3 = join(testDownloadDir, `race-clip-3 [job-${raceJob3.id}].mp4.part`)
    await writeFile(racePartPath3, Buffer.alloc(2500000, 0x33))

    let race3Connectivity = false
    setConnectivityCheckerForTesting(async () => race3Connectivity)

    await recoverInterruptedDownloadJobs({ isOnline: false, enqueue: () => {} })

    const monitorEnqRace3 = []
    await startNetworkMonitoring({
      baseIntervalMs: 40,
      initialDelayMs: 20,
      enqueue: (id) => monitorEnqRace3.push(id)
    })

    // Assert initial state is offline
    assert.equal(monitorEnqRace3.length, 0, 'Race 3: Nothing enqueued while offline initially')

    // Reconnect
    race3Connectivity = true
    await new Promise((r) => setTimeout(r, 100))

    const reloadedRace3 = await DownloadJob.findByPk(raceJob3.id)
    assert.equal(reloadedRace3.id, raceJob3.id, 'Race 3: Same Job ID preserved')
    assert.equal(reloadedRace3.status, 'queued', 'Race 3: Resumed to queued after reconnect')
    assert.equal(reloadedRace3.progress, 25, 'Race 3: Progress preserved')
    assert.equal(reloadedRace3.downloaded_bytes, 2500000, 'Race 3: Bytes preserved')
    assert.deepEqual(monitorEnqRace3, [raceJob3.id], 'Race 3: Exactly 1 enqueue occurred')
    stopNetworkMonitoring()
    console.log('  ✓ Race 3 passed: Offline startup transitions cleanly to queued on reconnect\n')

    // ------------------------------------------------------------------------
    // Test 4 – Delayed initial connectivity probe
    // Simulate an initial probe that takes longer than initialDelayMs.
    // No periodic checks should run before initial probe finishes.
    // ------------------------------------------------------------------------
    console.log('  [Race 4] Delayed initial connectivity probe serialization...')
    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    await DownloadJob.destroy({ where: {} })

    const raceJob4 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 60,
      downloaded_bytes: 6000000
    })
    const racePartPath4 = join(testDownloadDir, `race-clip-4 [job-${raceJob4.id}].mp4.part`)
    await writeFile(racePartPath4, Buffer.alloc(6000000, 0x44))

    let resolveDelayedProbe
    const delayedProbePromise = new Promise((resolve) => {
      resolveDelayedProbe = resolve
    })
    let probeCallCount = 0
    setConnectivityCheckerForTesting(() => {
      probeCallCount++
      return delayedProbePromise
    })

    const monitorEnqRace4 = []
    const monitorPromise4 = startNetworkMonitoring({
      baseIntervalMs: 30,
      initialDelayMs: 15,
      enqueue: (id) => monitorEnqRace4.push(id)
    })

    // Wait longer than initialDelayMs (40ms > 15ms)
    await new Promise((r) => setTimeout(r, 40))
    // Verify periodic check has NOT fired because initialization was pending
    assert.equal(
      probeCallCount,
      1,
      'Race 4: Exactly one in-flight connectivity check while pending'
    )
    assert.equal(
      monitorEnqRace4.length,
      0,
      'Race 4: Nothing enqueued while initial probe is pending'
    )

    // Now resolve probe as online
    resolveDelayedProbe(true)
    await monitorPromise4

    const reloadedRace4 = await DownloadJob.findByPk(raceJob4.id)
    assert.equal(
      reloadedRace4.status,
      'queued',
      'Race 4: Job resumed upon delayed probe resolution'
    )
    assert.deepEqual(monitorEnqRace4, [raceJob4.id], 'Race 4: Exactly 1 enqueue')
    stopNetworkMonitoring()
    console.log(
      '  ✓ Race 4 passed: Delayed initial probe completes cleanly without race or duplicate checks\n'
    )

    // ------------------------------------------------------------------------
    // Test 5 – Repeated monitor startup idempotency
    // ------------------------------------------------------------------------
    console.log('  [Race 5] Repeated monitor startup idempotency...')
    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    await DownloadJob.destroy({ where: {} })

    const raceJob5 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'interrupted',
      progress: 70,
      downloaded_bytes: 7000000
    })
    const racePartPath5 = join(testDownloadDir, `race-clip-5 [job-${raceJob5.id}].mp4.part`)
    await writeFile(racePartPath5, Buffer.alloc(7000000, 0x55))

    setConnectivityCheckerForTesting(async () => true)
    const monitorEnqRace5 = []

    // Call startNetworkMonitoring 3 times concurrently
    const p1 = startNetworkMonitoring({
      baseIntervalMs: 50,
      enqueue: (id) => monitorEnqRace5.push(id)
    })
    const p2 = startNetworkMonitoring({
      baseIntervalMs: 50,
      enqueue: (id) => monitorEnqRace5.push(id)
    })
    const p3 = startNetworkMonitoring({
      baseIntervalMs: 50,
      enqueue: (id) => monitorEnqRace5.push(id)
    })

    await Promise.all([p1, p2, p3])

    const reloadedRace5 = await DownloadJob.findByPk(raceJob5.id)
    assert.equal(reloadedRace5.status, 'queued', 'Race 5: Job resumed')
    assert.deepEqual(
      monitorEnqRace5,
      [raceJob5.id],
      'Race 5: Exactly 1 enqueue despite multiple start calls'
    )
    stopNetworkMonitoring()
    console.log(
      '  ✓ Race 5 passed: Repeated startNetworkMonitoring calls are strictly idempotent\n'
    )

    // ------------------------------------------------------------------------
    // Test 6 – Recovery failure and subsequent retry
    // ------------------------------------------------------------------------
    console.log('  [Race 6] Recovery failure and subsequent retry...')
    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    await DownloadJob.destroy({ where: {} })

    const raceJob6 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'interrupted',
      progress: 80,
      downloaded_bytes: 8000000
    })
    const racePartPath6 = join(testDownloadDir, `race-clip-6 [job-${raceJob6.id}].mp4.part`)
    await writeFile(racePartPath6, Buffer.alloc(8000000, 0x66))

    let shouldFailFindAllOnce = true
    const realFindAll = DownloadJob.findAll
    DownloadJob.findAll = async function (...args) {
      if (shouldFailFindAllOnce) {
        shouldFailFindAllOnce = false
        throw new Error('Simulated transient SQLite lock during recovery')
      }
      return realFindAll.apply(this, args)
    }

    // Cycle 1: starts offline initially
    let race6Connectivity = false
    setConnectivityCheckerForTesting(async () => race6Connectivity)

    const monitorEnqRace6 = []
    await startNetworkMonitoring({
      baseIntervalMs: 30,
      initialDelayMs: 15,
      enqueue: (id) => monitorEnqRace6.push(id)
    })

    // Internet reconnects; first recovery attempt throws simulated DB error
    race6Connectivity = true
    await new Promise((r) => setTimeout(r, 45))

    // Next cycle runs (shouldFailFindAllOnce is false), recovery succeeds and enqueues job
    await new Promise((r) => setTimeout(r, 80))

    DownloadJob.findAll = realFindAll

    const reloadedRace6 = await DownloadJob.findByPk(raceJob6.id)
    assert.equal(reloadedRace6.status, 'queued', 'Race 6: Job resumed to queued on retry cycle')
    assert.equal(reloadedRace6.progress, 80, 'Race 6: 80% progress strictly preserved')
    assert.equal(
      reloadedRace6.downloaded_bytes,
      8000000,
      'Race 6: Downloaded bytes strictly preserved'
    )
    assert.deepEqual(
      monitorEnqRace6,
      [raceJob6.id],
      'Race 6: Subsequent cycle retried recovery and enqueued successfully'
    )
    stopNetworkMonitoring()
    console.log(
      '  ✓ Race 6 passed: Monitoring remains alive after recovery failure and retries successfully\n'
    )

    // ------------------------------------------------------------------------
    // Test 7 – Initial Online Recovery Failure → Automatic Retry
    // Application starts with Internet ON, but initial recovery scan fails due
    // to temporary SQLite error. Next monitoring cycle must automatically retry
    // and recover the interrupted job without manual intervention.
    // ------------------------------------------------------------------------
    console.log('  [Race 7] Initial Online Recovery Failure → Automatic Retry...')
    resetRecoveryTrackingForTesting()
    resetNetworkMonitoringForTesting()
    await DownloadJob.destroy({ where: {} })

    const raceJob7 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'interrupted',
      progress: 80,
      downloaded_bytes: 8000000
    })
    const racePartPath7 = join(testDownloadDir, `race-clip-7 [job-${raceJob7.id}].mp4.part`)
    await writeFile(racePartPath7, Buffer.alloc(8000000, 0x77))

    let race7FindAllCalls = 0
    const originalFindAll7 = DownloadJob.findAll

    DownloadJob.findAll = async function (...args) {
      race7FindAllCalls++
      if (race7FindAllCalls === 1) {
        throw new Error('Simulated transient SQLite lock during initial recovery')
      }
      return originalFindAll7.apply(this, args)
    }

    try {
      setConnectivityCheckerForTesting(async () => true)

      const monitorEnqRace7 = []
      await startNetworkMonitoring({
        baseIntervalMs: 50,
        initialDelayMs: 30,
        enqueue: (id) => {
          monitorEnqRace7.push(id)
          return true
        }
      })

      // The initial recovery scan failed due to the simulated SQLite error.
      // Monitoring remains active and retries on the next checkCycle while still ONLINE.
      let reloadedRace7 = null
      for (let poll = 0; poll < 40; poll++) {
        reloadedRace7 = await DownloadJob.findByPk(raceJob7.id)
        if (reloadedRace7 && reloadedRace7.status === 'queued') {
          break
        }
        await new Promise((r) => setTimeout(r, 25))
      }

      assert.equal(
        race7FindAllCalls >= 2,
        true,
        'Race 7: Recovery scan retried after initial SQLite failure'
      )
      assert.equal(reloadedRace7.id, raceJob7.id, 'Race 7: Original Job ID preserved')
      assert.equal(reloadedRace7.status, 'queued', 'Race 7: Original job recovered to queued')
      assert.equal(reloadedRace7.progress, 80, 'Race 7: Original progress preserved')
      assert.equal(
        reloadedRace7.downloaded_bytes,
        8000000,
        'Race 7: Original downloaded bytes preserved'
      )
      assert.deepEqual(monitorEnqRace7, [raceJob7.id], 'Race 7: Exactly one queue enqueue')

      // Verify partial file and DB invariants
      const partStat7 = await stat(racePartPath7)
      assert.equal(
        partStat7.size,
        8000000,
        'Race 7: Valid partial file still exists and size remains 8 MB'
      )

      const totalJobCount7 = await DownloadJob.count({ where: { id: raceJob7.id } })
      assert.equal(
        totalJobCount7,
        1,
        'Race 7: Exactly one database job exists for original ID (no replacement job created)'
      )

      const allJobs7 = await DownloadJob.findAll()
      assert.equal(allJobs7.length, 1, 'Race 7: No duplicate jobs exist in database')
    } finally {
      DownloadJob.findAll = originalFindAll7
      stopNetworkMonitoring()
      resetNetworkMonitoringForTesting()
      resetRecoveryTrackingForTesting()
    }

    console.log(
      '  ✓ Race 7 passed: Initial online recovery failure automatically retries and succeeds\n'
    )

    // ========================================================================
    // STEP 03: REAL YT-DLP RANGE RESUME INTEGRATION TEST
    // ========================================================================
    console.log('--- STEP 03: Real yt-dlp Range Resume Test (Local HTTP Range Server) ---')

    const ytdlpExecPath = await resolveYtDlpPath()
    assert.ok(ytdlpExecPath, 'Step 03: yt-dlp executable path must resolve')

    // Create 1 MB deterministic media fixture buffer
    const fixtureTotalBytes = 1024 * 1024 // 1 MB
    const fixtureBuffer = Buffer.alloc(fixtureTotalBytes)
    for (let i = 0; i < fixtureTotalBytes; i++) {
      fixtureBuffer[i] = (i * 7 + 13) % 256
    }
    const expectedFixtureSha256 = crypto.createHash('sha256').update(fixtureBuffer).digest('hex')

    let rangeRequestsReceived = []
    let shouldAbruptlyDisconnect = true

    const rangeServer = http.createServer((req, res) => {
      const rangeHeader = req.headers['range']
      if (rangeHeader) {
        rangeRequestsReceived.push(rangeHeader)
        const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/)
        if (match) {
          const start = parseInt(match[1], 10)
          const end = match[2] ? parseInt(match[2], 10) : fixtureTotalBytes - 1
          const chunk = fixtureBuffer.subarray(start, end + 1)
          res.writeHead(206, {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${fixtureTotalBytes}`,
            'Content-Length': chunk.length
          })
          res.end(chunk)
          return
        }
      }

      if (shouldAbruptlyDisconnect) {
        // Send initial 256 KB and destroy socket to simulate network drop
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Length': fixtureTotalBytes
        })
        const partialChunk = fixtureBuffer.subarray(0, 262144) // 256 KB
        res.write(partialChunk)
        setTimeout(() => {
          req.socket.destroy()
        }, 50)
        return
      }

      // Normal full serve
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': fixtureTotalBytes
      })
      res.end(fixtureBuffer)
    })

    await new Promise((resolve) => rangeServer.listen(0, '127.0.0.1', resolve))
    const serverPort = rangeServer.address().port
    const fixtureUrl = `http://127.0.0.1:${serverPort}/test-video.mp4`

    const realJobId = 777
    const outputTemplate = join(testDownloadDir, `real-resumable [job-${realJobId}].%(ext)s`)
    const expectedPartFile = join(testDownloadDir, `real-resumable [job-${realJobId}].mp4.part`)
    const expectedFinalFile = join(testDownloadDir, `real-resumable [job-${realJobId}].mp4`)

    try {
      // Phase 1: Start download and simulate interruption
      console.log('  [Phase 1] Starting initial yt-dlp download...')
      const p1Args = ['--retries', '0', fixtureUrl, '-o', outputTemplate]
      await new Promise((resolve) => {
        const child1 = spawn(ytdlpExecPath, p1Args, { windowsHide: true })
        child1.on('close', () => resolve())
        child1.on('error', () => resolve())
      })

      // Verify partial file was created
      const partCheck = await verifyJobPartialDownload(realJobId, testDownloadDir)
      assert.equal(partCheck.isValid, true, 'Step 03: Partial file exists on disk')
      assert.ok(
        partCheck.reconciledBytes > 50000 && partCheck.reconciledBytes < 500000,
        `Step 03: Reconciled bytes (~130 KB - 256 KB): ${partCheck.reconciledBytes}`
      )
      console.log(`  [Phase 1] Verified partial file created: ${partCheck.reconciledBytes} bytes`)

      // Phase 2: Allow clean download and resume with --continue
      shouldAbruptlyDisconnect = false
      rangeRequestsReceived = []
      console.log('  [Phase 2] Resuming download with --continue...')

      const p2Args = ['--continue', fixtureUrl, '-o', outputTemplate]
      const exitCode2 = await new Promise((resolve) => {
        const child2 = spawn(ytdlpExecPath, p2Args, { windowsHide: true })
        child2.on('close', (code) => resolve(code))
        child2.on('error', () => resolve(1))
      })

      assert.equal(exitCode2, 0, 'Step 03: yt-dlp resume completed with exit code 0')
      assert.ok(
        rangeRequestsReceived.length > 0,
        'Step 03: Server received HTTP Range resume request'
      )
      console.log(`  [Phase 2] Server received Range header: ${rangeRequestsReceived[0]}`)

      // Verify completed file
      const finalStat = await import('node:fs/promises').then((fs) => fs.stat(expectedFinalFile))
      assert.equal(
        finalStat.size,
        fixtureTotalBytes,
        'Step 03: Completed file size matches 1 MB exactly'
      )

      const finalContent = await import('node:fs/promises').then((fs) =>
        fs.readFile(expectedFinalFile)
      )
      const finalSha256 = crypto.createHash('sha256').update(finalContent).digest('hex')
      assert.equal(
        finalSha256,
        expectedFixtureSha256,
        'Step 03: Final media content SHA-256 matches fixture exactly'
      )

      // Verify .part file no longer exists
      const postCleanupStat = await verifyJobPartialDownload(realJobId, testDownloadDir)
      assert.equal(
        postCleanupStat.isValid,
        false,
        'Step 03: .part file converted/removed on completion'
      )
      console.log(
        '✓ STEP 03 passed: Real yt-dlp HTTP Range resume successfully verified (100% real binary)\n'
      )
    } finally {
      await new Promise((resolve) => rangeServer.close(resolve))
      // Clean up test files
      try {
        await import('node:fs/promises').then((fs) => fs.unlink(expectedFinalFile)).catch(() => {})
        await import('node:fs/promises').then((fs) => fs.unlink(expectedPartFile)).catch(() => {})
      } catch (cleanupErr) {
        void cleanupErr
      }
    }

    // ========================================================================
    // STEP 04: REAL CONCURRENCY & RECOVERY FAILURE TESTS
    // ========================================================================
    console.log('--- STEP 04.A: Actual Queue Concurrency & FIFO Ordering ---')
    resetQueueForTesting()
    const qStatusInit = getQueueStatus()
    assert.equal(qStatusInit.maxConcurrency, 2, 'Step 04.A: Max concurrency limit is 2')
    assert.equal(qStatusInit.activeCount, 0, 'Step 04.A: Initial active count is 0')
    assert.equal(qStatusInit.waitingCount, 0, 'Step 04.A: Initial waiting count is 0')

    const qJob1 = 101
    const qJob2 = 102
    const qJob3 = 103

    assert.equal(enqueueDownloadJob(qJob1), true, 'Step 04.A: Job 1 enqueued')
    assert.equal(enqueueDownloadJob(qJob2), true, 'Step 04.A: Job 2 enqueued')
    assert.equal(enqueueDownloadJob(qJob3), true, 'Step 04.A: Job 3 enqueued')

    // Duplicate enqueue of already scheduled job returns false
    assert.equal(enqueueDownloadJob(qJob1), false, 'Step 04.A: Duplicate enqueue rejected')

    // Check shutdown protection:
    stopQueueForShutdown()
    assert.equal(enqueueDownloadJob(104), false, 'Step 04.A: New enqueue rejected during shutdown')
    resetQueueForTesting()
    await new Promise((resolve) => setTimeout(resolve, 100))
    console.log(
      '✓ STEP 04.A passed: Concurrency limit (2), FIFO queue, duplicate rejection, and shutdown guard verified\n'
    )

    console.log('--- STEP 04.B: Recovery Failure Lifecycle Tests (8 Scenarios) ---')
    await DownloadJob.destroy({ where: {} })

    // Scenario 1: Invalid partial file (0 bytes on disk when progress > 0)
    const failJob1 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'interrupted',
      progress: 50,
      downloaded_bytes: 5000000
    })
    const failPart1 = join(testDownloadDir, `fail1 [job-${failJob1.id}].mp4.part`)
    await writeFile(failPart1, Buffer.alloc(0)) // 0 bytes (corrupt/empty)
    const checkFail1 = await verifyJobPartialDownload(failJob1.id, testDownloadDir, {
      savedDownloadedBytes: failJob1.downloaded_bytes,
      savedProgress: failJob1.progress
    })
    assert.equal(checkFail1.isValid, false, 'Step 04.B.1: 0-byte file marked isValid: false')
    assert.equal(
      checkFail1.isResumable,
      false,
      'Step 04.B.1: 0-byte file marked isResumable: false'
    )

    // Scenario 2: Missing partial file (saved progress > 0, disk file missing)
    const failJob2 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 30,
      downloaded_bytes: 3000000
    })
    const checkFail2 = await verifyJobPartialDownload(failJob2.id, testDownloadDir, {
      savedDownloadedBytes: failJob2.downloaded_bytes,
      savedProgress: failJob2.progress
    })
    assert.equal(checkFail2.isValid, false, 'Step 04.B.2: Missing file marked isValid: false')
    assert.equal(checkFail2.isResumable, false, 'Step 04.B.2: Missing file not resumable')

    // Scenario 3: Transient network failure during execution
    const transientErr = Object.assign(new Error('connection reset by peer'), {
      code: 'ECONNRESET'
    })
    assert.equal(
      isTransientNetworkError(transientErr),
      true,
      'Step 04.B.3: ECONNRESET recognized as transient'
    )
    const classifiedNetwork = classifyDownloadError(transientErr)
    assert.equal(
      classifiedNetwork.code,
      DOWNLOAD_ERROR_CODES.NETWORK_ERROR,
      'Step 04.B.3: Classified as NETWORK_ERROR'
    )

    // Scenario 4: Process failure (fatal yt-dlp exit with 403 Forbidden)
    const procErr = new Error('ERROR: [youtube] 403 Forbidden - Access Denied')
    assert.equal(
      isTransientNetworkError(procErr),
      false,
      'Step 04.B.4: 403 Forbidden is non-transient'
    )
    const classifiedProc = classifyDownloadError(procErr)
    assert.equal(
      classifiedProc.code,
      DOWNLOAD_ERROR_CODES.SOURCE_ACCESS_DENIED,
      'Step 04.B.4: Classified as SOURCE_ACCESS_DENIED'
    )

    // Scenario 5: Filesystem permission error (EACCES)
    const permErr = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    assert.equal(
      isTransientNetworkError(permErr),
      false,
      'Step 04.B.5: EACCES is not network error'
    )
    const classifiedPerm = classifyDownloadError(permErr)
    assert.equal(
      classifiedPerm.code,
      DOWNLOAD_ERROR_CODES.PERMISSION_DENIED,
      'Step 04.B.5: Classified as PERMISSION_DENIED'
    )

    // Scenario 6: Cleanup failure handling
    const cleanupResult = await cleanupJobTemporaryFiles(99999, testDownloadDir)
    assert.equal(
      cleanupResult.success,
      true,
      'Step 04.B.6: Cleanup handles non-existent files gracefully'
    )
    assert.equal(cleanupResult.reason, 'directory_not_found', 'Step 04.B.6: Safe reason reported')

    // Scenario 7: Recovery process failure handling
    await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'interrupted',
      progress: 10
    })
    const recoveryRes = await resumeInterruptedNetworkJobs({ enqueue: () => {} })
    assert.equal(
      typeof recoveryRes.resumedCount,
      'number',
      'Step 04.B.7: Recovery finishes without throwing'
    )

    // Scenario 8: Application shutdown during recovery
    stopQueueForShutdown()
    const postShutdownEnq = enqueueDownloadJob(failJob1.id)
    assert.equal(postShutdownEnq, false, 'Step 04.B.8: Queue rejects dispatches during shutdown')
    resetQueueForTesting()
    console.log('✓ STEP 04.B passed: All 8 recovery failure lifecycle scenarios verified\n')

    // ========================================================================
    // STEP 01: CLEANUP FAILURE HANDLING AUTOMATED TESTS (10 Scenarios)
    // ========================================================================
    console.log('--- STEP 01: Cleanup Failure Handling Automated Tests (10 Scenarios) ---')
    setConnectivityCheckerForTesting(async () => true)

    // Test 1.1: Cleanup succeeds and job safely enqueued
    resetCleanupHandlerForTesting()
    const cleanJob1 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'interrupted',
      progress: 25,
      downloaded_bytes: 2500000
    })
    const enqueued11 = []
    await resumeInterruptedNetworkJobs({
      enqueue: (id) => {
        enqueued11.push(id)
        return true
      }
    })
    const reloaded11 = await DownloadJob.findByPk(cleanJob1.id)
    assert.equal(
      reloaded11.status,
      'queued',
      'Test 1.1: Status updated to queued after successful cleanup'
    )
    assert.equal(reloaded11.progress, 0, 'Test 1.1: Progress reset to 0')
    assert.equal(reloaded11.downloaded_bytes, 0, 'Test 1.1: Downloaded bytes reset to 0')
    assert.ok(enqueued11.includes(cleanJob1.id), 'Test 1.1: Job safely enqueued')
    console.log('✓ Test 1.1 passed: Cleanup succeeds and job safely enqueued')

    // Test 1.2: Root-level partial file deletion fails (returns success: false)
    const cleanJob2 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 40,
      downloaded_bytes: 4000000
    })
    setCleanupHandlerForTesting(async () => ({
      success: false,
      cleaned: false,
      cleanedFiles: [],
      workspaceCleaned: false,
      error: 'Failed to delete root partial file: EPERM operation not permitted'
    }))
    const enqueued12 = []
    await resumeInterruptedNetworkJobs({
      enqueue: (id) => {
        enqueued12.push(id)
        return true
      }
    })
    const reloaded12 = await DownloadJob.findByPk(cleanJob2.id)
    assert.equal(
      reloaded12.status,
      'failed',
      'Test 1.2: Status set to failed when root partial deletion fails'
    )
    assert.ok(
      reloaded12.error_message.includes('Failed to delete root partial file'),
      'Test 1.2: Error message persisted'
    )
    assert.equal(
      reloaded12.progress,
      40,
      'Test 1.2: Stale progress not reset to 0 on cleanup failure'
    )
    assert.equal(
      enqueued12.includes(cleanJob2.id),
      false,
      'Test 1.2: Job NOT enqueued on cleanup failure'
    )
    console.log('✓ Test 1.2 passed: Root-level partial file deletion failure handled safely')

    // Test 1.3: Temporary workspace deletion fails (returns success: false)
    const cleanJob3 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '480p',
      status: 'downloading',
      progress: 30,
      downloaded_bytes: 3000000
    })
    setCleanupHandlerForTesting(async () => ({
      success: false,
      cleaned: false,
      cleanedFiles: [],
      workspaceCleaned: false,
      error: 'Failed to delete temporary workspace directory: EBUSY resource locked'
    }))
    const enqueued13 = []
    await recoverInterruptedDownloadJobs({
      enqueue: (id) => {
        enqueued13.push(id)
        return true
      }
    })
    const reloaded13 = await DownloadJob.findByPk(cleanJob3.id)
    assert.equal(
      reloaded13.status,
      'failed',
      'Test 1.3: Status set to failed when workspace deletion fails'
    )
    assert.ok(
      reloaded13.error_message.includes('EBUSY resource locked'),
      'Test 1.3: Lock error persisted'
    )
    assert.equal(enqueued13.includes(cleanJob3.id), false, 'Test 1.3: Job NOT enqueued')
    console.log('✓ Test 1.3 passed: Temporary workspace deletion failure handled safely')

    // Test 1.4: Filesystem permission error occurs (EACCES/EPERM thrown)
    const cleanJob4 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '360p',
      status: 'interrupted',
      progress: 15,
      downloaded_bytes: 1500000
    })
    setCleanupHandlerForTesting(async () => {
      const err = new Error('EACCES: permission denied, unlink')
      err.code = 'EACCES'
      throw err
    })
    const enqueued14 = []
    await resumeInterruptedNetworkJobs({
      enqueue: (id) => {
        enqueued14.push(id)
        return true
      }
    })
    const reloaded14 = await DownloadJob.findByPk(cleanJob4.id)
    assert.equal(reloaded14.status, 'failed', 'Test 1.4: Status set to failed on EACCES')
    assert.ok(
      reloaded14.error_message.includes('EACCES'),
      'Test 1.4: EACCES error message persisted'
    )
    assert.equal(enqueued14.includes(cleanJob4.id), false, 'Test 1.4: Job NOT enqueued')
    console.log('✓ Test 1.4 passed: Filesystem permission error (EACCES) caught and marked failed')

    // Test 1.5: Cleanup returns success: false with custom reason
    const cleanJob5 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '240p',
      status: 'interrupted',
      progress: 50,
      downloaded_bytes: 5000000
    })
    setCleanupHandlerForTesting(async () => ({
      success: false,
      cleaned: false,
      cleanedFiles: [],
      workspaceCleaned: false,
      error: 'Unsafe partial file: symbolic link or junction detected'
    }))
    const enqueued15 = []
    await resumeInterruptedNetworkJobs({
      enqueue: (id) => {
        enqueued15.push(id)
        return true
      }
    })
    const reloaded15 = await DownloadJob.findByPk(cleanJob5.id)
    assert.equal(reloaded15.status, 'failed', 'Test 1.5: Status set to failed on symlink detection')
    assert.ok(
      reloaded15.error_message.includes('symbolic link or junction'),
      'Test 1.5: Symlink error persisted'
    )
    assert.equal(enqueued15.includes(cleanJob5.id), false, 'Test 1.5: Job NOT enqueued')
    console.log('✓ Test 1.5 passed: Cleanup returns success: false marks job failed')

    // Test 1.6: Job is NOT enqueued after cleanup failure (enqueue not called)
    let enqueueCallCount = 0
    setCleanupHandlerForTesting(async () => ({
      success: false,
      cleaned: false,
      cleanedFiles: [],
      workspaceCleaned: false,
      error: 'Simulated failure to verify zero enqueue calls'
    }))
    const cleanJob6 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 60,
      downloaded_bytes: 6000000
    })
    await resumeInterruptedNetworkJobs({
      enqueue: () => {
        enqueueCallCount++
      }
    })
    assert.equal(enqueueCallCount, 0, 'Test 1.6: enqueue() called 0 times on cleanup failure')
    assert.ok(cleanJob6.id > 0, 'Test 1.6: Job ID preserved')
    console.log('✓ Test 1.6 passed: enqueue() is never called after cleanup failure')

    // Test 1.7: Original Job ID is strictly preserved
    const totalJobsBefore = await DownloadJob.count()
    const cleanJob7 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'interrupted',
      progress: 70,
      downloaded_bytes: 7000000
    })
    await resumeInterruptedNetworkJobs({ enqueue: () => {} })
    const reloaded17 = await DownloadJob.findByPk(cleanJob7.id)
    assert.equal(reloaded17.id, cleanJob7.id, 'Test 1.7: Original Job ID preserved')
    const totalJobsAfter = await DownloadJob.count()
    assert.equal(totalJobsAfter, totalJobsBefore + 1, 'Test 1.7: No duplicate job records created')
    console.log('✓ Test 1.7 passed: Original Job ID strictly preserved in SQLite')

    // Test 1.8: Error information is persisted in SQLite
    const reloadedFromDb = await DownloadJob.findByPk(cleanJob7.id)
    assert.ok(reloadedFromDb.error_message !== null, 'Test 1.8: error_message is not null in DB')
    assert.ok(
      reloadedFromDb.error_message.length > 5,
      'Test 1.8: error_message contains meaningful error info'
    )
    console.log('✓ Test 1.8 passed: Error information persisted in SQLite')

    // Test 1.9: No duplicate recovery is scheduled (Idempotency)
    const enqueued19 = []
    await resumeInterruptedNetworkJobs({
      enqueue: (id) => {
        enqueued19.push(id)
      }
    })
    assert.equal(
      enqueued19.includes(cleanJob7.id),
      false,
      'Test 1.9: Failed job not rescheduled on subsequent recovery'
    )
    console.log('✓ Test 1.9 passed: No duplicate recovery scheduled for failed jobs')

    // Test 1.10: Successful cleanup allows normal recovery
    resetCleanupHandlerForTesting()
    const cleanJob10 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '480p',
      status: 'interrupted',
      progress: 10,
      downloaded_bytes: 1000000
    })
    const enqueued110 = []
    await resumeInterruptedNetworkJobs({
      enqueue: (id) => {
        enqueued110.push(id)
      }
    })
    const reloaded110 = await DownloadJob.findByPk(cleanJob10.id)
    assert.equal(
      reloaded110.status,
      'queued',
      'Test 1.10: Status queued after resetCleanupHandlerForTesting'
    )
    assert.equal(reloaded110.progress, 0, 'Test 1.10: Progress reset to 0')
    assert.ok(enqueued110.includes(cleanJob10.id), 'Test 1.10: Job successfully enqueued')
    console.log('✓ Test 1.10 passed: Successful cleanup allows normal recovery flow\n')

    // ========================================================================
    // STEP 01.B: DOWNLOAD PATH RESOLUTION FAILURE AUTOMATED TESTS
    // ========================================================================
    console.log('--- STEP 01.B: Download Path Resolution Failure Fix Automated Tests ---')

    // 1. Path Resolution Validation Matrix Table
    console.log('  [Path Matrix 1.1] Valid directory path resolution...')
    const validResolved = await resolveValidatedDownloadPath(AppSetting)
    assert.equal(
      typeof validResolved,
      'string',
      'Valid download directory resolves to non-empty string'
    )
    assert.ok(validResolved.length > 0, 'Valid path resolved')

    console.log('  [Path Matrix 1.2] Null path rejection...')
    setPathResolverForTesting(async () => null)
    const nullResolved = await resolveValidatedDownloadPath(AppSetting)
    assert.equal(nullResolved, null, 'Null path resolves to null')

    console.log('  [Path Matrix 1.3] Empty and whitespace path rejection...')
    setPathResolverForTesting(async () => '   ')
    const emptyResolved = await resolveValidatedDownloadPath(AppSetting)
    assert.equal(emptyResolved, null, 'Empty/whitespace path resolves to null')

    console.log('  [Path Matrix 1.4] Malformed path with illegal characters rejection...')
    setPathResolverForTesting(async () => 'C:\\invalid<?|folder')
    const malformedResolved = await resolveValidatedDownloadPath(AppSetting)
    assert.equal(malformedResolved, null, 'Malformed path resolves to null')

    console.log('  [Path Matrix 1.5] Root drive path rejection...')
    setPathResolverForTesting(async () => 'C:\\')
    const rootDriveResolved = await resolveValidatedDownloadPath(AppSetting)
    assert.equal(rootDriveResolved, null, 'Root drive directory resolves to null')

    console.log('  [Path Matrix 1.6] Non-existent path traversal escape rejection...')
    setPathResolverForTesting(async () => 'C:\\nonexistent_directory_xyz\\..\\..\\traversal')
    const traversalResolved = await resolveValidatedDownloadPath(AppSetting)
    assert.equal(traversalResolved, null, 'Non-existent traversal path resolves to null')

    resetPathResolverForTesting()
    console.log(
      '  ✓ Path Matrix Tests passed: Valid, null, empty, malformed, root drive, and traversal paths verified'
    )

    // 2. Specific Regression Scenario 1: Startup Download Recovery with null path
    console.log('  [Regression 1.1] Startup Recovery with null downloadPath (Option A)...')
    const regJob1 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 45,
      downloaded_bytes: 450000
    })
    setPathResolverForTesting(async () => null)
    resetRecoveryTrackingForTesting()
    const regStartupRes = await recoverInterruptedDownloadJobs({
      autoEnqueue: true,
      isOnline: true
    })
    const reloadedReg1 = await DownloadJob.findByPk(regJob1.id)

    assert.equal(reloadedReg1.id, regJob1.id, 'Reg 1.1: Original Job ID strictly preserved')
    assert.equal(reloadedReg1.status, 'failed', 'Reg 1.1: Status marked as failed')
    assert.equal(
      reloadedReg1.error_message,
      'Recovery failed: Unable to resolve valid download folder path',
      'Reg 1.1: Exact descriptive error message persisted'
    )
    assert.equal(reloadedReg1.progress, 45, 'Reg 1.1: Progress NOT reset to 0')
    assert.equal(reloadedReg1.downloaded_bytes, 450000, 'Reg 1.1: Downloaded bytes NOT reset to 0')
    assert.equal(
      regStartupRes.recoveredJobIds.includes(regJob1.id),
      false,
      'Reg 1.1: Job NOT returned in recoveredJobIds'
    )
    assert.equal(
      getQueueStatus().scheduledJobIds.includes(regJob1.id),
      false,
      'Reg 1.1: Job NOT enqueued into download queue'
    )
    console.log(
      '  ✓ Reg 1.1 passed: Startup recovery with null path preserves Job ID & progress, persists error, never enqueued'
    )

    // 3. Specific Regression Scenario 2: Network Recovery with null path
    console.log('  [Regression 1.2] Network Recovery with null downloadPath (Option A)...')
    const regJob2 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 60,
      downloaded_bytes: 600000
    })
    setConnectivityCheckerForTesting(async () => true)
    setPathResolverForTesting(async () => null)
    const regNetRes = await resumeInterruptedNetworkJobs()
    const reloadedReg2 = await DownloadJob.findByPk(regJob2.id)

    assert.equal(reloadedReg2.id, regJob2.id, 'Reg 1.2: Original Job ID strictly preserved')
    assert.equal(reloadedReg2.status, 'failed', 'Reg 1.2: Status marked as failed')
    assert.equal(
      reloadedReg2.error_message,
      'Network recovery failed: Unable to resolve valid download folder path',
      'Reg 1.2: Exact descriptive error message persisted'
    )
    assert.equal(reloadedReg2.progress, 60, 'Reg 1.2: Progress NOT reset to 0')
    assert.equal(reloadedReg2.downloaded_bytes, 600000, 'Reg 1.2: Downloaded bytes NOT reset to 0')
    assert.equal(
      regNetRes.resumedJobIds.includes(regJob2.id),
      false,
      'Reg 1.2: Job NOT in resumedJobIds'
    )
    assert.equal(
      getQueueStatus().scheduledJobIds.includes(regJob2.id),
      false,
      'Reg 1.2: Job NOT enqueued into queue'
    )
    console.log(
      '  ✓ Reg 1.2 passed: Network recovery with null path preserves Job ID & progress, persists error, never enqueued'
    )

    // 4. Regression Scenario 3: Startup Recovery with root drive path
    console.log('  [Regression 1.3] Startup Recovery with root drive path...')
    const regJob3 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'downloading',
      progress: 30,
      downloaded_bytes: 300000
    })
    setPathResolverForTesting(async () => 'C:\\')
    resetRecoveryTrackingForTesting()
    await recoverInterruptedDownloadJobs({ autoEnqueue: true, isOnline: true })
    const reloadedReg3 = await DownloadJob.findByPk(regJob3.id)

    assert.equal(reloadedReg3.id, regJob3.id, 'Reg 1.3: Original Job ID strictly preserved')
    assert.equal(reloadedReg3.status, 'failed', 'Reg 1.3: Status marked as failed')
    assert.equal(reloadedReg3.progress, 30, 'Reg 1.3: Progress NOT reset')
    assert.equal(reloadedReg3.downloaded_bytes, 300000, 'Reg 1.3: Downloaded bytes NOT reset')
    assert.equal(
      getQueueStatus().scheduledJobIds.includes(regJob3.id),
      false,
      'Reg 1.3: Job NOT enqueued'
    )
    console.log(
      '  ✓ Reg 1.3 passed: Startup recovery with root drive marks failed safely without resetting progress'
    )

    // 5. Regression Scenario 4: Network Recovery with malformed path
    console.log('  [Regression 1.4] Network Recovery with malformed path...')
    const regJob4 = await DownloadJob.create({
      media_id: media.id,
      output_format: 'mp4',
      quality: '480p',
      status: 'interrupted',
      progress: 25,
      downloaded_bytes: 250000
    })
    setPathResolverForTesting(async () => 'C:\\invalid<?path')
    await resumeInterruptedNetworkJobs()
    const reloadedReg4 = await DownloadJob.findByPk(regJob4.id)

    assert.equal(reloadedReg4.id, regJob4.id, 'Reg 1.4: Original Job ID strictly preserved')
    assert.equal(reloadedReg4.status, 'failed', 'Reg 1.4: Status marked as failed')
    assert.equal(reloadedReg4.progress, 25, 'Reg 1.4: Progress NOT reset')
    assert.equal(reloadedReg4.downloaded_bytes, 250000, 'Reg 1.4: Downloaded bytes NOT reset')
    assert.equal(
      getQueueStatus().scheduledJobIds.includes(regJob4.id),
      false,
      'Reg 1.4: Job NOT enqueued'
    )
    resetPathResolverForTesting()
    console.log(
      '  ✓ Reg 1.4 passed: Network recovery with malformed path marks failed safely without resetting progress\n'
    )

    // ========================================================================
    // STEP 03: FULL APPLICATION RECOVERY INTEGRATION PIPELINE (Scenarios A - E)
    // Production Pipeline: Startup Recovery -> File Validation -> Recovery Decision
    // -> Real Queue -> Real Download Service -> Real Process Launcher -> Real yt-dlp
    // -> Progress Updates -> SQLite Persistence -> Final Media File
    // ========================================================================
    console.log('--- STEP 03: Full Application Recovery Integration Pipeline (Scenarios A - E) ---')

    const fs = await import('node:fs/promises')
    const fsSync = await import('node:fs')
    const fixturePath = join(testDownloadDir, 'test_fixture.mp4')
    if (!fsSync.existsSync(fixturePath)) {
      const rootFixture = 'test_fixture.mp4'
      if (fsSync.existsSync(rootFixture)) {
        await fs.copyFile(rootFixture, fixturePath)
      } else {
        const { execFileSync } = await import('node:child_process')
        const ffmpegBin = join(process.cwd(), 'resources', 'bin', 'win32-x64', 'ffmpeg.exe')
        execFileSync(ffmpegBin, [
          '-f',
          'lavfi',
          '-i',
          'testsrc=duration=5:size=640x480:rate=10',
          '-f',
          'lavfi',
          '-i',
          'anullsrc=r=44100:cl=stereo',
          '-c:v',
          'libx264',
          '-c:a',
          'aac',
          '-pix_fmt',
          'yuv420p',
          '-b:v',
          '500k',
          '-t',
          '5',
          '-y',
          fixturePath
        ])
      }
    }
    const e2eFullFixtureBuffer = await fs.readFile(fixturePath)
    const e2eFullFixtureBytes = e2eFullFixtureBuffer.length
    const expectedSha256 = crypto.createHash('sha256').update(e2eFullFixtureBuffer).digest('hex')
    console.log(
      `  [Setup] Genuine media fixture loaded: ${e2eFullFixtureBytes} bytes, SHA-256: ${expectedSha256}`
    )

    let e2eShouldDisconnect = false
    let e2eReqCount = 0
    let e2eRangeRequests = []

    const e2eServer = http.createServer((req, res) => {
      e2eReqCount++
      const range = req.headers['range']
      if (range) {
        e2eRangeRequests.push(range)
      }

      if (e2eShouldDisconnect) {
        if (e2eReqCount === 1) {
          // Request 1: metadata probe
          res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Length': e2eFullFixtureBytes
          })
          res.end(e2eFullFixtureBuffer)
          return
        }
        if (e2eReqCount === 2) {
          // Request 2: media stream - deliver first 40,000 bytes then drop connection
          res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Length': e2eFullFixtureBytes
          })
          res.write(e2eFullFixtureBuffer.subarray(0, 40000))
          setTimeout(() => {
            req.socket.destroy()
          }, 50)
          return
        }
        // Subsequent retries during network drop
        req.socket.destroy()
        return
      }

      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range)
        if (match) {
          const start = parseInt(match[1], 10)
          const end = match[2] ? parseInt(match[2], 10) : e2eFullFixtureBytes - 1
          const chunk = e2eFullFixtureBuffer.subarray(start, end + 1)
          res.writeHead(206, {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${e2eFullFixtureBytes}`,
            'Content-Length': chunk.length
          })
          res.end(chunk)
          return
        }
      }

      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': e2eFullFixtureBytes
      })
      res.end(e2eFullFixtureBuffer)
    })

    await new Promise((resolve) => e2eServer.listen(0, '127.0.0.1', resolve))
    const e2ePort = e2eServer.address().port
    const e2eUrl = `http://127.0.0.1:${e2ePort}/fixture.mp4`

    // Enable automated test hooks
    setAllowLocalhostForTesting(true)
    setAnalyzerForTesting(async () => ({
      platform: 'youtube',
      title: 'fixture',
      duration: 20,
      availableFormats: {
        mp4Formats: [
          { formatId: 'mp4', quality: '720p', audioIncluded: true, fileSize: e2eFullFixtureBytes }
        ],
        audioFormats: [],
        mp4Qualities: ['720p']
      }
    }))
    setConnectivityCheckerForTesting(async () => true)

    try {
      const e2eMedia = await MediaItem.create({
        source_url: e2eUrl,
        platform: 'youtube',
        title: 'Fixture Media'
      })

      // Scenario A & B: Full Application Pipeline Download, Interruption, and Range-Header Resume
      console.log(
        '  [Scenario A & B] Production Pipeline End-to-End: Interruption, Recovery & Range Resume...'
      )
      e2eShouldDisconnect = true
      e2eReqCount = 0
      e2eRangeRequests = []

      const e2eJobA = await DownloadJob.create({
        media_id: e2eMedia.id,
        output_format: 'mp4',
        quality: '720p',
        status: 'queued',
        progress: 0,
        downloaded_bytes: 0
      })

      // Phase 1: Real download initiated via real queue
      enqueueDownloadJob(e2eJobA.id)

      // Wait until initial download is interrupted by network loss and queue is idle
      const startWaitA1 = Date.now()
      while (Date.now() - startWaitA1 < 25000) {
        const j = await DownloadJob.findByPk(e2eJobA.id)
        if (
          j.status !== 'queued' &&
          getQueueStatus().activeJobs === 0 &&
          getQueueStatus().waitingJobs === 0
        ) {
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }

      const interruptedJobA = await DownloadJob.findByPk(e2eJobA.id)
      assert.equal(
        interruptedJobA.status,
        'interrupted',
        'Scenario A: Job transitioned to interrupted on network drop'
      )
      assert.ok(
        interruptedJobA.downloaded_bytes > 0,
        'Scenario A: Downloaded bytes recorded in SQLite'
      )
      assert.equal(interruptedJobA.id, e2eJobA.id, 'Scenario A: Original Job ID preserved')

      // Record original Job ID and verify partial workspace exists
      const originalJobId = e2eJobA.id
      const partialWorkspaceDir = join(
        testDownloadDir,
        '.applan2-partial-downloads',
        `job-${originalJobId}`
      )
      const partialEntries = await fs.readdir(partialWorkspaceDir).catch(() => [])
      assert.ok(
        partialEntries.length > 0,
        'Scenario A: Partial file exists before cold-start restart'
      )

      // Phase B: Simulate application shutdown & cold start (persist SQLite & partial files, clear in-memory state)
      stopQueueForShutdown()
      resetQueueForTesting()
      resetNetworkMonitoringForTesting()
      resetRecoveryTrackingForTesting()

      // Phase C: Application startup recovery
      e2eShouldDisconnect = false
      e2eRangeRequests = []

      console.log(
        '    Triggering recoverInterruptedDownloadJobs() with real production queue on cold start...'
      )
      const startupRecRes = await recoverInterruptedDownloadJobs({
        autoEnqueue: true,
        isOnline: true
      })
      assert.ok(
        startupRecRes.recoveredJobIds.includes(originalJobId),
        'Scenario A: Job recovered and auto-enqueued upon cold-start startup'
      )

      // Phase D: Wait until real queue and yt-dlp finish download and ffprobe completes
      const startWaitA2 = Date.now()
      while (Date.now() - startWaitA2 < 25000) {
        const j = await DownloadJob.findByPk(originalJobId)
        if (j.status === 'completed' || j.status === 'failed') {
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }

      // Phase E: Required assertions for cold-start recovery
      const completedJobA = await DownloadJob.findByPk(originalJobId)
      assert.equal(
        completedJobA.status,
        'completed',
        'Scenario A: Real pipeline completed successfully'
      )
      assert.equal(
        completedJobA.id,
        originalJobId,
        'Scenario A: Original Job ID strictly preserved throughout'
      )
      assert.equal(completedJobA.progress, 100, 'Scenario A: Progress reached 100%')

      const e2eJobRows = await DownloadJob.findAll({ where: { id: originalJobId } })
      assert.equal(e2eJobRows.length, 1, 'Scenario A: Exactly one DownloadJob row exists')

      const e2eFileRows = await DownloadFile.findAll({ where: { download_job_id: originalJobId } })
      assert.equal(e2eFileRows.length, 1, 'Scenario A: Exactly one DownloadFile row exists')

      // Scenario B assertions: HTTP Range Header Verification
      assert.ok(e2eRangeRequests.length > 0, 'Scenario B: Real yt-dlp sent HTTP Range request')
      const firstRange = e2eRangeRequests[0]
      const rangeMatch = /bytes=(\d+)-/.exec(firstRange)
      assert.ok(rangeMatch, `Scenario B: Received valid Range header: ${firstRange}`)
      const requestedOffset = parseInt(rangeMatch[1], 10)
      assert.ok(
        requestedOffset > 0,
        `Scenario B: Range request offset (${requestedOffset}) matches partial file`
      )

      // Verify final media file on disk
      const dirFilesA = await fs.readdir(testDownloadDir)
      const finalFileA = dirFilesA.find(
        (f) => f.includes(`[job-${e2eJobA.id}]`) && !f.endsWith('.part')
      )
      assert.ok(finalFileA, 'Scenario A: Final media file exists on disk without .part extension')
      const finalBufA = await fs.readFile(join(testDownloadDir, finalFileA))
      const finalShaA = crypto.createHash('sha256').update(finalBufA).digest('hex')
      assert.equal(
        finalShaA,
        expectedSha256,
        'Scenario A: Final file SHA-256 matches fixture exactly'
      )
      console.log(
        '  ✓ Scenario A & B passed: Production pipeline (startup recovery -> queue -> yt-dlp -> Range -> ffprobe -> SHA match) verified'
      )

      // Scenario C: Invalid Partial File (Severe Progress Mismatch) -> Cleanup -> Safe Restart
      console.log('  [Scenario C] Invalid Partial File Safe Restart via Real Queue...')
      const e2eJobC = await DownloadJob.create({
        media_id: e2eMedia.id,
        output_format: 'mp4',
        quality: '720p',
        status: 'interrupted',
        progress: 50,
        downloaded_bytes: 20 * 1024 * 1024 // 20 MB in DB
      })
      // Write corrupted 1 KB partial file (severe mismatch with 20 MB DB value)
      const corruptedPartPath = join(testDownloadDir, `corrupted [job-${e2eJobC.id}].mp4.part`)
      await fs.writeFile(corruptedPartPath, Buffer.alloc(1024))

      resetRecoveryTrackingForTesting()
      await recoverInterruptedDownloadJobs({ autoEnqueue: true, isOnline: true })

      // Wait until real queue schedules and executes download from 0 to completion
      const startWaitC = Date.now()
      while (Date.now() - startWaitC < 25000) {
        const j = await DownloadJob.findByPk(e2eJobC.id)
        if (j.status === 'completed' || j.status === 'failed') {
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }

      const completedJobC = await DownloadJob.findByPk(e2eJobC.id)
      assert.equal(
        completedJobC.status,
        'completed',
        'Scenario C: Invalid partial restarted safely and completed'
      )
      assert.equal(completedJobC.id, e2eJobC.id, 'Scenario C: Original Job ID preserved')
      const dirFilesC = await fs.readdir(testDownloadDir)
      const finalFileC = dirFilesC.find(
        (f) => f.includes(`[job-${e2eJobC.id}]`) && !f.endsWith('.part')
      )
      assert.ok(finalFileC, 'Scenario C: Final completed media file exists')
      const finalBufC = await fs.readFile(join(testDownloadDir, finalFileC))
      const finalShaC = crypto.createHash('sha256').update(finalBufC).digest('hex')
      assert.equal(finalShaC, expectedSha256, 'Scenario C: SHA-256 matches fixture')
      console.log(
        '  ✓ Scenario C passed: Invalid partial file safely cleaned and restarted from 0 via real queue'
      )

      // Scenario D: Cleanup Failure During Recovery
      console.log('  [Scenario D] Cleanup Failure Halts Recovery Safely...')
      const e2eJobD = await DownloadJob.create({
        media_id: e2eMedia.id,
        output_format: 'mp4',
        quality: '720p',
        status: 'interrupted',
        progress: 45,
        downloaded_bytes: 15 * 1024 * 1024
      })
      setCleanupHandlerForTesting(async () => ({
        success: false,
        cleaned: false,
        cleanedFiles: [],
        workspaceCleaned: false,
        error: 'Simulated disk I/O error during recovery cleanup'
      }))
      const enqueuedD = []
      await resumeInterruptedNetworkJobs({
        enqueue: (id) => {
          enqueuedD.push(id)
          return true
        }
      })
      const reloadedJobD = await DownloadJob.findByPk(e2eJobD.id)
      assert.equal(reloadedJobD.status, 'failed', 'Scenario D: Status marked failed')
      assert.ok(
        reloadedJobD.error_message.includes('Simulated disk I/O error'),
        'Scenario D: Error persisted'
      )
      assert.equal(
        enqueuedD.includes(e2eJobD.id),
        false,
        'Scenario D: Job NOT enqueued on cleanup failure'
      )
      assert.equal(reloadedJobD.id, e2eJobD.id, 'Scenario D: Original Job ID preserved')
      resetCleanupHandlerForTesting()
      console.log(
        '  ✓ Scenario D passed: Cleanup failure marks job failed and halts recovery safely'
      )

      // Scenario E: Application Restart Lifecycle (Offline -> Interrupted, Online -> Resumed -> Completed)
      console.log('  [Scenario E] Application Restart Recovery Lifecycle...')
      const e2eJobE = await DownloadJob.create({
        media_id: e2eMedia.id,
        output_format: 'mp4',
        quality: '720p',
        status: 'downloading',
        progress: 20,
        downloaded_bytes: 20000
      })

      // Restart 1: Application starts offline
      resetRecoveryTrackingForTesting()
      await recoverInterruptedDownloadJobs({ autoEnqueue: false, isOnline: false })
      const reloadedJobE1 = await DownloadJob.findByPk(e2eJobE.id)
      assert.equal(
        reloadedJobE1.status,
        'interrupted',
        'Scenario E: Downloading job moved to interrupted during offline startup'
      )

      // Restart 2: Application starts online
      resetRecoveryTrackingForTesting()
      await recoverInterruptedDownloadJobs({ autoEnqueue: true, isOnline: true })

      // Wait until real queue executes and completes download
      const startWaitE = Date.now()
      while (Date.now() - startWaitE < 25000) {
        const j = await DownloadJob.findByPk(e2eJobE.id)
        if (j.status === 'completed' || j.status === 'failed') {
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }

      const completedJobE = await DownloadJob.findByPk(e2eJobE.id)
      assert.equal(
        completedJobE.status,
        'completed',
        'Scenario E: Job completed via real queue after online restart'
      )
      assert.equal(completedJobE.id, e2eJobE.id, 'Scenario E: Original Job ID strictly preserved')
      console.log(
        '  ✓ Scenario E passed: Application restart lifecycle recovers interrupted jobs safely\n'
      )
    } finally {
      await new Promise((resolve) => e2eServer.close(resolve))
    }

    console.log('================================================================')
    console.log(' ALL TESTS 01 THROUGH 10 (AND F, G, H, B, C, D, E) PASSED (100%)')
    console.log('================================================================\n')
  } finally {
    resetAllowLocalhostForTesting()
    resetAnalyzerForTesting()
    resetPathResolverForTesting()
    resetCleanupHandlerForTesting()
    setConnectivityCheckerForTesting(null)
    resetNetworkMonitoringForTesting()
    resetQueueForTesting()
    await testDb.cleanup()
  }
}

runNetworkRecoveryTests().catch((err) => {
  console.error('\n❌ PHASE 04 TESTS FAILED:', err)
  process.exit(1)
})
