export const fmt = (x: number, digits = 2): string => (Number.isFinite(x) ? x.toFixed(digits) : '—')

export const pct = (x: number, digits = 0): string =>
  Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : '—'

/**
 * "1 song" / "2 songs". Pass `many` for irregulars. Counts here are routinely 1
 * — a ranker who only turned up for one edition, an artist with one song, a
 * filter narrowed to a single row — so this is not a theoretical case.
 */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

export const medal = (rank: number): string =>
  rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`

/**
 * Print-style score chip: red → amber → green ink over a paper tint,
 * gold with a star for the 11.
 */
export function scoreColor(v: number): { bg: string; fg: string; border: string } {
  if (v === 11)
    return { bg: 'color-mix(in oklab, #96731d 22%, #fdfaf1)', fg: '#6b5213', border: '#96731d' }
  const t = Math.max(0, Math.min(1, (v - 3) / 7)) // 3 or below = full red, 10 = full green
  const hue = t * 120
  const ink = `hsl(${hue} 55% 30%)`
  return {
    bg: `color-mix(in oklab, hsl(${hue} 60% 45%) 20%, #fdfaf1)`,
    fg: ink,
    border: `color-mix(in oklab, ${ink} 55%, #fdfaf1)`,
  }
}

/** Diverging color for a correlation cell (navy positive, vermillion negative) on paper. */
export function corrColor(c: number): string {
  if (!Number.isFinite(c)) return 'transparent'
  const t = Math.max(-1, Math.min(1, c))
  if (t >= 0) {
    const s = Math.pow(t, 0.75)
    return `color-mix(in oklab, var(--corr-pos) ${Math.round(s * 88)}%, var(--heat-base))`
  }
  const s = Math.pow(-t, 0.75)
  return `color-mix(in oklab, var(--corr-neg) ${Math.round(s * 88)}%, var(--heat-base))`
}

/** Ink color that stays readable over a corrColor cell. */
export function corrInk(c: number): string {
  return Number.isFinite(c) && Math.abs(c) > 0.55 ? '#f6f1e5' : 'var(--ink)'
}

/** Cold→hot color for a normalized 0..1 bond strength (steel blue → green → red). */
export function heatColor(t: number): string {
  const c = Math.max(0, Math.min(1, t))
  return `hsl(${Math.round(215 - 215 * c)} ${Math.round(55 + 25 * c)}% ${Math.round(46 + 4 * c)}%)`
}

/** CSS gradient sampling heatColor, for legends. */
export function heatGradient(): string {
  return `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(heatColor).join(', ')})`
}
