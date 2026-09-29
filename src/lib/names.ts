/**
 * Participant/nominator names vary in casing between years
 * (kasumi/Kasumi, Lazr/lazr, righto/Righto, ...). All data is keyed by a
 * stable lowercase key; the display spelling is whichever a year's sheet
 * used most recently (years are parsed in ascending order).
 */
const display = new Map<string, string>()

/** Stable key for a raw name; records its display spelling. */
export function nameKey(raw: string): string {
  const trimmed = raw.trim()
  const key = trimmed.toLowerCase()
  if (trimmed) display.set(key, trimmed)
  return key
}

export function displayName(key: string): string {
  return display.get(key) ?? key
}

export function resetNames(): void {
  display.clear()
}

/**
 * Up to two initials, for standing in where a face is missing.
 *
 * Names here are a single token far more often than not ("nofreelunch"), so a
 * one-letter monogram is the common case rather than the fallback.
 */
export function monogram(key: string): string {
  const parts = displayName(key).split(/[\s_.-]+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[1][0] : '')).toUpperCase()
}
