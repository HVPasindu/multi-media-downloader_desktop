import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const TEST_SUITES = [
  {
    name: 'Group A & B: Platform Download & Metadata Normalization',
    file: 'tests/platform_download_tests.js'
  },
  {
    name: 'Group C: Download Progress Parsing & Calculation',
    file: 'tests/download_progress_tests.js'
  },
  {
    name: 'Group D & E: Download Queue, FIFO & Cancellation Lifecycle',
    file: 'tests/download_queue_tests.js'
  },
  {
    name: 'Group F & G: Interrupted Job Recovery & SQLite Lock Concurrency',
    file: 'tests/download_lifecycle_tests.js'
  },
  {
    name: 'Group H: Settings Validation & Preference Updates',
    file: 'tests/download_settings_tests.js'
  },
  {
    name: 'Group I: Filesystem Safety & Temporary Directory Cleanup',
    file: 'tests/download_filesystem_safety_tests.js'
  },
  {
    name: 'Group J: Download History Querying, Filtering & File Preservation',
    file: 'tests/download_history_tests.js'
  },
  {
    name: 'Regression: Targeted Safety Fixes Suite',
    file: 'tests/safety_fixes_tests.js'
  },
  {
    name: 'Security: Media URL Validation & Domain Security',
    file: 'tests/media_url_security_tests.js'
  },
  {
    name: 'Security: Local Express API Protection & IPC Tokens',
    file: 'tests/local_api_security_tests.js'
  },
  {
    name: 'API: API Documentation, Contracts & Response Validation',
    file: 'tests/api_contract_tests.js'
  },
  {
    name: 'Packaging: yt-dlp & FFmpeg Windows Packaging & Verification',
    file: 'tests/windows_packaging_tests.js'
  },
  {
    name: 'Step 04.45: Link Downloader Full Backend E2E Suite (Mocked Media Tools)',
    file: 'tests/link_downloader_e2e_tests.js'
  }
]

async function runSingleSuite(suite) {
  const loaderPath = './tests/loaders/electron_loader.mjs'
  const testFile = suite.file

  const startTime = Date.now()
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--loader', loaderPath, testFile], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test'
      }
    })

    child.on('close', (exitCode) => {
      const durationMs = Date.now() - startTime
      resolve({
        suite: suite.name,
        file: suite.file,
        passed: exitCode === 0,
        exitCode,
        durationMs
      })
    })

    child.on('error', (err) => {
      const durationMs = Date.now() - startTime
      resolve({
        suite: suite.name,
        file: suite.file,
        passed: false,
        exitCode: 1,
        durationMs,
        error: err.message
      })
    })
  })
}

async function main() {
  console.log(
    '\n╔════════════════════════════════════════════════════════════════════════════════╗'
  )
  console.log('║        APPLAN2 — Automated Backend Test Runner (Step 04.44)                    ║')
  console.log(
    '╚════════════════════════════════════════════════════════════════════════════════╝\n'
  )

  const results = []
  const suiteStartTime = Date.now()

  for (const suite of TEST_SUITES) {
    console.log(`\n▶ Running: ${suite.name} (${suite.file})`)
    const result = await runSingleSuite(suite)
    results.push(result)
  }

  const totalDuration = ((Date.now() - suiteStartTime) / 1000).toFixed(2)
  const passedCount = results.filter((r) => r.passed).length
  const failedCount = results.filter((r) => !r.passed).length

  console.log(
    '\n\n════════════════════════════════════════════════════════════════════════════════'
  )
  console.log('                       BACKEND TEST SUITE SUMMARY                               ')
  console.log('════════════════════════════════════════════════════════════════════════════════')
  console.log('Status  | Duration | Suite Name')
  console.log('--------+----------+------------------------------------------------------------')

  for (const res of results) {
    const statusIcon = res.passed ? '✓ PASS ' : '❌ FAIL '
    const duration = `${(res.durationMs / 1000).toFixed(2)}s`.padStart(8)
    console.log(`${statusIcon} | ${duration} | ${res.suite}`)
  }

  console.log('--------+----------+------------------------------------------------------------')
  console.log(`Total Suites : ${results.length}`)
  console.log(`Passed       : ${passedCount}`)
  console.log(`Failed       : ${failedCount}`)
  console.log(`Total Time   : ${totalDuration}s`)
  console.log('════════════════════════════════════════════════════════════════════════════════\n')

  if (failedCount > 0) {
    console.error(`❌ Backend test run completed with ${failedCount} failing suite(s).\n`)
    process.exit(1)
  } else {
    console.log('🎉 ALL BACKEND TEST SUITES PASSED SUCCESSFULLY (100% PASS)!\n')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('Fatal runner error:', err)
  process.exit(1)
})
