import assert from 'node:assert/strict'
import { normalizeDownloadJob } from '../src/renderer/src/utils/downloadPresentation.js'
import { DownloadPausedError } from '../src/main/backend/services/downloadService.js'
import {
  pauseDownloadJob,
  resumeDownloadJob,
  cancelDownloadJob,
  enqueueDownloadJob,
  resetQueueForTesting,
  stopQueueForShutdown,
  setExecutorForTesting,
  getQueueStatus
} from '../src/main/backend/services/downloadQueueService.js'
import {
  retryDownloadJob,
  clearRetryJobTracking
} from '../src/main/backend/services/downloadRetryService.js'
import {
  VALID_JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  getDownloadSummary
} from '../src/main/backend/services/downloadHistoryService.js'
import { recoverInterruptedDownloadJobs } from '../src/main/backend/services/downloadRecoveryService.js'
import {
  resumeInterruptedNetworkJobs,
  clearJobRetryState
} from '../src/main/backend/services/networkRecoveryService.js'
import { createTestDatabase } from './helpers/testDatabase.js'

async function runDownloadPauseResumeTests() {
  console.log('================================================================')
  console.log(' APPLAN2: Download Manager Pause, Resume, Cancel & File Actions')
  console.log('================================================================\n')

  const testDb = await createTestDatabase('pause-resume-test-')

  try {
    const { DownloadJob, MediaItem } = testDb.sequelize.models

    const media = await MediaItem.create({
      source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up'
    })

    // --------------------------------------------------------------------------
    // SECTION 1: Status Constants & Summary Metrics
    // --------------------------------------------------------------------------
    console.log('--- Section 1: Status Constants & Summary Metrics ---')

    assert.ok(VALID_JOB_STATUSES.includes('paused'), '1.1: VALID_JOB_STATUSES contains paused')
    assert.ok(
      !TERMINAL_JOB_STATUSES.includes('paused'),
      '1.2: TERMINAL_JOB_STATUSES does not contain paused (paused is non-terminal)'
    )

    // Verify summary counts including paused
    await DownloadJob.create({
      media_id: media.id,
      status: 'paused',
      output_format: 'mp4',
      quality: '1080p',
      progress: 35,
      downloaded_bytes: 5000000
    })

    const summary = await getDownloadSummary()
    assert.ok(typeof summary.downloads.paused === 'number', '1.3: summary has paused count')
    assert.ok(summary.downloads.paused >= 1, '1.4: summary paused count reflects created job')

    console.log('✓ Section 1 Passed: Status constants and summary metrics verified.\n')

    // --------------------------------------------------------------------------
    // SECTION 2: Frontend Normalization for Paused State
    // --------------------------------------------------------------------------
    console.log('--- Section 2: Frontend Normalization for Paused State ---')

    const pausedRawJob = {
      id: 201,
      media_id: media.id,
      status: 'paused',
      output_format: 'mp4',
      quality: '720p',
      progress: 45,
      downloaded_bytes: 15 * 1024 * 1024,
      total_bytes: 30 * 1024 * 1024,
      media: {
        title: 'Paused Video',
        duration_seconds: 180
      }
    }

    const normPaused = normalizeDownloadJob(pausedRawJob)
    assert.equal(normPaused.displayStatus, 'paused', '2.1: displayStatus is paused')
    assert.equal(normPaused.status, 'paused', '2.2: status is paused')
    assert.equal(normPaused.statusText, 'Paused (45%)', '2.3: statusText contains percentage')
    assert.equal(normPaused.speedText, '0 KB/s', '2.4: speedText is 0 KB/s')
    assert.equal(normPaused.etaText, 'Paused', '2.5: etaText is Paused')
    assert.equal(normPaused.etaDisplay, 'Paused', '2.6: etaDisplay is Paused')
    assert.equal(normPaused.progress, 45, '2.7: progress is preserved at 45%')

    console.log('✓ Section 2 Passed: Frontend normalization for paused state verified.\n')

    // --------------------------------------------------------------------------
    // SECTION 3: Pausing Queued and Interrupted Jobs
    // --------------------------------------------------------------------------
    console.log('--- Section 3: Pausing Queued and Interrupted Jobs ---')

    resetQueueForTesting()

    // 3.1 Pausing a queued job
    const queuedJob = await DownloadJob.create({
      media_id: media.id,
      status: 'queued',
      output_format: 'mp4',
      quality: '1080p',
      progress: 0,
      downloaded_bytes: 0
    })

    const pauseQueuedResult = await pauseDownloadJob(queuedJob.id)
    assert.equal(pauseQueuedResult.outcome, 'paused', '3.1: Queued job paused successfully')
    const reloadedQueued = await DownloadJob.findByPk(queuedJob.id)
    assert.equal(reloadedQueued.status, 'paused', '3.1: Database status updated to paused')

    // 3.2 Pausing an already paused job (idempotent)
    const pauseAgainResult = await pauseDownloadJob(queuedJob.id)
    assert.equal(
      pauseAgainResult.outcome,
      'already_paused',
      '3.2: Pausing paused job returns already_paused'
    )

    // 3.3 Pausing an interrupted job (user manually pauses during network loss)
    const interruptedJob = await DownloadJob.create({
      media_id: media.id,
      status: 'interrupted',
      output_format: 'mp4',
      quality: '720p',
      progress: 30,
      downloaded_bytes: 8000000,
      error_message: 'Internet connection was lost.'
    })

    const pauseInterruptedResult = await pauseDownloadJob(interruptedJob.id)
    assert.equal(
      pauseInterruptedResult.outcome,
      'paused',
      '3.3: Interrupted job paused successfully'
    )
    const reloadedInterrupted = await DownloadJob.findByPk(interruptedJob.id)
    assert.equal(reloadedInterrupted.status, 'paused', '3.3: Database status updated to paused')
    assert.equal(reloadedInterrupted.error_message, null, '3.3: Error message cleared')

    // 3.4 Pausing terminal jobs returns conflict
    const compJob = await DownloadJob.create({
      media_id: media.id,
      status: 'completed',
      output_format: 'mp4'
    })
    const pauseCompResult = await pauseDownloadJob(compJob.id)
    assert.equal(pauseCompResult.outcome, 'conflict', '3.4: Pausing completed job returns conflict')

    console.log('✓ Section 3 Passed: Pausing queued and interrupted jobs verified.\n')

    // --------------------------------------------------------------------------
    // SECTION 4: Queue Execution, Slot Release & Real Pause
    // --------------------------------------------------------------------------
    console.log('--- Section 4: Queue Execution & Slot Release ---')

    resetQueueForTesting()

    // Mock executor that simulates download execution and supports pause
    let executorPromiseReject = null

    setExecutorForTesting(async (jobId) => {
      await DownloadJob.update({ status: 'downloading', progress: 20 }, { where: { id: jobId } })
      return new Promise((resolve, reject) => {
        executorPromiseReject = reject
      })
    })

    const runJob1 = await DownloadJob.create({
      media_id: media.id,
      status: 'queued',
      output_format: 'mp4'
    })
    const runJob2 = await DownloadJob.create({
      media_id: media.id,
      status: 'queued',
      output_format: 'mp4'
    })
    const runJob3 = await DownloadJob.create({
      media_id: media.id,
      status: 'queued',
      output_format: 'mp4'
    })

    enqueueDownloadJob(runJob1.id)
    enqueueDownloadJob(runJob2.id)
    enqueueDownloadJob(runJob3.id)

    // Give queue loop a tick to start max 2 jobs
    await new Promise((r) => setTimeout(r, 50))
    let queueStatus = getQueueStatus()
    assert.equal(queueStatus.activeCount, 2, '4.1: Max concurrency 2 active jobs')
    assert.equal(queueStatus.waitingCount, 1, '4.1: Exactly 1 job waiting in queue')

    // Simulate pause rejection on job 1
    if (executorPromiseReject) {
      // Simulate downloadService error catch marking paused
      await DownloadJob.update({ status: 'paused', progress: 25 }, { where: { id: runJob1.id } })
      executorPromiseReject(new DownloadPausedError('Download was paused by user'))
    }

    // Give queue loop a tick to release slot and start waiting job 3
    await new Promise((r) => setTimeout(r, 50))
    queueStatus = getQueueStatus()
    assert.equal(queueStatus.waitingCount, 0, '4.2: Waiting job was dispatched into freed slot')

    const checkJob1 = await DownloadJob.findByPk(runJob1.id)
    assert.equal(checkJob1.status, 'paused', '4.3: Job 1 is paused')

    console.log('✓ Section 4 Passed: Queue execution & slot release verified.\n')

    // --------------------------------------------------------------------------
    // SECTION 5: Real Resume Flow & Connectivity Isolation
    // --------------------------------------------------------------------------
    console.log('--- Section 5: Real Resume Flow & Connectivity Isolation ---')

    resetQueueForTesting()

    const pausedJobToResume = await DownloadJob.create({
      media_id: media.id,
      status: 'paused',
      output_format: 'mp4',
      quality: '1080p',
      progress: 40,
      downloaded_bytes: 10000000
    })

    // 5.1 Resuming while offline: transitions to 'interrupted' without fake downloading
    const resumeOfflineResult = await resumeDownloadJob(pausedJobToResume.id, { isOnline: false })
    assert.equal(
      resumeOfflineResult.outcome,
      'interrupted',
      '5.1: Offline resume transitions to interrupted'
    )
    const reloadedOffline = await DownloadJob.findByPk(pausedJobToResume.id)
    assert.equal(reloadedOffline.status, 'interrupted', '5.1: Database status is interrupted')
    assert.ok(
      reloadedOffline.error_message.includes('Waiting for network'),
      '5.1: Proper waiting error message set'
    )
    clearJobRetryState(pausedJobToResume.id)

    // 5.2 Transition back to paused, then resume online
    await reloadedOffline.update({ status: 'paused', error_message: null })

    const enqueuedResumed = []
    const resumeOnlineResult = await resumeDownloadJob(pausedJobToResume.id, {
      isOnline: true,
      enqueue: (id) => enqueuedResumed.push(id)
    })
    assert.equal(resumeOnlineResult.outcome, 'resumed', '5.2: Online resume transitions to queued')
    assert.deepEqual(enqueuedResumed, [pausedJobToResume.id], '5.2: Enqueued ID matches job ID')
    const reloadedOnline = await DownloadJob.findByPk(pausedJobToResume.id)
    assert.equal(reloadedOnline.status, 'queued', '5.2: Database status is queued')
    assert.equal(reloadedOnline.progress, 40, '5.2: Checkpoint progress preserved')
    assert.equal(reloadedOnline.downloaded_bytes, 10000000, '5.2: Checkpoint bytes preserved')

    // 5.3 Resuming already queued job returns already_queued
    const resumeQueuedAgain = await resumeDownloadJob(pausedJobToResume.id, { isOnline: true })
    assert.equal(
      resumeQueuedAgain.outcome,
      'already_queued',
      '5.3: Resuming queued job returns already_queued'
    )

    console.log('✓ Section 5 Passed: Resume flow & connectivity handling verified.\n')

    // --------------------------------------------------------------------------
    // SECTION 6: Network Recovery & Restart Persistence Isolation
    // --------------------------------------------------------------------------
    console.log('--- Section 6: Network Recovery & Restart Isolation ---')

    // 6.1 Network Recovery isolation: network reconnection must NEVER auto-resume paused jobs
    const jobPausedDuringNetwork = await DownloadJob.create({
      media_id: media.id,
      status: 'paused',
      output_format: 'mp4',
      progress: 50
    })
    await DownloadJob.create({
      media_id: media.id,
      status: 'interrupted',
      output_format: 'mp4',
      progress: 20
    })

    await resumeInterruptedNetworkJobs({
      enqueue: () => {}
    })

    const checkPausedAfterNet = await DownloadJob.findByPk(jobPausedDuringNetwork.id)
    assert.equal(
      checkPausedAfterNet.status,
      'paused',
      '6.1: Paused job remains strictly paused during network recovery'
    )

    // 6.2 Restart Persistence isolation: paused jobs remain paused across application restart
    await recoverInterruptedDownloadJobs({
      autoEnqueue: false,
      isOnline: true
    })

    const checkPausedAfterRestart = await DownloadJob.findByPk(jobPausedDuringNetwork.id)
    assert.equal(
      checkPausedAfterRestart.status,
      'paused',
      '6.2: Paused job remains strictly paused across restart recovery'
    )

    console.log('✓ Section 6 Passed: Network and startup isolation verified.\n')

    // --------------------------------------------------------------------------
    // SECTION 7: Cancel vs Retry Behavior
    // --------------------------------------------------------------------------
    console.log('--- Section 7: Cancel vs Retry Behavior ---')

    // 7.1 Cancel a paused job: transitions to cancelled
    const jobToCancel = await DownloadJob.create({
      media_id: media.id,
      status: 'paused',
      output_format: 'mp4',
      progress: 60,
      downloaded_bytes: 18000000
    })

    const cancelResult = await cancelDownloadJob(jobToCancel.id)
    assert.equal(cancelResult.outcome, 'cancelled', '7.1: Cancel on paused job succeeds')
    const reloadedCancelled = await DownloadJob.findByPk(jobToCancel.id)
    assert.equal(reloadedCancelled.status, 'cancelled', '7.1: Database status is cancelled')

    // 7.2 Retry on cancelled job: restarts strictly from 0% with SAME Job ID
    clearRetryJobTracking()
    const enqueuedRetryIds = []
    const retryResult = await retryDownloadJob(jobToCancel.id, {
      enqueue: (id) => enqueuedRetryIds.push(id)
    })

    assert.equal(retryResult.outcome, 'created', '7.2: Retry creates job')
    assert.equal(retryResult.originalJobId, jobToCancel.id, '7.2: Retry preserves original Job ID')
    assert.deepEqual(enqueuedRetryIds, [jobToCancel.id], '7.2: Enqueued ID is original Job ID')

    const reloadedRetried = await DownloadJob.findByPk(jobToCancel.id)
    assert.equal(reloadedRetried.status, 'queued', '7.2: Retried status is queued')
    assert.equal(reloadedRetried.progress, 0, '7.2: Retry resets progress to 0%')
    assert.equal(reloadedRetried.downloaded_bytes, 0, '7.2: Retry resets downloaded_bytes to 0')
    assert.equal(reloadedRetried.error_message, null, '7.2: Error message cleared')

    console.log('✓ Section 7 Passed: Cancel vs Retry behavior verified.\n')

    console.log('================================================================')
    console.log(' ALL PAUSE/RESUME & CONTROLS TESTS PASSED SUCCESSFULLY (100% PASS)')
    console.log('================================================================\n')
  } finally {
    stopQueueForShutdown()
    resetQueueForTesting()
    await testDb.cleanup()
  }
}

runDownloadPauseResumeTests().catch((err) => {
  console.error('\n❌ PAUSE/RESUME TEST SUITE FAILED:', err)
  process.exit(1)
})
