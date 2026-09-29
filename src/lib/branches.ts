import type { Dataset, Song } from './types'
import config from '@data/branches.json'

/**
 * An artist's grouping: an agency branch on the real site, a genre in the
 * public demo. The groupings and the artist → grouping map live in
 * `@data/branches.json` — the same code has to serve both datasets, and the
 * demo's bundle must not carry the real map (see src/lib/site.ts).
 */
export type Branch = string

interface BranchConfig {
  branches: { key: Branch; label: string }[]
  /** The groupings the participants page draws a partisan board for. */
  partisan: Branch[]
  /** Where a credit lands when neither the map nor any rule claims it. */
  fallback: Branch
  /** Tried in order against credits missing from `artists`. */
  rules: { contains: string[]; branch: Branch }[]
  /** Hand-curated: artist → [branch, generation?] */
  artists: Record<string, [Branch, string?]>
}

const CONFIG = config as unknown as BranchConfig

export const BRANCHES: Branch[] = CONFIG.branches.map((b) => b.key)

export const BRANCH_LABELS: Record<Branch, string> = Object.fromEntries(CONFIG.branches.map((b) => [b.key, b.label]))

export const PARTISAN_BRANCHES: Branch[] = CONFIG.partisan

const unmapped = new Set<string>()

export function branchOf(artist: string): Branch {
  const hit = CONFIG.artists[artist]
  if (hit) return hit[0]
  const l = artist.toLowerCase()
  for (const rule of CONFIG.rules) if (rule.contains.some((c) => l.includes(c))) return rule.branch
  unmapped.add(artist)
  return CONFIG.fallback
}

export function genOf(artist: string): string | undefined {
  return CONFIG.artists[artist]?.[1]
}

/** Artists that fell through to the heuristics/fallback — surfaced by the validator. */
export function unmappedArtists(): string[] {
  return [...unmapped].sort()
}

/** A song belongs to every branch of its credited artists (deduped). */
export function songBranches(s: Song): Branch[] {
  return [...new Set(s.artists.map(branchOf))]
}

export interface BranchStats {
  branch: Branch
  songs: number
  avg: number
  podiums: number
  top10s: number
  byYear: { year: number; value: number; n: number }[]
}

export function branchStats(data: Dataset): BranchStats[] {
  return BRANCHES.map((branch) => {
    const songs = data.allTime.songs.filter((s) => songBranches(s).includes(branch))
    const byYear = data.years
      .map((y) => {
        const inYear = songs.filter((s) => s.year === y.year)
        return {
          year: y.year,
          value: inYear.length ? inYear.reduce((a, s) => a + s.average, 0) / inYear.length : NaN,
          n: inYear.length,
        }
      })
      .filter((e) => e.n > 0)
    return {
      branch,
      songs: songs.length,
      avg: songs.length ? songs.reduce((a, s) => a + s.average, 0) / songs.length : NaN,
      podiums: songs.filter((s) => s.rank <= 3).length,
      top10s: songs.filter((s) => s.rank <= 10).length,
      byYear,
    }
  }).filter((b) => b.songs > 0)
}

export interface BranchAffinity {
  branch: Branch
  n: number
  avg: number
  /** avg for this branch minus the participant's overall average */
  delta: number
}

/** How much warmer/cooler a participant scores each branch vs their own baseline. */
export function branchAffinity(data: Dataset, participant: string, minSongs = 5): BranchAffinity[] {
  const baseline = data.allTime.participantStats[participant]?.avgGiven
  if (baseline === undefined) return []
  const out: BranchAffinity[] = []
  for (const branch of BRANCHES) {
    const scores: number[] = []
    for (const s of data.allTime.songs) {
      const v = s.scores[participant]
      if (v !== undefined && songBranches(s).includes(branch)) scores.push(v)
    }
    if (scores.length >= minSongs) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length
      out.push({ branch, n: scores.length, avg, delta: avg - baseline })
    }
  }
  return out.sort((a, b) => b.delta - a.delta)
}
