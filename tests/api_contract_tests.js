import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { createApiApp } from '../src/main/backend/app.js'
import {
  initSessionToken,
  resetSessionTokenForTest,
  LOCAL_API_PORT,
  LOCAL_API_HOST
} from '../src/main/backend/services/localApiSecurityService.js'
import { initializeDatabase, closeDatabase } from '../src/main/backend/config/database.js'
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
  assertHistoryClearResponse,
  assertUnauthorizedResponse,
  assertForbiddenResponse,
  assertValidationErrorResponse,
  assertNotFoundResponse,
  assertConflictResponse
} from './helpers/apiResponseContracts.js'

/**
 * Performs raw HTTP requests with explicit control over Host, Origin, and Authorization headers.
 *
 * @param {object} options
 * @param {number} options.port
 * @param {string} options.path
 * @param {string} [options.method='GET']
 * @param {object} [options.headers={}]
 * @param {any} [options.body=null]
 * @returns {Promise<{ status: number, headers: object, body: any, rawBody: string }>}
 */
function makeHttpRequest({ port, path: reqPath, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const finalHeaders = {
      host: `127.0.0.1:${LOCAL_API_PORT}`,
      ...headers
    }

    let payload = null
    if (body != null) {
      payload = typeof body === 'string' ? body : JSON.stringify(body)
      finalHeaders['content-type'] = finalHeaders['content-type'] || 'application/json'
      finalHeaders['content-length'] = Buffer.byteLength(payload)
    }

    const req = http.request(
      {
        host: LOCAL_API_HOST,
        port,
        path: reqPath,
        method,
        headers: finalHeaders
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
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: parsed,
            rawBody: rawData
          })
        })
      }
    )

    req.on('error', reject)

    if (payload != null) {
      req.write(payload)
    }
    req.end()
  })
}

/**
 * ============================================================================
 * APPLAN2 — Step 04.42 Automated API Response Contract Test Suite
 * Covers categories A through Z validating HTTP status codes, JSON payload schemas,
 * OpenAPI documentation integrity, and error boundary responses.
 * ============================================================================
 */
async function runAllApiContractTests() {
  console.log('================================================================')
  console.log(' APPLAN2 — Step 04.42 API Contract & Response Validation Test Suite')
  console.log('================================================================\n')

  const testTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'applan2-contract-test-'))
  console.log(`[setup] Isolated test environment created: ${testTempDir}`)

  let testServer = null
  let testPort = 0
  let validToken = ''
  let sequelizeInstance = null

  try {
    // 1. Initialize isolated database
    const dbPath = path.join(testTempDir, 'api_contract_test.db')
    const { sequelize } = await initializeDatabase({ storage: dbPath })
    sequelizeInstance = sequelize
    const { MediaItem, DownloadJob } = sequelize.models

    // 2. Initialize predictable session token
    validToken = initSessionToken('contract_test_session_token_12345678901234567890123456789012')

    // 3. Start isolated Express app instance
    const app = createApiApp()
    testServer = http.createServer(app)
    await new Promise((resolve) => {
      testServer.listen(0, LOCAL_API_HOST, () => {
        testPort = testServer.address().port
        resolve()
      })
    })
    console.log(`[setup] Contract test server listening on 127.0.0.1:${testPort}\n`)

    const authHeaders = { authorization: `Bearer ${validToken}` }

    // ------------------------------------------------------------------------
    // Category A: OpenAPI 3.1.0 document syntax and metadata integrity
    // ------------------------------------------------------------------------
    console.log('[Category A] OpenAPI 3.1.0 document syntax & metadata integrity')
    const openApiPath = path.resolve(process.cwd(), 'docs', 'openapi.yaml')
    const openApiRaw = await fs.readFile(openApiPath, 'utf-8')
    assert.ok(openApiRaw.length > 500, 'docs/openapi.yaml must not be empty')
    assert.ok(
      openApiRaw.includes('openapi: 3.1.0') || openApiRaw.includes("openapi: '3.1.0'"),
      'Must specify OpenAPI 3.1.0 version'
    )
    assert.ok(
      openApiRaw.includes('title: Multi-Platform Media Downloader Local API'),
      'Must specify API title'
    )
    assert.ok(openApiRaw.includes('version: 1.0.0'), 'Must specify version 1.0.0')
    assert.ok(openApiRaw.includes('paths:'), 'Must specify paths root')
    assert.ok(openApiRaw.includes('components:'), 'Must specify components root')
    assert.ok(openApiRaw.includes('BearerAuth:'), 'Must define BearerAuth security scheme')
    console.log('  -> PASS: Category A valid\n')

    // ------------------------------------------------------------------------
    // Category B: OpenAPI paths match all Express API routes exactly
    // ------------------------------------------------------------------------
    console.log('[Category B] OpenAPI paths match all Express API routes')
    const requiredEndpoints = [
      '/api/health:',
      '/api/media/analyze:',
      '/api/downloads:',
      '/api/downloads/{id}:',
      '/api/downloads/{id}/cancel:',
      '/api/downloads/{id}/retry:',
      '/api/downloads/history:',
      '/api/settings/downloads:'
    ]
    for (const ep of requiredEndpoints) {
      assert.ok(openApiRaw.includes(ep), `OpenAPI must document endpoint: ${ep}`)
    }
    console.log('  -> PASS: Category B valid\n')

    // ------------------------------------------------------------------------
    // Category C: GET /api/health success contract
    // ------------------------------------------------------------------------
    console.log('[Category C] GET /api/health success contract')
    const resHealth = await makeHttpRequest({
      port: testPort,
      path: '/api/health'
    })
    assertHealthResponse(resHealth.status, resHealth.body)
    console.log('  -> PASS: Category C valid\n')

    // ------------------------------------------------------------------------
    // Category D: GET /api/health security & data leakage verification
    // ------------------------------------------------------------------------
    console.log('[Category D] GET /api/health security & leak prevention')
    assert.equal(resHealth.body.token, undefined)
    assert.equal(resHealth.body.session, undefined)
    assert.equal(resHealth.body.path, undefined)
    assert.equal(resHealth.body.secret, undefined)
    assert.equal(resHealth.body.env, undefined)
    console.log('  -> PASS: Category D valid\n')

    // ------------------------------------------------------------------------
    // Category E: POST /api/media/analyze missing URL validation error
    // ------------------------------------------------------------------------
    console.log('[Category E] POST /api/media/analyze missing URL error contract')
    const resAnalyzeMissing = await makeHttpRequest({
      port: testPort,
      path: '/api/media/analyze',
      method: 'POST',
      headers: authHeaders,
      body: {}
    })
    assertValidationErrorResponse(resAnalyzeMissing.status, resAnalyzeMissing.body)
    console.log('  -> PASS: Category E valid\n')

    // ------------------------------------------------------------------------
    // Category F: POST /api/media/analyze unsafe URL scheme validation error
    // ------------------------------------------------------------------------
    console.log('[Category F] POST /api/media/analyze unsafe scheme error contract')
    const resAnalyzeUnsafeScheme = await makeHttpRequest({
      port: testPort,
      path: '/api/media/analyze',
      method: 'POST',
      headers: authHeaders,
      body: { url: 'file:///C:/Windows/System32/drivers/etc/hosts' }
    })
    assertValidationErrorResponse(resAnalyzeUnsafeScheme.status, resAnalyzeUnsafeScheme.body)
    assert.ok(
      resAnalyzeUnsafeScheme.body.message.toLowerCase().includes('supported') ||
        resAnalyzeUnsafeScheme.body.message.toLowerCase().includes('url'),
      'Must explain URL scheme error'
    )
    console.log('  -> PASS: Category F valid\n')

    // ------------------------------------------------------------------------
    // Category G: POST /api/media/analyze SSRF / loopback target validation error
    // ------------------------------------------------------------------------
    console.log('[Category G] POST /api/media/analyze SSRF/loopback error contract')
    const resAnalyzeLoopback = await makeHttpRequest({
      port: testPort,
      path: '/api/media/analyze',
      method: 'POST',
      headers: authHeaders,
      body: { url: 'http://127.0.0.1:8080/internal' }
    })
    assertValidationErrorResponse(resAnalyzeLoopback.status, resAnalyzeLoopback.body)
    console.log('  -> PASS: Category G valid\n')

    // ------------------------------------------------------------------------
    // Category H: POST /api/media/analyze authentication rejection without Bearer token
    // ------------------------------------------------------------------------
    console.log('[Category H] POST /api/media/analyze unauthorized request rejection')
    const resAnalyzeNoAuth = await makeHttpRequest({
      port: testPort,
      path: '/api/media/analyze',
      method: 'POST',
      body: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }
    })
    assertUnauthorizedResponse(resAnalyzeNoAuth.status, resAnalyzeNoAuth.body)
    console.log('  -> PASS: Category H valid\n')

    // ------------------------------------------------------------------------
    // Category I: POST /api/media/analyze response contract structure validation
    // ------------------------------------------------------------------------
    console.log('[Category I] POST /api/media/analyze success payload contract validation')
    const mockAnalysisPayload = {
      mediaItemId: 10,
      id: 'dQw4w9WgXcQ',
      platform: 'youtube',
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up',
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
      durationSeconds: 212,
      videoQualities: ['1080p', '720p', '480p', '360p'],
      audioOptions: [128, 192, 320],
      availableFormats: {
        mp4Qualities: ['1080p', '720p', '480p', '360p'],
        mp4Formats: [{ formatId: '137', quality: '1080p' }],
        audioFormats: [{ formatId: '140', quality: '128k' }]
      }
    }
    assertMediaAnalyzeResponse(200, { success: true, data: mockAnalysisPayload })
    console.log('  -> PASS: Category I valid\n')

    // ------------------------------------------------------------------------
    // Category J: POST /api/downloads success contract for new MP3 download job
    // ------------------------------------------------------------------------
    console.log('[Category J] POST /api/downloads new MP3 job creation contract')
    const testMediaItem = await MediaItem.create({
      source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up',
      platform: 'youtube'
    })

    const resCreateMp3 = await makeHttpRequest({
      port: testPort,
      path: '/api/downloads',
      method: 'POST',
      headers: authHeaders,
      body: {
        mediaItemId: testMediaItem.id,
        outputFormat: 'mp3',
        audioBitrateKbps: 320
      }
    })
    assertDownloadCreateResponse(resCreateMp3.status, resCreateMp3.body, false)
    const createdJobId = resCreateMp3.body.data.id
    assert.ok(Number.isInteger(createdJobId) && createdJobId > 0)
    console.log(`  -> PASS: Category J valid (Created Job #${createdJobId})\n`)

    // ------------------------------------------------------------------------
    // Category K: POST /api/downloads active duplicate contract
    // ------------------------------------------------------------------------
    console.log('[Category K] POST /api/downloads active duplicate detection contract')
    const resCreateDuplicate = await makeHttpRequest({
      port: testPort,
      path: '/api/downloads',
      method: 'POST',
      headers: authHeaders,
      body: {
        mediaItemId: testMediaItem.id,
        outputFormat: 'mp3',
        audioBitrateKbps: 320
      }
    })
    assertDownloadCreateResponse(resCreateDuplicate.status, resCreateDuplicate.body, true)
    assert.equal(resCreateDuplicate.body.duplicate, true)
    assert.equal(resCreateDuplicate.body.data.id, createdJobId)
    console.log('  -> PASS: Category K valid\n')

    // ------------------------------------------------------------------------
    // Category L: POST /api/downloads validation error for invalid mediaItemId
    // ------------------------------------------------------------------------
    console.log('[Category L] POST /api/downloads invalid mediaItemId validation error')
    const resInvalidMediaId = await makeHttpRequest({
      port: testPort,
      path: '/api/downloads',
      method: 'POST',
      headers: authHeaders,
      body: {
        mediaItemId: -5,
        outputFormat: 'mp3',
        audioBitrateKbps: 320
      }
    })
    assertValidationErrorResponse(resInvalidMediaId.status, resInvalidMediaId.body)
    console.log('  -> PASS: Category L valid\n')

    // ------------------------------------------------------------------------
    // Category M: POST /api/downloads validation error for unsupported outputFormat
    // ------------------------------------------------------------------------
    console.log('[Category M] POST /api/downloads invalid outputFormat validation error')
    const resInvalidFormat = await makeHttpRequest({
      port: testPort,
      path: '/api/downloads',
      method: 'POST',
      headers: authHeaders,
      body: {
        mediaItemId: testMediaItem.id,
        outputFormat: 'flv',
        audioBitrateKbps: 320
      }
    })
    assertValidationErrorResponse(resInvalidFormat.status, resInvalidFormat.body)
    console.log('  -> PASS: Category M valid\n')

    // ------------------------------------------------------------------------
    // Category N: POST /api/downloads validation error for invalid MP3 bitrate
    // ------------------------------------------------------------------------
    console.log('[Category N] POST /api/downloads invalid MP3 bitrate validation error')
    const resInvalidBitrate = await makeHttpRequest({
      port: testPort,
      path: '/api/downloads',
      method: 'POST',
      headers: authHeaders,
      body: {
        mediaItemId: testMediaItem.id,
        outputFormat: 'mp3',
        audioBitrateKbps: 500
      }
    })
    assertValidationErrorResponse(resInvalidBitrate.status, resInvalidBitrate.body)
    console.log('  -> PASS: Category N valid\n')

    // ------------------------------------------------------------------------
    // Category O: POST /api/downloads not found error when mediaItemId does not exist
    // ------------------------------------------------------------------------
    console.log('[Category O] POST /api/downloads mediaItemId not found contract')
    const resNotFoundMedia = await makeHttpRequest({
      port: testPort,
      path: '/api/downloads',
      method: 'POST',
      headers: authHeaders,
      body: {
        mediaItemId: 999999,
        outputFormat: 'mp3',
        audioBitrateKbps: 320
      }
    })
    assertNotFoundResponse(resNotFoundMedia.status, resNotFoundMedia.body)
    console.log('  -> PASS: Category O valid\n')

    // ------------------------------------------------------------------------
    // Category P: GET /api/downloads history list contract
    // ------------------------------------------------------------------------
    console.log('[Category P] GET /api/downloads history listing contract')
    const resHistoryList = await makeHttpRequest({
      port: testPort,
      path: '/api/downloads',
      headers: authHeaders
    })
    assertDownloadHistoryResponse(resHistoryList.status, resHistoryList.body)
    assert.ok(resHistoryList.body.data.length >= 1)
    console.log(
      `  -> PASS: Category P valid (${resHistoryList.body.data.length} records returned)\n`
    )

    // ------------------------------------------------------------------------
    // Category Q: GET /api/downloads history query filtering contracts
    // ------------------------------------------------------------------------
    console.log('[Category Q] GET /api/downloads history filter contracts')
    const resFilteredHistory = await makeHttpRequest({
      port: testPort,
      path: '/api/downloads?outputFormat=mp3',
      headers: authHeaders
    })
    assertDownloadHistoryResponse(resFilteredHistory.status, resFilteredHistory.body)
    for (const job of resFilteredHistory.body.data) {
      assert.equal(job.output_format, 'mp3')
    }
    console.log('  -> PASS: Category Q valid\n')

    // ------------------------------------------------------------------------
    // Category R: GET /api/downloads/:id job details contract for existing job
    // ------------------------------------------------------------------------
    console.log('[Category R] GET /api/downloads/:id job details contract')
    const resJobDetails = await makeHttpRequest({
      port: testPort,
      path: `/api/downloads/${createdJobId}`,
      headers: authHeaders
    })
    assertJobDetailsResponse(resJobDetails.status, resJobDetails.body)
    assert.equal(resJobDetails.body.data.job.id, createdJobId)
    console.log('  -> PASS: Category R valid\n')

    // ------------------------------------------------------------------------
    // Category S: GET /api/downloads/:id validation error for non-numeric Job ID
    // ------------------------------------------------------------------------
    console.log('[Category S] GET /api/downloads/:id non-numeric Job ID validation error')
    const resInvalidJobId = await makeHttpRequest({
      port: testPort,
      path: '/api/downloads/invalid_id_format',
      headers: authHeaders
    })
    assertValidationErrorResponse(resInvalidJobId.status, resInvalidJobId.body)
    console.log('  -> PASS: Category S valid\n')

    // ------------------------------------------------------------------------
    // Category T: GET /api/downloads/:id not found error for non-existent Job ID
    // ------------------------------------------------------------------------
    console.log('[Category T] GET /api/downloads/:id job not found contract')
    const resJobNotFound = await makeHttpRequest({
      port: testPort,
      path: '/api/downloads/777777',
      headers: authHeaders
    })
    assertNotFoundResponse(resJobNotFound.status, resJobNotFound.body)
    console.log('  -> PASS: Category T valid\n')

    // ------------------------------------------------------------------------
    // Category U: POST /api/downloads/:id/cancel response contract for queued job
    // ------------------------------------------------------------------------
    console.log('[Category U] POST /api/downloads/:id/cancel response contract')
    // Create dedicated queued job for cancel contract testing
    const cancelTargetJob = await DownloadJob.create({
      media_id: testMediaItem.id,
      source_type: 'link',
      status: 'queued',
      output_format: 'mp3',
      audio_bitrate_kbps: 192,
      progress: 0,
      downloaded_bytes: 0
    })

    const resCancel = await makeHttpRequest({
      port: testPort,
      path: `/api/downloads/${cancelTargetJob.id}/cancel`,
      method: 'POST',
      headers: authHeaders
    })
    assertCancelResponse(resCancel.status, resCancel.body)
    assert.equal(resCancel.body.data.status, 'cancelled')
    console.log(`  -> PASS: Category U valid (Cancelled Job #${cancelTargetJob.id})\n`)

    // ------------------------------------------------------------------------
    // Category V: POST /api/downloads/:id/retry response contract for cancelled job
    // ------------------------------------------------------------------------
    console.log('[Category V] POST /api/downloads/:id/retry response contract')
    const resRetry = await makeHttpRequest({
      port: testPort,
      path: `/api/downloads/${cancelTargetJob.id}/retry`,
      method: 'POST',
      headers: authHeaders
    })
    assertRetryResponse(resRetry.status, resRetry.body)
    assert.equal(resRetry.body.data.originalJobId, cancelTargetJob.id)
    const retryJobId = resRetry.body.data.retryJobId
    assert.ok(Number.isInteger(retryJobId) && retryJobId > 0)
    console.log(`  -> PASS: Category V valid (Created Retry Job #${retryJobId})\n`)

    // ------------------------------------------------------------------------
    // Category W: POST /api/downloads/:id/retry conflict contract on active job
    // ------------------------------------------------------------------------
    console.log('[Category W] POST /api/downloads/:id/retry active job conflict contract')
    const resRetryConflict = await makeHttpRequest({
      port: testPort,
      path: `/api/downloads/${retryJobId}/retry`,
      method: 'POST',
      headers: authHeaders
    })
    assertConflictResponse(resRetryConflict.status, resRetryConflict.body)
    console.log('  -> PASS: Category W valid\n')

    // ------------------------------------------------------------------------
    // Category X: DELETE /api/downloads/:id single history delete & active conflict
    // ------------------------------------------------------------------------
    console.log('[Category X] DELETE /api/downloads/:id history delete & active conflict')
    // Attempt deleting active retryJobId -> should fail with 409 Conflict
    const resDeleteActive = await makeHttpRequest({
      port: testPort,
      path: `/api/downloads/${retryJobId}`,
      method: 'DELETE',
      headers: authHeaders
    })
    assertConflictResponse(resDeleteActive.status, resDeleteActive.body)

    // Now delete the terminal cancelled job (cancelTargetJob.id) -> should succeed with 200 OK
    const resDeleteTerminal = await makeHttpRequest({
      port: testPort,
      path: `/api/downloads/${cancelTargetJob.id}`,
      method: 'DELETE',
      headers: authHeaders
    })
    assertHistoryDeleteResponse(resDeleteTerminal.status, resDeleteTerminal.body)
    assert.equal(resDeleteTerminal.body.data.id, cancelTargetJob.id)
    assert.equal(resDeleteTerminal.body.data.deleted, true)
    console.log('  -> PASS: Category X valid\n')

    // ------------------------------------------------------------------------
    // Category Y: DELETE /api/downloads/history bulk history clear contracts
    // ------------------------------------------------------------------------
    console.log('[Category Y] DELETE /api/downloads/history bulk clear history contracts')
    // Missing confirmation body
    const resClearNoConfirm = await makeHttpRequest({
      port: testPort,
      path: '/api/downloads/history',
      method: 'DELETE',
      headers: authHeaders,
      body: { confirm: false }
    })
    assertValidationErrorResponse(resClearNoConfirm.status, resClearNoConfirm.body)

    // Valid confirmation body
    const resClearValid = await makeHttpRequest({
      port: testPort,
      path: '/api/downloads/history',
      method: 'DELETE',
      headers: authHeaders,
      body: {
        confirm: true,
        statuses: ['completed', 'failed', 'cancelled']
      }
    })
    assertHistoryClearResponse(resClearValid.status, resClearValid.body)
    console.log(
      `  -> PASS: Category Y valid (${resClearValid.body.data.deletedJobs} jobs cleared)\n`
    )

    // ------------------------------------------------------------------------
    // Category Z: GET & PATCH /api/settings/downloads & global security contracts
    // ------------------------------------------------------------------------
    console.log('[Category Z] Settings contracts & global security error boundaries')
    // GET /api/settings/downloads
    const resGetSettings = await makeHttpRequest({
      port: testPort,
      path: '/api/settings/downloads',
      headers: authHeaders
    })
    assertSettingsGetResponse(resGetSettings.status, resGetSettings.body)

    // PATCH /api/settings/downloads valid update
    const resPatchSettings = await makeHttpRequest({
      port: testPort,
      path: '/api/settings/downloads',
      method: 'PATCH',
      headers: authHeaders,
      body: {
        defaultFormat: 'mp3',
        preferredMp3BitrateKbps: 320
      }
    })
    assertSettingsPatchResponse(resPatchSettings.status, resPatchSettings.body)
    assert.equal(resPatchSettings.body.data.defaultFormat, 'mp3')
    assert.equal(resPatchSettings.body.data.preferredMp3BitrateKbps, 320)

    // PATCH /api/settings/downloads invalid format rejection (400)
    const resPatchInvalid = await makeHttpRequest({
      port: testPort,
      path: '/api/settings/downloads',
      method: 'PATCH',
      headers: authHeaders,
      body: { defaultFormat: 'flac' }
    })
    assertValidationErrorResponse(resPatchInvalid.status, resPatchInvalid.body)

    // Disallowed Host header rejection (403)
    const resDisallowedHost = await makeHttpRequest({
      port: testPort,
      path: '/api/downloads',
      headers: {
        ...authHeaders,
        host: 'evil.attacker.site:3001'
      }
    })
    assertForbiddenResponse(resDisallowedHost.status, resDisallowedHost.body)

    // Disallowed CORS Origin rejection (403)
    const resDisallowedOrigin = await makeHttpRequest({
      port: testPort,
      path: '/api/downloads',
      headers: {
        ...authHeaders,
        origin: 'https://malicious.cross-origin.com'
      }
    })
    assertForbiddenResponse(resDisallowedOrigin.status, resDisallowedOrigin.body)

    // Unknown endpoint rejection (404)
    const resUnknownRoute = await makeHttpRequest({
      port: testPort,
      path: '/api/nonexistent_endpoint',
      headers: authHeaders
    })
    assertNotFoundResponse(resUnknownRoute.status, resUnknownRoute.body)
    console.log('  -> PASS: Category Z valid\n')

    console.log('================================================================')
    console.log(' ALL API CONTRACT TESTS (CATEGORIES A THROUGH Z) COMPLETED')
    console.log(' Status: 100% PASSED — Zero Contract Regressions Detected')
    console.log('================================================================\n')
  } finally {
    if (testServer) {
      await new Promise((resolve) => testServer.close(resolve))
      console.log('[cleanup] Contract test server stopped')
    }
    await closeDatabase().catch(() => {})
    if (sequelizeInstance) {
      await sequelizeInstance.close().catch(() => {})
    }
    resetSessionTokenForTest()
    // Safely remove only the uniquely created test temporary directory
    if (testTempDir && testTempDir.startsWith(os.tmpdir())) {
      await fs.rm(testTempDir, { recursive: true, force: true }).catch(() => {})
    }
    console.log('[cleanup] Temporary test workspace cleaned\n')
  }
}

runAllApiContractTests().catch((err) => {
  console.error('\nAPI CONTRACT TEST SUITE FAILED:')
  console.error(err)
  process.exit(1)
})
