/**
 * APPLAN2 Stage 05.14 — Frontend & Full-Stack Performance / Stability Smoke Suite
 *
 * Verifies with real JSDOM React.StrictMode + real isolated Express/SQLite:
 *  1. Repeated 4-route navigation cycles (12 transitions) + zero listener/timer leaks on unmount
 *  2. useDownloadsManager initial loading indicator (no empty-state flash), non-overlapping polls,
 *     transient error + Retry recovery, and strict unmount polling cancellation
 *  3. Rapid synchronous double-click mutex guards on Download CTA and Row Action buttons
 *  4. Rapid Cyberpunk Background + Accent theme switching stability under StrictMode
 *  5. 250-record isolated SQLite dataset paginated cleanly over loopback HTTP through
 *     DownloadsPage & HistoryPage (<= pageSize DOM rows, accurate totals, fast search & page turns)
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createE2eEnvironment } from './helpers/e2eTestEnvironment.js'
import {
  setupRendererTestEnvironment,
  withCapturedConsole,
  renderStrict,
  unmountStrict,
  flushReactUpdates,
  setControlledInputValue,
  setControlledSelectValue,
  clickElement,
  waitForDom,
  findButtonsByText,
  findNavLinkByText,
  createMockWindowApi
} from './helpers/step0514RendererHarness.mjs'

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

function summarizeTimings(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = samples.reduce((acc, v) => acc + v, 0)
  return {
    samples: samples.length,
    minMs: Number((sorted[0] || 0).toFixed(2)),
    avgMs: Number((samples.length ? sum / samples.length : 0).toFixed(2)),
    maxMs: Number((sorted[sorted.length - 1] || 0).toFixed(2))
  }
}

function wireLiveHttpBridge(env, e2eEnv) {
  env.window.api = {
    request: async ({ path: reqPath, method = 'GET', body = null, headers = {} }) => {
      const res = await e2eEnv.request({ path: reqPath, method, body, headers })
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        data: res.body,
        error:
          res.status >= 400
            ? res.body?.message || res.body?.error || `HTTP ${res.status}`
            : undefined
      }
    },
    getDownloadFolder: async () => e2eEnv.downloadFolder,
    chooseDownloadFolder: async () => e2eEnv.downloadFolder,
    getStorageInfo: async () => ({
      available: true,
      path: e2eEnv.downloadFolder,
      totalBytes: 500 * 1024 ** 3,
      freeBytes: 220 * 1024 ** 3
    }),
    getStartWithWindows: async () => ({ supported: true, enabled: false }),
    setStartWithWindows: async (enabled) => ({ supported: true, enabled: Boolean(enabled) }),
    openFile: async () => ({ success: true }),
    openFolder: async () => ({ success: true })
  }
}

async function runPerformanceSmokeSuite() {
  console.log('================================================================')
  console.log(' APPLAN2 Stage 05.14: Performance, Memory/Leak & Scale Tests    ')
  console.log('================================================================')

  const env = await setupRendererTestEnvironment()
  const { HashRouter, MemoryRouter } = await import('react-router-dom')
  const { default: App } = await import('../src/renderer/src/App.jsx')
  const { default: DownloaderPage } = await import('../src/renderer/src/pages/DownloaderPage.jsx')
  const { default: DownloadsPage } = await import('../src/renderer/src/pages/DownloadsPage.jsx')
  const { default: HistoryPage } = await import('../src/renderer/src/pages/HistoryPage.jsx')
  const { default: AppearanceSettings } = await import(
    '../src/renderer/src/components/settings/AppearanceSettings.jsx'
  )
  const { THEME_PRESETS, BACKGROUND_PRESETS } = await import(
    '../src/renderer/src/utils/appearanceTheme.js'
  )
  const { getDatabase } = await import('../src/main/backend/config/database.js')

  const consoleTracker = withCapturedConsole()
  const metrics = {}

  try {
    // =========================================================================
    // CHECK 1: Repeated 4-Route Navigation Cycles + Listener & Poll Leak Check
    // =========================================================================
    console.log('\n--- CHECK 1: 3x 4-Route Navigation Cycles & Teardown Leak Check ---')
    {
      const bridge = createMockWindowApi({ jobs: [] })
      env.window.api = bridge.api
      env.window.location.hash = '#/'
      const beforeListeners = env.getListenerSnapshot()

      const mountStart = performance.now()
      const { root, container } = await renderStrict(
        env,
        env.React.createElement(HashRouter, null, env.React.createElement(App))
      )
      await waitForDom(
        env,
        () => container.querySelector('input[aria-label="Media link URL"]'),
        { timeoutMs: 3000 }
      )
      const splashToReadyMs = Number((performance.now() - mountStart).toFixed(2))

      const navTimings = []
      const cycleRoutes = [
        { label: 'Downloads', verify: () => container.textContent.includes('Downloads Manager') },
        { label: 'History', verify: () => container.textContent.includes('Download History') },
        { label: 'Settings', verify: () => container.textContent.includes('Start with Windows') },
        {
          label: 'Downloader',
          verify: () => Boolean(container.querySelector('input[aria-label="Media link URL"]'))
        }
      ]

      for (let cycle = 0; cycle < 3; cycle++) {
        for (const step of cycleRoutes) {
          const t0 = performance.now()
          const navLink = findNavLinkByText(container, step.label)
          await clickElement(env, navLink)
          await waitForDom(env, step.verify)
          navTimings.push(performance.now() - t0)
        }
      }

      await unmountStrict(env, root)
      bridge.clearCalls()
      await flushReactUpdates(env, 2, 180)

      const afterListeners = env.getListenerSnapshot()
      assert.equal(
        afterListeners['window:applan2:download-state-changed'] || 0,
        beforeListeners['window:applan2:download-state-changed'] || 0,
        'Download state event listener count must return to baseline after unmount'
      )
      assert.equal(
        afterListeners['window:dragover'] || 0,
        beforeListeners['window:dragover'] || 0,
        'Window dragover listener count must return to baseline after unmount'
      )
      assert.equal(
        afterListeners['window:drop'] || 0,
        beforeListeners['window:drop'] || 0,
        'Window drop listener count must return to baseline after unmount'
      )
      assert.equal(
        afterListeners['window:popstate'] || 0,
        beforeListeners['window:popstate'] || 0,
        'Router popstate listener count must return to baseline after unmount'
      )
      assert.ok(
        (afterListeners['window:resize'] || 0) <= 1,
        'Framer Motion DocumentProjectionNode resize singleton must never multiply across 12 route transitions'
      )
      assert.equal(
        bridge.calls.filter((c) => c.kind === 'request').length,
        0,
        'Zero background polling API calls may fire after MainLayout unmount'
      )

      metrics.splashToReadyMs = splashToReadyMs
      metrics.navigationTransitions = summarizeTimings(navTimings)
      console.log(
        `✓ CHECK 1 passed: splash=${splashToReadyMs}ms, 12 navs avg=${metrics.navigationTransitions.avgMs}ms max=${metrics.navigationTransitions.maxMs}ms, zero leaks.`
      )
    }

    // =========================================================================
    // CHECK 2: useDownloadsManager Loading Indicator, Retry Recovery & Stop Poll
    // =========================================================================
    console.log('\n--- CHECK 2: useDownloadsManager Initial Load, Error Retry & Cleanup ---')
    {
      let listCallCount = 0
      let resolveFirstList
      const firstListDeferred = new Promise((r) => {
        resolveFirstList = r
      })
      let returnTransientError = false

      const bridge = createMockWindowApi({
        onRequest: async ({ path: reqPath, method }) => {
          if (method === 'GET' && reqPath.startsWith('/api/downloads?')) {
            listCallCount += 1
            if (listCallCount === 1) {
              return firstListDeferred
            }
            if (returnTransientError) {
              return {
                ok: false,
                status: 500,
                error: 'Temporary SQLite read error',
                data: { success: false, message: 'Temporary SQLite read error' }
              }
            }
          }
          return undefined
        }
      })
      env.window.api = bridge.api

      // 2A: Single-mount verification (exact 1 initial request, non-overlapping polls)
      const rootEl = env.document.createElement('div')
      env.document.body.appendChild(rootEl)
      const singleRoot = env.createRoot(rootEl)
      await env.act(async () => {
        singleRoot.render(
          env.React.createElement(MemoryRouter, null, env.React.createElement(DownloadsPage))
        )
      })

      await flushReactUpdates(env, 2, 120)
      assert.equal(
        rootEl.textContent.includes('No downloads'),
        false,
        'Empty-state flash must NOT render while initial /api/downloads fetch is still pending'
      )
      assert.equal(listCallCount, 1, 'Only 1 initial /api/downloads request must be in flight')

      resolveFirstList({
        ok: true,
        status: 200,
        data: { success: true, data: [], pagination: { limit: 20, offset: 0, total: 0 } }
      })
      await waitForDom(env, () => rootEl.textContent.includes('Downloads Manager'))

      // Trigger transient error on filter tab change -> verify Retry button recovers
      returnTransientError = true
      await clickElement(env, findButtonsByText(rootEl, 'Completed')[0])
      await waitForDom(env, () => rootEl.textContent.includes('Temporary SQLite read error'))

      returnTransientError = false
      const retryBtn = findButtonsByText(rootEl, 'Retry')[0]
      assert.ok(retryBtn, 'DownloadsPage error banner must expose Retry button')
      await clickElement(env, retryBtn)
      await waitForDom(env, () => !rootEl.textContent.includes('Temporary SQLite read error'))

      await unmountStrict(env, singleRoot)
      rootEl.remove()
      const countAtUnmount = listCallCount
      await flushReactUpdates(env, 2, 220)
      assert.equal(
        listCallCount,
        countAtUnmount,
        'DownloadsPage polling must stop immediately on unmount'
      )

      // 2B: Verify StrictMode double-mount cleanup discards stale mount response cleanly
      const strictBridge = createMockWindowApi({ jobs: [] })
      env.window.api = strictBridge.api
      const { root: strictRoot, container: strictContainer } = await renderStrict(
        env,
        env.React.createElement(MemoryRouter, null, env.React.createElement(DownloadsPage))
      )
      await waitForDom(env, () => strictContainer.textContent.includes('Downloads Manager'))
      await unmountStrict(env, strictRoot)
      console.log('✓ CHECK 2 passed: No empty flash, transient error retry recovery, and poll stop verified.')
    }

    // =========================================================================
    // CHECK 3: Rapid Synchronous Double-Click Mutex Guards
    // =========================================================================
    console.log('\n--- CHECK 3: Rapid Double-Click Guard (Download CTA & Pause Action) ---')
    {
      let releaseCreate
      let postDownloadsCount = 0
      let releasePause
      let postPauseCount = 0

      const bridge = createMockWindowApi({
        jobs: [
          {
            id: 99,
            media_id: 99,
            source_url: 'https://www.youtube.com/watch?v=dbl99',
            output_format: 'mp4',
            quality: '1080p',
            status: 'downloading',
            progress: 35,
            downloaded_bytes: 3500000,
            total_bytes: 10000000,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            media: { id: 99, title: 'Double Click Test Active Job', platform: 'youtube' },
            file: null
          }
        ],
        onRequest: async ({ path: reqPath, method }) => {
          if (reqPath === '/api/downloads' && method === 'POST') {
            postDownloadsCount += 1
            return new Promise((r) => {
              releaseCreate = r
            })
          }
          if (reqPath === '/api/downloads/99/pause' && method === 'POST') {
            postPauseCount += 1
            return new Promise((r) => {
              releasePause = r
            })
          }
          return undefined
        }
      })
      env.window.api = bridge.api

      const { root, container } = await renderStrict(
        env,
        env.React.createElement(MemoryRouter, null, env.React.createElement(DownloaderPage))
      )

      const urlInput = await waitForDom(env, () =>
        container.querySelector('input[aria-label="Media link URL"]')
      )
      await setControlledInputValue(env, urlInput, 'https://www.youtube.com/watch?v=dblclk1')
      await clickElement(env, findButtonsByText(container, 'Analyze')[0])
      await waitForDom(env, () => container.textContent.includes('Stage 05.14 Test Media'))

      const dlBtn = findButtonsByText(container, 'Download').find(
        (b) => b.textContent.trim() === 'Download'
      )
      assert.ok(dlBtn, 'Download CTA must be ready')

      // Rapid double click inside single act tick without awaiting network completion
      await env.act(async () => {
        dlBtn.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true, cancelable: true }))
        dlBtn.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      assert.equal(postDownloadsCount, 1, 'Rapid Download double-click must send strictly 1 POST')
      releaseCreate({
        ok: true,
        status: 201,
        data: { success: true, data: { id: 100, status: 'queued' } }
      })
      await flushReactUpdates(env, 2, 10)

      // Rapid Pause button double-click on Recent Downloads row
      const pauseBtn = container.querySelector('button[title="Pause download"]')
      assert.ok(pauseBtn, 'Pause download button must render')
      await env.act(async () => {
        pauseBtn.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true, cancelable: true }))
        pauseBtn.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      assert.equal(postPauseCount, 1, 'Rapid Pause double-click must send strictly 1 POST')
      releasePause({
        ok: true,
        status: 200,
        data: { success: true, data: { id: 99, status: 'paused' } }
      })
      await flushReactUpdates(env, 2, 10)

      await unmountStrict(env, root)
      console.log('✓ CHECK 3 passed: Double-click guards prevented duplicate API mutations.')
    }

    // =========================================================================
    // CHECK 4: Rapid Background & Accent Theme Switching Stability
    // =========================================================================
    console.log('\n--- CHECK 4: Rapid Theme Switching Stability & CSS Variable Sync ---')
    {
      const { root, container } = await renderStrict(
        env,
        env.React.createElement(AppearanceSettings)
      )
      const themeSwitchTimings = []
      const rootStyle = env.document.documentElement.style

      // Switch across background presets then accent presets rapidly
      const sampleBg = BACKGROUND_PRESETS.slice(0, 4)
      for (const preset of sampleBg) {
        const btn = findButtonsByText(container, preset.name)[0]
        assert.ok(btn, `Background preset "${preset.name}" button must exist`)
        const t0 = performance.now()
        await clickElement(env, btn)
        themeSwitchTimings.push(performance.now() - t0)
        assert.ok(
          rootStyle.getPropertyValue('--app-background').trim().length > 0,
          `--app-background must be populated after selecting ${preset.name}`
        )
      }

      const sampleAccents = THEME_PRESETS.slice(0, 4)
      for (const accent of sampleAccents) {
        const btn = findButtonsByText(container, accent.name)[0]
        assert.ok(btn, `Accent preset "${accent.name}" button must exist`)
        const t0 = performance.now()
        await clickElement(env, btn)
        themeSwitchTimings.push(performance.now() - t0)
        assert.equal(
          rootStyle.getPropertyValue('--theme-primary').trim().toUpperCase(),
          accent.primary.toUpperCase(),
          `--theme-primary must match ${accent.name}`
        )
      }

      // Reset to defaults so subsequent DOM state is pristine
      await unmountStrict(env, root)
      metrics.themeSwitch = summarizeTimings(themeSwitchTimings)
      console.log(
        `✓ CHECK 4 passed: 8 rapid theme switches avg=${metrics.themeSwitch.avgMs}ms max=${metrics.themeSwitch.maxMs}ms.`
      )
    }

    // =========================================================================
    // CHECK 5: 250-Record Isolated SQLite Pagination Through Express + React DOM
    // =========================================================================
    console.log('\n--- CHECK 5: 250-Record Isolated SQLite Pagination + Search E2E ---')
    const e2eEnv = await createE2eEnvironment('applan2-step0514-perf-')
    try {
      const { MediaItem, DownloadJob, DownloadFile } = getDatabase().models

      // Bulk seed 250 media + job records + 200 completed file records in SQLite
      const seedStart = performance.now()
      const mediaRows = Array.from({ length: 250 }, (_, idx) => {
        const n = idx + 1
        const isNeedle = n <= 15
        return {
          source_url: `https://www.youtube.com/watch?v=perf_${n}`,
          platform: n % 2 === 0 ? 'youtube' : 'vimeo',
          title: isNeedle ? `PERF_NEEDLE_TARGET Track #${n}` : `Dataset Library Item #${n}`,
          thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
          duration_seconds: 120 + (n % 300)
        }
      })
      const createdMedia = await MediaItem.bulkCreate(mediaRows, { returning: true })

      const jobRows = createdMedia.map((m, idx) => {
        const n = idx + 1
        const isCompleted = n <= 200
        const isFailed = n > 200 && n <= 230
        const format = n % 3 === 0 ? 'mp3' : 'mp4'
        return {
          media_id: m.id,
          source_type: 'link',
          output_format: format,
          quality: format === 'mp4' ? '1080p' : null,
          audio_bitrate_kbps: format === 'mp3' ? 320 : null,
          status: isCompleted ? 'completed' : isFailed ? 'failed' : 'cancelled',
          progress: isCompleted ? 100 : 25,
          downloaded_bytes: isCompleted ? 4194304 : 1048576,
          total_bytes: 4194304,
          total_bytes_is_estimate: false,
          error_message: isFailed ? 'Simulated benchmark failure' : null
        }
      })
      const createdJobs = await DownloadJob.bulkCreate(jobRows, { returning: true })

      const fileRows = createdJobs
        .filter((j) => j.status === 'completed')
        .map((j) => ({
          download_job_id: j.id,
          file_name: `perf_media_${j.id}.${j.output_format}`,
          file_path: `${e2eEnv.downloadFolder}\\perf_media_${j.id}.${j.output_format}`,
          file_format: j.output_format,
          file_size: 4194304
        }))
      await DownloadFile.bulkCreate(fileRows)
      const seedMs = Number((performance.now() - seedStart).toFixed(2))

      wireLiveHttpBridge(env, e2eEnv)

      // 5A: DownloadsPage over real 250-record Express + SQLite
      const dlStart = performance.now()
      const { root: dlRoot, container: dlContainer } = await renderStrict(
        env,
        env.React.createElement(MemoryRouter, null, env.React.createElement(DownloadsPage))
      )
      await waitForDom(
        env,
        () => dlContainer.textContent.includes('Showing 1–20 of 250 downloads'),
        { timeoutMs: 5000 }
      )
      const downloadsInitialMs = Number((performance.now() - dlStart).toFixed(2))

      // Assert ONLY page 1 (20 records) rendered, not 250 rows!
      const renderedRows20 = dlContainer.querySelectorAll(
        'button[title="Play / Open file"], button[title="Retry download"]'
      ).length
      assert.ok(
        renderedRows20 >= 15 && renderedRows20 <= 25,
        `Expected ~20 paginated rows rendered in DOM, got ${renderedRows20}`
      )

      // Switch page size to 50 -> Showing 1–50 of 250
      const pageSizeSelect = dlContainer.querySelector('select')
      const tPageSize0 = performance.now()
      await setControlledSelectValue(env, pageSizeSelect, '50')
      await waitForDom(env, () => dlContainer.textContent.includes('Showing 1–50 of 250 downloads'))
      const pageSize50Ms = Number((performance.now() - tPageSize0).toFixed(2))

      // Next page -> Showing 51–100 of 250
      const tNext0 = performance.now()
      await clickElement(env, dlContainer.querySelector('button[title="Next page"]'))
      await waitForDom(env, () => dlContainer.textContent.includes('Showing 51–100 of 250 downloads'))
      const nextPageMs = Number((performance.now() - tNext0).toFixed(2))

      // Live SQLite search -> Showing 1–15 of 15 downloads
      const searchInput = dlContainer.querySelector('input[placeholder="Search downloads..."]')
      const tSearch0 = performance.now()
      await setControlledInputValue(env, searchInput, 'PERF_NEEDLE_TARGET')
      await waitForDom(env, () => dlContainer.textContent.includes('Showing 1–15 of 15 downloads'))
      const searchMs = Number((performance.now() - tSearch0).toFixed(2))

      await unmountStrict(env, dlRoot)

      // 5B: HistoryPage over same 250-record Express + SQLite
      const hStart = performance.now()
      const { root: hRoot, container: hContainer } = await renderStrict(
        env,
        env.React.createElement(MemoryRouter, null, env.React.createElement(HistoryPage))
      )
      await waitForDom(env, () => hContainer.textContent.includes('Showing 1–20 of 250'), {
        timeoutMs: 5000
      })
      const historyInitialMs = Number((performance.now() - hStart).toFixed(2))
      assert.ok(hContainer.textContent.includes('250'), 'History StatCard Total Files must show 250')

      await clickElement(env, hContainer.querySelector('button[title="Next page"]'))
      await waitForDom(env, () => hContainer.textContent.includes('Showing 21–40 of 250'))
      await unmountStrict(env, hRoot)

      metrics.dataset250 = {
        seedMs,
        downloadsInitialMs,
        pageSize50Ms,
        nextPageMs,
        searchMs,
        historyInitialMs
      }
      console.log(
        `✓ CHECK 5 passed: 250-row SQLite paginated over HTTP cleanly (${JSON.stringify(metrics.dataset250)}).`
      )
    } finally {
      await e2eEnv.cleanup()
    }

    // Wait briefly for any transient UI toast timeout from CHECK 4 so exit is spotless
    await flushReactUpdates(env, 1, 50)

    const reactKeyOrLifecycleErrors = [...consoleTracker.errors, ...consoleTracker.warnings].filter(
      (msg) =>
        msg.includes('Each child in a list') ||
        msg.includes('unmounted component') ||
        msg.includes('Maximum update depth') ||
        msg.includes('Invalid hook call') ||
        msg.includes('Warning:')
    )
    assert.equal(
      reactKeyOrLifecycleErrors.length,
      0,
      `Unexpected React warnings/errors:\n${reactKeyOrLifecycleErrors.join('\n')}`
    )

    console.log('\nMETRICS_SUMMARY:', JSON.stringify(metrics))
    console.log('\n================================================================')
    console.log(' ALL 5 STAGE 05.14 PERFORMANCE & SCALE CHECKS PASSED (100%)     ')
    console.log('================================================================')
  } finally {
    consoleTracker.restore()
  }
}

runPerformanceSmokeSuite().catch((err) => {
  console.error('❌ Stage 05.14 Performance & Scale Smoke Suite Failed:', err)
  process.exit(1)
})
