import { Zap, ShieldCheck, Globe, Link2, Search, Info } from 'lucide-react'

/**
 * Downloader Page Foundation (Step 05.00)
 * Visual foundation adhering to Reference Image 2.
 * Interactive download controls and real media analysis will be wired in Steps 05.01–05.05.
 */
export default function DownloaderPage() {
  return (
    <div className="p-8 max-w-6xl w-full mx-auto flex flex-col gap-6 select-none animate-fadeIn">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Downloader</h1>
        <p className="text-sm text-text-muted mt-1">
          Paste a link, choose your options, and download your media.
        </p>

        {/* Feature Badges */}
        <div className="flex flex-wrap items-center gap-4 mt-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <Zap className="w-3.5 h-3.5" />
            <span>Fast & Reliable</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>High Quality</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <Globe className="w-3.5 h-3.5" />
            <span>Supports 5 Platforms (YouTube, FB, IG, TikTok, X)</span>
          </div>
        </div>
      </div>

      {/* Roadmap Milestone Foundation Notice */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-surface/50 border border-primary/20 text-xs text-text-muted">
        <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-white">Step 05.00 Frontend Foundation Active: </span>
          The desktop branding, theme tokens, Electron IPC bridge, and startup splash screen are
          verified. The interactive Link Paste Downloader form and live media analyzer will be
          activated in Step 05.01.
        </div>
      </div>

      {/* Step 1 Preview Card: Enter Media Link */}
      <div className="p-6 rounded-2xl bg-[#07152E]/70 border border-primary/15 shadow-[0_4px_24px_rgba(0,0,0,0.3)] backdrop-blur-md">
        <h2 className="text-sm font-bold text-white mb-3">1. Enter Media Link</h2>
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Link2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              readOnly
              placeholder="https://www.youtube.com/watch?v=... (Step 05.01)"
              className="w-full bg-[#040B1C]/80 border border-primary/20 rounded-xl py-3 pl-10 pr-4 text-sm text-text-muted cursor-not-allowed focus:outline-none"
            />
          </div>
          <button
            disabled
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm bg-primary/20 text-primary border border-primary/30 cursor-not-allowed opacity-70"
          >
            <Search className="w-4 h-4" />
            <span>Analyze</span>
          </button>
        </div>
      </div>

      {/* Step 2 & 3 Placeholder Panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 opacity-75">
        <div className="p-6 rounded-2xl bg-[#07152E]/70 border border-primary/10">
          <h2 className="text-sm font-bold text-white mb-2">2. Choose Format</h2>
          <p className="text-xs text-text-muted">
            MP4 Video & MP3 Audio format selectors will be rendered here.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-[#07152E]/70 border border-primary/10">
          <h2 className="text-sm font-bold text-white mb-2">3. Download Preferences</h2>
          <p className="text-xs text-text-muted">
            Quality selector and custom download destination options.
          </p>
        </div>
      </div>
    </div>
  )
}
