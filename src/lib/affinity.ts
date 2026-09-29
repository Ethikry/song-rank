/**
 * Taking a correlation apart.
 *
 * A correlation says two things move together; it never says on what. Every
 * pairing on this site — two rankers on the taste web, two artists on the
 * artist web — is a Pearson r, and Pearson's numerator is Σ(aᵢ − ā)(bᵢ − b̄): a
 * sum of per-observation terms. Each term is positive when both sides sat on
 * the same side of their own average and negative when they split, sized by how
 * far out they both went.
 *
 * So the terms *are* the reasons, and grouping them says which names built the
 * number. Dividing by the same denominator r uses makes them shares that add
 * back up to r, so "these four are 40% of a 0.55" is literally true.
 *
 * Two things this deliberately gets right, both of which a first version of it
 * got wrong by asking instead "which artists did both rate above their own
 * baseline":
 *
 *   - **Shared dislikes count.** Two people who both put an artist well below
 *     their own average agree, and drive their correlation just as hard as a
 *     shared favourite. Dropping those described a friendlier pair than the
 *     data does — for one pairing it hid a third of the whole number.
 *   - **Agreeing a lot beats agreeing mildly.** One side at +0.3 and the other
 *     at +3.0 is weak evidence of common ground; both at +2 is strong. A
 *     product of deviations says so; a test of "both above zero" cannot.
 */
import { mean } from './stats'
import type { Dataset, Song } from './types'

export interface Contribution {
  key: string
  /** Observations behind this key. */
  n: number
  /**
   * This key's share of the correlation in **r's own units** — signed, and
   * summing across every key and both directions returns r exactly.
   */
  share: number
  /**
   * The same thing as a proportion of r, which is what prose wants: 0.33 of a
   * 0.55 correlation is 60% of it, not 33%. Positive for both pairing types —
   * a nemesis pairing has a negative r *and* negative contributions, and their
   * ratio is "how much of why they're opposed".
   */
  fraction: number
  /** Mean deviation from each side's own average across this key's observations. */
  devA: number
  devB: number
  /**
   * `up` / `down`: both sides above or both below their own average, the two
   * ways of agreeing. `split`: they went opposite ways, which is what pushes a
   * correlation down.
   */
  direction: 'up' | 'down' | 'split'
}

export interface DecomposeOptions {
  minItems?: number
  limit?: number
  /**
   * `agree` returns the keys that built the correlation up, `disagree` the ones
   * holding it down. For a nemesis pairing the second is the interesting half:
   * a strong negative r is a list of things they went to war over.
   */
  want?: 'agree' | 'disagree'
}

/**
 * Split a Pearson correlation into the parts that made it.
 *
 * Each observation carries a value for both sides and one or more keys to
 * attribute its contribution to. Both uses below are the same shape with the
 * axes swapped: two rankers decomposed over songs (grouped by artist), and two
 * artists decomposed over the rankers who scored both.
 */
export function decomposeCorrelation(
  items: { a: number; b: number; keys: string[] }[],
  { minItems = 2, limit = 4, want = 'agree' }: DecomposeOptions = {},
): Contribution[] {
  if (items.length < 2) return []
  const baseA = mean(items.map((x) => x.a))
  const baseB = mean(items.map((x) => x.b))

  let ssA = 0
  let ssB = 0
  for (const { a, b } of items) {
    ssA += (a - baseA) ** 2
    ssB += (b - baseB) ** 2
  }
  const denom = Math.sqrt(ssA * ssB)
  // A side that gave every observation the same value has no deviations to
  // attribute, and no correlation either.
  if (!denom) return []

  // r itself, from the same terms — so `fraction` is measured against the exact
  // number on screen rather than one recomputed a second way.
  let num = 0
  for (const { a, b } of items) num += (a - baseA) * (b - baseB)
  const r = num / denom
  const asFraction = (share: number) => (Math.abs(r) > 1e-9 ? share / r : 0)

  const byKey = new Map<string, { devA: number[]; devB: number[]; contrib: number }>()
  for (const { a, b, keys } of items) {
    const da = a - baseA
    const db = b - baseB
    for (const key of keys) {
      const entry = byKey.get(key) ?? { devA: [], devB: [], contrib: 0 }
      entry.devA.push(da)
      entry.devB.push(db)
      entry.contrib += (da * db) / denom
      byKey.set(key, entry)
    }
  }

  const out: Contribution[] = []
  for (const [key, { devA, devB, contrib }] of byKey) {
    if (devA.length < minItems) continue
    const mA = mean(devA)
    const mB = mean(devB)
    const agreed = mA > 0 === mB > 0
    if (want === 'agree') {
      // A positive total can still hide two observations pulling opposite ways,
      // which has no honest one-word label — so the direction has to be agreed
      // on average as well as in sum.
      if (contrib <= 0 || !agreed) continue
      out.push({ key, n: devA.length, share: contrib, fraction: asFraction(contrib), devA: mA, devB: mB, direction: mA > 0 ? 'up' : 'down' })
    } else {
      // Same test in reverse: a genuine split is negative in sum *and* opposed
      // on average, so one loud song can't dress up an artist they broadly
      // agreed on as a battleground.
      if (contrib >= 0 || agreed) continue
      out.push({ key, n: devA.length, share: contrib, fraction: asFraction(contrib), devA: mA, devB: mB, direction: 'split' })
    }
  }
  // Biggest magnitude first either way — for `disagree` that means the most
  // negative, which is the deepest split rather than the shallowest.
  return out.sort(want === 'agree' ? byShare : byShareDesc).slice(0, limit)
}

/**
 * Order by share, then observations, then name.
 *
 * The name tiebreak is load-bearing: two keys can genuinely land on the same
 * share over the same number of observations, and without a total order the
 * winner is decided by Map insertion order — i.e. by the order the CSV happened
 * to list the songs in.
 *
 * The epsilon is load-bearing for the same reason. Float addition isn't
 * associative, so summing identical contributions in a different order leaves
 * shares that differ in the last bits — 4e-19 apart on values equal to sixteen
 * significant figures — which is enough for a raw subtraction to miss a tie and
 * reshuffle the list. Anything that close is the same number.
 */
function compareShare(x: Contribution, y: Contribution, sign: 1 | -1): number {
  const scale = Math.max(Math.abs(x.share), Math.abs(y.share), 1e-12)
  if (Math.abs(x.share - y.share) > scale * 1e-9) return (y.share - x.share) * sign
  return y.n - x.n || x.key.localeCompare(y.key)
}
const byShare = (x: Contribution, y: Contribution) => compareShare(x, y, 1)
const byShareDesc = (x: Contribution, y: Contribution) => compareShare(x, y, -1)

export interface SharedArtist extends Contribution {
  artist: string
}

/**
 * The artists behind a pair of rankers' affinity — or, with `want: 'disagree'`,
 * the ones behind their lack of it.
 *
 * `songs` must be the same pool the correlation was computed over: an all-time
 * pairing decomposed against a single year's songs would be explaining a number
 * that pool never produced.
 */
export function sharedArtistsIn(songs: Song[], a: string, b: string, opts?: DecomposeOptions): SharedArtist[] {
  const items = songs.flatMap((song) => {
    const sa = song.scores[a]
    const sb = song.scores[b]
    return sa !== undefined && sb !== undefined ? [{ a: sa, b: sb, keys: song.artists }] : []
  })
  return decomposeCorrelation(items, opts).map((c) => ({ ...c, artist: c.key }))
}

/** All-time flavour: the same decomposition over every song in the dataset. */
export function sharedArtists(data: Dataset, a: string, b: string, opts?: DecomposeOptions): SharedArtist[] {
  return sharedArtistsIn(data.allTime.songs, a, b, opts)
}

export interface NamedPair {
  kind: 'top' | 'love' | 'hate' | 'nemesis'
  a: string
  b: string
  corr: number
  overlap: number
  /**
   * What put them here: the artists they agree on, or — for the nemesis
   * pairing — the ones they split over.
   */
  drivers: SharedArtist[]
  /** Category label — fixed per kind, and the only title these carry. */
  category: string
  /**
   * How much correlation this pairing owes to the kind of agreement it was
   * picked for, in r's own units.
   */
  weight: number
}

const CATEGORY: Record<NamedPair['kind'], string> = {
  top: 'The closest pair',
  love: 'United by love',
  hate: 'United by loathing',
  nemesis: 'Furthest apart',
}

/**
 * Four pairings worth calling out, each with the reason it qualified.
 *
 * "Most unified by love/loathing" is measured in **r's own units**, not as a
 * proportion: a pairing whose whole 0.1 correlation comes from shared dislike
 * is 100% built on it and still a weaker fact than one where 60% of a 0.55 is.
 * Summing the signed shares weights the two together automatically.
 *
 * The nemesis pairing is picked on raw correlation like the closest one, and is
 * the only one whose drivers are the *disagreement* half — for two people at
 * the opposite ends of the room, what they split over is the whole story.
 */
export function namedPairs(
  songs: Song[],
  pairs: { a: string; b: string; corr: number; overlap: number }[],
): NamedPair[] {
  const scored = pairs
    .filter((p) => Number.isFinite(p.corr) && p.corr > 0)
    .map((p) => {
      // Weighed over *every* contributing artist, then trimmed for display. A
      // weight summed from the visible six would rank pairs by whether their
      // top of the list happened to be one-sided, not by whether the pairing is.
      const all = sharedArtistsIn(songs, p.a, p.b, { limit: Number.MAX_SAFE_INTEGER })
      const weightOf = (dir: 'up' | 'down') =>
        all.filter((d) => d.direction === dir).reduce((t, d) => t + d.share, 0)
      return { ...p, drivers: all.slice(0, 6), love: weightOf('up'), hate: weightOf('down') }
    })
    .filter((p) => p.drivers.length > 0)
  if (!scored.length) return []

  const best = <T>(list: T[], by: (x: T) => number) =>
    list.reduce((a, b) => (by(b) > by(a) ? b : a))

  const build = (
    kind: NamedPair['kind'],
    p: { a: string; b: string; corr: number; overlap: number; drivers: SharedArtist[] },
    weight: number,
  ): NamedPair => ({
    kind,
    a: p.a,
    b: p.b,
    corr: p.corr,
    overlap: p.overlap,
    drivers: p.drivers,
    category: CATEGORY[kind],
    weight,
  })

  const top = best(scored, (p) => p.corr)
  // Each category has to land on a different pairing, or the slide says the
  // same thing twice — the closest pair is very often also the most lopsided
  // one. Later picks skip whatever an earlier pick already took.
  const taken = new Set([`${top.a}|${top.b}`])
  const remaining = () => scored.filter((p) => !taken.has(`${p.a}|${p.b}`))

  const out: NamedPair[] = [build('top', top, top.corr)]
  for (const kind of ['love', 'hate'] as const) {
    const pool = remaining().filter((p) => p[kind] > 0)
    if (!pool.length) continue
    const pick = best(pool, (p) => p[kind])
    taken.add(`${pick.a}|${pick.b}`)
    out.push(build(kind, pick, pick[kind]))
  }

  // The opposite end of the board. Drawn from the unfiltered list — every
  // pairing above needed a positive correlation to decompose, and this one is
  // chosen for having the most negative.
  const foes = pairs.filter((p) => Number.isFinite(p.corr))
  if (foes.length) {
    const foe = foes.reduce((a, b) => (b.corr < a.corr ? b : a))
    if (foe.corr < 0) {
      const drivers = sharedArtistsIn(songs, foe.a, foe.b, { limit: 6, want: 'disagree' })
      if (drivers.length) out.push(build('nemesis', { ...foe, drivers }, foe.corr))
    }
  }
  return out
}

export interface PairDriver extends Contribution {
  participant: string
}

/**
 * The rankers behind a pair of *artists* sitting close on the artist web.
 *
 * The artist web correlates the two artists' affinity profiles — one number per
 * ranker, their average for that artist minus their own overall average — so
 * the observations here are people, and the decomposition names the people
 * whose enthusiasm (or coldness) the two artists share. `up` is a ranker who
 * runs hot on both relative to the average fan, `down` one who runs cold on
 * both.
 *
 * `affinity` must be the same profiles `artistWeb` built, for the same reason
 * the song pool has to match above.
 */
export function artistPairDrivers(
  affinityA: Map<string, number>,
  affinityB: Map<string, number>,
  opts?: DecomposeOptions,
): PairDriver[] {
  const items: { a: number; b: number; keys: string[] }[] = []
  for (const [who, va] of affinityA) {
    const vb = affinityB.get(who)
    // One observation per ranker, so the minimum item count is about how many
    // rankers back a claim, not how many songs.
    if (vb !== undefined) items.push({ a: va, b: vb, keys: [who] })
  }
  return decomposeCorrelation(items, { minItems: 1, ...opts }).map((c) => ({ ...c, participant: c.key }))
}
