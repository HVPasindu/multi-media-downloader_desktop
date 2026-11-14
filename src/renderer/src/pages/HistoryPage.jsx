import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search,
  SlidersHorizontal,
  FileText,
  Video,
  Music,
  HardDrive,
  Trash2,
  Play,
  FolderOpen,
  RotateCcw,
  Loader2,
  RefreshCw
} from 'lucide-react'
import StatCard from '../components/ui/StatCard'
import FilterTabs from '../components/ui/FilterTabs'
import MediaThumbnail from '../components/ui/MediaThumbnail'
import PlatformBadge from '../components/ui/PlatformBadge'
import StatusBadge from '../components/ui/StatusBadge'
import Pagination from '../components/common/Pagination'
import {
  listDownloads,
  deleteDownloadHistory,
  clearDownloadHistory,
  retryDownload,
  getDownloadSummary,
  getActiveDownloadsCount
} from '../services/downloadsApi'
import { normalizeDownloadJob, formatBytes } from '../utils/downloadPresentation'
import { showConfirm, showToast, showError } from '../utils/notificationService'
import { getSafeFriendlyErrorInfo } from '../utils/errorPresentation'
import { getRetryButtonState, createRetryGuard } from '../utils/retryButtonState'

/**
 * Extracts a clean subtitle from statusText without repeating the main status label
 * (e.g. "Failed (File Missing)" -> "File Missing").
 */
function getStatusSubtitle(statusText, status) {
  if (!statusText) return null
  const match = statusText.match(/\(([^)]+)\)/)
  if (match) return match[1]
  const dashMatch = statusText.match(/[–-]\s*(.+)$/)
  if (dashMatch) return dashMatch[1]
  if (statusText.toLowerCase() === (status || '').toLowerCase()) return null
  return statusText
}

/**
 * Formats ISO date string into readable history date.
 */
function formatHistoryDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Download History Page
 * Features:
 * - Top Search Bar with filter control
 * - 4 Summary Cards (Total Files, Videos, Audio, Storage Used) dynamically calculated from SQLite
 * - Filter tabs (All, Videos, Audio, Completed, Failed) + Clear History button
 * - Comprehensive history table with row checkboxes, thumbnails, platform icons,
 *   format/quality pills, file sizes, timestamps, statuses, and action buttons.
 */
export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const [selectedIds, setSelectedIds] = useState([])
  const [historyItems, setHistoryItems] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [retryingJobId, setRetryingJobId] = useState(null)
  const retryGuardRef = useRef(null)
  if (retryGuardRef.current === null) {
    retryGuardRef.current = createRetryGuard()
  }
  const [showDateFilter, setShowDateFilter] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [appliedFrom, setAppliedFrom] = useState('')
  const [appliedTo, setAppliedTo] = useState('')
  const [dateError, setDateError] = useState(null)
  const [summary, setSummary] = useState({
    totalFiles: 0,
    videos: 0,
    audio: 0,
    completed: 0,
    failed: 0,
    storageBytes: 0
  })

  // Auto-clamp current page if total pages decreases
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize))
  const safeCurrentPage = totalRecords > 0 ? Math.min(Math.max(currentPage, 1), totalPages) : 1

  if (totalRecords > 0 && currentPage > totalPages) {
    setCurrentPage(totalPages)
  }

  const fetchSummary = useCallback(async () => {
    try {
      const res = await getDownloadSummary()
      if (res.ok && res.data?.success && res.data?.data?.history) {
        setSummary(res.data.data.history)
      }
    } catch {
      // Ignore summary fetch error
    }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const filters = {
        limit: pageSize,
        offset: (currentPage - 1) * pageSize
      }

      if (searchQuery.trim()) {
        filters.search = searchQuery.trim()
      }

      if (appliedFrom) {
        filters.from = appliedFrom
      }

      if (appliedTo) {
        filters.to = appliedTo
      }

      if (activeTab === 'videos') {
        filters.statuses = ['completed', 'failed', 'cancelled']
        filters.outputFormat = 'mp4'
      } else if (activeTab === 'audio') {
        filters.statuses = ['completed', 'failed', 'cancelled']
        filters.outputFormat = 'mp3'
      } else if (activeTab === 'completed') {
        filters.status = 'completed'
      } else if (activeTab === 'failed') {
        filters.statuses = ['failed', 'cancelled']
      } else {
        filters.statuses = ['completed', 'failed', 'cancelled']
      }

      const res = await listDownloads(filters)
      if (res.ok && res.data?.success && Array.isArray(res.data.data)) {
        const terminalRecords = res.data.data.map((job) => {
          const normalized = normalizeDownloadJob(job)
          return {
            ...normalized,
            savedTo: normalized.filePath || '—',
            date: formatHistoryDate(normalized.createdAt)
          }
        })
        setHistoryItems(terminalRecords)
        const reportedTotal = Number(res.data.pagination?.total)
        setTotalRecords(
          Number.isSafeInteger(reportedTotal) ? reportedTotal : terminalRecords.length
        )
        setError(null)
      } else {
        const errorInfo = getSafeFriendlyErrorInfo(res.data, 'Failed to load download history.')
        setError(errorInfo.message)
      }
    } catch (err) {
      console.warn('History fetch error:', err)
      const errorInfo = getSafeFriendlyErrorInfo(err, 'Unable to load history. Please retry.')
      setError(errorInfo.message)
    } finally {
      setIsLoading(false)
    }
  }, [activeTab, searchQuery, pageSize, currentPage, appliedFrom, appliedTo])

  // Adaptive background polling & immediate refresh on mutation events
  useEffect(() => {
    let isMounted = true
    let timerId = null

    async function pollLoop() {
      await Promise.all([fetchHistory(), fetchSummary()])
      if (!isMounted) return

      let interval = 8000
      try {
        const activeRes = await getActiveDownloadsCount()
        if (activeRes.ok && activeRes.total > 0) {
          interval = 2000
        }
      } catch {
        interval = 8000
      }

      timerId = setTimeout(() => {
        if (isMounted) {
          void pollLoop()
        }
      }, interval)
    }

    const onStateChanged = () => {
      if (isMounted) {
        void Promise.all([fetchHistory(), fetchSummary()])
      }
    }

    window.addEventListener('applan2:download-state-changed', onStateChanged)

    void pollLoop()

    return () => {
      isMounted = false
      if (timerId) clearTimeout(timerId)
      window.removeEventListener('applan2:download-state-changed', onStateChanged)
    }
  }, [fetchHistory, fetchSummary])

  // Dynamic summary metrics calculated strictly from SQLite records
  const totalFiles = summary.totalFiles
  const videosCount = summary.videos
  const audioCount = summary.audio
  const completedCount = summary.completed
  const failedCount = summary.failed
  const storageUsed = summary.storageBytes > 0 ? formatBytes(summary.storageBytes) : '—'

  const handleSelectTab = (tabId) => {
    setActiveTab(tabId)
    setCurrentPage(1)
    setSelectedIds([])
  }

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value)
    setCurrentPage(1)
    setSelectedIds([])
  }

  const handlePageSizeChange = (newSize) => {
    setPageSize(newSize)
    setCurrentPage(1)
    setSelectedIds([])
  }

  // Toggle select all
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(historyItems.map((item) => item.id))
    } else {
      setSelectedIds([])
    }
  }

  // Toggle single item selection
  const handleToggleItem = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  // Clear history or delete selected records permanently
  const handleClearHistory = async () => {
    if (selectedIds.length > 0) {
      const confirmed = await showConfirm(
        'Delete Selected Records?',
        `Permanently remove ${selectedIds.length} selected record(s) from history? Media files on disk will not be deleted.`,
        { confirmButtonText: 'Delete Selected', isDanger: true }
      )
      if (!confirmed) return

      try {
        const results = await Promise.allSettled(selectedIds.map((id) => deleteDownloadHistory(id)))
        const deletedCount = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length
        if (deletedCount > 0) {
          showToast(`Deleted ${deletedCount} record(s) from history`, 'success')
          setSelectedIds([])
          fetchHistory()
          fetchSummary()
        } else {
          showError('Delete Failed', 'Failed to delete selected records.')
        }
      } catch (err) {
        const errorInfo = getSafeFriendlyErrorInfo(
          err,
          'An unexpected error occurred while deleting records.'
        )
        showError('Delete Failed', errorInfo.message)
      }
      return
    }

    const confirmed = await showConfirm(
      'Clear All Download History?',
      'This will permanently remove all completed, failed, and cancelled download records from history. Media files on your disk will not be deleted.',
      {
        confirmButtonText: 'Clear History',
        isDanger: true
      }
    )

    if (!confirmed) return

    try {
      const res = await clearDownloadHistory({
        confirm: true,
        statuses: ['completed', 'failed', 'cancelled']
      })

      if (res.ok && res.data?.success) {
        showToast('Download history cleared', 'success')
        setSelectedIds([])
        fetchHistory()
        fetchSummary()
      } else {
        const errorInfo = getSafeFriendlyErrorInfo(res.data, 'Failed to clear download history.')
        showError('Clear Failed', errorInfo.message)
      }
    } catch (err) {
      const errorInfo = getSafeFriendlyErrorInfo(err, 'Unable to clear download history.')
      showError('Clear Failed', errorInfo.message)
    }
  }

  // Delete a single record from history
  const handleDeleteRecord = async (id) => {
    const confirmed = await showConfirm(
      'Delete Record?',
      'Remove this download record from history? Media files on disk will not be deleted.',
      {
        confirmButtonText: 'Delete',
        isDanger: true
      }
    )

    if (!confirmed) return

    try {
      const res = await deleteDownloadHistory(id)
      if (res.ok && res.data?.success) {
        showToast('Record deleted from history', 'success')
        setSelectedIds((prev) => prev.filter((itemId) => itemId !== id))
        fetchHistory()
        fetchSummary()
      } else {
        const errorInfo = getSafeFriendlyErrorInfo(res.data, 'Failed to delete record.')
        showError('Delete Failed', errorInfo.message)
      }
    } catch (err) {
      const errorInfo = getSafeFriendlyErrorInfo(
        err,
        'An unexpected error occurred while deleting the record.'
      )
      showError('Delete Error', errorInfo.message)
    }
  }

  // Date range filter handlers (Step 05.12)
  const handleApplyDateFilter = () => {
    if (fromDate && toDate && fromDate > toDate) {
      setDateError('Start date cannot be after end date')
      return
    }
    setDateError(null)
    setAppliedFrom(fromDate)
    setAppliedTo(toDate)
    setCurrentPage(1)
    setSelectedIds([])
  }

  const handleClearDateFilter = () => {
    setFromDate('')
    setToDate('')
    setAppliedFrom('')
    setAppliedTo('')
    setDateError(null)
    setCurrentPage(1)
    setSelectedIds([])
  }

  // Open media file using native OS application (Step 05.12, FIX 02 & FIX 03)
  const handleOpenFile = async (jobId) => {
    if (!jobId) {
      showError('File Not Available', 'The download record ID is invalid or unavailable.')
      return
    }
    try {
      if (window.api?.openFile) {
        const res = await window.api.openFile(jobId)
        if (!res?.success) {
          const errorInfo = getSafeFriendlyErrorInfo(
            res?.error,
            'The downloaded file could not be opened.'
          )
          showError(errorInfo.title, errorInfo.message)
        }
      } else {
        showError('Not Supported', 'Opening files is not supported in this environment.')
      }
    } catch (err) {
      const errorInfo = getSafeFriendlyErrorInfo(
        err,
        'An unexpected error occurred while opening the file.'
      )
      showError(errorInfo.title, errorInfo.message)
    }
  }

  // Open enclosing folder in OS file manager (Step 05.12, FIX 02 & FIX 03)
  const handleOpenFolder = async (jobId) => {
    if (!jobId) {
      showError('Folder Not Available', 'The download record ID is invalid or unavailable.')
      return
    }
    try {
      if (window.api?.openFolder) {
        const res = await window.api.openFolder(jobId)
        if (!res?.success) {
          const errorInfo = getSafeFriendlyErrorInfo(
            res?.error,
            'The enclosing folder could not be opened.'
          )
          showError(errorInfo.title, errorInfo.message)
        }
      } else {
        showError('Not Supported', 'Opening folders is not supported in this environment.')
      }
    } catch (err) {
      const errorInfo = getSafeFriendlyErrorInfo(
        err,
        'An unexpected error occurred while opening the folder.'
      )
      showError(errorInfo.title, errorInfo.message)
    }
  }

  // Retry a failed or cancelled record (Step 05.13, FIX 03 & FIX 04)
  const handleRetryRecord = async (id) => {
    if (!retryGuardRef.current.tryStart()) return
    try {
      setRetryingJobId(id)
      const res = await retryDownload(id)
      if (res.ok && res.status === 201) {
        showToast('Download queued for retry', 'success')
        fetchHistory()
        fetchSummary()
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
      retryGuardRef.current.finish()
      setRetryingJobId(null)
    }
  }

  const tabs = [
    { id: 'all', label: 'All', count: totalFiles },
    { id: 'videos', label: 'Videos', count: videosCount },
    { id: 'audio', label: 'Audio', count: audioCount },
    { id: 'completed', label: 'Completed', count: completedCount },
    { id: 'failed', label: 'Failed', count: failedCount }
  ]

  const isAllSelected = historyItems.length > 0 && selectedIds.length === historyItems.length

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] w-full mx-auto flex flex-col gap-6 select-none animate-fadeIn">
      {/* ----------------- TOP HEADER & SEARCH BAR ----------------- */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl lg:text-4xl font-extrabold text-text tracking-tight">
              Download History
            </h1>
          </div>
          <p className="text-sm text-text-muted mt-1 font-medium">
            Review, manage and reopen your previously downloaded media
          </p>
        </div>

        {/* Search & Filter Controls (Top Right) */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted/70" />
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search history..."
              className="w-full bg-surface/90 border border-primary/20 rounded-xl py-2 pl-10 pr-4 text-xs font-medium text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowDateFilter((prev) => !prev)}
            className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
              showDateFilter || appliedFrom || appliedTo
                ? 'bg-surface-elevated border-primary/40 text-primary shadow-sm'
                : 'bg-surface/90 hover:bg-surface-elevated border-primary/20 text-text-muted hover:text-text'
            }`}
            title={showDateFilter ? 'Close date filter' : 'Filter by date range'}
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ----------------- DATE RANGE FILTER PANEL (Step 05.12) ----------------- */}
      {showDateFilter && (
        <div className="p-4 rounded-2xl bg-surface/90 border border-primary/20 shadow-lg flex flex-wrap items-center gap-4 transition-all animate-fadeIn">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-text-muted">From:</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value)
                setDateError(null)
              }}
              className="bg-background border border-primary/20 rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-text-muted">To:</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value)
                setDateError(null)
              }}
              className="bg-background border border-primary/20 rounded-lg px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleApplyDateFilter}
              className="px-3.5 py-1.5 rounded-lg bg-primary hover:bg-primary/80 text-xs font-semibold text-on-primary transition-all cursor-pointer shadow-sm"
            >
              Apply Filter
            </button>
            {(appliedFrom || appliedTo || fromDate || toDate) && (
              <button
                type="button"
                onClick={handleClearDateFilter}
                className="px-3.5 py-1.5 rounded-lg bg-background hover:bg-surface-elevated border border-primary/20 text-xs font-semibold text-text-muted hover:text-text transition-all cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
          {dateError && <span className="text-xs text-red-400 font-medium">{dateError}</span>}
          {(appliedFrom || appliedTo) && !dateError && (
            <span className="text-xs text-primary font-medium ml-auto">
              Active: {appliedFrom || 'Any'} &rarr; {appliedTo || 'Any'}
            </span>
          )}
        </div>
      )}

      {/* ----------------- 4 SUMMARY CARDS ROW (Dynamic Counts) ----------------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={FileText}
          count={totalFiles}
          label="Total Files"
          accentColor="blue"
          isActive={activeTab === 'all'}
          onClick={() => handleSelectTab('all')}
        />
        <StatCard
          icon={Video}
          count={videosCount}
          label="Videos"
          accentColor="purple"
          isActive={activeTab === 'videos'}
          onClick={() => handleSelectTab('videos')}
        />
        <StatCard
          icon={Music}
          count={audioCount}
          label="Audio"
          accentColor="cyan"
          isActive={activeTab === 'audio'}
          onClick={() => handleSelectTab('audio')}
        />
        <StatCard icon={HardDrive} count={storageUsed} label="Storage Used" accentColor="cyan" />
      </div>

      {/* ----------------- FILTER TABS & CLEAR HISTORY ----------------- */}
      <FilterTabs
        tabs={tabs}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        rightAction={
          <button
            type="button"
            onClick={handleClearHistory}
            disabled={totalFiles === 0}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              totalFiles > 0
                ? 'text-red-400 hover:text-white bg-red-600/10 hover:bg-red-600/30 border border-red-500/25 cursor-pointer'
                : 'text-red-400/40 bg-red-600/5 border border-red-500/10 cursor-not-allowed'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>
              {selectedIds.length > 0 ? `Delete Selected (${selectedIds.length})` : 'Clear History'}
            </span>
          </button>
        }
      />

      {/* ----------------- DOWNLOAD HISTORY TABLE ----------------- */}
      <div className="rounded-2xl bg-surface/90 border border-primary/15 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[980px]">
            {/* Table Header */}
            <thead>
              <tr className="border-b border-primary/15 text-[11px] font-bold text-text-muted uppercase tracking-wider bg-background/60">
                <th className="py-3.5 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleSelectAll}
                    disabled={historyItems.length === 0}
                    className="rounded border-primary/30 bg-background text-primary focus:ring-primary/40 cursor-pointer"
                  />
                </th>
                <th className="py-3.5 px-3 w-10 text-center">#</th>
                <th className="py-3.5 px-4 min-w-[220px]">Media</th>
                <th className="py-3.5 px-3 w-20">Format</th>
                <th className="py-3.5 px-4 w-28">Quality / Bitrate</th>
                <th className="py-3.5 px-4 w-24">File Size</th>
                <th className="py-3.5 px-4 min-w-[180px]">Saved To</th>
                <th className="py-3.5 px-4 w-36">Date ▾</th>
                <th className="py-3.5 px-4 w-32">Status</th>
                <th className="py-3.5 px-4 w-28 text-center">Actions</th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-primary/10 text-xs">
              {historyItems.map((item, idx) => {
                const isSelected = selectedIds.includes(item.id)
                const isFailed = item.status === 'failed' || item.status === 'cancelled'
                const retryButtonState = getRetryButtonState(retryingJobId, item.id)

                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-surface-elevated/40 transition-colors group ${
                      isSelected ? 'bg-surface-elevated/60' : ''
                    }`}
                  >
                    {/* Row Checkbox */}
                    <td className="py-3 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleItem(item.id)}
                        className="rounded border-primary/30 bg-background text-primary focus:ring-primary/40 cursor-pointer"
                      />
                    </td>

                    {/* Row Index */}
                    <td className="py-3 px-3 text-center text-text-muted/70 font-mono text-xs">
                      {(safeCurrentPage - 1) * pageSize + idx + 1}
                    </td>

                    {/* Media Thumbnail + Title + Platform */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-16 h-10 flex-shrink-0">
                          <MediaThumbnail
                            src={item.thumbnail}
                            duration={item.duration}
                            hasError={isFailed}
                            aspectRatio="aspect-video"
                          />
                        </div>

                        <div className="flex flex-col min-w-0 max-w-[220px]">
                          <span
                            className={`font-bold truncate ${
                              isFailed
                                ? 'text-text-muted line-through'
                                : 'text-text group-hover:text-primary'
                            } transition-colors`}
                          >
                            {item.title}
                          </span>
                          <div className="mt-0.5">
                            <PlatformBadge platform={item.platform} />
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Format Pill */}
                    <td className="py-3 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-black uppercase tracking-wider ${
                          item.format === 'MP4'
                            ? 'bg-primary/15 text-primary border border-primary/30'
                            : 'bg-emerald-500/15 text-[#00DEA5] border border-emerald-500/30'
                        }`}
                      >
                        {item.format}
                      </span>
                    </td>

                    {/* Quality / Bitrate */}
                    <td className="py-3 px-4">
                      <span className="inline-block px-2.5 py-0.5 rounded text-[11px] font-bold bg-surface-elevated text-text-muted border border-primary/20">
                        {item.quality}
                      </span>
                    </td>

                    {/* File Size */}
                    <td className="py-3 px-4 font-mono text-text-muted text-xs">
                      {item.fileSize || item.size || '—'}
                    </td>

                    {/* Saved To Path */}
                    <td className="py-3 px-4">
                      <span
                        className="text-[11px] font-mono text-text-muted/80 truncate block max-w-[180px]"
                        title={item.savedTo}
                      >
                        {item.savedTo}
                      </span>
                    </td>

                    {/* Date Formatted */}
                    <td className="py-3 px-4 text-text-muted text-[11px]">{item.date}</td>

                    {/* Status Badge */}
                    <td className="py-3 px-4">
                      <StatusBadge
                        status={item.status}
                        subtitle={getStatusSubtitle(item.statusText, item.status)}
                      />
                    </td>

                    {/* Action Buttons */}
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Play / Open File or Retry Button */}
                        {isFailed ? (
                          <button
                            type="button"
                            onClick={() => handleRetryRecord(item.id)}
                            disabled={retryButtonState.disabled}
                            className="w-7 h-7 rounded-lg bg-background hover:bg-surface-elevated border border-primary/20 flex items-center justify-center text-text-muted hover:text-primary transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Retry download"
                          >
                            <RotateCcw
                              className={`w-3.5 h-3.5 ${retryButtonState.isSpinning ? 'animate-spin text-primary' : ''}`}
                            />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenFile(item.id)}
                            disabled={!item.filePath || item.filePath === '—'}
                            className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-all ${
                              item.filePath && item.filePath !== '—'
                                ? 'bg-background hover:bg-surface-elevated border-primary/20 text-text-muted hover:text-primary cursor-pointer shadow-sm'
                                : 'bg-background/50 border-primary/10 text-text-muted/40 cursor-not-allowed'
                            }`}
                            title={
                              item.filePath && item.filePath !== '—'
                                ? 'Play / Open media file'
                                : 'File path unavailable'
                            }
                          >
                            <Play className="w-3.5 h-3.5 ml-0.5" />
                          </button>
                        )}

                        {/* Open Enclosing Folder Button */}
                        <button
                          type="button"
                          onClick={() => handleOpenFolder(item.id)}
                          disabled={!item.filePath || item.filePath === '—'}
                          className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-all ${
                            item.filePath && item.filePath !== '—'
                              ? 'bg-background hover:bg-surface-elevated border-primary/20 text-text-muted hover:text-primary cursor-pointer shadow-sm'
                              : 'bg-background/50 border-primary/10 text-text-muted/40 cursor-not-allowed'
                          }`}
                          title={
                            item.filePath && item.filePath !== '—'
                              ? 'Open enclosing folder'
                              : 'Folder path unavailable'
                          }
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete Single Record Button */}
                        <button
                          type="button"
                          onClick={() => handleDeleteRecord(item.id)}
                          className="w-7 h-7 rounded-lg bg-background hover:bg-surface-elevated border border-primary/20 flex items-center justify-center text-text-muted hover:text-red-400 transition-all cursor-pointer"
                          title="Delete record from history"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}

              {isLoading ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-text-muted">
                    <div className="flex flex-col items-center justify-center gap-3 select-none">
                      <Loader2 className="w-8 h-8 text-primary animate-spin" />
                      <span className="text-sm font-semibold text-text">Loading history...</span>
                      <span className="text-xs text-text-muted">
                        Fetching your download history records...
                      </span>
                    </div>
                  </td>
                </tr>
              ) : error && historyItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-text-muted">
                    <div className="flex flex-col items-center justify-center gap-3 select-none">
                      <span className="text-sm font-semibold text-text">
                        Failed to load history
                      </span>
                      <span className="text-xs text-text-muted max-w-md">{error}</span>
                      <button
                        type="button"
                        onClick={fetchHistory}
                        className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-text bg-surface hover:bg-surface-elevated border border-primary/20 hover:border-primary/40 transition-all cursor-pointer shadow-md"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-primary" />
                        <span>Retry</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : historyItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-text-muted">
                    {searchQuery.trim()
                      ? 'No history records match your search query.'
                      : activeTab !== 'all'
                        ? 'No history records match the selected filter.'
                        : 'No download history found. Completed and failed downloads will appear here.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Reusable Pagination Controls */}
        <Pagination
          currentPage={safeCurrentPage}
          pageSize={pageSize}
          totalRecords={totalRecords}
          onPageChange={(page) => {
            setCurrentPage(page)
            setSelectedIds([])
          }}
          onPageSizeChange={handlePageSizeChange}
          pageSizeOptions={[10, 20, 50]}
          recordLabel="history records"
        />
      </div>
    </div>
  )
}
