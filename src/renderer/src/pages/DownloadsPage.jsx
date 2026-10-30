import { useState, useMemo } from 'react'
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
  Trash2
} from 'lucide-react'
import StatCard from '../components/ui/StatCard'
import FilterTabs from '../components/ui/FilterTabs'
import MediaThumbnail from '../components/ui/MediaThumbnail'
import PlatformBadge from '../components/ui/PlatformBadge'
import StatusBadge from '../components/ui/StatusBadge'
import { DOWNLOADS_MANAGER_STATS, DOWNLOADS_MANAGER_LIST } from '../data/uiPreviewData'

/**
 * Downloads Manager Page - Fully refined to match Reference Image 2.
 * Features:
 * - Search bar with filter icon
 * - 4 Metric Stat Cards (Downloading, Queued, Completed, Failed)
 * - Horizontal filter tabs with live item counts & Clear Completed action
 * - Downloads Queue table with live progress bars, platform badges, status indicators, and pause/cancel actions
 */
export default function DownloadsPage() {
  const [activeTab, setActiveTab] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [downloadsList, setDownloadsList] = useState(DOWNLOADS_MANAGER_LIST)

  // Filter items based on active tab and search query
  const filteredItems = useMemo(() => {
    return downloadsList.filter((item) => {
      // Tab filter
      if (activeTab === 'downloading' && item.status !== 'downloading') return false
      if (activeTab === 'queued' && item.status !== 'queued') return false
      if (activeTab === 'completed' && item.status !== 'completed') return false
      if (activeTab === 'failed' && item.status !== 'failed') return false

      // Search query filter
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase()
        const matchesTitle = item.title.toLowerCase().includes(query)
        const matchesPlatform = (item.platform || '').toLowerCase().includes(query)
        return matchesTitle || matchesPlatform
      }

      return true
    })
  }, [downloadsList, activeTab, searchQuery])

  const handleClearCompleted = () => {
    setDownloadsList((prev) => prev.filter((item) => item.status !== 'completed'))
  }

  const tabs = [
    { id: 'all', label: 'All', count: 18 },
    { id: 'downloading', label: 'Downloading', count: DOWNLOADS_MANAGER_STATS.downloading },
    { id: 'queued', label: 'Queued', count: DOWNLOADS_MANAGER_STATS.queued },
    { id: 'completed', label: 'Completed', count: DOWNLOADS_MANAGER_STATS.completed },
    { id: 'failed', label: 'Failed', count: DOWNLOADS_MANAGER_STATS.failed }
  ]

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] w-full mx-auto flex flex-col gap-6 select-none animate-fadeIn">
      {/* ----------------- TOP HEADER & SEARCH BAR ----------------- */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl lg:text-4xl font-extrabold text-white tracking-tight">
            Downloads Manager
          </h1>
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

      {/* ----------------- 4 STAT CARDS ROW ----------------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Loader2}
          count={DOWNLOADS_MANAGER_STATS.downloading}
          label="Downloading"
          accentColor="cyan"
          isActive={activeTab === 'downloading'}
          onClick={() => setActiveTab('downloading')}
        />
        <StatCard
          icon={Hourglass}
          count={DOWNLOADS_MANAGER_STATS.queued}
          label="Queued"
          accentColor="blue"
          isActive={activeTab === 'queued'}
          onClick={() => setActiveTab('queued')}
        />
        <StatCard
          icon={CheckCircle2}
          count={DOWNLOADS_MANAGER_STATS.completed}
          label="Completed"
          accentColor="green"
          isActive={activeTab === 'completed'}
          onClick={() => setActiveTab('completed')}
        />
        <StatCard
          icon={XCircle}
          count={DOWNLOADS_MANAGER_STATS.failed}
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
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-text-muted hover:text-white bg-[#07152E]/80 hover:bg-[#0B1C38] border border-primary/15 transition-all cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Completed</span>
          </button>
        }
      />

      {/* ----------------- DOWNLOADS QUEUE TABLE ----------------- */}
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
                const isFinalizing = item.status === 'finalizing'
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
                            {item.downloaded} / {item.total} {item.speed ? `• ${item.speed}` : ''}
                          </span>
                        </div>

                        {/* Progress Bar Track */}
                        <div className="w-full h-2 rounded-full bg-[#040B1C] overflow-hidden border border-primary/10">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isDownloading || isFinalizing
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
                      <StatusBadge status={item.status} subtitle={item.eta} />
                    </td>

                    {/* Action Buttons (Pause / Resume / Cancel) */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center justify-center gap-2">
                        {/* Play/Pause Button */}
                        {isDownloading && (
                          <button
                            type="button"
                            className="w-8 h-8 rounded-lg bg-[#040B1C] hover:bg-[#102449] border border-primary/20 flex items-center justify-center text-text-muted hover:text-white transition-all cursor-pointer"
                            title="Pause"
                          >
                            <Pause className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {isQueued && (
                          <button
                            type="button"
                            className="w-8 h-8 rounded-lg bg-[#040B1C] hover:bg-[#102449] border border-primary/20 flex items-center justify-center text-text-muted hover:text-white transition-all cursor-pointer"
                            title="Start Download"
                          >
                            <Play className="w-3.5 h-3.5 ml-0.5" />
                          </button>
                        )}

                        {isFinalizing && (
                          <button
                            disabled
                            className="w-8 h-8 rounded-lg bg-[#040B1C]/50 border border-primary/10 flex items-center justify-center text-text-muted/40 cursor-not-allowed"
                            title="Finalizing (Cannot pause)"
                          >
                            <Pause className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Cancel / Stop Button */}
                        <button
                          type="button"
                          disabled={isFinalizing}
                          className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-all ${
                            isFinalizing
                              ? 'bg-[#040B1C]/50 border-primary/10 text-text-muted/40 cursor-not-allowed'
                              : 'bg-[#040B1C] hover:bg-red-500/20 border-red-500/30 text-red-400 hover:text-red-300 cursor-pointer'
                          }`}
                          title="Cancel Download"
                        >
                          <Square className="w-3 h-3 fill-current" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}

              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-text-muted">
                    No downloads match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
