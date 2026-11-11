import { spawn, execFileSync } from 'node:child_process'
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
    name: 'Step 01: Media Analysis In-Memory Cache & Deduplication',
    file: 'tests/media_analysis_cache_tests.js'
  },
  {
    name: 'Step 02: Error Classification, PO Token & Cooldown Enforcement',
    file: 'tests/media_analysis_error_tests.js'
  },
  {
    name: 'Step 04.45: Link Downloader Full Backend E2E Suite (Mocked Media Tools)',
    file: 'tests/link_downloader_e2e_tests.js'
  },
  {
    name: 'Phase 03: Downloads Manager & Sidebar Active Count (Step 07 & 08)',
    file: 'tests/downloads_manager_active_count_tests.js'
  },
  {
    name: 'Phase 04: Step 09 Network Recovery & Option A Restart Recovery Suite',
    file: 'tests/download_network_recovery_tests.js'
  },
  {
    name: 'Corrective Step 02: Duplicate Download Guard Test Suite (A–N)',
    file: 'tests/duplicate_download_guard_tests.js'
  },
  {
    name: 'Phase 05: Step 10 Error Classification & User Notifications Suite',
    file: 'tests/step10_error_presentation_tests.js'
  },
  {
    name: 'Phase 05: Step 11 Clear All / Clear Completed Persistence Suite',
    file: 'tests/step11_clear_history_persistence_tests.js'
  },
  {
    name: 'Phase 05: Step 12 Downloads Manager Pagination & Search Suite',
    file: 'tests/step12_pagination_search_tests.js'
  },
  {
    name: 'Phase 05: Step 13 Summary Dynamic Counts & Large Dataset Suite',
    file: 'tests/step13_summary_large_dataset_tests.js'
  },
  {
    name: 'Phase 05: Step 14 Desktop Frontend & E2E Integration Suite',
    file: 'tests/step14_frontend_download_api_tests.js'
  },
  {
    name: 'Order 10: Progress, ETA, File Size, Same-Job Retry & Clear Failed Suite',
    file: 'tests/download_progress_eta_retry_tests.js'
  },
  {
    name: 'Order 11: Real Pause/Resume, Cancel, Retry & Completed File Actions Suite',
    file: 'tests/download_pause_resume_tests.js'
  },
  {
    name: 'Order 12: Real Windows yt-dlp Process Integration Tests (Tests A–L)',
    file: 'tests/windows_real_pause_cancel_integration_tests.js'
  },
  {
    name: 'Order 13: React Download Actions Hook Integration Test (Simulated Desktop UI Workflow)',
    file: 'tests/electron_download_actions_e2e_tests.js'
  },
  {
    name: 'Security: Settings IPC Sender Hardening & Multi-Window Isolation',
    file: 'tests/settings_ipc_security_tests.js'
  },
  {
    name: 'Appearance: Global Theme & Accessibility',
    file: 'tests/appearance_theme_tests.mjs'
  },
  {
    name: 'Stage 05.14: Frontend React DOM & StrictMode E2E',
    file: 'tests/step0514_frontend_dom_e2e_tests.mjs'
  },
  {
    name: 'Stage 05.14: Layer A <-> Express Live API Integration E2E',
    file: 'tests/step0514_api_integration_e2e_tests.js'
  },
  {
    name: 'Stage 05.14: Frontend Performance, Leak & 250-Row Pagination E2E',
    file: 'tests/step0514_performance_smoke_tests.mjs'
  }
]

async function runSingleSuite(suite) {
  const loaderPath = './tests/loaders/electron_loader.mjs'
  const testFile = suite.file
  const timeoutMs = suite.timeoutMs || (suite.file.includes('integration') ? 240000 : 120000)

  const startTime = Date.now()
  return new Promise((resolve) => {
    let settled = false
    let timedOut = false

    const settle = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      resolve(result)
    }

    const child = spawn(process.execPath, ['--loader', loaderPath, testFile], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test'
      }
    })

    const timeoutTimer = setTimeout(() => {
      timedOut = true
      console.error(
        `\n[TIMEOUT] Test suite "${suite.name}" exceeded ${timeoutMs}ms. Terminating process tree...`
      )
      if (child.pid) {
        if (process.platform === 'win32') {
          try {
            execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
              stdio: 'ignore'
            })
          } catch (tkErr) {
            console.warn(`[runner] taskkill warning for PID ${child.pid}:`, tkErr.message)
            try {
              child.kill('SIGKILL')
            } catch {
              // Ignore fallback error
            }
          }

          // Defensive termination of any remaining descendant processes via PowerShell Get-CimInstance
          try {
            const cleanupScript = `
              $targetPid = ${child.pid}
              $children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $targetPid }
              foreach ($proc in $children) {
                try { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
              }
            `
            execFileSync(
              'powershell.exe',
              ['-NoProfile', '-NonInteractive', '-Command', cleanupScript],
              {
                stdio: 'ignore'
              }
            )
          } catch {
            // Best-effort descendant sweep
          }

          // Verify process exit with bounded polling loop
          let stillRunning = true
          for (let attempt = 0; attempt < 20; attempt++) {
            try {
              process.kill(child.pid, 0)
              const waitBuffer = new Int32Array(new SharedArrayBuffer(4))
              Atomics.wait(waitBuffer, 0, 0, 50)
            } catch {
              stillRunning = false
              break
            }
          }

          if (stillRunning) {
            console.error(
              `[runner] FATAL: Process tree for PID ${child.pid} could not be confirmed terminated.`
            )
          }
        } else {
          try {
            process.kill(-child.pid, 'SIGKILL')
          } catch {
            child.kill('SIGKILL')
          }
        }
      }

      settle({
        suite: suite.name,
        file: suite.file,
        passed: false,
        blocked: false,
        exitCode: 124,
        durationMs: Date.now() - startTime,
        error: `Suite timed out after ${timeoutMs}ms`
      })
    }, timeoutMs)

    child.on('close', (exitCode) => {
      const durationMs = Date.now() - startTime
      const isBlocked = !timedOut && exitCode === 2
      settle({
        suite: suite.name,
        file: suite.file,
        passed: !timedOut && exitCode === 0,
        blocked: isBlocked,
        exitCode: timedOut ? 124 : exitCode,
        durationMs,
        error: timedOut ? `Suite timed out after ${timeoutMs}ms` : undefined
      })
    })

    child.on('error', (err) => {
      const durationMs = Date.now() - startTime
      settle({
        suite: suite.name,
        file: suite.file,
        passed: false,
        blocked: false,
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
  console.log('║        APPLAN2 — Automated Backend & Appearance Test Runner                    ║')
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
  const blockedCount = results.filter((r) => r.blocked).length
  const failedCount = results.filter((r) => !r.passed && !r.blocked).length

  console.log(
    '\n\n════════════════════════════════════════════════════════════════════════════════'
  )
  console.log('                BACKEND & APPEARANCE TEST SUITE SUMMARY                         ')
  console.log('════════════════════════════════════════════════════════════════════════════════')
  console.log('Status      | Duration | Suite Name')
  console.log(
    '------------+----------+------------------------------------------------------------'
  )

  for (const res of results) {
    let statusIcon = '❌ FAIL    '
    if (res.passed) {
      statusIcon = '✓ PASS    '
    } else if (res.blocked) {
      statusIcon = '⚠️ BLOCKED '
    }
    const duration = `${(res.durationMs / 1000).toFixed(2)}s`.padStart(8)
    console.log(`${statusIcon} | ${duration} | ${res.suite}`)
  }

  console.log(
    '------------+----------+------------------------------------------------------------'
  )
  console.log(`Total Suites : ${results.length}`)
  console.log(`Passed       : ${passedCount}`)
  if (blockedCount > 0) {
    console.log(`Blocked      : ${blockedCount}`)
  }
  console.log(`Failed       : ${failedCount}`)
  console.log(`Total Time   : ${totalDuration}s`)
  console.log('════════════════════════════════════════════════════════════════════════════════\n')

  if (failedCount > 0) {
    console.error(`❌ Test run completed with ${failedCount} failing suite(s).\n`)
    process.exit(1)
  } else if (blockedCount > 0) {
    console.log(
      `⚠️ All executable test suites passed (${passedCount} passed, ${blockedCount} blocked by external challenge).\n`
    )
    process.exit(0)
  } else {
    console.log('🎉 ALL BACKEND & APPEARANCE TEST SUITES PASSED SUCCESSFULLY (100% PASS)!\n')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('Fatal runner error:', err)
  process.exit(1)
})
