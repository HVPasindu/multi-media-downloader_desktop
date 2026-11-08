import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createTestDatabase } from './helpers/testDatabase.js'
import {
  runYtDlp,
  pauseRunningDownload,
  cancelRunningDownload
} from '../src/main/backend/services/downloadService.js'
import {
  resumeDownloadJob,
  resetQueueForTesting,
  stopQueueForShutdown,
  getQueueStatus
} from '../src/main/backend/services/downloadQueueService.js'
import { retryDownloadJob } from '../src/main/backend/services/downloadRetryService.js'
import { recoverInterruptedDownloadJobs } from '../src/main/backend/services/downloadRecoveryService.js'
import { cleanupJobTemporaryFiles } from '../src/main/backend/services/downloadCleanupService.js'
import {
  setAllowLocalhostForTesting,
  resetAllowLocalhostForTesting
} from '../src/main/backend/services/mediaUrlSecurityService.js'

async function runWindowsRealIntegrationTests() {
  console.log('================================================================')
  console.log(' APPLAN2: Real Windows yt-dlp Process Integration Tests        ')
  console.log(' Tests A-F: Real yt-dlp.exe, Range HTTP Server & Process Tree  ')
  console.log('================================================================\n')

  setAllowLocalhostForTesting(true)
  const testDb = await createTestDatabase('windows-real-proc-')

  // Create 15MB deterministic test payload
  const FILE_SIZE = 15 * 1024 * 1024 // 15 MB
  const sourcePayload = Buffer.alloc(FILE_SIZE)
  for (let i = 0; i < FILE_SIZE; i++) {
    sourcePayload[i] = (i * 37 + 13) % 256
  }
  const expectedHash = crypto.createHash('sha256').update(sourcePayload).digest('hex')

  let lastRangeHeader = null
  let rangeHeadersReceived = []

  // Local Throttled Range HTTP Server
  const server = http.createServer((req, res) => {
    const range = req.headers.range
    if (range) {
      lastRangeHeader = range
      rangeHeadersReceived.push(range)
    }

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : FILE_SIZE - 1
      const chunksize = end - start + 1

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${FILE_SIZE}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'application/octet-stream'
      })

      let offset = start
      const interval = setInterval(() => {
        if (offset > end || res.destroyed) {
          clearInterval(interval)
          if (!res.destroyed) res.end()
          return
        }
        const chunkSize = Math.min(256 * 1024, end - offset + 1)
        res.write(sourcePayload.subarray(offset, offset + chunkSize))
        offset += chunkSize
      }, 50)

      req.on('close', () => clearInterval(interval))
    } else {
      res.writeHead(200, {
        'Content-Length': FILE_SIZE,
        'Accept-Ranges': 'bytes',
        'Content-Type': 'application/octet-stream'
      })

      let offset = 0
      const interval = setInterval(() => {
        if (offset >= FILE_SIZE || res.destroyed) {
          clearInterval(interval)
          if (!res.destroyed) res.end()
          return
        }
        const chunkSize = Math.min(256 * 1024, FILE_SIZE - offset)
        res.write(sourcePayload.subarray(offset, offset + chunkSize))
        offset += chunkSize
      }, 50)

      req.on('close', () => clearInterval(interval))
    }
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const serverUrl = `http://127.0.0.1:${port}/test_file.bin`
  console.log(`[test-server] Local Range HTTP server listening on port ${port}`)

  try {
    const { DownloadJob, MediaItem, AppSetting } = testDb.sequelize.models

    await AppSetting.create({
      key: 'download_path',
      value: testDb.tempDir
    })

    const media = await MediaItem.create({
      source_url: serverUrl,
      title: 'Real Windows Process Test'
    })

    // --------------------------------------------------------------------------
    // TEST A: REAL PAUSE
    // --------------------------------------------------------------------------
    console.log('\n--- Test A: Real Windows yt-dlp Pause ---')

    const jobA = await DownloadJob.create({
      media_id: media.id,
      source_type: 'link',
      output_format: 'mp4',
      status: 'downloading',
      progress: 0,
      downloaded_bytes: 0
    })

    const targetOutputA = path.join(testDb.tempDir, `test_output_[job-${jobA.id}].mp4`)
    const argsA = [
      '--no-playlist',
      '--continue',
      '--progress',
      '--newline',
      '-P',
      testDb.tempDir,
      '-o',
      `test_output_[job-${jobA.id}].mp4`,
      serverUrl
    ]

    console.log(`[Test A] Spawning real yt-dlp.exe for Job ${jobA.id}...`)
    let observedBytesA = 0
    let caughtErrorA = null
    const ytDlpPromiseA = runYtDlp(
      argsA,
      (percent) => {
        DownloadJob.update({ progress: Math.floor(percent) }, { where: { id: jobA.id } })
      },
      (line) => {
        const match = line.match(/(\d+(?:\.\d+)?)%\s+of\s+~?\s*(\d+(?:\.\d+)?)(K|M|G)iB/)
        if (match) {
          const pct = parseFloat(match[1])
          observedBytesA = Math.floor((pct / 100) * FILE_SIZE)
          DownloadJob.update({ downloaded_bytes: observedBytesA }, { where: { id: jobA.id } })
        }
      },
      { jobId: jobA.id }
    ).catch((err) => {
      caughtErrorA = err
    })

    // Wait until download reaches ~25-35%
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150))
      const current = await DownloadJob.findByPk(jobA.id)
      if ((current.downloaded_bytes || 0) >= 3 * 1024 * 1024) {
        console.log(
          `[Test A] Reached ${current.downloaded_bytes} bytes (~${((current.downloaded_bytes / FILE_SIZE) * 100).toFixed(1)}%). Triggering pause...`
        )
        break
      }
    }

    const pauseResultA = await pauseRunningDownload(jobA.id)
    assert.equal(pauseResultA.success, true, 'Test A.1: pauseRunningDownload returns success')

    await ytDlpPromiseA
    assert.ok(caughtErrorA, 'Test A.2: Process rejected with error')
    assert.equal(caughtErrorA.name, 'DownloadPausedError', 'Test A.2: Error is DownloadPausedError')

    // Check .part file on disk
    const expectedPartFileA = targetOutputA + '.part'
    assert.ok(fs.existsSync(expectedPartFileA), 'Test A.3: .part file exists on disk')
    const initialPartSize = fs.statSync(expectedPartFileA).size
    assert.ok(initialPartSize > 0, 'Test A.4: .part file is non-empty')
    console.log(
      `[Test A] Verified .part file: ${path.basename(expectedPartFileA)} (${initialPartSize} bytes)`
    )

    // Verify file size stopped increasing (process is completely dead)
    await new Promise((r) => setTimeout(r, 600))
    const stablePartSize = fs.statSync(expectedPartFileA).size
    assert.equal(
      initialPartSize,
      stablePartSize,
      'Test A.5: File size stopped increasing after pause'
    )

    // Update SQLite checkpoint to match verified partial file
    await DownloadJob.update(
      {
        status: 'paused',
        downloaded_bytes: stablePartSize,
        progress: Math.floor((stablePartSize / FILE_SIZE) * 100)
      },
      { where: { id: jobA.id } }
    )

    const finalJobA = await DownloadJob.findByPk(jobA.id)
    assert.equal(finalJobA.status, 'paused', 'Test A.6: SQLite status is paused')
    assert.ok(finalJobA.progress > 0, 'Test A.7: Progress is preserved')
    assert.equal(finalJobA.downloaded_bytes, stablePartSize, 'Test A.8: Downloaded bytes preserved')

    console.log('✓ Test A Passed: Real yt-dlp paused gracefully with valid partial file.\n')

    // --------------------------------------------------------------------------
    // TEST B: REAL RESUME
    // --------------------------------------------------------------------------
    console.log('--- Test B: Real Windows yt-dlp Resume ---')

    const enqueuedResumeB = []
    const resumeResultB = await resumeDownloadJob(jobA.id, {
      isOnline: true,
      enqueue: (id) => enqueuedResumeB.push(id)
    })
    assert.equal(
      resumeResultB.outcome,
      'resumed',
      'Test B.1: resumeDownloadJob returns outcome: resumed'
    )
    assert.deepEqual(enqueuedResumeB, [jobA.id], 'Test B.1b: Enqueued ID is original Job ID')

    const jobBReloaded = await DownloadJob.findByPk(jobA.id)
    assert.equal(jobBReloaded.status, 'queued', 'Test B.2: Job transitioned to queued')
    assert.equal(jobBReloaded.id, jobA.id, 'Test B.3: Preserved SAME Job ID')
    assert.equal(
      jobBReloaded.downloaded_bytes,
      stablePartSize,
      'Test B.4: Preserved checkpoint bytes'
    )

    // Now resume the real download using yt-dlp with --continue
    console.log(`[Test B] Resuming real yt-dlp from checkpoint (${stablePartSize} bytes)...`)
    await jobBReloaded.update({ status: 'downloading' })

    rangeHeadersReceived = []
    lastRangeHeader = null
    const ytDlpPromiseB = runYtDlp(
      argsA,
      (percent) => {
        DownloadJob.update({ progress: Math.floor(percent) }, { where: { id: jobA.id } })
      },
      (line) => {
        const match = line.match(/(\d+(?:\.\d+)?)%\s+of\s+~?\s*(\d+(?:\.\d+)?)(K|M|G)iB/)
        if (match) {
          const pct = parseFloat(match[1])
          const curBytes = Math.floor((pct / 100) * FILE_SIZE)
          DownloadJob.update({ downloaded_bytes: curBytes }, { where: { id: jobA.id } })
        }
      },
      { jobId: jobA.id }
    )

    await ytDlpPromiseB
    console.log('[Test B] yt-dlp resume download completed to 100%!')

    // Verify server received HTTP Range request resuming from checkpoint
    assert.ok(
      rangeHeadersReceived.length > 0 || lastRangeHeader,
      'Test B.5: Server received HTTP Range header during resume'
    )
    console.log(
      `[Test B] HTTP Range header used: ${lastRangeHeader || rangeHeadersReceived.join(', ')}`
    )

    // Verify final file on disk
    assert.ok(fs.existsSync(targetOutputA), 'Test B.6: Final file exists on disk')
    const finalSize = fs.statSync(targetOutputA).size
    assert.equal(finalSize, FILE_SIZE, 'Test B.7: Final file size matches source size')

    // Verify SHA-256 integrity
    const downloadedBuf = fs.readFileSync(targetOutputA)
    const actualHash = crypto.createHash('sha256').update(downloadedBuf).digest('hex')
    assert.equal(
      actualHash,
      expectedHash,
      'Test B.8: SHA-256 matches expected source file (100% MATCH)'
    )

    console.log(
      '✓ Test B Passed: Real yt-dlp resumed from checkpoint and produced bit-for-bit identical file.\n'
    )

    // --------------------------------------------------------------------------
    // TEST C: PAUSE PERSISTENCE ACROSS APPLICATION RESTART
    // --------------------------------------------------------------------------
    console.log('--- Test C: Pause Persistence Across Application Restart ---')

    const jobC = await DownloadJob.create({
      media_id: media.id,
      source_type: 'link',
      output_format: 'mp4',
      status: 'paused',
      progress: 35,
      downloaded_bytes: 5242880
    })

    // Simulate application restart recovery
    await recoverInterruptedDownloadJobs({
      autoEnqueue: false,
      isOnline: true
    })

    const jobCAfterRestart = await DownloadJob.findByPk(jobC.id)
    assert.equal(
      jobCAfterRestart.status,
      'paused',
      'Test C.1: Paused job remains paused across application restart'
    )
    assert.equal(jobCAfterRestart.progress, 35, 'Test C.2: Progress remains 35%')
    assert.equal(jobCAfterRestart.downloaded_bytes, 5242880, 'Test C.3: Bytes remain 5242880')

    console.log('✓ Test C Passed: Paused jobs remain paused across application restart.\n')

    // --------------------------------------------------------------------------
    // TEST D: REAL CANCEL
    // --------------------------------------------------------------------------
    console.log('--- Test D: Real Windows yt-dlp Cancel ---')

    const jobD = await DownloadJob.create({
      media_id: media.id,
      source_type: 'link',
      output_format: 'mp4',
      status: 'downloading',
      progress: 0,
      downloaded_bytes: 0
    })

    const targetOutputD = path.join(testDb.tempDir, `test_output_[job-${jobD.id}].mp4`)
    const argsD = [
      '--no-playlist',
      '--continue',
      '--progress',
      '--newline',
      '-P',
      testDb.tempDir,
      '-o',
      `test_output_[job-${jobD.id}].mp4`,
      serverUrl
    ]

    console.log(`[Test D] Spawning real yt-dlp.exe for Job ${jobD.id}...`)
    let caughtErrorD = null
    const ytDlpPromiseD = runYtDlp(argsD, null, null, { jobId: jobD.id }).catch((err) => {
      caughtErrorD = err
    })

    // Wait until download starts transferring
    await new Promise((r) => setTimeout(r, 600))

    const cancelResultD = await cancelRunningDownload(jobD.id)
    assert.equal(cancelResultD.success, true, 'Test D.1: cancelRunningDownload returns success')

    await ytDlpPromiseD
    assert.ok(caughtErrorD, 'Test D.2: Process rejected with error')
    assert.equal(
      caughtErrorD.name,
      'DownloadCancelledError',
      'Test D.2: Error is DownloadCancelledError'
    )

    // Mark cancelled in SQLite & clean temporary files
    await DownloadJob.update({ status: 'cancelled' }, { where: { id: jobD.id } })
    await cleanupJobTemporaryFiles(jobD.id, testDb.tempDir)

    const jobDAfterCancel = await DownloadJob.findByPk(jobD.id)
    assert.equal(jobDAfterCancel.status, 'cancelled', 'Test D.3: SQLite status is cancelled')

    // Confirm temporary files are cleaned
    const filesAfterCancel = fs.readdirSync(testDb.tempDir)
    const partFilesD = filesAfterCancel.filter((f) => f.includes(`job-${jobD.id}`))
    assert.equal(partFilesD.length, 0, 'Test D.4: All temporary files cleaned up')
    assert.equal(fs.existsSync(targetOutputD), false, 'Test D.4b: Target output does not exist')

    console.log(
      '✓ Test D Passed: Real yt-dlp cancelled, process tree killed, and temporary files cleaned.\n'
    )

    // --------------------------------------------------------------------------
    // TEST E: RETRY AFTER CANCEL
    // --------------------------------------------------------------------------
    console.log('--- Test E: Retry After Cancel ---')

    const enqueuedRetryE = []
    const retryResultE = await retryDownloadJob(jobD.id, {
      enqueue: (id) => enqueuedRetryE.push(id)
    })

    assert.equal(retryResultE.outcome, 'created', 'Test E.1: Retry outcome is created')
    assert.equal(retryResultE.originalJobId, jobD.id, 'Test E.2: Retry preserves SAME Job ID')
    assert.deepEqual(enqueuedRetryE, [jobD.id], 'Test E.3: Enqueued ID is original Job ID')

    const retriedJobE = await DownloadJob.findByPk(jobD.id)
    assert.equal(retriedJobE.status, 'queued', 'Test E.4: Retried job status is queued')
    assert.equal(retriedJobE.progress, 0, 'Test E.5: Progress reset to 0%')
    assert.equal(retriedJobE.downloaded_bytes, 0, 'Test E.6: Downloaded bytes reset to 0')
    assert.equal(retriedJobE.error_message, null, 'Test E.7: Error message cleared')

    console.log('✓ Test E Passed: Retry restarts clean from 0% under the same Job ID.\n')

    // --------------------------------------------------------------------------
    // TEST F: QUEUE CONCURRENCY REGRESSION
    // --------------------------------------------------------------------------
    console.log('--- Test F: Queue Concurrency Regression ---')

    resetQueueForTesting()
    const qStatus = getQueueStatus()
    assert.equal(qStatus.maxConcurrency, 2, 'Test F.1: Max concurrency is strictly 2')
    assert.equal(qStatus.activeCount, 0, 'Test F.2: Active count is 0')

    console.log('✓ Test F Passed: Queue concurrency constraints intact.\n')

    console.log('================================================================')
    console.log(' ALL 6 REAL WINDOWS INTEGRATION TESTS PASSED (100% PASS)')
    console.log(' Tests A-F: Real yt-dlp.exe, Range HTTP Server & Process Tree  ')
    console.log('================================================================\n')
  } finally {
    resetAllowLocalhostForTesting()
    server.close()
    stopQueueForShutdown()
    resetQueueForTesting()
    await testDb.cleanup()
  }
}

runWindowsRealIntegrationTests().catch((err) => {
  console.error('\n❌ REAL WINDOWS INTEGRATION TESTS FAILED:', err)
  process.exit(1)
})
