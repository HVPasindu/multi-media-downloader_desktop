/**
 * LoadingIndicator Component
 * A reusable, premium glowing loading bar or spinner using our brand tokens
 * (Cyan #19D8FF and Violet #514BFF).
 */

export default function LoadingIndicator({ type = 'bar', label = null, className = '' }) {
  if (type === 'spinner') {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
        <div className="relative w-10 h-10">
          {/* Subtle background ring */}
          <div className="absolute inset-0 rounded-full border-2 border-surface-elevated opacity-40"></div>
          {/* Animated glowing spinner */}
          <div
            className="w-10 h-10 rounded-full border-2 border-transparent border-t-primary border-r-accent animate-spin"
            style={{ filter: 'drop-shadow(0 0 8px rgba(25, 216, 255, 0.6))' }}
          ></div>
        </div>
        {label && <p className="text-xs text-text-muted font-medium tracking-wide">{label}</p>}
      </div>
    )
  }

  // Default: Indeterminate glowing horizontal progress bar
  return (
    <div className={`w-full flex flex-col items-center gap-2 ${className}`}>
      <div className="w-full h-1.5 bg-surface-elevated/70 rounded-full overflow-hidden relative border border-primary/20">
        {/* Glowing pulse indicator moving horizontally */}
        <div
          className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-primary via-white to-accent animate-[indeterminate_1.8s_ease-in-out_infinite]"
          style={{
            boxShadow: '0 0 14px rgba(25, 216, 255, 0.8), 0 0 24px rgba(81, 75, 255, 0.6)'
          }}
        ></div>
      </div>
      {label && <p className="text-xs text-text-muted font-medium tracking-wide">{label}</p>}
    </div>
  )
}

