import { useEffect, useState, useCallback } from 'react'
import { checkDownloadDuplicate } from '../services/downloadsApi'

/**
 * Testable request-coordination helper used by useDownloadDuplicateGuard.
 * Encapsulates request generation sequencing, stale response rejection,
 * selection key diffing, unmount invalidation, and deadlock-free loading state transitions.
 */
export class DuplicateGuardCoordinator {
  constructor({ onStateChange, onCheckingChange, checkApiFn = checkDownloadDuplicate } = {}) {
    this.onStateChange = onStateChange || (() => {})
    this.onCheckingChange = onCheckingChange || (() => {})
    this.checkApiFn = checkApiFn

    this.requestGeneration = 0
    this.isMounted = true
    this.lastSelectionKey = null
    this.state = {
      isCheckingDuplicate: false,
      isDuplicate: false,
      duplicateJob: null
    }
  }

  getState() {
    return { ...this.state }
  }

  mount() {
    this.isMounted = true
  }

  unmount() {
    this.isMounted = false
    this.requestGeneration++
  }

  resolveQuality(format, quality, mp4Qualities, highestQuality) {
    if (format !== 'mp4') return null
    if (quality === 'best' || !mp4Qualities.includes(quality)) {
      return highestQuality
    }
    return quality
  }

  async executeCheck(params = {}, options = {}) {
    const isBackground = options?.isBackground === true

    const {
      enabled = true,
      mediaItemId,
      selectedFormat,
      selectedVideoQuality,
      selectedAudioBitrate,
      mp4Qualities = [],
      highestAvailableQuality = null
    } = params

    const resolvedQuality = this.resolveQuality(
      selectedFormat,
      selectedVideoQuality,
      mp4Qualities,
      highestAvailableQuality
    )
    const resolvedBitrate = selectedFormat === 'mp3' ? Number(selectedAudioBitrate) || 192 : null

    // 1. Early-return: If disabled or invalid, invalidate in-flight requests and reset state
    if (
      !enabled ||
      !Number.isInteger(mediaItemId) ||
      mediaItemId <= 0 ||
      (selectedFormat !== 'mp4' && selectedFormat !== 'mp3')
    ) {
      this.requestGeneration++
      this.lastSelectionKey = null
      this._updateState({ isDuplicate: false, duplicateJob: null })
      this._updateChecking(false)
      return
    }

    if (selectedFormat === 'mp4' && (!resolvedQuality || typeof resolvedQuality !== 'string')) {
      this.requestGeneration++
      this.lastSelectionKey = null
      this._updateState({ isDuplicate: false, duplicateJob: null })
      this._updateChecking(false)
      return
    }

    if (selectedFormat === 'mp3' && ![128, 192, 320].includes(resolvedBitrate)) {
      this.requestGeneration++
      this.lastSelectionKey = null
      this._updateState({ isDuplicate: false, duplicateJob: null })
      this._updateChecking(false)
      return
    }

    // 2. Selection key diffing: check if selection changed
    const selectionKey = `${mediaItemId}:${selectedFormat}:${selectedFormat === 'mp4' ? resolvedQuality : resolvedBitrate}`
    const isNewSelection = this.lastSelectionKey !== selectionKey
    this.lastSelectionKey = selectionKey

    // When selection changes, invalidate prior in-flight requests and clear old duplicate info
    if (isNewSelection) {
      this.requestGeneration++
      this._updateState({ isDuplicate: false, duplicateJob: null })
    }

    const requestId = ++this.requestGeneration

    // Only show checking spinner for foreground checks
    if (!isBackground) {
      this._updateChecking(true)
    }

    try {
      const payload = {
        mediaItemId,
        outputFormat: selectedFormat,
        ...(selectedFormat === 'mp4' ? { quality: resolvedQuality } : {}),
        ...(selectedFormat === 'mp3' ? { audioBitrateKbps: resolvedBitrate } : {})
      }

      const response = await this.checkApiFn(payload)

      // Reject stale generations or unmounted responses
      if (requestId !== this.requestGeneration || !this.isMounted) {
        return
      }

      const isDuplicateDetected = Boolean(
        response?.ok && response?.data?.duplicate === true && response?.data?.data
      )

      if (isDuplicateDetected) {
        this._updateState({ isDuplicate: true, duplicateJob: response.data.data })
      } else {
        this._updateState({ isDuplicate: false, duplicateJob: null })
      }
    } catch (err) {
      if (requestId !== this.requestGeneration || !this.isMounted) {
        return
      }
      console.warn('[duplicate-guard] Duplicate check error:', err?.message)
    } finally {
      // The latest settled generation always releases checking state
      if (requestId === this.requestGeneration && this.isMounted) {
        this._updateChecking(false)
      }
    }
  }

  _updateState({ isDuplicate, duplicateJob }) {
    this.state.isDuplicate = isDuplicate
    this.state.duplicateJob = duplicateJob
    if (this.isMounted) {
      this.onStateChange({ isDuplicate, duplicateJob })
    }
  }

  _updateChecking(isChecking) {
    this.state.isCheckingDuplicate = isChecking
    if (this.isMounted) {
      this.onCheckingChange(isChecking)
    }
  }
}

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
 *    request-generation sequence counter (DuplicateGuardCoordinator).
 * 4. Stale State Invalidation: Selection changes (URL, quality, bitrate, format) and early returns
 *    immediately invalidate outstanding requests and clear previous duplicate state so prior
 *    selections never block new selections.
 * 5. Deadlock-Free Loading State: The latest valid request generation always releases
 *    isCheckingDuplicate upon settling, ensuring background requests cannot leave the foreground
 *    loading spinner permanently stuck.
 * 6. Controlled Polling: When a duplicate is active, polls every 2.5 seconds WITHOUT setting
 *    loading spinners or causing button flicker. Immediately clears duplicate state and
 *    re-enables the button when the job reaches terminal state ('completed', 'failed', 'cancelled').
 * 7. Event-Driven Reactivity: Automatically re-checks when 'applan2:download-state-changed' fires.
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

  const [coordinator] = useState(
    () =>
      new DuplicateGuardCoordinator({
        onStateChange: ({ isDuplicate: d, duplicateJob: j }) => {
          setIsDuplicate(d)
          setDuplicateJob(j)
        },
        onCheckingChange: (checking) => {
          setIsCheckingDuplicate(checking)
        }
      })
  )

  // Track mount state and invalidate in-flight responses on unmount
  useEffect(() => {
    coordinator.mount()
    return () => {
      coordinator.unmount()
    }
  }, [coordinator])

  const params = {
    mediaItemId,
    selectedFormat,
    selectedVideoQuality,
    selectedAudioBitrate,
    mp4Qualities,
    highestAvailableQuality,
    enabled
  }

  const executeCheck = useCallback(
    (options = {}) => {
      return coordinator.executeCheck(params, options)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      coordinator,
      enabled,
      mediaItemId,
      selectedFormat,
      selectedVideoQuality,
      selectedAudioBitrate,
      mp4Qualities,
      highestAvailableQuality
    ]
  )

  /**
   * Trigger duplicate check whenever selection changes (mediaItemId, format, quality, bitrate).
   */
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled && coordinator.isMounted) {
        executeCheck({ isBackground: false })
      }
    })
    return () => {
      cancelled = true
    }
  }, [executeCheck, coordinator])

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
      if (coordinator.isMounted) {
        executeCheck({ isBackground: true })
      }
    }, 2500)

    return () => {
      clearInterval(intervalId)
    }
  }, [isDuplicate, duplicateJob, executeCheck, coordinator])

  return {
    isCheckingDuplicate,
    isDuplicate,
    duplicateJob,
    refreshDuplicateStatus: executeCheck
  }
}
