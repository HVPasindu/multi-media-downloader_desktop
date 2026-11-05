import assert from 'node:assert/strict'
import path from 'node:path'
import {
  getDownloadSummary,
  listDownloadHistory
} from '../src/main/backend/services/downloadHistoryService.js'
import { createTestDatabase } from './helpers/testDatabase.js'
import { createApiApp } from '../src/main/backend/app.js'
import {
  initSessionToken,
  resetSessionTokenForTest,
  LOCAL_API_PORT
} from '../src/main/backend/services/localApiSecurityService.js'
import http from 'node:http'

function makeRequest({ port, path: reqPath, method = 'GET', token }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: reqPath,
        method,
        headers: {
          Host: `127.0.0.1:${LOCAL_API_PORT}`,
          Authorization: `Bearer ${token}`
        }
      },
      (res) => {
        let rawData = ''
        res.on('data', (chunk) => {
          rawData += chunk
        })
        res.on('end', () => {
          try {
            const body = JSON.parse(rawData)
            resolve({ status: res.statusCode, body })
          } catch {
            resolve({ status: res.statusCode, rawBody: rawData })
          }
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

async function runStep13Tests() {
  console.log('================================================================')
  console.log(' APPLAN2 — Step 13: Summary Metrics & Large Dataset (350+) Test')
  console.log('================================================================\n')

  const testDb = await createTestDatabase('applan2-step13-test-')
  console.log(`[setup] Isolated test database: ${testDb.databasePath}\n`)

  let server = null

  try {
    const { MediaItem, DownloadJob, DownloadFile } = testDb.sequelize.models

    // 1. Initialize API App and security token
    const token = initSessionToken()
    const app = createApiApp()
    server = http.createServer(app)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const serverPort = server.address().port

    console.log('--- 1. Testing GET /api/downloads/summary Endpoint Routing ---')
    const initialSummaryRes = await makeRequest({
      port: serverPort,
      path: '/api/downloads/summary',
      method: 'GET',
      token
    })

    assert.equal(initialSummaryRes.status, 200)
    assert.equal(initialSummaryRes.body.success, true)
    assert.ok(initialSummaryRes.body.data.downloads)
    assert.ok(initialSummaryRes.body.data.history)
    assert.equal(initialSummaryRes.body.data.downloads.total, 0)
    assert.equal(initialSummaryRes.body.data.history.totalFiles, 0)
    console.log('✓ Test 1: GET /api/downloads/summary route works and is not intercepted by :id')

    // 2. Seed a large dataset with 360 records
    console.log('\n--- 2. Seeding Large Dataset (360 Jobs) ---')
    const mediaVideo = await MediaItem.create({
      source_url: 'https://youtube.com/watch?v=large_video_dataset',
      platform: 'youtube',
      title: 'Large Video Dataset Presentation'
    })
    const mediaAudio = await MediaItem.create({
      source_url: 'https://soundcloud.com/large_audio_dataset',
      platform: 'soundcloud',
      title: 'Large Audio Dataset Concert'
    })

    // Breakdown:
    // 200 Completed MP4 videos (file_size = 5000 each -> total 1,000,000 bytes)
    // 100 Completed MP3 audios (file_size = 2000 each -> total 200,000 bytes)
    // 30 Failed MP4 videos
    // 15 Cancelled MP3 audios
    // 5 Downloading MP4 videos (active)
    // 5 Queued MP3 audios (active)
    // 5 Interrupted MP4 videos (active)
    // Total jobs: 360.
    // Total terminal history: 200 + 100 + 30 + 15 = 345 terminal jobs.
    // Total completed: 300.
    // Total failed + cancelled: 45.
    // Total storage: 1,200,000 bytes.

    const jobsToInsert = []
    const now = Date.now()

    // 200 Completed MP4
    for (let i = 1; i <= 200; i++) {
      jobsToInsert.push({
        media_id: mediaVideo.id,
        output_format: 'mp4',
        quality: '1080p',
        status: 'completed',
        progress: 100,
        createdAt: new Date(now - (400 - i) * 60000),
        fileSize: 5000,
        fileName: `video_comp_${i}.mp4`
      })
    }

    // 100 Completed MP3
    for (let i = 1; i <= 100; i++) {
      jobsToInsert.push({
        media_id: mediaAudio.id,
        output_format: 'mp3',
        audio_bitrate_kbps: 320,
        status: 'completed',
        progress: 100,
        createdAt: new Date(now - (200 - i) * 60000),
        fileSize: 2000,
        fileName: `audio_comp_${i}.mp3`
      })
    }

    // 30 Failed MP4
    for (let i = 1; i <= 30; i++) {
      jobsToInsert.push({
        media_id: mediaVideo.id,
        output_format: 'mp4',
        quality: '720p',
        status: 'failed',
        error_message: '[NETWORK_ERROR] Network timeout occurred',
        createdAt: new Date(now - (100 - i) * 60000)
      })
    }

    // 15 Cancelled MP3
    for (let i = 1; i <= 15; i++) {
      jobsToInsert.push({
        media_id: mediaAudio.id,
        output_format: 'mp3',
        audio_bitrate_kbps: 192,
        status: 'cancelled',
        createdAt: new Date(now - (50 - i) * 60000)
      })
    }

    // 5 Downloading MP4
    for (let i = 1; i <= 5; i++) {
      jobsToInsert.push({
        media_id: mediaVideo.id,
        output_format: 'mp4',
        quality: '1080p',
        status: 'downloading',
        progress: 50,
        createdAt: new Date(now - (20 - i) * 60000)
      })
    }

    // 5 Queued MP3
    for (let i = 1; i <= 5; i++) {
      jobsToInsert.push({
        media_id: mediaAudio.id,
        output_format: 'mp3',
        audio_bitrate_kbps: 128,
        status: 'queued',
        progress: 0,
        createdAt: new Date(now - (10 - i) * 60000)
      })
    }

    // 5 Interrupted MP4
    for (let i = 1; i <= 5; i++) {
      jobsToInsert.push({
        media_id: mediaVideo.id,
        output_format: 'mp4',
        quality: '720p',
        status: 'interrupted',
        progress: 75,
        createdAt: new Date(now - (5 - i) * 60000)
      })
    }

    assert.equal(jobsToInsert.length, 360)

    // Bulk create jobs
    const createdJobs = await DownloadJob.bulkCreate(
      jobsToInsert.map((j) => ({
        media_id: j.media_id,
        output_format: j.output_format,
        quality: j.quality,
        audio_bitrate_kbps: j.audio_bitrate_kbps,
        status: j.status,
        progress: j.progress,
        error_message: j.error_message,
        createdAt: j.createdAt
      }))
    )

    // Bulk create files for completed jobs
    const filesToInsert = []
    for (let i = 0; i < createdJobs.length; i++) {
      const def = jobsToInsert[i]
      if (def.status === 'completed' && def.fileSize) {
        filesToInsert.push({
          download_job_id: createdJobs[i].id,
          file_name: def.fileName,
          file_path: path.join(testDb.tempDir, def.fileName),
          file_format: def.output_format,
          file_size: def.fileSize
        })
      }
    }
    await DownloadFile.bulkCreate(filesToInsert)
    console.log(
      `✓ Seeded ${createdJobs.length} jobs and ${filesToInsert.length} files successfully`
    )

    // 3. Test getDownloadSummary() SQLite aggregates
    console.log('\n--- 3. Testing getDownloadSummary() SQLite Aggregates ---')
    const summary = await getDownloadSummary()

    // Validate downloads summary
    assert.equal(summary.downloads.total, 360)
    assert.equal(summary.downloads.downloading, 5)
    assert.equal(summary.downloads.queued, 5)
    assert.equal(summary.downloads.interrupted, 5)
    assert.equal(summary.downloads.completed, 300)
    assert.equal(summary.downloads.failed, 45) // 30 failed + 15 cancelled
    assert.equal(summary.downloads.cancelled, 15)

    // Validate history summary
    assert.equal(summary.history.totalFiles, 345) // 300 completed + 30 failed + 15 cancelled
    assert.equal(summary.history.videos, 230) // 200 comp + 30 failed
    assert.equal(summary.history.audio, 115) // 100 comp + 15 cancelled
    assert.equal(summary.history.completed, 300)
    assert.equal(summary.history.failed, 45)
    assert.equal(summary.history.storageBytes, 1200000)
    console.log(
      '✓ Test 3: getDownloadSummary() returns genuine aggregate calculations across 360 records'
    )

    // 4. Test API response for summary
    console.log('\n--- 4. Testing GET /api/downloads/summary HTTP Output ---')
    const apiSummaryRes = await makeRequest({
      port: serverPort,
      path: '/api/downloads/summary',
      method: 'GET',
      token
    })
    assert.equal(apiSummaryRes.status, 200)
    assert.deepEqual(apiSummaryRes.body.data, summary)
    console.log('✓ Test 4: API returns identical aggregate summary via HTTP')

    // 5. Test Pagination across 350+ records
    console.log('\n--- 5. Testing Server-Side Pagination Across 360 Records ---')
    // Page 1: limit 20, offset 0
    const page1 = await listDownloadHistory({ limit: 20, offset: 0 })
    assert.equal(page1.jobs.length, 20)
    assert.equal(page1.pagination.total, 360)
    assert.equal(page1.pagination.limit, 20)
    assert.equal(page1.pagination.offset, 0)

    // Page 2: limit 20, offset 20
    const page2 = await listDownloadHistory({ limit: 20, offset: 20 })
    assert.equal(page2.jobs.length, 20)
    assert.equal(page2.pagination.total, 360)
    assert.equal(page2.pagination.offset, 20)

    // Last Page: limit 20, offset 340 (records 341-360)
    const lastPage = await listDownloadHistory({ limit: 20, offset: 340 })
    assert.equal(lastPage.jobs.length, 20)
    assert.equal(lastPage.pagination.total, 360)
    assert.equal(lastPage.pagination.offset, 340)

    // Page beyond total: limit 20, offset 360 -> empty jobs list
    const beyondPage = await listDownloadHistory({ limit: 20, offset: 360 })
    assert.equal(beyondPage.jobs.length, 0)
    assert.equal(beyondPage.pagination.total, 360)
    console.log(
      '✓ Test 5: Server-side pagination safely handles first, middle, last, and beyond pages'
    )

    // 6. Test Terminal Status Filtering (History Page scenario)
    console.log('\n--- 6. Testing Terminal Status Filtering for History Page ---')
    const historyTerminalPage = await listDownloadHistory({
      statuses: ['completed', 'failed', 'cancelled'],
      limit: 50,
      offset: 0
    })
    assert.equal(historyTerminalPage.jobs.length, 50)
    assert.equal(historyTerminalPage.pagination.total, 345) // only terminal jobs
    assert.ok(
      historyTerminalPage.jobs.every((j) => ['completed', 'failed', 'cancelled'].includes(j.status))
    )
    console.log('✓ Test 6: Terminal status filtering excludes all 15 active jobs accurately')

    // 7. Test Search Across Large Dataset
    console.log('\n--- 7. Testing Search Query Across Large Dataset ---')
    const searchVideo = await listDownloadHistory({
      search: 'Large Video Dataset',
      limit: 20,
      offset: 0
    })
    // Video jobs: 200 comp + 30 failed + 5 downloading + 5 interrupted = 240
    assert.equal(searchVideo.pagination.total, 240)
    assert.equal(searchVideo.jobs.length, 20)
    assert.ok(searchVideo.jobs.every((j) => j.media?.title.includes('Large Video Dataset')))
    console.log('✓ Test 7: Search accurately filters entire 360 record dataset before pagination')

    console.log('\n================================================================')
    console.log(' APPLAN2 — Step 13 Tests 100% PASSED')
    console.log('================================================================')
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve))
    }
    resetSessionTokenForTest()
    await testDb.cleanup()
  }
}

runStep13Tests().catch((err) => {
  console.error('\n❌ Step 13 Test Failed:', err)
  process.exit(1)
})
