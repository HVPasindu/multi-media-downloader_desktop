/**
 * Reusable Metric & Summary Stat Card
 * Styled with frosted glass, neon glowing borders, vibrant icon containers, and bold typography.
 */
export default function StatCard({
  icon: Icon,
  count,
  label,
  accentColor = 'cyan', // 'cyan' | 'blue' | 'purple' | 'green' | 'red'
  isActive = false,
  onClick = null
}) {
  const colorStyles =
    {
      cyan: {
        border: 'border-cyan-500/30 hover:border-cyan-400/50',
        activeBorder: 'border-cyan-400 shadow-[0_0_20px_rgba(25,216,255,0.25)]',
        iconBg: 'bg-cyan-500/15 text-[#19D8FF]',
        countText: 'text-white'
      },
      blue: {
        border: 'border-blue-500/30 hover:border-blue-400/50',
        activeBorder: 'border-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.25)]',
        iconBg: 'bg-blue-500/15 text-blue-400',
        countText: 'text-white'
      },
      purple: {
        border: 'border-purple-500/30 hover:border-purple-400/50',
        activeBorder: 'border-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.25)]',
        iconBg: 'bg-purple-500/15 text-purple-400',
        countText: 'text-white'
      },
      green: {
        border: 'border-emerald-500/30 hover:border-emerald-400/50',
        activeBorder: 'border-emerald-400 shadow-[0_0_20px_rgba(0,222,165,0.25)]',
        iconBg: 'bg-emerald-500/15 text-[#00DEA5]',
        countText: 'text-white'
      },
      red: {
        border: 'border-rose-500/30 hover:border-rose-400/50',
        activeBorder: 'border-rose-400 shadow-[0_0_20px_rgba(255,69,104,0.25)]',
        iconBg: 'bg-rose-500/15 text-[#FF4568]',
        countText: 'text-white'
      }
    }[accentColor] || colorStyles.cyan

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      className={`relative flex items-center gap-4 px-5 py-4 rounded-2xl bg-[#07152E]/80 backdrop-blur-md border transition-all duration-200 select-none ${
        isActive ? colorStyles.activeBorder : colorStyles.border
      } ${onClick ? 'cursor-pointer hover:bg-[#0B1C38]/90' : ''}`}
    >
      {/* Icon Capsule */}
      <div
        className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${colorStyles.iconBg}`}
      >
        <Icon className="w-5 h-5" />
      </div>

      {/* Numerical Data & Label */}
      <div className="flex flex-col">
        <span
          className={`text-2xl font-black tracking-tight leading-none ${colorStyles.countText}`}
        >
          {count}
        </span>
        <span className="text-xs font-medium text-text-muted mt-1 tracking-wide">{label}</span>
      </div>
    </div>
  )
}
