import type { Dataset, Song } from './types'

export interface AltRanking {
  song: Song
  /** average recomputed without the removed participant (NaN if they were the only scorer) */
  altAverage: number
  altRank: number
  /** positive = the song rises without them */
  shift: number
}

function avgWithout(s: Song, participant: string): number {
  let sum = 0
  let n = 0
  for (const [who, v] of Object.entries(s.scores)) {
    if (who === participant) continue
    sum += v
    n++
  }
  return n ? sum / n : NaN
}

/** Recompute a year's ranking as if one participant had never scored. */
export function rankingsWithout(data: Dataset, year: number, participant: string): AltRanking[] {
  const songs = data.perYear[year].songs
  const alt = songs.map((song) => ({ song, altAverage: avgWithout(song, participant) }))
  const order = [...alt].sort((a, b) => b.altAverage - a.altAverage)
  const rankOf = new Map(order.map((e, i) => [e.song, i + 1]))
  return alt
    .map((e) => ({
      ...e,
      altRank: rankOf.get(e.song)!,
      shift: e.song.rank - rankOf.get(e.song)!,
    }))
    .sort((a, b) => a.altRank - b.altRank)
}

export interface TierChange {
  song: Song
  from: number
  to: number
  /** the credited scorer's actual score on this song */
  score: number
}

export interface TierImpact {
  participant: string
  changes: TierChange[]
  /** their largest single rank move within the tiers */
  maxShift: number
}

/**
 * Removals that rearrange a year's top 3 or bottom 3. Each song is credited
 * to the single scorer with the most influence on ITS average (the same
 * attribution as Carried & buried) — never to bystanders whose removal merely
 * reshuffles neighbors. Only material moves (>= minShift ranks) count.
 */
/**
 * `tier` widens or narrows what counts as "worth showing". The default is the
 * podium and the wooden-spoon end; a caller can ask for, say, the top 10 only
 * (`{ top: 10, bottom: 0 }`) to find the near-misses when the podium tier turns
 * up almost nothing.
 */
export function tierImpacts(
  data: Dataset,
  year: number,
  minShift = 2,
  tier: { top?: number; bottom?: number } = {},
): TierImpact[] {
  const ys = data.perYear[year]
  const field = ys.songs.length
  const top = tier.top ?? 3
  const bottom = tier.bottom ?? 3
  const inTier = (r: number) => r <= top || (bottom > 0 && r > field - bottom)

  // biggest average-influencer per song
  const influencer = new Map<Song, string>()
  for (const s of ys.songs) {
    let bestWho: string | null = null
    let bestLift = 0
    for (const who of Object.keys(s.scores)) {
      const lift = Math.abs(s.average - avgWithout(s, who))
      if (bestWho === null || lift > bestLift) {
        bestWho = who
        bestLift = lift
      }
    }
    if (bestWho) influencer.set(s, bestWho)
  }

  const byParticipant = new Map<string, TierChange[]>()
  const altCache = new Map<string, Map<Song, number>>()
  const altRankOf = (song: Song, who: string): number => {
    if (!altCache.has(who)) {
      altCache.set(who, new Map(rankingsWithout(data, year, who).map((e) => [e.song, e.altRank])))
    }
    return altCache.get(who)!.get(song)!
  }
  for (const [song, who] of influencer) {
    const to = altRankOf(song, who)
    const from = song.rank
    if (to === from || Math.abs(to - from) < minShift) continue
    if (!inTier(from) && !inTier(to)) continue
    if (!byParticipant.has(who)) byParticipant.set(who, [])
    byParticipant.get(who)!.push({ song, from, to, score: song.scores[who] })
  }

  return [...byParticipant.entries()]
    .map(([participant, changes]) => ({
      participant,
      changes: changes.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from)),
      maxShift: Math.max(...changes.map((c) => Math.abs(c.to - c.from))),
    }))
    .sort((a, b) => b.maxShift - a.maxShift || b.changes.length - a.changes.length)
}

/**
 * tierImpacts across every year at once, merged per participant — the all-time
 * answer to "who could rewrite a podium". Each change keeps its song (and thus
 * its year), so callers can label cross-year lists.
 */
export function tierImpactsAllTime(data: Dataset, minShift = 2): TierImpact[] {
  const byParticipant = new Map<string, TierChange[]>()
  for (const y of data.years) {
    for (const imp of tierImpacts(data, y.year, minShift)) {
      if (!byParticipant.has(imp.participant)) byParticipant.set(imp.participant, [])
      byParticipant.get(imp.participant)!.push(...imp.changes)
    }
  }
  return [...byParticipant.entries()]
    .map(([participant, changes]) => ({
      participant,
      changes: changes.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from)),
      maxShift: Math.max(...changes.map((c) => Math.abs(c.to - c.from))),
    }))
    .sort((a, b) => b.maxShift - a.maxShift || b.changes.length - a.changes.length)
}

export interface VoterInfluence {
  participant: string
  /** songs they actually scored this year */
  votes: number
  /** Σ |official rank − rank without them| across those songs */
  totalRanks: number
  /** how many of those songs moved at all */
  songsMoved: number
  /** totalRanks / votes — ranks moved per vote cast */
  perVote: number
  /** the song their vote moved furthest */
  top: { song: Song; from: number; to: number; score: number; shift: number } | null
}

/**
 * How far each voter's ballot moved the year's board.
 *
 * Deliberately summed over **only the songs they scored**: pulling one person
 * out reshuffles songs they never touched, as neighbours slide past each other,
 * and crediting that drift to them would reward whoever happens to sit next to
 * a crowded part of the board rather than whoever actually voted hard.
 */
export function voterInfluence(data: Dataset, year: number): VoterInfluence[] {
  const ys = data.perYear[year]
  return ys.participants
    .map((participant) => {
      const alt = rankingsWithout(data, year, participant)
      let totalRanks = 0
      let votes = 0
      let songsMoved = 0
      let top: VoterInfluence['top'] = null
      for (const e of alt) {
        const score = e.song.scores[participant]
        if (score === undefined) continue
        votes++
        const shift = Math.abs(e.song.rank - e.altRank)
        if (shift === 0) continue
        totalRanks += shift
        songsMoved++
        // Ties go to the better official finish: a top-10 song shuffled four
        // places is the more interesting sentence than an 80th shuffled four.
        if (!top || shift > top.shift || (shift === top.shift && e.song.rank < top.song.rank)) {
          top = { song: e.song, from: e.song.rank, to: e.altRank, score, shift }
        }
      }
      return { participant, votes, totalRanks, songsMoved, perVote: votes ? totalRanks / votes : 0, top }
    })
    .sort((a, b) => b.totalRanks - a.totalRanks || b.songsMoved - a.songsMoved)
}

/** The middle of the field, for putting a leader's influence in proportion. */
export function averageInfluence(rows: VoterInfluence[]): { totalRanks: number; songsMoved: number; perVote: number } {
  const n = rows.length || 1
  return {
    totalRanks: rows.reduce((a, r) => a + r.totalRanks, 0) / n,
    songsMoved: rows.reduce((a, r) => a + r.songsMoved, 0) / n,
    perVote: rows.reduce((a, r) => a + r.perVote, 0) / n,
  }
}

export interface CarriedSong {
  song: Song
  /** the scorer whose removal moves the song's average the most */
  who: string
  withScore: number
  altAverage: number
  /** positive = they carried it up; negative = they buried it */
  lift: number
  /** the song's year rank with and without that scorer */
  rankWith: number
  rankWithout: number
}

/** For every song, the single scorer with the most influence on its average. */
export function carriedSongs(data: Dataset): CarriedSong[] {
  // memoized per (year, removed participant) alternate rank tables
  const altRanks = new Map<string, Map<Song, number>>()
  const altRankOf = (song: Song, who: string): number => {
    const key = `${song.year}|${who}`
    if (!altRanks.has(key)) {
      altRanks.set(key, new Map(rankingsWithout(data, song.year, who).map((e) => [e.song, e.altRank])))
    }
    return altRanks.get(key)!.get(song)!
  }

  const out: CarriedSong[] = []
  for (const s of data.allTime.songs) {
    let best: { who: string; withScore: number; altAverage: number; lift: number } | null = null
    for (const [who, v] of Object.entries(s.scores)) {
      const alt = avgWithout(s, who)
      const lift = s.average - alt
      if (!best || Math.abs(lift) > Math.abs(best.lift)) {
        best = { who, withScore: v, altAverage: alt, lift }
      }
    }
    if (best) {
      out.push({ song: s, ...best, rankWith: s.rank, rankWithout: altRankOf(s, best.who) })
    }
  }
  return out.sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift))
}
