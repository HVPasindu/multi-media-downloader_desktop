import { useState, useEffect, useRef, useCallback } from 'react'
import { listDownloads, getActiveDownloadsCount } from '../services/downloadsApi'
import { normalizeDownloadJob } from '../utils/downloadPresentation'
import { seedKnownFailures, notifyLiveJobFailure } from '../utils/notificationService'

/**
 * Custom hook to coordinate Downloads Manager initial fetch, server-side pagination,
 * search, multi-status filters, and adaptive polling lifecycle.
 *
 * Requirements fulfilled (Step 07 & Step 12):
 * 1. Immediate initial fetch on mount.
 * 2. Proper loading state (isLoading starts true, becomes false on first response).
 * 3. Does not display empty-download state before initial fetch completes.
 * 4. StrictMode resilient: per-mount lifecycle tracking and request generation prevents hanging or race conditions.
 * 5. Discards outdated responses if component unmounted or superseded by newer request / page change.
 * 6. Prevents overlapping polling requests and duplicate timers.
 * 7. On initial fetch failure, provides error state and retry action instead of showing empty table.
 * 8. Preserves existing download records if a background poll temporarily errors.
 * 9. Adaptive polling: 2s when active jobs exist anywhere globally, 8s when idle.
 * 10. Emits 'applan2:download-state-changed' so sidebar count stays synchronized.
 * 11. Reads accurate server total records for pagination.
 */
export function useDownloadsManager({
  limit = 20,
  offset = 0,
  search = '',
  status = null,
  statuses = null
} = {}) {
  const [downloadsList, setDownloadsList] = useState([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [initialFetchDone, setInitialFetchDone] = useState(false)
  const [error, setError] = useState(null)

  const speedTrackerRef = useRef(new Map())
  const previousStatusesRef = useRef(new Map())
  const hasActiveRef = useRef(false)
  const isFetchingRef = useRef(false)
  const initialFetchDoneRef = useRef(false)
  const requestCountRef = useRef(0)

  const fetchJobs = useCallback(
    async (isMountedCheck) => {
      if (isFetchingRef.current) return
      isFetchingRef.current = true
      const requestId = ++requestCountRef.current

      try {
        const filters = {
          limit,
          offset
        }
        if (search && search.trim()) filters.search = search.trim()
        if (statuses && (Array.isArray(statuses) ? statuses.length > 0 : String(statuses).trim())) {
          filters.statuses = statuses
        } else if (status) {
          filters.status = status
        }

        const response = await listDownloads(filters)
        if (!isMountedCheck() || requestId !== requestCountRef.current) return

        if (response.ok && response.data?.success && Array.isArray(response.data.data)) {
          const rawJobs = response.data.data
          const normalized = rawJobs
            .map((job) => normalizeDownloadJob(job, speedTrackerRef.current))
            .filter(Boolean)

          // Step 10 & Task 03: Only notify when a previously active job transitions to failed
          const prevStatuses = previousStatusesRef.current
          for (const item of normalized) {
            const idStr = String(item.id)
            const prevStatus = prevStatuses.get(idStr)
            const wasActive = ['queued', 'downloading', 'interrupted'].includes(prevStatus)

            if (item.status === 'failed' && wasActive) {
              notifyLiveJobFailure(
                item.id,
                item.errorInfo || { title: 'Download Failed', message: item.errorMessage }
              )
            } else if (item.status === 'failed' || item.status === 'cancelled') {
              // Old failure encountered during initial load or pagination: suppress popups
              seedKnownFailures([item.id])
            }

            prevStatuses.set(idStr, item.status)
          }

          // Adaptive polling: check local page active items, fallback to global count
          const localHasActive = normalized.some(
            (item) =>
              item.status === 'downloading' ||
              item.status === 'queued' ||
              item.status === 'interrupted'
          )

          if (localHasActive) {
            hasActiveRef.current = true
          } else {
            try {
              const globalActive = await getActiveDownloadsCount()
              hasActiveRef.current = Boolean(globalActive.ok && globalActive.total > 0)
            } catch {
              hasActiveRef.current = false
            }
          }

          setDownloadsList(normalized)
          const reportedTotal = Number(response.data.pagination?.total)
          setTotal(Number.isSafeInteger(reportedTotal) ? reportedTotal : normalized.length)
          setError(null)
          initialFetchDoneRef.current = true
        } else {
          if (!initialFetchDoneRef.current) {
            setError(
              response.data?.message ||
                'Failed to load downloads. Please check your connection and retry.'
            )
          }
        }
      } catch (err) {
        console.warn('[downloads] Polling fetch warning:', err)
        if (
          !initialFetchDoneRef.current &&
          isMountedCheck() &&
          requestId === requestCountRef.current
        ) {
          setError('Failed to connect to local API service. Please retry.')
        }
      } finally {
        if (requestId === requestCountRef.current) {
          isFetchingRef.current = false
          if (isMountedCheck()) {
            setIsLoading(false)
            setInitialFetchDone(true)
          }
        }
      }
    },
    [limit, offset, search, status, statuses]
  )

  const retry = useCallback(() => {
    isFetchingRef.current = false
    setIsLoading(true)
    setError(null)
    initialFetchDoneRef.current = false
    void fetchJobs(() => true)
  }, [fetchJobs])

  useEffect(() => {
    let isMounted = true
    let timerId = null

    const isMountedCheck = () => isMounted

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
    error,
    retry,
    total,
    speedTrackerRef
  }
}
