import { useState, useEffect, useRef, useCallback } from 'react'
import { listDownloads, notifyDownloadStateChanged } from '../services/downloadsApi'
import { normalizeDownloadJob } from '../utils/downloadPresentation'

/**
 * Custom hook to coordinate Downloads Manager initial fetch and live polling lifecycle.
 *
 * Requirements fulfilled (Step 07):
 * 1. Immediate initial fetch on mount.
 * 2. Proper loading state (isLoading starts true, becomes false on first response).
 * 3. Does not display empty-download state before initial fetch completes.
 * 4. StrictMode resilient: per-mount lifecycle tracking prevents second effect hanging.
 * 5. Discards outdated responses if component unmounted.
 * 6. Prevents overlapping polling requests and duplicate timers.
 * 7. Preserves existing download records if a background poll temporarily errors.
 * 8. Adaptive polling: 2s when active jobs exist, 8s when idle.
 * 9. Emits 'applan2:download-state-changed' so sidebar count stays synchronized.
 */
export function useDownloadsManager({ limit = 50 } = {}) {
  const [downloadsList, setDownloadsList] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [initialFetchDone, setInitialFetchDone] = useState(false)

  const speedTrackerRef = useRef(new Map())
  const hasActiveRef = useRef(false)
  const isFetchingRef = useRef(false)

  const fetchJobs = useCallback(
    async (isMountedCheck) => {
      if (isFetchingRef.current) return
      isFetchingRef.current = true

      try {
        const response = await listDownloads({ limit })
        if (!isMountedCheck()) return

        if (response.ok && response.data?.success && Array.isArray(response.data.data)) {
          const normalized = response.data.data
            .map((job) => normalizeDownloadJob(job, speedTrackerRef.current))
            .filter(Boolean)

          const hasActive = normalized.some(
            (item) => item.status === 'downloading' || item.status === 'queued'
          )
          hasActiveRef.current = hasActive

          setDownloadsList(normalized)
          notifyDownloadStateChanged()
        }
      } catch (err) {
        console.warn('[downloads] Polling fetch warning:', err)
        // Existing download records are preserved on transient polling errors
      } finally {
        isFetchingRef.current = false
        if (isMountedCheck()) {
          setIsLoading(false)
          setInitialFetchDone(true)
        }
      }
    },
    [limit]
  )

  useEffect(() => {
    let isMounted = true
    let timerId = null

    const isMountedCheck = () => isMounted

    // Reset any stuck in-flight flag on fresh effect mount (StrictMode protection)
    isFetchingRef.current = false

    async function pollLoop() {
      await fetchJobs(isMountedCheck)
      if (!isMounted) return

      const interval = hasActiveRef.current ? 2000 : 8000
      timerId = setTimeout(() => {
        if (isMounted) {
          pollLoop()
        }
      }, interval)
    }

    const onStateChanged = () => {
      if (isMounted) {
        fetchJobs(isMountedCheck)
      }
    }

    window.addEventListener('applan2:download-state-changed', onStateChanged)

    // Trigger initial fetch immediately without delay
    pollLoop()

    return () => {
      isMounted = false
      if (timerId) clearTimeout(timerId)
      window.removeEventListener('applan2:download-state-changed', onStateChanged)
    }
  }, [fetchJobs])

  return {
    downloadsList,
    setDownloadsList,
    isLoading,
    initialFetchDone,
    speedTrackerRef
  }
}
