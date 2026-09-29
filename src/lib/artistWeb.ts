import type { Dataset, PairwiseEntry } from './types'
import { pearson } from './stats'

/** A pairing, plus which way the shared feeling runs. */
export interface ArtistPair extends PairwiseEntry {
  /**
   * Mean joint affinity across the raters the correlation was measured over:
   * the average of the two artists' deviations from each ranker's own baseline.
   *
   * The correlation says two artists are felt about *alike*; this says whether
   * that feeling is warm or cold. They're independent — a pair of artists the
   * room quietly dislikes correlates exactly as strongly as a beloved pair, and
   * without this the web could only ever say "these go together" and never
   * "…and everyone loves them".
   */
  tone: number
}

/**
 * How closely two artists' fanbases overlap: for each participant, take their
 * affinity for an artist (their average for that artist minus their own
 * overall average), then correlate those affinity profiles between artists.
 * High correlation = the same people run hot (and cold) on both.
 */
export function artistWeb(
  data: Dataset,
  minSongs = 3,
  minOverlap = 12,
): {
  names: string[]
  pairs: ArtistPair[]
  /**
   * The per-artist affinity profiles the correlations were built from, kept so
   * a pairing can be decomposed back into the rankers who made it — see
   * `artistPairDrivers` in affinity.ts. Returning them beats recomputing:
   * a second, separately-derived profile could drift from the one the number
   * on screen actually came from.
   */
  vectors: Map<string, Map<string, number>>
} {
  const artists = Object.values(data.allTime.artists).filter((a) => a.count >= minSongs)

  const vectors = new Map<string, Map<string, number>>()
  for (const a of artists) {
    const scoresBy = new Map<string, number[]>()
    for (const s of a.songs) {
      for (const [who, v] of Object.entries(s.scores)) {
        if (!scoresBy.has(who)) scoresBy.set(who, [])
        scoresBy.get(who)!.push(v)
      }
    }
    const affinity = new Map<string, number>()
    for (const [who, vs] of scoresBy) {
      if (vs.length >= Math.min(2, a.count)) {
        const base = data.allTime.participantStats[who]?.avgGiven
        if (base !== undefined) affinity.set(who, vs.reduce((x, y) => x + y, 0) / vs.length - base)
      }
    }
    vectors.set(a.name, affinity)
  }

  const names = artists.map((a) => a.name)
  const pairs: ArtistPair[] = []
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const va = vectors.get(names[i])!
      const vb = vectors.get(names[j])!
      const xs: number[] = []
      const ys: number[] = []
      for (const [who, d] of va) {
        const d2 = vb.get(who)
        if (d2 !== undefined) {
          xs.push(d)
          ys.push(d2)
        }
      }
      if (xs.length >= minOverlap) {
        // Averaged over exactly the raters the correlation used, so the colour
        // and the number on a thread describe the same set of people.
        const tone = xs.reduce((sum, x, k) => sum + (x + ys[k]) / 2, 0) / xs.length
        pairs.push({ a: names[i], b: names[j], corr: pearson(xs, ys), overlap: xs.length, tone })
      }
    }
  }
  return { names, pairs, vectors }
}
