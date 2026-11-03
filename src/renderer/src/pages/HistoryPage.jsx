import { useState, useMemo } from 'react'
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
  MoreVertical
} from 'lucide-react'
import StatCard from '../components/ui/StatCard'
import FilterTabs from '../components/ui/FilterTabs'
import MediaThumbnail from '../components/ui/MediaThumbnail'
import PlatformBadge from '../components/ui/PlatformBadge'
import StatusBadge from '../components/ui/StatusBadge'
import { HISTORY_LIST } from '../data/uiPreviewData'

/**
 * Extracts a clean subtitle from statusText without repeating the main status label
 * (e.g. "Failed (File Missing)" -> "File Missing").
 */
function getStatusSubtitle(statusText, status) {
  if (!statusText) return null
  const match = statusText.match(/\(([^)]+)\)/)
  if (match) return match[1]
  if (statusText.toLowerCase() === (status || '').toLowerCase()) return null
  return statusText
}

/**
 * Download History Page
 * Features:
 * - Top Search Bar with filter control
 * - 4 Summary Cards (Total Files, Videos, Audio, Storage Used) dynamically calculated
 * - Filter tabs (All, Videos, Audio, Completed, Failed) + Red Clear History button
 * - Comprehensive history table with row checkboxes, thumbnails, platform icons,
 *   format/quality pills, file sizes (Problem 02), timestamps, statuses, and action buttons.
 */
export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [historyItems, setHistoryItems] = useState(HISTORY_LIST)

  // Problem 07: Compute summary metrics dynamically from the preview dataset
  const totalFiles = historyItems.length
  const videosCount = historyItems.filter((item) => item.format === 'MP4').length
  const audioCount = historyItems.filter((item) => item.format === 'MP3').length
  const completedCount = historyItems.filter((item) => item.status === 'completed').length
  const failedCount = historyItems.filter((item) => item.status === 'failed').length
  const storageUsed = historyItems.length > 0 ? '2.6 GB' : '0 B'

  // Filter history items by tab and search query
  const filteredItems = useMemo(() => {
    return historyItems.filter((item) => {
      // Tab filter
      if (activeTab === 'videos' && item.format !== 'MP4') return false
      if (activeTab === 'audio' && item.format !== 'MP3') return false
      if (activeTab === 'completed' && item.status !== 'completed') return false
      if (activeTab === 'failed' && item.status !== 'failed') return false

      // Search query filter
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase()
        const matchesTitle = item.title.toLowerCase().includes(query)
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

  // Clear history and reset selection consistently
  const handleClearHistory = () => {
    setHistoryItems([])
    setSelectedIds([])
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
            <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 uppercase">
              Preview
            </span>
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

      {/* ----------------- 4 SUMMARY CARDS ROW (Problem 07: Dynamic Counts) ----------------- */}
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
            <span>Clear History</span>
          </button>
        }
      />

      {/* ----------------- DOWNLOAD HISTORY TABLE (Problem 02: Fixed Properties) ----------------- */}
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
                const isFailed = item.status === 'failed'

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

                    {/* File Size (Problem 02: Fixed property binding to item.fileSize) */}
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

                    {/* Status Badge (Problem 02: clean subtitle e.g. "File Missing") */}
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
                            className="w-7 h-7 rounded-lg bg-[#040B1C] hover:bg-[#102449] border border-primary/20 flex items-center justify-center text-text-muted hover:text-white transition-all cursor-pointer"
                            title="Retry download"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="w-7 h-7 rounded-lg bg-[#040B1C] hover:bg-[#102449] border border-primary/20 flex items-center justify-center text-text-muted hover:text-white transition-all cursor-pointer"
                            title="Play media"
                          >
                            <Play className="w-3.5 h-3.5 ml-0.5" />
                          </button>
                        )}

                        {/* Open Folder Button */}
                        <button
                          type="button"
                          className="w-7 h-7 rounded-lg bg-[#040B1C] hover:bg-[#102449] border border-primary/20 flex items-center justify-center text-text-muted hover:text-white transition-all cursor-pointer"
                          title="Open enclosing folder"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                        </button>

                        {/* More Options */}
                        <button
                          type="button"
                          className="w-6 h-7 flex items-center justify-center text-text-muted/60 hover:text-white cursor-pointer"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}

              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-text-muted">
                    No history records match the current filter.
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
