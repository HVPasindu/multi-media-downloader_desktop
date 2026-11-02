import assert from 'node:assert/strict'
import http from 'node:http'
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
import { getQueueStatus } from '../src/main/backend/services/downloadQueueService.js'
import { createTestDatabase } from './helpers/testDatabase.js'

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

    console.log('================================================================')
    console.log(' ALL DUPLICATE DOWNLOAD GUARD TESTS (A–N) PASSED SUCCESSFULLY! ')
    console.log('================================================================\n')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    resetSessionTokenForTest()
    await testDb.cleanup()
  }
}

runDuplicateDownloadGuardTests().catch((err) => {
  console.error('\n❌ DUPLICATE DOWNLOAD GUARD TESTS FAILED:', err)
  process.exit(1)
})
