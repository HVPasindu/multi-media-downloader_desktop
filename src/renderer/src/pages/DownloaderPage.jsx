import { useEffect, useRef, useState } from 'react'
import {
  Zap,
  ShieldCheck,
  Globe2,
  Link2,
  Search,
  Loader2,
  X,
  ClipboardPaste,
  AlertCircle,
  Video,
  Music,
  FolderOpen,
  Download,
  Trash2,
  Pause,
  Play,
  MoreVertical,
  CheckCircle2,
  Clock,
  CloudUpload
} from 'lucide-react'
import LoadingIndicator from '../components/common/LoadingIndicator'
import DownloaderHeroIllustration from '../components/ui/DownloaderHeroIllustration'
import MediaThumbnail from '../components/ui/MediaThumbnail'
import PlatformBadge from '../components/ui/PlatformBadge'
import { DOWNLOADER_MEDIA_PREVIEW, RECENT_DOWNLOADS_LIST } from '../data/uiPreviewData'
import { analyzeMedia } from '../services/mediaApi'
import { formatMediaDuration, getMediaFormatAvailability } from '../utils/mediaMetadata'
import { extractUrlFromDataTransfer, validateMediaUrlInput } from '../utils/mediaUrlInput'

/**
 * Downloader Page - Fully refined to match Reference Image 1.
 * Features:
 * - Branded Header with feature pills & 3D hero pedestal illustration
 * - Two-column responsive desktop layout (1200x780 target)
 * - Section 1: Link input with Clear, Clipboard Paste and Analyze actions + Active Media Preview Card
 * - Section 2: Choose Format (MP4 Video / MP3 Audio selectable cards)
 * - Section 3 & 4: Video Quality & Audio Bitrate option pills
 * - Section 5: Download Folder destination selector with Choose button
 * - Radiant full-width Download CTA button
 * - Right Column: Recent Downloads card with live progress, pause/play, folder action & Drag-and-Drop dropzone
 *
 * STEPS 05.04 + 05.05 + 05.06 IMPLEMENTATION:
 * - Step 05.04: Analyze URL integration with backend Express API via mediaApi.js / IPC bridge
 * - Loading indicator during analysis, button state toggle, stale request invalidation
 * - User-friendly API error handling (400, 401/403, 500, network/IPC)
 * - Step 05.05: Dynamic media preview component showing actual thumbnail, title, platform, duration, and stream info
 * - Step 05.06: MP4/MP3 format availability based on mp4Qualities and audioOptions with automatic selection rules
 * - Targeted Fix: Invalid drag & drop immediately invalidates in-flight Analyze requests
 */
export default function DownloaderPage() {
  const [url, setUrl] = useState('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  const [validatedUrl, setValidatedUrl] = useState(null)
  const [urlError, setUrlError] = useState(null)
  const [urlStatus, setUrlStatus] = useState(null)
  const [detectedPlatform, setDetectedPlatform] = useState(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  // Step 05.04: Backend media analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzedMedia, setAnalyzedMedia] = useState(null)
  const [apiError, setApiError] = useState(null)

  // Step 05.06: Format selection state
  const [selectedFormat, setSelectedFormat] = useState('mp4')
  const [selectedVideoQuality, setSelectedVideoQuality] = useState('1080p')
  const [selectedAudioBitrate, setSelectedAudioBitrate] = useState('192k')
  const [downloadFolder, setDownloadFolder] = useState(
    'C:\\Users\\Alex\\Downloads\\Multi Media Downloader'
  )
  const [recentDownloads, setRecentDownloads] = useState(RECENT_DOWNLOADS_LIST)

  const inputRef = useRef(null)
  const activeRequestIdRef = useRef(0)

  /**
   * Window-level drag & drop prevention to ensure Electron does not navigate
   * away from the React single page application when dropping outside the dropzone.
   */
  useEffect(() => {
    const preventDefaultWindowDragOver = (e) => {
      e.preventDefault()
    }
    const preventDefaultWindowDrop = (e) => {
      e.preventDefault()
    }

    window.addEventListener('dragover', preventDefaultWindowDragOver)
    window.addEventListener('drop', preventDefaultWindowDrop)

    return () => {
      window.removeEventListener('dragover', preventDefaultWindowDragOver)
      window.removeEventListener('drop', preventDefaultWindowDrop)
    }
  }, [])

  /**
   * Applies client-side validation result to component state.
   */
  const applyValidationResult = (validation) => {
    if (validation.valid) {
      setValidatedUrl(validation.url)
      setDetectedPlatform(validation.platform)
      setUrlStatus(validation.message)
      setUrlError(null)
      setApiError(null)
    } else {
      setValidatedUrl(null)
      setDetectedPlatform(null)
      setUrlStatus(null)
      setUrlError(validation.error)
      setAnalyzedMedia(null)
      setApiError(null)
    }
  }

  /**
   * Clears the current URL input and resets all validation, analysis, and error indicators.
   */
  const handleClearUrl = () => {
    activeRequestIdRef.current++
    setUrl('')
    setValidatedUrl(null)
    setUrlError(null)
    setUrlStatus(null)
    setDetectedPlatform(null)
    setAnalyzedMedia(null)
    setApiError(null)
    setIsAnalyzing(false)
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  /**
   * Handles user keystrokes in the URL input.
   * Immediately clears previous validation, analysis, and platform state upon editing.
   */
  const handleUrlChange = (value) => {
    activeRequestIdRef.current++
    setUrl(value)
    setValidatedUrl(null)
    setDetectedPlatform(null)
    setUrlError(null)
    setUrlStatus(null)
    setAnalyzedMedia(null)
    setApiError(null)
    setIsAnalyzing(false)
  }

  /**
   * Validates input when focus leaves the input field.
   */
  const handleUrlBlur = () => {
    const trimmed = url.trim()
    if (!trimmed) {
      setValidatedUrl(null)
      setDetectedPlatform(null)
      setUrlError(null)
      setUrlStatus(null)
      setAnalyzedMedia(null)
      setApiError(null)
      return
    }

    const validation = validateMediaUrlInput(trimmed)
    applyValidationResult(validation)
  }

  /**
   * Handles native paste event (Ctrl+V / right-click paste) on the input field.
   * Uses preventDefault to avoid browser-level race conditions with subsequent onChange.
   */
  const handleInputPaste = (e) => {
    const pastedText = e.clipboardData?.getData('text')
    if (pastedText) {
      e.preventDefault()
      activeRequestIdRef.current++
      const trimmed = pastedText.trim()
      setUrl(trimmed)
      setAnalyzedMedia(null)
      setApiError(null)
      setIsAnalyzing(false)
      const validation = validateMediaUrlInput(trimmed)
      applyValidationResult(validation)
    }
  }

  /**
   * Reads text from system clipboard using the standard Async Clipboard API.
   * Handles empty clipboard and permission denial gracefully.
   */
  const handlePasteFromClipboard = async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        setUrlError('Clipboard access is unavailable. Press Ctrl+V to paste your link.')
        setUrlStatus(null)
        setDetectedPlatform(null)
        setValidatedUrl(null)
        setAnalyzedMedia(null)
        setApiError(null)
        return
      }

      const text = await navigator.clipboard.readText()
      const trimmed = (text || '').trim()

      if (!trimmed) {
        activeRequestIdRef.current++
        setIsAnalyzing(false)
        setUrlError('Clipboard is empty. Copy a media link and try again.')
        setUrlStatus(null)
        setDetectedPlatform(null)
        setValidatedUrl(null)
        setAnalyzedMedia(null)
        setApiError(null)
        return
      }

      activeRequestIdRef.current++
      setUrl(trimmed)
      setAnalyzedMedia(null)
      setApiError(null)
      setIsAnalyzing(false)
      const validation = validateMediaUrlInput(trimmed)
      applyValidationResult(validation)

      if (inputRef.current) {
        inputRef.current.focus()
      }
    } catch {
      setUrlError('Clipboard access is unavailable. Press Ctrl+V to paste your link.')
      setUrlStatus(null)
      setDetectedPlatform(null)
      setValidatedUrl(null)
      setAnalyzedMedia(null)
      setApiError(null)
    }
  }

  /**
   * Drag & Drop event handlers for the dedicated dropzone.
   */
  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)

    // Invalidate any previous in-flight Analyze request and stop analyzing state immediately
    activeRequestIdRef.current++
    setIsAnalyzing(false)
    setAnalyzedMedia(null)
    setApiError(null)

    const extraction = extractUrlFromDataTransfer(e.dataTransfer)
    if (extraction.error) {
      setUrlError(extraction.error)
      setUrlStatus(null)
      setDetectedPlatform(null)
      setValidatedUrl(null)
      return
    }

    if (extraction.url) {
      const trimmed = extraction.url.trim()
      setUrl(trimmed)
      const validation = validateMediaUrlInput(trimmed)
      applyValidationResult(validation)

      if (inputRef.current) {
        inputRef.current.focus()
      }
    }
  }

  /**
   * Clicking the dropzone focuses the URL input and prompts for entry.
   */
  const handleDropzoneClick = () => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }

  /**
   * Analyze Action (Steps 05.04 + 05.05 + 05.06):
   * 1. Validates candidate URL client-side.
   * 2. Calls backend Express API POST /api/media/analyze via mediaApi.js / IPC bridge.
   * 3. Renders actual media metadata (thumbnail, title, platform, duration, available formats).
   * 4. Updates MP4/MP3 format availability and auto-selects valid format.
   */
  const handleAnalyzeClick = async () => {
    if (isAnalyzing) return

    const trimmed = url.trim()
    if (!trimmed) {
      setUrlError('Please enter a media link.')
      setUrlStatus(null)
      setDetectedPlatform(null)
      setValidatedUrl(null)
      setAnalyzedMedia(null)
      setApiError(null)
      if (inputRef.current) {
        inputRef.current.focus()
      }
      return
    }

    // Step 1: Client-side validation
    const validation = validateMediaUrlInput(trimmed)
    if (!validation.valid) {
      setValidatedUrl(null)
      setDetectedPlatform(null)
      setUrlStatus(null)
      setUrlError(validation.error)
      setAnalyzedMedia(null)
      setApiError(null)
      return
    }

    // Apply client validation state
    setValidatedUrl(validation.url)
    setDetectedPlatform(validation.platform)
    setUrlStatus(validation.message)
    setUrlError(null)
    setApiError(null)

    // Step 2: Call backend media analyzer API with stale-request tracking
    const currentRequestId = ++activeRequestIdRef.current
    setIsAnalyzing(true)

    try {
      const response = await analyzeMedia(validation.url)

      // Guard against stale asynchronous response
      if (currentRequestId !== activeRequestIdRef.current) {
        return
      }

      if (response.ok && response.data?.success && response.data?.data) {
        const metadata = response.data.data
        setAnalyzedMedia(metadata)
        setApiError(null)

        // Step 05.06: Auto-select format based on real stream availability
        const availability = getMediaFormatAvailability(metadata)
        if (availability.mp4Available && !availability.mp3Available) {
          setSelectedFormat('mp4')
        } else if (!availability.mp4Available && availability.mp3Available) {
          setSelectedFormat('mp3')
        } else if (availability.mp4Available && availability.mp3Available) {
          setSelectedFormat((prev) => (prev === 'mp3' ? 'mp3' : 'mp4'))
        } else {
          setSelectedFormat(null)
        }
      } else {
        const status = response.status
        let errorMsg = 'Failed to analyze media link. Please verify the URL and try again.'

        if (status === 400) {
          errorMsg = response.data?.message || 'Invalid or unsupported media URL.'
        } else if (status === 401 || status === 403) {
          errorMsg = 'API authorization failed. Please restart the application.'
        } else if (status >= 500) {
          errorMsg =
            response.data?.message && response.data.message !== 'Internal server error'
              ? response.data.message
              : 'Media analysis failed. Please check your internet connection or verify the video is publicly accessible.'
        } else if (response.data?.message) {
          errorMsg = response.data.message
        }

        setApiError(errorMsg)
        setAnalyzedMedia(null)
      }
    } catch (err) {
      if (currentRequestId !== activeRequestIdRef.current) {
        return
      }
      const isIpcError = err?.message?.includes('IPC') || err?.message?.includes('bridge')
      const errorMsg = isIpcError
        ? 'Local analyzer service could not be reached via IPC. Please restart the application.'
        : err instanceof Error
          ? err.message
          : 'An unexpected error occurred while analyzing the media link.'
      setApiError(errorMsg)
      setAnalyzedMedia(null)
    } finally {
      if (currentRequestId === activeRequestIdRef.current) {
        setIsAnalyzing(false)
      }
    }
  }

  const handleClearRecent = () => {
    setRecentDownloads([])
  }

  // Derive explicit validation condition
  const isCurrentUrlValidated =
    Boolean(validatedUrl) &&
    validatedUrl === url.trim() &&
    Boolean(detectedPlatform) &&
    !urlError &&
    !apiError

  // Sample demonstration preview for initial page display before any editing/validation
  const isSamplePreview =
    url === DOWNLOADER_MEDIA_PREVIEW.url &&
    !validatedUrl &&
    !analyzedMedia &&
    !isAnalyzing &&
    !apiError

  // Step 05.06: Format availability extraction
  const formatAvailability = getMediaFormatAvailability(analyzedMedia)
  const { mp4Available, mp3Available, mp4Qualities } = formatAvailability

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] w-full mx-auto flex flex-col gap-6 select-none animate-fadeIn">
      {/* ----------------- TOP HEADER & HERO ILLUSTRATION ----------------- */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl lg:text-4xl font-extrabold text-white tracking-tight">
            Downloader
          </h1>
          <p className="text-sm text-text-muted mt-1 font-medium">
            Paste a link, choose your options, and download your media.
          </p>

          {/* Feature Badges */}
          <div className="flex flex-wrap items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#19D8FF]">
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>Fast & Reliable</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#19D8FF]">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>High Quality</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#19D8FF]">
              <Globe2 className="w-3.5 h-3.5" />
              <span>Supports Multiple Platforms</span>
            </div>
          </div>
        </div>

        {/* 3D Pedestal Hero Art (Matching Reference Image 1) */}
        <DownloaderHeroIllustration className="hidden md:flex flex-shrink-0" />
      </div>

      {/* ----------------- MAIN TWO-COLUMN LAYOUT ----------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ================= LEFT COLUMN: DOWNLOAD OPTIONS (7 COLS) ================= */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          {/* Section 1: Enter Media Link & Media Preview */}
          <div className="p-5 lg:p-6 rounded-2xl bg-[#07152E]/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-extrabold text-white tracking-wide">
                1. Enter Media Link
              </h2>
            </div>

            {/* Input Bar */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1 flex items-center">
                <Link2 className="absolute left-3.5 w-4 h-4 text-text-muted/70 pointer-events-none" />
                <input
                  ref={inputRef}
                  type="text"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  onBlur={handleUrlBlur}
                  onPaste={handleInputPaste}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAnalyzeClick()
                  }}
                  placeholder="Paste YouTube, TikTok, Instagram, Facebook or X link here..."
                  aria-label="Media link URL"
                  aria-invalid={!!urlError || !!apiError}
                  aria-describedby={
                    urlError
                      ? 'media-url-error'
                      : apiError
                        ? 'media-api-error'
                        : urlStatus
                          ? 'media-url-status'
                          : undefined
                  }
                  className={`w-full bg-[#040B1C] border rounded-xl py-3 pl-10 pr-20 text-xs font-medium text-white placeholder:text-text-muted/50 focus:outline-none transition-all font-mono select-text ${
                    urlError || apiError
                      ? 'border-rose-500/60 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/40'
                      : urlStatus || analyzedMedia
                        ? 'border-cyan-400/50 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/40'
                        : 'border-primary/20 focus:border-primary focus:ring-1 focus:ring-primary/40'
                  }`}
                />

                {/* Inline Action Buttons inside input */}
                <div className="absolute right-2.5 flex items-center gap-1">
                  {url && (
                    <button
                      type="button"
                      onClick={handleClearUrl}
                      className="p-1 text-text-muted/60 hover:text-white transition-colors cursor-pointer"
                      title="Clear link"
                      aria-label="Clear link"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handlePasteFromClipboard}
                    className="p-1 text-text-muted/70 hover:text-[#19D8FF] transition-colors cursor-pointer"
                    title="Paste link from clipboard"
                    aria-label="Paste link from clipboard"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Analyze Button */}
              <button
                type="button"
                onClick={handleAnalyzeClick}
                disabled={isAnalyzing || !url.trim()}
                title="Analyze media URL"
                className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-xs bg-gradient-to-r from-[#19D8FF] to-[#3388FF] text-white shadow-[0_0_16px_rgba(25,216,255,0.35)] hover:shadow-[0_0_24px_rgba(25,216,255,0.55)] transition-all cursor-pointer flex-shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isAnalyzing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                <span>{isAnalyzing ? 'Analyzing...' : 'Analyze'}</span>
              </button>
            </div>

            {/* Validation & API Error Feedback */}
            {urlError && (
              <div
                id="media-url-error"
                role="alert"
                className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3.5 py-2.5 rounded-xl animate-fadeIn"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{urlError}</span>
              </div>
            )}
            {apiError && !urlError && (
              <div
                id="media-api-error"
                role="alert"
                className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3.5 py-2.5 rounded-xl animate-fadeIn"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{apiError}</span>
              </div>
            )}
            {!urlError && !apiError && urlStatus && !analyzedMedia && !isAnalyzing && (
              <div
                id="media-url-status"
                role="status"
                className="flex items-center gap-2 text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-3.5 py-2.5 rounded-xl animate-fadeIn"
              >
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-[#19D8FF]" />
                <span>{urlStatus}</span>
              </div>
            )}

            {/* Analyzed Media Preview Card (Step 05.05) */}
            {isAnalyzing ? (
              <div className="flex flex-col items-center justify-center p-8 rounded-xl bg-[#040B1C]/80 border border-primary/20 animate-fadeIn min-h-[140px]">
                <LoadingIndicator
                  type="spinner"
                  label="Connecting to media source and retrieving format details..."
                />
              </div>
            ) : analyzedMedia ? (
              <div className="flex flex-col sm:flex-row items-center gap-4 p-3.5 rounded-xl bg-[#040B1C]/80 border border-primary/15 animate-fadeIn">
                <div className="w-full sm:w-44 flex-shrink-0">
                  <MediaThumbnail
                    src={analyzedMedia.thumbnailUrl}
                    duration={formatMediaDuration(analyzedMedia.durationSeconds)}
                    showPlayOverlay={true}
                    aspectRatio="aspect-video"
                  />
                </div>

                <div className="flex-1 flex flex-col justify-center min-w-0">
                  <h3 className="text-sm font-bold text-white truncate" title={analyzedMedia.title}>
                    {analyzedMedia.title}
                  </h3>
                  <div className="mt-1 flex items-center gap-3">
                    <PlatformBadge platform={analyzedMedia.platform} />
                    {analyzedMedia.durationSeconds !== null && (
                      <span className="text-[11px] text-text-muted">
                        Duration: {formatMediaDuration(analyzedMedia.durationSeconds)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted/80 mt-1.5 line-clamp-2 leading-relaxed">
                    {mp4Qualities.length > 0
                      ? `Available MP4 Qualities: ${mp4Qualities.slice(0, 4).join(', ')}${
                          mp4Qualities.length > 4 ? ` (+${mp4Qualities.length - 4} more)` : ''
                        }`
                      : 'No MP4 video stream available'}
                    {mp3Available ? ' • MP3 Audio stream ready' : ''}
                  </p>
                </div>
              </div>
            ) : isCurrentUrlValidated ? (
              <div className="flex flex-col sm:flex-row items-center gap-4 p-3.5 rounded-xl bg-[#040B1C]/80 border border-primary/15 animate-fadeIn">
                <div className="w-full sm:w-44 aspect-video rounded-lg bg-surface flex flex-col items-center justify-center text-text-muted/60 border border-primary/10 flex-shrink-0">
                  <Video className="w-8 h-8 text-[#19D8FF]/70 mb-1" />
                  <span className="text-[10px] font-mono tracking-wider">READY</span>
                </div>

                <div className="flex-1 flex flex-col justify-center min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">Link Ready for Analysis</h3>
                  <div className="mt-1">
                    <PlatformBadge platform={detectedPlatform?.id || 'web'} />
                  </div>
                  <p className="text-xs text-text-muted/80 mt-1.5 line-clamp-2 leading-relaxed">
                    Supported media link ready. Click Analyze to retrieve live video metadata,
                    thumbnail, duration, and available download streams.
                  </p>
                </div>
              </div>
            ) : isSamplePreview && DOWNLOADER_MEDIA_PREVIEW && !urlError ? (
              <div className="flex flex-col sm:flex-row items-center gap-4 p-3.5 rounded-xl bg-[#040B1C]/80 border border-primary/15 animate-fadeIn">
                <div className="w-full sm:w-44 flex-shrink-0">
                  <MediaThumbnail
                    src={DOWNLOADER_MEDIA_PREVIEW.thumbnail}
                    duration={DOWNLOADER_MEDIA_PREVIEW.duration}
                    showPlayOverlay={true}
                    aspectRatio="aspect-video"
                  />
                </div>

                <div className="flex-1 flex flex-col justify-center min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">
                    {DOWNLOADER_MEDIA_PREVIEW.title}
                  </h3>
                  <div className="mt-1">
                    <PlatformBadge platform={DOWNLOADER_MEDIA_PREVIEW.platform} />
                  </div>
                  <p className="text-xs text-text-muted/80 mt-1.5 line-clamp-2 leading-relaxed">
                    {DOWNLOADER_MEDIA_PREVIEW.description}
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Section 2: Choose Format (Step 05.06) */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                2. Choose Format
              </h2>
              {analyzedMedia && (
                <span className="text-[11px] text-text-muted">
                  {mp4Available && mp3Available
                    ? 'MP4 Video & MP3 Audio available'
                    : mp4Available
                      ? 'MP4 Video only'
                      : mp3Available
                        ? 'MP3 Audio only'
                        : 'No format available'}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              {/* MP4 Video Option */}
              <button
                type="button"
                disabled={!mp4Available}
                onClick={() => mp4Available && setSelectedFormat('mp4')}
                className={`flex items-center justify-between p-4 rounded-2xl border transition-all text-left ${
                  !mp4Available
                    ? 'opacity-40 cursor-not-allowed bg-[#07152E]/40 border-primary/10'
                    : selectedFormat === 'mp4'
                      ? 'bg-[#0B1C38] border-cyan-400 shadow-[0_0_20px_rgba(25,216,255,0.3)] cursor-pointer'
                      : 'bg-[#07152E]/80 border-primary/15 hover:border-primary/30 cursor-pointer'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      !mp4Available
                        ? 'bg-surface text-text-muted/50'
                        : selectedFormat === 'mp4'
                          ? 'bg-cyan-500/20 text-[#19D8FF]'
                          : 'bg-surface text-text-muted'
                    }`}
                  >
                    <Video className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-sm font-extrabold text-white block">MP4</span>
                    <span className="text-[11px] text-text-muted">
                      {mp4Available ? 'Video (Best Quality)' : 'Not Available'}
                    </span>
                  </div>
                </div>

                {/* Radio Indicator */}
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    !mp4Available
                      ? 'border-text-muted/20'
                      : selectedFormat === 'mp4'
                        ? 'border-[#19D8FF] bg-[#040B1C]'
                        : 'border-text-muted/40'
                  }`}
                >
                  {selectedFormat === 'mp4' && mp4Available && (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#19D8FF]" />
                  )}
                </div>
              </button>

              {/* MP3 Audio Option */}
              <button
                type="button"
                disabled={!mp3Available}
                onClick={() => mp3Available && setSelectedFormat('mp3')}
                className={`flex items-center justify-between p-4 rounded-2xl border transition-all text-left ${
                  !mp3Available
                    ? 'opacity-40 cursor-not-allowed bg-[#07152E]/40 border-primary/10'
                    : selectedFormat === 'mp3'
                      ? 'bg-[#0B1C38] border-cyan-400 shadow-[0_0_20px_rgba(25,216,255,0.3)] cursor-pointer'
                      : 'bg-[#07152E]/80 border-primary/15 hover:border-primary/30 cursor-pointer'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      !mp3Available
                        ? 'bg-surface text-text-muted/50'
                        : selectedFormat === 'mp3'
                          ? 'bg-cyan-500/20 text-[#19D8FF]'
                          : 'bg-surface text-text-muted'
                    }`}
                  >
                    <Music className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-sm font-extrabold text-white block">MP3</span>
                    <span className="text-[11px] text-text-muted">
                      {mp3Available ? 'Audio Only' : 'Not Available'}
                    </span>
                  </div>
                </div>

                {/* Radio Indicator */}
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    !mp3Available
                      ? 'border-text-muted/20'
                      : selectedFormat === 'mp3'
                        ? 'border-[#19D8FF] bg-[#040B1C]'
                        : 'border-text-muted/40'
                  }`}
                >
                  {selectedFormat === 'mp3' && mp3Available && (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#19D8FF]" />
                  )}
                </div>
              </button>
            </div>

            {/* Warning when neither format is available */}
            {analyzedMedia && !mp4Available && !mp3Available && (
              <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-xl">
                No compatible MP4 video or MP3 audio streams could be extracted from this media
                link.
              </div>
            )}
          </div>

          {/* Section 3 & 4: Quality & Bitrate Side by Side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 3. Video Quality */}
            <div className="flex flex-col gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                3. Video Quality
              </h2>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: '720p', title: '720p', sub: 'HD' },
                  { id: '1080p', title: '1080p', sub: 'Full HD' },
                  { id: 'best', title: 'Best', sub: 'Available 👑' }
                ].map((q) => {
                  const isSel = selectedVideoQuality === q.id
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setSelectedVideoQuality(q.id)}
                      className={`py-2.5 px-2 rounded-xl text-center border transition-all cursor-pointer ${
                        isSel
                          ? 'bg-[#0B1C38] border-cyan-400 text-white shadow-[0_0_14px_rgba(25,216,255,0.3)]'
                          : 'bg-[#07152E]/80 border-primary/15 text-text-muted hover:border-primary/30 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-extrabold">{q.title}</div>
                      <div className="text-[10px] text-text-muted/80">{q.sub}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 4. Audio Bitrate */}
            <div className="flex flex-col gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                4. Audio Bitrate (for MP3)
              </h2>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: '128k', label: '128', unit: 'kbps' },
                  { id: '192k', label: '192', unit: 'kbps' },
                  { id: '320k', label: '320', unit: 'kbps' }
                ].map((b) => {
                  const isSel = selectedAudioBitrate === b.id
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelectedAudioBitrate(b.id)}
                      className={`py-2.5 px-2 rounded-xl text-center border transition-all cursor-pointer ${
                        isSel
                          ? 'bg-[#0B1C38] border-cyan-400 text-white shadow-[0_0_14px_rgba(25,216,255,0.3)]'
                          : 'bg-[#07152E]/80 border-primary/15 text-text-muted hover:border-primary/30 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-extrabold">{b.label}</div>
                      <div className="text-[10px] text-text-muted/80">{b.unit}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Section 5: Download Folder Destination */}
          <div className="flex flex-col gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
              5. Download Folder
            </h2>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 flex items-center">
                <FolderOpen className="absolute left-3.5 w-4 h-4 text-text-muted" />
                <input
                  type="text"
                  value={downloadFolder}
                  onChange={(e) => setDownloadFolder(e.target.value)}
                  className="w-full bg-[#040B1C] border border-primary/20 rounded-xl py-2.5 pl-10 pr-3 text-xs text-text-muted font-mono focus:outline-none focus:border-primary"
                />
              </div>
              <button
                type="button"
                className="px-4 py-2.5 rounded-xl text-xs font-bold bg-[#07152E] hover:bg-[#0B1C38] border border-primary/25 text-white transition-all cursor-pointer"
              >
                Choose...
              </button>
            </div>
          </div>

          {/* Big Download Button */}
          <button
            type="button"
            className="w-full py-4 rounded-2xl font-black text-sm lg:text-base tracking-wide bg-gradient-to-r from-[#19D8FF] via-[#3388FF] to-[#514BFF] text-white shadow-[0_0_28px_rgba(25,216,255,0.45)] hover:shadow-[0_0_36px_rgba(25,216,255,0.65)] hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2.5 cursor-pointer mt-1"
          >
            <Download className="w-5 h-5 stroke-[2.5]" />
            <span>Download</span>
          </button>
        </div>

        {/* ================= RIGHT COLUMN: RECENT DOWNLOADS & DROPZONE (5 COLS) ================= */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Recent Downloads Card */}
          <div className="p-5 rounded-2xl bg-[#07152E]/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-primary/10">
              <h2 className="text-sm font-extrabold text-white">Recent Downloads</h2>
              <button
                type="button"
                onClick={handleClearRecent}
                className="flex items-center gap-1 text-[11px] font-semibold text-text-muted hover:text-white transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear All</span>
              </button>
            </div>

            {/* List of 5 items matching Reference Image 1 */}
            <div className="flex flex-col gap-3">
              {recentDownloads.map((item) => {
                const isDownloading = item.status === 'downloading'
                const isPaused = item.status === 'paused'

                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-2.5 rounded-xl bg-[#040B1C]/70 border border-primary/10 hover:border-primary/25 transition-all"
                  >
                    {/* Thumbnail */}
                    <div className="w-16 h-11 flex-shrink-0">
                      <MediaThumbnail
                        src={item.thumbnail}
                        duration={item.duration}
                        aspectRatio="aspect-video"
                      />
                    </div>

                    {/* Metadata & Progress */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-white truncate block">
                          {item.title}
                        </span>
                      </div>

                      <div className="text-[10px] text-text-muted mt-0.5">
                        {item.format} • {item.quality} • {item.fileSize || item.size}
                      </div>

                      {/* Downloading state: active progress bar */}
                      {isDownloading && (
                        <div className="mt-1.5 flex flex-col gap-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-[#19D8FF] font-semibold">
                              {item.statusText || `Downloading... ${item.progress}%`}
                            </span>
                            <span className="text-white font-bold">{item.progress}%</span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-[#0B1C38] overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-[#19D8FF] to-[#3388FF] rounded-full"
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Completed state */}
                      {item.status === 'completed' && (
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#00DEA5] font-semibold">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{item.statusText || 'Completed'}</span>
                        </div>
                      )}

                      {/* Paused state */}
                      {isPaused && (
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-purple-400 font-semibold">
                          <Clock className="w-3 h-3" />
                          <span>{item.statusText || 'Paused'}</span>
                        </div>
                      )}
                    </div>

                    {/* Quick Action Button */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isDownloading && (
                        <button
                          type="button"
                          className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center text-text-muted hover:text-white border border-primary/10 cursor-pointer"
                          title="Pause"
                        >
                          <Pause className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {isPaused && (
                        <button
                          type="button"
                          className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center text-text-muted hover:text-white border border-primary/10 cursor-pointer"
                          title="Resume"
                        >
                          <Play className="w-3.5 h-3.5 ml-0.5" />
                        </button>
                      )}

                      {item.status === 'completed' && (
                        <button
                          type="button"
                          className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center text-text-muted hover:text-white border border-primary/10 cursor-pointer"
                          title="Open Folder"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        type="button"
                        className="w-7 h-8 flex items-center justify-center text-text-muted/60 hover:text-white cursor-pointer"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Drag & Drop Link Dropzone (Matching Reference Image 1) */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleDropzoneClick}
            className={`p-4 rounded-2xl border-2 border-dashed transition-all flex flex-col items-center justify-center text-center gap-1.5 py-5 cursor-pointer select-none ${
              isDraggingOver
                ? 'border-[#19D8FF] bg-[#19D8FF]/10 shadow-[0_0_24px_rgba(25,216,255,0.35)] scale-[1.01]'
                : 'border-primary/30 bg-[#07152E]/50 hover:border-primary/60 hover:bg-[#07152E]/70'
            }`}
            role="region"
            aria-label="Drag and drop media link zone"
          >
            <CloudUpload
              className={`w-7 h-7 transition-colors ${
                isDraggingOver ? 'text-white scale-110' : 'text-[#19D8FF]'
              }`}
            />
            <span className="text-xs font-bold text-white tracking-wide">
              {isDraggingOver ? 'Drop Link Here' : 'Drag & drop a link here'}
            </span>
            <span className="text-[10px] text-text-muted">
              Supports YouTube, TikTok, Instagram, Facebook, and more...
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
