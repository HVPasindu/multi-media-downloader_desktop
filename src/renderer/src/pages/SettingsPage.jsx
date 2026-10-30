import { Settings, Clock } from 'lucide-react'

/**
 * Settings Page Placeholder (Step 05.00)
 * Will be fully implemented with folder selection and preferences in Steps 05.12–05.14.
 */
export default function SettingsPage() {
  return (
    <div className="p-8 max-w-6xl w-full mx-auto flex flex-col gap-6 select-none animate-fadeIn">
      <div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Settings</h1>
        <p className="text-sm text-text-muted mt-1">
          Customize your download preferences and application settings.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center p-16 rounded-2xl bg-[#07152E]/50 border border-primary/10 text-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-surface flex items-center justify-center text-primary border border-primary/20">
          <Settings className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-white">Application Settings Standby</h2>
        <p className="text-xs text-text-muted max-w-md">
          Download folder chooser, folder organization options, and app configuration will be built
          in Step 05.12.
        </p>
        <div className="flex items-center gap-1.5 text-xs text-primary/80 bg-primary/10 px-3 py-1.5 rounded-full mt-2">
          <Clock className="w-3.5 h-3.5" />
          <span>Scheduled for Roadmap Step 05.12</span>
        </div>
      </div>
    </div>
  )
}
