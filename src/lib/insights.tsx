import type { ReactNode } from 'react'
import type { Dataset, Song } from './types'
import { Name, SongNote, SongTitle, YearLink } from '../components/bits'
import { fmt } from './format'

export interface Fact {
  k: string
  /** ReactNode, not string: names, titles and years are rendered as links. */
  v: ReactNode
  d?: ReactNode
}

// Both live in stats.ts with the rest of the arithmetic; re-exported here
// because every page already reaches for them through insights.
import { allScores, yearMeans } from './stats'
export { allScores, yearMeans }

/** Marginalia: short superlatives computed across all years. */
export function marginalia(data: Dataset): Fact[] {
  const facts: Fact[] = []
  const { allTime } = data
  const ps = Object.values(allTime.participantStats)

  const regulars = ps.filter((p) => p.songsScored >= 100)
  if (regulars.length) {
    const steady = [...regulars].sort((a, b) => a.stddevGiven - b.stddevGiven)[0]
    const wild = [...regulars].sort((a, b) => b.stddevGiven - a.stddevGiven)[0]
    facts.push({
      k: 'Steadiest hand',
      v: <Name n={steady.name} />,
      d: `σ ${fmt(steady.stddevGiven)} across ${steady.songsScored} scores — barely moves the needle`,
    })
    facts.push({
      k: 'Widest range',
      v: <Name n={wild.name} />,
      d: `σ ${fmt(wild.stddevGiven)} — feast or famine`,
    })
    const kind = [...regulars].sort((a, b) => b.avgGiven - a.avgGiven)[0]
    const harsh = [...regulars].sort((a, b) => a.avgGiven - b.avgGiven)[0]
    facts.push({ k: 'Kindest grader', v: <Name n={kind.name} />, d: `hands out ${fmt(kind.avgGiven)} on average` })
    facts.push({ k: 'Harshest grader', v: <Name n={harsh.name} />, d: `a mean of just ${fmt(harsh.avgGiven)}` })
  }

  const means = yearMeans(data)
  const harshYear = [...means].sort((a, b) => a.mean - b.mean)[0]
  const kindYear = [...means].sort((a, b) => b.mean - a.mean)[0]
  facts.push({
    k: 'Toughest crowd',
    v: <YearLink y={harshYear.year} />,
    d: (
      <>
        songs averaged {fmt(harshYear.mean)} — vs {fmt(kindYear.mean)} in <YearLink y={kindYear.year} />
      </>
    ),
  })

  // Best and worst 11 placements
  const elevenPlacements = ps.flatMap((p) =>
    p.elevens.map((s) => ({ who: p.name, song: s, pctile: s.rank / data.perYear[s.year].songs.length })),
  )
  if (elevenPlacements.length) {
    const golden = ps
      .filter((p) => p.elevens.length >= 2)
      .map((p) => ({
        who: p.name,
        avg:
          p.elevens.reduce((a, s) => a + s.rank / data.perYear[s.year].songs.length, 0) / p.elevens.length,
        n: p.elevens.length,
      }))
      .sort((a, b) => a.avg - b.avg)[0]
    if (golden) {
      facts.push({
        k: 'Golden elevens',
        v: <Name n={golden.who} />,
        d: `their ${golden.n} super votes land in the top ${Math.round(golden.avg * 100)}% on average`,
      })
    }
    const doomed = [...elevenPlacements].sort((a, b) => b.pctile - a.pctile)[0]
    facts.push({
      k: 'Most doomed eleven',
      v: (
        <>
          <Name n={doomed.who} /> → “<SongTitle s={doomed.song} />”
        </>
      ),
      d: (
        <>
          an 11 for a song that finished #{doomed.song.rank} of {data.perYear[doomed.song.year].songs.length} (
          <YearLink y={doomed.song.year} />)
          <SongNote s={doomed.song} who={doomed.who} />
        </>
      ),
    })
  }

  const mostCosigned = [...allTime.songs].sort((a, b) => b.nominators.length - a.nominators.length)[0]
  if (mostCosigned && mostCosigned.nominators.length > 1) {
    facts.push({
      k: 'Most co-signed nomination',
      v: (
        <>
          “<SongTitle s={mostCosigned} />”
        </>
      ),
      d: (
        <>
          {mostCosigned.nominators.length} nominators (<YearLink y={mostCosigned.year} />) — it finished #
          {mostCosigned.rank}
        </>
      ),
    })
  }

  // Biggest single hot take ever
  let take: { who: string; song: Song; dev: number } | null = null
  for (const s of allTime.songs) {
    for (const [who, v] of Object.entries(s.scores)) {
      const dev = v - s.average
      if (!take || Math.abs(dev) > Math.abs(take.dev)) take = { who, song: s, dev }
    }
  }
  if (take) {
    const { who, song } = take
    facts.push({
      k: 'Hottest take on record',
      v: (
        <>
          <Name n={who} /> on “<SongTitle s={song} />”
        </>
      ),
      d: (
        <>
          scored it {song.scores[who]} against a {fmt(song.average)} consensus (<YearLink y={song.year} />)
          <SongNote s={song} who={who} />
        </>
      ),
    })
  }

  const bestClimbers = Object.values(allTime.nominators)
    .filter((n) => n.count >= 3 && n.top10Count === n.count)
    .sort((a, b) => b.count - a.count)[0]
  if (bestClimbers) {
    facts.push({
      k: 'Never missed',
      v: <Name n={bestClimbers.name} />,
      d: `all ${bestClimbers.count} of their nominations made the top 10`,
    })
  }

  return facts
}

/** All 11s handed out in one year: who → song. */
export function elevensOfYear(data: Dataset, year: number): { who: string; song: Song }[] {
  const ys = data.perYear[year]
  return ys.participants
    .flatMap((p) => ys.participantStats[p].elevens.map((s) => ({ who: p, song: s })))
    .sort((a, b) => a.song.rank - b.song.rank)
}
