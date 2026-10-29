import assert from 'node:assert/strict'
import fsSync from 'node:fs'
import { createE2eEnvironment, YOUTUBE_SYNTHETIC_FIXTURE } from './helpers/e2eTestEnvironment.js'
import { getDatabase } from '../src/main/backend/config/database.js'
import { recoverInterruptedDownloadJobs } from '../src/main/backend/services/downloadRecoveryService.js'
import {
  assertHealthResponse,
  assertMediaAnalyzeResponse,
  assertDownloadCreateResponse,
  assertDownloadHistoryResponse,
  assertJobDetailsResponse,
  assertCancelResponse,
  assertRetryResponse,
  assertSettingsGetResponse,
  assertSettingsPatchResponse,
  assertHistoryDeleteResponse,
  assertUnauthorizedResponse,
  assertForbiddenResponse,
  assertValidationErrorResponse,
  assertNotFoundResponse,
  assertConflictResponse
} from './helpers/apiResponseContracts.js'

/**
 * ============================================================================
 * APPLAN2 — Step 04.45 Link Downloader Backend E2E Test Suite
 *
 * BACKEND E2E WITH MOCKED MEDIA TOOLS
 *
 * Verifies the full integrated backend link download workflow:
 * HTTP Request -> Local API Auth -> URL Security -> Media Analyzer ->
 * SQLite MediaItem -> POST /api/downloads -> SQLite DownloadJob ->
 * Download Queue -> Worker -> Progress Calculation -> File Verification ->
 * FFprobe Inspection -> SQLite DownloadFile -> Completed Download History.
 *
 * Covers Test Scenarios:
 * - Group A: Integrated MP4 Download
 * - Group B: Integrated MP3 Download
 * - Group C: Queue Concurrency (Max 2) & FIFO Scheduling
 * - Group D: Download Cancellation Lifecycle
 * - Group E: Download Retry Lifecycle
 * - Group F: Active Duplicate Request Handling
 * - Group G: Local API & URL Security Guards
 * - Group H: Error Handling & Controlled Failures
 * - Group I: SQLite Concurrent Completion & Write Locks
 * - Group J: Download Settings & History Querying
 * - Group K: Application Restart Recovery
 * - Group L: API Response Contracts
 * ============================================================================
 */

console.log('======================================================================')
console.log(' APPLAN2 — Step 04.45: Link Downloader Backend E2E Test Suite         ')
console.log(' Mode: BACKEND E2E WITH MOCKED MEDIA TOOLS (100% Isolated Environment)')
console.log('======================================================================\n')

async function runAllE2eTests() {
  const env = await createE2eEnvironment()
  console.log(`[setup] Isolated E2E workspace: ${env.tempWorkspace}`)
  console.log(`[setup] Download directory: ${env.downloadFolder}`)
  console.log(`[setup] Ephemeral test server port: ${env.port}\n`)

  const { MediaItem, DownloadJob, DownloadFile } = getDatabase().models

  try {
    // ========================================================================
    // GROUP A — MP4 DOWNLOAD WORKFLOW
    // ========================================================================
    console.log('--- GROUP A: Integrated MP4 Download Workflow ---')

    // 1. Analyze media URL
    const analyzeRes = await env.request({
      path: '/api/media/analyze',
      method: 'POST',
      body: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }
    })
    assertMediaAnalyzeResponse(analyzeRes.status, analyzeRes.body)
    const mediaItemId = analyzeRes.body.data.mediaItemId
    assert.equal(analyzeRes.body.data.platform, 'youtube')
    assert.ok(analyzeRes.body.data.videoQualities.includes('720p'))

    // 2. Verify MediaItem record in SQLite
    const mediaRecord = await MediaItem.findByPk(mediaItemId)
    assert.ok(mediaRecord !== null, 'MediaItem must be persisted in SQLite')
    assert.equal(mediaRecord.title, YOUTUBE_SYNTHETIC_FIXTURE.title)

    // 3. Create MP4 DownloadJob
    const createJobRes = await env.request({
      path: '/api/downloads',
      method: 'POST',
      body: {
        mediaItemId,
        outputFormat: 'mp4',
        quality: '720p'
      }
    })
    assertDownloadCreateResponse(createJobRes.status, createJobRes.body)
    const jobId = createJobRes.body.data.id
    assert.equal(createJobRes.body.data.status, 'queued')

    // 4. Wait for job to process through queue, run yt-dlp, verify ffprobe, and complete
    const completedJob = await env.waitForJobState(
      jobId,
      (j) => j.status === 'completed' && j.progress === 100
    )
    assert.equal(completedJob.status, 'completed', 'Job must reach completed status')
    assert.equal(completedJob.progress, 100, 'Job progress must reach 100%')

    // 5. Verify DownloadFile record in SQLite
    const fileRecord = await DownloadFile.findOne({ where: { download_job_id: jobId } })
    assert.ok(fileRecord !== null, 'DownloadFile record must exist in SQLite')
    assert.ok(fsSync.existsSync(fileRecord.file_path), 'Physical media file must exist on disk')
    assert.ok(Number(fileRecord.file_size) > 0, 'Physical media file must have non-zero size')

    // 6. Verify GET /api/downloads/:id
    const detailsRes = await env.request({ path: `/api/downloads/${jobId}` })
    assertJobDetailsResponse(detailsRes.status, detailsRes.body)
    assert.equal(detailsRes.body.data.job.status, 'completed')
    assert.equal(detailsRes.body.data.file_status, 'available')

    // 7. Verify GET /api/downloads history listing
    const historyRes = await env.request({ path: '/api/downloads' })
    assertDownloadHistoryResponse(historyRes.status, historyRes.body)
    const historyItem = historyRes.body.data.find((j) => j.id === jobId)
    assert.ok(historyItem !== undefined, 'Completed job must appear in download history')
    assert.equal(historyItem.file_status, 'available')

    console.log('✓ Group A: Full MP4 download E2E workflow passed.\n')

    // ========================================================================
    // GROUP B — MP3 DOWNLOAD WORKFLOW
    // ========================================================================
    console.log('--- GROUP B: Integrated MP3 Download Workflow ---')

    // Create MP3 DownloadJob (192 kbps)
    const createMp3Res = await env.request({
      path: '/api/downloads',
      method: 'POST',
      body: {
        mediaItemId,
        outputFormat: 'mp3',
        audioBitrateKbps: 192
      }
    })
    assertDownloadCreateResponse(createMp3Res.status, createMp3Res.body)
    const mp3JobId = createMp3Res.body.data.id

    // Wait for MP3 job completion
    const completedMp3Job = await env.waitForJobState(
      mp3JobId,
      (j) => j.status === 'completed' && j.progress === 100
    )
    assert.equal(completedMp3Job.output_format, 'mp3')
    assert.equal(completedMp3Job.audio_bitrate_kbps, 192)

    // Verify MP3 DownloadFile record
    const mp3FileRecord = await DownloadFile.findOne({ where: { download_job_id: mp3JobId } })
    assert.ok(mp3FileRecord !== null, 'MP3 DownloadFile record must exist')
    assert.ok(mp3FileRecord.file_path.endsWith('.mp3'), 'File path must end with .mp3')
    assert.ok(fsSync.existsSync(mp3FileRecord.file_path), 'MP3 file must exist on disk')

    console.log('✓ Group B: Full MP3 download E2E workflow passed.\n')

    // ========================================================================
    // GROUP C — QUEUE CONCURRENCY (MAX 2) & FIFO SCHEDULING
    // ========================================================================
    console.log('--- GROUP C: Queue Concurrency & FIFO Scheduling ---')

    // Configure hold on jobs 101 and 102
    // We will create 3 new jobs: J1, J2, J3
    // J1 and J2 will start and hold; J3 will remain queued
    const j1Res = await env.request({
      path: '/api/downloads',
      method: 'POST',
      body: { mediaItemId, outputFormat: 'mp4', quality: '480p' }
    })
    const j1Id = j1Res.body.data.id

    // Hold J1 and future J2
    env.setFailureRules({ holdJobs: [j1Id] })

    // Wait until J1 enters downloading
    await env.waitForJobState(j1Id, (j) => j.status === 'downloading')

    const j2Res = await env.request({
      path: '/api/downloads',
      method: 'POST',
      body: { mediaItemId, outputFormat: 'mp4', quality: '360p' }
    })
    const j2Id = j2Res.body.data.id
    env.setFailureRules({ holdJobs: [j1Id, j2Id] })

    // Wait until J2 enters downloading
    await env.waitForJobState(j2Id, (j) => j.status === 'downloading')

    // Create J3 (must remain queued because max concurrency is 2)
    const j3Res = await env.request({
      path: '/api/downloads',
      method: 'POST',
      body: { mediaItemId, outputFormat: 'mp3', audioBitrateKbps: 320 }
    })
    const j3Id = j3Res.body.data.id

    // Verify instantaneous status: J1=downloading, J2=downloading, J3=queued
    const checkJ1 = await DownloadJob.findByPk(j1Id)
    const checkJ2 = await DownloadJob.findByPk(j2Id)
    const checkJ3 = await DownloadJob.findByPk(j3Id)

    assert.equal(checkJ1.status, 'downloading', 'Job 1 must be downloading')
    assert.equal(checkJ2.status, 'downloading', 'Job 2 must be downloading')
    assert.equal(checkJ3.status, 'queued', 'Job 3 must be queued due to 2 concurrency limit')

    // Release J1
    const p1 = env.getActiveMockProcess(j1Id)
    assert.ok(p1 && typeof p1.releaseExecution === 'function', 'Mock process 1 must be holdable')
    p1.releaseExecution()

    // J1 should complete, freeing a slot, and J3 should start downloading (FIFO)
    await env.waitForJobState(j1Id, (j) => j.status === 'completed')
    await env.waitForJobState(j3Id, (j) => j.status === 'downloading' || j.status === 'completed')

    // Release J2
    const p2 = env.getActiveMockProcess(j2Id)
    if (p2 && typeof p2.releaseExecution === 'function') {
      p2.releaseExecution()
    }

    await env.waitForJobState(j2Id, (j) => j.status === 'completed')
    await env.waitForJobState(j3Id, (j) => j.status === 'completed')

    // Clear failure rules
    env.setFailureRules({})

    console.log('✓ Group C: Queue concurrency (2 max) and FIFO scheduling passed.\n')

    // ========================================================================
    // GROUP D — DOWNLOAD CANCELLATION LIFECYCLE
    // ========================================================================
    console.log('--- GROUP D: Download Cancellation Lifecycle ---')

    // 1. Cancel a queued job
    // Create a held job to block the queue, then create a queued job and cancel it
    const blockJobRes = await env.request({
      path: '/api/downloads',
      method: 'POST',
      body: { mediaItemId, outputFormat: 'mp3', audioBitrateKbps: 128 }
    })
    const blockId = blockJobRes.body.data.id
    env.setFailureRules({ holdJobs: [blockId] })
    await env.waitForJobState(blockId, (j) => j.status === 'downloading')

    // Fill second slot
    const block2Res = await env.request({
      path: '/api/downloads',
      method: 'POST',
      body: { mediaItemId, outputFormat: 'mp4', quality: '1080p' }
    })
    const block2Id = block2Res.body.data.id
    env.setFailureRules({ holdJobs: [blockId, block2Id] })
    await env.waitForJobState(block2Id, (j) => j.status === 'downloading')

    // Now create a 3rd job which will be 'queued'
    const toCancelRes = await env.request({
      path: '/api/downloads',
      method: 'POST',
      body: { mediaItemId, outputFormat: 'mp4', quality: '480p' }
    })
    const toCancelId = toCancelRes.body.data.id
    const queuedJob = await DownloadJob.findByPk(toCancelId)
    assert.equal(queuedJob.status, 'queued')

    // Cancel queued job via API
    const cancelQueuedRes = await env.request({
      path: `/api/downloads/${toCancelId}/cancel`,
      method: 'POST'
    })
    assertCancelResponse(cancelQueuedRes.status, cancelQueuedRes.body)
    const cancelledJobRec = await DownloadJob.findByPk(toCancelId)
    assert.equal(cancelledJobRec.status, 'cancelled', 'Queued job must become cancelled')

    // 2. Cancel a running job
    const cancelRunningRes = await env.request({
      path: `/api/downloads/${block2Id}/cancel`,
      method: 'POST'
    })
    assertCancelResponse(cancelRunningRes.status, cancelRunningRes.body)
    const cancelledRunningRec = await env.waitForJobState(block2Id, (j) => j.status === 'cancelled')
    assert.equal(cancelledRunningRec.status, 'cancelled', 'Running job must become cancelled')

    // 3. Cancelling an already cancelled job returns 200 idempotent already_cancelled
    const cancelAgainRes = await env.request({
      path: `/api/downloads/${toCancelId}/cancel`,
      method: 'POST'
    })
    assertCancelResponse(cancelAgainRes.status, cancelAgainRes.body)
    assert.equal(cancelAgainRes.body.data.status, 'cancelled')

    // 4. Cancelling a completed job returns 409 conflict
    const cancelCompletedRes = await env.request({
      path: `/api/downloads/${jobId}/cancel`,
      method: 'POST'
    })
    assertConflictResponse(cancelCompletedRes.status, cancelCompletedRes.body)

    // Release remaining block job
    const pBlock = env.getActiveMockProcess(blockId)
    if (pBlock && typeof pBlock.releaseExecution === 'function') {
      pBlock.releaseExecution()
    }
    await env.waitForJobState(blockId, (j) => j.status === 'completed')
    env.setFailureRules({})

    console.log('✓ Group D: Cancellation lifecycle passed.\n')

    // ========================================================================
    // GROUP E — DOWNLOAD RETRY LIFECYCLE
    // ========================================================================
    console.log('--- GROUP E: Download Retry Lifecycle ---')

    // Retry the cancelled job (toCancelId)
    const retryRes = await env.request({
      path: `/api/downloads/${toCancelId}/retry`,
      method: 'POST'
    })
    assertRetryResponse(retryRes.status, retryRes.body)
    const newRetryJobId = retryRes.body.data.retryJobId
    assert.notEqual(newRetryJobId, toCancelId, 'Retry must create a fresh Job ID')

    // Wait for the retried job to complete
    const completedRetryJob = await env.waitForJobState(
      newRetryJobId,
      (j) => j.status === 'completed'
    )
    assert.equal(completedRetryJob.status, 'completed')

    // Original cancelled job must remain preserved in SQLite
    const originalCancelledRec = await DownloadJob.findByPk(toCancelId)
    assert.equal(
      originalCancelledRec.status,
      'cancelled',
      'Original cancelled job must remain preserved'
    )

    // Attempting to retry a completed job must fail
    const retryCompletedRes = await env.request({
      path: `/api/downloads/${jobId}/retry`,
      method: 'POST'
    })
    assertConflictResponse(retryCompletedRes.status, retryCompletedRes.body)

    console.log('✓ Group E: Retry lifecycle passed.\n')

    // ========================================================================
    // GROUP F — DUPLICATE DOWNLOADS
    // ========================================================================
    console.log('--- GROUP F: Active Duplicate Request Handling ---')

    // Start a long-running hold job
    const dupBaseRes = await env.request({
      path: '/api/downloads',
      method: 'POST',
      body: { mediaItemId, outputFormat: 'mp4', quality: '1080p' }
    })
    const dupBaseId = dupBaseRes.body.data.id
    env.setFailureRules({ holdJobs: [dupBaseId] })
    await env.waitForJobState(dupBaseId, (j) => j.status === 'downloading')

    // Request identical download while active
    const dupReqRes = await env.request({
      path: '/api/downloads',
      method: 'POST',
      body: { mediaItemId, outputFormat: 'mp4', quality: '1080p' }
    })
    assert.equal(dupReqRes.status, 200, 'Duplicate active request must return HTTP 200')
    assert.equal(dupReqRes.body.duplicate, true, 'duplicate flag must be true')
    assert.equal(dupReqRes.body.data.id, dupBaseId, 'must reference the existing active job ID')

    // Request different quality (e.g. 720p) -> must be independent and create new job
    const diffQualityRes = await env.request({
      path: '/api/downloads',
      method: 'POST',
      body: { mediaItemId, outputFormat: 'mp4', quality: '720p' }
    })
    assert.equal(diffQualityRes.status, 201, 'Different quality must return HTTP 201 Created')
    assert.notEqual(diffQualityRes.body.data.id, dupBaseId)

    // Release held dup job
    const pDup = env.getActiveMockProcess(dupBaseId)
    if (pDup && typeof pDup.releaseExecution === 'function') {
      pDup.releaseExecution()
    }
    await env.waitForJobState(dupBaseId, (j) => j.status === 'completed')
    await env.waitForJobState(diffQualityRes.body.data.id, (j) => j.status === 'completed')
    env.setFailureRules({})

    console.log('✓ Group F: Duplicate detection and independent formats passed.\n')

    // ========================================================================
    // GROUP G — SECURITY GUARDS (AUTH, HOST, CORS, URL SECURITY)
    // ========================================================================
    console.log('--- GROUP G: Security Guards ---')

    // 1. Missing Authorization header
    const noAuthRes = await env.request({
      path: '/api/downloads',
      method: 'GET',
      headers: { authorization: '' }
    })
    assertUnauthorizedResponse(noAuthRes.status, noAuthRes.body)

    // 2. Invalid Bearer token
    const badTokenRes = await env.request({
      path: '/api/downloads',
      method: 'GET',
      headers: { authorization: 'Bearer completely_bogus_token_123456789' }
    })
    assertUnauthorizedResponse(badTokenRes.status, badTokenRes.body)

    // 3. Invalid Host header
    const badHostRes = await env.request({
      path: '/api/health',
      method: 'GET',
      headers: { host: 'attacker.evil-domain.com' }
    })
    assertForbiddenResponse(badHostRes.status, badHostRes.body)

    // 4. Disallowed Origin
    const badOriginRes = await env.request({
      path: '/api/health',
      method: 'GET',
      headers: { origin: 'http://malicious-website.org' }
    })
    assertForbiddenResponse(badOriginRes.status, badOriginRes.body)

    // 5. Unsupported media URL
    const unsupportedUrlRes = await env.request({
      path: '/api/media/analyze',
      method: 'POST',
      body: { url: 'https://vimeo.com/12345678' }
    })
    assertValidationErrorResponse(unsupportedUrlRes.status, unsupportedUrlRes.body)

    // 6. Unsafe SSRF / loopback URL
    const unsafeUrlRes = await env.request({
      path: '/api/media/analyze',
      method: 'POST',
      body: { url: 'http://169.254.169.254/latest/meta-data/' }
    })
    assertValidationErrorResponse(unsafeUrlRes.status, unsafeUrlRes.body)

    console.log('✓ Group G: Security middleware and URL guards passed.\n')

    // ========================================================================
    // GROUP H — ERROR HANDLING & CONTROLLED FAILURES
    // ========================================================================
    console.log('--- GROUP H: Error Handling & Controlled Failures ---')

    // 1. Simulated yt-dlp execution failure
    // Create a job and configure yt-dlp to exit with code 1
    const failJobRes = await env.request({
      path: '/api/downloads',
      method: 'POST',
      body: { mediaItemId, outputFormat: 'mp4', quality: '360p' }
    })
    const failJobId = failJobRes.body.data.id
    env.setFailureRules({ ytDlpFailJobs: [failJobId] })

    const failedJobRec = await env.waitForJobState(failJobId, (j) => j.status === 'failed')
    assert.equal(failedJobRec.status, 'failed', 'Job must fail when yt-dlp process fails')
    assert.ok(failedJobRec.error_message.length > 0, 'Error message must be recorded')

    // Verify no DownloadFile was created for the failed job
    const noFileRec = await DownloadFile.findOne({ where: { download_job_id: failJobId } })
    assert.equal(noFileRec, null, 'Failed job must NOT have a DownloadFile record')

    // 2. Simulated missing output file failure
    const missingJobRes = await env.request({
      path: '/api/downloads',
      method: 'POST',
      body: { mediaItemId, outputFormat: 'mp4', quality: '480p' }
    })
    const missingJobId = missingJobRes.body.data.id
    env.setFailureRules({ missingOutputFileJobs: [missingJobId] })

    const missingFailedJob = await env.waitForJobState(missingJobId, (j) => j.status === 'failed')
    assert.equal(missingFailedJob.status, 'failed')
    assert.ok(
      missingFailedJob.error_message.includes('Downloaded file does not exist') ||
        missingFailedJob.error_message.includes('Could not verify downloaded file')
    )

    // Reset failure rules
    env.setFailureRules({})

    console.log('✓ Group H: Error handling and safe failure states passed.\n')

    // ========================================================================
    // GROUP I — SQLITE CONCURRENT COMPLETION & WRITE LOCKS
    // ========================================================================
    console.log('--- GROUP I: SQLite Concurrent Completion ---')

    // Create two jobs that will finish in parallel
    const c1Res = await env.request({
      path: '/api/downloads',
      method: 'POST',
      body: { mediaItemId, outputFormat: 'mp4', quality: '720p' }
    })
    const c2Res = await env.request({
      path: '/api/downloads',
      method: 'POST',
      body: { mediaItemId, outputFormat: 'mp3', audioBitrateKbps: 192 }
    })

    const [comp1, comp2] = await Promise.all([
      env.waitForJobState(c1Res.body.data.id, (j) => j.status === 'completed'),
      env.waitForJobState(c2Res.body.data.id, (j) => j.status === 'completed')
    ])

    assert.equal(comp1.status, 'completed')
    assert.equal(comp2.status, 'completed')
    assert.equal(comp1.progress, 100)
    assert.equal(comp2.progress, 100)

    console.log('✓ Group I: Concurrent SQLite job completions verified.\n')

    // ========================================================================
    // GROUP J — DOWNLOAD SETTINGS & HISTORY QUERYING
    // ========================================================================
    console.log('--- GROUP J: Download Settings & History ---')

    // 1. GET Settings
    const getSettingsRes = await env.request({ path: '/api/settings/downloads' })
    assertSettingsGetResponse(getSettingsRes.status, getSettingsRes.body)
    assert.equal(getSettingsRes.body.data.downloadPath, env.downloadFolder)

    // 2. PATCH Settings
    const patchSettingsRes = await env.request({
      path: '/api/settings/downloads',
      method: 'PATCH',
      body: {
        defaultFormat: 'mp3',
        preferredMp3BitrateKbps: 320
      }
    })
    assertSettingsPatchResponse(patchSettingsRes.status, patchSettingsRes.body)
    assert.equal(patchSettingsRes.body.data.defaultFormat, 'mp3')
    assert.equal(patchSettingsRes.body.data.preferredMp3BitrateKbps, 320)

    // 3. History listing and filtering
    const allHistoryRes = await env.request({ path: '/api/downloads' })
    assertDownloadHistoryResponse(allHistoryRes.status, allHistoryRes.body)
    assert.ok(allHistoryRes.body.data.length >= 5)

    const completedOnlyRes = await env.request({ path: '/api/downloads?status=completed' })
    assert.ok(completedOnlyRes.body.data.every((j) => j.status === 'completed'))

    // 4. History record deletion without touching physical file
    const fileToPreserve = (await DownloadFile.findOne({ where: { download_job_id: jobId } }))
      .file_path
    assert.ok(fsSync.existsSync(fileToPreserve), 'File must exist before history deletion')

    const deleteHistoryRes = await env.request({
      path: `/api/downloads/${jobId}`,
      method: 'DELETE'
    })
    assertHistoryDeleteResponse(deleteHistoryRes.status, deleteHistoryRes.body)

    // DownloadJob record deleted
    const deletedJobCheck = await DownloadJob.findByPk(jobId)
    assert.equal(deletedJobCheck, null, 'Job record removed from SQLite')

    // PHYSICAL FILE MUST REMAIN 100% PRESERVED
    assert.ok(
      fsSync.existsSync(fileToPreserve),
      'Physical file on disk preserved after history delete'
    )

    console.log('✓ Group J: Settings and history operations verified.\n')

    // ========================================================================
    // GROUP K — RESTART RECOVERY
    // ========================================================================
    console.log('--- GROUP K: Application Restart Recovery ---')

    // Inject interrupted synthetic jobs: one 'downloading' and one 'queued'
    const interruptedJob1 = await DownloadJob.create({
      media_id: mediaItemId,
      source_type: 'link',
      output_format: 'mp4',
      quality: '1080p',
      status: 'downloading',
      progress: 60,
      downloaded_bytes: 5242880
    })

    const interruptedJob2 = await DownloadJob.create({
      media_id: mediaItemId,
      source_type: 'link',
      output_format: 'mp3',
      audio_bitrate_kbps: 128,
      status: 'queued',
      progress: 0,
      downloaded_bytes: 0
    })

    // Execute real restart recovery
    const recoveryResult = await recoverInterruptedDownloadJobs()
    const totalRecovered =
      recoveryResult.interruptedDownloads + recoveryResult.interruptedQueuedJobs
    assert.equal(totalRecovered, 2, 'Must recover exactly 2 interrupted jobs')
    assert.equal(recoveryResult.interruptedDownloads, 1, '1 downloading job recovered')
    assert.equal(recoveryResult.interruptedQueuedJobs, 1, '1 queued job recovered')

    const rec1 = await DownloadJob.findByPk(interruptedJob1.id)
    const rec2 = await DownloadJob.findByPk(interruptedJob2.id)
    assert.equal(rec1.status, 'failed', 'Interrupted downloading job recovered to failed')
    assert.equal(rec2.status, 'failed', 'Interrupted queued job recovered to failed')
    assert.ok(rec1.error_message.includes('interrupted'))

    // Idempotent recovery
    const secondRecovery = await recoverInterruptedDownloadJobs()
    const secondTotal = secondRecovery.interruptedDownloads + secondRecovery.interruptedQueuedJobs
    assert.equal(secondTotal, 0, 'Second recovery run is idempotent (0 recovered)')

    console.log('✓ Group K: Restart recovery verified.\n')

    // ========================================================================
    // GROUP L — API RESPONSE CONTRACTS CONFIRMATION
    // ========================================================================
    console.log('--- GROUP L: API Response Contracts Confirmation ---')

    const healthRes = await env.request({ path: '/api/health' })
    assertHealthResponse(healthRes.status, healthRes.body)

    const notFoundRes = await env.request({ path: '/api/non_existent_route_404' })
    assertNotFoundResponse(notFoundRes.status, notFoundRes.body)

    console.log('✓ Group L: Comprehensive API response contracts confirmed.\n')

    console.log('======================================================================')
    console.log(' ALL STEP 04.45 BACKEND E2E TEST SCENARIOS PASSED (100% PASS)         ')
    console.log('======================================================================\n')
  } finally {
    await env.cleanup()
    console.log('[teardown] Test environment, HTTP server, and SQLite database cleaned safely.\n')
  }
}

runAllE2eTests().catch((err) => {
  console.error('\n❌ STEP 04.45 BACKEND E2E TESTS FAILED:', err)
  process.exit(1)
})
