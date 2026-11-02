import { useEffect, useRef, useState, useCallback } from 'react'
import { checkDownloadDuplicate } from '../services/downloadsApi'

/**
 * Custom React Hook: useDownloadDuplicateGuard
 *
 * Provides real-time, authoritative duplicate download detection for the Link Downloader UI.
 * Verifies whether the currently selected media configuration (Canonical Media + Format + Quality/Bitrate)
 * already has an active job in SQLite ('queued', 'downloading', or 'interrupted').
 *
 * Key Architectural Guarantees:
 * 1. Authority: Communicates directly with backend POST /api/downloads/check-duplicate;
 *    never relies on the 5-item recent downloads list.
 * 2. 'Best' Resolution: Automatically maps selectedVideoQuality === 'best' to the highest verified
 *    resolution (e.g. '1080p') to match backend canonical request identity.
 * 3. Race & Stale Protection: Outdated asynchronous responses are discarded using an internal
 *    request-generation sequence counter (requestGenerationRef).
 * 4. Controlled Polling: When a duplicate is active, polls every 2.5 seconds WITHOUT setting
 *    loading spinners or causing button flicker. Immediately clears duplicate state and
 *    re-enables the button when the job reaches terminal state ('completed', 'failed', 'cancelled').
 * 5. Event-Driven Reactivity: Automatically re-checks when 'applan2:download-state-changed' fires.
 *
 * @param {object} params
 * @param {number|null} params.mediaItemId - SQLite MediaItem ID
 * @param {'mp4'|'mp3'} params.selectedFormat - Desired format
 * @param {string} params.selectedVideoQuality - Video quality ('best' or specific resolution like '1080p')
 * @param {number|string} params.selectedAudioBitrate - Selected MP3 bitrate (128, 192, 320)
 * @param {Array<string>} [params.mp4Qualities=[]] - Available verified MP4 qualities
 * @param {string|null} [params.highestAvailableQuality=null] - Highest resolution available for media
 * @param {boolean} [params.enabled=true] - Guard enable condition
 * @returns {{
 *   isCheckingDuplicate: boolean,
 *   isDuplicate: boolean,
 *   duplicateJob: object|null,
 *   refreshDuplicateStatus: (options?: { isBackground?: boolean }) => Promise<void>
 * }}
 */
export function useDownloadDuplicateGuard({
  mediaItemId,
  selectedFormat,
  selectedVideoQuality,
  selectedAudioBitrate,
  mp4Qualities = [],
  highestAvailableQuality = null,
  enabled = true
} = {}) {
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false)
  const [isDuplicate, setIsDuplicate] = useState(false)
  const [duplicateJob, setDuplicateJob] = useState(null)

  const requestGenerationRef = useRef(0)
  const isMountedRef = useRef(true)

  // Track mount state
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Resolve video quality: Map 'best' to highest available quality
  let resolvedQuality = null
  if (selectedFormat === 'mp4') {
    resolvedQuality = selectedVideoQuality
    if (resolvedQuality === 'best' || !mp4Qualities.includes(resolvedQuality)) {
      resolvedQuality = highestAvailableQuality
    }
  }

  const resolvedBitrate = selectedFormat === 'mp3' ? Number(selectedAudioBitrate) || 192 : null

  /**
   * Performs the duplicate check against the backend endpoint.
   */
  const executeCheck = useCallback(
    async (options = {}) => {
      const isBackground = options?.isBackground === true

      // If disabled or missing required identifiers, reset and exit
      if (
        !enabled ||
        !Number.isInteger(mediaItemId) ||
        mediaItemId <= 0 ||
        (selectedFormat !== 'mp4' && selectedFormat !== 'mp3')
      ) {
        setIsDuplicate(false)
        setDuplicateJob(null)
        setIsCheckingDuplicate(false)
        return
      }

      // Ensure valid format settings exist before querying
      if (selectedFormat === 'mp4' && (!resolvedQuality || typeof resolvedQuality !== 'string')) {
        setIsDuplicate(false)
        setDuplicateJob(null)
        setIsCheckingDuplicate(false)
        return
      }

      if (selectedFormat === 'mp3' && ![128, 192, 320].includes(resolvedBitrate)) {
        setIsDuplicate(false)
        setDuplicateJob(null)
        setIsCheckingDuplicate(false)
        return
      }

      const requestId = ++requestGenerationRef.current

      // Only show the initial check spinner when not polling in the background
      if (!isBackground) {
        setIsCheckingDuplicate(true)
      }

      try {
        const payload = {
          mediaItemId,
          outputFormat: selectedFormat,
          ...(selectedFormat === 'mp4' ? { quality: resolvedQuality } : {}),
          ...(selectedFormat === 'mp3' ? { audioBitrateKbps: resolvedBitrate } : {})
        }

        const response = await checkDownloadDuplicate(payload)

        // Ignore stale responses from earlier requests or unmounted components
        if (requestId !== requestGenerationRef.current || !isMountedRef.current) {
          return
        }

        if (
          response.ok &&
          response.data?.success &&
          response.data?.duplicate &&
          response.data?.data
        ) {
          setIsDuplicate(true)
          setDuplicateJob(response.data.data)
        } else {
          setIsDuplicate(false)
          setDuplicateJob(null)
        }
      } catch (err) {
        if (requestId !== requestGenerationRef.current || !isMountedRef.current) {
          return
        }
        // In case of communication error, avoid blocking user action
        console.warn('[duplicate-guard] Duplicate check error:', err?.message)
      } finally {
        if (requestId === requestGenerationRef.current && isMountedRef.current) {
          if (!isBackground) {
            setIsCheckingDuplicate(false)
          }
        }
      }
    },
    [
      enabled,
      mediaItemId,
      selectedFormat,
      resolvedQuality,
      resolvedBitrate,
      setIsCheckingDuplicate,
      setIsDuplicate,
      setDuplicateJob
    ]
  )

  /**
   * Trigger duplicate check whenever selection changes (mediaItemId, format, quality, bitrate).
   */
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled && isMountedRef.current) {
        executeCheck({ isBackground: false })
      }
    })
    return () => {
      cancelled = true
    }
  }, [executeCheck])

  /**
   * Listen to application-wide download state changes to refresh immediately.
   */
  useEffect(() => {
    const handleStateChange = () => {
      executeCheck({ isBackground: true })
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('applan2:download-state-changed', handleStateChange)
      return () => {
        window.removeEventListener('applan2:download-state-changed', handleStateChange)
      }
    }
  }, [executeCheck])

  /**
   * Controlled periodic background polling:
   * Polls every 2.5 seconds ONLY when a duplicate is currently detected.
   * Immediately clears when terminal state is reached.
   */
  useEffect(() => {
    if (!isDuplicate || !duplicateJob) return

    const intervalId = setInterval(() => {
      if (isMountedRef.current) {
        executeCheck({ isBackground: true })
      }
    }, 2500)

    return () => {
      clearInterval(intervalId)
    }
  }, [isDuplicate, duplicateJob, executeCheck])

  return {
    isCheckingDuplicate,
    isDuplicate,
    duplicateJob,
    refreshDuplicateStatus: executeCheck
  }
}
