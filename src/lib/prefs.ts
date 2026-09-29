/**
 * Viewer preferences, persisted in localStorage.
 *
 * Read synchronously at import so the first render already has them, matching
 * how the theme is handled in main.tsx.
 */

import { storageKey } from './site'

const KEY = storageKey('prefs')

export interface Prefs {
  /**
   * Scope year-filtered views to the editions the viewer took part in.
   * Defaults on; irrelevant (and inert) for viewers who never ranked.
   */
  scopeMine: boolean
}

const DEFAULTS: Prefs = { scopeMine: true }

let cache: Prefs | null = null

export function readPrefs(): Prefs {
  if (cache) return cache
  let resolved: Prefs
  try {
    const raw = localStorage.getItem(KEY)
    resolved = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch {
    // Private browsing, disabled storage, or corrupt JSON — defaults are fine.
    resolved = { ...DEFAULTS }
  }
  cache = resolved
  return resolved
}

export function writePrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...readPrefs(), ...patch }
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Preference just won't persist; the in-memory value still applies.
  }
  return next
}
