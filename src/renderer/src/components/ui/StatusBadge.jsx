import { Loader2, Settings, Hourglass, CheckCircle2, XCircle, PauseCircle } from 'lucide-react'

/**
 * Status Badge Component for Queue & History tables
 * Displays animated spinners, icons, labels, and secondary context (ETA / reason).
 */
export default function StatusBadge({ status, subtitle = null }) {
  const norm = (status || '').toLowerCase()

  if (norm === 'downloading') {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="w-4 h-4 text-[#19D8FF] animate-spin flex-shrink-0" />
        <div className="flex flex-col">
          <span className="text-xs font-bold text-[#19D8FF]">Downloading</span>
          {subtitle && <span className="text-[11px] text-text-muted">{subtitle}</span>}
        </div>
      </div>
    )
  }

  if (norm === 'finalizing') {
    return (
      <div className="flex items-center gap-2">
        <Settings className="w-4 h-4 text-amber-400 animate-spin flex-shrink-0" />
        <div className="flex flex-col">
          <span className="text-xs font-bold text-amber-400">Finalizing</span>
          {subtitle && <span className="text-[11px] text-text-muted">{subtitle}</span>}
        </div>
      </div>
    )
  }

  if (norm === 'queued') {
    return (
      <div className="flex items-center gap-2">
        <Hourglass className="w-4 h-4 text-blue-400 flex-shrink-0" />
        <div className="flex flex-col">
          <span className="text-xs font-bold text-blue-400">Queued</span>
          {subtitle && <span className="text-[11px] text-text-muted">{subtitle}</span>}
        </div>
      </div>
    )
  }

  if (norm === 'completed') {
    return (
      <div className="flex items-center gap-1.5 text-xs font-bold text-[#00DEA5]">
        <CheckCircle2 className="w-4 h-4 text-[#00DEA5] flex-shrink-0" />
        <span>Completed</span>
      </div>
    )
  }

  if (norm === 'failed') {
    return (
      <div className="flex items-center gap-2">
        <XCircle className="w-4 h-4 text-[#FF4568] flex-shrink-0" />
        <div className="flex flex-col">
          <span className="text-xs font-bold text-[#FF4568]">Failed</span>
          {subtitle && <span className="text-[11px] text-text-muted">{subtitle}</span>}
        </div>
      </div>
    )
  }

  if (norm === 'paused') {
    return (
      <div className="flex items-center gap-2">
        <PauseCircle className="w-4 h-4 text-purple-400 flex-shrink-0" />
        <div className="flex flex-col">
          <span className="text-xs font-bold text-purple-400">Paused</span>
          {subtitle && <span className="text-[11px] text-text-muted">{subtitle}</span>}
        </div>
      </div>
    )
  }

  return <span className="text-xs font-semibold text-text-muted">{status}</span>
}
