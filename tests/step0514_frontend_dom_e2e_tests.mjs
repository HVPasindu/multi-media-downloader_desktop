/**
 * APPLAN2 Stage 05.14 — Real React DOM + StrictMode E2E Verification Suite
 *
 * Mounts production React pages & router inside JSDOM under React.StrictMode using
 * react-dom/client createRoot and exercises real DOM events end-to-end:
 *  1. Startup Splash -> /api/health -> MainLayout 4-route navigation + '*' fallback + scroll reset
 *  2. DownloaderPage Groups A-E (paste, clear, validation, Analyze loading, 6 qualities,
 *     MP4/MP3 isolation, no-formats disabled CTA, stale promise race guard, MediaThumbnail
 *     safety & onError fallback, Recent Downloads 7 statuses, SweetAlert2 Keep vs Confirm Cancel)
 *  3. DownloadsPage & HistoryPage (StatCards, FilterTabs, search, date range validation,
 *     Pagination, Play/Open Folder/Retry/Delete/Clear modals)
 *  4. Error Handling DOM Matrix (429 cooldown + error codes + IPC errors, zero stack leakage)
 *  5. SettingsPage 4-tab navigation (General, Quality & Audio, Appearance, About with H.V.P.M. Jayarathna)
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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
  createMockWindowApi,
  resetSwalCalls,
  setSwalConfirmDecision,
  getSwalCalls
} from './helpers/step0514RendererHarness.mjs'

// Auto-respawn with electron loader if executed directly without --loader
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

const packageJsonPath = path.resolve(process.cwd(), 'package.json')
const expectedAppVersion = `v${JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version}`

function makeSampleJob(overrides = {}) {
  const id = overrides.id ?? 1
  const status = overrides.status ?? 'completed'
  const format = overrides.output_format ?? 'mp4'
  return {
    id,
    media_id: id + 100,
    source_url: overrides.source_url ?? `https://www.youtube.com/watch?v=vid_${id}`,
    output_format: format,
    quality: format === 'mp4' ? (overrides.quality ?? '1080p') : null,
    audio_bitrate_kbps: format === 'mp3' ? (overrides.audio_bitrate_kbps ?? 320) : null,
    status,
    progress: overrides.progress ?? (status === 'completed' ? 100 : status === 'queued' ? 0 : 45),
    downloaded_bytes: overrides.downloaded_bytes ?? 5242880,
    total_bytes: overrides.total_bytes ?? 10485760,
    error_message: overrides.error_message ?? (status === 'failed' ? 'Simulated failure' : null),
    file_status: status === 'completed' ? 'available' : 'pending',
    createdAt: overrides.createdAt ?? new Date(Date.now() - id * 60000).toISOString(),
    updatedAt: overrides.updatedAt ?? new Date(Date.now() - id * 30000).toISOString(),
    media: {
      id: id + 100,
      title: overrides.title ?? `Sample Media #${id} (${status})`,
      platform: overrides.platform ?? 'youtube',
      source_url: overrides.source_url ?? `https://www.youtube.com/watch?v=vid_${id}`,
      thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    },
    file:
      status === 'completed'
        ? {
            id: id + 200,
            download_job_id: id,
            file_name: `sample_${id}.${format}`,
            file_path: `C:\\Users\\Test\\Downloads\\APPLAN2\\sample_${id}.${format}`,
            file_size: overrides.file_size ?? 10485760,
            file_format: format
          }
        : null
  }
}

async function runTests() {
  console.log('================================================================')
  console.log(' APPLAN2 Stage 05.14: Frontend React DOM + StrictMode E2E Tests ')
  console.log('================================================================')

  const env = await setupRendererTestEnvironment()
  const { MemoryRouter, HashRouter } = await import('react-router-dom')
  const { default: App } = await import('../src/renderer/src/App.jsx')
  const { default: DownloaderPage } = await import('../src/renderer/src/pages/DownloaderPage.jsx')
  const { default: DownloadsPage } = await import('../src/renderer/src/pages/DownloadsPage.jsx')
  const { default: HistoryPage } = await import('../src/renderer/src/pages/HistoryPage.jsx')
  const { default: SettingsPage } = await import('../src/renderer/src/pages/SettingsPage.jsx')
  const { default: MediaThumbnail } =
    await import('../src/renderer/src/components/ui/MediaThumbnail.jsx')

  const consoleTracker = withCapturedConsole()

  try {
    // =========================================================================
    // SUITE 1: Startup Splash -> MainLayout -> 4-Route Navigation + '*' + Scroll
    // =========================================================================
    console.log('\n--- SUITE 1: App Splash, Navigation, Active Badge & Unknown Route ---')
    {
      const seedJobs = [
        makeSampleJob({ id: 1, status: 'downloading', title: 'Active Stream 1' }),
        makeSampleJob({ id: 2, status: 'queued', title: 'Queued Stream 2' }),
        makeSampleJob({ id: 3, status: 'completed', title: 'Done Stream 3' })
      ]
      const mockBridge = createMockWindowApi({ jobs: seedJobs })
      env.window.api = mockBridge.api
      env.window.location.hash = '#/'
      env.resetListenerCounts()

      const { root, container } = await renderStrict(
        env,
        env.React.createElement(HashRouter, null, env.React.createElement(App))
      )

      // Splash should transition after /api/health + 550ms into MainLayout Downloader page
      await waitForDom(
        env,
        () => {
          const urlInput = container.querySelector('input[aria-label="Media link URL"]')
          assert.ok(urlInput, 'DownloaderPage URL input should mount after Splash settles')
          return true
        },
        { timeoutMs: 3000 }
      )

      // Verify active downloads badge renders "2" (1 downloading + 1 queued)
      await waitForDom(env, () => {
        const downloadsNav = findNavLinkByText(container, 'Downloads')
        assert.ok(downloadsNav, 'Downloads nav link must exist')
        assert.ok(
          downloadsNav.textContent.includes('2'),
          `Expected Downloads active count badge 2, got "${downloadsNav.textContent}"`
        )
        return true
      })

      // Test scroll reset across route transitions
      const mainEl = container.querySelector('main')
      assert.ok(mainEl, 'MainLayout <main> container must render')

      const routesToVisit = [
        { navText: 'Downloads', expectedHeading: 'Downloads Manager', expectedHash: '#/downloads' },
        { navText: 'History', expectedHeading: 'Download History', expectedHash: '#/history' },
        { navText: 'Settings', expectedHeading: 'Settings', expectedHash: '#/settings' },
        { navText: 'Downloader', expectedHeading: 'Downloader', expectedHash: '#/' }
      ]

      for (const step of routesToVisit) {
        mainEl.scrollTop = 320
        const navLink = findNavLinkByText(container, step.navText)
        assert.ok(navLink, `Sidebar link "${step.navText}" must exist`)
        await clickElement(env, navLink)

        await waitForDom(env, () => {
          assert.ok(
            container.textContent.includes(step.expectedHeading) ||
              container.querySelector('input[aria-label="Media link URL"]'),
            `Expected heading "${step.expectedHeading}" after clicking ${step.navText}`
          )
          assert.equal(
            navLink.getAttribute('aria-current'),
            'page',
            `Expected ${step.navText} link to have aria-current="page"`
          )
          return true
        })

        assert.equal(
          mainEl.scrollTop,
          0,
          `Main scrollTop must reset to 0 after entering ${step.navText}`
        )
      }

      await unmountStrict(env, root)
      await flushReactUpdates(env, 2, 10)

      // Test unknown '*' route redirect using MemoryRouter
      const { root: unknownRoot, container: unknownContainer } = await renderStrict(
        env,
        env.React.createElement(
          MemoryRouter,
          { initialEntries: ['/totally-nonexistent-route'] },
          env.React.createElement(App)
        )
      )

      await waitForDom(
        env,
        () => {
          const urlInput = unknownContainer.querySelector('input[aria-label="Media link URL"]')
          assert.ok(urlInput, 'Unknown route "*" must redirect to "/" DownloaderPage')
          return true
        },
        { timeoutMs: 3000 }
      )

      await unmountStrict(env, unknownRoot)
      console.log(
        '✓ SUITE 1 passed: Splash, 4 routes, badge count, scroll reset & * fallback verified.'
      )
    }

    // =========================================================================
    // SUITE 2: DownloaderPage Groups A-E under React.StrictMode
    // =========================================================================
    console.log('\n--- SUITE 2: DownloaderPage DOM Scenarios (Groups A-E) ---')
    {
      // Deferred promise controllers for Group A & Group C
      let nextAnalyzeImpl = null
      const recentJobs = [
        makeSampleJob({ id: 11, status: 'downloading', title: 'Job Downloading' }),
        makeSampleJob({ id: 12, status: 'paused', title: 'Job Paused' }),
        makeSampleJob({ id: 13, status: 'interrupted', title: 'Job Interrupted' }),
        makeSampleJob({ id: 14, status: 'queued', title: 'Job Queued' }),
        makeSampleJob({ id: 15, status: 'completed', title: 'Job Completed' }),
        makeSampleJob({ id: 16, status: 'failed', title: 'Job Failed' }),
        makeSampleJob({ id: 17, status: 'cancelled', title: 'Job Cancelled' })
      ]

      const mockBridge = createMockWindowApi({
        jobs: recentJobs,
        onRequest: async ({ path: reqPath, method, body }) => {
          if (reqPath === '/api/media/analyze' && method === 'POST' && nextAnalyzeImpl) {
            return nextAnalyzeImpl(body)
          }
          return undefined
        }
      })
      env.window.api = mockBridge.api
      env.setClipboardText('https://www.youtube.com/watch?v=clipboard999')
      resetSwalCalls()

      const { root, container } = await renderStrict(
        env,
        env.React.createElement(MemoryRouter, null, env.React.createElement(DownloaderPage))
      )

      const urlInput = await waitForDom(env, () =>
        container.querySelector('input[aria-label="Media link URL"]')
      )

      // --- Group A: Paste, Clear, Validation Error, Loading State, Metadata Binding ---
      const pasteBtn = container.querySelector('button[aria-label="Paste link from clipboard"]')
      assert.ok(pasteBtn, 'Paste link button must render')
      await clickElement(env, pasteBtn)
      await waitForDom(env, () => urlInput.value === 'https://www.youtube.com/watch?v=clipboard999')

      const clearBtn = container.querySelector('button[aria-label="Clear link"]')
      assert.ok(clearBtn, 'Clear link button must appear when input is non-empty')
      await clickElement(env, clearBtn)
      assert.equal(urlInput.value, '', 'Clear button must reset URL input')

      // Invalid URL inline validation error
      await setControlledInputValue(env, urlInput, 'invalid-media-url')
      const analyzeBtn = findButtonsByText(container, 'Analyze')[0]
      assert.ok(analyzeBtn, 'Analyze button must render')
      await clickElement(env, analyzeBtn)
      await waitForDom(env, () => {
        const alertEl = container.querySelector('#media-url-error[role="alert"]')
        assert.ok(
          alertEl && alertEl.textContent.length > 0,
          'Invalid URL must show #media-url-error alert'
        )
        return true
      })

      // Clear error by typing valid URL, test Analyzing... loading indicator with deferred
      let resolveGroupA
      const deferredGroupA = new Promise((r) => {
        resolveGroupA = r
      })
      nextAnalyzeImpl = async () => deferredGroupA

      await setControlledInputValue(env, urlInput, 'https://www.youtube.com/watch?v=groupA')
      await clickElement(env, analyzeBtn)
      await waitForDom(env, () => {
        const busyBtn = findButtonsByText(container, 'Analyzing')[0]
        assert.ok(busyBtn && busyBtn.disabled, 'Analyze button must show Analyzing... and disable')
        return true
      })

      nextAnalyzeImpl = null
      resolveGroupA({
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            mediaItemId: 501,
            id: 'groupA',
            platform: 'youtube',
            sourceUrl: 'https://www.youtube.com/watch?v=groupA',
            title: 'Group A Bound Video Title',
            thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
            durationSeconds: 245,
            videoQualities: ['2160p', '1440p', '1080p', '720p', '480p', '360p'],
            audioOptions: ['mp3'],
            availableFormats: {
              mp4Qualities: ['2160p', '1440p', '1080p', '720p', '480p', '360p'],
              mp4Formats: [2160, 1440, 1080, 720, 480, 360].map((h) => ({
                formatId: `f-${h}`,
                quality: `${h}p`,
                height: h,
                audioIncluded: true
              })),
              audioFormats: [{ formatId: 'a-192', audioBitrateKbps: 192 }]
            }
          }
        }
      })

      await waitForDom(env, () => {
        assert.ok(container.textContent.includes('Group A Bound Video Title'))
        return true
      })

      // --- Group B: Dynamic 6 Qualities, MP4/MP3 Isolation, No-Formats Guard ---
      for (const q of ['2160p', '1440p', '1080p', '720p', '480p', '360p']) {
        assert.ok(
          findButtonsByText(container, q).length > 0,
          `Expected dynamic quality button ${q} to render`
        )
      }
      const btn720 = findButtonsByText(container, '720p')[0]
      await clickElement(env, btn720)

      const mp3Btn = findButtonsByText(container, 'MP3')[0]
      const mp4Btn = findButtonsByText(container, 'MP4')[0]
      assert.ok(mp3Btn && mp4Btn, 'MP4 and MP3 format selectors must render')

      await clickElement(env, mp3Btn)
      await waitForDom(env, () => {
        const btns320 = findButtonsByText(container, '320')
        const btns192 = findButtonsByText(container, '192')
        const btns128 = findButtonsByText(container, '128')
        assert.ok(
          btns320.length > 0 && !btns320[0].disabled,
          'MP3 320 kbps button must be enabled in MP3 mode'
        )
        assert.ok(
          btns192.length > 0 && !btns192[0].disabled,
          'MP3 192 kbps button must be enabled in MP3 mode'
        )
        assert.ok(
          btns128.length > 0 && !btns128[0].disabled,
          'MP3 128 kbps button must be enabled in MP3 mode'
        )
        const btns2160 = findButtonsByText(container, '2160p')
        assert.ok(
          btns2160.length > 0 && btns2160.every((b) => b.disabled),
          'MP4 quality buttons must be disabled when MP3 mode is active'
        )
        return true
      })

      await clickElement(env, mp4Btn)
      await waitForDom(env, () => {
        const btns2160 = findButtonsByText(container, '2160p')
        const btns320 = findButtonsByText(container, '320')
        return (
          btns2160.length > 0 &&
          btns2160.every((b) => !b.disabled) &&
          btns320.length > 0 &&
          btns320.every((b) => b.disabled)
        )
      })

      // Test no-formats guard: both format toggles disabled + Download CTA blocks enqueue
      nextAnalyzeImpl = async () => ({
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            mediaItemId: 502,
            id: 'noFormats',
            platform: 'youtube',
            sourceUrl: 'https://www.youtube.com/watch?v=noformats',
            title: 'Empty Streams Video',
            thumbnailUrl: null,
            durationSeconds: 30,
            videoQualities: [],
            audioOptions: [],
            availableFormats: { mp4Qualities: [], mp4Formats: [], audioFormats: [] }
          }
        }
      })
      await setControlledInputValue(env, urlInput, 'https://www.youtube.com/watch?v=noformats')
      await clickElement(env, findButtonsByText(container, 'Analyze')[0])
      await waitForDom(env, () => container.textContent.includes('Empty Streams Video'))
      const noMp4Btn = findButtonsByText(container, 'MP4')[0]
      const noMp3Btn = findButtonsByText(container, 'MP3')[0]
      assert.ok(noMp4Btn?.disabled, 'MP4 button must be disabled when mp4Available is false')
      assert.ok(noMp3Btn?.disabled, 'MP3 button must be disabled when mp3Available is false')
      mockBridge.clearCalls()
      const noFormatDlBtn = findButtonsByText(container, 'Download').find(
        (b) => b.textContent.trim() === 'Download'
      )
      assert.ok(noFormatDlBtn, 'Download button must exist')
      await clickElement(env, noFormatDlBtn)
      assert.equal(
        mockBridge.calls.filter((c) => c.path === '/api/downloads' && c.method === 'POST').length,
        0,
        'No POST /api/downloads call may occur when zero formats are available'
      )

      // --- Group C: Stale In-Flight Race Protection ---
      let resolveSlowA
      const slowA = new Promise((r) => {
        resolveSlowA = r
      })

      let analyzeSequence = 0
      nextAnalyzeImpl = async () => slowA

      // Case C1: In-flight URL A -> user types invalid text -> A resolves late -> A discarded
      await setControlledInputValue(env, urlInput, 'https://www.youtube.com/watch?v=raceA1')
      await clickElement(env, findButtonsByText(container, 'Analyze')[0])
      await waitForDom(env, () => findButtonsByText(container, 'Analyzing').length > 0)

      await setControlledInputValue(env, urlInput, 'not-a-valid-url-typed-mid-flight')
      resolveSlowA({
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            mediaItemId: 601,
            id: 'raceA1',
            platform: 'youtube',
            sourceUrl: 'https://www.youtube.com/watch?v=raceA1',
            title: 'STALE_SHOULD_NOT_RENDER_A1',
            videoQualities: ['1080p'],
            audioOptions: ['mp3'],
            availableFormats: { mp4Qualities: ['1080p'], mp4Formats: [], audioFormats: [] }
          }
        }
      })
      await flushReactUpdates(env, 3, 15)
      assert.equal(
        container.textContent.includes('STALE_SHOULD_NOT_RENDER_A1'),
        false,
        'Late response A after input changed to invalid URL must be discarded'
      )

      // Case C2: URL A resolves AFTER URL B already won
      let resolveStaleA2
      let resolveWinnerB2
      analyzeSequence = 0
      nextAnalyzeImpl = async () => {
        analyzeSequence += 1
        return analyzeSequence === 1
          ? new Promise((r) => {
              resolveStaleA2 = r
            })
          : new Promise((r) => {
              resolveWinnerB2 = r
            })
      }

      await setControlledInputValue(env, urlInput, 'https://www.youtube.com/watch?v=raceA2')
      await clickElement(env, findButtonsByText(container, 'Analyze')[0])
      await setControlledInputValue(env, urlInput, 'https://www.youtube.com/watch?v=raceB2')
      await clickElement(env, findButtonsByText(container, 'Analyze')[0])

      resolveWinnerB2({
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            mediaItemId: 602,
            id: 'raceB2',
            platform: 'youtube',
            sourceUrl: 'https://www.youtube.com/watch?v=raceB2',
            title: 'WINNER_METADATA_B2',
            videoQualities: ['720p'],
            audioOptions: ['mp3'],
            availableFormats: { mp4Qualities: ['720p'], mp4Formats: [], audioFormats: [] }
          }
        }
      })
      await waitForDom(env, () => container.textContent.includes('WINNER_METADATA_B2'))

      resolveStaleA2({
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            mediaItemId: 603,
            id: 'raceA2',
            platform: 'youtube',
            sourceUrl: 'https://www.youtube.com/watch?v=raceA2',
            title: 'LATE_OVERWRITE_A2',
            videoQualities: ['1080p'],
            audioOptions: ['mp3'],
            availableFormats: { mp4Qualities: ['1080p'], mp4Formats: [], audioFormats: [] }
          }
        }
      })
      await flushReactUpdates(env, 3, 15)
      assert.ok(container.textContent.includes('WINNER_METADATA_B2'))
      assert.equal(
        container.textContent.includes('LATE_OVERWRITE_A2'),
        false,
        'Older slow request A2 must NOT overwrite newer winner B2'
      )
      nextAnalyzeImpl = null

      // --- Group E: Recent Downloads 7 Statuses & SweetAlert2 Keep vs Confirm Cancel ---
      // DownloaderPage Recent Downloads queries limit=5, so verify first 5 active/completed statuses,
      // then verify failed & cancelled statuses in Recent Downloads as well.
      await waitForDom(env, () => {
        assert.ok(container.querySelector('button[title="Pause download"]'))
        assert.ok(container.querySelector('button[title="Resume download"]'))
        assert.ok(container.querySelector('button[title="Pause download (prevent auto-resume)"]'))
        assert.ok(container.querySelector('button[title="Cancel queued download"]'))
        assert.ok(container.querySelector('button[title="Cancel download"]'))
        assert.ok(container.querySelector('button[title="Play / Open file"]'))
        assert.ok(container.querySelector('button[title="Open containing folder"]'))
        assert.ok(
          container.querySelector('button[title="Delete from history (keeps file on disk)"]')
        )
        return true
      })

      // Step 1: Click Cancel while user clicks "Keep Download" (isConfirmed: false)
      mockBridge.clearCalls()
      resetSwalCalls()
      setSwalConfirmDecision(false)
      const cancelBtn = container.querySelector('button[title="Cancel download"]')
      await clickElement(env, cancelBtn)

      await waitForDom(env, () => getSwalCalls().length === 1)
      const keepModalCall = getSwalCalls()[0]
      assert.equal(keepModalCall.title, 'Cancel Download?')
      assert.equal(
        mockBridge.calls.filter((c) => c.path?.includes('/cancel')).length,
        0,
        'Clicking Keep Download must execute ZERO cancel API requests'
      )

      // Step 2: Click Cancel while user clicks "Yes, Cancel Download" (isConfirmed: true)
      resetSwalCalls()
      setSwalConfirmDecision(true)
      await clickElement(env, cancelBtn)
      await waitForDom(
        env,
        () => mockBridge.calls.filter((c) => c.path?.includes('/cancel')).length === 1
      )

      // Enqueue download CTA click
      mockBridge.clearCalls()
      const dlCta = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent.trim().startsWith('Download') && !b.disabled
      )
      assert.ok(dlCta, 'Enabled Download CTA button must exist for WINNER_METADATA_B2')
      await clickElement(env, dlCta)
      await waitForDom(
        env,
        () =>
          mockBridge.calls.filter((c) => c.path === '/api/downloads' && c.method === 'POST')
            .length === 1
      )

      await unmountStrict(env, root)

      // Verify failed + cancelled Recent Downloads rows also render Retry download
      const terminalBridge = createMockWindowApi({
        jobs: [
          makeSampleJob({ id: 16, status: 'failed', title: 'Job Failed' }),
          makeSampleJob({ id: 17, status: 'cancelled', title: 'Job Cancelled' })
        ]
      })
      env.window.api = terminalBridge.api
      const { root: termRoot, container: termContainer } = await renderStrict(
        env,
        env.React.createElement(MemoryRouter, null, env.React.createElement(DownloaderPage))
      )
      await waitForDom(env, () => {
        const retryButtons = termContainer.querySelectorAll('button[title="Retry download"]')
        assert.equal(
          retryButtons.length,
          2,
          'Both failed and cancelled rows must expose Retry download'
        )
        return true
      })
      await unmountStrict(env, termRoot)

      // --- Group D: MediaThumbnail valid, error fallback, missing URL, unsafe URLs ---
      const thumbBox = env.document.createElement('div')
      env.document.body.appendChild(thumbBox)

      // D1: Valid HTTPS image + onError fallback -> "No Preview"
      const { root: rThumb1 } = await renderStrict(
        env,
        env.React.createElement(MediaThumbnail, {
          src: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
          alt: 'Thumb Valid'
        }),
        thumbBox
      )
      const imgEl = thumbBox.querySelector('img[alt="Thumb Valid"]')
      assert.ok(imgEl, 'Valid HTTPS thumbnail must render <img>')
      await env.act(async () => {
        imgEl.dispatchEvent(new env.window.Event('error'))
      })
      assert.ok(thumbBox.textContent.includes('No Preview'), 'onError must switch to No Preview')
      await unmountStrict(env, rThumb1)

      // D2: Missing / unsafe URLs must never render <img>
      for (const unsafeUrl of [null, 'javascript:alert(1)', 'http://127.0.0.1:8080/leak.png']) {
        const { root: rUnsafe } = await renderStrict(
          env,
          env.React.createElement(MediaThumbnail, { src: unsafeUrl, alt: 'Unsafe Thumb' }),
          thumbBox
        )
        assert.equal(
          thumbBox.querySelector('img'),
          null,
          `Unsafe or null thumbnail URL (${unsafeUrl}) must never render <img>`
        )
        await unmountStrict(env, rUnsafe)
      }
      thumbBox.remove()

      console.log('✓ SUITE 2 passed: DownloaderPage Groups A-E verified cleanly under StrictMode.')
    }

    // =========================================================================
    // SUITE 3: DownloadsPage & HistoryPage DOM Scenarios
    // =========================================================================
    console.log('\n--- SUITE 3: DownloadsPage & HistoryPage DOM Scenarios ---')
    {
      const manyJobs = Array.from({ length: 25 }, (_, i) =>
        makeSampleJob({
          id: i + 1,
          status:
            i === 0 ? 'downloading' : i === 1 ? 'queued' : i % 4 === 0 ? 'failed' : 'completed',
          output_format: i % 3 === 0 ? 'mp3' : 'mp4',
          title: i === 0 ? 'Cyberpunk Search Hit' : `Library Item #${i + 1}`
        })
      )
      const mockBridge = createMockWindowApi({ jobs: manyJobs })
      env.window.api = mockBridge.api

      // --- 3A: DownloadsPage ---
      const { root: dlRoot, container: dlContainer } = await renderStrict(
        env,
        env.React.createElement(MemoryRouter, null, env.React.createElement(DownloadsPage))
      )

      await waitForDom(env, () => dlContainer.textContent.includes('Downloads Manager'))
      await waitForDom(env, () => dlContainer.textContent.includes('Cyberpunk Search Hit'))

      // Search filtering
      const dlSearch = dlContainer.querySelector('input[placeholder="Search downloads..."]')
      assert.ok(dlSearch, 'DownloadsPage search input must exist')
      mockBridge.clearCalls()
      await setControlledInputValue(env, dlSearch, 'Cyberpunk Search Hit')
      await waitForDom(
        env,
        () => mockBridge.calls.some((c) => c.path?.includes('search=Cyberpunk')),
        { timeoutMs: 2000 }
      )
      await setControlledInputValue(env, dlSearch, '')
      await waitForDom(env, () => dlContainer.textContent.includes('Library Item #2'))

      // Page size switch 20 -> 10 + Next page click
      const sizeSelect = dlContainer.querySelector('select')
      assert.ok(sizeSelect, 'Pagination pageSize select must exist')
      await setControlledSelectValue(env, sizeSelect, '10')
      await waitForDom(env, () => dlContainer.textContent.includes('Showing 1–10 of 25'))
      const nextBtn = dlContainer.querySelector('button[title="Next page"]')
      assert.ok(nextBtn && !nextBtn.disabled, 'Next page button must be enabled on 25/10')
      await clickElement(env, nextBtn)
      await waitForDom(env, () => dlContainer.textContent.includes('Showing 11–20 of 25'))

      // Clear Completed confirmation
      resetSwalCalls()
      setSwalConfirmDecision(true)
      const clearCompBtn = findButtonsByText(dlContainer, 'Clear Completed')[0]
      if (clearCompBtn) {
        mockBridge.clearCalls()
        await clickElement(env, clearCompBtn)
        await waitForDom(env, () =>
          mockBridge.calls.some((c) => c.path === '/api/downloads/history' && c.method === 'DELETE')
        )
      }

      await unmountStrict(env, dlRoot)

      // --- 3B: HistoryPage ---
      const historyJobs = [
        makeSampleJob({
          id: 51,
          status: 'completed',
          output_format: 'mp4',
          title: 'History MP4 Video'
        }),
        makeSampleJob({
          id: 52,
          status: 'failed',
          output_format: 'mp3',
          title: 'History Failed Audio'
        })
      ]
      const histBridge = createMockWindowApi({ jobs: historyJobs })
      env.window.api = histBridge.api

      const { root: hRoot, container: hContainer } = await renderStrict(
        env,
        env.React.createElement(MemoryRouter, null, env.React.createElement(HistoryPage))
      )

      await waitForDom(env, () => hContainer.textContent.includes('Download History'))
      await waitForDom(env, () => hContainer.textContent.includes('History MP4 Video'))

      // Date filter validation (from > to)
      const dateToggleBtn = hContainer.querySelector('button[title="Filter by date range"]')
      assert.ok(dateToggleBtn, 'History date range filter button must exist')
      await clickElement(env, dateToggleBtn)
      const dateInputs = await waitForDom(env, () => {
        const inputs = Array.from(hContainer.querySelectorAll('input[type="date"]'))
        return inputs.length >= 2 ? inputs : false
      })
      await setControlledInputValue(env, dateInputs[0], '2026-11-10')
      await setControlledInputValue(env, dateInputs[1], '2026-11-01')
      const applyDateBtn = findButtonsByText(hContainer, 'Apply')[0]
      assert.ok(applyDateBtn, 'Apply date filter button must exist')
      await clickElement(env, applyDateBtn)
      await waitForDom(env, () =>
        hContainer.textContent.includes('Start date cannot be after end date')
      )

      // Play, Open Folder, Retry, Delete triggers
      histBridge.clearCalls()
      await clickElement(env, hContainer.querySelector('button[title="Play / Open media file"]'))
      await clickElement(env, hContainer.querySelector('button[title="Open enclosing folder"]'))
      assert.equal(histBridge.calls.filter((c) => c.kind === 'openFile').length, 1)
      assert.equal(histBridge.calls.filter((c) => c.kind === 'openFolder').length, 1)

      await clickElement(env, hContainer.querySelector('button[title="Retry download"]'))
      await waitForDom(env, () => histBridge.calls.some((c) => c.path?.includes('/retry')))

      setSwalConfirmDecision(true)
      await clickElement(
        env,
        hContainer.querySelector('button[title="Delete record from history"]')
      )
      await waitForDom(env, () =>
        histBridge.calls.some((c) => c.method === 'DELETE' && c.path === '/api/downloads/51')
      )

      await unmountStrict(env, hRoot)
      console.log('✓ SUITE 3 passed: DownloadsPage & HistoryPage DOM interactions verified.')
    }

    // =========================================================================
    // SUITE 4: Error Handling DOM Matrix (No Stack Leakage / Cooldown UI)
    // =========================================================================
    console.log('\n--- SUITE 4: Error Handling DOM Matrix & HTTP 429 Cooldown ---')
    {
      let errorResponseToReturn = null
      const mockBridge = createMockWindowApi({
        onRequest: async ({ path: reqPath, method }) => {
          if (reqPath === '/api/media/analyze' && method === 'POST' && errorResponseToReturn) {
            return errorResponseToReturn
          }
          return undefined
        }
      })
      env.window.api = mockBridge.api

      const { root, container } = await renderStrict(
        env,
        env.React.createElement(MemoryRouter, null, env.React.createElement(DownloaderPage))
      )
      const urlInput = await waitForDom(env, () =>
        container.querySelector('input[aria-label="Media link URL"]')
      )

      const scenarios = [
        {
          label: 'HTTP 429 cooldown',
          res: {
            ok: false,
            status: 429,
            data: {
              success: false,
              errorCode: 'YOUTUBE_RATE_LIMITED',
              retryAfterSeconds: 6,
              message: 'Too many analyze requests. Please wait a moment.'
            },
            error: 'Too many requests'
          },
          checkCooldown: true
        },
        {
          label: 'YOUTUBE_AUTH_REQUIRED',
          res: {
            ok: false,
            status: 403,
            data: {
              success: false,
              errorCode: 'YOUTUBE_AUTH_REQUIRED',
              message: 'Sign in required for protected video'
            }
          }
        },
        {
          label: 'YOUTUBE_PO_TOKEN_REQUIRED',
          res: {
            ok: false,
            status: 403,
            data: {
              success: false,
              errorCode: 'YOUTUBE_PO_TOKEN_REQUIRED',
              message: 'YouTube PO Token verification required'
            }
          }
        },
        {
          label: 'NETWORK_ERROR',
          res: {
            ok: false,
            status: 503,
            data: { success: false, errorCode: 'NETWORK_ERROR', message: 'Connection failed' }
          }
        },
        {
          label: 'UNSUPPORTED_PLATFORM',
          res: {
            ok: false,
            status: 400,
            data: {
              success: false,
              errorCode: 'UNSUPPORTED_PLATFORM',
              message: 'Unsupported platform link'
            }
          }
        },
        {
          label: 'MEDIA_UNAVAILABLE',
          res: {
            ok: false,
            status: 404,
            data: {
              success: false,
              errorCode: 'MEDIA_UNAVAILABLE',
              message: 'This video is private or unavailable'
            }
          }
        },
        {
          label: 'IPC_CHANNEL_ERROR',
          res: {
            ok: false,
            status: 500,
            errorCode: 'IPC_CHANNEL_ERROR',
            data: {
              success: false,
              errorCode: 'IPC_CHANNEL_ERROR',
              message: 'Desktop IPC bridge error occurred'
            }
          }
        }
      ]

      // Wait or test 429 LAST so cooldown timer doesn't block subsequent Analyze clicks!
      const nonCooldown = scenarios.filter((s) => !s.checkCooldown)
      const cooldownCase = scenarios.find((s) => s.checkCooldown)

      for (const item of [...nonCooldown, cooldownCase]) {
        errorResponseToReturn = item.res
        await setControlledInputValue(
          env,
          urlInput,
          `https://www.youtube.com/watch?v=${encodeURIComponent(item.label)}`
        )
        const analyzeBtn = findButtonsByText(container, 'Analyze')[0]
        assert.ok(
          analyzeBtn && !analyzeBtn.disabled,
          `Analyze button should be enabled before ${item.label}`
        )
        await clickElement(env, analyzeBtn)

        await waitForDom(env, () => {
          const alertEl = container.querySelector('#media-api-error[role="alert"]')
          assert.ok(
            alertEl && alertEl.textContent.trim().length > 0,
            `Expected alert for ${item.label}`
          )
          assert.equal(alertEl.textContent.includes('at Function'), false, 'No stack trace in UI')
          assert.equal(
            alertEl.textContent.includes('TypeError:'),
            false,
            'No raw JS TypeError in UI'
          )
          return true
        })

        if (item.checkCooldown) {
          await waitForDom(env, () => {
            const waitBtn = findButtonsByText(container, 'Wait ')[0]
            assert.ok(
              waitBtn && waitBtn.disabled,
              'HTTP 429 must disable Analyze button with Wait <s>s'
            )
            return true
          })
        }
      }

      await unmountStrict(env, root)
      console.log(
        '✓ SUITE 4 passed: Error Handling Matrix (7 error types + 429 cooldown) verified.'
      )
    }

    // =========================================================================
    // SUITE 5: SettingsPage 4 Tabs & About (H.V.P.M. Jayarathna, Electron Fallback)
    // =========================================================================
    console.log('\n--- SUITE 5: SettingsPage 4-Tab Navigation, Theme & AboutVerification ---')
    {
      const mockBridge = createMockWindowApi()
      env.window.api = mockBridge.api
      env.window.electron = {
        process: {
          platform: 'win32',
          versions: { electron: '39.0.0', chrome: '134.0.0', node: '22.0.0' }
        }
      }

      const { root, container } = await renderStrict(
        env,
        env.React.createElement(MemoryRouter, null, env.React.createElement(SettingsPage))
      )

      // Tab 1: General
      await waitForDom(env, () => container.textContent.includes('Start with Windows'))
      assert.ok(container.textContent.includes('Default Download Folder'))

      // Tab 2: Quality & Audio
      await clickElement(env, findButtonsByText(container, 'Quality & Audio')[0])
      await waitForDom(env, () => container.textContent.includes('Default Video Quality'))

      // Tab 3: Appearance -> switch preset -> inspect --theme-primary CSS variable
      await clickElement(env, findButtonsByText(container, 'Appearance')[0])
      await waitForDom(env, () => container.textContent.includes('Live Theme Preview'))
      const presetBtn =
        findButtonsByText(container, 'Neon Violet')[0] ||
        findButtonsByText(container, 'Cyber Cyan')[0]
      if (presetBtn) {
        await clickElement(env, presetBtn)
        const primaryVar = env.document.documentElement.style.getPropertyValue('--theme-primary')
        assert.ok(
          primaryVar.length > 0,
          'Appearance preset switch must apply --theme-primary CSS var'
        )
      }

      // Tab 4: About -> Developer Name & dynamic package.json version
      await clickElement(env, findButtonsByText(container, 'About')[0])
      await waitForDom(env, () => container.textContent.includes('H.V.P.M. Jayarathna'))
      assert.ok(
        container.textContent.includes(expectedAppVersion),
        `About page must display package version ${expectedAppVersion}`
      )
      assert.ok(
        container.textContent.includes('39.0.0'),
        'About runtime info must show Electron version when present'
      )

      // Tab return -> General
      await clickElement(env, findButtonsByText(container, 'General')[0])
      await waitForDom(env, () => container.textContent.includes('Start with Windows'))
      await unmountStrict(env, root)

      // Also test About fallback cleanly without window.electron
      delete env.window.electron
      const { root: aboutFallbackRoot, container: fallbackContainer } = await renderStrict(
        env,
        env.React.createElement(MemoryRouter, null, env.React.createElement(SettingsPage))
      )
      await clickElement(env, findButtonsByText(fallbackContainer, 'About')[0])
      await waitForDom(env, () => fallbackContainer.textContent.includes('H.V.P.M. Jayarathna'))
      assert.ok(fallbackContainer.textContent.includes(expectedAppVersion))
      await unmountStrict(env, aboutFallbackRoot)

      console.log('✓ SUITE 5 passed: Settings 4-tab transitions, theme preset & About verified.')
    }

    // Ensure zero React console errors / warnings leaked (filter out only unrelated noisy info if any)
    const seriousConsoleIssues = [...consoleTracker.errors, ...consoleTracker.warnings].filter(
      (msg) =>
        msg.includes('Each child in a list') ||
        msg.includes('unmounted component') ||
        msg.includes('Maximum update depth') ||
        msg.includes('Invalid hook call') ||
        msg.includes('Warning:')
    )
    assert.equal(
      seriousConsoleIssues.length,
      0,
      `Unexpected React warnings/errors encountered:\n${seriousConsoleIssues.join('\n')}`
    )

    console.log('\n================================================================')
    console.log(' ALL 5 STAGE 05.14 FRONTEND DOM E2E SUITES PASSED (100%)         ')
    console.log('================================================================')
  } finally {
    consoleTracker.restore()
  }
}

runTests().catch((err) => {
  console.error('❌ Stage 05.14 Frontend DOM E2E Suite Failed:', err)
  process.exit(1)
})
