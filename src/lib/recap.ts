import type { Dataset, Song } from './types'
import { AWARDS, crownHistory, yearBoard, type AwardDef } from './awards'
import { displayName } from './names'
import { fmt } from './format'
import { SITE } from './site'

export type RecapScope = number | 'all'

export interface AwardFinish {
  award: AwardDef
  place: number
  value: number
  year?: number
}

export interface RecapData {
  scope: RecapScope
  name: string
  years: number[]
  songsScored: number
  avgGiven: number
  roomAvg: number
  /** share of the cohort they graded more kindly than (0..1) */
  kinderThan: number
  /** every score they handed out in scope (for the mini distribution) */
  scores: number[]
  /** scores of 10+ (the 11 not included — it has its own card) */
  tens: number
  /** rock-bottom scores (1 or lower) */
  ones: number
  elevens: Song[]
  hotTake: { song: Song; score: number; dev: number } | null
  /** closest matches, best first (up to 5) */
  twins: { other: string; corr: number }[]
  nemesis: { other: string; corr: number } | null
  /** their highest-rated artists, best first (up to 5, 3+ songs each) */
  topArtists: { artist: string; avg: number; n: number }[]
  /** their highest personally-scored songs in scope, best first (up to 5) */
  topSongs: Song[]
  /** their own favorite song by the #1 artist (highest score given, ties → better rank) */
  topArtistFav: Song | null
  /** hero image for the share card: a 10+ by their #1 artist, else an 11, else their best */
  cardSong: Song | null
  /** the whole cohort's generosity (avgGiven), for placing them among graders */
  cohortAvgs: { name: string; avg: number }[]
  noms: {
    count: number
    avgPercentile: number
    top10Count: number
    best: { song: Song; fieldSize: number }
    favArtist: { artist: string; n: number } | null
  } | null
  awardFinishes: AwardFinish[]
  reds: number
  greens: number
  /**
   * Notes they typed while ranking, longest first. Empty both for someone who
   * stayed silent and for a scope whose sheets never collected notes — the
   * `scopeHasComments` flag tells those two cases apart.
   */
  notes: { song: Song; score: number; text: string }[]
  scopeHasComments: boolean
  commentRate: number
  closing: string
}

/** "kinder than 88%" above the median, "harsher than 76%" below it. */
export function kindnessPhrase(r: RecapData): { word: string; pct: number } {
  return r.kinderThan >= 0.5
    ? { word: 'kinder', pct: Math.round(r.kinderThan * 100) }
    : { word: 'harsher', pct: Math.round((1 - r.kinderThan) * 100) }
}

export function buildRecap(data: Dataset, scope: RecapScope, name: string): RecapData | null {
  const isAll = scope === 'all'
  const base = isAll ? data.allTime.participantStats[name] : data.perYear[scope]?.participantStats[name]
  if (!base || base.songsScored === 0) return null

  const songsPool = isAll ? data.allTime.songs : data.perYear[scope].songs
  const cohort = isAll ? data.allTime.participants : data.perYear[scope].participants
  const cohortBoard = cohort
    .map((p) => (isAll ? data.allTime.participantStats[p] : data.perYear[scope].participantStats[p]))
    .filter((s) => s && s.songsScored >= 10)
    .map((s) => ({ name: s.name, avg: s.avgGiven }))
  const cohortAvgs = cohortBoard.map((s) => s.avg)
  const pairwise = isAll ? data.allTime.pairwise : data.perYear[scope].pairwise

  const scored = songsPool
    .filter((s) => s.scores[name] !== undefined)
    .map((s) => ({ song: s, score: s.scores[name], dev: s.scores[name] - s.average }))

  const kinderThan = cohortAvgs.filter((a) => a < base.avgGiven).length / Math.max(1, cohortAvgs.length - 1)

  const hotTake = [...scored].sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev))[0] ?? null

  const pairs = pairwise
    .filter((p) => p.a === name || p.b === name)
    .map((p) => ({ other: p.a === name ? p.b : p.a, corr: p.corr }))
    .filter((p) => Number.isFinite(p.corr))
    .sort((a, b) => b.corr - a.corr)

  const byArtist = new Map<string, number[]>()
  for (const { song, score } of scored) {
    for (const a of song.artists) {
      if (!byArtist.has(a)) byArtist.set(a, [])
      byArtist.get(a)!.push(score)
    }
  }
  /**
   * A single year's field is small — plenty of artists appear once — so the
   * yearly list takes every artist a ranker scored, thin catalogue and all. An
   * artist with one song they adored belongs on their year in a way a three-song
   * threshold kept hiding.
   *
   * The cost of that is real and is paid elsewhere rather than here: a lone high
   * score now tops the list ahead of a six-song favourite, so **the hero image no
   * longer follows the list blindly** — see `topArtistLove` below, which still
   * demands either a real catalogue or the super vote before an artist takes the
   * card. The list is a list; the picture is a claim.
   *
   * All-time keeps the flat three — over four years there is enough catalogue for
   * an average to mean something on its own.
   */
  const elevenArtists = new Set(scored.filter((e) => e.score === 11).flatMap((e) => e.song.artists))
  const topArtists = [...byArtist.entries()]
    .filter(([, v]) => !isAll || v.length >= 3)
    .map(([artist, v]) => ({ artist, n: v.length, avg: v.reduce((x, y) => x + y, 0) / v.length }))
    // ties favor the artist with more songs
    .sort((a, b) => b.avg - a.avg || b.n - a.n)
    .slice(0, 5)

  const topArtistFav = topArtists[0]
    ? (scored
        .filter((e) => e.song.artists.includes(topArtists[0].artist))
        .sort((a, b) => b.score - a.score || a.song.rank - b.song.rank)[0]?.song ?? null)
    : null

  const topSongs = [...scored]
    .sort((a, b) => b.score - a.score || a.song.rank - b.song.rank)
    .map((e) => e.song)
    .slice(0, 5)

  // Nomination record within scope
  const nomStats = isAll ? data.allTime.nominators[name] : data.perYear[scope].nominators[name]
  let noms: RecapData['noms'] = null
  if (nomStats && nomStats.count > 0) {
    const best = [...nomStats.noms].sort(
      (a, b) => a.song.rank / a.fieldSize - b.song.rank / b.fieldSize,
    )[0]
    const artistCounts = new Map<string, number>()
    for (const { song } of nomStats.noms) {
      for (const a of song.artists) artistCounts.set(a, (artistCounts.get(a) ?? 0) + 1)
    }
    const fav = [...artistCounts.entries()].sort((a, b) => b[1] - a[1])[0]
    noms = {
      count: nomStats.count,
      avgPercentile: nomStats.avgPercentile,
      top10Count: nomStats.top10Count,
      best,
      favArtist: fav && fav[1] >= 2 ? { artist: fav[0], n: fav[1] } : null,
    }
  }

  const awardFinishes: AwardFinish[] = []
  if (isAll) {
    for (const crown of crownHistory(data)) {
      if (crown.winners.includes(name)) {
        awardFinishes.push({ award: crown.award, place: 1, value: crown.value, year: crown.year })
      }
    }
  } else {
    for (const award of AWARDS) {
      const board = yearBoard(data.perYear[scope], award.key).filter((e) => Number.isFinite(e.value))
      const place = board.findIndex((e) => e.name === name) + 1
      if (place >= 1 && place <= 3) awardFinishes.push({ award, place, value: board[place - 1].value })
    }
  }

  const roomAvg = songsPool.reduce((a, s) => a + s.average, 0) / songsPool.length
  const years = isAll
    ? data.years.filter((y) => y.participants.includes(name)).map((y) => y.year)
    : [scope]
  const elevens = isAll
    ? data.allTime.participantStats[name].elevens
    : data.perYear[scope].participantStats[name].elevens

  /**
   * Hero image for the share card. Their #1 artist only earns the slot if they
   * actually loved one of that artist's songs (10+) — topArtists ranks by average,
   * so a merely-well-liked artist can top it without any standout song. Failing
   * that a super vote, and failing that their highest score, so the card is never
   * left imageless.
   */
  /** How many people rated a song 10+. The fewer, the more the pick is theirs alone. */
  const adorers = (s: Song) => Object.values(s.scores).filter((v) => v >= 10).length

  /**
   * Least-shared candidate first, so two rankers rarely end up with the same hero
   * image — the room's consensus darlings were crowding it out. This only chooses
   * *between* songs that already clear the bar below; it never promotes a song past
   * that bar, and with a single candidate it changes nothing.
   */
  const mostPersonal = (cands: Song[]): Song | null =>
    [...cands].sort(
      (a, b) =>
        adorers(a) - adorers(b) ||
        // then whoever they rated furthest above the room
        (b.scores[name] - b.average) - (a.scores[name] - a.average) ||
        a.rank - b.rank,
    )[0] ?? null

  /**
   * Hero image, in order of how strong a claim each candidate has:
   *
   *   1. a super vote for their #1 artist — the best of both signals
   *   2. their #1 artist's other songs they scored 10+
   *   3. any super vote
   *   4. anything at their highest score
   *
   * The favourite artist outranks a stray 11 deliberately. An 11 can be a single
   * song someone thought was extraordinary; the artist they rated highest across
   * the year is the better summary of it. The super vote only takes the card when
   * the favourite artist has nothing they scored 10+.
   *
   * Within a tier, `mostPersonal` decides — it ranks by how few other people also
   * adored a song. It must not decide *across* tiers, or a lightly-shared 10 takes
   * the card from the 11 they spent on the same artist.
   */
  /*
   * The yearly list admits one-song artists (see topArtists), which means the
   * name at the top of it is sometimes just wherever a single high score landed.
   * That is fine for a list and wrong for the hero image, so the artist has to
   * clear a bar before the card is theirs: a real catalogue behind the average,
   * or the ranker's one super vote spent on them.
   *
   * An artist who clears neither doesn't fall back to their next-favourite
   * artist — it drops straight through to the super vote and then to their
   * highest score, which are claims about the ranker rather than about a
   * one-song average.
   */
  const heroArtist =
    topArtists[0] && (topArtists[0].n >= 3 || elevenArtists.has(topArtists[0].artist))
      ? topArtists[0].artist
      : null
  const favLoved = heroArtist
    ? scored.filter((e) => e.song.artists.includes(heroArtist) && e.score >= 10)
    : []
  const topArtistLove =
    mostPersonal(favLoved.filter((e) => e.score === 11).map((e) => e.song)) ??
    mostPersonal(favLoved.map((e) => e.song))
  // last resort: everything tied at their highest score, least-shared first
  const bestScore = scored.length ? Math.max(...scored.map((e) => e.score)) : null
  const bestSongs = bestScore === null ? [] : scored.filter((e) => e.score === bestScore).map((e) => e.song)
  const cardSong = topArtistLove ?? mostPersonal(elevens) ?? mostPersonal(bestSongs)

  let closing: string
  const crowned = awardFinishes.find((f) => f.place === 1)
  if (crowned) {
    closing = isAll
      ? `${awardFinishes.filter((f) => f.place === 1).length} crown${awardFinishes.filter((f) => f.place === 1).length === 1 ? '' : 's'} and counting.`
      : `You wore a crown this year — ${crowned.award.title}.`
  } else if (base.reds >= 15) {
    closing = `${base.reds} times you were the room's lone dissenter. Someone has to keep the standards up.`
  } else if (base.greens >= 15) {
    closing = `${base.greens} greens. You came to celebrate, and it shows.`
  } else if (base.corrToAvg >= 0.65) {
    closing = `A ${fmt(base.corrToAvg, 2)} correlation with the room — you basically ARE the consensus.`
  } else if (base.corrToAvg <= 0.3) {
    closing = `A ${fmt(base.corrToAvg, 2)} correlation with the room. You heard different songs entirely.`
  } else {
    closing = `Another year in the books. See you at the next party rank.`
  }

  const notes = scored
    .filter((e) => e.song.comments?.[name])
    .map((e) => ({ song: e.song, score: e.score, text: e.song.comments![name] }))
    .sort((a, b) => b.text.length - a.text.length)
  const scopeHasComments = isAll
    ? data.years.some((y) => y.hasComments)
    : (data.years.find((y) => y.year === scope)?.hasComments ?? false)

  const scoreValues = scored.map((s) => s.score)
  return {
    scope,
    name,
    years,
    songsScored: base.songsScored,
    avgGiven: base.avgGiven,
    roomAvg,
    kinderThan,
    scores: scoreValues,
    tens: scoreValues.filter((v) => v >= 10 && v !== 11).length,
    ones: scoreValues.filter((v) => v <= 1).length,
    elevens,
    hotTake,
    twins: pairs.slice(0, 5),
    nemesis: pairs.length > 1 ? pairs[pairs.length - 1] : null,
    topArtists,
    topSongs,
    topArtistFav,
    cardSong,
    cohortAvgs: cohortBoard,
    noms,
    awardFinishes,
    reds: base.reds,
    greens: base.greens,
    notes,
    scopeHasComments,
    commentRate: base.commentRate,
    closing,
  }
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

export function recapFileName(r: RecapData): string {
  const scope = r.scope === 'all' ? 'all-time' : r.scope
  return `${SITE.storagePrefix}-recap-${scope}-${displayName(r.name).replace(/[^\w-]+/g, '_')}.png`
}
