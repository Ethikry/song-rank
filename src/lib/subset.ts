/**
 * A Dataset restricted to a subset of years, for the "only my editions" view.
 *
 * Every aggregate consumer — allTimeBoard, crownHistory, buildRecap, the taste
 * pairwise tables — already takes a whole `Dataset`, and `computeDataset` is
 * pure, so recomputing over fewer years gives all of them a coherent
 * subset-scoped view with no changes on their side.
 *
 * THE CATCH: computeAllTime assigns `song.overallRank` by MUTATING the Song
 * objects in place (stats.ts). The songs inside a Dataset's `years` are the very
 * same objects its `allTime` exposes, so recomputing over a subset would
 * silently rewrite all-time ranks across the entire site — a song shown as
 * "#3 ever" on the Songs page would quietly become "#3 among your years", on
 * pages that aren't even using the subset. So we deep-copy the songs first and
 * let the recompute scribble on the copies.
 *
 * Note the copies are distinct objects from the base dataset's: compare songs
 * by `year`+`id`, never by reference, when mixing the two.
 *
 * This module deliberately does NOT import `./data` — that module uses Vite's
 * `import.meta.glob` and would be unloadable in the Node validation harness,
 * which is where the mutation guard above is actually asserted.
 */
import { computeDataset } from './stats'
import type { Dataset, Song, YearData } from './types'

function cloneSong(s: Song): Song {
  return {
    ...s,
    // Nested containers need their own copies too, or the recompute could
    // reach through into the shared originals.
    nominators: [...s.nominators],
    artists: [...s.artists],
    scores: { ...s.scores },
    ...(s.comments ? { comments: { ...s.comments } } : {}),
  }
}

function cloneYear(y: YearData): YearData {
  return { ...y, participants: [...y.participants], songs: y.songs.map(cloneSong) }
}

/**
 * Recompute `base` over just `years`, without mutating anything reachable from
 * `base`. Returns `base` itself when the subset is everything, which preserves
 * referential equality so `useMemo` deps don't invalidate in the common case.
 */
export function subsetOf(base: Dataset, years: number[]): Dataset {
  const wanted = [...new Set(years)].sort((a, b) => a - b)
  if (wanted.length === 0 || wanted.length === base.years.length) return base
  const set = new Set(wanted)
  return computeDataset(base.years.filter((y) => set.has(y.year)).map(cloneYear))
}

/**
 * Memoized `subsetOf`, keyed per base dataset and year set. Identity is stable
 * for a session, so in practice at most one subset is ever computed.
 */
const cache = new WeakMap<Dataset, Map<string, Dataset>>()

export function subsetOfCached(base: Dataset, years: number[]): Dataset {
  const wanted = [...new Set(years)].sort((a, b) => a - b)
  if (wanted.length === 0 || wanted.length === base.years.length) return base

  let perBase = cache.get(base)
  if (!perBase) {
    perBase = new Map()
    cache.set(base, perBase)
  }
  const key = wanted.join(',')
  const hit = perBase.get(key)
  if (hit) return hit

  const computed = subsetOf(base, wanted)
  perBase.set(key, computed)
  return computed
}
