/**
 * The year filter behind every pill box on the site.
 *
 * A scope is just the set of years currently selected, and **empty means all**
 * — the cumulative view is the natural resting state rather than a special
 * case. Clicking a year adds it to the selection; clicking it again removes it.
 * Selecting 2022 and then 2023 shows the two pooled, not 2023 alone.
 *
 * Excluding a year is therefore not its own mode: it's selecting every other
 * year, which the "all but this" affordance on the pill box does in one click.
 * Either way the result is a genuine recompute over the selected years, so the
 * global ranking, correlations and boards all reflect exactly that pool.
 *
 * Encoded into the URL as `all` or `2022,2023`, so any selection is linkable.
 */
import { subsetOfCached } from './subset'
import type { Dataset } from './types'

/** Selected years, ascending and deduped. Empty = every year. */
export type YearScope = readonly number[]

export const ALL_YEARS: YearScope = []

const norm = (years: Iterable<number>): YearScope =>
  [...new Set(years)].sort((a, b) => a - b)

/**
 * Read a scope out of a URL param.
 *
 * `valid` is the set of years the calling page can actually show, so a
 * hand-edited or stale link naming years that no longer exist (or that this
 * particular ranker never took part in) drops them rather than rendering an
 * empty page. A selection that survives to nothing degrades to all-time.
 */
export function parseYearScope(param: string | undefined, valid: readonly number[]): YearScope {
  if (!param || param === 'all') return ALL_YEARS
  const years = param
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((y) => Number.isFinite(y) && valid.includes(y))
  return norm(years)
}

/** Serialize for the URL. Round-trips with `parseYearScope`. */
export function yearScopeParam(scope: YearScope): string {
  return scope.length === 0 ? 'all' : scope.join(',')
}

/**
 * Add `year` to the selection, or drop it if it's already in.
 *
 * Deselecting the last remaining year lands back on all-time, which is both the
 * only sensible reading of "nothing selected" and the way out of a filter
 * without hunting for the All button.
 */
export function toggleYear(scope: YearScope, year: number): YearScope {
  return scope.includes(year)
    ? scope.filter((y) => y !== year)
    : norm([...scope, year])
}

/** Is this scope showing everything? */
export function isAllYears(scope: YearScope): boolean {
  return scope.length === 0
}

/** Does a row/song/score from `year` survive this filter? */
export function scopeIncludes(scope: YearScope, year: number): boolean {
  return scope.length === 0 || scope.includes(year)
}

/** The years this scope covers, ascending. */
export function scopeYears(scope: YearScope, all: readonly number[]): number[] {
  return all.filter((y) => scopeIncludes(scope, y)).sort((a, b) => a - b)
}

/**
 * The single selected year, or null when the scope pools several (or all).
 *
 * This is the test for "can we show the per-year flavour of a statistic" — a
 * year's rank out of its field, that year's crown — as opposed to the
 * cumulative flavour. Returning the year rather than a boolean means callers
 * get it without a cast.
 */
export function onlyYear(scope: YearScope): number | null {
  return scope.length === 1 ? scope[0] : null
}

/**
 * The Dataset a scope should be read through.
 *
 * All-time hands back the base dataset unchanged (preserving referential
 * equality, which matters for the `useMemo` deps downstream); any narrower
 * selection gets a recompute over just those years. That recompute is what
 * makes the global ranking, and every other aggregate, reflect the selection —
 * with no changes needed in the consumers themselves.
 */
export function scopedDataset(base: Dataset, scope: YearScope): Dataset {
  if (scope.length === 0) return base
  return subsetOfCached(base, scopeYears(scope, base.years.map((y) => y.year)))
}

/**
 * Human-readable, for prose and captions: "all-time", "2023", "2022 & 2023",
 * "2022, 2023 & 2025", or "all but 2024" once a selection is everything-bar-one.
 */
export function scopeLabel(scope: YearScope, all?: readonly number[]): string {
  if (scope.length === 0) return 'all-time'
  if (scope.length === 1) return String(scope[0])
  if (all && scope.length === all.length - 1) {
    const missing = all.find((y) => !scope.includes(y))
    if (missing !== undefined) return `all but ${missing}`
  }
  const list = [...scope]
  const last = list.pop()
  return `${list.join(', ')} & ${last}`
}
