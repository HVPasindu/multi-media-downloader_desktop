import assert from 'node:assert/strict'
import {
  recoverInterruptedDownloadJobs,
  resetRecoveryTrackingForTesting
} from '../src/main/backend/services/downloadRecoveryService.js'
import { writeFile, unlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  isSqliteBusyError,
  withCompletionWriteLock,
  createDownloadJob
} from '../src/main/backend/services/downloadService.js'
import { createTestDatabase } from './helpers/testDatabase.js'

/**
 * ============================================================================
 * APPLAN2 — Step 04.44 Automated Test Groups F & G: Lifecycle & SQLite Tests
 *
 * Covers:
 * - Application restart recovery for interrupted jobs (downloading -> failed, queued -> failed)
 * - Preservation of terminal states (completed, cancelled, previously failed)
 * - Idempotency of restart recovery
 * - SQLite transaction rollbacks
 * - SQLITE_BUSY error classification and serialized write lock
 * - Model associations and relationships
 * ============================================================================
 */
async function runDownloadLifecycleTests() {
  console.log('================================================================')
  console.log(' APPLAN2 — Step 04.44 Test Groups F & G: Lifecycle & DB Tests   ')
  console.log('================================================================\n')

  const testDb = await createTestDatabase('applan2-lifecycle-test-')
  console.log(`[setup] Isolated test database ready: ${testDb.databasePath}\n`)

  try {
    const { MediaItem, DownloadJob, DownloadFile } = testDb.sequelize.models

    const media = await MediaItem.create({
      source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      platform: 'youtube',
      title: 'Lifecycle Media Item'
    })

    // ------------------------------------------------------------------------
    // 1. Restart Recovery for Interrupted Jobs (Option A: Resume Existing Job)
    // ------------------------------------------------------------------------
    console.log('--- 1. Testing Restart Recovery (Option A) ---')
    resetRecoveryTrackingForTesting()

    const { AppSetting } = testDb.sequelize.models
    const testDownloadDir = join(tmpdir(), `applan2-lifecycle-dl-${Date.now()}`)
    await mkdir(testDownloadDir, { recursive: true })

    // Configure test download folder in AppSettings
    await AppSetting.create({
      key: 'download_path',
      value: testDownloadDir
    })

    // Seed Job 1: downloading job WITH a valid partial file
    const resumableJob = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '1080p'
    })
    await DownloadJob.update(
      { status: 'downloading', progress: 65, downloaded_bytes: 12000000 },
      { where: { id: resumableJob.id } }
    )
    // Create a real .part file for resumableJob
    const partFilePath = join(
      testDownloadDir,
      `test-video [dQw4w9WgXcQ] [1080p] [job-${resumableJob.id}].mp4.part`
    )
    await writeFile(partFilePath, Buffer.alloc(1024 * 1024, 0xaa))

    // Seed Job 2: downloading job WITHOUT partial file (missing file)
    const freshRestartJob = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    await DownloadJob.update(
      { status: 'downloading', progress: 40, downloaded_bytes: 5000000 },
      { where: { id: freshRestartJob.id } }
    )

    // Seed Job 3: queued job from prior session
    const staleQueuedJob = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp3',
      audioBitrateKbps: 320
    })

    // Seed Job 4: completed job
    const completedJob = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    await DownloadJob.update(
      { status: 'completed', progress: 100 },
      { where: { id: completedJob.id } }
    )

    // Seed Job 5: cancelled job
    const cancelledJob = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp3',
      audioBitrateKbps: 128
    })
    await DownloadJob.update({ status: 'cancelled' }, { where: { id: cancelledJob.id } })

    // Execute Option A application restart recovery (with mock enqueue to verify FIFO order)
    const enqueuedJobs = []
    const recoveryResult1 = await recoverInterruptedDownloadJobs({
      autoEnqueue: true,
      enqueue: (id) => enqueuedJobs.push(id)
    })
    assert.equal(recoveryResult1.interruptedDownloads, 2, '1.1: Two downloading jobs recovered')
    assert.equal(recoveryResult1.interruptedQueuedJobs, 1, '1.2: One queued job recovered')

    // Verify Job 1 (with valid .part file): restored to queued, preserving original Job ID, progress & bytes
    const reloadedResumable = await DownloadJob.findByPk(resumableJob.id)
    assert.equal(
      reloadedResumable.id,
      resumableJob.id,
      '1.3: Same DownloadJob ID reused (Option A)'
    )
    assert.equal(reloadedResumable.status, 'queued', '1.4: Resumable job transitioned to queued')
    assert.equal(reloadedResumable.progress, 65, '1.5: Preserves progress snapshot (65%)')
    assert.equal(reloadedResumable.downloaded_bytes, 12000000, '1.6: Preserves downloaded bytes')
    assert.equal(reloadedResumable.error_message, null, '1.7: Error message cleared')

    // Verify Job 2 (missing .part file): safely reset to 0, same Job ID reused
    const reloadedFresh = await DownloadJob.findByPk(freshRestartJob.id)
    assert.equal(reloadedFresh.id, freshRestartJob.id, '1.8: Same Job ID reused for fresh restart')
    assert.equal(reloadedFresh.status, 'queued', '1.9: Fresh restart job transitioned to queued')
    assert.equal(reloadedFresh.progress, 0, '1.10: Unverified job progress reset to 0')
    assert.equal(
      reloadedFresh.downloaded_bytes,
      0,
      '1.11: Unverified job downloaded_bytes reset to 0'
    )
    assert.equal(reloadedFresh.error_message, null, '1.12: Error message cleared')

    // Verify Job 3 (queued job): restored to queued
    const reloadedQueued = await DownloadJob.findByPk(staleQueuedJob.id)
    assert.equal(reloadedQueued.id, staleQueuedJob.id, '1.13: Queued job preserved')
    assert.equal(reloadedQueued.status, 'queued', '1.14: Queued job remains queued')
    assert.equal(reloadedQueued.error_message, null, '1.15: Error message cleared')

    // Verify FIFO enqueue order
    assert.deepEqual(
      enqueuedJobs,
      [resumableJob.id, freshRestartJob.id, staleQueuedJob.id],
      '1.16: Recovered jobs enqueued in FIFO order (createdAt ASC, id ASC)'
    )

    // Verify terminal states were untouched
    const reloadedCompleted = await DownloadJob.findByPk(completedJob.id)
    assert.equal(reloadedCompleted.status, 'completed', '1.17: Completed job remained completed')

    const reloadedCancelled = await DownloadJob.findByPk(cancelledJob.id)
    assert.equal(reloadedCancelled.status, 'cancelled', '1.18: Cancelled job remained cancelled')

    // Idempotency: repeating recovery immediately finds 0 jobs to recover
    const recoveryResult2 = await recoverInterruptedDownloadJobs({ autoEnqueue: false })
    assert.equal(
      recoveryResult2.interruptedDownloads,
      0,
      '1.19: Idempotent recovery finds 0 downloading'
    )
    assert.equal(
      recoveryResult2.interruptedQueuedJobs,
      0,
      '1.20: Idempotent recovery finds 0 queued'
    )

    // Clean up test part file
    try {
      await unlink(partFilePath)
    } catch {
      // Ignore
    }

    console.log(
      '✓ Section 1: Option A recovery (partial-file verify, FIFO order, idempotency) verified.\n'
    )

    // ------------------------------------------------------------------------
    // 2. SQLite Consistency & Transactions
    // ------------------------------------------------------------------------
    console.log('--- 2. Testing SQLite Consistency & Transactions ---')

    // 2.1: Transaction rollback on failure
    let rollbackJobId = null
    try {
      await testDb.sequelize.transaction(async (t) => {
        const tempJob = await DownloadJob.create(
          {
            media_id: media.id,
            source_type: 'link',
            output_format: 'mp4',
            quality: '720p',
            status: 'queued',
            progress: 0,
            downloaded_bytes: 0
          },
          { transaction: t }
        )
        rollbackJobId = tempJob.id

        // Deliberate error to trigger rollback
        throw new Error('Forced Rollback Error')
      })
    } catch (err) {
      assert.equal(err.message, 'Forced Rollback Error')
    }

    const checkRolledBack = await DownloadJob.findByPk(rollbackJobId)
    assert.equal(
      checkRolledBack,
      null,
      '2.1: Transaction rolled back successfully; record does not exist'
    )

    // 2.2: DownloadFile insertion and relationship
    const validJob = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '720p'
    })

    const savedFile = await DownloadFile.create({
      download_job_id: validJob.id,
      file_name: 'sample.mp4',
      file_path: 'C:/test_downloads/sample.mp4',
      file_format: 'mp4',
      file_size: 2048576
    })
    assert.ok(savedFile.id, '2.2: DownloadFile saved')
    assert.equal(savedFile.download_job_id, validJob.id)
    assert.equal(savedFile.file_size, 2048576)

    // Verify ORM association
    const jobWithFiles = await DownloadJob.findByPk(validJob.id, {
      include: [
        { model: DownloadFile, as: 'file' },
        { model: MediaItem, as: 'media' }
      ]
    })
    assert.ok(jobWithFiles.file, '2.3: Associated DownloadFile loaded via "file" alias')
    assert.equal(jobWithFiles.file.file_size, 2048576)
    assert.ok(jobWithFiles.media, '2.4: Associated MediaItem loaded via "media" alias')

    console.log('✓ Section 2: Database transaction rollback and ORM associations verified.\n')

    // ------------------------------------------------------------------------
    // 3. SQLITE_BUSY Detection & Write Lock
    // ------------------------------------------------------------------------
    console.log('--- 3. Testing SQLITE_BUSY Detection & Serialized Write Lock ---')

    // isSqliteBusyError detection
    const busyError1 = new Error('SQLITE_BUSY: database is locked')
    busyError1.name = 'SequelizeDatabaseError'
    busyError1.original = { code: 'SQLITE_BUSY' }
    assert.equal(isSqliteBusyError(busyError1), true, '3.1: Detects SQLITE_BUSY code')

    const busyError2 = new Error('database is locked')
    assert.equal(isSqliteBusyError(busyError2), true, '3.2: Detects database is locked message')

    const normalError = new Error('Connection refused')
    assert.equal(isSqliteBusyError(normalError), false, '3.3: Normal error is not busy error')

    // withCompletionWriteLock serialization
    const executionOrder = []
    const p1 = withCompletionWriteLock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      executionOrder.push(1)
      return 'res1'
    })

    const p2 = withCompletionWriteLock(async () => {
      executionOrder.push(2)
      return 'res2'
    })

    const [r1, r2] = await Promise.all([p1, p2])
    assert.equal(r1, 'res1')
    assert.equal(r2, 'res2')
    assert.deepEqual(executionOrder, [1, 2], '3.4: Tasks are serialized strictly in FIFO order')

    console.log('✓ Section 3: SQLITE_BUSY detection and FIFO serialized lock verified.\n')

    console.log('================================================================')
    console.log(' ALL LIFECYCLE & DATABASE TESTS PASSED SUCCESSFULLY (100% PASS) ')
    console.log('================================================================\n')
  } finally {
    await testDb.cleanup()
  }
}

runDownloadLifecycleTests().catch((err) => {
  console.error('\n❌ DOWNLOAD LIFECYCLE & DATABASE TEST SUITE FAILED:', err)
  process.exit(1)
})
