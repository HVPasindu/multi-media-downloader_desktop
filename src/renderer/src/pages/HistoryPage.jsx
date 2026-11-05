import { useState, useMemo, useEffect, useCallback } from 'react'
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
import {
  listDownloads,
  deleteDownloadHistory,
  clearDownloadHistory,
  retryDownload
} from '../services/downloadsApi'
import { normalizeDownloadJob, formatBytes } from '../utils/downloadPresentation'
import { showConfirm, showToast, showError } from '../utils/notificationService'

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
  const [selectedIds, setSelectedIds] = useState([])
  const [historyItems, setHistoryItems] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [retryingJobId, setRetryingJobId] = useState(null)

  const fetchHistory = useCallback(async () => {
    try {
      const res = await listDownloads({ limit: 100 })
      if (res.ok && res.data?.success && Array.isArray(res.data.data)) {
        // Only terminal records in history: completed, failed, cancelled
        const terminalRecords = res.data.data
          .filter((job) => ['completed', 'failed', 'cancelled'].includes(job.status))
          .map((job) => {
            const normalized = normalizeDownloadJob(job)
            return {
              ...normalized,
              savedTo: normalized.filePath || '—',
              date: formatHistoryDate(normalized.createdAt)
            }
          })
        setHistoryItems(terminalRecords)
        setError(null)
      } else {
        setError(res.data?.message || 'Failed to load download history.')
      }
    } catch (err) {
      console.warn('History fetch error:', err)
      setError('Unable to load history. Please retry.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadHistory() {
      await fetchHistory()
    }

    void loadHistory()

    const onStateChanged = () => {
      if (isMounted) {
        void fetchHistory()
      }
    }

    window.addEventListener('applan2:download-state-changed', onStateChanged)
    return () => {
      isMounted = false
      window.removeEventListener('applan2:download-state-changed', onStateChanged)
    }
  }, [fetchHistory])

  // Dynamic summary metrics calculated strictly from SQLite records
  const totalFiles = historyItems.length
  const videosCount = historyItems.filter((item) => item.format === 'MP4').length
  const audioCount = historyItems.filter((item) => item.format === 'MP3').length
  const completedCount = historyItems.filter((item) => item.status === 'completed').length
  const failedCount = historyItems.filter(
    (item) => item.status === 'failed' || item.status === 'cancelled'
  ).length

  const totalStorageBytes = historyItems
    .filter((item) => item.status === 'completed' && item.fileBytes)
    .reduce((sum, item) => sum + item.fileBytes, 0)
  const storageUsed = totalStorageBytes > 0 ? formatBytes(totalStorageBytes) : '—'

  // Filter history items by tab and search query
  const filteredItems = useMemo(() => {
    return historyItems.filter((item) => {
      // Tab filter
      if (activeTab === 'videos' && item.format !== 'MP4') return false
      if (activeTab === 'audio' && item.format !== 'MP3') return false
      if (activeTab === 'completed' && item.status !== 'completed') return false
      if (activeTab === 'failed' && item.status !== 'failed' && item.status !== 'cancelled')
        return false

      // Search query filter
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase()
        const matchesTitle = (item.title || '').toLowerCase().includes(query)
        const matchesPlatform = (item.platform || '').toLowerCase().includes(query)
        const matchesPath = (item.savedTo || '').toLowerCase().includes(query)
        return matchesTitle || matchesPlatform || matchesPath
      }

      return true
    })
  }, [historyItems, activeTab, searchQuery])

  // Toggle select all
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(filteredItems.map((item) => item.id))
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
        } else {
          showError('Delete Failed', 'Failed to delete selected records.')
        }
      } catch (err) {
        showError('Delete Failed', err?.message || 'An unexpected error occurred.')
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
      } else {
        showError('Clear Failed', res.data?.message || 'Failed to clear download history.')
      }
    } catch (err) {
      showError('Clear Failed', err?.message || 'An unexpected error occurred.')
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
      } else {
        showError('Delete Failed', res.data?.message || 'Failed to delete record.')
      }
    } catch (err) {
      showError('Delete Error', err?.message || 'An unexpected error occurred.')
    }
  }

  // Retry a failed or cancelled record
  const handleRetryRecord = async (id) => {
    try {
      setRetryingJobId(id)
      const res = await retryDownload(id)
      if (res.ok && res.status === 201) {
        showToast('Download queued for retry', 'success')
        fetchHistory()
      } else {
        showError('Retry Failed', res.data?.message || 'Failed to retry download')
      }
    } catch (err) {
      showError('Retry Error', err?.message || 'An unexpected error occurred while retrying.')
    } finally {
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

  const isAllSelected = filteredItems.length > 0 && selectedIds.length === filteredItems.length

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] w-full mx-auto flex flex-col gap-6 select-none animate-fadeIn">
      {/* ----------------- TOP HEADER & SEARCH BAR ----------------- */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl lg:text-4xl font-extrabold text-white tracking-tight">
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
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search history..."
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

      {/* ----------------- 4 SUMMARY CARDS ROW (Dynamic Counts) ----------------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={FileText}
          count={totalFiles}
          label="Total Files"
          accentColor="blue"
          isActive={activeTab === 'all'}
          onClick={() => setActiveTab('all')}
        />
        <StatCard
          icon={Video}
          count={videosCount}
          label="Videos"
          accentColor="purple"
          isActive={activeTab === 'videos'}
          onClick={() => setActiveTab('videos')}
        />
        <StatCard
          icon={Music}
          count={audioCount}
          label="Audio"
          accentColor="cyan"
          isActive={activeTab === 'audio'}
          onClick={() => setActiveTab('audio')}
        />
        <StatCard icon={HardDrive} count={storageUsed} label="Storage Used" accentColor="cyan" />
      </div>

      {/* ----------------- FILTER TABS & CLEAR HISTORY ----------------- */}
      <FilterTabs
        tabs={tabs}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
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
      <div className="rounded-2xl bg-[#07152E]/90 border border-primary/15 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[980px]">
            {/* Table Header */}
            <thead>
              <tr className="border-b border-primary/15 text-[11px] font-bold text-text-muted uppercase tracking-wider bg-[#040B1C]/60">
                <th className="py-3.5 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleSelectAll}
                    disabled={filteredItems.length === 0}
                    className="rounded border-primary/30 bg-[#040B1C] text-primary focus:ring-primary/40 cursor-pointer"
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
              {filteredItems.map((item, idx) => {
                const isSelected = selectedIds.includes(item.id)
                const isFailed = item.status === 'failed' || item.status === 'cancelled'

                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-[#0B1C38]/40 transition-colors group ${
                      isSelected ? 'bg-[#0B1C38]/60' : ''
                    }`}
                  >
                    {/* Row Checkbox */}
                    <td className="py-3 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleItem(item.id)}
                        className="rounded border-primary/30 bg-[#040B1C] text-primary focus:ring-primary/40 cursor-pointer"
                      />
                    </td>

                    {/* Row Index */}
                    <td className="py-3 px-3 text-center text-text-muted/70 font-mono text-xs">
                      {idx + 1}
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
                                : 'text-white group-hover:text-[#19D8FF]'
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
                            ? 'bg-cyan-500/15 text-[#19D8FF] border border-cyan-500/30'
                            : 'bg-emerald-500/15 text-[#00DEA5] border border-emerald-500/30'
                        }`}
                      >
                        {item.format}
                      </span>
                    </td>

                    {/* Quality / Bitrate */}
                    <td className="py-3 px-4">
                      <span className="inline-block px-2.5 py-0.5 rounded text-[11px] font-bold bg-[#102449] text-text-muted border border-primary/20">
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
                        {/* Play or Retry Button */}
                        {isFailed ? (
                          <button
                            type="button"
                            onClick={() => handleRetryRecord(item.id)}
                            disabled={retryingJobId === item.id}
                            className="w-7 h-7 rounded-lg bg-[#040B1C] hover:bg-[#102449] border border-primary/20 flex items-center justify-center text-text-muted hover:text-[#19D8FF] transition-all cursor-pointer"
                            title="Retry download"
                          >
                            <RotateCcw
                              className={`w-3.5 h-3.5 ${retryingJobId === item.id ? 'animate-spin' : ''}`}
                            />
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="w-7 h-7 rounded-lg bg-[#040B1C]/50 border border-primary/10 flex items-center justify-center text-text-muted/40 cursor-not-allowed"
                            title="Play media"
                          >
                            <Play className="w-3.5 h-3.5 ml-0.5" />
                          </button>
                        )}

                        {/* Open Folder Button */}
                        <button
                          type="button"
                          disabled
                          className="w-7 h-7 rounded-lg bg-[#040B1C]/50 border border-primary/10 flex items-center justify-center text-text-muted/40 cursor-not-allowed"
                          title="Open enclosing folder"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete Single Record Button */}
                        <button
                          type="button"
                          onClick={() => handleDeleteRecord(item.id)}
                          className="w-7 h-7 rounded-lg bg-[#040B1C] hover:bg-[#102449] border border-primary/20 flex items-center justify-center text-text-muted hover:text-red-400 transition-all cursor-pointer"
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
                      <Loader2 className="w-8 h-8 text-[#19D8FF] animate-spin" />
                      <span className="text-sm font-semibold text-white">Loading history...</span>
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
                      <span className="text-sm font-semibold text-white">
                        Failed to load history
                      </span>
                      <span className="text-xs text-text-muted max-w-md">{error}</span>
                      <button
                        type="button"
                        onClick={fetchHistory}
                        className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#07152E] hover:bg-[#0B1C38] border border-primary/20 hover:border-[#19D8FF]/40 transition-all cursor-pointer shadow-md"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-[#19D8FF]" />
                        <span>Retry</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : historyItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-text-muted">
                    No download history found. Completed and failed downloads will appear here.
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-text-muted">
                    No history records match the current filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
