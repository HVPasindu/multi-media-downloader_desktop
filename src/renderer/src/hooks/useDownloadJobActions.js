import { useState, useRef, useCallback } from 'react'
import {
  pauseDownload,
  resumeDownload,
  cancelDownload,
  retryDownload,
  waitForJobStatus
} from '../services/downloadsApi'
import { showError, showToast, showConfirm } from '../utils/notificationService'
import { getSafeFriendlyErrorInfo } from '../utils/errorPresentation'

/**
 * Custom hook to encapsulate and synchronize all download job action handlers:
 * Pause, Resume, Cancel, and Retry.
 *
 * Enforces in-flight deduplication to prevent double-clicks, coordinates
 * UI notification toasts/modals, and synchronizes data refresh.
 */
export function useDownloadJobActions({ onRefresh, fetchGlobalCounts } = {}) {
  const [pausingJobId, setPausingJobId] = useState(null)
  const [resumingJobId, setResumingJobId] = useState(null)
  const [cancellingJobId, setCancellingJobId] = useState(null)
  const [retryingJobId, setRetryingJobId] = useState(null)

  // In-flight tracking to prevent double clicking and race conditions
  const inFlightJobsRef = useRef(new Set())

  const triggerRefresh = useCallback(() => {
    if (typeof onRefresh === 'function') {
      try {
        onRefresh()
      } catch (err) {
        console.error('[useDownloadJobActions] onRefresh error:', err)
      }
    }
    if (typeof fetchGlobalCounts === 'function') {
      try {
        fetchGlobalCounts()
      } catch (err) {
        console.error('[useDownloadJobActions] fetchGlobalCounts error:', err)
      }
    }
  }, [onRefresh, fetchGlobalCounts])

  const handlePauseJob = useCallback(
    async (jobId) => {
      const key = String(jobId)
      if (!jobId || inFlightJobsRef.current.has(key)) return
      if (cancellingJobId === jobId || pausingJobId === jobId) return

      inFlightJobsRef.current.add(key)
      setPausingJobId(jobId)

      try {
        const res = await pauseDownload(jobId)
        if (res.ok) {
          if (res.data?.data?.status === 'already_finishing') {
            showToast('Download is finishing and will complete momentarily', 'info')
            triggerRefresh()
          } else if (res.status === 202 || res.data?.data?.status === 'pause_pending') {
            showToast('Pausing download...', 'info')
            const pollResult = await waitForJobStatus(
              jobId,
              ['paused', 'completed', 'failed'],
              5000,
              250
            )
            if (!pollResult.ok || !pollResult.matched) {
              showError(
                'Action Not Confirmed',
                'The server has not confirmed the requested pause state.'
              )
              triggerRefresh()
              return
            }
            if (pollResult.status === 'paused') {
              showToast('Download paused', 'info')
            }
            triggerRefresh()
          } else {
            showToast('Download paused', 'info')
            triggerRefresh()
          }
        } else {
          const errorInfo = getSafeFriendlyErrorInfo(res.data, 'Failed to pause download.')
          showError(errorInfo.title || 'Pause Failed', errorInfo.message)
        }
      } catch (err) {
        const errorInfo = getSafeFriendlyErrorInfo(
          err,
          'An unexpected error occurred while pausing.'
        )
        showError(errorInfo.title || 'Pause Error', errorInfo.message)
      } finally {
        inFlightJobsRef.current.delete(key)
        setPausingJobId(null)
      }
    },
    [cancellingJobId, pausingJobId, triggerRefresh]
  )

  const handleResumeJob = useCallback(
    async (jobId) => {
      const key = String(jobId)
      if (!jobId || inFlightJobsRef.current.has(key)) return
      if (resumingJobId === jobId || cancellingJobId === jobId) return

      inFlightJobsRef.current.add(key)
      setResumingJobId(jobId)

      try {
        const res = await resumeDownload(jobId)
        if (res.ok) {
          if (res.data?.data?.status === 'interrupted') {
            showToast('Internet offline. Job will resume once connection is restored.', 'info')
          } else {
            showToast('Download resumed', 'success')
          }
          triggerRefresh()
        } else {
          const errorInfo = getSafeFriendlyErrorInfo(res.data, 'Failed to resume download.')
          showError(errorInfo.title || 'Resume Failed', errorInfo.message)
        }
      } catch (err) {
        const errorInfo = getSafeFriendlyErrorInfo(
          err,
          'An unexpected error occurred while resuming.'
        )
        showError(errorInfo.title || 'Resume Error', errorInfo.message)
      } finally {
        inFlightJobsRef.current.delete(key)
        setResumingJobId(null)
      }
    },
    [cancellingJobId, resumingJobId, triggerRefresh]
  )

  const handleCancelJob = useCallback(
    async (jobId) => {
      const key = String(jobId)
      if (!jobId || inFlightJobsRef.current.has(key)) return
      if (cancellingJobId === jobId) return

      const confirmed = await showConfirm(
        'Cancel Download?',
        'Are you sure you want to cancel this download? This will stop the active download process.',
        {
          confirmButtonText: 'Cancel Download',
          isDanger: true
        }
      )
      if (!confirmed) return

      inFlightJobsRef.current.add(key)
      setCancellingJobId(jobId)

      try {
        const res = await cancelDownload(jobId)
        if (res.ok) {
          if (res.status === 202 || res.data?.data?.status === 'cancellation_requested') {
            showToast('Cancelling download...', 'info')
            const pollResult = await waitForJobStatus(
              jobId,
              ['cancelled', 'completed', 'failed'],
              5000,
              250
            )
            if (!pollResult.ok || !pollResult.matched) {
              showError(
                'Action Not Confirmed',
                'The server has not confirmed the requested cancellation state.'
              )
              triggerRefresh()
              return
            }
            if (pollResult.status === 'cancelled') {
              showToast('Download cancelled', 'success')
            }
            triggerRefresh()
          } else {
            showToast('Download cancelled', 'success')
            triggerRefresh()
          }
        } else if (res.status === 409) {
          const errorInfo = getSafeFriendlyErrorInfo(
            res.data,
            'Download is already completed or terminated.'
          )
          showError('Cannot Cancel', errorInfo.message)
          triggerRefresh()
        } else if (res.status === 404) {
          showError('Not Found', 'Download job not found.')
          triggerRefresh()
        } else {
          const errorInfo = getSafeFriendlyErrorInfo(res.data, 'Failed to cancel download.')
          showError(errorInfo.title || 'Cancellation Failed', errorInfo.message)
        }
      } catch (err) {
        const errorInfo = getSafeFriendlyErrorInfo(
          err,
          'An unexpected error occurred while cancelling.'
        )
        showError(errorInfo.title || 'Cancellation Error', errorInfo.message)
      } finally {
        inFlightJobsRef.current.delete(key)
        setCancellingJobId(null)
      }
    },
    [cancellingJobId, triggerRefresh]
  )

  const handleRetryJob = useCallback(
    async (jobId) => {
      const key = String(jobId)
      if (!jobId || inFlightJobsRef.current.has(key)) return
      if (retryingJobId === jobId) return

      inFlightJobsRef.current.add(key)
      setRetryingJobId(jobId)

      try {
        const res = await retryDownload(jobId)
        if (res.ok && (res.status === 200 || res.status === 201)) {
          showToast('Download queued for retry', 'success')
          triggerRefresh()
        } else {
          const errorInfo = getSafeFriendlyErrorInfo(res.data, 'Failed to retry download.')
          showError(errorInfo.title || 'Retry Failed', errorInfo.message)
        }
      } catch (err) {
        const errorInfo = getSafeFriendlyErrorInfo(
          err,
          'An unexpected error occurred while retrying.'
        )
        showError(errorInfo.title || 'Retry Error', errorInfo.message)
      } finally {
        inFlightJobsRef.current.delete(key)
        setRetryingJobId(null)
      }
    },
    [retryingJobId, triggerRefresh]
  )

  return {
    pausingJobId,
    resumingJobId,
    cancellingJobId,
    retryingJobId,
    handlePauseJob,
    handleResumeJob,
    handleCancelJob,
    handleRetryJob
  }
}
