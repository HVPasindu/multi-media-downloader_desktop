/**
 * Horizontal Filter Tabs Bar with counts and optional right-aligned action button.
 */
export default function FilterTabs({
  tabs = [],
  activeTab = 'all',
  onSelectTab = () => {},
  rightAction = null
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      {/* Tab Pills */}
      <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-none">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 select-none ${
                isActive
                  ? 'bg-gradient-to-r from-[#19D8FF] to-[#3388FF] text-white shadow-[0_0_16px_rgba(25,216,255,0.35)]'
                  : 'bg-[#07152E]/90 text-text-muted hover:text-white hover:bg-[#0B1C38] border border-primary/10'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span
                  className={`text-[11px] ${isActive ? 'text-white/90' : 'text-text-muted/70'}`}
                >
                  ({tab.count})
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Optional Right Action (e.g. Clear Completed, Clear History) */}
      {rightAction && <div className="flex-shrink-0">{rightAction}</div>}
    </div>
  )
}
