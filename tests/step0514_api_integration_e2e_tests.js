/**
 * APPLAN2 Stage 05.14 — Layer A -> Layer B Live API Integration E2E Suite
 *
 * Exercises production frontend service modules:
 *   - src/renderer/src/services/api.js
 *   - src/renderer/src/services/mediaApi.js
 *   - src/renderer/src/services/downloadsApi.js
 *   - src/renderer/src/services/downloadSettingsApi.js
 * bridged via window.api.request directly over loopback HTTP to the real
 * Express server + isolated SQLite database created by createE2eEnvironment().
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createE2eEnvironment } from './helpers/e2eTestEnvironment.js'

if (!process.execArgv.some((arg) => arg.includes('electron_loader'))) {
  try {
    execFileSync(
      process.execPath,
      ['--loader', './tests/loaders/electron_loader.mjs', fileURLToPath(import.meta.url)],
      { stdio: 'inherit' }
    )
    process.exit(0)
  } catch (err) {
    process.exit(err.status || 1)
  }
}

async function runApiIntegrationSuite() {
  console.log('================================================================')
  console.log(' APPLAN2 Stage 05.14: Layer A <-> Express + SQLite API E2E      ')
  console.log('================================================================')

  const env = await createE2eEnvironment('applan2-step0514-api-')
  let dispatchEvents = []

  // Wire production preload contract window.api.request -> live loopback HTTP server
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type
      this.detail = init.detail
    }
  }
  globalThis.window = {
    dispatchEvent: (ev) => {
      dispatchEvents.push(ev?.type || 'unknown')
    },
    api: {
      request: async ({ path: reqPath, method = 'GET', body = null, headers = {} }) => {
        const res = await env.request({ path: reqPath, method, body, headers })
        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          data: res.body,
          error:
            res.status >= 400
              ? res.body?.message || res.body?.error || `HTTP ${res.status}`
              : undefined
        }
      }
    }
  }

  const { checkApiHealth } = await import('../src/renderer/src/services/api.js')
  const { analyzeMedia } = await import('../src/renderer/src/services/mediaApi.js')
  const {
    createDownload,
    checkDownloadDuplicate,
    listDownloads,
    getDownloadSummary,
    getDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    retryDownload,
    deleteDownloadHistory,
    clearDownloadHistory,
    getActiveDownloadsCount
  } = await import('../src/renderer/src/services/downloadsApi.js')
  const { getDownloadSettings, updateDownloadSettings } =
    await import('../src/renderer/src/services/downloadSettingsApi.js')

  try {
    // =========================================================================
    // TEST 1: Health Check & Download Settings Roundtrip + Validation
    // =========================================================================
    console.log('\n--- TEST 1: Health & Settings Persistence Roundtrip ---')
    const healthRes = await checkApiHealth()
    assert.equal(healthRes.ok, true, 'Health check must return ok: true')

    const initialSettings = await getDownloadSettings()
    assert.equal(initialSettings.ok, true)
    assert.equal(initialSettings.data.success, true)

    const patchRes = await updateDownloadSettings({
      defaultFormat: 'mp3',
      preferredMp4Quality: '720p',
      preferredMp3BitrateKbps: 320
    })
    assert.equal(patchRes.ok, true)
    assert.equal(patchRes.data.data.defaultFormat, 'mp3')
    assert.equal(patchRes.data.data.preferredMp4Quality, '720p')
    assert.equal(patchRes.data.data.preferredMp3BitrateKbps, 320)

    const invalidPatch = await updateDownloadSettings({ preferredMp3BitrateKbps: 999 })
    assert.equal(invalidPatch.ok, false)
    assert.equal(invalidPatch.status, 400, 'Invalid bitrate setting must return HTTP 400')
    console.log('✓ TEST 1 passed: Health & SQLite settings roundtrip verified.')

    // =========================================================================
    // TEST 2: Analyze -> MP4 & MP3 E2E Downloads -> Summary & Disk Output
    // =========================================================================
    console.log('\n--- TEST 2: Analyze + MP4 & MP3 Complete Downloads + Summary ---')
    const analyzeRes = await analyzeMedia('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    assert.equal(analyzeRes.ok, true, 'analyzeMedia must succeed')
    const media = analyzeRes.data.data
    assert.ok(Number.isInteger(media.mediaItemId) && media.mediaItemId > 0)
    assert.ok(Array.isArray(media.videoQualities) && media.videoQualities.length > 0)

    const mp4CreateRes = await createDownload({
      mediaItemId: media.mediaItemId,
      outputFormat: 'mp4',
      quality: '720p'
    })
    assert.equal(mp4CreateRes.ok, true)
    assert.equal(mp4CreateRes.status, 201)
    const mp4JobId = mp4CreateRes.data.data.id

    await env.waitForJobState(mp4JobId, (j) => j.status === 'completed')
    const mp4Detail = await getDownload(mp4JobId)
    assert.equal(mp4Detail.ok, true)
    assert.equal(mp4Detail.data.data.job.status, 'completed')
    assert.ok(
      mp4Detail.data.data.file && fs.existsSync(mp4Detail.data.data.file.file_path),
      'Completed MP4 file must exist on disk'
    )

    const mp3CreateRes = await createDownload({
      mediaItemId: media.mediaItemId,
      outputFormat: 'mp3',
      audioBitrateKbps: 320
    })
    assert.equal(mp3CreateRes.ok, true)
    assert.equal(mp3CreateRes.status, 201)
    const mp3JobId = mp3CreateRes.data.data.id

    await env.waitForJobState(mp3JobId, (j) => j.status === 'completed')
    const mp3Detail = await getDownload(mp3JobId)
    assert.equal(mp3Detail.ok, true)
    assert.equal(mp3Detail.data.data.job.status, 'completed')

    const summaryRes = await getDownloadSummary()
    assert.equal(summaryRes.ok, true)
    const summaryData = summaryRes.data.data
    assert.equal(summaryData.downloads.completed, 2)
    assert.equal(summaryData.history.videos, 1)
    assert.equal(summaryData.history.audio, 1)
    assert.equal(summaryData.history.totalFiles, 2)
    assert.ok(summaryData.history.storageBytes > 0, 'Completed file storageBytes must be > 0')
    console.log('✓ TEST 2 passed: Complete MP4 + MP3 downloads & /api/downloads/summary verified.')

    // =========================================================================
    // TEST 3: Pause -> Resume -> Cancel -> Retry Control Lifecycle
    // =========================================================================
    console.log('\n--- TEST 3: Pause / Resume / Cancel / Retry via HTTP ---')
    const holdMedia = await analyzeMedia('https://www.youtube.com/watch?v=aqz-KE-bpKQ')
    const holdMediaId = holdMedia.data.data.mediaItemId
    const predictedNextId = mp3JobId + 1
    env.setFailureRules({ holdJobs: [predictedNextId, predictedNextId + 1] })

    const activeCreateRes = await createDownload({
      mediaItemId: holdMediaId,
      outputFormat: 'mp4',
      quality: '720p'
    })
    assert.equal(activeCreateRes.ok, true)
    const activeJobId = activeCreateRes.data.data.id

    await env.waitForJobState(activeJobId, (j) => j.status === 'downloading')

    // Pause downloading job (mock child ignores ctrl-break unless released/killed; verify API behavior)
    const pausePromise = pauseDownload(activeJobId)
    await new Promise((r) => setTimeout(r, 80))
    const activeMock = env.getActiveMockProcess(activeJobId)
    if (activeMock && !activeMock.killed) {
      // Simulate clean subprocess exit on pause signal so test deterministically completes pause handshake
      activeMock.stdout.end()
      activeMock.stderr.end()
      activeMock.emit('close', 1, 'SIGTERM')
    }
    const pauseRes = await pausePromise
    assert.equal(pauseRes.ok, true, `pauseDownload failed: ${pauseRes.error}`)
    await env.waitForJobState(activeJobId, (j) => j.status === 'paused')

    // Resume paused job back into active execution
    const resumeRes = await resumeDownload(activeJobId)
    assert.equal(resumeRes.ok, true, `resumeDownload failed: ${resumeRes.error}`)
    await env.waitForJobState(activeJobId, (j) => ['queued', 'downloading'].includes(j.status))
    await env.waitForJobState(activeJobId, (j) => j.status === 'downloading')

    // Cancel downloading job
    const cancelRes = await cancelDownload(activeJobId)
    assert.equal(cancelRes.ok, true, `cancelDownload failed: ${cancelRes.error}`)
    const resumedMock = env.getActiveMockProcess(activeJobId)
    if (resumedMock && !resumedMock.killed) {
      resumedMock.stdout.end()
      resumedMock.stderr.end()
      resumedMock.emit('close', 1, 'SIGTERM')
    }
    await env.waitForJobState(activeJobId, (j) => j.status === 'cancelled')

    // Release hold rules and Retry cancelled job
    env.setFailureRules({})
    const retryRes = await retryDownload(activeJobId)
    assert.equal(retryRes.ok, true, `retryDownload failed: ${retryRes.error}`)
    assert.equal(retryRes.status, 201)
    const retriedId = retryRes.data.data.retryJobId
    await env.waitForJobState(retriedId, (j) => j.status === 'completed')
    console.log('✓ TEST 3 passed: Pause, Resume, Cancel & Retry verified over Express + SQLite.')

    // =========================================================================
    // TEST 4: Duplicate Guard, Active Count & Queue Concurrency = 2
    // =========================================================================
    console.log('\n--- TEST 4: Duplicate Guard, Active Count & Concurrency Cap (2) ---')
    const concBaseId = Math.max(retriedId, activeJobId) + 1
    env.setFailureRules({ holdJobs: [concBaseId, concBaseId + 1, concBaseId + 2] })

    const q1 = await createDownload({
      mediaItemId: holdMediaId,
      outputFormat: 'mp4',
      quality: '1080p'
    })
    const q2 = await createDownload({
      mediaItemId: holdMediaId,
      outputFormat: 'mp4',
      quality: '480p'
    })
    const q3 = await createDownload({
      mediaItemId: holdMediaId,
      outputFormat: 'mp4',
      quality: '360p'
    })

    const qIds = [q1.data.data.id, q2.data.data.id, q3.data.data.id]
    await env.waitForJobState(qIds[0], (j) => j.status === 'downloading')
    await env.waitForJobState(qIds[1], (j) => j.status === 'downloading')

    const thirdState = await getDownload(qIds[2])
    assert.equal(
      thirdState.data.data.job.status,
      'queued',
      '3rd concurrent job must wait queued when max concurrency = 2'
    )

    const dupRes = await checkDownloadDuplicate({
      mediaItemId: holdMediaId,
      outputFormat: 'mp4',
      quality: '1080p'
    })
    assert.equal(dupRes.ok, true)
    assert.equal(dupRes.data.duplicate, true, 'Duplicate check must flag running 1080p job')

    const activeCount = await getActiveDownloadsCount()
    assert.equal(activeCount.ok, true, 'getActiveDownloadsCount must succeed')
    assert.equal(activeCount.downloading, 2, 'Active downloading count must be 2')
    assert.equal(activeCount.queued, 1, 'Queued count must be 1')
    assert.equal(activeCount.total, 3, 'Active total count must equal 3 (2 downloading + 1 queued)')

    // Release all 3 held mock processes to finish cleanly before cleanup
    env.setFailureRules({})
    for (const qId of qIds) {
      await env.waitForJobState(qId, (j) => j.status === 'downloading' || j.status === 'completed')
      const proc = env.getActiveMockProcess(qId)
      if (proc && typeof proc.releaseExecution === 'function') {
        proc.releaseExecution()
      }
      await env.waitForJobState(qId, (j) => j.status === 'completed')
    }
    console.log(
      '✓ TEST 4 passed: Concurrency cap=2, FIFO queue, duplicate check & active count verified.'
    )

    // =========================================================================
    // TEST 5: Pagination, Search, Delete Single & Clear History + Summary Sync
    // =========================================================================
    console.log('\n--- TEST 5: History Pagination, Search, Delete & Clear Consistency ---')
    const page1 = await listDownloads({ status: 'completed', limit: 2, offset: 0 })
    assert.equal(page1.ok, true)
    assert.equal(page1.data.data.length, 2)
    assert.ok(page1.data.pagination.total >= 5)

    const searchRes = await listDownloads({ outputFormat: 'mp3', search: 'Test' })
    assert.equal(searchRes.ok, true)
    assert.equal(searchRes.data.data.length, 1, 'Filtered search for mp3 + Test must match 1 job')

    const delSingle = await deleteDownloadHistory(mp4JobId)
    assert.equal(delSingle.ok, true)
    assert.equal(delSingle.data.data.deleted, true)

    const clearNoConfirm = await env.request({
      path: '/api/downloads/history',
      method: 'DELETE',
      body: { confirm: false, statuses: ['completed'] }
    })
    assert.equal(
      clearNoConfirm.status,
      400,
      'Clear history without confirm: true must fail with 400'
    )

    const clearAll = await clearDownloadHistory({
      confirm: true,
      statuses: ['completed', 'failed', 'cancelled']
    })
    assert.equal(clearAll.ok, true)
    const afterClearSummary = await getDownloadSummary()
    assert.equal(afterClearSummary.data.data.history.totalFiles, 0)
    console.log('✓ TEST 5 passed: Pagination, search, single delete & clear history verified.')

    // =========================================================================
    // TEST 6: Loopback API Security (401 Bad Token, 403 Bad Host, 400 SSRF URL)
    // =========================================================================
    console.log('\n--- TEST 6: Loopback API Security Hardening ---')
    const badTokenRes = await env.request({
      path: '/api/downloads',
      headers: { authorization: 'Bearer wrong-session-token' }
    })
    assert.equal(badTokenRes.status, 401)

    const badHostRes = await env.request({
      path: '/api/downloads',
      headers: { host: 'evil.example.com:3000' }
    })
    assert.equal(badHostRes.status, 403)

    const ssrfAnalyzeRes = await analyzeMedia('http://127.0.0.1:9000/private')
    assert.equal(ssrfAnalyzeRes.ok, false)
    assert.equal(ssrfAnalyzeRes.status, 400)
    assert.ok(dispatchEvents.includes('applan2:download-state-changed'))
    console.log('✓ TEST 6 passed: Security & validation checks passed.')

    console.log('\n================================================================')
    console.log(' ALL 6 STAGE 05.14 API INTEGRATION E2E TESTS PASSED (100%)       ')
    console.log('================================================================')
  } finally {
    await env.cleanup()
  }
}

runApiIntegrationSuite().catch((err) => {
  console.error('❌ Stage 05.14 API Integration E2E Suite Failed:', err)
  process.exit(1)
})
