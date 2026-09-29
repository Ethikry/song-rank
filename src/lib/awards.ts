import type { AwardKey, Dataset, Song, YearStats } from './types'

export interface AwardDef {
  key: AwardKey
  title: string
  emoji: string
  metric: string
  allTimeMetric: string
  description: string
  betterIs: 'high' | 'low'
}

export const AWARDS: AwardDef[] = [
  {
    key: 'tasteRep',
    title: 'Taste Representative',
    emoji: '🎯',
    metric: 'Correlation to final average',
    allTimeMetric: 'Correlation to final average (all songs)',
    description: 'Whose scores best track the group consensus (Pearson correlation).',
    betterIs: 'high',
  },
  {
    key: 'clairvoyant',
    title: 'Most Clairvoyant',
    emoji: '🔮',
    metric: 'Total distance from final average',
    allTimeMetric: 'Avg distance from final average per song',
    description: 'Smallest absolute gap between their scores and the final averages.',
    betterIs: 'low',
  },
  {
    key: 'hater',
    title: 'Biggest Hater',
    emoji: '🥶',
    metric: 'Number of reds',
    allTimeMetric: 'Total reds (lowest score on a song)',
    description: 'Most times giving a song its single lowest score.',
    betterIs: 'high',
  },
  {
    key: 'lover',
    title: 'Biggest Lover',
    emoji: '💖',
    metric: 'Number of greens',
    allTimeMetric: 'Total greens (top score or a 10+)',
    description: "Most times giving a song its top score or a 10+ (the one 11 doesn't count).",
    betterIs: 'high',
  },
  {
    key: 'nominator',
    title: 'Nominator Dominator',
    emoji: '📣',
    metric: 'Average rank of nominations',
    allTimeMetric: 'Average percentile of nominations',
    description: 'Whose nominated songs place the best.',
    betterIs: 'low',
  },
]

export interface BoardEntry {
  name: string
  value: number
  detail?: string
}

/** Per-year leaderboard for one award, sorted best-first. */
export function yearBoard(stats: YearStats, key: AwardKey): BoardEntry[] {
  const ps = Object.values(stats.participantStats)
  switch (key) {
    case 'tasteRep':
      return ps
        .map((p) => ({ name: p.name, value: p.corrToAvg }))
        .sort((a, b) => b.value - a.value)
    case 'clairvoyant':
      return ps
        .map((p) => ({ name: p.name, value: p.totalAbsDiff }))
        .sort((a, b) => a.value - b.value)
    case 'hater':
      return ps.map((p) => ({ name: p.name, value: p.reds })).sort((a, b) => b.value - a.value)
    case 'lover':
      return ps.map((p) => ({ name: p.name, value: p.greens })).sort((a, b) => b.value - a.value)
    case 'nominator':
      return Object.values(stats.nominators)
        .map((n) => ({ name: n.name, value: n.avgRank, detail: `${n.count} nom${n.count === 1 ? '' : 's'}` }))
        .sort((a, b) => a.value - b.value)
  }
}

/** All-time leaderboard, using per-song-normalized metrics where attendance differs. */
export function allTimeBoard(data: Dataset, key: AwardKey): BoardEntry[] {
  const ps = Object.values(data.allTime.participantStats)
  switch (key) {
    case 'tasteRep':
      return ps
        .map((p) => ({ name: p.name, value: p.corrToAvg, detail: `${p.songsScored} songs` }))
        .sort((a, b) => b.value - a.value)
    case 'clairvoyant':
      return ps
        .map((p) => ({ name: p.name, value: p.avgAbsDiff, detail: `${p.songsScored} songs` }))
        .sort((a, b) => a.value - b.value)
    case 'hater':
      return ps
        .map((p) => ({
          name: p.name,
          value: p.reds,
          detail: `${(p.redsPerSong * 100).toFixed(1)}% of songs`,
        }))
        .sort((a, b) => b.value - a.value)
    case 'lover':
      return ps
        .map((p) => ({
          name: p.name,
          value: p.greens,
          detail: `${(p.greensPerSong * 100).toFixed(1)}% of songs`,
        }))
        .sort((a, b) => b.value - a.value)
    case 'nominator':
      return Object.values(data.allTime.nominators)
        .filter((n) => n.count >= 2)
        .map((n) => ({
          name: n.name,
          value: n.avgPercentile,
          detail: `${n.count} noms, avg rank ${n.avgRank.toFixed(1)}`,
        }))
        .sort((a, b) => a.value - b.value)
  }
}

/**
 * Commenting boards are deliberately NOT part of `AWARDS`, and so never reach
 * `crownHistory`. Only some years' master sheets collected comments at all, so a
 * crown for them would be unwinnable in most years and would quietly distort
 * every all-time crown count and recap that counts crowns.
 */
export type CommentaryKey = 'prolific' | 'verbose' | 'terse'

export interface CommentaryDef {
  key: CommentaryKey
  title: string
  emoji: string
  metric: string
  description: string
}

export const COMMENTARY: CommentaryDef[] = [
  {
    key: 'prolific',
    title: 'Never Shut Up',
    emoji: '🗣️',
    metric: 'Share of their songs annotated',
    description: 'Who left a note on the most of the songs they scored.',
  },
  {
    key: 'verbose',
    title: 'Most Verbose',
    emoji: '📜',
    metric: 'Average note length',
    description: 'Longest notes on average, in characters.',
  },
  {
    key: 'terse',
    title: 'Most Terse',
    emoji: '✂️',
    metric: 'Average note length',
    description: 'Shortest notes on average — among those who wrote at least ten.',
  },
]

interface CommentStat {
  name: string
  commentCount: number
  commentRate: number
  avgCommentLength: number
}

function commentBoardFrom(ps: CommentStat[], key: CommentaryKey): BoardEntry[] {
  switch (key) {
    case 'prolific':
      return ps
        .filter((p) => p.commentCount > 0)
        .map((p) => ({
          name: p.name,
          value: p.commentRate * 100,
          detail: `${p.commentCount} note${p.commentCount === 1 ? '' : 's'}`,
        }))
        .sort((a, b) => b.value - a.value)
    case 'verbose':
    case 'terse': {
      // A handful of notes isn't a writing style, so the length boards need a floor.
      const board = ps
        .filter((p) => p.commentCount >= 10)
        .map((p) => ({
          name: p.name,
          value: p.avgCommentLength,
          detail: `${p.commentCount} notes`,
        }))
      return board.sort((a, b) => (key === 'verbose' ? b.value - a.value : a.value - b.value))
    }
  }
}

/** Per-year commenting board. Empty for years with no Comments tab. */
export function commentaryBoard(stats: YearStats, key: CommentaryKey): BoardEntry[] {
  if (!stats.hasComments) return []
  return commentBoardFrom(Object.values(stats.participantStats), key)
}

/** All-time commenting board, across every year that collected comments. */
export function allTimeCommentaryBoard(data: Dataset, key: CommentaryKey): BoardEntry[] {
  return commentBoardFrom(Object.values(data.allTime.participantStats), key)
}

/** Whether any year in scope collected comments at all. */
export function hasAnyComments(data: Dataset): boolean {
  return data.years.some((y) => y.hasComments)
}

export interface Remorse {
  who: string
  song: Song
  score: number
}

/**
 * The remorse footnote (SITE.remorseAward): the nominator who liked their own pick least, relative to
 * what the room made of it.
 *
 * Only counts nominators who scored it *below* the room average — the joke is a
 * person talking a song into the field and then marking it down harder than
 * anyone they talked into it. A nominator who merely loved it a little less than
 * the room is not that, so a year whose worst case is still above average
 * returns null and the caller shows nothing.
 */
export function nominatorRemorse(songs: Song[]): Remorse | null {
  let worst: Remorse | null = null
  for (const s of songs) {
    if (s.autoIncluded) continue
    for (const who of s.nominators) {
      const score = s.scores[who]
      // Some nominators never scored — they nominated and didn't turn up.
      if (score === undefined) continue
      if (score >= s.average) continue
      if (!worst || score - s.average < worst.score - worst.song.average) {
        worst = { who, song: s, score }
      }
    }
  }
  return worst
}

export interface Crown {
  year: number
  award: AwardDef
  winners: string[]
  value: number
}

/** Winner(s) of each award in each year; ties share the crown. */
export function crownHistory(data: Dataset): Crown[] {
  const crowns: Crown[] = []
  for (const y of data.years) {
    const stats = data.perYear[y.year]
    for (const award of AWARDS) {
      let board = yearBoard(stats, award.key)
      if (award.key === 'nominator') board = board.filter((e) => !Number.isNaN(e.value))
      if (!board.length) continue
      const best = board[0].value
      const eps = award.key === 'nominator' ? 0.05 : award.key === 'clairvoyant' ? 0.005 : 1e-9
      const winners = board.filter((e) => Math.abs(e.value - best) <= eps).map((e) => e.name)
      crowns.push({ year: y.year, award, winners, value: best })
    }
  }
  return crowns
}
