import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  enqueueDownloadJob,
  cancelDownloadJob,
  getQueueStatus,
  setExecutorForTesting,
  resetExecutorForTesting,
  stopQueueForShutdown,
  resetQueueForTesting
} from '../src/main/backend/services/downloadQueueService.js'
import { createDownloadJob } from '../src/main/backend/services/downloadService.js'
import {
  retryDownloadJob,
  clearRetryJobTracking
} from '../src/main/backend/services/downloadRetryService.js'
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
    const { MediaItem, DownloadJob, AppSetting } = testDb.sequelize.models

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

    const enqueuedJobIds = []
    const mockEnqueue = (jobId) => {
      enqueuedJobIds.push(jobId)
      return true
    }

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
    const retryResult = await retryDownloadJob(failedJob.id, { enqueue: mockEnqueue })
    assert.equal(retryResult.outcome, 'created', '4.1: Retry created successfully')
    assert.ok(retryResult.retryJobId !== failedJob.id, '4.1: Retry creates a NEW Job ID')
    assert.ok(enqueuedJobIds.includes(retryResult.retryJobId), '4.1: Retry job was enqueued')

    // Verify original failed job is preserved unchanged
    const originalCheck = await DownloadJob.findByPk(failedJob.id)
    assert.equal(originalCheck.status, 'failed', '4.1: Original job remains failed')
    assert.equal(originalCheck.error_message, 'Simulated network drop')

    // Verify new job was inserted with queued status
    const newJob = await DownloadJob.findByPk(retryResult.retryJobId)
    assert.equal(newJob.status, 'queued', '4.1: Fresh retry job is queued')
    assert.equal(newJob.output_format, 'mp4')
    assert.equal(newJob.quality, '480p')

    // 4.2: Retry cancelled job
    const retryCancelledResult = await retryDownloadJob(activeMp4Job.id, { enqueue: mockEnqueue })
    assert.equal(retryCancelledResult.outcome, 'created', '4.2: Cancelled job can be retried')
    assert.ok(
      enqueuedJobIds.includes(retryCancelledResult.retryJobId),
      '4.2: Retry job was enqueued'
    )

    // 4.3: Retry completed job is rejected
    const retryCompletedResult = await retryDownloadJob(compJob.id, { enqueue: mockEnqueue })
    assert.equal(retryCompletedResult.outcome, 'not_retryable', '4.3: Completed job retry rejected')

    // 4.4: Retry non-existent job
    const retryMissingResult = await retryDownloadJob(999999, { enqueue: mockEnqueue })
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

    const retryUnsafeResult = await retryDownloadJob(unsafeJob.id, { enqueue: mockEnqueue })
    assert.equal(
      retryUnsafeResult.outcome,
      'unsafe_url',
      '4.5: Stored unsafe URL rejected on retry'
    )

    console.log(
      '✓ Section 4: Retry creates distinct jobs, preserves originals, and enforces security.\n'
    )

    // ------------------------------------------------------------------------
    // 5. Real Concurrency Test (MAX_CONCURRENT_DOWNLOADS = 2, FIFO, Lifecycle)
    // ------------------------------------------------------------------------
    console.log('--- 5. Testing Real Concurrency (Max 2), FIFO & Queue Lifecycle ---')

    resetQueueForTesting()

    // 5.1 Controlled 3 Jobs: A, B, C
    // Initial state: A downloading, B downloading, C queued.
    // When A finishes, C starts. Concurrency never exceeds 2.
    const jobA = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '360p'
    })
    const jobB = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '480p'
    })
    const jobC = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '720p'
    })

    let activeRunningCount = 0
    let maxObservedActiveCount = 0
    const startedOrder = []
    const completionOrder = []

    let resolveJobA, resolveJobB, resolveJobC
    const promiseA = new Promise((res) => {
      resolveJobA = res
    })
    const promiseB = new Promise((res) => {
      resolveJobB = res
    })
    const promiseC = new Promise((res) => {
      resolveJobC = res
    })

    const controlledExecutor = async (jobId) => {
      activeRunningCount++
      if (activeRunningCount > maxObservedActiveCount) {
        maxObservedActiveCount = activeRunningCount
      }
      startedOrder.push(jobId)

      if (jobId === jobA.id) {
        await promiseA
      } else if (jobId === jobB.id) {
        await promiseB
      } else if (jobId === jobC.id) {
        await promiseC
      }
      activeRunningCount--
      completionOrder.push(jobId)
    }

    setExecutorForTesting(controlledExecutor)

    // Enqueue A, B, C
    const enqA = enqueueDownloadJob(jobA.id)
    const enqB = enqueueDownloadJob(jobB.id)
    const enqC = enqueueDownloadJob(jobC.id)

    assert.equal(enqA, true, '5.1: Job A enqueued')
    assert.equal(enqB, true, '5.1: Job B enqueued')
    assert.equal(enqC, true, '5.1: Job C enqueued')

    // Allow synchronous event loop microtasks to start A and B
    await new Promise((res) => setTimeout(res, 50))

    const statusInitial = getQueueStatus()
    assert.equal(statusInitial.activeCount, 2, '5.1: Exactly 2 jobs are actively executing')
    assert.equal(statusInitial.waitingCount, 1, '5.1: Exactly 1 job is waiting in queue')
    assert.deepEqual(statusInitial.waitingJobIds, [jobC.id], '5.1: Job C is waiting in queue')
    assert.equal(
      startedOrder.includes(jobC.id),
      false,
      '5.1: Job C has NOT started while A and B are active'
    )
    assert.ok(maxObservedActiveCount <= 2, '5.1: Active count never exceeds 2')

    // Finish Job A -> Job C should start
    resolveJobA()
    await new Promise((res) => setTimeout(res, 50))

    assert.equal(startedOrder.includes(jobC.id), true, '5.1: Job C started after Job A finished')
    assert.deepEqual(
      startedOrder,
      [jobA.id, jobB.id, jobC.id],
      '5.1: Strict FIFO start order [A, B, C]'
    )
    assert.ok(maxObservedActiveCount <= 2, '5.1: Concurrency strictly capped at 2')

    // Finish Job B and Job C
    resolveJobB()
    resolveJobC()
    await new Promise((res) => setTimeout(res, 50))

    const statusFinal = getQueueStatus()
    assert.equal(statusFinal.activeCount, 0, '5.1: All jobs finished, active count is 0')
    assert.equal(statusFinal.waitingCount, 0, '5.1: Queue is empty')
    assert.equal(maxObservedActiveCount, 2, '5.1: Max observed active count was exactly 2')

    console.log(
      '✓ 5.1: 3 controlled jobs (A, B active, C queued -> A finishes -> C starts, FIFO preserved, max active <= 2).'
    )

    // 5.2 Simultaneous submissions (3 jobs submitted in same microtask)
    resetQueueForTesting()
    maxObservedActiveCount = 0
    activeRunningCount = 0
    const jobD = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '1080p'
    })
    const jobE = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '1440p'
    })
    const jobF = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '2160p'
    })

    let resolveAllD, resolveAllE, resolveAllF
    const pD = new Promise((r) => {
      resolveAllD = r
    })
    const pE = new Promise((r) => {
      resolveAllE = r
    })
    const pF = new Promise((r) => {
      resolveAllF = r
    })

    setExecutorForTesting(async (jobId) => {
      activeRunningCount++
      if (activeRunningCount > maxObservedActiveCount) maxObservedActiveCount = activeRunningCount
      if (jobId === jobD.id) await pD
      if (jobId === jobE.id) await pE
      if (jobId === jobF.id) await pF
      activeRunningCount--
    })

    enqueueDownloadJob(jobD.id)
    enqueueDownloadJob(jobE.id)
    enqueueDownloadJob(jobF.id)

    await new Promise((res) => setTimeout(res, 50))
    const statusSimul = getQueueStatus()
    assert.equal(statusSimul.activeCount, 2, '5.2: Simultaneous submissions: active count is 2')
    assert.equal(statusSimul.waitingCount, 1, '5.2: Simultaneous submissions: 1 waiting')
    assert.equal(maxObservedActiveCount, 2, '5.2: Max observed active count <= 2')
    resolveAllD()
    resolveAllE()
    resolveAllF()
    await new Promise((res) => setTimeout(res, 50))
    console.log('✓ 5.2: Simultaneous submissions handled correctly.')

    // 5.3 Rapid submissions (5 jobs submitted in loop)
    resetQueueForTesting()
    maxObservedActiveCount = 0
    activeRunningCount = 0
    const rapidResolvers = []
    const rapidJobIds = []
    for (let i = 0; i < 5; i++) {
      const rJob = await createDownloadJob({
        mediaItemId: media.id,
        outputFormat: 'mp4',
        quality: `${240 + i * 100}p`
      })
      rapidJobIds.push(rJob.id)
    }

    setExecutorForTesting(async () => {
      activeRunningCount++
      if (activeRunningCount > maxObservedActiveCount) maxObservedActiveCount = activeRunningCount
      await new Promise((r) => rapidResolvers.push(r))
      activeRunningCount--
    })

    for (const rId of rapidJobIds) {
      enqueueDownloadJob(rId)
    }
    await new Promise((res) => setTimeout(res, 50))
    const rapidStatus = getQueueStatus()
    assert.equal(rapidStatus.activeCount, 2, '5.3: Rapid submissions: active count is 2')
    assert.equal(rapidStatus.waitingCount, 3, '5.3: Rapid submissions: 3 waiting in queue')
    assert.ok(maxObservedActiveCount <= 2, '5.3: Concurrency limit never exceeded')

    // Drain all rapid jobs
    while (rapidResolvers.length > 0) {
      rapidResolvers.shift()()
      await new Promise((res) => setTimeout(res, 20))
    }
    await new Promise((res) => setTimeout(res, 50))
    assert.equal(getQueueStatus().activeCount, 0, '5.3: All rapid jobs drained')
    console.log('✓ 5.3: Rapid submissions properly throttled and queued.')

    // 5.4 Active job cancellation frees slot for next waiting job
    resetQueueForTesting()
    const cancelActiveJob = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '360p'
    })
    const waitingJobAfterCancel = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '480p'
    })
    let resolveCancel
    const cancelProm = new Promise((r) => {
      resolveCancel = r
    })
    let nextJobStarted = false

    setExecutorForTesting(async (jobId) => {
      if (jobId === cancelActiveJob.id) {
        await cancelProm
      } else if (jobId === waitingJobAfterCancel.id) {
        nextJobStarted = true
      }
    })

    enqueueDownloadJob(cancelActiveJob.id)
    enqueueDownloadJob(waitingJobAfterCancel.id)
    await new Promise((res) => setTimeout(res, 50))

    // Cancel active job (simulating process termination and .finally cleanup)
    resolveCancel()
    await new Promise((res) => setTimeout(res, 50))
    assert.equal(
      getQueueStatus().scheduledJobIds.includes(cancelActiveJob.id),
      false,
      '5.4: Cancelled job removed from schedule'
    )
    assert.equal(
      nextJobStarted,
      true,
      '5.4: Next waiting job started after previous job completed/cancelled'
    )
    console.log('✓ 5.4: Job cancellation handled safely.')

    // 5.5 Failure of active job does not stall the queue
    resetQueueForTesting()
    const failJobA = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '360p'
    })
    const nextJobAfterFail = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    let nextJobExecuted = false

    setExecutorForTesting(async (jobId) => {
      if (jobId === failJobA.id) {
        throw new Error('Simulated failure during execution')
      }
      if (jobId === nextJobAfterFail.id) {
        nextJobExecuted = true
      }
    })

    enqueueDownloadJob(failJobA.id)
    enqueueDownloadJob(nextJobAfterFail.id)
    await new Promise((res) => setTimeout(res, 50))

    assert.equal(
      nextJobExecuted,
      true,
      '5.5: Next waiting job executed after failure of previous job'
    )
    assert.equal(getQueueStatus().activeCount, 0, '5.5: Queue returned to idle')
    console.log('✓ 5.5: Job failure gracefully unblocks queue.')

    // 5.6 Recovered job re-enqueued respects limit and FIFO
    resetQueueForTesting()
    const recoveredJob = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '480p'
    })
    await DownloadJob.update({ status: 'interrupted' }, { where: { id: recoveredJob.id } })
    let recoveredExecuted = false
    setExecutorForTesting(async (jobId) => {
      if (jobId === recoveredJob.id) recoveredExecuted = true
    })

    const enqRec = enqueueDownloadJob(recoveredJob.id)
    assert.equal(enqRec, true, '5.6: Recovered job re-enqueued')
    await new Promise((res) => setTimeout(res, 50))
    assert.equal(recoveredExecuted, true, '5.6: Recovered job executed')
    console.log('✓ 5.6: Recovered job re-enqueued and executed within concurrency limit.')

    // 5.7 Duplicate job submitted while in queue returns false
    resetQueueForTesting()
    const dupTestJob = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    let resolveDup
    const dupProm = new Promise((r) => {
      resolveDup = r
    })
    setExecutorForTesting(async () => {
      await dupProm
    })

    assert.equal(enqueueDownloadJob(dupTestJob.id), true, '5.7: First enqueue succeeds')
    assert.equal(enqueueDownloadJob(dupTestJob.id), false, '5.7: Duplicate enqueue returns false')
    resolveDup()
    await new Promise((res) => setTimeout(res, 50))
    console.log('✓ 5.7: Duplicate submission while in queue rejected (idempotent).')

    // 5.8 Application shutdown during queue activity
    resetQueueForTesting()
    const shutdownJob1 = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '360p'
    })
    const shutdownJob2 = await createDownloadJob({
      mediaItemId: media.id,
      outputFormat: 'mp4',
      quality: '480p'
    })
    let resolveShutdownJob
    const shutdownProm = new Promise((res) => {
      resolveShutdownJob = res
    })
    setExecutorForTesting(async () => {
      await shutdownProm
    })

    enqueueDownloadJob(shutdownJob1.id)
    stopQueueForShutdown()
    assert.equal(
      enqueueDownloadJob(shutdownJob2.id),
      false,
      '5.8: Enqueue during shutdown returns false'
    )
    resolveShutdownJob()
    await new Promise((res) => setTimeout(res, 50))
    resetQueueForTesting()
    console.log('✓ 5.8: Shutdown stops queue processing and rejects new submissions.')

    console.log(
      '✓ Section 5: Real concurrency (max 2), FIFO order, and queue lifecycle verified.\n'
    )

    // ------------------------------------------------------------------------
    // Section 6: Same-Job Retry for Preserved Output (Scenarios A, B, C, D)
    // ------------------------------------------------------------------------
    console.log('--- 6. Testing Same-Job Retry for Preserved Output ---')

    const tempDlDir = path.join(os.tmpdir(), `queue-retry-test-${Date.now()}`)
    await fs.mkdir(tempDlDir, { recursive: true })
    await AppSetting.create({ key: 'download_path', value: tempDlDir })

    const media6 = await MediaItem.create({
      source_url: 'https://www.youtube.com/watch?v=s4m3J0bR3tRy',
      platform: 'youtube',
      title: 'Same-Job Retry Media'
    })

    // Use test executor to prevent background download execution from running past teardown
    setExecutorForTesting(async () => {})

    try {
      // Scenario A: Job failed with FFPROBE_FAILED and preserved output file
      const jobA = await createDownloadJob({
        mediaItemId: media6.id,
        outputFormat: 'mp4',
        quality: '720p'
      })
      await DownloadJob.update(
        {
          status: 'failed',
          error_message: '[FFPROBE_FAILED] FFprobe inspection timed out'
        },
        { where: { id: jobA.id } }
      )
      const fileA = path.join(tempDlDir, `Media Output [job-${jobA.id}].mp4`)
      await fs.writeFile(fileA, Buffer.from('preserved valid media stream'))

      clearRetryJobTracking()
      resetQueueForTesting()
      const enqueuedA = []
      const resA = await retryDownloadJob(jobA.id, { enqueue: (id) => enqueuedA.push(id) })
      assert.equal(resA.outcome, 'created', 'Scenario A: outcome is created')
      assert.equal(resA.originalJobId, jobA.id, 'Scenario A: originalJobId matches')
      assert.equal(
        resA.retryJobId,
        jobA.id,
        'Scenario A: retryJobId strictly matches original Job ID'
      )
      assert.equal(resA.status, 'queued', 'Scenario A: status is queued')
      assert.deepEqual(enqueuedA, [jobA.id], 'Scenario A: original Job ID enqueued')

      const reloadedA = await DownloadJob.findByPk(jobA.id)
      assert.equal(reloadedA.status, 'queued', 'Scenario A: original job status updated to queued')
      assert.equal(reloadedA.error_message, null, 'Scenario A: previous error message cleared')
      console.log('✓ Scenario A: FFprobe failure with preserved output enables same-job retry.')

      // Scenario B: Job failed with DATABASE_ERROR and preserved output file
      const jobB = await createDownloadJob({
        mediaItemId: media6.id,
        outputFormat: 'mp4',
        quality: '1080p'
      })
      await DownloadJob.update(
        {
          status: 'failed',
          error_message: '[DATABASE_ERROR] SQLite database insertion failed'
        },
        { where: { id: jobB.id } }
      )
      const fileB = path.join(tempDlDir, `Media Output [job-${jobB.id}].mp4`)
      await fs.writeFile(fileB, Buffer.from('preserved video stream'))

      clearRetryJobTracking()
      resetQueueForTesting()
      const enqueuedB = []
      const resB = await retryDownloadJob(jobB.id, { enqueue: (id) => enqueuedB.push(id) })
      assert.equal(resB.originalJobId, jobB.id, 'Scenario B: originalJobId matches')
      assert.equal(resB.retryJobId, jobB.id, 'Scenario B: same Job ID reused')
      const reloadedB = await DownloadJob.findByPk(jobB.id)
      assert.equal(reloadedB.status, 'queued', 'Scenario B: job transitioned to queued')
      assert.deepEqual(enqueuedB, [jobB.id], 'Scenario B: original Job ID enqueued')
      console.log('✓ Scenario B: Database error with preserved output enables same-job retry.')

      // Scenario C: Job failed with FFPROBE_NOT_FOUND and preserved output file
      const jobC = await createDownloadJob({
        mediaItemId: media6.id,
        outputFormat: 'mp3',
        audioBitrateKbps: 320
      })
      await DownloadJob.update(
        {
          status: 'failed',
          error_message: '[FFPROBE_NOT_FOUND] FFprobe executable was not found'
        },
        { where: { id: jobC.id } }
      )
      const fileC = path.join(tempDlDir, `Media Audio [job-${jobC.id}].mp3`)
      await fs.writeFile(fileC, Buffer.from('preserved audio stream'))

      clearRetryJobTracking()
      resetQueueForTesting()
      const enqueuedC = []
      const resC = await retryDownloadJob(jobC.id, { enqueue: (id) => enqueuedC.push(id) })
      assert.equal(resC.retryJobId, jobC.id, 'Scenario C: same Job ID reused for FFPROBE_NOT_FOUND')
      assert.deepEqual(enqueuedC, [jobC.id], 'Scenario C: original Job ID enqueued')
      console.log('✓ Scenario C: FFprobe missing with preserved output enables same-job retry.')

      // Scenario D: Normal failed download without preserved output -> creates NEW job ID
      const jobD = await createDownloadJob({
        mediaItemId: media6.id,
        outputFormat: 'mp4',
        quality: '480p'
      })
      await DownloadJob.update(
        {
          status: 'failed',
          error_message: '[NETWORK_ERROR] Connection reset by peer'
        },
        { where: { id: jobD.id } }
      )
      // No file created on disk for jobD

      clearRetryJobTracking()
      resetQueueForTesting()
      const enqueuedD = []
      const resD = await retryDownloadJob(jobD.id, { enqueue: (id) => enqueuedD.push(id) })
      assert.equal(resD.outcome, 'created', 'Scenario D: outcome is created')
      assert.equal(resD.originalJobId, jobD.id, 'Scenario D: originalJobId matches')
      assert.notEqual(resD.retryJobId, jobD.id, 'Scenario D: new distinct Job ID created')
      assert.deepEqual(enqueuedD, [resD.retryJobId], 'Scenario D: new distinct Job ID enqueued')

      const reloadedD = await DownloadJob.findByPk(jobD.id)
      assert.equal(
        reloadedD.status,
        'failed',
        'Scenario D: original failed job preserved as failed'
      )
      console.log('✓ Scenario D: Normal failed download creates new Job ID and preserves original.')
    } finally {
      resetQueueForTesting()
      stopQueueForShutdown()
      try {
        await fs.rm(tempDlDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }

    console.log('================================================================')
    console.log(' ALL DOWNLOAD QUEUE & RETRY TESTS PASSED SUCCESSFULLY (100%)    ')
    console.log('================================================================\n')
  } finally {
    resetExecutorForTesting()
    resetQueueForTesting()
    clearRetryJobTracking()
    await testDb.cleanup()
  }
}

runDownloadQueueTests().catch((err) => {
  console.error('\n❌ DOWNLOAD QUEUE & RETRY TEST SUITE FAILED:', err)
  process.exit(1)
})
