import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createApiApp } from '../../src/main/backend/app.js'
import {
  initSessionToken,
  resetSessionTokenForTest,
  LOCAL_API_HOST,
  LOCAL_API_PORT
} from '../../src/main/backend/services/localApiSecurityService.js'
import { createTestDatabase } from './testDatabase.js'
import { getDatabase } from '../../src/main/backend/config/database.js'

/**
 * ============================================================================
 * APPLAN2 — Step 04.45 Backend E2E Test Environment Helper
 *
 * Provides a fully isolated loopback test environment for backend E2E testing:
 * - Dedicated OS temporary folder (isolated from production and user data)
 * - Isolated SQLite database with complete migrations
 * - Express HTTP server running on ephemeral loopback port
 * - Secure test API token configuration
 * - Controlled mock media tool layer for deterministic yt-dlp & ffprobe execution
 * - Clean teardown releasing ports, database connections, and filesystem resources
 * ============================================================================
 */

export const YOUTUBE_SYNTHETIC_FIXTURE = Object.freeze({
  id: 'dQw4w9WgXcQ',
  title: 'Test YouTube Media Title',
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
  duration: 212,
  formats: [
    {
      format_id: '137',
      ext: 'mp4',
      height: 1080,
      vcodec: 'avc1.640028',
      acodec: 'none',
      filesize: 50000000
    },
    {
      format_id: '136',
      ext: 'mp4',
      height: 720,
      vcodec: 'avc1.4d401f',
      acodec: 'none',
      filesize: 25000000
    },
    {
      format_id: '135',
      ext: 'mp4',
      height: 480,
      vcodec: 'avc1.4d401e',
      acodec: 'none',
      filesize: 15000000
    },
    {
      format_id: '140',
      ext: 'm4a',
      height: null,
      vcodec: 'none',
      acodec: 'mp4a.40.2',
      filesize: 3500000
    },
    {
      format_id: '18',
      ext: 'mp4',
      height: 360,
      vcodec: 'avc1.42001E',
      acodec: 'mp4a.40.2',
      filesize: 12000000
    }
  ]
})

export class MockChildProcess extends EventEmitter {
  constructor(pid = Math.floor(Math.random() * 50000) + 1000) {
    super()
    this.pid = pid
    this.stdout = new PassThrough()
    this.stderr = new PassThrough()
    this.killed = false
    this.exitCode = null
  }

  kill(signal = 'SIGTERM') {
    if (this.killed) return true
    this.killed = true
    this.emit('kill_requested', signal)
    process.nextTick(() => {
      this.emit('close', null, signal)
    })
    return true
  }
}

export async function createE2eEnvironment(prefix = 'applan2-e2e-') {
  // 1. Dedicated test workspace
  const tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const downloadFolder = path.join(tempWorkspace, 'downloads')
  await fs.mkdir(downloadFolder, { recursive: true })

  // 2. Isolated test database
  const testDb = await createTestDatabase('applan2-e2e-db-')
  const { AppSetting } = getDatabase().models

  // Set download path in settings to our isolated download folder
  await AppSetting.upsert({
    key: 'download_path',
    value: path.resolve(downloadFolder)
  })

  // 3. Predictable session token
  const validToken = 'e2e_session_token_' + Date.now() + '_32_bytes_secret'
  initSessionToken(validToken)

  // 4. Start isolated Express app instance
  const app = createApiApp()
  const server = http.createServer(app)
  let port = 0

  await new Promise((resolve) => {
    server.listen(0, LOCAL_API_HOST, () => {
      port = server.address().port
      resolve()
    })
  })

  // Mock tool controller configuration
  const activeMockProcesses = new Map()
  let simulatedFailureRules = {}
  let spawnDelayMs = 10

  // Configure global mock handler
  globalThis.__mockChildProcess = {
    execFile: (executable, args, options, callback) => {
      if (typeof options === 'function') {
        callback = options
        options = {}
      }

      const argsList = Array.isArray(args) ? args : []

      // 0. Process termination handler for taskkill.exe on Windows
      if (typeof executable === 'string' && executable.toLowerCase().includes('taskkill')) {
        const pidIdx = argsList.indexOf('/PID')
        if (pidIdx !== -1) {
          const targetPid = Number(argsList[pidIdx + 1])
          for (const mockProc of activeMockProcesses.values()) {
            if (mockProc.pid === targetPid) {
              mockProc.kill('SIGTERM')
            }
          }
        }
        if (typeof callback === 'function') {
          process.nextTick(() => callback(null, { stdout: 'SUCCESS', stderr: '' }))
        }
        return {}
      }

      // 1. Media metadata analysis mock (yt-dlp --dump-single-json)
      if (argsList.includes('--dump-single-json')) {
        if (simulatedFailureRules.analyzeFail) {
          const err = new Error(simulatedFailureRules.analyzeErrorMsg || 'yt-dlp analyze failed')
          err.code = 1
          if (typeof callback === 'function') {
            process.nextTick(() => callback(err, { stdout: '', stderr: err.message }))
          }
          return {}
        }

        const metadata = simulatedFailureRules.customMetadata || YOUTUBE_SYNTHETIC_FIXTURE
        if (typeof callback === 'function') {
          process.nextTick(() => {
            callback(null, { stdout: JSON.stringify(metadata), stderr: '' })
          })
        }
        return {}
      }

      // 2. FFprobe media container & stream verification mock
      if (argsList.includes('-show_entries')) {
        if (simulatedFailureRules.ffprobeFail) {
          const err = new Error('FFprobe failed to inspect media file')
          err.code = simulatedFailureRules.ffprobeNotFound ? 'ENOENT' : 1
          if (typeof callback === 'function') {
            process.nextTick(() => callback(err, { stdout: '', stderr: err.message }))
          }
          return {}
        }

        const targetFile = argsList[argsList.length - 1]
        const ext = path.extname(targetFile).toLowerCase().slice(1)

        let probeJson
        if (ext === 'mp3') {
          probeJson = {
            format: { format_name: 'mp3' },
            streams: [{ codec_type: 'audio', codec_name: 'mp3' }]
          }
        } else {
          probeJson = {
            format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
            streams: [
              { codec_type: 'video', codec_name: 'h264' },
              { codec_type: 'audio', codec_name: 'aac' }
            ]
          }
        }

        if (typeof callback === 'function') {
          process.nextTick(() => {
            callback(null, { stdout: JSON.stringify(probeJson), stderr: '' })
          })
        }
        return {}
      }

      // Unmatched execFile calls fall back to empty success
      if (typeof callback === 'function') {
        process.nextTick(() => callback(null, { stdout: '', stderr: '' }))
      }
      return {}
    },

    spawn: (executable, args, options) => {
      const child = new MockChildProcess()

      // Parse jobId from arguments or options
      let jobId = options?.jobId ?? null
      const argsList = Array.isArray(args) ? args : []

      if (!jobId) {
        // Find jobId from output template if embedded
        const templateArg = argsList[argsList.indexOf('-o') + 1]
        const match = /\[job-(\d+)\]/.exec(templateArg || '')
        if (match) {
          jobId = Number(match[1])
        }
      }

      activeMockProcesses.set(jobId, child)

      // Check if job should be held in pending/downloading state (for queue concurrency tests)
      const shouldHold = Boolean(simulatedFailureRules.holdJobs?.includes(jobId))

      const executeJobSimulation = async () => {
        if (spawnDelayMs > 0) {
          await new Promise((r) => setTimeout(r, spawnDelayMs))
        }

        if (child.killed) return

        // Simulated yt-dlp failure
        if (simulatedFailureRules.ytDlpFailJobs?.includes(jobId)) {
          child.stderr.write('ERROR: [youtube] Connection reset by peer\n')
          child.stderr.end()
          child.stdout.end()
          child.emit('close', 1, null)
          return
        }

        // Determine output file path
        const isMp3 = argsList.includes('-x') || argsList.includes('--extract-audio')
        const ext = isMp3 ? 'mp3' : 'mp4'
        const outFileName = `download_output_[job-${jobId}].${ext}`
        const finalFilePath = path.join(downloadFolder, outFileName)

        // Write progress events
        child.stdout.write(`[download]  50.0% of 10.00MiB at 2.00MiB/s ETA 00:05\n`)
        child.stdout.write(
          `APPLAN2_PROGRESS:${isMp3 ? 'audio' : 'video'}:50.0:5242880:10485760:downloading\n`
        )
        child.stdout.write(`[download] 100.0% of 10.00MiB at 2.00MiB/s ETA 00:00\n`)
        child.stdout.write(
          `APPLAN2_PROGRESS:${isMp3 ? 'audio' : 'video'}:100.0:10485760:10485760:finished\n`
        )

        // Create actual physical media file on disk unless simulated missing
        if (!simulatedFailureRules.missingOutputFileJobs?.includes(jobId)) {
          await fs.writeFile(finalFilePath, Buffer.alloc(2048, 0x5a))
        }

        child.stdout.write(`APPLAN2_FINAL_FILE:${finalFilePath}\n`)
        child.stdout.end()
        child.stderr.end()
        child.emit('close', 0, null)
      }

      if (!shouldHold) {
        process.nextTick(executeJobSimulation)
      } else {
        // Expose release trigger
        child.releaseExecution = () => {
          process.nextTick(executeJobSimulation)
        }
      }

      return child
    }
  }

  // HTTP client helper
  function makeRequest({ path: reqPath, method = 'GET', headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
      const finalHeaders = {
        host: `127.0.0.1:${LOCAL_API_PORT}`,
        authorization: `Bearer ${validToken}`,
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

  // Deterministic bounded polling helper for asynchronous job status
  async function waitForJobState(jobId, predicate, timeoutMs = 6000) {
    const { DownloadJob } = getDatabase().models
    const start = Date.now()

    while (Date.now() - start < timeoutMs) {
      const job = await DownloadJob.findByPk(jobId)
      if (job && predicate(job)) {
        return job
      }
      await new Promise((r) => setTimeout(r, 30))
    }

    const finalJob = await DownloadJob.findByPk(jobId)
    throw new Error(
      `Job ${jobId} failed to reach expected state within ${timeoutMs}ms (current status: ${finalJob?.status}, progress: ${finalJob?.progress})`
    )
  }

  return {
    port,
    validToken,
    tempWorkspace,
    downloadFolder,
    testDb,
    request: makeRequest,
    waitForJobState,
    setFailureRules: (rules) => {
      simulatedFailureRules = { ...rules }
    },
    getActiveMockProcess: (jobId) => activeMockProcesses.get(jobId),
    async cleanup() {
      // 1. Reset mock
      globalThis.__mockChildProcess = null

      // 2. Stop HTTP server
      await new Promise((resolve) => {
        server.close(() => resolve())
      })

      // 3. Reset session token
      resetSessionTokenForTest()

      // 4. Close and cleanup isolated SQLite database
      await testDb.cleanup()

      // 5. Clean up temporary directory
      if (
        tempWorkspace &&
        tempWorkspace.startsWith(os.tmpdir()) &&
        fsSync.existsSync(tempWorkspace)
      ) {
        await fs.rm(tempWorkspace, { recursive: true, force: true }).catch(() => {})
      }
    }
  }
}
