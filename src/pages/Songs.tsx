import { Fragment, useMemo, useState } from 'react'
import { useScopedDataset } from '../components/identity'
import { useNavigate } from 'react-router-dom'
import { fmt, plural } from '../lib/format'
import { displayName } from '../lib/names'
import { ArtistCredit, Name, ScopeNote, ScoreBreakdown, ShowMore, SongCell, SongTitle, Tile, useParamState, useSort, YearScopePills } from '../components/bits'
import { categoryColor, ChartCaption, Scatter, YearLegend, yearColor } from '../components/charts'
import { isAllYears, onlyYear, parseYearScope, scopeIncludes, yearScopeParam, type YearScope } from '../lib/yearScope'
import type { Song } from '../lib/types'

type SortKey = 'overall' | 'year' | 'rank' | 'title' | 'artist' | 'average' | 'stddev'
type ColorBy = 'year' | 'artist' | 'nominator'

export default function Songs() {
  // Follows the edition preference; see components/identity.tsx.
  const dataset = useScopedDataset()
  const { allTime, years } = dataset
  const navigate = useNavigate()
  const [q, setQ] = useParamState('q', '')
  const [yearParam, setYearParam] = useParamState('year', 'all')
  const yearNums = years.map((y) => y.year)
  const scope = parseYearScope(yearParam, yearNums)
  const setScope = (s: YearScope) => setYearParam(yearScopeParam(s))
  const [open, setOpen] = useState<string | null>(null)
  const sort = useSort<SortKey>('overall', 1)

  // Colour defaults to year wherever more than one is in play, artist once a
  // single year is picked (where every dot would otherwise be the same colour).
  // An explicit choice wins.
  const [colorParam, setColorParam] = useParamState('color', 'auto')
  const colorBy: ColorBy =
    colorParam === 'auto' ? (onlyYear(scope) === null ? 'year' : 'artist') : (colorParam as ColorBy)
  const setColorBy = (c: ColorBy) => setColorParam(c)

  // Fixed from the full catalogue, never the filtered set — otherwise every
  // keystroke refits the axes and the surviving dots jump around.
  const domains = useMemo(() => {
    const pad = (vs: number[]): [number, number] => {
      const lo = Math.min(...vs)
      const hi = Math.max(...vs)
      const m = (hi - lo || 1) * 0.06
      return [lo - m, hi + m]
    }
    return { x: pad(allTime.songs.map((s) => s.average)), y: pad(allTime.songs.map((s) => s.stddev)) }
  }, [allTime.songs])

  const dotColor = (s: Song) => {
    if (colorBy === 'year') return yearColor(s.year, yearNums)
    if (colorBy === 'artist') return categoryColor(s.artists[0] ?? s.artist)
    return s.nominators.length ? categoryColor(s.nominators[0]) : 'var(--muted)'
  }

  const songs = useMemo(() => {
    let list = allTime.songs
    if (!isAllYears(scope)) list = list.filter((s) => scopeIncludes(scope, s.year))
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(needle) ||
          s.artist.toLowerCase().includes(needle) ||
          s.nominators.some((n) => displayName(n).toLowerCase().includes(needle)),
      )
    }
    const dir = sort.dir
    return [...list].sort((a, b) => {
      switch (sort.key) {
        case 'title':
          return a.title.localeCompare(b.title) * dir
        case 'artist':
          return a.artist.localeCompare(b.artist) * dir
        case 'year':
          return (a.year - b.year) * dir
        case 'rank':
          return (a.rank - b.rank) * dir
        case 'stddev':
          return (a.stddev - b.stddev) * dir
        case 'overall':
          return (a.overallRank - b.overallRank) * dir
        default:
          return (a.average - b.average) * dir
      }
    })
  }, [allTime.songs, q, yearParam, sort.key, sort.dir])

  const divisive = [...allTime.songs].sort((a, b) => b.stddev - a.stddev)[0]
  const consensus = [...allTime.songs].sort((a, b) => a.stddev - b.stddev)[0]
  const best = [...allTime.songs].sort((a, b) => b.average - a.average)[0]
  const elevenCounts = new Map<Song, number>()
  for (const y of years) {
    for (const p of y.participants) {
      for (const s of dataset.perYear[y.year].participantStats[p].elevens) {
        elevenCounts.set(s, (elevenCounts.get(s) ?? 0) + 1)
      }
    }
  }
  const mostLoved = [...elevenCounts.entries()].sort((a, b) => b[1] - a[1])[0]

  const th = (k: SortKey, label: string, cls = '', d: 1 | -1 = -1) => (
    <th className={`sortable ${cls}`} onClick={() => sort.toggle(k, d)}>
      {label}
      {sort.arrow(k)}
    </th>
  )

  return (
    <>
      <h1>Songs</h1>
      <p className="subtitle">Every song ever ranked. Click a row for everyone's scores.</p>

      <div className="tiles">
        <Tile value={<SongTitle s={best} />} label={`Best ever · avg ${fmt(best.average)}`} detail={`${best.artist} (${best.year})`} />
        <Tile
          value={<SongTitle s={divisive} />}
          label={`Most divisive · σ ${fmt(divisive.stddev)}`}
          detail={`${divisive.artist} (${divisive.year})`}
        />
        <Tile
          value={<SongTitle s={consensus} />}
          label={`Strongest consensus · σ ${fmt(consensus.stddev)}`}
          detail={`${consensus.artist} (${consensus.year})`}
        />
        {mostLoved && (
          <Tile
            value={<SongTitle s={mostLoved[0]} />}
            label={`Most 11s received (${mostLoved[1]})`}
            detail={`${mostLoved[0].artist} (${mostLoved[0].year})`}
          />
        )}
      </div>

      <h2>The field at a glance</h2>
      <p className="note">
        Right = higher average, up = more divisive. Click a dot to open the song.
      </p>

      <div className="controls">
        <input type="search" placeholder="Search song, artist, nominator…" value={q} onChange={(e) => setQ(e.target.value)} />
        <YearScopePills years={yearNums} scope={scope} onChange={setScope} />
        <div className="seg">
          {/* colouring by year is meaningless once a single year is selected */}
          {onlyYear(scope) === null && (
            <button className={colorBy === 'year' ? 'on' : ''} onClick={() => setColorBy('year')}>
              By year
            </button>
          )}
          <button className={colorBy === 'artist' ? 'on' : ''} onClick={() => setColorBy('artist')}>
            By artist
          </button>
          <button className={colorBy === 'nominator' ? 'on' : ''} onClick={() => setColorBy('nominator')}>
            By nominator
          </button>
        </div>
        <span className="note">{plural(songs.length, 'song')} — filters apply to the chart and the ledger</span>
        <ScopeNote scope={scope} years={yearNums} />
      </div>

      <Scatter
        points={songs.map((s) => ({
          x: s.average,
          y: s.stddev,
          label: `${s.title} — ${s.artist} (${s.year}) · avg ${fmt(s.average)}, σ ${fmt(s.stddev)}, #${s.overallRank} all-time`,
          color: dotColor(s),
          onClick: () => navigate(`/song/${s.year}/${encodeURIComponent(s.id)}`),
        }))}
        xLabel="Average score"
        yLabel="Disagreement (σ)"
        xDomain={domains.x}
        yDomain={domains.y}
        r={3.5}
      />
      {colorBy === 'year' ? (
        <YearLegend years={yearNums.filter((y) => scopeIncludes(scope, y))} all={yearNums} />
      ) : (
        <ChartCaption>
          Dots are colour-coded by {colorBy === 'artist' ? 'artist' : 'nominator'} — hover a dot for the name.
          {colorBy === 'nominator' && ' Auto-included top 10s have no nominator and stay grey.'}
        </ChartCaption>
      )}

      <h2>The ledger</h2>

      <ShowMore items={songs} initial={40} noun="songs">
        {(shown) => (
      <div className="scroll-x">
        <table className="data">
          <thead>
            <tr>
              {th('overall', 'All-time #', 'num', 1)}
              {th('year', 'Year', 'num')}
              {th('rank', 'Year rank', 'num', 1)}
              {th('title', 'Song')}
              {th('artist', 'Artist')}
              <th>Nominated by</th>
              {th('average', 'Avg', 'num')}
              {th('stddev', 'σ (divisiveness)', 'num')}
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const rowKey = `${s.year}-${s.id}`
              return (
                <Fragment key={rowKey}>
                  <tr onClick={() => setOpen(open === rowKey ? null : rowKey)} style={{ cursor: 'pointer' }}>
                    <td className="num" style={{ fontWeight: 700 }}>
                      #{s.overallRank}
                    </td>
                    <td className="num">{s.year}</td>
                    <td className="num">#{s.rank}</td>
                    <td>
                      <SongCell s={s} />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <ArtistCredit s={s} />
                    </td>
                    <td>
                      {s.autoIncluded ? (
                        <span className="pill">auto (top 10)</span>
                      ) : (
                        s.nominators.map((n, i) => (
                          <span key={n}>
                            {i > 0 && ', '}
                            <Name n={n} />
                          </span>
                        ))
                      )}
                    </td>
                    <td className="num">{fmt(s.average)}</td>
                    <td className="num">{fmt(s.stddev)}</td>
                  </tr>
                  {open === rowKey && (
                    <tr>
                      <td colSpan={8}>
                        <ScoreBreakdown s={s} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
        )}
      </ShowMore>
    </>
  )
}
