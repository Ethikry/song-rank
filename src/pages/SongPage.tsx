import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { dataset } from '../lib/data'
import { fmt } from '../lib/format'
import { displayName } from '../lib/names'
import { ArtistCredit, Histogram, Name, ScoreChip, SongTitle, Tile, WatchLinks, YouTubeEmbed } from '../components/bits'

type BreakdownSort = 'score' | 'deviation' | 'name'

export default function SongPage() {
  const { year: yearRaw, id } = useParams()
  const year = Number(yearRaw)
  const ys = dataset.perYear[year]
  const song = ys?.songs.find((s) => s.id === decodeURIComponent(id ?? ''))
  const [sort, setSort] = useState<BreakdownSort>('score')

  if (!ys || !song) {
    return (
      <>
        <h1>Song not found</h1>
        <p className="subtitle">
          Nothing at {yearRaw}/{id}. <Link to="/songs">Back to the ledger</Link>
        </p>
      </>
    )
  }

  const scores = Object.entries(song.scores).map(([who, v]) => {
    // That year's baseline, not their all-time one: grading scales drift
    // between editions, and the note was written against the field in front of
    // them. Falls back to the room when a year somehow has no stats for them,
    // which restores the old behaviour rather than printing NaN.
    const baseline = ys.participantStats[who]?.avgGiven
    return {
      who,
      v,
      dev: v - song.average,
      baseline,
      own: v - (Number.isFinite(baseline) ? baseline : song.average),
      comment: song.comments?.[who] ?? '',
    }
  })
  const sorted = [...scores].sort((a, b) => {
    if (sort === 'name') return displayName(a.who).localeCompare(displayName(b.who))
    if (sort === 'deviation') return b.dev - a.dev
    return b.v - a.v
  })
  const values = scores.map((s) => s.v)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const elevens = scores.filter((s) => s.v === 11)
  const nonEleven = scores.filter((s) => s.v !== 11)
  const maxNonEleven = Math.max(...nonEleven.map((s) => s.v), 0)
  const greens = nonEleven.filter((s) => s.v === maxNonEleven || s.v >= 10)

  const commented = scores.filter((s) => s.comment)
  /**
   * Split by the score the note came attached to, not by reading the text —
   * how someone scored is the closest thing to a sentiment signal the data has.
   *
   * The side is decided against **the writer's own average**, not the room's.
   * Rankers grade on wildly different scales: a 7 from someone who averages 5.4
   * is enthusiasm, and a 7 from someone who averages 8.1 is a shrug. Measured
   * against the room, the first landed in Critique under a note that plainly
   * praised the song and the second in Praise under a note that didn't — the
   * harshest graders filled the critique column no matter what they wrote.
   * Each side leads with the biggest departure from its writer's own norm.
   */
  const praise = commented.filter((s) => s.own >= 0).sort((a, b) => b.own - a.own || b.v - a.v)
  const critique = commented.filter((s) => s.own < 0).sort((a, b) => a.own - b.own || a.v - b.v)
  /**
   * The loudest disagreement that actually left a note. Sorted by distance from
   * the average, so this is the same "hot take" axis the breakdown offers —
   * except here we can print what they were thinking.
   */
  const contrarian = [...commented].sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev))[0]

  const divisivenessPct =
    (dataset.allTime.songs.filter((s) => s.stddev < song.stddev).length / dataset.allTime.songs.length) * 100

  const byRank = [...ys.songs].sort((a, b) => a.rank - b.rank)
  const idx = byRank.findIndex((s) => s.id === song.id)
  const prev = byRank[idx - 1]
  const next = byRank[idx + 1]

  const artistMates = song.artists
    .flatMap((a) => dataset.allTime.artists[a]?.songs ?? [])
    .filter((s, i, arr) => s !== song && arr.indexOf(s) === i)
    .sort((a, b) => b.average - a.average)
    .slice(0, 5)

  return (
    <>
      <div className="song-cell" style={{ alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
        <YouTubeEmbed s={song} />
        <div>
          <h1 style={{ marginBottom: 2 }}>{song.title}</h1>
          <p className="subtitle" style={{ marginBottom: 8 }}>
            <ArtistCredit s={song} /> · <Link to={`/year/${song.year}`}>{song.year} edition</Link>
          </p>
          <p style={{ margin: 0 }}>
            <WatchLinks s={song} />{' '}
            {song.autoIncluded ? (
              <span className="pill">auto-included (top 10)</span>
            ) : (
              <span className="note">
                nominated by{' '}
                {song.nominators.map((n, i) => (
                  <span key={n}>
                    {i > 0 && ', '}
                    <Name n={n} />
                  </span>
                ))}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="tiles">
        <Tile value={`#${song.rank}`} label={`${song.year} rank`} detail={`of ${ys.songs.length} songs`} />
        <Tile value={`#${song.overallRank}`} label="All-time rank" detail={`of ${dataset.allTime.songs.length} ever ranked`} />
        <Tile value={fmt(song.average)} label="Average score" />
        <Tile
          value={fmt(song.stddev)}
          label="Disagreement (σ)"
          detail={`more divisive than ${Math.round(divisivenessPct)}% of all songs`}
        />
        <Tile value={`${min} – ${max}`} label="Score range" />
      </div>

      <h2>The verdict, voice by voice</h2>
      <div className="controls">
        <div className="seg">
          {(['score', 'deviation', 'name'] as const).map((k) => (
            <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>
              {k === 'score' ? 'By score' : k === 'deviation' ? 'By hot take' : 'By name'}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {sorted.map(({ who, v, dev }) => (
          <span key={who} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <ScoreChip v={v} />
            <span style={{ fontSize: 13 }}>
              <Name n={who} />
              {sort === 'deviation' && (
                <span className="note" style={{ marginLeft: 3 }}>
                  {dev >= 0 ? '+' : ''}
                  {fmt(dev, 1)}
                </span>
              )}
            </span>
          </span>
        ))}
      </div>

      <div className="two-col" style={{ marginTop: 24 }}>
        <div>
          <h3>Score distribution</h3>
          <Histogram values={values} />
        </div>
        <div>
          <h3>Marginal notes</h3>
          <table className="data">
            <tbody>
              {elevens.length > 0 && (
                <tr>
                  <td>
                    <ScoreChip v={11} />
                  </td>
                  <td className="name-chips">
                    {elevens.map((e) => (
                      <Name key={e.who} n={e.who} chip />
                    ))}{' '}
                    <span className="note">gave it their 11</span>
                  </td>
                </tr>
              )}
              <tr>
                <td>
                  <ScoreChip v={maxNonEleven} />
                </td>
                <td className="name-chips">
                  {greens.slice(0, 6).map((e) => (
                    <Name key={e.who} n={e.who} chip />
                  ))}{' '}
                  <span className="note">highest score short of an 11</span>
                </td>
              </tr>
              {contrarian && (
                <tr>
                  <td>
                    <ScoreChip v={contrarian.v} />
                  </td>
                  <td>
                    <Name n={contrarian.who} />{' '}
                    <span className="note">
                      {contrarian.dev >= 0 ? '+' : ''}
                      {fmt(contrarian.dev, 1)} against the room's {fmt(song.average)} —
                    </span>
                    <p className="voice-quote" style={{ marginTop: 3 }}>
                      {contrarian.comment}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {commented.length > 0 && (
        <>
          <h2>Praise &amp; critique</h2>
          <p className="subtitle">
            {commented.length} of {scores.length} left a note, split above or below <em>their own</em> average.
          </p>
          <div className="two-col">
            {(
              [
                ['Praise', praise, 'At or above their own average.'],
                ['Critique', critique, 'Below their own average.'],
              ] as const
            ).map(([title, list, blurb]) => (
              <div key={title}>
                <h3>
                  {title} <span className="note">({list.length})</span>
                </h3>
                {list.length === 0 ? (
                  <p className="note">No notes on this side.</p>
                ) : (
                  <>
                    <p className="note">{blurb}</p>
                    <div className="notes-list">
                      {list.map(({ who, v, dev, own, baseline, comment }) => (
                        <div className="voice" key={who}>
                          <ScoreChip v={v} />
                          <div className="voice-body">
                            <span className="voice-who">
                              <Name n={who} />
                              {/* The number that put them in this column, with the
                                  baseline it was measured against; the room delta
                                  is the secondary fact now, so it moves to the
                                  tooltip rather than competing for the same line. */}
                              <span
                                className="note"
                                style={{ marginLeft: 4 }}
                                title={`${dev >= 0 ? '+' : ''}${fmt(dev, 1)} against the room's ${fmt(song.average)}`}
                              >
                                {own >= 0 ? '+' : ''}
                                {fmt(own, 1)}
                                {Number.isFinite(baseline) && ` vs their ${fmt(baseline!, 1)}`}
                              </span>
                            </span>
                            <p className="voice-quote">{comment}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {artistMates.length > 0 && (
        <>
          <h2>Elsewhere in the catalog</h2>
          <table className="data" style={{ maxWidth: 680 }}>
            <tbody>
              {artistMates.map((s) => (
                <tr key={`${s.year}-${s.id}`}>
                  <td className="num">#{s.overallRank}</td>
                  <td>
                    <SongTitle s={s} withYear />
                    <div className="note">
                      <ArtistCredit s={s} />
                    </div>
                  </td>
                  <td className="num">{fmt(s.average)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="note" style={{ marginTop: 26 }}>
        {prev && (
          <>
            ↑ #{prev.rank} <SongTitle s={prev} />
          </>
        )}
        {prev && next && ' · '}
        {next && (
          <>
            ↓ #{next.rank} <SongTitle s={next} />
          </>
        )}
      </p>
    </>
  )
}
