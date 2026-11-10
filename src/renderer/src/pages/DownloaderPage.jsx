import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
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
  CheckCircle2,
  Clock,
  CloudUpload,
  Square,
  RotateCcw
} from 'lucide-react'
import LoadingIndicator from '../components/common/LoadingIndicator'
import DownloaderHeroIllustration from '../components/ui/DownloaderHeroIllustration'
import MediaThumbnail from '../components/ui/MediaThumbnail'
import PlatformBadge from '../components/ui/PlatformBadge'
import { chooseDownloadFolder, getDownloadFolder } from '../services/api'
import { getDownloadSettings } from '../services/downloadSettingsApi'
import { resolvePreferredVideoQuality } from '../utils/downloadPreferenceResolver'
import { createDownload, listDownloads, deleteDownloadHistory } from '../services/downloadsApi'
import { useDownloadJobActions } from '../hooks/useDownloadJobActions'
import { analyzeMedia } from '../services/mediaApi'
import { normalizeDownloadJob } from '../utils/downloadPresentation'
import { showConfirm, showToast, showError } from '../utils/notificationService'
import { getSafeFriendlyErrorInfo } from '../utils/errorPresentation'
import {
  formatMediaDuration,
  getMediaFormatAvailability,
  extractMp4Qualities,
  estimateMp4QualitySize,
  estimateMp3BitrateSize
} from '../utils/mediaMetadata'
import { extractUrlFromDataTransfer, validateMediaUrlInput } from '../utils/mediaUrlInput'
import { useDownloadDuplicateGuard } from '../hooks/useDownloadDuplicateGuard'

/**
 * Downloader Page - Fully refined to match Reference Image 1.
 * Features:
 * - Branded Header with feature pills & 3D hero pedestal illustration
 * - Two-column responsive desktop layout (1200x780 target)
 * - Section 1: Link input with Clear, Clipboard Paste and Analyze actions + Active Media Preview Card
 * - Section 2: Choose Format (MP4 Video / MP3 Audio selectable cards with visual isolation)
 * - Section 3 & 4: Dynamic Video Quality & Audio Bitrate options with mutual visual isolation
 * - Section 5: Download Folder destination selector with Choose button
 * - Radiant full-width Download CTA button
 * - Right Column: Recent Downloads card with live progress, pause/play, folder action & Drag-and-Drop dropzone
 *
 * PHASES 01 & 02 IMPLEMENTATION:
 * - Step 01: In-memory analysis caching & deduplication (backend) + MP4 quality validation fix
 * - Step 02: YouTube 429 Cooldown countdown & structured error classification with selective Retry button
 * - Step 03: Dynamic MP4 Quality buttons from verified streams without hardcoding or fake placeholders
 * - Step 04: Visual isolation between MP4 and MP3 format configurations
 * - Step 05: Invalid Drag & Drop request cancellation with activeRequestIdRef invalidation
 * - Step 06: Thumbnail URL validation & fallback protection
 */
export default function DownloaderPage() {
  const [url, setUrl] = useState('')
  const [validatedUrl, setValidatedUrl] = useState(null)
  const [urlError, setUrlError] = useState(null)
  const [urlStatus, setUrlStatus] = useState(null)
  const [detectedPlatform, setDetectedPlatform] = useState(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  // Backend media analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzedMedia, setAnalyzedMedia] = useState(null)
  const [apiError, setApiError] = useState(null)
  const [apiErrorCode, setApiErrorCode] = useState(null)

  // Step 02: Rate limit cooldown countdown timer (in seconds)
  const [cooldownRemaining, setCooldownRemaining] = useState(0)

  // Step 03 & 04: Format & Quality & Bitrate selection state
  const [selectedFormat, setSelectedFormat] = useState('mp4')
  const [selectedVideoQuality, setSelectedVideoQuality] = useState('best')
  const [selectedAudioBitrate, setSelectedAudioBitrate] = useState(192)
  const [isPreferencesLoading, setIsPreferencesLoading] = useState(true)

  // Download folder settings state
  const [downloadFolder, setDownloadFolder] = useState('')
  const [isLoadingFolder, setIsLoadingFolder] = useState(true)
  const [folderError, setFolderError] = useState(null)

  // Download job creation state
  const [isSubmittingDownload, setIsSubmittingDownload] = useState(false)
  const [downloadSubmitFeedback, setDownloadSubmitFeedback] = useState(null)

  // Live Recent Downloads state
  const [recentDownloads, setRecentDownloads] = useState([])
  const [isLoadingRecent, setIsLoadingRecent] = useState(true)

  const inputRef = useRef(null)
  const activeRequestIdRef = useRef(0)
  const speedTrackerRef = useRef(new Map())
  const isPollingRecentRef = useRef(false)
  const hasActiveRecentRef = useRef(false)
  const savedPreferencesRef = useRef({
    preferredMp4Quality: 'best',
    preferredMp3BitrateKbps: 192
  })

  /**
   * Cooldown countdown timer for YouTube rate limit (Step 02).
   */
  useEffect(() => {
    if (cooldownRemaining <= 0) return

    const timer = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [cooldownRemaining])

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
      setApiErrorCode(null)
    } else {
      setValidatedUrl(null)
      setDetectedPlatform(null)
      setUrlStatus(null)
      setUrlError(validation.error)
      setAnalyzedMedia(null)
      setApiError(null)
      setApiErrorCode(null)
    }
  }

  /**
   * Clears the current URL input and resets all validation, analysis, and error indicators.
   * Step 05: Invalidates activeRequestIdRef to discard any pending responses.
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
    setApiErrorCode(null)
    setDownloadSubmitFeedback(null)
    setIsAnalyzing(false)
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  /**
   * Handles user keystrokes in the URL input.
   * Immediately clears previous validation, analysis, and platform state upon editing.
   * Step 05: Invalidates activeRequestIdRef to discard any pending responses.
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
    setApiErrorCode(null)
    setDownloadSubmitFeedback(null)
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
      setApiErrorCode(null)
      setDownloadSubmitFeedback(null)
      return
    }

    const validation = validateMediaUrlInput(trimmed)
    applyValidationResult(validation)
  }

  /**
   * Handles native paste event (Ctrl+V / right-click paste) on the input field.
   * Step 05: Invalidates activeRequestIdRef to discard any pending responses.
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
      setApiErrorCode(null)
      setDownloadSubmitFeedback(null)
      setIsAnalyzing(false)
      const validation = validateMediaUrlInput(trimmed)
      applyValidationResult(validation)
    }
  }

  /**
   * Reads text from system clipboard using the standard Async Clipboard API.
   * Step 05: Invalidates activeRequestIdRef to discard any pending responses.
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
        setApiErrorCode(null)
        setDownloadSubmitFeedback(null)
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
        setApiErrorCode(null)
        setDownloadSubmitFeedback(null)
        return
      }

      activeRequestIdRef.current++
      setUrl(trimmed)
      setAnalyzedMedia(null)
      setApiError(null)
      setApiErrorCode(null)
      setDownloadSubmitFeedback(null)
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
      setApiErrorCode(null)
      setDownloadSubmitFeedback(null)
    }
  }

  /**
   * Drag & Drop event handlers for the dedicated dropzone.
   * Step 05: Invalidate activeRequestIdRef immediately on drop (valid, invalid URL, or file).
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

    // Step 05: Invalidate in-flight Analyze request and stop analyzing state immediately
    activeRequestIdRef.current++
    setIsAnalyzing(false)
    setAnalyzedMedia(null)
    setApiError(null)
    setApiErrorCode(null)
    setDownloadSubmitFeedback(null)

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
   * Helper function to return user-friendly labels for video qualities.
   */
  const getQualitySubLabel = (qualityString) => {
    const num = parseInt(qualityString, 10)
    if (num >= 2160) return '4K'
    if (num >= 1440) return '2K'
    if (num >= 1080) return 'Full HD'
    if (num >= 720) return 'HD'
    if (num >= 480) return 'SD'
    return 'Available'
  }

  /**
   * Analyze Action (Steps 01 + 02):
   * 1. Validates candidate URL client-side.
   * 2. Checks active cooldown for rate-limited requests.
   * 3. Calls backend Express API POST /api/media/analyze via mediaApi.js / IPC bridge.
   * 4. Renders actual media metadata (thumbnail, title, platform, duration, available formats).
   * 5. Handles structured error codes (429, bot verification, PO token, network errors).
   */
  const handleAnalyzeClick = async () => {
    if (isPreferencesLoading || isAnalyzing || cooldownRemaining > 0) return

    const trimmed = url.trim()
    if (!trimmed) {
      setUrlError('Please enter a media link.')
      setUrlStatus(null)
      setDetectedPlatform(null)
      setValidatedUrl(null)
      setAnalyzedMedia(null)
      setApiError(null)
      setApiErrorCode(null)
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
      setApiErrorCode(null)
      return
    }

    // Apply client validation state
    setValidatedUrl(validation.url)
    setDetectedPlatform(validation.platform)
    setUrlStatus(validation.message)
    setUrlError(null)
    setApiError(null)
    setApiErrorCode(null)

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
        setApiErrorCode(null)
        setDownloadSubmitFeedback(null)

        // Step 03 & 04: Auto-select format & quality based on real stream availability
        const availability = getMediaFormatAvailability(metadata)
        const availableMp4Qualities = availability.mp4Qualities

        if (availability.mp4Available && !availability.mp3Available) {
          setSelectedFormat('mp4')
        } else if (!availability.mp4Available && availability.mp3Available) {
          setSelectedFormat('mp3')
        } else if (availability.mp4Available && availability.mp3Available) {
          setSelectedFormat((prev) => (prev === 'mp3' ? 'mp3' : 'mp4'))
        } else {
          setSelectedFormat(null)
        }

        // Auto-select valid MP4 quality based on saved user preference and available streams
        if (availableMp4Qualities.length > 0) {
          setSelectedVideoQuality(
            resolvePreferredVideoQuality(
              savedPreferencesRef.current.preferredMp4Quality,
              availableMp4Qualities
            )
          )
        }

        // Auto-select valid MP3 bitrate based on saved user preference
        if (availability.mp3Available) {
          setSelectedAudioBitrate(savedPreferencesRef.current.preferredMp3BitrateKbps || 192)
        }
      } else {
        const status = response.status
        const data = response.data || {}
        let errorMsg = 'Failed to analyze media link. Please verify the URL and try again.'
        let errCode = data.code || 'ANALYSIS_FAILED'

        if (status === 429 || data.code === 'YOUTUBE_RATE_LIMITED') {
          errCode = 'YOUTUBE_RATE_LIMITED'
          const waitSec = data.retryAfterSeconds || 60
          setCooldownRemaining(waitSec)
          errorMsg =
            data.message ||
            `YouTube rate limit encountered. Please wait ${waitSec}s before retrying.`
        } else if (data.code === 'YOUTUBE_PO_TOKEN_REQUIRED') {
          errCode = 'YOUTUBE_PO_TOKEN_REQUIRED'
          errorMsg =
            data.message ||
            'YouTube requires additional verification data (PO Token). This video cannot be analyzed directly.'
        } else if (data.code === 'YOUTUBE_AUTH_REQUIRED') {
          errCode = 'YOUTUBE_AUTH_REQUIRED'
          errorMsg =
            data.message ||
            'YouTube requires authentication or bot verification. This video cannot be analyzed directly.'
        } else if (data.code === 'NETWORK_ERROR') {
          errCode = 'NETWORK_ERROR'
          errorMsg =
            data.message ||
            'Unable to connect to the media server. Please check your internet connection.'
        } else if (data.code) {
          errCode = data.code
          errorMsg = data.message || 'Media analysis failed. Please verify the link and try again.'
        } else if (status === 400) {
          errorMsg = data.message || 'Invalid or unsupported media URL.'
        } else if (status === 401 || status === 403) {
          errorMsg = 'API authorization failed. Please restart the application.'
        } else if (status >= 500) {
          errorMsg =
            data.message && data.message !== 'Internal server error'
              ? data.message
              : 'Media analysis failed. Please check your internet connection or verify the video is publicly accessible.'
        } else if (data.message) {
          errorMsg = data.message
        }

        const safeErrorInfo = getSafeFriendlyErrorInfo(
          {
            code: errCode,
            message: errorMsg
          },
          'Media analysis failed. Please verify the link and try again.'
        )

        setApiErrorCode(errCode)
        setApiError(safeErrorInfo.message)
        setAnalyzedMedia(null)
      }
    } catch (err) {
      if (currentRequestId !== activeRequestIdRef.current) {
        return
      }
      setApiErrorCode('NETWORK_ERROR')
      const isIpcError = err?.message?.includes('IPC') || err?.message?.includes('bridge')
      const fallbackMessage = isIpcError
        ? 'Local analyzer service could not be reached via IPC. Please restart the application.'
        : 'An unexpected error occurred while analyzing the media link.'

      const safeErrorInfo = getSafeFriendlyErrorInfo(
        isIpcError ? fallbackMessage : err,
        fallbackMessage
      )

      setApiError(safeErrorInfo.message)
      setAnalyzedMedia(null)
    } finally {
      if (currentRequestId === activeRequestIdRef.current) {
        setIsAnalyzing(false)
      }
    }
  }

  // Load saved download folder on mount (Step 05.08)
  useEffect(() => {
    let isMounted = true

    async function loadSavedFolder() {
      try {
        const folder = await getDownloadFolder()
        if (isMounted && folder) {
          setDownloadFolder(folder)
          setFolderError(null)
        }
      } catch (err) {
        if (isMounted) {
          const safeErrorInfo = getSafeFriendlyErrorInfo(
            err,
            'Unable to retrieve saved download folder.'
          )

          setFolderError(safeErrorInfo.message)
        }
      } finally {
        if (isMounted) {
          setIsLoadingFolder(false)
        }
      }
    }

    loadSavedFolder()

    return () => {
      isMounted = false
    }
  }, [])

  // Load saved download preferences on mount to set initial defaults
  useEffect(() => {
    let isMounted = true

    async function loadSavedPreferences() {
      try {
        const response = await getDownloadSettings()
        if (!isMounted) return

        if (response.ok && response.data?.success && response.data?.data) {
          const { preferredMp4Quality, preferredMp3BitrateKbps } = response.data.data
          const validQuality = preferredMp4Quality || 'best'
          const validBitrate = [128, 192, 320].includes(Number(preferredMp3BitrateKbps))
            ? Number(preferredMp3BitrateKbps)
            : 192

          savedPreferencesRef.current = {
            preferredMp4Quality: validQuality,
            preferredMp3BitrateKbps: validBitrate
          }

          setSelectedVideoQuality(validQuality)
          setSelectedAudioBitrate(validBitrate)
        }
      } catch {
        // Fall back to existing safe defaults ('best' and 192)
      } finally {
        if (isMounted) {
          setIsPreferencesLoading(false)
        }
      }
    }

    loadSavedPreferences()

    return () => {
      isMounted = false
    }
  }, [])

  const handleChooseFolder = async () => {
    setFolderError(null)
    try {
      const selected = await chooseDownloadFolder()
      if (selected) {
        setDownloadFolder(selected)
      }
    } catch (err) {
      const safeErrorInfo = getSafeFriendlyErrorInfo(err, 'Failed to update download folder.')

      setFolderError(safeErrorInfo.message)
    }
  }

  // Fetch recent downloads (Step 05.10)
  const fetchRecentDownloads = useCallback(async () => {
    if (isPollingRecentRef.current) return
    isPollingRecentRef.current = true

    try {
      const response = await listDownloads({ limit: 5 })
      if (response.ok && response.data?.success && Array.isArray(response.data.data)) {
        const normalized = response.data.data
          .map((job) => normalizeDownloadJob(job, speedTrackerRef.current))
          .filter(Boolean)
        hasActiveRecentRef.current = normalized.some(
          (i) =>
            i.status === 'downloading' ||
            i.status === 'queued' ||
            i.status === 'interrupted' ||
            i.displayStatus === 'resuming'
        )
        setRecentDownloads(normalized)
      }
    } catch (err) {
      console.warn('Recent downloads polling error:', err)
    } finally {
      isPollingRecentRef.current = false
      setIsLoadingRecent(false)
    }
  }, [])

  // Controlled live polling for Recent Downloads
  useEffect(() => {
    let isMounted = true
    let timerId = null

    async function poll() {
      await fetchRecentDownloads()
      if (!isMounted) return
      const interval = hasActiveRecentRef.current ? 2000 : 8000
      timerId = setTimeout(poll, interval)
    }

    poll()

    return () => {
      isMounted = false
      if (timerId) clearTimeout(timerId)
    }
  }, [fetchRecentDownloads])

  // Step 04 & Step 05.09: Download Job Creation Handler
  const handleDownloadClick = async () => {
    if (isSubmittingDownload || isAnalyzing) return
    setDownloadSubmitFeedback(null)

    // 1. Validation: Ensure media is analyzed and URL matches
    if (!analyzedMedia || !analyzedMedia.mediaItemId) {
      setDownloadSubmitFeedback({
        type: 'error',
        message: 'Please analyze a valid media link first before downloading.'
      })
      return
    }

    if (analyzedMedia.sourceUrl && analyzedMedia.sourceUrl !== url.trim()) {
      setDownloadSubmitFeedback({
        type: 'error',
        message: 'The entered link does not match the currently analyzed media. Please re-analyze.'
      })
      return
    }

    if (selectedFormat !== 'mp4' && selectedFormat !== 'mp3') {
      setDownloadSubmitFeedback({
        type: 'error',
        message: 'Please select a valid output format (MP4 or MP3).'
      })
      return
    }

    let payload = null

    if (selectedFormat === 'mp4') {
      if (!mp4Available || mp4Qualities.length === 0) {
        setDownloadSubmitFeedback({
          type: 'error',
          message: 'No compatible MP4 video stream is available for this media.'
        })
        return
      }

      let resolvedQuality = selectedVideoQuality
      if (resolvedQuality === 'best' || !mp4Qualities.includes(resolvedQuality)) {
        resolvedQuality = highestAvailableQuality
      }

      if (!resolvedQuality || !mp4Qualities.includes(resolvedQuality)) {
        setDownloadSubmitFeedback({
          type: 'error',
          message: 'Selected video resolution is not available for this media.'
        })
        return
      }

      payload = {
        mediaItemId: analyzedMedia.mediaItemId,
        outputFormat: 'mp4',
        quality: resolvedQuality
      }
    } else if (selectedFormat === 'mp3') {
      if (!mp3Available) {
        setDownloadSubmitFeedback({
          type: 'error',
          message: 'No audio stream is available for MP3 conversion.'
        })
        return
      }

      const bitrate = Number(selectedAudioBitrate)
      if (![128, 192, 320].includes(bitrate)) {
        setDownloadSubmitFeedback({
          type: 'error',
          message: 'Please select a valid audio bitrate (128, 192, or 320 kbps).'
        })
        return
      }

      payload = {
        mediaItemId: analyzedMedia.mediaItemId,
        outputFormat: 'mp3',
        audioBitrateKbps: bitrate
      }
    }

    // 2. Submit job creation to backend
    setIsSubmittingDownload(true)

    try {
      const response = await createDownload(payload)

      if (response.status === 201) {
        const jobId = response.data?.data?.id
        setDownloadSubmitFeedback({
          type: 'success',
          message: jobId
            ? `Download job #${jobId} created and queued successfully!`
            : 'Download queued successfully!'
        })
        await Promise.all([fetchRecentDownloads(), refreshDuplicateStatus()])
      } else if (response.status === 200 && response.data?.duplicate) {
        const safeDuplicateMsg = getSafeFriendlyErrorInfo(
          response.data.message,
          'An equivalent download is already active or in queue.'
        ).message
        setDownloadSubmitFeedback({
          type: 'info',
          message: safeDuplicateMsg
        })
        await Promise.all([fetchRecentDownloads(), refreshDuplicateStatus()])
      } else {
        const safeErrMsg = getSafeFriendlyErrorInfo(
          response.data?.message,
          `Download request failed with status ${response.status}. Please try again.`
        ).message
        setDownloadSubmitFeedback({
          type: 'error',
          message: safeErrMsg
        })
      }
    } catch (err) {
      const isIpc = err?.message?.includes('IPC') || err?.message?.includes('bridge')
      const fallbackMsg = isIpc
        ? 'Communication with download service failed. Please restart the application.'
        : 'An unexpected error occurred while queuing the download.'
      const safeErrorInfo = getSafeFriendlyErrorInfo(isIpc ? fallbackMsg : err, fallbackMsg)
      setDownloadSubmitFeedback({
        type: 'error',
        message: safeErrorInfo.message
      })
    } finally {
      setIsSubmittingDownload(false)
    }
  }

  const handleClearRecent = async () => {
    const terminalItems = recentDownloads.filter((item) =>
      ['completed', 'failed', 'cancelled'].includes(item.status)
    )

    if (terminalItems.length === 0) {
      showToast('No completed or failed downloads to clear', 'info')
      return
    }

    const confirmed = await showConfirm(
      'Clear Recent Downloads?',
      `Permanently remove ${terminalItems.length} completed/failed record(s) from recent history? Media files on disk will not be deleted. Active downloads will remain untouched.`,
      {
        confirmButtonText: 'Clear Recent',
        isDanger: true
      }
    )

    if (!confirmed) return

    try {
      const results = await Promise.allSettled(
        terminalItems.map((item) => deleteDownloadHistory(item.id))
      )
      const deletedCount = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length

      if (deletedCount > 0) {
        showToast(`Cleared ${deletedCount} record(s) from recent history`, 'success')
        await fetchRecentDownloads()
      } else {
        showError('Clear Failed', 'Failed to clear recent downloads from database.')
      }
    } catch (err) {
      const safeErrorInfo = getSafeFriendlyErrorInfo(
        err,
        'An unexpected error occurred while clearing.'
      )
      showError('Clear Error', safeErrorInfo.message)
    }
  }

  const [deletingJobId, setDeletingJobId] = useState(null)

  // Centralized action handlers and loading state via custom hook (Phase 7)
  const {
    pausingJobId,
    resumingJobId,
    cancellingJobId,
    retryingJobId,
    handlePauseJob,
    handleResumeJob,
    handleCancelJob,
    handleRetryJob
  } = useDownloadJobActions({
    onRefresh: fetchRecentDownloads
  })

  const handleOpenFile = async (jobId) => {
    try {
      if (window?.api?.openFile) {
        const res = await window.api.openFile(jobId)
        if (res && res.success === false) {
          showError('Cannot Open File', res.error || 'The downloaded file could not be opened.')
        }
      }
    } catch (err) {
      showError('Open File Error', err.message || 'The downloaded file could not be opened.')
    }
  }

  const handleOpenFolder = async (jobId) => {
    try {
      if (window?.api?.openFolder) {
        const res = await window.api.openFolder(jobId)
        if (res && res.success === false) {
          showError('Cannot Open Folder', res.error || 'The enclosing folder could not be opened.')
        }
      }
    } catch (err) {
      showError('Open Folder Error', err.message || 'The enclosing folder could not be opened.')
    }
  }

  const handleDeleteRecord = async (jobId) => {
    if (deletingJobId !== null) return
    const confirmed = await showConfirm(
      'Delete History Record?',
      'Are you sure you want to delete this download from history? (The downloaded media file will remain on your computer).',
      {
        confirmButtonText: 'Delete Record',
        isDanger: true
      }
    )
    if (!confirmed) return

    try {
      setDeletingJobId(jobId)
      const res = await deleteDownloadHistory(jobId)
      if (res.ok && res.data?.success) {
        showToast('Download record deleted from history', 'success')
        await fetchRecentDownloads()
      } else {
        const errorInfo = getSafeFriendlyErrorInfo(res.data, 'Failed to delete record.')
        showError('Delete Failed', errorInfo.message)
      }
    } catch (err) {
      const errorInfo = getSafeFriendlyErrorInfo(
        err,
        'An unexpected error occurred while deleting record.'
      )
      showError('Delete Error', errorInfo.message)
    } finally {
      setDeletingJobId(null)
    }
  }

  // Derive explicit validation condition
  const isCurrentUrlValidated =
    Boolean(validatedUrl) &&
    validatedUrl === url.trim() &&
    Boolean(detectedPlatform) &&
    !urlError &&
    !apiError

  // Step 03 & 04: Format & Quality availability extraction (using verified MP4 qualities)
  const formatAvailability = getMediaFormatAvailability(analyzedMedia)
  const { mp4Available, mp3Available } = formatAvailability
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const mp4Qualities = useMemo(() => extractMp4Qualities(analyzedMedia), [analyzedMedia])
  const highestAvailableQuality = mp4Qualities.length > 0 ? mp4Qualities[0] : null

  // Visual isolation states between MP4 and MP3 configurations
  const isMp4Active = selectedFormat === 'mp4' && Boolean(analyzedMedia) && mp4Available
  const isMp3Active = selectedFormat === 'mp3' && Boolean(analyzedMedia) && mp3Available

  // Step 02: Duplicate Download Guard hook
  const { isCheckingDuplicate, isDuplicate, duplicateJob, refreshDuplicateStatus } =
    useDownloadDuplicateGuard({
      mediaItemId: analyzedMedia?.mediaItemId,
      selectedFormat,
      selectedVideoQuality,
      selectedAudioBitrate,
      mp4Qualities,
      highestAvailableQuality,
      enabled: Boolean(analyzedMedia && !isAnalyzing)
    })

  // Determine whether showing a Retry button is appropriate (Step 02)
  const isRetryAppropriate =
    apiErrorCode === 'NETWORK_ERROR' ||
    apiErrorCode === 'ANALYSIS_FAILED' ||
    (apiErrorCode === 'YOUTUBE_RATE_LIMITED' && cooldownRemaining === 0)

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
          <div className="p-5 lg:p-6 rounded-2xl bg-surface/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-extrabold text-text tracking-wide">
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
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
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
                  className={`w-full bg-background border rounded-xl py-3 pl-10 pr-20 text-xs font-medium text-text placeholder:text-text-muted/50 focus:outline-none transition-all font-mono select-text ${
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

              {/* Analyze Button with Cooldown Countdown (Step 02) */}
              <button
                type="button"
                onClick={handleAnalyzeClick}
                disabled={
                  isPreferencesLoading || isAnalyzing || !url.trim() || cooldownRemaining > 0
                }
                title={
                  isPreferencesLoading
                    ? 'Loading download preferences...'
                    : cooldownRemaining > 0
                      ? `Rate limit cooldown: ${cooldownRemaining}s remaining`
                      : 'Analyze media URL'
                }
                className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-xs bg-gradient-to-r from-[#19D8FF] to-[#3388FF] text-white shadow-[0_0_16px_rgba(25,216,255,0.35)] hover:shadow-[0_0_24px_rgba(25,216,255,0.55)] transition-all cursor-pointer flex-shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isAnalyzing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : cooldownRemaining > 0 ? (
                  <Clock className="w-3.5 h-3.5" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                <span>
                  {isAnalyzing
                    ? 'Analyzing...'
                    : cooldownRemaining > 0
                      ? `Wait ${cooldownRemaining}s`
                      : 'Analyze'}
                </span>
              </button>
            </div>

            {/* Validation & API Error Feedback with Appropriate Retry Action (Step 02) */}
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
                className="flex items-center justify-between gap-3 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3.5 py-2.5 rounded-xl animate-fadeIn"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{apiError}</span>
                </div>
                {/* Only show Retry when retrying is appropriate */}
                {isRetryAppropriate && (
                  <button
                    type="button"
                    onClick={handleAnalyzeClick}
                    disabled={isPreferencesLoading || isAnalyzing || cooldownRemaining > 0}
                    className="px-3 py-1 rounded-lg text-[11px] font-bold bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 transition-colors cursor-pointer flex-shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    Retry
                  </button>
                )}
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

            {/* Analyzed Media Preview Card */}
            {isAnalyzing ? (
              <div className="flex flex-col items-center justify-center p-8 rounded-xl bg-background/80 border border-primary/20 animate-fadeIn min-h-[140px]">
                <LoadingIndicator
                  type="spinner"
                  label="Connecting to media source and retrieving format details..."
                />
              </div>
            ) : analyzedMedia ? (
              <div className="flex flex-col sm:flex-row items-center gap-4 p-3.5 rounded-xl bg-background/80 border border-primary/15 animate-fadeIn">
                <div className="w-full sm:w-44 flex-shrink-0">
                  <MediaThumbnail
                    src={analyzedMedia.thumbnailUrl}
                    duration={formatMediaDuration(analyzedMedia.durationSeconds)}
                    showPlayOverlay={true}
                    aspectRatio="aspect-video"
                  />
                </div>

                <div className="flex-1 flex flex-col justify-center min-w-0">
                  <h3 className="text-sm font-bold text-text truncate" title={analyzedMedia.title}>
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
              <div className="flex flex-col sm:flex-row items-center gap-4 p-3.5 rounded-xl bg-background/80 border border-primary/15 animate-fadeIn">
                <div className="w-full sm:w-44 aspect-video rounded-lg bg-surface flex flex-col items-center justify-center text-text-muted/60 border border-primary/10 flex-shrink-0">
                  <Video className="w-8 h-8 text-[#19D8FF]/70 mb-1" />
                  <span className="text-[10px] font-mono tracking-wider">READY</span>
                </div>

                <div className="flex-1 flex flex-col justify-center min-w-0">
                  <h3 className="text-sm font-bold text-text truncate">Link Ready for Analysis</h3>
                  <div className="mt-1">
                    <PlatformBadge platform={detectedPlatform?.id || 'web'} />
                  </div>
                  <p className="text-xs text-text-muted/80 mt-1.5 line-clamp-2 leading-relaxed">
                    Supported media link ready. Click Analyze to retrieve live video metadata,
                    thumbnail, duration, and available download streams.
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Section 2: Choose Format (Step 04 - Visual State Isolation) */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                2. Choose Format
              </h2>
              <span className="text-[11px] text-text-muted">
                {analyzedMedia
                  ? mp4Available && mp3Available
                    ? 'MP4 Video & MP3 Audio available'
                    : mp4Available
                      ? 'MP4 Video only'
                      : mp3Available
                        ? 'MP3 Audio only'
                        : 'No format available'
                  : 'Analyze media to view available formats'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              {/* MP4 Video Option */}
              <button
                type="button"
                disabled={!analyzedMedia || !mp4Available}
                onClick={() => mp4Available && setSelectedFormat('mp4')}
                className={`flex items-center justify-between p-4 rounded-2xl border transition-all text-left ${
                  !analyzedMedia || !mp4Available
                    ? 'opacity-40 cursor-not-allowed bg-surface/40 border-primary/10'
                    : selectedFormat === 'mp4'
                      ? 'bg-surface-elevated border-primary shadow-[0_0_20px_rgba(var(--theme-primary-rgb),0.3)] cursor-pointer'
                      : 'bg-surface/80 border-primary/15 hover:border-primary/30 cursor-pointer'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      !analyzedMedia || !mp4Available
                        ? 'bg-surface text-text-muted/50'
                        : selectedFormat === 'mp4'
                          ? 'bg-cyan-500/20 text-[#19D8FF]'
                          : 'bg-surface text-text-muted'
                    }`}
                  >
                    <Video className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-sm font-extrabold text-text block">MP4</span>
                    <span className="text-[11px] text-text-muted">
                      {!analyzedMedia
                        ? 'Video (Best Quality)'
                        : mp4Available
                          ? 'Video (Best Quality)'
                          : 'Not Available'}
                    </span>
                  </div>
                </div>

                {/* Radio Indicator */}
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    !analyzedMedia || !mp4Available
                      ? 'border-text-muted/20'
                      : selectedFormat === 'mp4'
                        ? 'border-[#19D8FF] bg-background'
                        : 'border-text-muted/40'
                  }`}
                >
                  {selectedFormat === 'mp4' && analyzedMedia && mp4Available && (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#19D8FF]" />
                  )}
                </div>
              </button>

              {/* MP3 Audio Option */}
              <button
                type="button"
                disabled={!analyzedMedia || !mp3Available}
                onClick={() => mp3Available && setSelectedFormat('mp3')}
                className={`flex items-center justify-between p-4 rounded-2xl border transition-all text-left ${
                  !analyzedMedia || !mp3Available
                    ? 'opacity-40 cursor-not-allowed bg-surface/40 border-primary/10'
                    : selectedFormat === 'mp3'
                      ? 'bg-surface-elevated border-primary shadow-[0_0_20px_rgba(var(--theme-primary-rgb),0.3)] cursor-pointer'
                      : 'bg-surface/80 border-primary/15 hover:border-primary/30 cursor-pointer'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      !analyzedMedia || !mp3Available
                        ? 'bg-surface text-text-muted/50'
                        : selectedFormat === 'mp3'
                          ? 'bg-cyan-500/20 text-[#19D8FF]'
                          : 'bg-surface text-text-muted'
                    }`}
                  >
                    <Music className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-sm font-extrabold text-text block">MP3</span>
                    <span className="text-[11px] text-text-muted">
                      {!analyzedMedia
                        ? 'Audio Only'
                        : mp3Available
                          ? 'Audio Only'
                          : 'Not Available'}
                    </span>
                  </div>
                </div>

                {/* Radio Indicator */}
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    !analyzedMedia || !mp3Available
                      ? 'border-text-muted/20'
                      : selectedFormat === 'mp3'
                        ? 'border-[#19D8FF] bg-background'
                        : 'border-text-muted/40'
                  }`}
                >
                  {selectedFormat === 'mp3' && analyzedMedia && mp3Available && (
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

          {/* Section 3 & 4: Dynamic Quality & Bitrate (Step 03 & Step 04 - No Fake Buttons) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 3. Video Quality (Step 03: Actual verified MP4 qualities without fake presets) */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                  3. Video Quality
                </h2>
                {isMp4Active && (
                  <span className="text-[10px] text-cyan-400 font-semibold">Active</span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {!analyzedMedia ? (
                  <div className="w-full py-3 px-3 rounded-xl border border-dashed border-primary/15 bg-background/50 text-center text-text-muted/50 text-xs">
                    Paste and analyze a video link to view available MP4 qualities.
                  </div>
                ) : mp4Qualities.length === 0 ? (
                  <div className="w-full py-3 px-3 rounded-xl border border-rose-500/20 bg-rose-500/10 text-center text-rose-400 text-xs">
                    No compatible MP4 video stream is available for this media.
                  </div>
                ) : (
                  [
                    {
                      id: 'best',
                      title: 'Best',
                      sub: highestAvailableQuality
                        ? `${highestAvailableQuality} 👑`
                        : 'Available 👑',
                      size: estimateMp4QualitySize(analyzedMedia, 'best')
                    },
                    ...mp4Qualities.map((q) => ({
                      id: q,
                      title: q,
                      sub: getQualitySubLabel(q),
                      size: estimateMp4QualitySize(analyzedMedia, q)
                    }))
                  ].map((q) => {
                    const isSelected = selectedVideoQuality === q.id

                    return (
                      <button
                        key={q.id}
                        type="button"
                        disabled={!isMp4Active}
                        onClick={() => isMp4Active && setSelectedVideoQuality(q.id)}
                        className={`flex-1 min-w-[76px] py-2 px-2 rounded-xl text-center border transition-all ${
                          !isMp4Active
                            ? 'opacity-35 cursor-not-allowed bg-surface/30 border-primary/10 text-text-muted/40 pointer-events-none'
                            : isSelected
                              ? 'bg-surface-elevated border-primary text-text shadow-[0_0_14px_rgba(var(--theme-primary-rgb),0.3)] cursor-pointer'
                              : 'bg-surface/80 border-primary/15 text-text-muted hover:border-primary/30 hover:text-text cursor-pointer'
                        }`}
                      >
                        <div className="text-xs font-extrabold">{q.title}</div>
                        <div className="text-[10px] text-text-muted/80">{q.sub}</div>
                        {q.size && (
                          <div className="text-[10px] text-cyan-400/90 font-medium mt-0.5">
                            {q.size}
                          </div>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {/* 4. Audio Bitrate (for MP3) - Visually isolated when MP4 is selected (Step 04) */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                  4. Audio Bitrate (for MP3)
                </h2>
                {isMp3Active && (
                  <span className="text-[10px] text-cyan-400 font-semibold">Active</span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {!analyzedMedia ? (
                  <div className="col-span-3 py-3 px-3 rounded-xl border border-dashed border-primary/15 bg-background/50 text-center text-text-muted/50 text-xs">
                    Paste and analyze a media link to choose audio bitrate.
                  </div>
                ) : !mp3Available ? (
                  <div className="col-span-3 py-3 px-3 rounded-xl border border-rose-500/20 bg-rose-500/10 text-center text-rose-400 text-xs">
                    No audio stream is available for MP3 conversion.
                  </div>
                ) : (
                  [
                    { bitrate: 128, label: '128', unit: 'kbps' },
                    { bitrate: 192, label: '192', unit: 'kbps' },
                    { bitrate: 320, label: '320', unit: 'kbps' }
                  ].map((b) => {
                    const isSelected = selectedAudioBitrate === b.bitrate
                    const sizeLabel = estimateMp3BitrateSize(analyzedMedia, b.bitrate)

                    return (
                      <button
                        key={b.bitrate}
                        type="button"
                        disabled={!isMp3Active}
                        onClick={() => isMp3Active && setSelectedAudioBitrate(b.bitrate)}
                        className={`py-2.5 px-2 rounded-xl text-center border transition-all ${
                          !isMp3Active
                            ? 'opacity-35 cursor-not-allowed bg-surface/30 border-primary/10 text-text-muted/40 pointer-events-none'
                            : isSelected
                              ? 'bg-surface-elevated border-primary text-text shadow-[0_0_14px_rgba(var(--theme-primary-rgb),0.3)] cursor-pointer'
                              : 'bg-surface/80 border-primary/15 text-text-muted hover:border-primary/30 hover:text-text cursor-pointer'
                        }`}
                      >
                        <div className="text-xs font-extrabold">{b.label}</div>
                        <div className="text-[10px] text-text-muted/80">{b.unit}</div>
                        {sizeLabel && (
                          <div className="text-[10px] text-cyan-400/90 font-medium mt-0.5">
                            {sizeLabel}
                          </div>
                        )}
                      </button>
                    )
                  })
                )}
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
                <FolderOpen className="absolute left-3.5 w-4 h-4 text-text-muted pointer-events-none" />
                <input
                  type="text"
                  readOnly
                  value={isLoadingFolder ? 'Loading saved folder...' : downloadFolder}
                  placeholder="Select download folder..."
                  className="w-full bg-background border border-primary/20 rounded-xl py-2.5 pl-10 pr-3 text-xs text-text-muted font-mono focus:outline-none focus:border-primary select-text"
                />
              </div>
              <button
                type="button"
                onClick={handleChooseFolder}
                className="px-4 py-2.5 rounded-xl text-xs font-bold bg-surface hover:bg-surface-elevated border border-primary/25 text-text transition-all cursor-pointer flex-shrink-0"
              >
                Choose...
              </button>
            </div>
            {folderError && (
              <div
                role="alert"
                className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3.5 py-2 rounded-xl animate-fadeIn"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{folderError}</span>
              </div>
            )}
          </div>

          {/* Big Download Button */}
          <button
            type="button"
            onClick={handleDownloadClick}
            disabled={
              !analyzedMedia ||
              isAnalyzing ||
              isSubmittingDownload ||
              isCheckingDuplicate ||
              isDuplicate ||
              (selectedFormat === 'mp4' && !mp4Available) ||
              (selectedFormat === 'mp3' && !mp3Available)
            }
            className="w-full py-4 rounded-2xl font-black text-sm lg:text-base tracking-wide bg-gradient-to-r from-[#19D8FF] via-[#3388FF] to-[#514BFF] text-white shadow-[0_0_28px_rgba(25,216,255,0.45)] hover:shadow-[0_0_36px_rgba(25,216,255,0.65)] hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2.5 cursor-pointer mt-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none"
          >
            {isSubmittingDownload ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Queuing Download...</span>
              </>
            ) : isCheckingDuplicate ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Checking Existing Download...</span>
              </>
            ) : isDuplicate && duplicateJob ? (
              <>
                {duplicateJob.status === 'interrupted' ? (
                  <AlertCircle className="w-5 h-5 stroke-[2.5]" />
                ) : duplicateJob.status === 'queued' ? (
                  <Clock className="w-5 h-5 stroke-[2.5]" />
                ) : (
                  <Download className="w-5 h-5 stroke-[2.5]" />
                )}
                <span>
                  {duplicateJob.status === 'downloading'
                    ? `Already Downloading – Job #${duplicateJob.id}`
                    : duplicateJob.status === 'queued'
                      ? `Already Queued – Job #${duplicateJob.id}`
                      : duplicateJob.status === 'interrupted'
                        ? `Interrupted – Waiting for Internet – Job #${duplicateJob.id}`
                        : `Already Active – Job #${duplicateJob.id}`}
                </span>
              </>
            ) : (
              <>
                <Download className="w-5 h-5 stroke-[2.5]" />
                <span>Download</span>
              </>
            )}
          </button>

          {/* Download Submit Feedback Notification */}
          {downloadSubmitFeedback && (
            <div
              role="alert"
              className={`flex items-center gap-2.5 text-xs px-4 py-3 rounded-xl border animate-fadeIn ${
                downloadSubmitFeedback.type === 'success'
                  ? 'text-[#00DEA5] bg-emerald-500/10 border-emerald-500/25'
                  : downloadSubmitFeedback.type === 'info'
                    ? 'text-cyan-300 bg-cyan-500/10 border-cyan-500/25'
                    : 'text-rose-400 bg-rose-500/10 border-rose-500/25'
              }`}
            >
              {downloadSubmitFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-[#00DEA5]" />
              ) : downloadSubmitFeedback.type === 'info' ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-cyan-400" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
              )}
              <span className="font-medium">{downloadSubmitFeedback.message}</span>
            </div>
          )}
        </div>

        {/* ================= RIGHT COLUMN: RECENT DOWNLOADS & DROPZONE (5 COLS) ================= */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Recent Downloads Card */}
          <div className="p-5 rounded-2xl bg-surface/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-primary/10">
              <h2 className="text-sm font-extrabold text-text">Recent Downloads</h2>
              <button
                type="button"
                onClick={handleClearRecent}
                disabled={recentDownloads.length === 0}
                className="flex items-center gap-1 text-[11px] font-semibold text-text-muted hover:text-text transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear All</span>
              </button>
            </div>

            {/* List of items matching Reference Image 1 */}
            <div className="flex flex-col gap-3">
              {recentDownloads.length === 0 ? (
                <div className="py-8 text-center text-text-muted/60 text-xs">
                  {isLoadingRecent
                    ? 'Loading recent downloads...'
                    : 'No recent downloads yet. Paste a link and click Download to start.'}
                </div>
              ) : (
                recentDownloads.map((item) => {
                  const isDownloading = item.status === 'downloading'
                  const isPaused = item.status === 'paused'
                  const isInterrupted = item.status === 'interrupted'
                  const isResuming = item.displayStatus === 'resuming'
                  const isQueued = item.status === 'queued' && !isResuming
                  const isCompleted = item.status === 'completed'
                  const isFailed = item.status === 'failed'
                  const isCancelled = item.status === 'cancelled'
                  const showProgress = isDownloading || isPaused || isInterrupted || isResuming

                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-2.5 rounded-xl bg-background/70 border border-primary/10 hover:border-primary/25 transition-all"
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
                          <span className="text-xs font-bold text-text truncate block">
                            {item.title}
                          </span>
                        </div>

                        <div className="text-[10px] text-text-muted mt-0.5 flex items-center justify-between">
                          <span>
                            {item.format} • {item.quality}
                          </span>
                          {isDownloading && item.speedText && item.speedText !== '—' && (
                            <span className="text-cyan-400 font-semibold">{item.speedText}</span>
                          )}
                          {isInterrupted && (
                            <span className="text-amber-400 font-semibold">0 KB/s</span>
                          )}
                          {isPaused && (
                            <span className="text-purple-400 font-semibold">0 KB/s</span>
                          )}
                        </div>

                        {/* Downloading, Paused, Interrupted & Resuming state: active progress bar */}
                        {showProgress && (
                          <div className="mt-1.5 flex flex-col gap-1">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-text-muted">
                                {item.progressText !== '0 B'
                                  ? item.progressText
                                  : item.fileSize || item.size}
                              </span>
                              <span className="text-white font-bold">{item.progress}%</span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-surface-elevated overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  isPaused
                                    ? 'bg-purple-500/80'
                                    : isInterrupted
                                      ? 'bg-amber-400/80'
                                      : 'bg-gradient-to-r from-[#19D8FF] to-[#3388FF]'
                                }`}
                                style={{ width: `${item.progress}%` }}
                              />
                            </div>
                            {isPaused ? (
                              <div className="text-[10px] text-purple-400 font-medium flex items-center gap-1.5">
                                <Pause className="w-3 h-3" />
                                Paused ({item.progress}%)
                              </div>
                            ) : isInterrupted ? (
                              <div className="text-[10px] text-amber-400 font-medium flex items-center gap-1.5">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                Waiting for connection
                              </div>
                            ) : isResuming ? (
                              <div className="text-[10px] text-cyan-400 font-medium flex items-center gap-1.5">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                                Resuming...
                              </div>
                            ) : item.etaDisplay ? (
                              <div className="text-[10px] text-text-muted/80">
                                Estimated time remaining:{' '}
                                <span className="text-white font-medium">{item.etaDisplay}</span>
                              </div>
                            ) : null}
                          </div>
                        )}

                        {/* Completed state */}
                        {isCompleted && (
                          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#00DEA5] font-semibold">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>{item.statusText || 'Completed'}</span>
                          </div>
                        )}

                        {/* Queued state */}
                        {isQueued && (
                          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-blue-400 font-semibold">
                            <Clock className="w-3 h-3" />
                            <span>Queued</span>
                          </div>
                        )}

                        {/* Cancelled state */}
                        {isCancelled && (
                          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-400 font-semibold truncate">
                            <AlertCircle className="w-3 h-3 flex-shrink-0" />
                            <span>Cancelled</span>
                          </div>
                        )}

                        {/* Failed state */}
                        {isFailed && (
                          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-rose-400 font-semibold truncate">
                            <AlertCircle className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{item.errorMessage || 'Failed'}</span>
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* Downloading: Pause + Cancel */}
                        {isDownloading && (
                          <>
                            <button
                              type="button"
                              onClick={() => handlePauseJob(item.id)}
                              disabled={pausingJobId === item.id || cancellingJobId === item.id}
                              className="w-8 h-8 rounded-lg bg-background/80 hover:bg-surface-elevated border border-primary/20 hover:border-primary/40 text-text-muted hover:text-text flex items-center justify-center transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Pause download"
                            >
                              {pausingJobId === item.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#19D8FF]" />
                              ) : (
                                <Pause className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCancelJob(item.id)}
                              disabled={cancellingJobId === item.id || pausingJobId === item.id}
                              className="w-8 h-8 rounded-lg bg-background/80 hover:bg-red-500/20 border border-primary/20 hover:border-red-500/40 text-text-muted hover:text-red-400 flex items-center justify-center transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Cancel download"
                            >
                              {cancellingJobId === item.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                              ) : (
                                <Square className="w-3 h-3 fill-current" />
                              )}
                            </button>
                          </>
                        )}

                        {/* Paused: Resume + Cancel */}
                        {isPaused && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleResumeJob(item.id)}
                              disabled={resumingJobId === item.id || cancellingJobId === item.id}
                              className="w-8 h-8 rounded-lg bg-background/80 hover:bg-surface-elevated border border-primary/20 hover:border-primary/40 text-text-muted hover:text-text flex items-center justify-center transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Resume download"
                            >
                              {resumingJobId === item.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#19D8FF]" />
                              ) : (
                                <Play className="w-3.5 h-3.5 ml-0.5 text-[#19D8FF]" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCancelJob(item.id)}
                              disabled={cancellingJobId === item.id || resumingJobId === item.id}
                              className="w-8 h-8 rounded-lg bg-background/80 hover:bg-red-500/20 border border-primary/20 hover:border-red-500/40 text-text-muted hover:text-red-400 flex items-center justify-center transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Cancel download"
                            >
                              {cancellingJobId === item.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                              ) : (
                                <Square className="w-3 h-3 fill-current" />
                              )}
                            </button>
                          </>
                        )}

                        {/* Interrupted: Manual Pause + Cancel */}
                        {isInterrupted && (
                          <>
                            <button
                              type="button"
                              onClick={() => handlePauseJob(item.id)}
                              disabled={pausingJobId === item.id || cancellingJobId === item.id}
                              className="w-8 h-8 rounded-lg bg-background/80 hover:bg-surface-elevated border border-primary/20 hover:border-primary/40 text-text-muted hover:text-text flex items-center justify-center transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Pause download (prevent auto-resume)"
                            >
                              {pausingJobId === item.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#19D8FF]" />
                              ) : (
                                <Pause className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCancelJob(item.id)}
                              disabled={cancellingJobId === item.id || pausingJobId === item.id}
                              className="w-8 h-8 rounded-lg bg-background/80 hover:bg-red-500/20 border border-primary/20 hover:border-red-500/40 text-text-muted hover:text-red-400 flex items-center justify-center transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Cancel download"
                            >
                              {cancellingJobId === item.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                              ) : (
                                <Square className="w-3 h-3 fill-current" />
                              )}
                            </button>
                          </>
                        )}

                        {/* Queued: Cancel only */}
                        {isQueued && (
                          <button
                            type="button"
                            onClick={() => handleCancelJob(item.id)}
                            disabled={cancellingJobId === item.id}
                            className="w-8 h-8 rounded-lg bg-background/80 hover:bg-red-500/20 border border-primary/20 hover:border-red-500/40 text-text-muted hover:text-red-400 flex items-center justify-center transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Cancel queued download"
                          >
                            {cancellingJobId === item.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                            ) : (
                              <Square className="w-3 h-3 fill-current" />
                            )}
                          </button>
                        )}

                        {/* Completed: Play + Folder + Delete */}
                        {isCompleted && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleOpenFile(item.id)}
                              className="w-8 h-8 rounded-lg bg-background/80 hover:bg-surface-elevated border border-primary/20 hover:border-primary/40 text-text-muted hover:text-[#00DEA5] flex items-center justify-center transition-all cursor-pointer shadow-sm"
                              title="Play / Open file"
                            >
                              <Play className="w-3.5 h-3.5 ml-0.5 fill-current" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenFolder(item.id)}
                              className="w-8 h-8 rounded-lg bg-background/80 hover:bg-surface-elevated border border-primary/20 hover:border-primary/40 text-text-muted hover:text-text flex items-center justify-center transition-all cursor-pointer shadow-sm"
                              title="Open containing folder"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRecord(item.id)}
                              disabled={deletingJobId === item.id}
                              className="w-8 h-8 rounded-lg bg-background/80 hover:bg-red-500/20 border border-primary/20 hover:border-red-500/40 text-text-muted hover:text-red-400 flex items-center justify-center transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Delete from history (keeps file on disk)"
                            >
                              {deletingJobId === item.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </>
                        )}

                        {/* Failed or Cancelled: Retry */}
                        {(isFailed || isCancelled) && (
                          <button
                            type="button"
                            onClick={() => handleRetryJob(item.id)}
                            disabled={retryingJobId === item.id}
                            className="px-2.5 py-1 rounded-lg bg-background/80 hover:bg-surface-elevated border border-primary/20 hover:border-primary/40 text-text-muted hover:text-text flex items-center gap-1.5 transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Retry download"
                          >
                            <RotateCcw
                              className={`w-3.5 h-3.5 text-[#19D8FF] ${retryingJobId === item.id ? 'animate-spin' : ''}`}
                            />
                            <span className="text-[11px] font-bold">Retry</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
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
                : 'border-primary/30 bg-surface/50 hover:border-primary/60 hover:bg-surface/70'
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
