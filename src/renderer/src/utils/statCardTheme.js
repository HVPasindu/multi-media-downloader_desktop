/**
 * StatCard color style definition map and accessor.
 * Maps dynamic theme accents (cyan, blue, purple) to theme CSS classes,
 * while preserving fixed semantic status colors (green = success, red = danger).
 */

export const STAT_CARD_COLOR_MAP = {
  cyan: {
    border: 'border-primary/30 hover:border-primary/50',
    activeBorder: 'border-primary shadow-[0_0_20px_rgba(var(--theme-primary-rgb),0.25)]',
    iconBg: 'bg-primary/15 text-primary',
    countText: 'text-text'
  },
  blue: {
    border: 'border-secondary-accent/30 hover:border-secondary-accent/50',
    activeBorder: 'border-secondary-accent shadow-[0_0_20px_rgba(var(--theme-secondary-rgb),0.25)]',
    iconBg: 'bg-secondary-accent/15 text-secondary-accent',
    countText: 'text-text'
  },
  purple: {
    border: 'border-accent/30 hover:border-accent/50',
    activeBorder: 'border-accent shadow-[0_0_20px_rgba(var(--theme-tertiary-rgb),0.25)]',
    iconBg: 'bg-accent/15 text-accent',
    countText: 'text-text'
  },
  green: {
    border: 'border-emerald-500/30 hover:border-emerald-400/50',
    activeBorder: 'border-emerald-400 shadow-[0_0_20px_rgba(0,222,165,0.25)]',
    iconBg: 'bg-emerald-500/15 text-[#00DEA5]',
    countText: 'text-text'
  },
  red: {
    border: 'border-rose-500/30 hover:border-rose-400/50',
    activeBorder: 'border-rose-400 shadow-[0_0_20px_rgba(255,69,104,0.25)]',
    iconBg: 'bg-rose-500/15 text-[#FF4568]',
    countText: 'text-text'
  }
}

/**
 * Returns the styles for the given accent color token.
 * Defaults to 'cyan' (primary) if unknown.
 *
 * @param {string} [accentColor='cyan']
 * @returns {typeof STAT_CARD_COLOR_MAP['cyan']}
 */
export function getStatCardColorStyles(accentColor = 'cyan') {
  return STAT_CARD_COLOR_MAP[accentColor] || STAT_CARD_COLOR_MAP.cyan
}
