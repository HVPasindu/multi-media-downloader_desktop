import { useState, useEffect, useCallback } from 'react'
import {
  Search,
  SlidersHorizontal,
  Loader2,
  Hourglass,
  CheckCircle2,
  XCircle,
  Pause,
  Play,
  Square,
  Trash2,
  Download,
  AlertCircle,
  RefreshCw,
  RotateCcw
} from 'lucide-react'
import StatCard from '../components/ui/StatCard'
import FilterTabs from '../components/ui/FilterTabs'
import MediaThumbnail from '../components/ui/MediaThumbnail'
import PlatformBadge from '../components/ui/PlatformBadge'
import StatusBadge from '../components/ui/StatusBadge'
import Pagination from '../components/common/Pagination'
import { useDownloadsManager } from '../hooks/useDownloadsManager'
import { retryDownload, clearDownloadHistory, getDownloadSummary } from '../services/downloadsApi'
import { showError, showToast, showConfirm } from '../utils/notificationService'

/**
 * Cleanly extracts secondary contextual subtitle from statusText without duplicating
 * the main status name (e.g. "Downloading (2m 45s left)" -> "2m 45s left"
 * or "Interrupted – Waiting for internet connection" -> "Waiting for internet connection").
 */
function getStatusSubtitle(statusText, status) {
  if (!statusText) return null
  const parenMatch = statusText.match(/\(([^)]+)\)/)
  if (parenMatch) return parenMatch[1]
  const dashMatch = statusText.match(/[–-]\s*(.+)$/)
  if (dashMatch) return dashMatch[1]
  if (statusText.toLowerCase() === (status || '').toLowerCase()) return null
  return statusText
}

/**
 * Downloads Manager Page
 * Features:
 * - Search bar with server-side query execution across all records before pagination
 * - 4 Metric Stat Cards (Downloading, Queued, Completed, Failed) calculated from SQLite totals
 * - Horizontal filter tabs with accurate item counts & permanent Clear Completed action
 * - Downloads Queue table with server-side pagination (10, 20, 50 records per page, default 20)
 * - Clean Pagination component with page jump buttons, ellipsis, and rows-per-page selector
 */
export default function DownloadsPage() {
  const [activeTab, setActiveTab] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [currentPage, setCurrentPage] = useState(1)
  const [retryingJobId, setRetryingJobId] = useState(null)

  // Status mapping for server-side queries
  const statusFilter = activeTab === 'all' || activeTab === 'failed' ? null : activeTab
  const statusesFilter = activeTab === 'failed' ? ['failed', 'cancelled'] : null

  // Step 12: Server-side paginated & filtered Downloads Manager state
  const {
    downloadsList,
    isLoading,
    error,
    retry,
    total: totalMatchingRecords = 0
  } = useDownloadsManager({
    limit: pageSize,
    offset: Math.max(0, (currentPage - 1) * pageSize),
    search: searchQuery,
    status: statusFilter,
    statuses: statusesFilter
  })

  // Auto-clamp current page if total pages decreases (e.g. after deletion or filter change)
  const totalPages = Math.max(1, Math.ceil(totalMatchingRecords / pageSize))
  const safeCurrentPage = Math.min(Math.max(currentPage, 1), totalPages)
  const offset = (safeCurrentPage - 1) * pageSize

  if (totalMatchingRecords > 0 && currentPage > totalPages) {
    setCurrentPage(totalPages)
  }

  // Global counts for StatCards and FilterTabs (genuine SQLite totals across entire database)
  const [globalCounts, setGlobalCounts] = useState({
    downloading: 0,
    queued: 0,
    interrupted: 0,
    completed: 0,
    failed: 0,
    total: 0
  })

  const fetchGlobalCounts = useCallback(async () => {
    try {
      const res = await getDownloadSummary()
      if (res.ok && res.data?.success && res.data?.data?.downloads) {
        setGlobalCounts(res.data.data.downloads)
      }
    } catch {
      // Ignore count fetch errors
    }
  }, [])

  // Adaptive background polling & immediate refresh on mutation events
  useEffect(() => {
    let isMounted = true
    let timerId = null

    async function pollLoop() {
      await fetchGlobalCounts()
      if (!isMounted) return

      const hasActive =
        globalCounts.downloading > 0 || globalCounts.queued > 0 || globalCounts.interrupted > 0

      const interval = hasActive ? 2000 : 8000
      timerId = setTimeout(() => {
        if (isMounted) {
          void pollLoop()
        }
      }, interval)
    }

    const onStateChanged = () => {
      if (isMounted) {
        void fetchGlobalCounts()
      }
    }

    window.addEventListener('applan2:download-state-changed', onStateChanged)

    void pollLoop()

    return () => {
      isMounted = false
      if (timerId) clearTimeout(timerId)
      window.removeEventListener('applan2:download-state-changed', onStateChanged)
    }
  }, [fetchGlobalCounts, globalCounts.downloading, globalCounts.queued, globalCounts.interrupted])

  const handleSelectTab = (tabId) => {
    setActiveTab(tabId)
    setCurrentPage(1)
  }

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value)
    setCurrentPage(1)
  }

  const handlePageSizeChange = (newSize) => {
    setPageSize(newSize)
    setCurrentPage(1)
  }

  const handleRetryJob = async (jobId) => {
    try {
      setRetryingJobId(jobId)
      const res = await retryDownload(jobId)
      if (res.ok && res.status === 201) {
        showToast('Download queued for retry', 'success')
        if (typeof retry === 'function') retry()
      } else {
        const errorMsg = res.data?.message || 'Failed to retry download'
        showError('Retry Failed', errorMsg)
      }
    } catch (err) {
      showError('Retry Error', err?.message || 'An unexpected error occurred while retrying.')
    } finally {
      setRetryingJobId(null)
    }
  }

  // Permanently clear completed download records from SQLite history (Step 11)
  const handleClearCompleted = async () => {
    const confirmed = await showConfirm(
      'Clear Completed Downloads?',
      'This will permanently remove completed download records from history. Media files on disk will not be deleted.',
      {
        confirmButtonText: 'Clear Completed',
        isDanger: true
      }
    )

    if (!confirmed) return

    try {
      const res = await clearDownloadHistory({
        confirm: true,
        statuses: ['completed']
      })

      if (res.ok && res.data?.success) {
        showToast('Completed downloads cleared from history', 'success')
        if (typeof retry === 'function') retry()
        fetchGlobalCounts()
      } else {
        showError('Clear Failed', res.data?.message || 'Failed to clear completed downloads.')
      }
    } catch (err) {
      showError('Clear Failed', err?.message || 'An unexpected error occurred.')
    }
  }

  // Permanently clear failed download records from SQLite history (Order 09)
  const handleClearFailed = async () => {
    const confirmed = await showConfirm(
      'Clear Failed Downloads?',
      'This will permanently remove failed download records from history. Media files on disk will not be deleted.',
      {
        confirmButtonText: 'Clear Failed',
        isDanger: true
      }
    )

    if (!confirmed) return

    try {
      const res = await clearDownloadHistory({
        confirm: true,
        statuses: ['failed']
      })

      if (res.ok && res.data?.success) {
        showToast('Failed downloads cleared from history', 'success')
        if (typeof retry === 'function') retry()
        fetchGlobalCounts()
      } else {
        showError('Clear Failed', res.data?.message || 'Failed to clear failed downloads.')
      }
    } catch (err) {
      showError('Clear Failed', err?.message || 'An unexpected error occurred.')
    }
  }

  const tabs = [
    { id: 'all', label: 'All', count: globalCounts.total },
    { id: 'downloading', label: 'Downloading', count: globalCounts.downloading },
    { id: 'queued', label: 'Queued', count: globalCounts.queued },
    ...(globalCounts.interrupted > 0
      ? [{ id: 'interrupted', label: 'Interrupted', count: globalCounts.interrupted }]
      : []),
    { id: 'completed', label: 'Completed', count: globalCounts.completed },
    { id: 'failed', label: 'Failed', count: globalCounts.failed }
  ]

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] w-full mx-auto flex flex-col gap-6 select-none animate-fadeIn">
      {/* ----------------- TOP HEADER & SEARCH BAR ----------------- */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl lg:text-4xl font-extrabold text-white tracking-tight">
              Downloads Manager
            </h1>
          </div>
          <p className="text-sm text-text-muted mt-1 font-medium">
            Manage your active, queued and completed downloads
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
              placeholder="Search downloads..."
              className="w-full bg-[#07152E]/90 border border-primary/20 rounded-xl py-2 pl-10 pr-4 text-xs font-medium text-white placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <button
            type="button"
            className="p-2.5 rounded-xl bg-[#07152E]/90 hover:bg-[#0B1C38] border border-primary/20 text-text-muted hover:text-white transition-all cursor-pointer"
            title="Filter options"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ----------------- 4 STAT CARDS ROW (Dynamic SQLite Counts) ----------------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Loader2}
          count={globalCounts.downloading}
          label="Downloading"
          accentColor="cyan"
          isActive={activeTab === 'downloading'}
          onClick={() => handleSelectTab('downloading')}
        />
        <StatCard
          icon={Hourglass}
          count={globalCounts.queued}
          label="Queued"
          accentColor="blue"
          isActive={activeTab === 'queued'}
          onClick={() => handleSelectTab('queued')}
        />
        <StatCard
          icon={CheckCircle2}
          count={globalCounts.completed}
          label="Completed"
          accentColor="green"
          isActive={activeTab === 'completed'}
          onClick={() => handleSelectTab('completed')}
        />
        <StatCard
          icon={XCircle}
          count={globalCounts.failed}
          label="Failed"
          accentColor="red"
          isActive={activeTab === 'failed'}
          onClick={() => handleSelectTab('failed')}
        />
      </div>

      {/* ----------------- FILTER TABS & CLEAR ACTIONS ----------------- */}
      <FilterTabs
        tabs={tabs}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        rightAction={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClearFailed}
              disabled={globalCounts.failed === 0}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                globalCounts.failed > 0
                  ? 'text-rose-400 hover:text-white bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 cursor-pointer'
                  : 'text-text-muted/40 bg-[#07152E]/40 border border-primary/10 cursor-not-allowed'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Failed</span>
            </button>
            <button
              type="button"
              onClick={handleClearCompleted}
              disabled={globalCounts.completed === 0}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                globalCounts.completed > 0
                  ? 'text-text-muted hover:text-white bg-[#07152E]/80 hover:bg-[#0B1C38] border border-primary/15 cursor-pointer'
                  : 'text-text-muted/40 bg-[#07152E]/40 border border-primary/10 cursor-not-allowed'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Completed</span>
            </button>
          </div>
        }
      />

      {/* ----------------- DOWNLOADS QUEUE TABLE WITH PAGINATION ----------------- */}
      <div className="rounded-2xl bg-[#07152E]/90 border border-primary/15 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[840px]">
            {/* Table Header */}
            <thead>
              <tr className="border-b border-primary/15 text-[11px] font-bold text-text-muted uppercase tracking-wider bg-[#040B1C]/60">
                <th className="py-3.5 px-4 w-10 text-center">#</th>
                <th className="py-3.5 px-4">Media</th>
                <th className="py-3.5 px-4 w-24">Format</th>
                <th className="py-3.5 px-4 w-28">Quality</th>
                <th className="py-3.5 px-4 w-52">Progress</th>
                <th className="py-3.5 px-4 w-40">Status</th>
                <th className="py-3.5 px-4 w-28 text-center">Actions</th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-primary/10 text-xs">
              {downloadsList.map((item, idx) => {
                const isDownloading = item.status === 'downloading'
                const isInterrupted = item.status === 'interrupted'
                const isResuming = item.displayStatus === 'resuming'
                const isQueued = item.status === 'queued' && !isResuming
                const showRecoveryInfo = isDownloading || isInterrupted || isResuming
                const itemIndex = offset + idx + 1

                return (
                  <tr key={item.id} className="hover:bg-[#0B1C38]/40 transition-colors group">
                    {/* Index */}
                    <td className="py-3.5 px-4 text-center text-text-muted/70 font-mono text-xs">
                      {itemIndex}
                    </td>

                    {/* Media Thumbnail + Title + Platform */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-20 h-12 flex-shrink-0">
                          <MediaThumbnail
                            src={item.thumbnail}
                            duration={item.duration}
                            aspectRatio="aspect-video"
                          />
                        </div>

                        <div className="flex flex-col min-w-0 max-w-xs">
                          <span className="font-bold text-white truncate group-hover:text-[#19D8FF] transition-colors">
                            {item.title}
                          </span>
                          <div className="mt-1">
                            <PlatformBadge platform={item.platform} />
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Format Badge */}
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-md text-[11px] font-black uppercase tracking-wider ${
                          item.format === 'MP4'
                            ? 'bg-cyan-500/15 text-[#19D8FF] border border-cyan-500/30'
                            : 'bg-emerald-500/15 text-[#00DEA5] border border-emerald-500/30'
                        }`}
                      >
                        {item.format}
                      </span>
                    </td>

                    {/* Quality / Bitrate Badge */}
                    <td className="py-3.5 px-4">
                      <span className="inline-block px-2.5 py-1 rounded-md text-[11px] font-bold bg-[#102449] text-text-muted border border-primary/20">
                        {item.quality}
                      </span>
                    </td>

                    {/* Progress Bar & Numerical Metrics */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-white">{item.progress}%</span>
                          <span className="text-text-muted text-[10px]">
                            {item.progressText || '0 B'}
                          </span>
                        </div>

                        {/* Progress Bar Track */}
                        <div className="w-full h-2 rounded-full bg-[#040B1C] overflow-hidden border border-primary/10">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isInterrupted
                                ? 'bg-amber-400/80'
                                : isDownloading || isResuming
                                  ? 'bg-gradient-to-r from-[#19D8FF] to-[#3388FF]'
                                  : 'bg-primary/20'
                            }`}
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>

                        {/* Live Speed & ETA when downloading, interrupted, or resuming */}
                        {showRecoveryInfo && (
                          <div className="flex items-center justify-between text-[10px] text-text-muted mt-0.5">
                            {isInterrupted ? (
                              <>
                                <span className="text-amber-400 font-semibold">0 KB/s</span>
                                <span className="text-amber-400 font-medium">
                                  Waiting for connection
                                </span>
                              </>
                            ) : isResuming ? (
                              <>
                                <span className="text-cyan-400 font-semibold">—</span>
                                <span className="text-cyan-400 font-medium">Resuming...</span>
                              </>
                            ) : (
                              <>
                                <span className="text-cyan-400 font-semibold">
                                  {item.speedText || '—'}
                                </span>
                                <span className="text-text-muted/80">
                                  {item.etaText || 'Calculating...'}
                                </span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Status Column with animated spinner, gear, or hourglass */}
                    <td className="py-3.5 px-4">
                      <StatusBadge
                        status={item.displayStatus || item.status}
                        subtitle={getStatusSubtitle(
                          item.statusText,
                          item.displayStatus || item.status
                        )}
                      />
                    </td>

                    {/* Action Buttons */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center justify-center gap-2">
                        {/* Retry Button for Failed or Cancelled Jobs */}
                        {(item.status === 'failed' || item.status === 'cancelled') && (
                          <button
                            type="button"
                            onClick={() => handleRetryJob(item.id)}
                            disabled={retryingJobId === item.id}
                            className="px-2.5 py-1 rounded-lg bg-[#040B1C]/80 hover:bg-[#102449] border border-primary/20 hover:border-primary/40 text-text-muted hover:text-white flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                            title="Retry download"
                          >
                            <RotateCcw
                              className={`w-3.5 h-3.5 text-[#19D8FF] ${retryingJobId === item.id ? 'animate-spin' : ''}`}
                            />
                            <span className="text-[11px] font-bold">Retry</span>
                          </button>
                        )}

                        {/* Play/Pause Button */}
                        {isDownloading && (
                          <button
                            type="button"
                            disabled
                            className="w-8 h-8 rounded-lg bg-[#040B1C]/50 border border-primary/10 flex items-center justify-center text-text-muted/40 cursor-not-allowed"
                            title="Pause control will be connected in Step 05.11"
                          >
                            <Pause className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {isQueued && (
                          <button
                            type="button"
                            disabled
                            className="w-8 h-8 rounded-lg bg-[#040B1C]/50 border border-primary/10 flex items-center justify-center text-text-muted/40 cursor-not-allowed"
                            title="Start queue control will be connected in Step 05.11"
                          >
                            <Play className="w-3.5 h-3.5 ml-0.5" />
                          </button>
                        )}

                        {/* Cancel / Stop Button (only for active jobs) */}
                        {(isDownloading || isQueued || item.status === 'interrupted') && (
                          <button
                            type="button"
                            disabled
                            className="w-8 h-8 rounded-lg border bg-[#040B1C]/50 border-primary/10 text-text-muted/40 flex items-center justify-center cursor-not-allowed"
                            title="Cancel download will be connected in Step 05.11"
                          >
                            <Square className="w-3 h-3 fill-current" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}

              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-text-muted">
                    <div className="flex flex-col items-center justify-center gap-3 select-none">
                      <Loader2 className="w-8 h-8 text-[#19D8FF] animate-spin" />
                      <span className="text-sm font-semibold text-white">Loading downloads...</span>
                      <span className="text-xs text-text-muted">
                        Fetching your active and recent downloads...
                      </span>
                    </div>
                  </td>
                </tr>
              ) : error && downloadsList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-text-muted">
                    <div className="flex flex-col items-center justify-center gap-3 select-none">
                      <AlertCircle className="w-8 h-8 text-[#FF4568]" />
                      <span className="text-sm font-semibold text-white">
                        Failed to load downloads
                      </span>
                      <span className="text-xs text-text-muted max-w-md">{error}</span>
                      <button
                        type="button"
                        onClick={retry}
                        className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#07152E] hover:bg-[#0B1C38] border border-primary/20 hover:border-[#19D8FF]/40 transition-all cursor-pointer shadow-md"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-[#19D8FF]" />
                        <span>Retry</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : downloadsList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-text-muted">
                    <div className="flex flex-col items-center justify-center gap-2 select-none">
                      <Download className="w-8 h-8 text-text-muted/40" />
                      <span className="text-sm font-semibold text-white">No downloads found</span>
                      <span className="text-xs text-text-muted">
                        {searchQuery.trim()
                          ? 'No downloads match your search query.'
                          : activeTab !== 'all'
                            ? 'No downloads match the selected filter.'
                            : 'Start downloading videos or audio from the Downloader page.'}
                      </span>
                    </div>
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
          totalRecords={totalMatchingRecords}
          onPageChange={(page) => setCurrentPage(page)}
          onPageSizeChange={handlePageSizeChange}
          pageSizeOptions={[10, 20, 50]}
          recordLabel="downloads"
        />
      </div>
    </div>
  )
}
