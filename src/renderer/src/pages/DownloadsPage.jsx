import { ListCollapse, Clock } from 'lucide-react'

/**
 * Downloads Manager Page Placeholder (Step 05.00)
 * Will be fully implemented with active queue controls and progress in Steps 05.06–05.08.
 */
export default function DownloadsPage() {
  return (
    <div className="p-8 max-w-6xl w-full mx-auto flex flex-col gap-6 select-none animate-fadeIn">
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Downloads Manager</h1>
        <p className="text-sm text-text-muted mt-1">
          Manage your active, queued, and completed downloads.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center p-16 rounded-2xl bg-[#07152E]/50 border border-primary/10 text-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-surface flex items-center justify-center text-primary border border-primary/20">
          <ListCollapse className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-white">Downloads Manager Standby</h2>
        <p className="text-xs text-text-muted max-w-md">
          The download queue interface and real-time progress tracking will be implemented in Step
          05.06.
        </p>
        <div className="flex items-center gap-1.5 text-xs text-primary/80 bg-primary/10 px-3 py-1.5 rounded-full mt-2">
          <Clock className="w-3.5 h-3.5" />
          <span>Scheduled for Roadmap Step 05.06</span>
        </div>
      </div>
    </div>
  )
}
