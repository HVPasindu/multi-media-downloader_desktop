import assert from 'node:assert/strict'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createApiApp } from '../src/main/backend/app.js'
import {
  initSessionToken,
  resetSessionTokenForTest,
  LOCAL_API_PORT
} from '../src/main/backend/services/localApiSecurityService.js'
import {
  findActiveDuplicateDownload,
  getCanonicalMediaKey,
  buildDownloadRequestIdentity,
  withDownloadCreationGuard
} from '../src/main/backend/services/downloadDuplicateService.js'
import {
  getQueueStatus,
  resetQueueForTesting,
  stopQueueForShutdown
} from '../src/main/backend/services/downloadQueueService.js'
import { createTestDatabase } from './helpers/testDatabase.js'
import { MockChildProcess, YOUTUBE_SYNTHETIC_FIXTURE } from './helpers/e2eTestEnvironment.js'
import { DuplicateGuardCoordinator } from '../src/renderer/src/hooks/useDownloadDuplicateGuard.js'

/**
 * Helper to make HTTP requests against the ephemeral test server.
 */
function testRequest(server, token, { path: reqPath, method = 'POST', body = null }) {
  return new Promise((resolve, reject) => {
    const port = server.address().port
    const payload = body ? JSON.stringify(body) : null

    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: reqPath,
        method,
        headers: {
          host: `127.0.0.1:${LOCAL_API_PORT}`,
          origin: 'http://localhost:5173',
          authorization: `Bearer ${token}`,
          ...(payload
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload)
              }
            : {})
        }
      },
      (res) => {
        let rawData = ''
        res.on('data', (chunk) => {
          rawData += chunk
        })
        res.on('end', () => {
          let parsed = null
          try {
            parsed = JSON.parse(rawData)
          } catch {
            parsed = rawData
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed })
        })
      }
    )

    req.on('error', reject)
    if (payload) {
      req.write(payload)
    }
    req.end()
  })
}

/**
 * ============================================================================
 * Multi Media Downloader — Duplicate Download Guard Test Suite
 *
 * Covers:
 * A. Same canonical media + same MP4 quality + queued → duplicate.
 * B. Same canonical media + same MP4 quality + downloading → duplicate.
 * C. Same canonical media + same MP4 quality + interrupted → duplicate.
 * D. Same media + different MP4 quality → not duplicate.
 * E. Same media + MP4 versus MP3 → not duplicate.
 * F. Same media + same MP3 bitrate → duplicate.
 * G. Same media + different MP3 bitrate → not duplicate.
 * H. Different media URL → not duplicate.
 * I. Completed, failed and cancelled jobs → not duplicate.
 * J. Equivalent YouTube URLs → correctly identified as the same media.
 * K. Duplicate check API must not create database records or queue jobs.
 * L. Repeated simultaneous POST requests must not create multiple jobs.
 * M. After an existing job becomes completed/failed/cancelled, the same selection becomes available.
 * N. Frontend Best Quality selection must match the actual backend quality identity.
 * ============================================================================
 */
async function runDuplicateDownloadGuardTests() {
  console.log('================================================================')
  console.log(' Multi Media Downloader — Duplicate Download Guard Test Suite   ')
  console.log('================================================================\n')

  const testDb = await createTestDatabase('applan2-duplicate-test-')
  console.log(`[setup] Isolated test database ready: ${testDb.databasePath}`)

  const token = initSessionToken()
  const app = createApiApp()
  const server = http.createServer(app)

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const ephemeralPort = server.address().port
  console.log(`[setup] Ephemeral test server listening on port ${ephemeralPort}\n`)

  try {
    const { MediaItem, DownloadJob } = testDb.sequelize.models

    // Seed MediaItems
    const media1 = await MediaItem.create({
      source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      platform: 'youtube',
      title: 'Rick Astley - Never Gonna Give You Up'
    })

    const media2 = await MediaItem.create({
      source_url: 'https://youtu.be/dQw4w9WgXcQ',
      platform: 'youtube',
      title: 'Rick Astley - Short URL'
    })

    const media3 = await MediaItem.create({
      source_url: 'https://www.youtube.com/watch?v=9bZkp7q19f0',
      platform: 'youtube',
      title: 'PSY - GANGNAM STYLE'
    })

    // ------------------------------------------------------------------------
    // TEST A: Queued MP4 Job → Duplicate
    // ------------------------------------------------------------------------
    console.log('--- TEST A: Same canonical media + same MP4 quality + queued → duplicate ---')
    const jobA = await DownloadJob.create({
      media_id: media1.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'queued'
    })

    const dupA = await findActiveDuplicateDownload({
      sourceUrl: media1.source_url,
      mediaItemId: media1.id,
      outputFormat: 'mp4',
      quality: '1080p'
    })
    assert.ok(dupA, 'TEST A: findActiveDuplicateDownload finds queued duplicate')
    assert.equal(dupA.id, jobA.id, 'TEST A: Returns matching job ID')

    const resA = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp4', quality: '1080p' }
    })
    assert.equal(resA.status, 200, 'TEST A: API returns 200')
    assert.equal(resA.body.duplicate, true, 'TEST A: API reports duplicate === true')
    assert.equal(resA.body.data.id, jobA.id, 'TEST A: API returns job ID')
    assert.equal(resA.body.data.status, 'queued', 'TEST A: API returns status queued')
    console.log('✓ TEST A passed: Queued job detected as duplicate by service and API\n')

    // Clean up jobA
    await jobA.destroy()

    // ------------------------------------------------------------------------
    // TEST B: Downloading MP4 Job → Duplicate
    // ------------------------------------------------------------------------
    console.log('--- TEST B: Same canonical media + same MP4 quality + downloading → duplicate ---')
    const jobB = await DownloadJob.create({
      media_id: media1.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'downloading',
      progress: 45
    })

    const dupB = await findActiveDuplicateDownload({
      sourceUrl: media1.source_url,
      mediaItemId: media1.id,
      outputFormat: 'mp4',
      quality: '1080p'
    })
    assert.ok(dupB, 'TEST B: findActiveDuplicateDownload finds downloading duplicate')
    assert.equal(dupB.id, jobB.id, 'TEST B: Returns matching job ID')

    const resB = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp4', quality: '1080p' }
    })
    assert.equal(resB.status, 200, 'TEST B: API returns 200')
    assert.equal(resB.body.duplicate, true, 'TEST B: API reports duplicate === true')
    assert.equal(resB.body.data.status, 'downloading', 'TEST B: API returns status downloading')
    console.log('✓ TEST B passed: Downloading job detected as duplicate by service and API\n')

    await jobB.destroy()

    // ------------------------------------------------------------------------
    // TEST C: Interrupted MP4 Job → Duplicate (Part 03 Fix)
    // ------------------------------------------------------------------------
    console.log('--- TEST C: Same canonical media + same MP4 quality + interrupted → duplicate ---')
    const jobC = await DownloadJob.create({
      media_id: media1.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'interrupted',
      progress: 30,
      downloaded_bytes: 5242880,
      error_message: 'Internet connection is unavailable. Waiting for network connection...'
    })

    const dupC = await findActiveDuplicateDownload({
      sourceUrl: media1.source_url,
      mediaItemId: media1.id,
      outputFormat: 'mp4',
      quality: '1080p'
    })
    assert.ok(dupC, 'TEST C: findActiveDuplicateDownload finds interrupted duplicate')
    assert.equal(dupC.id, jobC.id, 'TEST C: Returns matching job ID')

    const resC = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp4', quality: '1080p' }
    })
    assert.equal(resC.status, 200, 'TEST C: API returns 200')
    assert.equal(resC.body.duplicate, true, 'TEST C: API reports duplicate === true')
    assert.equal(resC.body.data.status, 'interrupted', 'TEST C: API returns status interrupted')
    console.log('✓ TEST C passed: Interrupted job detected as duplicate by service and API\n')

    // ------------------------------------------------------------------------
    // TEST D: Different MP4 Quality → Not Duplicate
    // ------------------------------------------------------------------------
    console.log('--- TEST D: Same media + different MP4 quality → not duplicate ---')
    // jobC is 1080p interrupted; check for 720p
    const dupD = await findActiveDuplicateDownload({
      sourceUrl: media1.source_url,
      mediaItemId: media1.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    assert.equal(dupD, null, 'TEST D: 720p is not a duplicate of active 1080p')

    const resD = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp4', quality: '720p' }
    })
    assert.equal(resD.status, 200, 'TEST D: API returns 200')
    assert.equal(resD.body.duplicate, false, 'TEST D: API reports duplicate === false')
    assert.equal(resD.body.data, null, 'TEST D: data is null')
    console.log('✓ TEST D passed: Different MP4 resolution allowed independently\n')

    // ------------------------------------------------------------------------
    // TEST E: Same media + MP4 versus MP3 → Not Duplicate
    // ------------------------------------------------------------------------
    console.log('--- TEST E: Same media + MP4 versus MP3 → not duplicate ---')
    const dupE = await findActiveDuplicateDownload({
      sourceUrl: media1.source_url,
      mediaItemId: media1.id,
      outputFormat: 'mp3',
      audioBitrateKbps: 192
    })
    assert.equal(dupE, null, 'TEST E: MP3 192kbps is not duplicate of MP4 1080p')

    const resE = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp3', audioBitrateKbps: 192 }
    })
    assert.equal(resE.status, 200, 'TEST E: API returns 200')
    assert.equal(resE.body.duplicate, false, 'TEST E: MP3 allowed independently of active MP4')
    console.log('✓ TEST E passed: MP3 format allowed independently of active MP4\n')

    // Clean up jobC
    await jobC.destroy()

    // ------------------------------------------------------------------------
    // TEST F: Same media + same MP3 bitrate → Duplicate
    // ------------------------------------------------------------------------
    console.log('--- TEST F: Same media + same MP3 bitrate → duplicate ---')
    const jobF = await DownloadJob.create({
      media_id: media1.id,
      output_format: 'mp3',
      audio_bitrate_kbps: 192,
      status: 'downloading',
      progress: 60
    })

    const dupF = await findActiveDuplicateDownload({
      sourceUrl: media1.source_url,
      mediaItemId: media1.id,
      outputFormat: 'mp3',
      audioBitrateKbps: 192
    })
    assert.ok(dupF, 'TEST F: Duplicate MP3 192kbps detected')
    assert.equal(dupF.id, jobF.id, 'TEST F: Matches jobF')

    const resF = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp3', audioBitrateKbps: 192 }
    })
    assert.equal(resF.body.duplicate, true, 'TEST F: API reports duplicate === true')
    assert.equal(resF.body.data.id, jobF.id, 'TEST F: Correct job ID returned')
    console.log('✓ TEST F passed: Identical MP3 bitrate detected as duplicate\n')

    // ------------------------------------------------------------------------
    // TEST G: Same media + different MP3 bitrate → Not Duplicate
    // ------------------------------------------------------------------------
    console.log('--- TEST G: Same media + different MP3 bitrate → not duplicate ---')
    const dupG = await findActiveDuplicateDownload({
      sourceUrl: media1.source_url,
      mediaItemId: media1.id,
      outputFormat: 'mp3',
      audioBitrateKbps: 320
    })
    assert.equal(dupG, null, 'TEST G: MP3 320kbps is not duplicate of MP3 192kbps')

    const resG = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp3', audioBitrateKbps: 320 }
    })
    assert.equal(resG.body.duplicate, false, 'TEST G: Different bitrate allowed')
    console.log('✓ TEST G passed: Different MP3 bitrate allowed independently\n')

    await jobF.destroy()

    // ------------------------------------------------------------------------
    // TEST H: Different media URL → Not Duplicate
    // ------------------------------------------------------------------------
    console.log('--- TEST H: Different media URL → not duplicate ---')
    const jobH = await DownloadJob.create({
      media_id: media1.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'downloading'
    })

    const dupH = await findActiveDuplicateDownload({
      sourceUrl: media3.source_url,
      mediaItemId: media3.id,
      outputFormat: 'mp4',
      quality: '1080p'
    })
    assert.equal(dupH, null, 'TEST H: Different media URL is not duplicate')

    const resH = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media3.id, outputFormat: 'mp4', quality: '1080p' }
    })
    assert.equal(resH.body.duplicate, false, 'TEST H: Different media URL allowed')
    console.log('✓ TEST H passed: Distinct media link allows independent download\n')

    await jobH.destroy()

    // ------------------------------------------------------------------------
    // TEST I: Terminal statuses ('completed', 'failed', 'cancelled') → Not Duplicate
    // ------------------------------------------------------------------------
    console.log('--- TEST I: Completed, failed and cancelled jobs → not duplicate ---')
    for (const termStatus of ['completed', 'failed', 'cancelled']) {
      const termJob = await DownloadJob.create({
        media_id: media1.id,
        output_format: 'mp4',
        quality: '1080p',
        status: termStatus
      })

      const dupI = await findActiveDuplicateDownload({
        sourceUrl: media1.source_url,
        mediaItemId: media1.id,
        outputFormat: 'mp4',
        quality: '1080p'
      })
      assert.equal(dupI, null, `TEST I: ${termStatus} job must NOT block new download`)

      const resI = await testRequest(server, token, {
        path: '/api/downloads/check-duplicate',
        method: 'POST',
        body: { mediaItemId: media1.id, outputFormat: 'mp4', quality: '1080p' }
      })
      assert.equal(
        resI.body.duplicate,
        false,
        `TEST I: API returns duplicate === false for ${termStatus}`
      )
      await termJob.destroy()
    }
    console.log(
      '✓ TEST I passed: Terminal jobs (completed/failed/cancelled) never block downloads\n'
    )

    // ------------------------------------------------------------------------
    // TEST J: Equivalent YouTube URLs → Canonical Media Identification
    // ------------------------------------------------------------------------
    console.log('--- TEST J: Equivalent YouTube URLs identified as same media ---')
    const keyWatch = getCanonicalMediaKey('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    const keyShort = getCanonicalMediaKey('https://youtu.be/dQw4w9WgXcQ')
    const keyShorts = getCanonicalMediaKey('https://www.youtube.com/shorts/dQw4w9WgXcQ')
    const keyEmbed = getCanonicalMediaKey('https://www.youtube.com/embed/dQw4w9WgXcQ')

    assert.equal(keyWatch, 'youtube:dQw4w9WgXcQ', 'Canonical watch key')
    assert.equal(keyShort, 'youtube:dQw4w9WgXcQ', 'Canonical youtu.be key')
    assert.equal(keyShorts, 'youtube:dQw4w9WgXcQ', 'Canonical shorts key')
    assert.equal(keyEmbed, 'youtube:dQw4w9WgXcQ', 'Canonical embed key')

    // Create job for media1 (watch URL)
    const jobJ = await DownloadJob.create({
      media_id: media1.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'downloading'
    })

    // Query using media2 (youtu.be short URL)
    const dupJ = await findActiveDuplicateDownload({
      sourceUrl: media2.source_url,
      mediaItemId: media2.id,
      outputFormat: 'mp4',
      quality: '1080p'
    })
    assert.ok(dupJ, 'TEST J: youtu.be short URL recognized as duplicate of watch URL')
    assert.equal(dupJ.id, jobJ.id, 'TEST J: Matches existing job ID')

    const resJ = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media2.id, outputFormat: 'mp4', quality: '1080p' }
    })
    assert.equal(resJ.body.duplicate, true, 'TEST J: API identifies short URL as duplicate')
    console.log('✓ TEST J passed: Equivalent YouTube URLs correctly resolved to canonical key\n')

    await jobJ.destroy()

    // ------------------------------------------------------------------------
    // TEST K: Read-Only Duplicate Check API Does NOT Create Records or Queue Jobs
    // ------------------------------------------------------------------------
    console.log('--- TEST K: Duplicate check API is strictly read-only ---')
    const jobCountBefore = await DownloadJob.count()
    const mediaCountBefore = await MediaItem.count()
    const queueBefore = getQueueStatus()

    const resK = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp4', quality: '1080p' }
    })
    assert.equal(resK.status, 200, 'TEST K: API returns 200')
    assert.equal(resK.body.duplicate, false, 'TEST K: duplicate === false')

    const jobCountAfter = await DownloadJob.count()
    const mediaCountAfter = await MediaItem.count()
    const queueAfter = getQueueStatus()

    assert.equal(jobCountAfter, jobCountBefore, 'TEST K: No DownloadJob rows created')
    assert.equal(mediaCountAfter, mediaCountBefore, 'TEST K: No MediaItem rows created')
    assert.equal(
      queueAfter.scheduledJobIds.length,
      queueBefore.scheduledJobIds.length,
      'TEST K: No jobs enqueued'
    )
    console.log('✓ TEST K passed: Read-only check API never mutates database or queue\n')

    // ------------------------------------------------------------------------
    // TEST L: Simultaneous In-Flight Creation Guard
    // ------------------------------------------------------------------------
    console.log('--- TEST L: Repeated simultaneous creation guard ---')
    const requestIdentityL = buildDownloadRequestIdentity({
      sourceUrl: media1.source_url,
      outputFormat: 'mp4',
      quality: '1080p'
    })

    let realCreationCount = 0
    const executeSimultaneous = () =>
      withDownloadCreationGuard(requestIdentityL, async () => {
        // Simulate creation delay
        await new Promise((r) => setTimeout(r, 60))
        realCreationCount++
        const job = await DownloadJob.create({
          media_id: media1.id,
          output_format: 'mp4',
          quality: '1080p',
          status: 'queued'
        })
        return { job, duplicate: false }
      })

    // Fire 3 simultaneous requests
    const [resL1, resL2, resL3] = await Promise.all([
      executeSimultaneous(),
      executeSimultaneous(),
      executeSimultaneous()
    ])

    assert.equal(realCreationCount, 1, 'TEST L: Only 1 real creation execution performed')
    assert.equal(resL1.duplicate, false, 'Leader got duplicate: false')
    assert.equal(resL2.duplicate, true, 'Follower 1 got duplicate: true')
    assert.equal(resL3.duplicate, true, 'Follower 2 got duplicate: true')
    assert.equal(resL2.job.id, resL1.job.id, 'Follower received leader job ID')
    assert.equal(resL3.job.id, resL1.job.id, 'Follower received leader job ID')
    console.log('✓ TEST L passed: withDownloadCreationGuard prevents simultaneous creation races\n')

    // Clean up created job
    await resL1.job.destroy()

    // ------------------------------------------------------------------------
    // TEST M: Availability Restored After Job Transitions to Completed/Failed/Cancelled
    // ------------------------------------------------------------------------
    console.log('--- TEST M: Selection becomes available again after terminal transition ---')
    const jobM = await DownloadJob.create({
      media_id: media1.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'downloading'
    })

    // Initially blocked
    const resM1 = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp4', quality: '1080p' }
    })
    assert.equal(resM1.body.duplicate, true, 'Initially blocked')

    // Transition job to 'completed'
    await jobM.update({ status: 'completed' })
    const resM2 = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp4', quality: '1080p' }
    })
    assert.equal(resM2.body.duplicate, false, 'Available again after completion')

    // Transition job to 'failed'
    await jobM.update({ status: 'failed' })
    const resM3 = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp4', quality: '1080p' }
    })
    assert.equal(resM3.body.duplicate, false, 'Available again after failure')

    // Transition job to 'cancelled'
    await jobM.update({ status: 'cancelled' })
    const resM4 = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp4', quality: '1080p' }
    })
    assert.equal(resM4.body.duplicate, false, 'Available again after cancellation')

    console.log('✓ TEST M passed: Same selection unblocked after terminal state reached\n')
    await jobM.destroy()

    // ------------------------------------------------------------------------
    // TEST N: Frontend 'Best' Quality Resolution Matches Backend Quality Identity
    // ------------------------------------------------------------------------
    console.log('--- TEST N: Frontend Best Quality selection resolution ---')
    const mockMp4Qualities = ['1080p', '720p', '480p', '360p']
    const highestQuality = mockMp4Qualities[0] // '1080p'
    const selectedQuality = 'best'

    // Frontend resolution rule:
    let resolvedQuality = selectedQuality
    if (resolvedQuality === 'best' || !mockMp4Qualities.includes(resolvedQuality)) {
      resolvedQuality = highestQuality
    }
    assert.equal(resolvedQuality, '1080p', 'TEST N: "best" resolves to 1080p')

    // Create job with 1080p
    const jobN = await DownloadJob.create({
      media_id: media1.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'queued'
    })

    // Duplicate check must query with the resolved quality '1080p', NOT literal 'best'
    const resN = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp4', quality: resolvedQuality }
    })
    assert.equal(resN.body.duplicate, true, 'TEST N: Resolved quality matches active job')
    assert.equal(resN.body.data.id, jobN.id, 'TEST N: Identifies existing job')
    console.log(
      '✓ TEST N passed: "best" resolves to highest verified quality and matches identity\n'
    )

    await jobN.destroy()

    // ========================================================================
    // PART 02: PRODUCTION FRONTEND COORDINATOR VERIFICATION (SCENARIOS A–J)
    // Directly testing DuplicateGuardCoordinator extracted from useDownloadDuplicateGuard
    // ========================================================================
    console.log('================================================================')
    console.log(' PART 02: FRONTEND COORDINATOR VERIFICATION (SCENARIOS A–J)     ')
    console.log('================================================================\n')

    // --- SCENARIO A: Foreground held check superseded by background request ---
    console.log('--- SCENARIO A: Foreground request superseded by background request ---')
    let resolveForegroundA
    const foregroundPromiseA = new Promise((resolve) => {
      resolveForegroundA = resolve
    })

    let resolveBackgroundA
    const backgroundPromiseA = new Promise((resolve) => {
      resolveBackgroundA = resolve
    })

    let callCountA = 0
    const coordinatorA = new DuplicateGuardCoordinator({
      checkApiFn: async () => {
        callCountA++
        if (callCountA === 1) return await foregroundPromiseA
        return await backgroundPromiseA
      }
    })

    const paramsA = {
      mediaItemId: media1.id,
      selectedFormat: 'mp4',
      selectedVideoQuality: '1080p',
      mp4Qualities: ['1080p', '720p'],
      highestAvailableQuality: '1080p',
      enabled: true
    }

    // 1. Start foreground check
    const fgPromiseA = coordinatorA.executeCheck(paramsA, { isBackground: false })
    assert.equal(
      coordinatorA.getState().isCheckingDuplicate,
      true,
      'A.1: Foreground request activates isCheckingDuplicate'
    )

    // 2. Trigger background check while foreground is in flight
    const bgPromiseA = coordinatorA.executeCheck(paramsA, { isBackground: true })

    // 3. Resolve both requests
    resolveForegroundA({
      ok: true,
      data: { duplicate: true, data: { id: 101, status: 'downloading' } }
    })
    resolveBackgroundA({
      ok: true,
      data: { duplicate: true, data: { id: 101, status: 'downloading' } }
    })
    await Promise.all([fgPromiseA, bgPromiseA])

    // 4. Checking state must be released cleanly (no stuck spinner deadlock)
    assert.equal(
      coordinatorA.getState().isCheckingDuplicate,
      false,
      'A.2: isCheckingDuplicate successfully released when latest background request completes'
    )
    assert.equal(coordinatorA.getState().isDuplicate, true, 'A.3: Duplicate state updated')
    assert.equal(coordinatorA.getState().duplicateJob.id, 101, 'A.4: Correct job ID preserved')
    console.log('✓ SCENARIO A passed: Superseded foreground check releases loading state cleanly\n')

    // --- SCENARIO B: Old request response after media selection invalidation ---
    console.log('--- SCENARIO B: Old request response after media selection invalidation ---')
    let resolveB
    const promiseB = new Promise((resolve) => {
      resolveB = resolve
    })

    const coordinatorB = new DuplicateGuardCoordinator({
      checkApiFn: async () => await promiseB
    })

    const checkB = coordinatorB.executeCheck(
      {
        mediaItemId: media1.id,
        selectedFormat: 'mp4',
        selectedVideoQuality: '1080p',
        mp4Qualities: ['1080p'],
        highestAvailableQuality: '1080p',
        enabled: true
      },
      { isBackground: false }
    )
    assert.equal(coordinatorB.getState().isCheckingDuplicate, true, 'B.1: Checking state active')

    // Invalidate selection before request completes
    await coordinatorB.executeCheck({ mediaItemId: null })

    assert.equal(coordinatorB.getState().isCheckingDuplicate, false, 'B.2: Reset on invalidation')
    assert.equal(coordinatorB.getState().isDuplicate, false, 'B.3: Duplicate reset to false')

    // Resolve old request
    resolveB({ ok: true, data: { duplicate: true, data: { id: 999, status: 'downloading' } } })
    await checkB

    // Verify old response was rejected and could not overwrite state
    assert.equal(
      coordinatorB.getState().isDuplicate,
      false,
      'B.4: Stale response cannot overwrite invalidated state'
    )
    assert.equal(coordinatorB.getState().duplicateJob, null, 'B.5: duplicateJob remains null')
    console.log('✓ SCENARIO B passed: Invalidated request cannot modify state\n')

    // --- SCENARIO C: Rapid MP4 quality switching with reverse response arrival ---
    console.log('--- SCENARIO C: Rapid MP4 quality switching with reverse response arrival ---')
    let resolve1080pC
    const promise1080pC = new Promise((resolve) => {
      resolve1080pC = resolve
    })

    let resolve720pC
    const promise720pC = new Promise((resolve) => {
      resolve720pC = resolve
    })

    const coordinatorC = new DuplicateGuardCoordinator({
      checkApiFn: async (payload) => {
        if (payload.quality === '1080p') return await promise1080pC
        return await promise720pC
      }
    })

    // 1. Check for 1080p
    const call1080pC = coordinatorC.executeCheck(
      {
        mediaItemId: media1.id,
        selectedFormat: 'mp4',
        selectedVideoQuality: '1080p',
        mp4Qualities: ['1080p', '720p'],
        highestAvailableQuality: '1080p',
        enabled: true
      },
      { isBackground: false }
    )

    // 2. Change selection to 720p
    const call720pC = coordinatorC.executeCheck(
      {
        mediaItemId: media1.id,
        selectedFormat: 'mp4',
        selectedVideoQuality: '720p',
        mp4Qualities: ['1080p', '720p'],
        highestAvailableQuality: '1080p',
        enabled: true
      },
      { isBackground: false }
    )

    // Previous duplicate state cleared immediately on selection change
    assert.equal(
      coordinatorC.getState().isDuplicate,
      false,
      'C.1: Previous duplicate state cleared immediately on quality change'
    )

    // 3. Resolve responses in REVERSE order: 720p first, then 1080p
    resolve720pC({ ok: true, data: { duplicate: false, data: null } })
    await call720pC

    assert.equal(coordinatorC.getState().isCheckingDuplicate, false, 'C.2: 720p check completed')
    assert.equal(coordinatorC.getState().isDuplicate, false, 'C.3: 720p is not duplicate')

    // Resolve older 1080p response (which was duplicate)
    resolve1080pC({
      ok: true,
      data: { duplicate: true, data: { id: 1080, status: 'downloading' } }
    })
    await call1080pC

    // Verify 1080p response was discarded and did not overwrite 720p state
    assert.equal(
      coordinatorC.getState().isDuplicate,
      false,
      'C.4: Older 1080p response discarded; 720p remains not duplicate'
    )
    assert.equal(
      coordinatorC.getState().duplicateJob,
      null,
      'C.5: duplicateJob remains null for 720p'
    )
    console.log(
      '✓ SCENARIO C passed: Reverse response arrival strictly respects latest selection\n'
    )

    // --- SCENARIO D: MP3 bitrate switching ---
    console.log('--- SCENARIO D: MP3 bitrate switching ---')
    let resolve192kD
    const promise192kD = new Promise((resolve) => {
      resolve192kD = resolve
    })

    let resolve320kD
    const promise320kD = new Promise((resolve) => {
      resolve320kD = resolve
    })

    const coordinatorD = new DuplicateGuardCoordinator({
      checkApiFn: async (payload) => {
        if (payload.audioBitrateKbps === 192) return await promise192kD
        return await promise320kD
      }
    })

    // 1. Select MP3 192k
    const call192kD = coordinatorD.executeCheck(
      {
        mediaItemId: media1.id,
        selectedFormat: 'mp3',
        selectedAudioBitrate: 192,
        enabled: true
      },
      { isBackground: false }
    )

    // 2. Switch to 320k
    const call320kD = coordinatorD.executeCheck(
      {
        mediaItemId: media1.id,
        selectedFormat: 'mp3',
        selectedAudioBitrate: 320,
        enabled: true
      },
      { isBackground: false }
    )

    assert.equal(
      coordinatorD.getState().isDuplicate,
      false,
      'D.1: Duplicate cleared immediately on bitrate switch'
    )

    // 3. Resolve 320k first (not duplicate), then 192k (duplicate)
    resolve320kD({ ok: true, data: { duplicate: false, data: null } })
    await call320kD

    assert.equal(coordinatorD.getState().isDuplicate, false, 'D.2: 320k is not duplicate')

    resolve192kD({
      ok: true,
      data: { duplicate: true, data: { id: 192, status: 'queued' } }
    })
    await call192kD

    assert.equal(coordinatorD.getState().isDuplicate, false, 'D.3: Stale 192k response discarded')
    assert.equal(coordinatorD.getState().duplicateJob, null, 'D.4: duplicateJob remains null')
    console.log('✓ SCENARIO D passed: MP3 bitrate switching rejects stale responses\n')

    // --- SCENARIO E: MP4 to MP3 and MP3 to MP4 switching ---
    console.log('--- SCENARIO E: MP4 to MP3 and MP3 to MP4 switching ---')
    let resolveMp4E
    const promiseMp4E = new Promise((resolve) => {
      resolveMp4E = resolve
    })

    let resolveMp3E
    const promiseMp3E = new Promise((resolve) => {
      resolveMp3E = resolve
    })

    const coordinatorE = new DuplicateGuardCoordinator({
      checkApiFn: async (payload) => {
        if (payload.outputFormat === 'mp4') return await promiseMp4E
        return await promiseMp3E
      }
    })

    // 1. User selects MP4 1080p
    const callMp4E = coordinatorE.executeCheck(
      {
        mediaItemId: media1.id,
        selectedFormat: 'mp4',
        selectedVideoQuality: '1080p',
        mp4Qualities: ['1080p'],
        highestAvailableQuality: '1080p',
        enabled: true
      },
      { isBackground: false }
    )

    // 2. User switches format to MP3 192k
    const callMp3E = coordinatorE.executeCheck(
      {
        mediaItemId: media1.id,
        selectedFormat: 'mp3',
        selectedAudioBitrate: 192,
        enabled: true
      },
      { isBackground: false }
    )

    assert.equal(
      coordinatorE.getState().isDuplicate,
      false,
      'E.1: Format switch clears prior duplicate state'
    )

    // 3. Resolve MP3 first (not duplicate), then delayed MP4 (duplicate)
    resolveMp3E({ ok: true, data: { duplicate: false, data: null } })
    await callMp3E

    assert.equal(coordinatorE.getState().isDuplicate, false, 'E.2: MP3 selection not duplicate')

    resolveMp4E({
      ok: true,
      data: { duplicate: true, data: { id: 404, status: 'downloading' } }
    })
    await callMp4E

    assert.equal(coordinatorE.getState().isDuplicate, false, 'E.3: Stale MP4 response discarded')

    // 4. User switches back from MP3 to MP4
    let resolveMp4E2
    const promiseMp4E2 = new Promise((resolve) => {
      resolveMp4E2 = resolve
    })
    coordinatorE.checkApiFn = async () => await promiseMp4E2

    const callMp4E2 = coordinatorE.executeCheck(
      {
        mediaItemId: media1.id,
        selectedFormat: 'mp4',
        selectedVideoQuality: '1080p',
        mp4Qualities: ['1080p'],
        highestAvailableQuality: '1080p',
        enabled: true
      },
      { isBackground: false }
    )

    resolveMp4E2({
      ok: true,
      data: { duplicate: true, data: { id: 405, status: 'downloading' } }
    })
    await callMp4E2

    assert.equal(
      coordinatorE.getState().isDuplicate,
      true,
      'E.4: Switching back to MP4 detects active duplicate'
    )
    assert.equal(coordinatorE.getState().duplicateJob.id, 405, 'E.5: Matching job ID preserved')
    console.log('✓ SCENARIO E passed: Format transitions between MP4 and MP3 track accurately\n')

    // --- SCENARIO F: Background polling without spinner flickering ---
    console.log('--- SCENARIO F: Background polling without spinner flickering ---')
    let backgroundResolveF
    const coordinatorF = new DuplicateGuardCoordinator({
      checkApiFn: async () => {
        return new Promise((r) => {
          backgroundResolveF = r
        })
      }
    })

    assert.equal(coordinatorF.getState().isCheckingDuplicate, false, 'F.1: Initially not checking')

    // Trigger background poll
    const bgPollF = coordinatorF.executeCheck(
      {
        mediaItemId: media1.id,
        selectedFormat: 'mp4',
        selectedVideoQuality: '1080p',
        mp4Qualities: ['1080p'],
        highestAvailableQuality: '1080p',
        enabled: true
      },
      { isBackground: true }
    )

    assert.equal(
      coordinatorF.getState().isCheckingDuplicate,
      false,
      'F.2: Spinner remains inactive during in-flight background poll'
    )

    backgroundResolveF({
      ok: true,
      data: { duplicate: true, data: { id: 202, status: 'queued' } }
    })
    await bgPollF

    assert.equal(
      coordinatorF.getState().isCheckingDuplicate,
      false,
      'F.3: Spinner remains inactive after background poll completes'
    )
    assert.equal(coordinatorF.getState().isDuplicate, true, 'F.4: State updated to duplicate')
    console.log('✓ SCENARIO F passed: Background polling never activates loading spinner\n')

    // --- SCENARIO G: Component unmount while request pending ---
    console.log('--- SCENARIO G: Component unmount while request pending ---')
    let resolveG
    const promiseG = new Promise((resolve) => {
      resolveG = resolve
    })

    let stateCallbacksG = 0
    let checkingCallbacksG = 0

    const coordinatorG = new DuplicateGuardCoordinator({
      onStateChange: () => {
        stateCallbacksG++
      },
      onCheckingChange: () => {
        checkingCallbacksG++
      },
      checkApiFn: async () => await promiseG
    })

    const checkG = coordinatorG.executeCheck(
      {
        mediaItemId: media1.id,
        selectedFormat: 'mp4',
        selectedVideoQuality: '1080p',
        mp4Qualities: ['1080p'],
        highestAvailableQuality: '1080p',
        enabled: true
      },
      { isBackground: false }
    )

    assert.equal(
      coordinatorG.getState().isCheckingDuplicate,
      true,
      'G.1: Foreground checking active'
    )
    const stateCallsBeforeUnmount = stateCallbacksG
    const checkingCallsBeforeUnmount = checkingCallbacksG

    // Component unmounts
    coordinatorG.unmount()
    assert.equal(coordinatorG.isMounted, false, 'G.2: Coordinator is unmounted')

    // Request settles after unmount
    resolveG({
      ok: true,
      data: { duplicate: true, data: { id: 777, status: 'downloading' } }
    })
    await checkG

    // Callbacks must NOT be called after unmount
    assert.equal(
      stateCallbacksG,
      stateCallsBeforeUnmount,
      'G.3: onStateChange not called after unmount'
    )
    assert.equal(
      checkingCallbacksG,
      checkingCallsBeforeUnmount,
      'G.4: onCheckingChange not called after unmount'
    )
    console.log(
      '✓ SCENARIO G passed: Unmount safely invalidates pending requests and prevents callbacks\n'
    )

    // --- SCENARIO H: Terminal status transitions against real API ---
    console.log('--- SCENARIO H: Terminal status transitions against real API ---')
    const termJobH = await DownloadJob.create({
      media_id: media1.id,
      output_format: 'mp4',
      quality: '1080p',
      status: 'downloading'
    })

    const resH1 = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp4', quality: '1080p' }
    })
    assert.equal(resH1.body.duplicate, true, 'H.1: Downloading job is duplicate')

    await termJobH.update({ status: 'completed' })
    const resH2 = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp4', quality: '1080p' }
    })
    assert.equal(resH2.body.duplicate, false, 'H.2: Duplicate clears after job completed')

    await termJobH.update({ status: 'failed' })
    const resH3 = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp4', quality: '1080p' }
    })
    assert.equal(resH3.body.duplicate, false, 'H.3: Duplicate clears after job failed')

    await termJobH.update({ status: 'cancelled' })
    const resH4 = await testRequest(server, token, {
      path: '/api/downloads/check-duplicate',
      method: 'POST',
      body: { mediaItemId: media1.id, outputFormat: 'mp4', quality: '1080p' }
    })
    assert.equal(resH4.body.duplicate, false, 'H.4: Duplicate clears after job cancelled')
    console.log(
      '✓ SCENARIO H passed: Terminal statuses (completed/failed/cancelled) clear duplicate state\n'
    )
    await termJobH.destroy()

    // --- SCENARIO I: Clearing URL while duplicate checking in progress ---
    console.log('--- SCENARIO I: Clearing URL while duplicate checking in progress ---')
    let resolveI
    const promiseI = new Promise((resolve) => {
      resolveI = resolve
    })

    const coordinatorI = new DuplicateGuardCoordinator({
      checkApiFn: async () => await promiseI
    })

    // User entered URL, check is in progress
    const checkI = coordinatorI.executeCheck(
      {
        mediaItemId: media1.id,
        selectedFormat: 'mp4',
        selectedVideoQuality: '1080p',
        mp4Qualities: ['1080p'],
        highestAvailableQuality: '1080p',
        enabled: true
      },
      { isBackground: false }
    )

    assert.equal(coordinatorI.getState().isCheckingDuplicate, true, 'I.1: Checking active')

    // User clears URL input (mediaItemId becomes null / enabled false)
    await coordinatorI.executeCheck({ mediaItemId: null, enabled: false })

    assert.equal(coordinatorI.getState().isCheckingDuplicate, false, 'I.2: Reset on URL cleared')
    assert.equal(coordinatorI.getState().isDuplicate, false, 'I.3: Duplicate reset')

    // Network request finishes later
    resolveI({
      ok: true,
      data: { duplicate: true, data: { id: 888, status: 'queued' } }
    })
    await checkI

    // Old response discarded
    assert.equal(
      coordinatorI.getState().isDuplicate,
      false,
      'I.4: Stale response discarded on URL clear'
    )
    assert.equal(coordinatorI.getState().duplicateJob, null, 'I.5: duplicateJob remains null')
    console.log('✓ SCENARIO I passed: Clearing URL immediately invalidates pending checks\n')

    // --- SCENARIO J: Re-analyzing different media URL while earlier check is pending ---
    console.log(
      '--- SCENARIO J: Re-analyzing different media URL while earlier check is pending ---'
    )
    let resolveMedia1J
    const promiseMedia1J = new Promise((resolve) => {
      resolveMedia1J = resolve
    })

    let resolveMedia2J
    const promiseMedia2J = new Promise((resolve) => {
      resolveMedia2J = resolve
    })

    const coordinatorJ = new DuplicateGuardCoordinator({
      checkApiFn: async (payload) => {
        if (payload.mediaItemId === media1.id) return await promiseMedia1J
        return await promiseMedia2J
      }
    })

    // 1. Check for Media 1
    const callMedia1J = coordinatorJ.executeCheck(
      {
        mediaItemId: media1.id,
        selectedFormat: 'mp4',
        selectedVideoQuality: '1080p',
        mp4Qualities: ['1080p'],
        highestAvailableQuality: '1080p',
        enabled: true
      },
      { isBackground: false }
    )

    // 2. User pastes different URL, resolving to media3
    const callMedia2J = coordinatorJ.executeCheck(
      {
        mediaItemId: media3.id,
        selectedFormat: 'mp4',
        selectedVideoQuality: '1080p',
        mp4Qualities: ['1080p'],
        highestAvailableQuality: '1080p',
        enabled: true
      },
      { isBackground: false }
    )

    assert.equal(coordinatorJ.getState().isDuplicate, false, 'J.1: Media switch clears duplicate')

    // 3. Media 2 resolves first (not duplicate)
    resolveMedia2J({ ok: true, data: { duplicate: false, data: null } })
    await callMedia2J

    assert.equal(coordinatorJ.getState().isCheckingDuplicate, false, 'J.2: Media 2 check complete')
    assert.equal(coordinatorJ.getState().isDuplicate, false, 'J.3: Media 2 is not duplicate')

    // 4. Media 1 resolves later (duplicate)
    resolveMedia1J({
      ok: true,
      data: { duplicate: true, data: { id: 111, status: 'downloading' } }
    })
    await callMedia1J

    assert.equal(
      coordinatorJ.getState().isDuplicate,
      false,
      'J.4: Media 1 duplicate response discarded'
    )
    assert.equal(
      coordinatorJ.getState().duplicateJob,
      null,
      'J.5: duplicateJob remains null for Media 2'
    )
    console.log(
      '✓ SCENARIO J passed: Re-analyzing different URL strictly discards earlier checks\n'
    )

    // ========================================================================
    // PART 04: REAL BACKEND API CONCURRENCY TEST (EXPRESS POST /api/downloads)
    // ========================================================================
    console.log('================================================================')
    console.log(' PART 04: REAL BACKEND API CONCURRENCY INTEGRATION TEST          ')
    console.log('================================================================\n')

    const tempDownloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'duplicate-guard-dl-'))
    const { AppSetting } = testDb.sequelize.models
    await AppSetting.upsert({
      key: 'download_path',
      value: tempDownloadDir
    })

    globalThis.__mockChildProcess = {
      spawn: () => {
        const child = new MockChildProcess()
        process.nextTick(() => {
          child.stdout.write('[download] 100% of 10MiB at 2MiB/s\n')
          child.stdout.end()
          child.stderr.end()
          child.emit('close', 0, null)
        })
        return child
      },
      execFile: (exe, args, opts, cb) => {
        if (typeof opts === 'function') cb = opts
        const argsList = Array.isArray(args) ? args : []
        if (argsList.includes('--dump-single-json')) {
          return process.nextTick(() =>
            cb(null, { stdout: JSON.stringify(YOUTUBE_SYNTHETIC_FIXTURE), stderr: '' })
          )
        }
        return process.nextTick(() => cb(null, { stdout: '', stderr: '' }))
      }
    }

    const postDownload = (body) =>
      testRequest(server, token, {
        path: '/api/downloads',
        method: 'POST',
        body
      })

    // 1. Send 4 simultaneous HTTP POST requests with identical media, format, and quality
    const concPayload = {
      mediaItemId: media1.id,
      outputFormat: 'mp4',
      quality: '1080p'
    }

    const [resp1, resp2, resp3, resp4] = await Promise.all([
      postDownload(concPayload),
      postDownload(concPayload),
      postDownload(concPayload),
      postDownload(concPayload)
    ])

    const responses = [resp1, resp2, resp3, resp4]
    const leaderRes = responses.find((r) => r.status === 201)
    const followerResponses = responses.filter((r) => r.status === 200)

    assert.ok(leaderRes, 'CONCURRENCY 1: Exactly one leader request returned HTTP 201')
    assert.equal(
      followerResponses.length,
      3,
      'CONCURRENCY 2: Exactly three follower requests returned HTTP 200'
    )

    const leaderJobId = leaderRes.body.data.id
    for (const fol of followerResponses) {
      assert.equal(fol.body.duplicate, true, 'CONCURRENCY 3: Follower received duplicate === true')
      assert.equal(
        fol.body.data.id,
        leaderJobId,
        'CONCURRENCY 4: Follower received identical leader Job ID'
      )
    }

    // 2. Database verification: exactly 1 DownloadJob record created in SQLite
    const createdJobCount = await DownloadJob.count({
      where: { media_id: media1.id, output_format: 'mp4', quality: '1080p' }
    })
    assert.equal(
      createdJobCount,
      1,
      'CONCURRENCY 5: Exactly 1 DownloadJob record created in SQLite'
    )

    // 3. Queue verification: exactly 1 queue entry created for this Job ID
    const queueState = getQueueStatus()
    const jobQueueOccurrences = queueState.scheduledJobIds.filter((id) => id === leaderJobId)
    assert.equal(jobQueueOccurrences.length, 1, 'CONCURRENCY 6: Exactly 1 queue entry created')

    // 4. Different qualities/formats independently downloadable
    const diffQualityRes = await postDownload({
      mediaItemId: media1.id,
      outputFormat: 'mp4',
      quality: '720p'
    })
    assert.equal(
      diffQualityRes.status,
      201,
      'CONCURRENCY 7: Distinct MP4 quality returns HTTP 201 Created'
    )
    assert.notEqual(
      diffQualityRes.body.data.id,
      leaderJobId,
      'CONCURRENCY 8: Distinct MP4 quality gets new Job ID'
    )

    const diffFormatRes = await postDownload({
      mediaItemId: media1.id,
      outputFormat: 'mp3',
      audioBitrateKbps: 192
    })
    assert.equal(diffFormatRes.status, 201, 'CONCURRENCY 9: MP3 format returns HTTP 201 Created')
    assert.notEqual(
      diffFormatRes.body.data.id,
      leaderJobId,
      'CONCURRENCY 10: MP3 gets distinct Job ID'
    )
    assert.notEqual(
      diffFormatRes.body.data.id,
      diffQualityRes.body.data.id,
      'CONCURRENCY 11: MP3 gets distinct Job ID from 720p'
    )

    // 5. Failed creation releases guard lock cleanly without deadlock
    const failedIdentity = buildDownloadRequestIdentity({
      sourceUrl: media3.source_url,
      outputFormat: 'mp4',
      quality: '720p'
    })

    let caughtError = null
    try {
      await withDownloadCreationGuard(failedIdentity, async () => {
        throw new Error('Simulated creation failure inside guard')
      })
    } catch (err) {
      caughtError = err
    }
    assert.ok(caughtError, 'CONCURRENCY 12: Error thrown inside creation guard was caught')

    // Subsequent request for the same identity proceeds without deadlocking
    let subsequentExecuted = false
    const recoveryResult = await withDownloadCreationGuard(failedIdentity, async () => {
      subsequentExecuted = true
      return { job: { id: 9999 }, duplicate: false }
    })
    assert.equal(
      subsequentExecuted,
      true,
      'CONCURRENCY 13: Subsequent request executes without deadlock'
    )
    assert.equal(
      recoveryResult.job.id,
      9999,
      'CONCURRENCY 14: Guard lock was cleanly released on failure'
    )

    // Cleanup concurrency resources
    stopQueueForShutdown()
    resetQueueForTesting()
    delete globalThis.__mockChildProcess
    try {
      await fs.rm(tempDownloadDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
      })
    } catch {
      // Best-effort cleanup of temporary test directory on Windows
    }
    console.log(
      '✓ PART 04 passed: Real Express POST /api/downloads concurrency guarantees verified\n'
    )

    console.log('================================================================')
    console.log(' ALL DUPLICATE DOWNLOAD GUARD TESTS (A–N & PART 02/04) PASSED!  ')
    console.log('================================================================\n')
  } finally {
    stopQueueForShutdown()
    resetQueueForTesting()
    delete globalThis.__mockChildProcess
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections()
    }
    await new Promise((resolve) => server.close(resolve))
    resetSessionTokenForTest()
    await new Promise((resolve) => setTimeout(resolve, 80))
    await testDb.cleanup()
  }
}

runDuplicateDownloadGuardTests()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error('\n❌ DUPLICATE DOWNLOAD GUARD TESTS FAILED:', err)
    process.exit(1)
  })
