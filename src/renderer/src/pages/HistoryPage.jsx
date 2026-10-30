import { History, Clock } from 'lucide-react'

/**
 * Download History Page Placeholder (Step 05.00)
 * Will be fully implemented with filtering, search, and file preservation in Steps 05.09–05.11.
 */
export default function HistoryPage() {
  return (
    <div className="p-8 max-w-6xl w-full mx-auto flex flex-col gap-6 select-none animate-fadeIn">
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Download History</h1>
        <p className="text-sm text-text-muted mt-1">
          Review, manage, and reopen your previously downloaded media.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center p-16 rounded-2xl bg-[#07152E]/50 border border-primary/10 text-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-surface flex items-center justify-center text-primary border border-primary/20">
          <History className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-white">Download History Standby</h2>
        <p className="text-xs text-text-muted max-w-md">
          Download history records, search, filtering, and folder opening will be connected in Step
          05.09.
        </p>
        <div className="flex items-center gap-1.5 text-xs text-primary/80 bg-primary/10 px-3 py-1.5 rounded-full mt-2">
          <Clock className="w-3.5 h-3.5" />
          <span>Scheduled for Roadmap Step 05.09</span>
        </div>
      </div>
    </div>
  )
}
