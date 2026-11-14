import { useState, useEffect } from 'react'
import { getActiveDownloadsCount } from '../services/downloadsApi'

/**
 * Custom React hook to retrieve and adaptively poll the real active downloads count
 * (downloading + queued jobs) directly from SQLite via the backend API.
 *
 * StrictMode resilient:
 * - Uses active mount tokens to prevent race conditions.
 * - Schedules next polling tick only after previous request completes.
 * - Listens for 'applan2:download-state-changed' events for instantaneous updates.
 *
 * @returns {number} Active download count (0 if none or upon error)
 */
export function useActiveDownloadsCount() {
  const [activeCount, setActiveCount] = useState(0)

  useEffect(() => {
    let isMounted = true
    let timerId = null

    async function updateCount() {
      const result = await getActiveDownloadsCount()
      if (!isMounted) return null

      if (result.ok && Number.isFinite(result.total)) {
        setActiveCount(result.total)
      }
      return result
    }

    // Dynamic adaptive interval: 2s when active jobs exist, 8s when idle
    async function runCycle() {
      const res = await updateCount()
      if (!isMounted) return

      const interval = res && res.total > 0 ? 2000 : 8000
      timerId = setTimeout(() => {
        if (isMounted) {
          runCycle()
        }
      }, interval)
    }

    // Instant event handler for immediate update when user creates, cancels, or completes a download
    const onStateChanged = () => {
      if (isMounted) {
        updateCount()
      }
    }

    window.addEventListener('applan2:download-state-changed', onStateChanged)

    // Trigger initial fetch immediately on mount
    runCycle()

    return () => {
      isMounted = false
      if (timerId) clearTimeout(timerId)
      window.removeEventListener('applan2:download-state-changed', onStateChanged)
    }
  }, [])

  return activeCount
}

export default useActiveDownloadsCount
