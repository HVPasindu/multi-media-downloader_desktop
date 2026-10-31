import { useState, useMemo, useEffect, useRef } from 'react'
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
  Download
} from 'lucide-react'
import StatCard from '../components/ui/StatCard'
import FilterTabs from '../components/ui/FilterTabs'
import MediaThumbnail from '../components/ui/MediaThumbnail'
import PlatformBadge from '../components/ui/PlatformBadge'
import StatusBadge from '../components/ui/StatusBadge'
import { listDownloads } from '../services/downloadsApi'
import { normalizeDownloadJob } from '../utils/downloadPresentation'

/**
 * Cleanly extracts secondary contextual subtitle from statusText without duplicating
 * the main status name (e.g. "Downloading (2m 45s left)" -> "2m 45s left").
 */
function getStatusSubtitle(statusText, status) {
  if (!statusText) return null
  const match = statusText.match(/\(([^)]+)\)/)
  if (match) return match[1]
  if (statusText.toLowerCase() === (status || '').toLowerCase()) return null
  return statusText
}

/**
 * Downloads Manager Page
 * Features:
 * - Search bar with filter icon
 * - 4 Metric Stat Cards (Downloading, Queued, Completed, Failed) calculated dynamically
 * - Horizontal filter tabs with live item counts & Clear Completed action
 * - Downloads Queue table with correct data bindings (progressText, formatted statusText)
 */
export default function DownloadsPage() {
  const [activeTab, setActiveTab] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [downloadsList, setDownloadsList] = useState([])
  const [isLoading, setIsLoading] = useState(true)

  const speedTrackerRef = useRef(new Map())
  const isPollingRef = useRef(false)
  const hasActiveRef = useRef(false)

  // Step 05.10: Controlled live polling using secure IPC bridge (listDownloads)
  useEffect(() => {
    let isMounted = true
    let timerId = null

    async function fetchJobs() {
      if (isPollingRef.current) return
      isPollingRef.current = true

      try {
        const response = await listDownloads({ limit: 50 })
        if (
          isMounted &&
          response.ok &&
          response.data?.success &&
          Array.isArray(response.data.data)
        ) {
          const normalized = response.data.data
            .map((job) => normalizeDownloadJob(job, speedTrackerRef.current))
            .filter(Boolean)
          hasActiveRef.current = normalized.some(
            (item) => item.status === 'downloading' || item.status === 'queued'
          )
          setDownloadsList(normalized)
        }
      } catch (err) {
        console.warn('Downloads polling error:', err)
      } finally {
        isPollingRef.current = false
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    // Initial immediate fetch
    fetchJobs()

    // Dynamic adaptive interval: 2s when active jobs exist, 8s when idle
    function scheduleNext() {
      const interval = hasActiveRef.current ? 2000 : 8000
      timerId = setTimeout(async () => {
        if (isMounted) {
          await fetchJobs()
          scheduleNext()
        }
      }, interval)
    }

    scheduleNext()

    return () => {
      isMounted = false
      if (timerId) clearTimeout(timerId)
    }
  }, [])

  // Dynamically calculate counts directly from real SQLite-backed records
  const downloadingCount = downloadsList.filter((item) => item.status === 'downloading').length
  const queuedCount = downloadsList.filter((item) => item.status === 'queued').length
  const completedCount = downloadsList.filter((item) => item.status === 'completed').length
  const failedCount = downloadsList.filter(
    (item) => item.status === 'failed' || item.status === 'cancelled'
  ).length
  const totalCount = downloadsList.length

  // Filter items based on active tab and search query
  const filteredItems = useMemo(() => {
    return downloadsList.filter((item) => {
      if (activeTab === 'downloading' && item.status !== 'downloading') return false
      if (activeTab === 'queued' && item.status !== 'queued') return false
      if (activeTab === 'completed' && item.status !== 'completed') return false
      if (activeTab === 'failed' && item.status !== 'failed' && item.status !== 'cancelled')
        return false

      // Search query filter
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase()
        const matchesTitle = (item.title || '').toLowerCase().includes(query)
        const matchesPlatform = (item.platform || '').toLowerCase().includes(query)
        return matchesTitle || matchesPlatform
      }

      return true
    })
  }, [downloadsList, activeTab, searchQuery])

  // Clear completed items notice (Destructive history actions belong to Step 05.12)
  const handleClearCompleted = () => {
    // Retain UI responsiveness while awaiting Step 05.12 history delete API integration
    setDownloadsList((prev) => prev.filter((item) => item.status !== 'completed'))
  }

  const tabs = [
    { id: 'all', label: 'All', count: totalCount },
    { id: 'downloading', label: 'Downloading', count: downloadingCount },
    { id: 'queued', label: 'Queued', count: queuedCount },
    { id: 'completed', label: 'Completed', count: completedCount },
    { id: 'failed', label: 'Failed', count: failedCount }
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
              onChange={(e) => setSearchQuery(e.target.value)}
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

      {/* ----------------- 4 STAT CARDS ROW (Problem 07: Dynamic Counts) ----------------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Loader2}
          count={downloadingCount}
          label="Downloading"
          accentColor="cyan"
          isActive={activeTab === 'downloading'}
          onClick={() => setActiveTab('downloading')}
        />
        <StatCard
          icon={Hourglass}
          count={queuedCount}
          label="Queued"
          accentColor="blue"
          isActive={activeTab === 'queued'}
          onClick={() => setActiveTab('queued')}
        />
        <StatCard
          icon={CheckCircle2}
          count={completedCount}
          label="Completed"
          accentColor="green"
          isActive={activeTab === 'completed'}
          onClick={() => setActiveTab('completed')}
        />
        <StatCard
          icon={XCircle}
          count={failedCount}
          label="Failed"
          accentColor="red"
          isActive={activeTab === 'failed'}
          onClick={() => setActiveTab('failed')}
        />
      </div>

      {/* ----------------- FILTER TABS & CLEAR COMPLETED ----------------- */}
      <FilterTabs
        tabs={tabs}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        rightAction={
          <button
            type="button"
            onClick={handleClearCompleted}
            disabled={completedCount === 0}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
              completedCount > 0
                ? 'text-text-muted hover:text-white bg-[#07152E]/80 hover:bg-[#0B1C38] border border-primary/15 cursor-pointer'
                : 'text-text-muted/40 bg-[#07152E]/40 border border-primary/10 cursor-not-allowed'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Completed</span>
          </button>
        }
      />

      {/* ----------------- DOWNLOADS QUEUE TABLE (Problem 01: Fixed Data Bindings) ----------------- */}
      <div className="rounded-2xl bg-[#07152E]/90 border border-primary/15 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md overflow-hidden">
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
              {filteredItems.map((item, idx) => {
                const isDownloading = item.status === 'downloading'
                const isQueued = item.status === 'queued'

                return (
                  <tr key={item.id} className="hover:bg-[#0B1C38]/40 transition-colors group">
                    {/* Index */}
                    <td className="py-3.5 px-4 text-center text-text-muted/70 font-mono text-xs">
                      {idx + 1}
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
                              isDownloading
                                ? 'bg-gradient-to-r from-[#19D8FF] to-[#3388FF]'
                                : 'bg-primary/20'
                            }`}
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Status Column with animated spinner, gear, or hourglass */}
                    <td className="py-3.5 px-4">
                      <StatusBadge
                        status={item.status}
                        subtitle={getStatusSubtitle(item.statusText, item.status)}
                      />
                    </td>

                    {/* Action Buttons (Disabled pending Step 05.11 implementation) */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center justify-center gap-2">
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

                        {/* Cancel / Stop Button */}
                        <button
                          type="button"
                          disabled
                          className="w-8 h-8 rounded-lg border bg-[#040B1C]/50 border-primary/10 text-text-muted/40 flex items-center justify-center cursor-not-allowed"
                          title="Cancel download will be connected in Step 05.11"
                        >
                          <Square className="w-3 h-3 fill-current" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}

              {downloadsList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-text-muted">
                    <div className="flex flex-col items-center justify-center gap-2 select-none">
                      <Download className="w-8 h-8 text-text-muted/40" />
                      <span className="text-sm font-semibold text-white">No downloads found</span>
                      <span className="text-xs text-text-muted">
                        {isLoading
                          ? 'Loading active and completed downloads...'
                          : 'Start downloading videos or audio from the Downloader page.'}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-text-muted">
                    No downloads match the current filter.
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
