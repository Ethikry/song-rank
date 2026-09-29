import type {
  AllTimeStats,
  ArtistStats,
  Dataset,
  NominatorStats,
  PairwiseEntry,
  ParticipantAllTime,
  ParticipantYearStats,
  Song,
  YearData,
  YearStats,
} from './types'

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN
}

/** Middle value, averaging the two middles on an even count. NaN when empty. */
export function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length / 2
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[mid - 1] + s[mid]) / 2
}

/** Sample standard deviation (matches Google Sheets STDEV). */
export function sampleStddev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}

export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 2) return NaN
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx
    const b = ys[i] - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  const den = Math.sqrt(dx * dy)
  return den === 0 ? NaN : num / den
}

/** Mean of each year's song averages — "how kind was the room that year". */
export function yearMeans(data: Dataset): { year: number; mean: number; spread: number }[] {
  return data.years.map((y) => ({
    year: y.year,
    mean: mean(y.songs.map((s) => s.average)),
    // Average within-song disagreement, not the spread of the averages: the
    // question is how much the room argued about a typical song, which a year
    // of uniformly contentious songs answers very differently from a year split
    // between universal darlings and universal duds.
    spread: mean(y.songs.map((s) => s.stddev)),
  }))
}

/** Every score a given set of songs received. */
export function allScores(songs: Song[]): number[] {
  return songs.flatMap((s) => Object.values(s.scores))
}

/** Half-point bins from 1 to 11 — the shape of a score distribution, 21 buckets wide. */
export const SCORE_BINS = 21

/** Index → the score that bin represents (0 → 1, 20 → 11). */
export const binScore = (i: number): number => 1 + i / 2

export function scoreBins(values: number[]): number[] {
  const bins = new Array(SCORE_BINS).fill(0)
  for (const v of values) {
    const i = Math.round((v - 1) * 2)
    if (i >= 0 && i < bins.length) bins[i]++
  }
  return bins
}

interface ScorePair {
  score: number
  songAvg: number
}

function participantScorePairs(songs: Song[], name: string): ScorePair[] {
  const pairs: ScorePair[] = []
  for (const s of songs) {
    const v = s.scores[name]
    if (v !== undefined) pairs.push({ score: v, songAvg: s.average })
  }
  return pairs
}

/**
 * Reds/greens replicate the master sheet's counting rules (validated exactly
 * against every year's published Data Analysis tab):
 * - red   = gave the song's lowest score (ties count)
 * - green = gave the song's highest score, or any score >= 10 — but a
 *   participant's 11 is NOT a green: each participant has a single 11
 *   ("super vote"), tracked as its own category.
 */
function redsGreens(songs: Song[], name: string): { reds: number; greens: number; elevens: Song[] } {
  let reds = 0
  let greens = 0
  const elevens: Song[] = []
  for (const s of songs) {
    const v = s.scores[name]
    if (v === undefined) continue
    const values = Object.values(s.scores)
    if (v === Math.min(...values)) reds++
    if (v === 11) elevens.push(s)
    else if (v === Math.max(...values) || v >= 10) greens++
  }
  return { reds, greens, elevens }
}

/**
 * Commenting habits over a set of songs. The rate is per song *scored*, not per
 * song in the field, so someone who joined late isn't counted as silent on
 * songs they never saw.
 */
function commentStats(
  songs: Song[],
  name: string,
): { commentCount: number; commentRate: number; avgCommentLength: number } {
  const lengths: number[] = []
  let scored = 0
  for (const s of songs) {
    if (s.scores[name] === undefined) continue
    scored++
    const text = s.comments?.[name]
    if (text) lengths.push(text.length)
  }
  return {
    commentCount: lengths.length,
    commentRate: scored ? lengths.length / scored : 0,
    avgCommentLength: lengths.length ? mean(lengths) : NaN,
  }
}

function computeParticipantYear(name: string, year: number, songs: Song[]): ParticipantYearStats {
  const pairs = participantScorePairs(songs, name)
  const scores = pairs.map((p) => p.score)
  const { reds, greens, elevens } = redsGreens(songs, name)
  const totalAbsDiff = pairs.reduce((a, p) => a + Math.abs(p.score - p.songAvg), 0)
  return {
    name,
    year,
    songsScored: scores.length,
    avgGiven: mean(scores),
    stddevGiven: sampleStddev(scores),
    minGiven: Math.min(...scores),
    maxGiven: Math.max(...scores),
    reds,
    greens,
    elevens,
    corrToAvg: pearson(pairs.map((p) => p.score), pairs.map((p) => p.songAvg)),
    totalAbsDiff,
    avgAbsDiff: scores.length ? totalAbsDiff / scores.length : NaN,
    ...commentStats(songs, name),
  }
}

function computePairwise(songs: Song[], names: string[], minOverlap: number): PairwiseEntry[] {
  const out: PairwiseEntry[] = []
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const xs: number[] = []
      const ys: number[] = []
      for (const s of songs) {
        const a = s.scores[names[i]]
        const b = s.scores[names[j]]
        if (a !== undefined && b !== undefined) {
          xs.push(a)
          ys.push(b)
        }
      }
      if (xs.length >= minOverlap) {
        out.push({ a: names[i], b: names[j], corr: pearson(xs, ys), overlap: xs.length })
      }
    }
  }
  return out
}

/**
 * Rank a year's field by average score, optionally with one voter's ballot
 * struck from every song.
 *
 * Tied songs take their block's average rank — the same rule the Borda tally
 * uses (`lib/consensus.ts`). Handing tied songs consecutive ranks would invent
 * an ordering out of whatever order the rows arrived in, and here that
 * invention would land on somebody's nomination record.
 */
function rankByAverage(songs: Song[], without?: string): Map<Song, number> {
  const rows = songs
    .map((s) => {
      const vals = Object.entries(s.scores)
        .filter(([who]) => who !== without)
        .map(([, v]) => v)
      return { s, avg: vals.length ? mean(vals) : -Infinity }
    })
    .sort((a, b) => b.avg - a.avg)
  const out = new Map<Song, number>()
  let i = 0
  while (i < rows.length) {
    let j = i
    while (j + 1 < rows.length && Math.abs(rows[j + 1].avg - rows[i].avg) < 1e-9) j++
    const rank = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) out.set(rows[k].s, rank)
    i = j + 1
  }
  return out
}

function computeNominators(songsByYear: Song[][]): Record<string, NominatorStats> {
  const map = new Map<string, NominatorStats['noms']>()
  for (const songs of songsByYear) {
    const fieldSize = songs.length
    /*
     * A nominator's own 11 on their own pick is the single most common way a
     * nomination beats the room, so their record is re-run over a board they
     * didn't vote on. One re-rank per nominator per year, cached here — the
     * alternative is one per nomination, and prolific nominators would redo the
     * identical sort a dozen times.
     */
    const neutral = new Map<string, Map<Song, number>>()
    const included = rankByAverage(songs)
    for (const s of songs) {
      for (const nom of s.nominators) {
        if (!neutral.has(nom)) neutral.set(nom, rankByAverage(songs, nom))
        if (!map.has(nom)) map.set(nom, [])
        map.get(nom)!.push({
          song: s,
          fieldSize,
          neutralRank: neutral.get(nom)!.get(s)!,
          includedRank: included.get(s)!,
        })
      }
    }
  }
  const out: Record<string, NominatorStats> = {}
  for (const [name, noms] of map) {
    out[name] = {
      name,
      noms,
      count: noms.length,
      avgRank: mean(noms.map((n) => n.song.rank)),
      avgPercentile: mean(noms.map((n) => n.song.rank / n.fieldSize)),
      top10Count: noms.filter((n) => n.song.rank <= 10).length,
      bottom10Count: noms.filter((n) => n.song.rank > n.fieldSize - 10).length,
      neutralAvgRank: mean(noms.map((n) => n.neutralRank)),
      neutralAvgPercentile: mean(noms.map((n) => n.neutralRank / n.fieldSize)),
      neutralTop10Count: noms.filter((n) => n.neutralRank <= 10).length,
      neutralBottom10Count: noms.filter((n) => n.neutralRank > n.fieldSize - 10).length,
    }
  }
  return out
}

export function computeYearStats(data: YearData): YearStats {
  const participantStats: Record<string, ParticipantYearStats> = {}
  for (const name of data.participants) {
    participantStats[name] = computeParticipantYear(name, data.year, data.songs)
  }
  return {
    year: data.year,
    participants: data.participants,
    songs: data.songs,
    participantStats,
    pairwise: computePairwise(data.songs, data.participants, 5),
    nominators: computeNominators([data.songs]),
    hasComments: data.hasComments ?? false,
  }
}

function computeArtists(songs: Song[]): Record<string, ArtistStats> {
  const map = new Map<string, Song[]>()
  for (const s of songs) {
    for (const artist of s.artists) {
      if (!map.has(artist)) map.set(artist, [])
      map.get(artist)!.push(s)
    }
  }
  const out: Record<string, ArtistStats> = {}
  for (const [name, list] of map) {
    const sorted = [...list].sort((a, b) => b.average - a.average)
    out[name] = {
      name,
      songs: sorted,
      count: list.length,
      avgScore: mean(list.map((s) => s.average)),
      best: sorted[0],
      worst: sorted[sorted.length - 1],
      firstPlaces: list.filter((s) => s.rank === 1).length,
      podiums: list.filter((s) => s.rank <= 3).length,
      top10s: list.filter((s) => s.rank <= 10).length,
    }
  }
  return out
}

function computeAllTime(years: YearData[], perYear: Record<number, YearStats>): AllTimeStats {
  const allSongs = years.flatMap((y) => y.songs)
  ;[...allSongs].sort((a, b) => b.average - a.average).forEach((s, i) => (s.overallRank = i + 1))
  const names = [...new Set(years.flatMap((y) => y.participants))]
  // Comment rates are measured only over years that actually collected comments.
  const commentedSongs = years.filter((y) => y.hasComments).flatMap((y) => y.songs)

  const participantStats: Record<string, ParticipantAllTime> = {}
  for (const name of names) {
    const yearsIn = years.filter((y) => y.participants.includes(name)).map((y) => y.year)
    const pairs = participantScorePairs(allSongs, name)
    const scores = pairs.map((p) => p.score)
    let reds = 0
    let greens = 0
    const elevens: Song[] = []
    for (const y of yearsIn) {
      const ps = perYear[y].participantStats[name]
      reds += ps.reds
      greens += ps.greens
      elevens.push(...ps.elevens)
    }
    const totalAbsDiff = pairs.reduce((a, p) => a + Math.abs(p.score - p.songAvg), 0)
    participantStats[name] = {
      name,
      years: yearsIn,
      songsScored: scores.length,
      avgGiven: mean(scores),
      stddevGiven: sampleStddev(scores),
      reds,
      greens,
      elevens,
      redsPerSong: scores.length ? reds / scores.length : 0,
      greensPerSong: scores.length ? greens / scores.length : 0,
      corrToAvg: pearson(pairs.map((p) => p.score), pairs.map((p) => p.songAvg)),
      totalAbsDiff,
      avgAbsDiff: scores.length ? totalAbsDiff / scores.length : NaN,
      ...commentStats(commentedSongs, name),
    }
  }

  return {
    years: years.map((y) => y.year),
    songs: allSongs,
    participants: names,
    participantStats,
    pairwise: computePairwise(allSongs, names, 10),
    nominators: computeNominators(years.map((y) => y.songs)),
    artists: computeArtists(allSongs),
  }
}

export function computeDataset(years: YearData[]): Dataset {
  const sorted = [...years].sort((a, b) => a.year - b.year)
  const perYear: Record<number, YearStats> = {}
  for (const y of sorted) perYear[y.year] = computeYearStats(y)
  return { years: sorted, perYear, allTime: computeAllTime(sorted, perYear) }
}
