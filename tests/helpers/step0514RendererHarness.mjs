import { register } from 'node:module'
import { JSDOM } from 'jsdom'

let assetLoaderRegistered = false
let domInstance = null
let swalHookInstalled = false

const swalState = {
  calls: [],
  nextConfirmResult: { isConfirmed: false, isDenied: false, isDismissed: true, dismiss: 'cancel' },
  confirmHandler: null
}

/**
 * Registers the test-only asset loader once so React JSX components importing
 * .png, .css, and package.json work cleanly under Node ESM + electron_loader.
 */
export function ensureAssetLoaderRegistered() {
  if (assetLoaderRegistered) return
  register('./step0514AssetLoader.mjs', import.meta.url)
  assetLoaderRegistered = true
}

/**
 * Installs a deterministic SweetAlert2 Swal.mixin interceptor BEFORE any app module
 * imports notificationService.js.
 */
export async function installSwalHook() {
  if (swalHookInstalled) return swalState
  const sweetalertMod = await import('sweetalert2')
  const Swal = sweetalertMod.default || sweetalertMod

  const createMockInstance = (baseOptions = {}) => ({
    fire: async (optionsOrTitle, textArg, iconArg) => {
      const normalized =
        typeof optionsOrTitle === 'string'
          ? { title: optionsOrTitle, text: textArg, icon: iconArg }
          : { ...(optionsOrTitle || {}) }
      const mergedOptions = { ...baseOptions, ...normalized }
      swalState.calls.push(mergedOptions)

      if (typeof swalState.confirmHandler === 'function') {
        const customDecision = await swalState.confirmHandler(mergedOptions)
        if (customDecision && typeof customDecision === 'object') {
          return customDecision
        }
      }

      if (mergedOptions.showCancelButton) {
        return { ...swalState.nextConfirmResult }
      }
      return { isConfirmed: true, isDenied: false, isDismissed: false, value: true }
    }
  })

  if (typeof Swal?.mixin === 'function') {
    Swal.mixin = (baseOptions = {}) => createMockInstance(baseOptions)
  }
  if (typeof Swal?.fire === 'function') {
    Swal.fire = createMockInstance({}).fire
  }

  swalHookInstalled = true
  return swalState
}

export function resetSwalCalls() {
  swalState.calls.length = 0
  swalState.confirmHandler = null
  swalState.nextConfirmResult = {
    isConfirmed: false,
    isDenied: false,
    isDismissed: true,
    dismiss: 'cancel'
  }
}

export function setSwalConfirmDecision(confirmed, handler = null) {
  swalState.confirmHandler = handler
  swalState.nextConfirmResult = confirmed
    ? { isConfirmed: true, isDenied: false, isDismissed: false, value: true }
    : { isConfirmed: false, isDenied: false, isDismissed: true, dismiss: 'cancel' }
}

export function getSwalCalls() {
  return [...swalState.calls]
}

/**
 * Initializes JSDOM, global DOM APIs, listener telemetry, clipboard shim, and
 * SweetAlert2 hook BEFORE importing React or any UI page.
 */
export async function setupRendererTestEnvironment({ url = 'http://localhost/' } = {}) {
  ensureAssetLoaderRegistered()

  if (domInstance) {
    domInstance.window.location.href = url
    domInstance.window.localStorage.clear()
    domInstance.window.document.body.innerHTML = '<div id="root"></div>'
    resetSwalCalls()
    return globalThis.__step0514Env
  }

  const dom = new JSDOM(
    '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>',
    {
      url,
      pretendToBeVisual: true
    }
  )
  domInstance = dom

  const listenerCounts = new Map()
  const trackedTimers = new Set()
  const origWinAdd = dom.window.addEventListener.bind(dom.window)
  const origWinRemove = dom.window.removeEventListener.bind(dom.window)
  const origDocAdd = dom.window.document.addEventListener.bind(dom.window.document)
  const origDocRemove = dom.window.document.removeEventListener.bind(dom.window.document)

  const recordAdd = (scope, type) => {
    const key = `${scope}:${type}`
    listenerCounts.set(key, (listenerCounts.get(key) || 0) + 1)
  }
  const recordRemove = (scope, type) => {
    const key = `${scope}:${type}`
    listenerCounts.set(key, Math.max(0, (listenerCounts.get(key) || 0) - 1))
  }

  dom.window.addEventListener = (type, listener, options) => {
    recordAdd('window', type)
    return origWinAdd(type, listener, options)
  }
  dom.window.removeEventListener = (type, listener, options) => {
    recordRemove('window', type)
    return origWinRemove(type, listener, options)
  }
  dom.window.document.addEventListener = (type, listener, options) => {
    recordAdd('document', type)
    return origDocAdd(type, listener, options)
  }
  dom.window.document.removeEventListener = (type, listener, options) => {
    recordRemove('document', type)
    return origDocRemove(type, listener, options)
  }

  // Silence JSDOM unimplemented canvas warning while letting SplashDecoration3D detect WebGL absence
  dom.window.HTMLCanvasElement.prototype.getContext = () => null
  dom.window.Element.prototype.scrollIntoView = () => {}
  if (typeof dom.window.HTMLElement.prototype.scrollTo !== 'function') {
    dom.window.HTMLElement.prototype.scrollTo = () => {}
  }

  // Shims needed by framer-motion, appearanceTheme, and DownloaderPage clipboard paste
  dom.window.matchMedia =
    dom.window.matchMedia ||
    ((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    }))

  let clipboardText = ''
  const clipboardShim = {
    readText: async () => clipboardText,
    writeText: async (text) => {
      clipboardText = String(text ?? '')
    }
  }
  try {
    Object.defineProperty(dom.window.navigator, 'clipboard', {
      value: clipboardShim,
      configurable: true,
      writable: true
    })
  } catch {
    dom.window.navigator.clipboard = clipboardShim
  }

  if (!dom.window.ResizeObserver) {
    dom.window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (!dom.window.IntersectionObserver) {
    dom.window.IntersectionObserver = class IntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }

  // Bind globals for React, react-router-dom, lucide-react, and framer-motion
  const defineGlobal = (name, value) => {
    try {
      Object.defineProperty(globalThis, name, {
        value,
        configurable: true,
        writable: true
      })
    } catch {
      globalThis[name] = value
    }
  }

  defineGlobal('window', dom.window)
  defineGlobal('document', dom.window.document)
  defineGlobal('navigator', dom.window.navigator)
  defineGlobal('location', dom.window.location)
  defineGlobal('localStorage', dom.window.localStorage)
  defineGlobal('sessionStorage', dom.window.sessionStorage)
  defineGlobal('HTMLElement', dom.window.HTMLElement)
  defineGlobal('HTMLInputElement', dom.window.HTMLInputElement)
  defineGlobal('HTMLSelectElement', dom.window.HTMLSelectElement)
  defineGlobal('HTMLCanvasElement', dom.window.HTMLCanvasElement)
  defineGlobal('SVGElement', dom.window.SVGElement)
  defineGlobal('Element', dom.window.Element)
  defineGlobal('Node', dom.window.Node)
  defineGlobal('Event', dom.window.Event)
  defineGlobal('MouseEvent', dom.window.MouseEvent)
  defineGlobal('KeyboardEvent', dom.window.KeyboardEvent)
  defineGlobal('InputEvent', dom.window.InputEvent)
  defineGlobal('DragEvent', dom.window.DragEvent || dom.window.Event)
  defineGlobal('CustomEvent', dom.window.CustomEvent)
  defineGlobal('StorageEvent', dom.window.StorageEvent)
  defineGlobal('MutationObserver', dom.window.MutationObserver)
  defineGlobal('ResizeObserver', dom.window.ResizeObserver)
  defineGlobal('IntersectionObserver', dom.window.IntersectionObserver)
  defineGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window))
  defineGlobal('matchMedia', dom.window.matchMedia)
  defineGlobal('IS_REACT_ACT_ENVIRONMENT', true)

  if (!dom.window.requestAnimationFrame) {
    dom.window.requestAnimationFrame = (cb) => {
      const id = setTimeout(() => cb(Date.now()), 0)
      if (typeof id.unref === 'function') id.unref()
      return id
    }
    dom.window.cancelAnimationFrame = (id) => clearTimeout(id)
  }
  defineGlobal('requestAnimationFrame', dom.window.requestAnimationFrame)
  defineGlobal('cancelAnimationFrame', dom.window.cancelAnimationFrame)

  // Must install Swal hook BEFORE loading notificationService / pages
  await installSwalHook()

  const React = (await import('react')).default
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')

  const env = {
    dom,
    window: dom.window,
    document: dom.window.document,
    React,
    act,
    createRoot,
    setClipboardText: (value) => {
      clipboardText = String(value ?? '')
    },
    getListenerSnapshot: () => Object.fromEntries(listenerCounts.entries()),
    resetListenerCounts: () => listenerCounts.clear(),
    trackTimer: (id) => {
      trackedTimers.add(id)
      return id
    },
    clearTrackedTimers: () => {
      for (const id of trackedTimers) clearTimeout(id)
      trackedTimers.clear()
    }
  }

  globalThis.__step0514Env = env
  return env
}

/**
 * Captures console.error / console.warn messages during React tests so React key
 * warnings, unmounted state updates, or unexpected errors are asserted cleanly.
 */
export function withCapturedConsole() {
  const errors = []
  const warnings = []
  const origError = console.error
  const origWarn = console.warn

  console.error = (...args) => {
    const msg = args.map((a) => (a instanceof Error ? a.stack || a.message : String(a))).join(' ')
    errors.push(msg)
  }
  console.warn = (...args) => {
    const msg = args.map((a) => (a instanceof Error ? a.stack || a.message : String(a))).join(' ')
    warnings.push(msg)
  }

  return {
    errors,
    warnings,
    restore: () => {
      console.error = origError
      console.warn = origWarn
    }
  }
}

/**
 * Mounts an element wrapped in React.StrictMode into #root (or custom container).
 */
export async function renderStrict(env, element, container = null) {
  const target =
    container || env.document.getElementById('root') || env.document.body.appendChild(env.document.createElement('div'))
  const root = env.createRoot(target)
  await env.act(async () => {
    root.render(env.React.createElement(env.React.StrictMode, null, element))
  })
  return { root, container: target }
}

export async function unmountStrict(env, root) {
  if (!root) return
  await env.act(async () => {
    root.unmount()
  })
}

export async function flushReactUpdates(env, cycles = 2, delayMs = 0) {
  for (let i = 0; i < cycles; i++) {
    await env.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    })
  }
}

/**
 * Drives a controlled React <input> or <textarea> using the native prototype setter.
 */
export async function setControlledInputValue(env, inputEl, value) {
  const proto =
    inputEl.tagName === 'TEXTAREA'
      ? env.window.HTMLTextAreaElement.prototype
      : env.window.HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
  await env.act(async () => {
    descriptor.set.call(inputEl, String(value))
    inputEl.dispatchEvent(new env.window.Event('input', { bubbles: true }))
    inputEl.dispatchEvent(new env.window.Event('change', { bubbles: true }))
  })
}

/**
 * Drives a controlled React <select>.
 */
export async function setControlledSelectValue(env, selectEl, value) {
  const descriptor = Object.getOwnPropertyDescriptor(
    env.window.HTMLSelectElement.prototype,
    'value'
  )
  await env.act(async () => {
    descriptor.set.call(selectEl, String(value))
    selectEl.dispatchEvent(new env.window.Event('change', { bubbles: true }))
  })
}

export async function clickElement(env, element) {
  await env.act(async () => {
    element.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

export async function triggerElementEvent(env, element, event) {
  await env.act(async () => {
    element.dispatchEvent(event)
  })
}

export async function waitForDom(env, assertionFn, { timeoutMs = 4000, stepMs = 20 } = {}) {
  const start = Date.now()
  let lastError = null
  while (Date.now() - start < timeoutMs) {
    try {
      const result = assertionFn()
      if (result !== false && result !== null && result !== undefined) {
        return result
      }
      lastError = new Error('Predicate did not yield a truthy/non-null result')
    } catch (err) {
      lastError = err
    }
    await flushReactUpdates(env, 1, stepMs)
  }
  throw lastError || new Error(`waitForDom timed out after ${timeoutMs}ms`)
}

export function findButtonsByText(container, textSubstring) {
  const needle = textSubstring.toLowerCase()
  return Array.from(container.querySelectorAll('button')).filter((btn) =>
    btn.textContent.toLowerCase().includes(needle)
  )
}

export function findNavLinkByText(container, textSubstring) {
  const needle = textSubstring.toLowerCase()
  return Array.from(container.querySelectorAll('a')).find((link) =>
    link.textContent.toLowerCase().includes(needle)
  )
}

/**
 * Creates a full in-memory window.api mock router matching preload + Express responses,
 * tracking every request for assertion and supporting custom route handlers.
 */
export function createMockWindowApi(overrides = {}) {
  const calls = []
  const state = {
    jobs: overrides.jobs ? [...overrides.jobs] : [],
    settings: {
      downloadPath: 'C:\\Users\\Test\\Downloads\\APPLAN2',
      defaultFormat: 'mp4',
      preferredMp4Quality: '1080p',
      preferredMp3BitrateKbps: 320,
      ...(overrides.settings || {})
    },
    startup: {
      supported: true,
      enabled: false,
      ...(overrides.startup || {})
    },
    healthOk: true,
    nextJobId: 100
  }

  const computeCountsAndSummary = () => {
    const downloading = state.jobs.filter((j) => j.status === 'downloading').length
    const queued = state.jobs.filter((j) => j.status === 'queued').length
    const paused = state.jobs.filter((j) => j.status === 'paused').length
    const interrupted = state.jobs.filter((j) => j.status === 'interrupted').length
    const completed = state.jobs.filter((j) => j.status === 'completed').length
    const failedOnly = state.jobs.filter((j) => j.status === 'failed').length
    const cancelled = state.jobs.filter((j) => j.status === 'cancelled').length
    const failed = failedOnly + cancelled
    const terminalJobs = state.jobs.filter((j) =>
      ['completed', 'failed', 'cancelled'].includes(j.status)
    )
    const videos = terminalJobs.filter((j) => j.output_format !== 'mp3').length
    const audio = terminalJobs.filter((j) => j.output_format === 'mp3').length
    const storageBytes = state.jobs
      .filter((j) => j.status === 'completed')
      .reduce(
        (acc, j) =>
          acc + (Number(j.file?.file_size) || Number(j.total_bytes) || Number(j.downloaded_bytes) || 0),
        0
      )

    return {
      downloads: {
        total: state.jobs.length,
        downloading,
        queued,
        paused,
        interrupted,
        completed,
        failed,
        cancelled
      },
      history: {
        totalFiles: terminalJobs.length,
        videos,
        audio,
        completed,
        failed,
        storageBytes
      }
    }
  }

  const filterAndPaginate = (urlObj) => {
    const statusesRaw = urlObj.searchParams.get('statuses') || urlObj.searchParams.get('status') || ''
    const requestedStatuses = statusesRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s !== 'all')
    const search = (urlObj.searchParams.get('search') || '').trim().toLowerCase()
    const format = (urlObj.searchParams.get('outputFormat') || urlObj.searchParams.get('format') || '')
      .trim()
      .toLowerCase()
    const limit = Math.max(1, Number(urlObj.searchParams.get('limit') || 20))
    const offsetParam = urlObj.searchParams.get('offset')
    const pageParam = urlObj.searchParams.get('page')
    const offset =
      offsetParam !== null
        ? Math.max(0, Number(offsetParam))
        : (Math.max(1, Number(pageParam || 1)) - 1) * limit

    let items = [...state.jobs]
    if (requestedStatuses.length > 0) {
      items = items.filter((j) => {
        if (requestedStatuses.includes(j.status)) return true
        if (requestedStatuses.includes('failed') && j.status === 'cancelled') return true
        return false
      })
    }

    if (format === 'mp4') {
      items = items.filter((j) => j.output_format !== 'mp3')
    } else if (format === 'mp3') {
      items = items.filter((j) => j.output_format === 'mp3')
    }

    if (search) {
      items = items.filter(
        (j) =>
          (j.media?.title || '').toLowerCase().includes(search) ||
          (j.source_url || '').toLowerCase().includes(search) ||
          (j.media?.platform || '').toLowerCase().includes(search)
      )
    }

    const total = items.length
    const paged = items.slice(offset, offset + limit)
    return {
      jobs: paged,
      pagination: {
        limit,
        offset,
        total
      }
    }
  }

  const buildDefaultAnalysisData = (targetUrl) => {
    const cleanUrl = targetUrl || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    const heights = [2160, 1440, 1080, 720, 480, 360]
    const mp4Qualities = heights.map((h) => `${h}p`)
    const mp4Formats = heights.map((h, idx) => ({
      formatId: `mp4-${h}`,
      quality: `${h}p`,
      height: h,
      width: Math.round((h * 16) / 9),
      extension: 'mp4',
      videoCodec: 'avc1',
      audioCodec: 'mp4a.40.2',
      audioIncluded: true,
      fileSize: (120 - idx * 15) * 1024 * 1024,
      isApproximate: false,
      totalBitrateKbps: 2500 - idx * 300
    }))
    const audioFormats = [
      { formatId: 'm4a-192', extension: 'm4a', audioCodec: 'aac', fileSize: 4 * 1024 * 1024, audioBitrateKbps: 192 }
    ]

    return {
      mediaItemId: 42,
      id: 'dQw4w9WgXcQ',
      platform: 'youtube',
      sourceUrl: cleanUrl,
      title: 'Stage 05.14 Test Media',
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      durationSeconds: 185,
      videoQualities: mp4Qualities,
      audioOptions: ['mp3'],
      availableFormats: {
        mp4Qualities,
        mp4Formats,
        audioFormats
      }
    }
  }

  const requestHandler = async ({ path: reqPath, method = 'GET', body = null, headers = {} }) => {
    calls.push({ kind: 'request', path: reqPath, method, body, headers })

    if (typeof overrides.onRequest === 'function') {
      const overrideRes = await overrides.onRequest({ path: reqPath, method, body, headers, state })
      if (overrideRes !== undefined) return overrideRes
    }

    const urlObj = new URL(reqPath, 'http://127.0.0.1')
    const pathname = urlObj.pathname

    if (pathname === '/api/health' && method === 'GET') {
      return state.healthOk
        ? { ok: true, status: 200, data: { status: 'ok', database: 'connected' } }
        : { ok: false, status: 503, error: 'Backend offline', data: null }
    }

    if (pathname === '/api/settings/downloads' && method === 'GET') {
      return { ok: true, status: 200, data: { success: true, data: { ...state.settings } } }
    }

    if (pathname === '/api/settings/downloads' && method === 'PATCH') {
      Object.assign(state.settings, body || {})
      return { ok: true, status: 200, data: { success: true, data: { ...state.settings } } }
    }

    if (pathname === '/api/media/analyze' && method === 'POST') {
      const data = overrides.defaultMetadata
        ? { ...overrides.defaultMetadata }
        : buildDefaultAnalysisData(body?.url)
      return { ok: true, status: 200, data: { success: true, data } }
    }

    if (pathname === '/api/downloads/check-duplicate' && method === 'POST') {
      return { ok: true, status: 200, data: { success: true, duplicate: false, data: null } }
    }

    if (pathname === '/api/downloads/summary' && method === 'GET') {
      return { ok: true, status: 200, data: { success: true, data: computeCountsAndSummary() } }
    }

    if (pathname === '/api/downloads' && method === 'GET') {
      const { jobs, pagination } = filterAndPaginate(urlObj)
      return { ok: true, status: 200, data: { success: true, data: jobs, pagination } }
    }

    if (pathname === '/api/downloads' && method === 'POST') {
      const id = state.nextJobId++
      const outputFormat = body?.outputFormat || 'mp4'
      const job = {
        id,
        media_id: body?.mediaItemId || 42,
        source_url: body?.url || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        output_format: outputFormat,
        quality: body?.quality || '1080p',
        audio_bitrate_kbps: body?.audioBitrateKbps || null,
        status: 'queued',
        progress: 0,
        downloaded_bytes: 0,
        total_bytes: 10485760,
        error_message: null,
        file_status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        media: {
          id: body?.mediaItemId || 42,
          title: body?.title || 'Stage 05.14 Test Media',
          platform: 'youtube',
          source_url: body?.url || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          thumbnail_url: body?.thumbnailUrl || 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
        },
        file: {
          id,
          download_job_id: id,
          file_name: `queued_${id}.${outputFormat}`,
          file_path: `${state.settings.downloadPath}\\queued_${id}.${outputFormat}`,
          file_size: 10485760,
          file_format: outputFormat
        }
      }
      state.jobs.unshift(job)
      return { ok: true, status: 201, data: { success: true, data: job } }
    }

    if (pathname === '/api/downloads/history' && method === 'DELETE') {
      const statuses = Array.isArray(body?.statuses)
        ? body.statuses
        : ['completed', 'failed', 'cancelled']
      const before = state.jobs.length
      state.jobs = state.jobs.filter((j) => {
        if (statuses.includes(j.status)) return false
        if (statuses.includes('failed') && j.status === 'cancelled') return false
        return true
      })
      const deletedJobs = before - state.jobs.length
      return {
        ok: true,
        status: 200,
        data: { success: true, data: { deletedJobs, physicalFilesDeleted: 0 } }
      }
    }

    const actionMatch = /^\/api\/downloads\/(\d+)\/(pause|resume|cancel|retry)$/.exec(pathname)
    if (actionMatch && method === 'POST') {
      const jobId = Number(actionMatch[1])
      const action = actionMatch[2]
      const job = state.jobs.find((j) => Number(j.id) === jobId)
      if (!job) {
        return {
          ok: false,
          status: 404,
          data: { success: false, message: 'Download job not found' },
          error: 'Download job not found'
        }
      }
      if (action === 'pause') job.status = 'paused'
      if (action === 'resume') job.status = 'queued'
      if (action === 'cancel') job.status = 'cancelled'
      if (action === 'retry') {
        job.status = 'queued'
        job.progress = 0
        job.error_message = null
        return {
          ok: true,
          status: 201,
          data: {
            success: true,
            data: {
              originalJobId: jobId,
              retryJobId: jobId,
              status: 'queued',
              message: 'Retry scheduled'
            }
          }
        }
      }
      return {
        ok: true,
        status: 200,
        data: { success: true, data: { id: jobId, status: job.status, message: `${action} ok` } }
      }
    }

    const deleteMatch = /^\/api\/downloads\/(\d+)$/.exec(pathname)
    if (deleteMatch && method === 'DELETE') {
      const jobId = Number(deleteMatch[1])
      const before = state.jobs.length
      state.jobs = state.jobs.filter((j) => Number(j.id) !== jobId)
      return before !== state.jobs.length
        ? {
            ok: true,
            status: 200,
            data: { success: true, data: { id: jobId, deleted: true, physicalFileDeleted: false } }
          }
        : {
            ok: false,
            status: 404,
            data: { success: false, message: 'Not found' },
            error: 'Not found'
          }
    }

    return {
      ok: false,
      status: 404,
      data: { success: false, message: `Unhandled mock route: ${method} ${reqPath}` },
      error: `Unhandled mock route: ${method} ${reqPath}`
    }
  }

  const api = {
    request: requestHandler,
    chooseDownloadFolder: async () => {
      calls.push({ kind: 'chooseDownloadFolder' })
      if (typeof overrides.onChooseDownloadFolder === 'function') {
        return overrides.onChooseDownloadFolder()
      }
      state.settings.downloadPath = 'D:\\MediaDownloads'
      return state.settings.downloadPath
    },
    getDownloadFolder: async () => {
      calls.push({ kind: 'getDownloadFolder' })
      if (typeof overrides.onGetDownloadFolder === 'function') {
        return overrides.onGetDownloadFolder()
      }
      return state.settings.downloadPath
    },
    getStorageInfo: async () => {
      calls.push({ kind: 'getStorageInfo' })
      if (typeof overrides.onGetStorageInfo === 'function') {
        return overrides.onGetStorageInfo()
      }
      return {
        available: true,
        path: state.settings.downloadPath,
        totalBytes: 500 * 1024 ** 3,
        freeBytes: 220 * 1024 ** 3
      }
    },
    getStartWithWindows: async () => {
      calls.push({ kind: 'getStartWithWindows' })
      if (typeof overrides.onGetStartWithWindows === 'function') {
        return overrides.onGetStartWithWindows()
      }
      return { ...state.startup }
    },
    setStartWithWindows: async (enabled) => {
      calls.push({ kind: 'setStartWithWindows', enabled })
      if (typeof overrides.onSetStartWithWindows === 'function') {
        return overrides.onSetStartWithWindows(enabled)
      }
      state.startup.enabled = Boolean(enabled)
      return { ...state.startup }
    },
    openFile: async (jobId) => {
      calls.push({ kind: 'openFile', jobId })
      if (typeof overrides.onOpenFile === 'function') return overrides.onOpenFile(jobId)
      return { success: true }
    },
    openFolder: async (jobId) => {
      calls.push({ kind: 'openFolder', jobId })
      if (typeof overrides.onOpenFolder === 'function') return overrides.onOpenFolder(jobId)
      return { success: true }
    },
    pickFolder: async () => {
      calls.push({ kind: 'pickFolder' })
      if (typeof overrides.onPickFolder === 'function') return overrides.onPickFolder()
      return { canceled: false, path: 'D:\\MediaDownloads' }
    },
    openDownloadFolder: async (folderPath) => {
      calls.push({ kind: 'openDownloadFolder', folderPath })
      if (typeof overrides.onOpenDownloadFolder === 'function') {
        return overrides.onOpenDownloadFolder(folderPath)
      }
      return { success: true }
    },
    openDownloadedFile: async (filePath) => {
      calls.push({ kind: 'openDownloadedFile', filePath })
      if (typeof overrides.onOpenDownloadedFile === 'function') {
        return overrides.onOpenDownloadedFile(filePath)
      }
      return { success: true }
    },
    getDownloadsLocationInfo: async () => {
      calls.push({ kind: 'getDownloadsLocationInfo' })
      return {
        available: true,
        path: state.settings.downloadPath,
        totalBytes: 500 * 1024 ** 3,
        freeBytes: 220 * 1024 ** 3
      }
    },
    getStartupEnabled: async () => {
      calls.push({ kind: 'getStartupEnabled' })
      return { ...state.startup }
    },
    setStartupEnabled: async (enabled) => {
      calls.push({ kind: 'setStartupEnabled', enabled })
      state.startup.enabled = Boolean(enabled)
      return { ...state.startup }
    }
  }

  return {
    api,
    state,
    calls,
    clearCalls: () => {
      calls.length = 0
    }
  }
}
