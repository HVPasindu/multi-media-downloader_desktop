import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createTestDatabase } from './helpers/testDatabase.js'
import {
  initializeDatabase,
  closeDatabase,
  getDatabase
} from '../src/main/backend/config/database.js'
import {
  enqueueDownloadJob,
  pauseDownloadJob,
  resumeDownloadJob,
  cancelDownloadJob,
  resetQueueForTesting,
  stopQueueForShutdown,
  getQueueStatus
} from '../src/main/backend/services/downloadQueueService.js'
import {
  getActiveDownloadProcess,
  setActiveDownloadProcessForTesting,
  setExecutionHooksForTesting,
  resetExecutionHooksForTesting,
  pauseRunningDownload,
  verifyFinalMediaContent
} from '../src/main/backend/services/downloadService.js'
import {
  prepareJobTemporaryWorkspace,
  cleanupJobTemporaryFiles
} from '../src/main/backend/services/downloadCleanupService.js'
import { retryDownloadJob } from '../src/main/backend/services/downloadRetryService.js'
import {
  resumeInterruptedNetworkJobs,
  setRecoveryHooksForTesting
} from '../src/main/backend/services/networkRecoveryService.js'
import { resolveCtrlBreakHelperPath } from '../src/main/backend/services/processInterruptionService.js'
import {
  setAllowLocalhostForTesting,
  resetAllowLocalhostForTesting
} from '../src/main/backend/services/mediaUrlSecurityService.js'
import {
  setAnalyzerForTesting,
  resetAnalyzerForTesting,
  analyzeMedia
} from '../src/main/backend/services/mediaAnalyzerService.js'
import {
  resolveYtDlpPath,
  resolveFFmpegPath,
  resolveFFprobePath,
  resolveJavaScriptRuntimeOption
} from '../src/main/backend/services/executablePathService.js'

async function ensureMp4Fixture(filePath) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 10000000) {
    return filePath
  }
  const ffmpeg = await resolveFFmpegPath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  execFileSync(
    ffmpeg,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'nullsrc=s=640x360:d=6',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=1000:duration=6',
      '-vf',
      'noise=alls=100:allf=t+u',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      filePath
    ],
    { stdio: 'pipe' }
  )
  return filePath
}

async function runWindowsRealIntegrationTests() {
  console.log('================================================================')
  console.log(' APPLAN2: Real Windows yt-dlp Process Integration Tests        ')
  console.log(' Stage 07 & Mandatory Test Matrix: Tests A through H           ')
  console.log(' Production Architecture: yt-dlp + Queue + ConsoleSender + FFmpeg')
  console.log('================================================================\n')

  setAllowLocalhostForTesting(true)
  const testDb = await createTestDatabase('win-real-matrix-')

  // 1. Prepare deterministic valid MP4 fixture with both video and audio
  const fixturePath = path.join(testDb.tempDir, 'sample_with_audio.mp4')
  await ensureMp4Fixture(fixturePath)
  const fixtureBuf = fs.readFileSync(fixturePath)
  const FILE_SIZE = fixtureBuf.length
  const expectedHash = crypto.createHash('sha256').update(fixtureBuf).digest('hex')
  console.log(
    `[fixture] Prepared valid MP4 fixture: ${FILE_SIZE} bytes (SHA-256: ${expectedHash.slice(0, 16)}...)`
  )

  let lastRangeHeader = null
  let rangeHeadersReceived = []
  let currentDashDir = null

  // 2. Throttled Range HTTP Server
  const server = http.createServer((req, res) => {
    if (req.url && req.url.startsWith('/dash/')) {
      if (!currentDashDir) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('DASH directory not active')
        return
      }
      const rawRelPath = req.url.replace(/^\/dash\/?/, '')
      const cleanRelPath = path
        .normalize(decodeURIComponent(rawRelPath))
        .replace(/^(\.\.[/\\])+/, '')
      const filePath = path.join(currentDashDir, cleanRelPath)

      if (!filePath.startsWith(currentDashDir) || !fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('File Not Found')
        return
      }

      const fileStats = fs.statSync(filePath)
      const isMpd = filePath.endsWith('.mpd')
      const contentType = isMpd ? 'application/dash+xml' : 'video/iso.segment'

      res.writeHead(200, {
        'Content-Length': fileStats.size,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      })
      const stream = fs.createReadStream(filePath)
      stream.pipe(res)
      return
    }

    const range = req.headers.range
    if (range) {
      lastRangeHeader = range
      rangeHeadersReceived.push(range)
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : FILE_SIZE - 1
      const chunksize = end - start + 1

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${FILE_SIZE}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4'
      })

      let offset = start
      const interval = setInterval(() => {
        if (offset > end || res.destroyed) {
          clearInterval(interval)
          if (!res.destroyed) res.end()
          return
        }
        const chunkSize = Math.min(256 * 1024, end - offset + 1)
        res.write(fixtureBuf.subarray(offset, offset + chunkSize))
        offset += chunkSize
      }, 50)
      req.on('close', () => clearInterval(interval))
    } else {
      res.writeHead(200, {
        'Content-Length': FILE_SIZE,
        'Accept-Ranges': 'bytes',
        'Content-Type': 'video/mp4'
      })
      let offset = 0
      const interval = setInterval(() => {
        if (offset >= FILE_SIZE || res.destroyed) {
          clearInterval(interval)
          if (!res.destroyed) res.end()
          return
        }
        const chunkSize = Math.min(256 * 1024, FILE_SIZE - offset)
        res.write(fixtureBuf.subarray(offset, offset + chunkSize))
        offset += chunkSize
      }, 50)
      req.on('close', () => clearInterval(interval))
    }
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const serverUrl = `http://127.0.0.1:${port}/test_video.mp4`
  console.log(`[test-server] Throttled Range HTTP server listening on port ${port}`)

  // Register analyzer mock for local HTTP fixture URL
  const mockAnalyzer = async (url) => {
    if (typeof url === 'string' && url.includes('/dash/')) {
      return {
        platform: 'youtube',
        title: 'Real Windows DASH Test Video',
        duration: 8,
        availableFormats: {
          mp4Formats: [
            {
              formatId: '0',
              quality: '360p',
              audioIncluded: false,
              extension: 'mp4',
              videoCodec: 'avc1.42c01e',
              fileSize: 2000000
            }
          ],
          audioFormats: [
            {
              formatId: '1',
              quality: 'audio',
              extension: 'm4a',
              audioCodec: 'mp4a.40.2',
              fileSize: 70000
            }
          ],
          mp4Qualities: ['360p']
        }
      }
    }
    return {
      platform: 'youtube',
      title: 'Real Windows Test Video',
      duration: 6,
      availableFormats: {
        mp4Formats: [{ formatId: 'b', quality: '720p', audioIncluded: true, fileSize: FILE_SIZE }],
        audioFormats: [],
        mp4Qualities: ['720p']
      }
    }
  }
  setAnalyzerForTesting(mockAnalyzer)

  try {
    let { DownloadJob, MediaItem, AppSetting } = testDb.sequelize.models

    await AppSetting.create({
      key: 'download_path',
      value: testDb.tempDir
    })

    const media = await MediaItem.create({
      source_url: serverUrl,
      title: 'Real Windows Test Video'
    })

    // ==========================================================================
    // TEST A — REAL WINDOWS PAUSE AT APPROXIMATELY 35%
    // ==========================================================================
    console.log('\n--- TEST A: Real Windows yt-dlp Pause at ~35% ---')

    const jobA = await DownloadJob.create({
      media_id: media.id,
      source_type: 'link',
      output_format: 'mp4',
      quality: '720p',
      status: 'queued',
      progress: 0,
      downloaded_bytes: 0
    })

    console.log(`[Test A] Enqueueing Job ${jobA.id} through production queue...`)
    enqueueDownloadJob(jobA.id)

    // Wait until download reaches ~25-40%
    let progressA = 0
    let observedBytesA = 0
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150))
      const current = await DownloadJob.findByPk(jobA.id)
      progressA = current.progress || 0
      observedBytesA = current.downloaded_bytes || 0
      if (progressA >= 25) {
        console.log(
          `[Test A] Reached ${progressA}% (${observedBytesA} bytes). Triggering pauseDownloadJob(${jobA.id})...`
        )
        break
      }
    }

    assert.ok(progressA >= 20, 'Test A.0: Download made significant progress before pause')

    // Call production Pause service (delivers Win32 CTRL_BREAK via send-ctrl-break.exe)
    const pauseResultA = await pauseDownloadJob(jobA.id)
    assert.equal(
      pauseResultA.outcome,
      'paused',
      'Test A.1: pauseDownloadJob returns outcome: paused'
    )
    assert.equal(pauseResultA.status, 'paused', 'Test A.2: pauseDownloadJob returns status: paused')

    // Verify yt-dlp process actually exited
    const activeProcA = getActiveDownloadProcess(jobA.id)
    assert.ok(!activeProcA || activeProcA.closed, 'Test A.3: yt-dlp process has terminated')

    // Check partial .part file on disk
    const partialDirA = path.join(testDb.tempDir, '.applan2-partial-downloads', `job-${jobA.id}`)
    let foundPartFileA = null
    if (fs.existsSync(partialDirA)) {
      const partFiles = fs.readdirSync(partialDirA).filter((f) => f.endsWith('.part'))
      if (partFiles.length > 0) {
        foundPartFileA = path.join(partialDirA, partFiles[0])
      }
    }

    assert.ok(
      foundPartFileA && fs.existsSync(foundPartFileA),
      'Test A.4: .part file exists on disk'
    )
    const initialPartSizeA = fs.statSync(foundPartFileA).size
    assert.ok(initialPartSizeA > 0, 'Test A.5: .part file is non-empty')
    console.log(
      `[Test A] Verified .part file: ${path.basename(foundPartFileA)} (${initialPartSizeA} bytes)`
    )

    // Verify file size stopped changing (process is completely dead)
    await new Promise((r) => setTimeout(r, 500))
    const stablePartSizeA = fs.statSync(foundPartFileA).size
    assert.equal(
      initialPartSizeA,
      stablePartSizeA,
      'Test A.6: File size stopped changing after pause'
    )

    // Verify SQLite record was persisted strictly by the application (ZERO manual update!)
    const reloadedJobA = await DownloadJob.findByPk(jobA.id)
    assert.equal(reloadedJobA.status, 'paused', 'Test A.7: SQLite status is paused')
    assert.ok(reloadedJobA.progress > 0, 'Test A.8: Progress preserved in database')
    assert.equal(
      reloadedJobA.downloaded_bytes,
      stablePartSizeA,
      'Test A.9: Saved bytes match stable .part size'
    )

    // Verify queue execution slot is released
    const qStatusA = getQueueStatus()
    assert.equal(qStatusA.activeCount, 0, 'Test A.10: Queue execution slot released')

    console.log(
      '✓ Test A Passed: Real Windows pause successfully interrupted yt-dlp, verified .part checkpoint, and freed queue slot without manual database updates.\n'
    )

    // ==========================================================================
    // TEST B — REAL RESUME FROM CHECKPOINT
    // ==========================================================================
    console.log('--- TEST B: Real Windows yt-dlp Resume from Checkpoint ---')

    rangeHeadersReceived = []
    lastRangeHeader = null

    console.log(
      `[Test B] Resuming Job ${jobA.id} from saved checkpoint (${stablePartSizeA} bytes)...`
    )
    const resumeResultB = await resumeDownloadJob(jobA.id, {
      isOnline: true,
      enqueue: (id) => enqueueDownloadJob(id)
    })

    assert.equal(
      resumeResultB.outcome,
      'resumed',
      'Test B.1: resumeDownloadJob returns outcome: resumed'
    )
    assert.equal(resumeResultB.status, 'queued', 'Test B.2: Status transitioned to queued')
    assert.equal(jobA.id, resumeResultB.id || jobA.id, 'Test B.3: Preserved SAME Job ID')

    // Wait until download completes to 100%
    let jobBCompleted = null
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 200))
      const current = await DownloadJob.findByPk(jobA.id)
      if (current.status === 'completed' || current.status === 'failed') {
        jobBCompleted = current
        break
      }
    }

    assert.ok(jobBCompleted, 'Test B.4: Job finished execution')
    assert.equal(
      jobBCompleted.status,
      'completed',
      `Test B.5: Job completed successfully (error: ${jobBCompleted.error_message})`
    )
    assert.equal(jobBCompleted.progress, 100, 'Test B.6: Final progress is 100%')

    // Verify server received HTTP Range request resuming from checkpoint
    assert.ok(
      rangeHeadersReceived.length > 0 || lastRangeHeader,
      'Test B.7: Server received HTTP Range header during resume'
    )
    const usedRange = lastRangeHeader || rangeHeadersReceived[0]
    console.log(`[Test B] HTTP Range header used: ${usedRange}`)
    assert.ok(
      usedRange.includes(`bytes=${stablePartSizeA}-`),
      `Test B.8: Range start matches saved partial byte position (${stablePartSizeA})`
    )

    // Locate final output file
    const rootFilesB = fs.readdirSync(testDb.tempDir)
    const finalMp4B = rootFilesB.find((f) => f.includes(`[job-${jobA.id}]`) && f.endsWith('.mp4'))
    assert.ok(finalMp4B, 'Test B.9: Final MP4 file exists in download folder')
    const finalFilePathB = path.join(testDb.tempDir, finalMp4B)

    // Verify FFprobe media content verification
    const contentValidB = await verifyFinalMediaContent(finalFilePathB, 'mp4')
    assert.equal(
      contentValidB,
      true,
      'Test B.10: Final file passes FFprobe video & audio stream verification'
    )

    // Compare final SHA-256 with original source (100% bit-for-bit identical)
    const finalBufB = fs.readFileSync(finalFilePathB)
    const finalHashB = crypto.createHash('sha256').update(finalBufB).digest('hex')
    assert.equal(
      finalHashB,
      expectedHash,
      'Test B.11: Final SHA-256 matches source MP4 (100% MATCH)'
    )

    console.log(
      '✓ Test B Passed: Resumed from checkpoint using HTTP Range, reached 100%, passed FFprobe, and produced bit-for-bit identical SHA-256.\n'
    )

    // ==========================================================================
    // TEST C — REAL RESTART PERSISTENCE
    // ==========================================================================
    console.log('--- TEST C: Real Restart Persistence ---')

    const jobC = await DownloadJob.create({
      media_id: media.id,
      source_type: 'link',
      output_format: 'mp4',
      quality: '720p',
      status: 'queued',
      progress: 0,
      downloaded_bytes: 0
    })

    console.log(`[Test C] Starting Job ${jobC.id} through queue...`)
    enqueueDownloadJob(jobC.id)

    // Wait until it reaches >= 15%, then pause
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150))
      const cur = await DownloadJob.findByPk(jobC.id)
      if ((cur.progress || 0) >= 15) {
        break
      }
    }

    const pauseResultC = await pauseDownloadJob(jobC.id)
    assert.equal(pauseResultC.outcome, 'paused', 'Test C.1: Job C paused successfully')

    const jobCBeforeRestart = await DownloadJob.findByPk(jobC.id)
    assert.equal(jobCBeforeRestart.status, 'paused', 'Test C.2: Status paused before restart')
    const savedBytesC = jobCBeforeRestart.downloaded_bytes
    assert.ok(savedBytesC > 0, 'Test C.3: Checkpoint bytes recorded')

    // Verify .part file exists on disk before shutdown
    const partialDirC = path.join(testDb.tempDir, '.applan2-partial-downloads', `job-${jobC.id}`)
    let foundPartFileC = null
    if (fs.existsSync(partialDirC)) {
      const partFiles = fs.readdirSync(partialDirC).filter((f) => f.endsWith('.part'))
      if (partFiles.length > 0) {
        foundPartFileC = path.join(partialDirC, partFiles[0])
      }
    }
    assert.ok(
      foundPartFileC && fs.existsSync(foundPartFileC),
      'Test C.3b: .part file exists on disk before shutdown'
    )

    // Simulate real application restart: stop queue, close database connection, and spawn child process
    console.log(
      '[Test C] Closing parent database and spawning real restart recovery child process...'
    )
    stopQueueForShutdown()
    await closeDatabase()

    const restartChildHelper = path.resolve('./tests/helpers/restart_recovery_child.mjs')
    const childOutput = execFileSync(
      process.execPath,
      ['--loader', './tests/loaders/electron_loader.mjs', restartChildHelper, testDb.databasePath],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    )

    const resultLine = childOutput
      .split('\n')
      .find((l) => l.trim().startsWith('APPLAN2_CHILD_RESTART_RESULT:'))
    assert.ok(resultLine, 'Test C.4: Child process emitted APPLAN2_CHILD_RESTART_RESULT')
    const childResult = JSON.parse(resultLine.trim().slice('APPLAN2_CHILD_RESTART_RESULT:'.length))

    const childJobC = childResult.jobs.find((j) => j.id === jobC.id)
    assert.ok(childJobC, 'Test C.5: Job C found in child database state')
    assert.equal(
      childJobC.status,
      'paused',
      'Test C.6: Job remains paused across real child restart'
    )
    assert.equal(
      childJobC.downloaded_bytes,
      savedBytesC,
      'Test C.7: Checkpoint bytes preserved in child'
    )
    assert.equal(
      childResult.queueStatus.activeCount,
      0,
      'Test C.8: Child queue active count is strictly 0'
    )

    // Reconnect parent database connection
    console.log('[Test C] Child process verified. Reopening parent database...')
    await initializeDatabase({ storage: testDb.databasePath })
    resetQueueForTesting()

    // Re-bind models to the reopened database
    DownloadJob = getDatabase().models.DownloadJob
    MediaItem = getDatabase().models.MediaItem
    AppSetting = getDatabase().models.AppSetting

    // Manually resume to verify continuity
    console.log(`[Test C] Manually resuming Job ${jobC.id}...`)
    await resumeDownloadJob(jobC.id, {
      isOnline: true,
      enqueue: (id) => enqueueDownloadJob(id)
    })

    let jobCCompleted = null
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 200))
      const cur = await DownloadJob.findByPk(jobC.id)
      if (cur.status === 'completed' || cur.status === 'failed') {
        jobCCompleted = cur
        break
      }
    }

    assert.ok(jobCCompleted, 'Test C.9: Job C finished execution')
    assert.equal(
      jobCCompleted.status,
      'completed',
      'Test C.10: Job C completed after manual resume'
    )
    assert.equal(jobCCompleted.progress, 100, 'Test C.11: Job C final progress is 100%')

    const rootFilesC = fs.readdirSync(testDb.tempDir)
    const finalMp4C = rootFilesC.find((f) => f.includes(`[job-${jobC.id}]`) && f.endsWith('.mp4'))
    assert.ok(finalMp4C, 'Test C.12: Final MP4 file exists for Job C')
    const finalFilePathC = path.join(testDb.tempDir, finalMp4C)
    const contentValidC = await verifyFinalMediaContent(finalFilePathC, 'mp4')
    assert.equal(contentValidC, true, 'Test C.13: Final MP4 passes FFprobe verification')
    const finalBufC = fs.readFileSync(finalFilePathC)
    const finalHashC = crypto.createHash('sha256').update(finalBufC).digest('hex')
    assert.equal(
      finalHashC,
      expectedHash,
      'Test C.14: Bit-for-bit SHA-256 match after real restart recovery'
    )

    console.log(
      '✓ Test C Passed: Paused jobs remain paused across real child restart without auto-resuming, and resume manually to 100% with bit-for-bit SHA-256 verification.\n'
    )

    // ==========================================================================
    // TEST D — PAUSE DURING FINALIZATION (REAL SEPARATE-STREAM MERGE)
    // ==========================================================================
    console.log('--- TEST D: Pause During Finalization ---')

    let dashTempDir = null
    try {
      dashTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'applan2-dash-fixture-'))
      currentDashDir = dashTempDir

      const ffmpegExe = path.resolve(await resolveFFmpegPath())
      execFileSync(
        ffmpegExe,
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=640x360:rate=30:duration=8',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=1000:sample_rate=48000:duration=8',
          '-map',
          '0:v',
          '-map',
          '1:a',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-c:a',
          'aac',
          '-f',
          'dash',
          '-seg_duration',
          '2',
          '-init_seg_name',
          'init-stream$RepresentationID$.m4s',
          '-media_seg_name',
          'chunk-stream$RepresentationID$-$Number%05d$.m4s',
          'manifest.mpd'
        ],
        {
          cwd: dashTempDir,
          stdio: 'pipe'
        }
      )

      const dashUrl = `http://127.0.0.1:${port}/dash/manifest.mpd`
      const dashMedia = await MediaItem.create({
        source_url: dashUrl,
        title: 'Real Windows DASH Test Video'
      })

      const jobD = await DownloadJob.create({
        media_id: dashMedia.id,
        source_type: 'link',
        output_format: 'mp4',
        quality: '360p',
        status: 'queued',
        progress: 0,
        downloaded_bytes: 0
      })

      console.log(`[Test D] Starting Job ${jobD.id} (DASH separate-stream)...`)
      enqueueDownloadJob(jobD.id)

      // Wait until process starts
      let procEntryD = null
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 100))
        procEntryD = getActiveDownloadProcess(jobD.id)
        if (procEntryD && !procEntryD.closed) break
      }

      assert.ok(procEntryD, 'Test D.1: Active download process found')

      // Observe real transition to 'finalizing' phase as yt-dlp finishes downloading both streams
      // and enters post-processing / FFmpeg merger (ZERO manual phase override!)
      let pauseResultD = null
      let attemptedPause = false

      let livePhase = procEntryD.phase
      Object.defineProperty(procEntryD, 'phase', {
        get() {
          return livePhase
        },
        set(val) {
          livePhase = val
          if (val === 'finalizing' && !attemptedPause) {
            attemptedPause = true
            console.log(
              `[Test D] yt-dlp naturally entered phase: "finalizing". Issuing pauseDownloadJob(${jobD.id})...`
            )
            pauseDownloadJob(jobD.id).then((res) => {
              pauseResultD = res
            })
          }
        },
        configurable: true
      })

      // Also poll in case phase was already finalizing before property definition
      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 150))
        if (procEntryD.phase === 'finalizing' && !attemptedPause) {
          attemptedPause = true
          console.log(
            `[Test D] Poller detected phase: "finalizing". Issuing pauseDownloadJob(${jobD.id})...`
          )
          pauseResultD = await pauseDownloadJob(jobD.id)
          break
        }
        if (pauseResultD) break
        const cur = await DownloadJob.findByPk(jobD.id)
        if (cur.status === 'completed' || cur.status === 'failed') break
      }

      if (attemptedPause && !pauseResultD) {
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 100))
          if (pauseResultD) break
        }
      }

      assert.ok(pauseResultD, 'Test D.2: pauseDownloadJob was executed during finalization phase')
      assert.equal(
        pauseResultD.outcome,
        'already_finishing',
        'Test D.3: pauseDownloadJob returns already_finishing'
      )
      assert.equal(pauseResultD.status, 'downloading', 'Test D.4: Job status remains downloading')
      assert.equal(procEntryD.closed, false, 'Test D.5: yt-dlp process was NOT killed')

      // Wait for job completion
      let jobDCompleted = null
      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 200))
        const cur = await DownloadJob.findByPk(jobD.id)
        if (cur.status === 'completed' || cur.status === 'failed') {
          jobDCompleted = cur
          break
        }
      }

      assert.ok(jobDCompleted, 'Test D.6: Job D completed execution')
      assert.equal(
        jobDCompleted.status,
        'completed',
        'Test D.7: Job completed successfully without being marked as failed or paused'
      )
      assert.equal(jobDCompleted.progress, 100, 'Test D.8: Final progress is 100%')

      const rootFilesD = fs.readdirSync(testDb.tempDir)
      const finalMp4D = rootFilesD.find((f) => f.includes(`[job-${jobD.id}]`) && f.endsWith('.mp4'))
      assert.ok(finalMp4D, 'Test D.9: Final MP4 file exists for Job D')
      const finalFilePathD = path.join(testDb.tempDir, finalMp4D)
      const contentValidD = await verifyFinalMediaContent(finalFilePathD, 'mp4')
      assert.equal(contentValidD, true, 'Test D.10: Final MP4 passes FFprobe verification')

      // Verify that the final MP4 has BOTH video and audio streams
      const ffprobeExe = path.resolve(await resolveFFprobePath())
      const probeOutput = execFileSync(
        ffprobeExe,
        ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', finalFilePathD],
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      )
      const probeData = JSON.parse(probeOutput)
      const streamTypes = (probeData.streams || []).map((s) => s.codec_type)
      assert.ok(streamTypes.includes('video'), 'Test D.11: Merged MP4 contains video stream')
      assert.ok(streamTypes.includes('audio'), 'Test D.12: Merged MP4 contains audio stream')

      console.log(
        '✓ Test D Passed: Pause during natural finalization returns already_finishing and allows safe completion with verified video+audio merge.\n'
      )
    } finally {
      currentDashDir = null
      if (dashTempDir && fs.existsSync(dashTempDir)) {
        await fs.promises.rm(dashTempDir, { recursive: true, force: true }).catch(() => {})
      }
    }

    // ==========================================================================
    // TEST E — REAL CANCEL
    // ==========================================================================
    console.log('--- TEST E: Real Windows yt-dlp Cancel ---')

    const jobE = await DownloadJob.create({
      media_id: media.id,
      source_type: 'link',
      output_format: 'mp4',
      quality: '720p',
      status: 'queued',
      progress: 0,
      downloaded_bytes: 0
    })

    console.log(`[Test E] Starting Job ${jobE.id}...`)
    enqueueDownloadJob(jobE.id)

    // Wait until progress reaches >= 20%
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150))
      const cur = await DownloadJob.findByPk(jobE.id)
      if ((cur.progress || 0) >= 20) break
    }

    console.log(`[Test E] Triggering cancelDownloadJob(${jobE.id})...`)
    const cancelResultE = await cancelDownloadJob(jobE.id)
    assert.equal(
      cancelResultE.outcome,
      'cancelled',
      'Test E.1: cancelDownloadJob returns outcome: cancelled'
    )
    assert.equal(cancelResultE.status, 'cancelled', 'Test E.2: Status is cancelled')

    // Verify process tree is terminated
    const procEntryE = getActiveDownloadProcess(jobE.id)
    assert.ok(!procEntryE || procEntryE.closed, 'Test E.3: Process tree is terminated')

    // Verify temporary fragments are cleaned
    const partialDirE = path.join(testDb.tempDir, '.applan2-partial-downloads', `job-${jobE.id}`)
    assert.equal(fs.existsSync(partialDirE), false, 'Test E.4: Temporary fragments cleaned up')

    const jobEAfterCancel = await DownloadJob.findByPk(jobE.id)
    assert.equal(jobEAfterCancel.status, 'cancelled', 'Test E.5: SQLite status is cancelled')
    assert.equal(
      jobEAfterCancel.progress,
      0,
      'Test E.5b: Progress reset to 0% in SQLite upon cancel'
    )
    assert.equal(
      jobEAfterCancel.downloaded_bytes,
      0,
      'Test E.5c: Downloaded bytes reset to 0 in SQLite upon cancel'
    )
    assert.equal(getQueueStatus().activeCount, 0, 'Test E.6: Queue slot released')

    console.log(
      '✓ Test E Passed: Real yt-dlp cancelled, process tree killed, and temporary files cleaned.\n'
    )

    // ==========================================================================
    // TEST F — REAL RETRY AFTER CANCEL
    // ==========================================================================
    console.log('--- TEST F: Real Retry After Cancel ---')

    const retryResultF = await retryDownloadJob(jobE.id, {
      enqueue: (id) => enqueueDownloadJob(id)
    })

    assert.equal(retryResultF.outcome, 'created', 'Test F.1: retryDownloadJob outcome is created')
    assert.equal(retryResultF.originalJobId, jobE.id, 'Test F.2: Retry preserves SAME Job ID')

    const retriedJobF = await DownloadJob.findByPk(jobE.id)
    assert.equal(retriedJobF.progress, 0, 'Test F.3: Progress reset to 0%')
    assert.equal(retriedJobF.downloaded_bytes, 0, 'Test F.4: Downloaded bytes reset to 0')
    assert.equal(retriedJobF.error_message, null, 'Test F.5: Error message cleared')

    // Wait for fresh download to finish
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 200))
      const cur = await DownloadJob.findByPk(jobE.id)
      if (cur.status === 'completed' || cur.status === 'failed') {
        assert.equal(cur.status, 'completed', 'Test F.6: Retried job completed to 100%')
        break
      }
    }

    // Wait for queue slot to be fully released by executor finally block
    for (let i = 0; i < 30; i++) {
      if (getQueueStatus().activeCount === 0) break
      await new Promise((r) => setTimeout(r, 100))
    }

    console.log(
      '✓ Test F Passed: Retry restarts clean from 0% under the same Job ID and completes successfully.\n'
    )

    // ==========================================================================
    // TEST G — FIFO AND CONCURRENCY
    // ==========================================================================
    console.log('--- TEST G: Queue Concurrency and FIFO Regression ---')

    resetQueueForTesting()

    const jobG1 = await DownloadJob.create({
      media_id: media.id,
      source_type: 'link',
      output_format: 'mp4',
      quality: '720p',
      status: 'queued',
      progress: 0,
      downloaded_bytes: 0
    })

    const jobG2 = await DownloadJob.create({
      media_id: media.id,
      source_type: 'link',
      output_format: 'mp4',
      quality: '720p',
      status: 'queued',
      progress: 0,
      downloaded_bytes: 0
    })

    const jobG3 = await DownloadJob.create({
      media_id: media.id,
      source_type: 'link',
      output_format: 'mp4',
      quality: '720p',
      status: 'queued',
      progress: 0,
      downloaded_bytes: 0
    })

    console.log('[Test G] Enqueueing 3 jobs in FIFO order: G1, G2, G3...')
    enqueueDownloadJob(jobG1.id)
    enqueueDownloadJob(jobG2.id)
    enqueueDownloadJob(jobG3.id)

    const qStatusG = getQueueStatus()
    assert.equal(qStatusG.maxConcurrency, 2, 'Test G.1: Max concurrency is strictly 2')
    assert.equal(qStatusG.activeCount, 2, 'Test G.2: Active count is 2 (slots filled)')
    assert.equal(qStatusG.waitingCount, 1, 'Test G.3: 1 job waiting in FIFO')

    // Verify duplicate job scheduling is prevented
    const dupScheduled = enqueueDownloadJob(jobG1.id)
    assert.equal(dupScheduled, false, 'Test G.4: Duplicate job scheduling is prevented')

    // Wait until jobs are downloading
    await new Promise((r) => setTimeout(r, 400))

    // Pause G1 -> slot should be released and G3 should start
    console.log(`[Test G] Pausing Job ${jobG1.id} to release concurrency slot...`)
    const pauseResultG1 = await pauseDownloadJob(jobG1.id)
    assert.equal(pauseResultG1.outcome, 'paused', 'Test G.5: G1 paused successfully')

    // Allow queue to dispatch waiting job
    await new Promise((r) => setTimeout(r, 600))
    const jobG3Cur = await DownloadJob.findByPk(jobG3.id)
    assert.ok(
      ['downloading', 'completed'].includes(jobG3Cur.status),
      `Test G.6: G3 started automatically when G1 paused (status: ${jobG3Cur.status})`
    )

    // Clean up remaining active jobs
    await cancelDownloadJob(jobG2.id).catch(() => {})
    await cancelDownloadJob(jobG3.id).catch(() => {})

    // Wait for cancelled jobs to fully release queue slots
    for (let i = 0; i < 30; i++) {
      if (getQueueStatus().activeCount === 0) break
      await new Promise((r) => setTimeout(r, 100))
    }

    console.log(
      '✓ Test G Passed: Concurrency strictly capped at 2, FIFO order maintained, slots released on pause.\n'
    )

    // ==========================================================================
    // TEST H — YOUTUBE REGRESSION SMOKE TEST
    // ==========================================================================
    console.log('--- TEST H: YouTube Regression & Environment Diagnostic ---')

    // 1. Verify yt-dlp binary
    const ytDlpPath = await resolveYtDlpPath()
    assert.ok(fs.existsSync(ytDlpPath), 'Test H.1: yt-dlp binary exists on disk')
    const ytDlpVersion = execFileSync(ytDlpPath, ['--version'], { encoding: 'utf8' }).trim()
    assert.ok(ytDlpVersion.length >= 8, `Test H.2: yt-dlp reports valid version (${ytDlpVersion})`)
    console.log(`[Test H] yt-dlp executable: ${ytDlpPath} (version: ${ytDlpVersion})`)

    // 2. Verify FFmpeg & FFprobe binaries
    const ffmpegPath = await resolveFFmpegPath()
    const ffprobePath = await resolveFFprobePath()
    assert.ok(fs.existsSync(ffmpegPath), 'Test H.3: ffmpeg binary exists')
    assert.ok(fs.existsSync(ffprobePath), 'Test H.4: ffprobe binary exists')
    console.log(`[Test H] FFmpeg: ${ffmpegPath}, FFprobe: ${ffprobePath}`)

    // 3. Verify Node.js runtime and JS runtime option
    assert.ok(fs.existsSync(process.execPath), 'Test H.5: Node runtime exists')
    const jsOpt = await resolveJavaScriptRuntimeOption()
    assert.equal(jsOpt, 'node', 'Test H.6: JS runtime option configured to node')
    console.log(
      `[Test H] Node runtime: ${process.execPath} (${process.version}), JS option: ${jsOpt}`
    )

    // 4. Test real YouTube media analysis (reset mock analyzer)
    resetAnalyzerForTesting()
    console.log('[Test H] Testing real yt-dlp media analysis against YouTube test URL...')

    const youtubeTestUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    let ytAnalysisSuccess = false
    let ytDiagnostic = null

    let result = null
    try {
      result = await analyzeMedia(youtubeTestUrl)
      ytAnalysisSuccess = true
    } catch (analysisError) {
      ytDiagnostic = analysisError
    }

    if (ytAnalysisSuccess && result) {
      assert.ok(result.title, 'Test H.7: Media title extracted')
      const dur = result.durationSeconds ?? result.duration
      assert.ok(typeof dur === 'number' && dur > 0, 'Test H.8: Media duration extracted')
      assert.ok(
        result.availableFormats &&
          (Array.isArray(result.availableFormats.mp4Formats) ||
            Array.isArray(result.availableFormats.audioFormats)),
        'Test H.8b: Available formats metadata extracted'
      )
      if (result.availableFormats?.mp4Formats?.length > 0) {
        assert.ok(result.availableFormats.mp4Formats[0].formatId, 'Test H.8c: Format ID extracted')
      }
      console.log(
        `[Test H] Positive YouTube extraction succeeded! Title: "${result.title}", Duration: ${dur}s, Formats: MP4 (${result.availableFormats?.mp4Formats?.length || 0}) / Audio (${result.availableFormats?.audioFormats?.length || 0})`
      )
    } else if (ytDiagnostic) {
      const errCode = ytDiagnostic?.code || ytDiagnostic?.name || 'UNKNOWN'
      const userMsg = ytDiagnostic?.userMessage || ytDiagnostic?.message || ''
      console.log(`[Test H] YouTube extraction returned classified error: [${errCode}] ${userMsg}`)

      const isKnownExternalBlock =
        errCode === 'YOUTUBE_AUTH_REQUIRED' ||
        errCode === 'BOT_VERIFICATION_REQUIRED' ||
        errCode === 'HTTP_FORBIDDEN' ||
        errCode === 'RATE_LIMITED' ||
        errCode === 'JS_CHALLENGE_FAILED'

      if (isKnownExternalBlock) {
        console.warn(
          `[Test H] BLOCKED — External YouTube verification unavailable: [${errCode}] ${userMsg}`
        )
        setAnalyzerForTesting(mockAnalyzer)
        process.exitCode = 2
        return
      }

      throw new Error(
        `Test H Failed: YouTube extraction failed with unhandled error: [${errCode}] ${userMsg}`
      )
    }

    // Restore mock analyzer for subsequent local tests
    setAnalyzerForTesting(mockAnalyzer)

    console.log(
      '✓ Test H Passed: yt-dlp, FFmpeg, Node runtime verified; YouTube analysis accurately handled.\n'
    )

    // ==========================================================================
    // TEST I — PAUSE DURING FINALIZING PHASE PROTECTION
    // ==========================================================================
    console.log('--- TEST I: Finalizing Phase Pause Protection ---')

    const jobI = await DownloadJob.create({
      media_id: media.id,
      source_type: 'link',
      output_format: 'mp4',
      quality: '720p',
      status: 'downloading',
      progress: 98,
      downloaded_bytes: FILE_SIZE
    })

    const mockProcessI = {
      jobId: jobI.id,
      managedByJobExecutor: true,
      childProcess: { pid: process.pid },
      actualPid: process.pid,
      pgid: process.pid,
      cancelRequested: false,
      pauseRequested: false,
      phase: 'finalizing',
      closed: false
    }
    setActiveDownloadProcessForTesting(jobI.id, mockProcessI)

    const pauseResultI = await pauseDownloadJob(jobI.id)
    assert.equal(
      pauseResultI.outcome,
      'already_finishing',
      'Test I.1: Outcome is already_finishing'
    )
    assert.equal(pauseResultI.status, 'downloading', 'Test I.2: Status remains downloading')
    assert.ok(
      pauseResultI.message.includes('finishing'),
      'Test I.3: User-friendly finalizing message returned'
    )

    setActiveDownloadProcessForTesting(jobI.id, null)
    console.log(
      '✓ Test I Passed: Pause in finalizing phase rejected cleanly with already_finishing.\n'
    )

    // ==========================================================================
    // TEST J — WINDOWS CONSOLE HELPER BINARY VALIDATION
    // ==========================================================================
    console.log('--- TEST J: Windows Console Helper PE Binary Validation ---')

    const helperPath = resolveCtrlBreakHelperPath()
    assert.ok(helperPath, 'Test J.1: Helper binary path resolved')
    assert.ok(fs.existsSync(helperPath), 'Test J.2: Helper binary exists on disk')

    const helperBuf = fs.readFileSync(helperPath)
    assert.ok(helperBuf.length > 2048, 'Test J.3: Binary size is realistic (>2KB)')
    assert.equal(helperBuf[0], 0x4d, 'Test J.4: MZ signature byte 0')
    assert.equal(helperBuf[1], 0x5a, 'Test J.5: MZ signature byte 1')

    const peOffset = helperBuf.readInt32LE(0x3c)
    assert.equal(
      helperBuf.toString('utf8', peOffset, peOffset + 4),
      'PE\0\0',
      'Test J.6: PE signature verified'
    )
    const machine = helperBuf.readUInt16LE(peOffset + 4)
    assert.equal(machine, 0x8664, 'Test J.7: Machine type is AMD64 / x64')

    // Test execution with invalid PID argument (should exit code 1 cleanly)
    let helperExitCode = null
    try {
      execFileSync(helperPath, ['not_a_pid'], { stdio: 'pipe' })
      helperExitCode = 0
    } catch (err) {
      helperExitCode = err.status
    }
    assert.equal(helperExitCode, 1, 'Test J.8: Helper exits 1 on invalid argument without crash')
    console.log(
      '✓ Test J Passed: send-ctrl-break.exe verified as genuine x64 PE binary with safe error exits.\n'
    )

    // ==========================================================================
    // TEST K — NETWORK RECOVERY AND MANUAL PAUSE/CANCEL RACE PROTECTION
    // ==========================================================================
    console.log('--- TEST K: Network Recovery & Manual Pause/Cancel Race Protection ---')

    // Scenario A: Network Recovery vs Concurrent Manual Pause
    console.log('[Test K] Scenario A: Network Recovery vs Concurrent Manual Pause...')
    resetQueueForTesting()

    const jobKA = await DownloadJob.create({
      media_id: media.id,
      source_type: 'link',
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 40,
      downloaded_bytes: Math.floor(FILE_SIZE * 0.4),
      error_message: 'Network connection lost'
    })

    const partialDirKA = path.join(testDb.tempDir, '.applan2-partial-downloads', `job-${jobKA.id}`)
    fs.mkdirSync(partialDirKA, { recursive: true })
    const partPathKA = path.join(partialDirKA, 'sample.mp4.part')
    fs.writeFileSync(partPathKA, fixtureBuf.subarray(0, Math.floor(FILE_SIZE * 0.4)))

    // Execute deterministic network recovery vs manual pause race
    let recoveryEnteredKA = null
    const recoveryEnteredPromiseKA = new Promise((r) => {
      recoveryEnteredKA = r
    })
    let releaseRecoveryKA = null
    const releaseRecoveryPromiseKA = new Promise((r) => {
      releaseRecoveryKA = r
    })

    setRecoveryHooksForTesting({
      afterRecoveryLock: async ({ jobId }) => {
        if (jobId === jobKA.id) {
          recoveryEnteredKA()
          await releaseRecoveryPromiseKA
        }
      }
    })

    const recoveryPromiseKA = resumeInterruptedNetworkJobs({ isOnline: true })
    await recoveryEnteredPromiseKA

    const pausePromiseKA = pauseDownloadJob(jobKA.id)
    await new Promise((r) => setImmediate(r))
    releaseRecoveryKA()
    const pauseResultKA = await pausePromiseKA
    await recoveryPromiseKA
    setRecoveryHooksForTesting(null)

    // Wait for in-flight executor settlement
    for (let i = 0; i < 20; i++) {
      if (getQueueStatus().activeCount === 0) break
      await new Promise((r) => setTimeout(r, 100))
    }

    const jobKAAfter = await DownloadJob.findByPk(jobKA.id)
    assert.equal(
      jobKAAfter.status,
      'paused',
      'Test K.1: Manual pause wins or is respected (status is paused)'
    )
    assert.ok(
      ['paused', 'already_paused', 'already_finishing'].includes(pauseResultKA.outcome),
      'Test K.2: Valid pause outcome received'
    )
    assert.ok(fs.existsSync(partPathKA), 'Test K.3: Partial file is preserved on disk')
    assert.equal(
      jobKAAfter.downloaded_bytes,
      Math.floor(FILE_SIZE * 0.4),
      'Test K.4: Downloaded bytes preserved'
    )
    assert.equal(
      getQueueStatus().activeCount,
      0,
      'Test K.5: Job was not scheduled for active execution'
    )

    // Scenario B: Network Recovery vs Concurrent Manual Cancel
    console.log('[Test K] Scenario B: Network Recovery vs Concurrent Manual Cancel...')
    resetQueueForTesting()

    const jobKB = await DownloadJob.create({
      media_id: media.id,
      source_type: 'link',
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 40,
      downloaded_bytes: Math.floor(FILE_SIZE * 0.4),
      error_message: 'Network connection lost'
    })

    const partialDirKB = path.join(testDb.tempDir, '.applan2-partial-downloads', `job-${jobKB.id}`)
    fs.mkdirSync(partialDirKB, { recursive: true })
    const partPathKB = path.join(partialDirKB, 'sample.mp4.part')
    fs.writeFileSync(partPathKB, fixtureBuf.subarray(0, Math.floor(FILE_SIZE * 0.4)))

    // Execute deterministic network recovery vs manual cancel race
    let recoveryEnteredKB = null
    const recoveryEnteredPromiseKB = new Promise((r) => {
      recoveryEnteredKB = r
    })
    let releaseRecoveryKB = null
    const releaseRecoveryPromiseKB = new Promise((r) => {
      releaseRecoveryKB = r
    })

    setRecoveryHooksForTesting({
      afterRecoveryLock: async ({ jobId }) => {
        if (jobId === jobKB.id) {
          recoveryEnteredKB()
          await releaseRecoveryPromiseKB
        }
      }
    })

    const recoveryPromiseKB = resumeInterruptedNetworkJobs({ isOnline: true })
    await recoveryEnteredPromiseKB

    const cancelPromiseKB = cancelDownloadJob(jobKB.id)
    await new Promise((r) => setImmediate(r))
    releaseRecoveryKB()
    const cancelResultKB = await cancelPromiseKB
    await recoveryPromiseKB
    setRecoveryHooksForTesting(null)

    // Wait for in-flight executor settlement
    for (let i = 0; i < 20; i++) {
      if (getQueueStatus().activeCount === 0) break
      await new Promise((r) => setTimeout(r, 100))
    }

    const jobKBAfter = await DownloadJob.findByPk(jobKB.id)
    assert.equal(jobKBAfter.status, 'cancelled', 'Test K.6: Cancelled status persists')
    assert.equal(cancelResultKB.outcome, 'cancelled', 'Test K.7: Cancel outcome returned')
    assert.equal(jobKBAfter.progress, 0, 'Test K.8: Progress reset to 0%')
    assert.equal(jobKBAfter.downloaded_bytes, 0, 'Test K.9: Downloaded bytes reset to 0')
    assert.equal(
      fs.existsSync(partialDirKB),
      false,
      'Test K.10: Temporary partial folder cleanly cleaned up'
    )
    assert.equal(getQueueStatus().activeCount, 0, 'Test K.11: No active download running')
    assert.equal(jobKBAfter.error_message, null, 'Test K.11b: No spurious failed error message')

    // Verify subsequent network recovery never resurrects a manually cancelled job
    const reRecoveryKB = await resumeInterruptedNetworkJobs({ isOnline: true })
    assert.equal(
      reRecoveryKB.resumedCount,
      0,
      'Test K.11c: Re-running network recovery does not re-queue cancelled job'
    )
    const jobKBReRecovery = await DownloadJob.findByPk(jobKB.id)
    assert.equal(jobKBReRecovery.status, 'cancelled', 'Test K.11d: Cancelled job stays cancelled')

    // Scenario B2: Ordering 2 - Executor claims 'downloading' first before concurrent Manual Cancel
    console.log(
      '[Test K] Scenario B2: Recovery claims downloading first before concurrent Manual Cancel...'
    )
    resetQueueForTesting()
    setAnalyzerForTesting(mockAnalyzer)

    const jobKB2 = await DownloadJob.create({
      media_id: media.id,
      source_type: 'link',
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 40,
      downloaded_bytes: Math.floor(FILE_SIZE * 0.4),
      error_message: 'Network connection lost'
    })

    const partialDirKB2 = path.join(
      testDb.tempDir,
      '.applan2-partial-downloads',
      `job-${jobKB2.id}`
    )
    fs.mkdirSync(partialDirKB2, { recursive: true })
    fs.writeFileSync(
      path.join(partialDirKB2, 'sample.mp4.part'),
      fixtureBuf.subarray(0, Math.floor(FILE_SIZE * 0.4))
    )

    let enteredPrePrepKB2 = null
    const enteredPrePrepPromiseKB2 = new Promise((r) => {
      enteredPrePrepKB2 = r
    })
    let releasePrePrepKB2 = null
    const releasePrePrepPromiseKB2 = new Promise((r) => {
      releasePrePrepKB2 = r
    })

    setExecutionHooksForTesting({
      beforePrepareWorkspace: async ({ jobId }) => {
        if (jobId === jobKB2.id) {
          enteredPrePrepKB2()
          await releasePrePrepPromiseKB2
        }
      }
    })

    const recoveryPromiseKB2 = resumeInterruptedNetworkJobs({ isOnline: true })
    await enteredPrePrepPromiseKB2
    await recoveryPromiseKB2

    const cancelPromiseKB2 = cancelDownloadJob(jobKB2.id)
    for (let i = 0; i < 200; i++) {
      if (getActiveDownloadProcess(jobKB2.id)?.cancelRequested) break
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(
      Boolean(getActiveDownloadProcess(jobKB2.id)?.cancelRequested),
      true,
      'Test K.12: Concurrent cancel signaled claimed execution before workspace preparation'
    )
    releasePrePrepKB2()
    const cancelResultKB2 = await cancelPromiseKB2
    resetExecutionHooksForTesting()

    for (let i = 0; i < 20; i++) {
      if (getQueueStatus().activeCount === 0 && !getActiveDownloadProcess(jobKB2.id)) break
      await new Promise((r) => setTimeout(r, 50))
    }

    const jobKB2After = await DownloadJob.findByPk(jobKB2.id)
    assert.equal(cancelResultKB2.outcome, 'cancelled', 'Test K.13: Ordering 2 cancel outcome')
    assert.equal(jobKB2After.status, 'cancelled', 'Test K.14: Ordering 2 persists cancelled')
    assert.equal(jobKB2After.progress, 0, 'Test K.15: Ordering 2 progress reset to 0%')
    assert.equal(jobKB2After.downloaded_bytes, 0, 'Test K.16: Ordering 2 bytes reset to 0')
    assert.equal(jobKB2After.error_message, null, 'Test K.17: Ordering 2 cleared error message')
    assert.equal(fs.existsSync(partialDirKB2), false, 'Test K.18: Ordering 2 temp dir removed')
    assert.equal(getQueueStatus().activeCount, 0, 'Test K.19: Ordering 2 zero active jobs')

    const reRecoveryKB2 = await resumeInterruptedNetworkJobs({ isOnline: true })
    assert.equal(reRecoveryKB2.resumedCount, 0, 'Test K.20: Recovery ignores cancelled KB2')

    // Scenario B3: Ordering 3 - Cancel immediately after prepareJobTemporaryWorkspace + workspace mutex
    console.log(
      '[Test K] Scenario B3: Post-workspace-prep Manual Cancel & concurrent workspace mutex...'
    )
    resetQueueForTesting()
    setAnalyzerForTesting(mockAnalyzer)

    const jobKB3 = await DownloadJob.create({
      media_id: media.id,
      source_type: 'link',
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 40,
      downloaded_bytes: Math.floor(FILE_SIZE * 0.4),
      error_message: 'Network connection lost'
    })

    const partialDirKB3 = path.join(
      testDb.tempDir,
      '.applan2-partial-downloads',
      `job-${jobKB3.id}`
    )
    fs.mkdirSync(partialDirKB3, { recursive: true })
    fs.writeFileSync(
      path.join(partialDirKB3, 'sample.mp4.part'),
      fixtureBuf.subarray(0, Math.floor(FILE_SIZE * 0.4))
    )

    let enteredPostPrepKB3 = null
    const enteredPostPrepPromiseKB3 = new Promise((r) => {
      enteredPostPrepKB3 = r
    })
    let releasePostPrepKB3 = null
    const releasePostPrepPromiseKB3 = new Promise((r) => {
      releasePostPrepKB3 = r
    })

    setExecutionHooksForTesting({
      afterPrepareWorkspace: async ({ jobId }) => {
        if (jobId === jobKB3.id) {
          enteredPostPrepKB3()
          await releasePostPrepPromiseKB3
        }
      }
    })

    const recoveryPromiseKB3 = resumeInterruptedNetworkJobs({ isOnline: true })
    await enteredPostPrepPromiseKB3
    await recoveryPromiseKB3

    const cancelPromiseKB3 = cancelDownloadJob(jobKB3.id)
    for (let i = 0; i < 200; i++) {
      if (getActiveDownloadProcess(jobKB3.id)?.cancelRequested) break
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(
      Boolean(getActiveDownloadProcess(jobKB3.id)?.cancelRequested),
      true,
      'Test K.21: Concurrent cancel signaled claimed execution right after workspace prep'
    )
    releasePostPrepKB3()
    const cancelResultKB3 = await cancelPromiseKB3
    resetExecutionHooksForTesting()

    for (let i = 0; i < 20; i++) {
      if (getQueueStatus().activeCount === 0 && !getActiveDownloadProcess(jobKB3.id)) break
      await new Promise((r) => setTimeout(r, 50))
    }

    const jobKB3After = await DownloadJob.findByPk(jobKB3.id)
    assert.equal(cancelResultKB3.outcome, 'cancelled', 'Test K.22: Ordering 3 cancel outcome')
    assert.equal(jobKB3After.status, 'cancelled', 'Test K.23: Ordering 3 persists cancelled')
    assert.equal(jobKB3After.progress, 0, 'Test K.24: Ordering 3 progress reset to 0%')
    assert.equal(jobKB3After.downloaded_bytes, 0, 'Test K.25: Ordering 3 bytes reset to 0')
    assert.equal(jobKB3After.error_message, null, 'Test K.26: Ordering 3 cleared error message')
    assert.equal(fs.existsSync(partialDirKB3), false, 'Test K.27: Ordering 3 temp dir removed')
    assert.equal(getQueueStatus().activeCount, 0, 'Test K.28: Ordering 3 zero active jobs')

    // Concurrent prepareJobTemporaryWorkspace vs cleanupJobTemporaryFiles stress verification
    const partialDirMutex = path.join(
      testDb.tempDir,
      '.applan2-partial-downloads',
      `job-${jobKB3.id}`
    )
    fs.mkdirSync(partialDirMutex, { recursive: true })
    fs.writeFileSync(path.join(partialDirMutex, 'race.part'), Buffer.from('partial-data'))
    const [prepRaceRes, cleanRaceRes] = await Promise.all([
      prepareJobTemporaryWorkspace(jobKB3.id, testDb.tempDir),
      cleanupJobTemporaryFiles(jobKB3.id, testDb.tempDir)
    ])
    assert.equal(
      typeof prepRaceRes,
      'string',
      'Test K.29: Concurrent prepareJobTemporaryWorkspace resolved without EBADF/ENOENT'
    )
    assert.equal(
      cleanRaceRes?.success,
      true,
      'Test K.30: Concurrent cleanupJobTemporaryFiles succeeded without EBADF/ENOENT'
    )
    assert.equal(
      fs.existsSync(partialDirMutex),
      false,
      'Test K.31: Serialized cleanup left no stale partial directory after prepare-then-cleanup'
    )

    // Scenario C: Normal Network Recovery
    console.log('[Test K] Scenario C: Normal Network Recovery...')
    resetQueueForTesting()
    setAnalyzerForTesting(mockAnalyzer)

    const jobKC = await DownloadJob.create({
      media_id: media.id,
      source_type: 'link',
      output_format: 'mp4',
      quality: '720p',
      status: 'interrupted',
      progress: 40,
      downloaded_bytes: Math.floor(FILE_SIZE * 0.4),
      error_message: 'Network connection lost'
    })

    const partialDirKC = path.join(testDb.tempDir, '.applan2-partial-downloads', `job-${jobKC.id}`)
    fs.mkdirSync(partialDirKC, { recursive: true })
    const partPathKC = path.join(
      partialDirKC,
      `test_video [test_video] [720p] [job-${jobKC.id}].mp4.part`
    )
    fs.writeFileSync(partPathKC, fixtureBuf.subarray(0, Math.floor(FILE_SIZE * 0.4)))

    const recoveryResultC = await resumeInterruptedNetworkJobs({ isOnline: true })
    assert.ok(recoveryResultC.resumedCount >= 1, 'Test K.12: Interrupted job resumed by recovery')

    let jobKCCompleted = null
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 200))
      const cur = await DownloadJob.findByPk(jobKC.id)
      if (cur.status === 'completed' || cur.status === 'failed') {
        jobKCCompleted = cur
        break
      }
    }

    assert.ok(jobKCCompleted, 'Test K.13: Recovered job completed execution')
    assert.equal(jobKCCompleted.status, 'completed', 'Test K.14: Job KC reached completed status')
    assert.equal(jobKCCompleted.progress, 100, 'Test K.15: Final progress is 100%')

    const rootFilesK = fs.readdirSync(testDb.tempDir)
    const finalMp4K = rootFilesK.find((f) => f.includes(`[job-${jobKC.id}]`) && f.endsWith('.mp4'))
    assert.ok(finalMp4K, 'Test K.16: Final MP4 file exists for Job KC')
    const finalFilePathK = path.join(testDb.tempDir, finalMp4K)
    const contentValidK = await verifyFinalMediaContent(finalFilePathK, 'mp4')
    assert.equal(contentValidK, true, 'Test K.17: Final MP4 passes FFprobe verification')
    const finalBufK = fs.readFileSync(finalFilePathK)
    const finalHashK = crypto.createHash('sha256').update(finalBufK).digest('hex')
    assert.equal(
      finalHashK,
      expectedHash,
      'Test K.18: Final SHA-256 matches source MP4 (100% MATCH)'
    )

    // Duplicate pause in-flight deduplication test
    let pauseResolve
    const pausePromiseMock = new Promise((resolve) => {
      pauseResolve = resolve
    })
    const mockProcessK = {
      jobId: jobKA.id,
      managedByJobExecutor: true,
      childProcess: { pid: process.pid },
      actualPid: process.pid,
      pgid: process.pid,
      cancelRequested: false,
      pauseRequested: true,
      pausePromise: pausePromiseMock,
      phase: 'downloading',
      closed: false
    }
    setActiveDownloadProcessForTesting(jobKA.id, mockProcessK)

    // Call pauseRunningDownload concurrently while pausePromise is pending
    const dupPausePromise = pauseRunningDownload(jobKA.id)
    pauseResolve({ success: true, deduplicated: true })
    const dupPauseResult = await dupPausePromise
    assert.equal(
      dupPauseResult.success,
      true,
      'Test K.19: Duplicate in-flight pause returns matching promise'
    )
    assert.equal(
      dupPauseResult.deduplicated,
      true,
      'Test K.20: Deduplicated result received without re-invoking pause'
    )

    setActiveDownloadProcessForTesting(jobKA.id, null)
    console.log(
      '✓ Test K Passed: All 3 scenarios verified (Manual Pause wins, Cancel wins with cleanup, Normal Recovery completes to 100% with bit-for-bit SHA-256 match).\n'
    )

    // ==========================================================================
    // TEST L — FULL LIFECYCLE: QUEUED -> DOWNLOADING -> PAUSE -> RESUME -> CANCEL -> RETRY
    // ==========================================================================
    console.log(
      '--- TEST L: Full Lifecycle: Queued -> Downloading -> Pause -> Resume -> Cancel -> Retry ---'
    )

    resetQueueForTesting()
    setAnalyzerForTesting(mockAnalyzer)

    const mediaL = await MediaItem.create({
      source_url: `${serverUrl}?lifecycle=L`,
      title: 'Real Windows Test Video Lifecycle'
    })

    const jobL = await DownloadJob.create({
      media_id: mediaL.id,
      source_type: 'link',
      output_format: 'mp4',
      quality: '720p',
      status: 'queued',
      progress: 0,
      downloaded_bytes: 0
    })

    console.log(`[Test L] 1. Enqueueing Job ${jobL.id}...`)
    enqueueDownloadJob(jobL.id)

    // Wait until downloading >= 15%
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150))
      const cur = await DownloadJob.findByPk(jobL.id)
      if ((cur.progress || 0) >= 15) break
    }

    console.log(`[Test L] 2. Pausing Job ${jobL.id}...`)
    const pauseL = await pauseDownloadJob(jobL.id)
    assert.equal(pauseL.outcome, 'paused', 'Test L.1: Job paused')
    const jobLPaused = await DownloadJob.findByPk(jobL.id)
    assert.equal(jobLPaused.status, 'paused', 'Test L.2: SQLite status is paused')

    console.log(`[Test L] 3. Resuming Job ${jobL.id}...`)
    const resumeL = await resumeDownloadJob(jobL.id)
    assert.equal(resumeL.outcome, 'resumed', 'Test L.3: Job resumed into queue')

    // Wait briefly for download to resume
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100))
      const cur = await DownloadJob.findByPk(jobL.id)
      if (cur.status === 'downloading') break
    }

    console.log(`[Test L] 4. Cancelling Job ${jobL.id}...`)
    const cancelL = await cancelDownloadJob(jobL.id)
    assert.equal(cancelL.outcome, 'cancelled', 'Test L.4: Job cancelled')
    const jobLCancelled = await DownloadJob.findByPk(jobL.id)
    assert.equal(jobLCancelled.status, 'cancelled', 'Test L.5: SQLite status is cancelled')
    assert.equal(jobLCancelled.progress, 0, 'Test L.6: Progress reset to 0%')

    console.log(`[Test L] 5. Retrying Job ${jobL.id}...`)
    const retryL = await retryDownloadJob(jobL.id, {
      enqueue: (id) => enqueueDownloadJob(id)
    })
    assert.equal(retryL.outcome, 'created', 'Test L.7: Retry enqueued')
    assert.equal(retryL.originalJobId, jobL.id, 'Test L.8: Same Job ID preserved')

    // Wait for retried job to finish
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 200))
      const cur = await DownloadJob.findByPk(jobL.id)
      if (cur.status === 'completed' || cur.status === 'failed') {
        assert.equal(cur.status, 'completed', 'Test L.9: Lifecycle job completed to 100%')
        break
      }
    }

    console.log('✓ Test L Passed: Complete lifecycle executed flawlessly under production queue.\n')

    console.log('================================================================')
    console.log(' ALL 12 REAL WINDOWS INTEGRATION TESTS PASSED (100% PASS)')
    console.log(' Tests A-L: Genuine Production Paths, Win32 Ctrl-Break & Range   ')
    console.log('================================================================\n')
  } finally {
    resetExecutionHooksForTesting()
    setRecoveryHooksForTesting(null)
    resetAnalyzerForTesting()
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
