import { useState } from 'react'
import {
  Zap,
  ShieldCheck,
  Globe2,
  Link2,
  Search,
  X,
  Video,
  Music,
  FolderOpen,
  Download,
  Trash2,
  Pause,
  Play,
  MoreVertical,
  CheckCircle2,
  Clock,
  CloudUpload
} from 'lucide-react'
import DownloaderHeroIllustration from '../components/ui/DownloaderHeroIllustration'
import MediaThumbnail from '../components/ui/MediaThumbnail'
import PlatformBadge from '../components/ui/PlatformBadge'
import { DOWNLOADER_MEDIA_PREVIEW, RECENT_DOWNLOADS_LIST } from '../data/uiPreviewData'

/**
 * Downloader Page - Fully refined to match Reference Image 1.
 * Features:
 * - Branded Header with feature pills & 3D hero pedestal illustration
 * - Two-column responsive desktop layout (1200x780 target)
 * - Section 1: Link input with Clear and Analyze action + Active Media Preview Card
 * - Section 2: Choose Format (MP4 Video / MP3 Audio selectable cards)
 * - Section 3 & 4: Video Quality & Audio Bitrate option pills
 * - Section 5: Download Folder destination selector with Choose button
 * - Radiant full-width Download CTA button
 * - Right Column: Recent Downloads card with live progress, pause/play, folder action & Drag-and-Drop dropzone
 */
export default function DownloaderPage() {
  const [url, setUrl] = useState('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  const [selectedFormat, setSelectedFormat] = useState('mp4')
  const [selectedVideoQuality, setSelectedVideoQuality] = useState('1080p')
  const [selectedAudioBitrate, setSelectedAudioBitrate] = useState('192k')
  const [downloadFolder, setDownloadFolder] = useState(
    'C:\\Users\\Alex\\Downloads\\Multi Media Downloader'
  )
  const [recentDownloads, setRecentDownloads] = useState(RECENT_DOWNLOADS_LIST)

  const handleClearUrl = () => {
    setUrl('')
  }

  const handleClearRecent = () => {
    setRecentDownloads([])
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] w-full mx-auto flex flex-col gap-6 select-none animate-fadeIn">
      {/* ----------------- TOP HEADER & HERO ILLUSTRATION ----------------- */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl lg:text-4xl font-extrabold text-white tracking-tight">
            Downloader
          </h1>
          <p className="text-sm text-text-muted mt-1 font-medium">
            Paste a link, choose your options, and download your media.
          </p>

          {/* Feature Badges */}
          <div className="flex flex-wrap items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#19D8FF]">
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>Fast & Reliable</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#19D8FF]">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>High Quality</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#19D8FF]">
              <Globe2 className="w-3.5 h-3.5" />
              <span>Supports Multiple Platforms</span>
            </div>
          </div>
        </div>

        {/* 3D Pedestal Hero Art (Matching Reference Image 1) */}
        <DownloaderHeroIllustration className="hidden md:flex flex-shrink-0" />
      </div>

      {/* ----------------- MAIN TWO-COLUMN LAYOUT ----------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ================= LEFT COLUMN: DOWNLOAD OPTIONS (7 COLS) ================= */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          {/* Section 1: Enter Media Link & Media Preview */}
          <div className="p-5 lg:p-6 rounded-2xl bg-[#07152E]/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-extrabold text-white tracking-wide">
                1. Enter Media Link
              </h2>
            </div>

            {/* Input Bar */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1 flex items-center">
                <Link2 className="absolute left-3.5 w-4 h-4 text-text-muted/70" />
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste YouTube, TikTok, Instagram, Facebook or X link here..."
                  className="w-full bg-[#040B1C] border border-primary/20 rounded-xl py-3 pl-10 pr-9 text-xs font-medium text-white placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 transition-all font-mono"
                />
                {url && (
                  <button
                    onClick={handleClearUrl}
                    className="absolute right-3 p-1 text-text-muted/60 hover:text-white transition-colors"
                    title="Clear link"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Analyze Button */}
              <button
                type="button"
                className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-xs bg-gradient-to-r from-[#19D8FF] to-[#3388FF] text-white shadow-[0_0_16px_rgba(25,216,255,0.35)] hover:shadow-[0_0_24px_rgba(25,216,255,0.55)] transition-all cursor-pointer flex-shrink-0"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Analyze</span>
              </button>
            </div>

            {/* Analyzed Media Preview Card */}
            {DOWNLOADER_MEDIA_PREVIEW && (
              <div className="flex flex-col sm:flex-row items-center gap-4 p-3.5 rounded-xl bg-[#040B1C]/80 border border-primary/15">
                <div className="w-full sm:w-44 flex-shrink-0">
                  <MediaThumbnail
                    src={DOWNLOADER_MEDIA_PREVIEW.thumbnail}
                    duration={DOWNLOADER_MEDIA_PREVIEW.duration}
                    showPlayOverlay={true}
                    aspectRatio="aspect-video"
                  />
                </div>

                <div className="flex-1 flex flex-col justify-center min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">
                    {DOWNLOADER_MEDIA_PREVIEW.title}
                  </h3>
                  <div className="mt-1">
                    <PlatformBadge platform={DOWNLOADER_MEDIA_PREVIEW.platform} />
                  </div>
                  <p className="text-xs text-text-muted/80 mt-1.5 line-clamp-2 leading-relaxed">
                    {DOWNLOADER_MEDIA_PREVIEW.description}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Choose Format */}
          <div className="flex flex-col gap-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
              2. Choose Format
            </h2>
            <div className="grid grid-cols-2 gap-3.5">
              {/* MP4 Video Option */}
              <button
                type="button"
                onClick={() => setSelectedFormat('mp4')}
                className={`flex items-center justify-between p-4 rounded-2xl border transition-all text-left cursor-pointer ${
                  selectedFormat === 'mp4'
                    ? 'bg-[#0B1C38] border-cyan-400 shadow-[0_0_20px_rgba(25,216,255,0.3)]'
                    : 'bg-[#07152E]/80 border-primary/15 hover:border-primary/30'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      selectedFormat === 'mp4'
                        ? 'bg-cyan-500/20 text-[#19D8FF]'
                        : 'bg-surface text-text-muted'
                    }`}
                  >
                    <Video className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-sm font-extrabold text-white block">MP4</span>
                    <span className="text-[11px] text-text-muted">Video (Best Quality)</span>
                  </div>
                </div>

                {/* Radio Indicator */}
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedFormat === 'mp4'
                      ? 'border-[#19D8FF] bg-[#040B1C]'
                      : 'border-text-muted/40'
                  }`}
                >
                  {selectedFormat === 'mp4' && (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#19D8FF]" />
                  )}
                </div>
              </button>

              {/* MP3 Audio Option */}
              <button
                type="button"
                onClick={() => setSelectedFormat('mp3')}
                className={`flex items-center justify-between p-4 rounded-2xl border transition-all text-left cursor-pointer ${
                  selectedFormat === 'mp3'
                    ? 'bg-[#0B1C38] border-cyan-400 shadow-[0_0_20px_rgba(25,216,255,0.3)]'
                    : 'bg-[#07152E]/80 border-primary/15 hover:border-primary/30'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      selectedFormat === 'mp3'
                        ? 'bg-cyan-500/20 text-[#19D8FF]'
                        : 'bg-surface text-text-muted'
                    }`}
                  >
                    <Music className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-sm font-extrabold text-white block">MP3</span>
                    <span className="text-[11px] text-text-muted">Audio Only</span>
                  </div>
                </div>

                {/* Radio Indicator */}
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedFormat === 'mp3'
                      ? 'border-[#19D8FF] bg-[#040B1C]'
                      : 'border-text-muted/40'
                  }`}
                >
                  {selectedFormat === 'mp3' && (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#19D8FF]" />
                  )}
                </div>
              </button>
            </div>
          </div>

          {/* Section 3 & 4: Quality & Bitrate Side by Side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 3. Video Quality */}
            <div className="flex flex-col gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                3. Video Quality
              </h2>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: '720p', title: '720p', sub: 'HD' },
                  { id: '1080p', title: '1080p', sub: 'Full HD' },
                  { id: 'best', title: 'Best', sub: 'Available 👑' }
                ].map((q) => {
                  const isSel = selectedVideoQuality === q.id
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setSelectedVideoQuality(q.id)}
                      className={`py-2.5 px-2 rounded-xl text-center border transition-all cursor-pointer ${
                        isSel
                          ? 'bg-[#0B1C38] border-cyan-400 text-white shadow-[0_0_14px_rgba(25,216,255,0.3)]'
                          : 'bg-[#07152E]/80 border-primary/15 text-text-muted hover:border-primary/30 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-extrabold">{q.title}</div>
                      <div className="text-[10px] text-text-muted/80">{q.sub}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 4. Audio Bitrate */}
            <div className="flex flex-col gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                4. Audio Bitrate (for MP3)
              </h2>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: '128k', label: '128', unit: 'kbps' },
                  { id: '192k', label: '192', unit: 'kbps' },
                  { id: '320k', label: '320', unit: 'kbps' }
                ].map((b) => {
                  const isSel = selectedAudioBitrate === b.id
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelectedAudioBitrate(b.id)}
                      className={`py-2.5 px-2 rounded-xl text-center border transition-all cursor-pointer ${
                        isSel
                          ? 'bg-[#0B1C38] border-cyan-400 text-white shadow-[0_0_14px_rgba(25,216,255,0.3)]'
                          : 'bg-[#07152E]/80 border-primary/15 text-text-muted hover:border-primary/30 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-extrabold">{b.label}</div>
                      <div className="text-[10px] text-text-muted/80">{b.unit}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Section 5: Download Folder Destination */}
          <div className="flex flex-col gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
              5. Download Folder
            </h2>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 flex items-center">
                <FolderOpen className="absolute left-3.5 w-4 h-4 text-text-muted" />
                <input
                  type="text"
                  value={downloadFolder}
                  onChange={(e) => setDownloadFolder(e.target.value)}
                  className="w-full bg-[#040B1C] border border-primary/20 rounded-xl py-2.5 pl-10 pr-3 text-xs text-text-muted font-mono focus:outline-none focus:border-primary"
                />
              </div>
              <button
                type="button"
                className="px-4 py-2.5 rounded-xl text-xs font-bold bg-[#07152E] hover:bg-[#0B1C38] border border-primary/25 text-white transition-all cursor-pointer"
              >
                Choose...
              </button>
            </div>
          </div>

          {/* Big Download Button */}
          <button
            type="button"
            className="w-full py-4 rounded-2xl font-black text-sm lg:text-base tracking-wide bg-gradient-to-r from-[#19D8FF] via-[#3388FF] to-[#514BFF] text-white shadow-[0_0_28px_rgba(25,216,255,0.45)] hover:shadow-[0_0_36px_rgba(25,216,255,0.65)] hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2.5 cursor-pointer mt-1"
          >
            <Download className="w-5 h-5 stroke-[2.5]" />
            <span>Download</span>
          </button>
        </div>

        {/* ================= RIGHT COLUMN: RECENT DOWNLOADS & DROPZONE (5 COLS) ================= */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Recent Downloads Card */}
          <div className="p-5 rounded-2xl bg-[#07152E]/90 border border-primary/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-primary/10">
              <h2 className="text-sm font-extrabold text-white">Recent Downloads</h2>
              <button
                type="button"
                onClick={handleClearRecent}
                className="flex items-center gap-1 text-[11px] font-semibold text-text-muted hover:text-white transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear All</span>
              </button>
            </div>

            {/* List of 5 items matching Reference Image 1 */}
            <div className="flex flex-col gap-3">
              {recentDownloads.map((item) => {
                const isDownloading = item.status === 'downloading'
                const isPaused = item.status === 'paused'

                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-2.5 rounded-xl bg-[#040B1C]/70 border border-primary/10 hover:border-primary/25 transition-all"
                  >
                    {/* Thumbnail */}
                    <div className="w-16 h-11 flex-shrink-0">
                      <MediaThumbnail
                        src={item.thumbnail}
                        duration={item.duration}
                        aspectRatio="aspect-video"
                      />
                    </div>

                    {/* Metadata & Progress */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-white truncate block">
                          {item.title}
                        </span>
                      </div>

                      <div className="text-[10px] text-text-muted mt-0.5">
                        {item.format} • {item.quality} • {item.fileSize || item.size}
                      </div>

                      {/* Downloading state: active progress bar */}
                      {isDownloading && (
                        <div className="mt-1.5 flex flex-col gap-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-[#19D8FF] font-semibold">
                              {item.statusText || `Downloading... ${item.progress}%`}
                            </span>
                            <span className="text-white font-bold">{item.progress}%</span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-[#0B1C38] overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-[#19D8FF] to-[#3388FF] rounded-full"
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Completed state */}
                      {item.status === 'completed' && (
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#00DEA5] font-semibold">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{item.statusText || 'Completed'}</span>
                        </div>
                      )}

                      {/* Paused state */}
                      {isPaused && (
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-purple-400 font-semibold">
                          <Clock className="w-3 h-3" />
                          <span>{item.statusText || 'Paused'}</span>
                        </div>
                      )}
                    </div>

                    {/* Quick Action Button */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isDownloading && (
                        <button
                          type="button"
                          className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center text-text-muted hover:text-white border border-primary/10 cursor-pointer"
                          title="Pause"
                        >
                          <Pause className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {isPaused && (
                        <button
                          type="button"
                          className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center text-text-muted hover:text-white border border-primary/10 cursor-pointer"
                          title="Resume"
                        >
                          <Play className="w-3.5 h-3.5 ml-0.5" />
                        </button>
                      )}

                      {item.status === 'completed' && (
                        <button
                          type="button"
                          className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center text-text-muted hover:text-white border border-primary/10 cursor-pointer"
                          title="Open Folder"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        type="button"
                        className="w-7 h-8 flex items-center justify-center text-text-muted/60 hover:text-white cursor-pointer"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Drag & Drop Link Dropzone (Matching Reference Image 1) */}
          <div className="p-4 rounded-2xl border-2 border-dashed border-primary/30 bg-[#07152E]/50 flex flex-col items-center justify-center text-center gap-1.5 py-5 hover:border-primary/60 hover:bg-[#07152E]/70 transition-all cursor-pointer">
            <CloudUpload className="w-7 h-7 text-[#19D8FF]" />
            <span className="text-xs font-bold text-white tracking-wide">
              Drag & drop a link here
            </span>
            <span className="text-[10px] text-text-muted">
              Supports YouTube, TikTok, Instagram, Facebook, and more...
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
