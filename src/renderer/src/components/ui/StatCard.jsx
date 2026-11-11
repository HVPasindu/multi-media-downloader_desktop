import { getStatCardColorStyles } from '../../utils/statCardTheme'

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
  const colorStyles = getStatCardColorStyles(accentColor)

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      className={`relative flex items-center gap-4 px-5 py-4 rounded-2xl bg-surface/80 backdrop-blur-md border transition-all duration-200 select-none ${
        isActive ? colorStyles.activeBorder : colorStyles.border
      } ${onClick ? 'cursor-pointer hover:bg-surface-elevated/90' : ''}`}
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
