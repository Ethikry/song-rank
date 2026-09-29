/**
 * Alternative ways of counting the same ballots.
 *
 * The board has always been a raw mean, which lets a single fanatic's 11 outweigh
 * broad mild approval — and lets one grudge sink a song fifteen people liked.
 * Re-tallying the identical scores under three other systems shows which songs
 * owe their place to the counting method rather than to the room.
 *
 * Every year's score matrix is fully dense (each ranker scored every song in
 * their year), so there is no missing-vote problem to smooth away and no reason
 * to weight songs by turnout: within a year, every song was seen by everybody.
 */
import { mean } from './stats'
import type { Song } from './types'

export type System = 'mean' | 'trimmed' | 'median' | 'borda'

export const SYSTEMS: System[] = ['mean', 'trimmed', 'median', 'borda']

export const SYSTEM_LABELS: Record<System, string> = {
  mean: 'Raw average',
  trimmed: 'Trimmed mean',
  median: 'Median',
  borda: 'Borda count',
}

export const SYSTEM_BLURBS: Record<System, string> = {
  mean: 'Raw average — the official board.',
  trimmed: 'Top and bottom 10% dropped.',
  median: 'The middle score, whatever the extremes.',
  borda: 'Rank order only; every scale counts the same.',
}

export interface AltRank {
  song: Song
  /** Songs in this song's own year — every rank below is out of this. */
  field: number
  /** The song's tally under each system (units differ per system). */
  scores: Record<System, number>
  /**
   * A cross-year-comparable value per system, higher = better, for pooling songs
   * from different editions into one leaderboard (see `pooledRanks`). Mean, trimmed
   * and median are their raw 1–11 tally (already comparable); Borda is normalized to
   * points-per-voter ÷ (field − 1) ∈ [0,1], because raw Borda points scale with the
   * size of the field and would otherwise just rank the biggest edition first.
   */
  poolValue: Record<System, number>
  /** 1-based finish under each system, over whatever field was passed in. */
  ranks: Record<System, number>
  /**
   * Share of its own year's field the song finished ahead of — 0 for a year's
   * winner, 1 for its wooden spoon. This is the only figure that compares
   * across editions; see the note on `percentiles` in `altRankings`.
   */
  percentiles: Record<System, number>
  /** Scores of 10+ received — the "carried by fanatics" tell. */
  bigLoves: number
  /** Scores in the bottom quartile of everything that ranker's year saw. */
  lowballs: number
  /**
   * Majority-Judgment gauge for the median grade: `+`share-above when that beats
   * share-below, else `−`share-below. Breaks the median's heavy ties (see
   * `majorityGauge`); it is the median column's secondary sort key everywhere.
   */
  mjGauge: number
}

function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Mean after dropping `frac` of the scores from each tail. The count dropped per
 * side is floored, so a small field simply trims less rather than trimming
 * everything: at frac=0 this is exactly the raw mean, which is what the
 * validator leans on.
 */
export function trimmedMean(xs: number[], frac = 0.1): number {
  if (!xs.length) return NaN
  const cut = Math.floor(xs.length * frac)
  if (cut === 0) return mean(xs)
  const s = [...xs].sort((a, b) => a - b)
  return mean(s.slice(cut, s.length - cut))
}

/**
 * Each participant's own ranking of the field, as points.
 *
 * Ties are the whole difficulty. A ranker hands the same 8 to a dozen songs, and
 * ordering those twelve by whatever order they arrived in would invent a
 * preference nobody expressed — noise dressed up as a result. Every tied block
 * therefore shares the block's average rank, which is the standard fix and the
 * one that makes the tally invariant to how the songs happen to be listed.
 *
 * Because only the ordering survives, this is a per-ranker scale normalization:
 * a harsh grader's 6 pushes a song up exactly as hard as a generous grader's 9.
 * That is the point of including it — it answers "who did the room prefer",
 * where the mean answers "how warmly did the room speak".
 */
function bordaPoints(songs: Song[]): Map<Song, number> {
  const points = new Map<Song, number>(songs.map((s) => [s, 0]))
  const voters = new Set(songs.flatMap((s) => Object.keys(s.scores)))
  for (const voter of voters) {
    const ballot = songs.filter((s) => s.scores[voter] !== undefined)
    // best first, so position 0 is this voter's favourite
    const ordered = [...ballot].sort((a, b) => b.scores[voter] - a.scores[voter])
    const n = ordered.length
    for (let i = 0; i < n; ) {
      let j = i
      while (j + 1 < n && ordered[j + 1].scores[voter] === ordered[i].scores[voter]) j++
      // positions i..j are tied: they all take the block's average position
      const avgPos = (i + j) / 2
      const pts = n - 1 - avgPos
      for (let k = i; k <= j; k++) points.set(ordered[k], (points.get(ordered[k]) ?? 0) + pts)
      i = j + 1
    }
  }
  return points
}

/** Rank a field by a tally, best (highest) first, 1-based. Ties take the same rank. */
function rankBy(songs: Song[], value: (s: Song) => number): Map<Song, number> {
  const ordered = [...songs].sort((a, b) => value(b) - value(a))
  const out = new Map<Song, number>()
  let rank = 0
  ordered.forEach((s, i) => {
    if (i === 0 || value(s) !== value(ordered[i - 1])) rank = i + 1
    out.set(s, rank)
  })
  return out
}

/**
 * Rank by an arbitrary comparator (best first), ties — where the comparator
 * returns 0 — sharing a rank. So the ranks stay a valid competition ranking and,
 * as long as the comparator ignores input order, stay independent of it.
 */
function rankByCompare(songs: Song[], cmp: (a: Song, b: Song) => number): Map<Song, number> {
  const ordered = [...songs].sort(cmp)
  const out = new Map<Song, number>()
  let rank = 0
  ordered.forEach((s, i) => {
    if (i === 0 || cmp(s, ordered[i - 1]) !== 0) rank = i + 1
    out.set(s, rank)
  })
  return out
}

/**
 * The Majority-Judgment gauge for a song's median grade: `+p` when the share of
 * scores strictly above the median (`p`) beats the share below (`q`), else `−q`.
 *
 * The median alone is far too coarse to rank on here — a median of ~30 ballots on
 * a 20-rung scale lands the whole field on a handful of values (one 109-way tie at
 * 7.0 all-time). Majority Judgment (Balinski & Laraki) breaks those ties exactly
 * this way: among options sharing a median, the one with more of its mass above it
 * ranks higher, and among two both leaning low the one with less mass below wins.
 */
function majorityGauge(scores: number[], med: number): number {
  const n = scores.length || 1
  const above = scores.filter((v) => v > med).length / n
  const below = scores.filter((v) => v < med).length / n
  return above > below ? above : -below
}

/**
 * Every system's tally and finish over one year's field.
 *
 * Must be called per year, over the *complete* field: Borda points and rank both
 * scale with the size of the field — the fields differ by up to forty songs, so
 * pooling years before tallying would let the biggest edition dominate on
 * arithmetic alone — and the raw-mean column is read straight off each song's
 * published rank, which only lines up with the rest when the whole year is here.
 */
export function altRankings(songs: Song[]): AltRank[] {
  if (!songs.length) return []
  const borda = bordaPoints(songs)
  const tally = (s: Song): Record<System, number> => {
    const xs = Object.values(s.scores)
    return {
      mean: mean(xs),
      trimmed: trimmedMean(xs),
      median: median(xs),
      borda: borda.get(s) ?? 0,
    }
  }
  const tallies = new Map<Song, Record<System, number>>(songs.map((s) => [s, tally(s)]))
  const gauge = new Map<Song, number>(
    songs.map((s) => [s, majorityGauge(Object.values(s.scores), tallies.get(s)!.median)]),
  )
  // The mean's "rank" is the published finish, not a recomputed one. Tied
  // averages are common — 36 songs in 2022, 47 in 2023 — and the master sheets
  // resolve them inconsistently (2022 seats both songs at #3, 2023 hands out #5
  // and #6). Recomputing would therefore disagree with the board the site shows
  // everywhere else, and every alternative system would report a phantom
  // one-place move for songs that never moved at all.
  const ranks: Record<System, Map<Song, number>> = {
    mean: new Map(songs.map((s) => [s, s.rank])),
    trimmed: rankBy(songs, (s) => tallies.get(s)!.trimmed),
    // Median ties broken by the majority gauge (see `majorityGauge`); without it
    // most of the field shares a rank and the order is decided by nothing.
    median: rankByCompare(
      songs,
      (a, b) => tallies.get(b)!.median - tallies.get(a)!.median || gauge.get(b)! - gauge.get(a)!,
    ),
    borda: rankBy(songs, (s) => tallies.get(s)!.borda),
  }

  // "Lowball" is judged against the year's own scoring culture rather than a
  // fixed number: a 6 means something different in a year that averaged 8.2.
  const allScores = songs.flatMap((s) => Object.values(s.scores)).sort((a, b) => a - b)
  const q1 = allScores[Math.floor(allScores.length * 0.25)]

  const field = songs.length
  // Position within the field, normalized so the endpoints line up across
  // editions: (rank − 1) ÷ (field − 1), not rank ÷ field. The naive form looks
  // like a percentile but isn't one — it hands 2025's winner 1/111 = 0.009 and
  // 2024's winner 1/71 = 0.014, so pooling years and sorting on it silently
  // ordered equal achievements by edition size and let the biggest year own the
  // top of every all-time list. Subtracting one from both ends puts every year's
  // winner at 0 and every year's last place at 1, which is what "compares
  // across years" has to mean.
  const span = Math.max(1, field - 1)
  return songs.map((song) => {
    const scores = tallies.get(song)!
    const rank = {} as Record<System, number>
    const percentiles = {} as Record<System, number>
    for (const sys of SYSTEMS) {
      rank[sys] = ranks[sys].get(song)!
      percentiles[sys] = (rank[sys] - 1) / span
    }
    const values = Object.values(song.scores)
    // Borda points are field-dependent (a deeper field hands out more), so pooling
    // songs across editions needs the per-voter share of the maximum, not the raw
    // count. The other three tallies are on the same 1–11 scale every year.
    const voters = values.length || 1
    const poolValue: Record<System, number> = {
      mean: scores.mean,
      trimmed: scores.trimmed,
      median: scores.median,
      borda: scores.borda / voters / span,
    }
    return {
      song,
      field,
      scores,
      poolValue,
      ranks: rank,
      percentiles,
      bigLoves: values.filter((v) => v >= 10).length,
      lowballs: values.filter((v) => v <= q1).length,
      mjGauge: gauge.get(song)!,
    }
  })
}

/**
 * Alternative rankings across several years at once, tallied year by year.
 *
 * The per-year rows are returned as they are; callers comparing across years
 * must use `percentiles`, never `ranks` — finishing #20 of 111 is a better
 * result than #15 of 71, and the site says so everywhere else too.
 */
export function altRankingsByYear(songsByYear: Song[][]): AltRank[] {
  return songsByYear.flatMap((songs) => altRankings(songs))
}

/**
 * One combined leaderboard per system over a pool of songs from any number of
 * editions: every song numbered 1..n by its `poolValue` under that system, best
 * first. Genuine value-ties share a rank (as the site does elsewhere); the raw
 * tally and then `song.id` break the display order so the list never reshuffles
 * arbitrarily between renders.
 *
 * This is what the Lab uses once more than one year is selected — a #1 of 111 no
 * longer automatically outranks a #1 of 71 just for having a deeper field; the
 * songs are compared on the value the column actually measures.
 */
export function pooledRanks(rows: AltRank[]): Record<System, Map<Song, number>> {
  const out = {} as Record<System, Map<Song, number>>
  for (const sys of SYSTEMS) {
    // The rank-significant key, best first: `poolValue`, plus the Majority-
    // Judgment gauge for median so its heavy ties actually resolve. `song.id`
    // only settles the display order within a genuine tie — it never mints a new
    // rank number — so equal songs still share a place.
    const key = (r: AltRank): [number, number] =>
      sys === 'median' ? [r.poolValue.median, r.mjGauge] : [r.poolValue[sys], 0]
    const ordered = [...rows].sort((a, b) => {
      const [av, ag] = key(a)
      const [bv, bg] = key(b)
      return bv - av || bg - ag || a.song.id.localeCompare(b.song.id)
    })
    const m = new Map<Song, number>()
    let rank = 0
    ordered.forEach((r, i) => {
      const [v, g] = key(r)
      const prev = i > 0 ? key(ordered[i - 1]) : null
      if (!prev || v !== prev[0] || g !== prev[1]) rank = i + 1
      m.set(r.song, rank)
    })
    out[sys] = m
  }
  return out
}

export interface Mover {
  row: AltRank
  /** Positive = the alternative system likes it better than the raw average. */
  gain: number
}

/**
 * The whole field re-tallied, each song carrying how far it moved off the raw
 * average, biggest movement first. Songs that didn't budge come back too, with
 * a gain of zero — the full board is what the detail view shows.
 *
 * Movement is measured in normalized position so a multi-year pool doesn't rank
 * a ten-place swing in the smallest edition above a thirty-place swing in the
 * largest, and so the "biggest riser" is genuinely the biggest riser.
 */
export function restacked(rows: AltRank[], system: System): Mover[] {
  if (system === 'mean') return rows.map((row) => ({ row, gain: 0 }))
  return rows
    .map((row) => ({ row, gain: row.percentiles.mean - row.percentiles[system] }))
    .sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain))
}
