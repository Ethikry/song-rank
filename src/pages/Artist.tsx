import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { dataset } from '../lib/data'
import { fmt, heatColor, pct, plural } from '../lib/format'
import { displayName } from '../lib/names'
import { artistPairDrivers } from '../lib/affinity'
import { artistWeb } from '../lib/artistWeb'
import { photoCredit } from '../lib/artistAvatar'
import {
  ArtistAvatar,
  ArtistLink,
  Name,
  RankBadge,
  ScoreChip,
  ShowMore,
  SongCell,
  SongNote,
  SongTitle,
  Thumb,
  Tile,
} from '../components/bits'
import { Scatter, TrendLine, YearLegend, yearColor } from '../components/charts'

export default function Artist() {
  const { name: raw } = useParams()
  const name = decodeURIComponent(raw ?? '')
  const { allTime, years } = dataset
  const artist = allTime.artists[name]

  // top-3 kinships from the commonality web (empty for artists under its 3-song floor)
  const closest = useMemo(() => {
    if (!artist) return []
    const { pairs, vectors } = artistWeb(dataset)
    return pairs
      .filter((p) => (p.a === name || p.b === name) && Number.isFinite(p.corr))
      .sort((x, y) => y.corr - x.corr)
      .slice(0, 3)
      .map((p) => {
        const other = p.a === name ? p.b : p.a
        return {
          other,
          corr: p.corr,
          overlap: p.overlap,
          // Decomposed from the same affinity profiles the kinship was measured
          // from, so these are the people the number is actually made of.
          drivers: artistPairDrivers(vectors.get(name)!, vectors.get(other)!, { limit: 4 }),
        }
      })
  }, [name, artist])

  if (!artist) {
    return (
      <>
        <h1>Unknown artist</h1>
        <p className="subtitle">
          No songs by “{name}” in the record. <Link to="/artists">Back to artists</Link>
        </p>
      </>
    )
  }

  const yearNums = years.map((y) => y.year)
  const songs = artist.songs // already sorted best-first

  // Every (participant, score) pair for this artist's songs
  const perParticipant = new Map<string, number[]>()
  for (const s of songs) {
    for (const [who, v] of Object.entries(s.scores)) {
      if (!perParticipant.has(who)) perParticipant.set(who, [])
      perParticipant.get(who)!.push(v)
    }
  }
  const minSongs = Math.min(3, artist.count)
  const fanBoard = [...perParticipant.entries()]
    .filter(([, v]) => v.length >= minSongs)
    .map(([who, v]) => {
      const avg = v.reduce((a, b) => a + b, 0) / v.length
      const baseline = allTime.participantStats[who]?.avgGiven ?? NaN
      return { who, n: v.length, avg, delta: avg - baseline }
    })
    .sort((a, b) => b.delta - a.delta)
  const fan = fanBoard[0]
  const hater = fanBoard[fanBoard.length - 1]

  const elevens = Object.values(allTime.participantStats)
    .flatMap((p) => p.elevens.filter((s) => s.artists.includes(name)).map((s) => ({ who: p.name, song: s })))
    .sort((a, b) => a.song.rank - b.song.rank)

  const trend = yearNums
    .map((y) => {
      const inYear = songs.filter((s) => s.year === y)
      return inYear.length
        ? { year: y, value: inYear.reduce((a, s) => a + s.average, 0) / inYear.length, n: inYear.length }
        : null
    })
    .filter((x): x is { year: number; value: number; n: number } => x !== null)

  const divisive = [...songs].sort((a, b) => b.stddev - a.stddev)[0]

  // how divisive the whole catalog is, vs every other artist with 2+ songs
  const avgSigma = songs.reduce((a, s) => a + s.stddev, 0) / songs.length
  const sigmaPeers = Object.values(allTime.artists)
    .filter((a) => a.count >= 2)
    .map((a) => a.songs.reduce((x, s) => x + s.stddev, 0) / a.count)
  const sigmaPct = sigmaPeers.length
    ? Math.round((sigmaPeers.filter((v) => v < avgSigma).length / sigmaPeers.length) * 100)
    : 0

  // Demo only: its Commons photos carry an attribution obligation.
  const credit = photoCredit(name)

  return (
    <>
      <div className="song-cell" style={{ alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
        <Thumb s={artist.best} size="large" />
        <div>
          {/* The portrait rides with the name rather than replacing the video
              thumbnail: the thumbnail is the artist's best song, which is the
              other half of what this page is about. Units and guests have no
              portrait and simply keep the old heading. */}
          <h1 className="artist-hero" style={{ marginBottom: 2 }}>
            <ArtistAvatar a={name} size={44} />
            {name}
          </h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>
            {artist.count} song{artist.count === 1 ? '' : 's'} ranked ·{' '}
            {[...new Set(songs.map((s) => s.year))].sort().join(' · ')} ·{' '}
            <Link to="/artists">all artists</Link>
            {credit && (
              <>
                {' '}
                · photo: {credit.author}, <Link to="/credits">{credit.license}</Link>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="tiles">
        <Tile value={artist.count} label="Songs ranked" />
        <Tile value={fmt(artist.avgScore)} label="Average score" />
        <Tile
          value={<SongTitle s={artist.best} />}
          label="Best song"
          detail={`#${artist.best.rank} in ${artist.best.year} · avg ${fmt(artist.best.average)}`}
        />
        <Tile
          value={fmt(avgSigma)}
          label="Divisiveness (avg σ)"
          detail={`splits the room harder than ${sigmaPct}% of artists`}
        />
        <Tile
          value={artist.firstPlaces || artist.podiums || artist.top10s || '—'}
          label={artist.firstPlaces ? 'First places' : artist.podiums ? 'Podiums' : 'Top-10 finishes'}
        />
        <Tile value={elevens.length || '—'} label="11s received" />
      </div>

      {closest.length > 0 && (
        <>
          <h2>Closest artists</h2>
          <p className="note">
            From the <Link to="/artists">commonality web</Link>: whose fans overlap most with {name}'s, and the rankers{' '}
            <span className="agree-up">above baseline on both</span> or <span className="agree-down">below on both</span>.
          </p>
          <div className="crown-strip">
            {closest.map((c) => (
              <div className="crown-card" key={c.other}>
                <div className="who">
                  <ArtistLink a={c.other} avatar />
                </div>
                <div className="what">
                  kinship{' '}
                  <strong style={{ color: heatColor(Math.max(0, c.corr)) }}>{fmt(c.corr, 2)}</strong> · {c.overlap} shared
                  raters
                </div>
                <div className="shared-artists">
                  {c.drivers.map((d) => (
                    <Link
                      key={d.participant}
                      to={`/participant/${encodeURIComponent(d.participant)}`}
                      className={d.direction === 'up' ? 'agree-up' : 'agree-down'}
                      title={`${displayName(d.participant)} scores ${d.direction === 'up' ? 'above' : 'below'} their baseline on both — ${pct(d.fraction)} of the pairing`}
                    >
                      {displayName(d.participant)}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {fanBoard.length > 0 && (
        <>
          <h2>The fan club</h2>
          <div className="two-col">
            <div>
              <div className="card" style={{ marginBottom: 12 }}>
                <h3 style={{ marginTop: 0 }}>💘 Biggest fan: <Name n={fan.who} /></h3>
                <p className="note" style={{ margin: 0 }}>
                  Gives {name} a {fmt(fan.avg)} on average — {fan.delta >= 0 ? '+' : ''}
                  {fmt(fan.delta)} above their usual {fmt(allTime.participantStats[fan.who].avgGiven)} ({plural(fan.n, 'song')}).
                </p>
              </div>
              {hater !== fan && (
                <div className="card">
                  <h3 style={{ marginTop: 0 }}>🥶 Toughest critic: <Name n={hater.who} /></h3>
                  <p className="note" style={{ margin: 0 }}>
                    A {fmt(hater.avg)} average — {fmt(hater.delta)} against their usual{' '}
                    {fmt(allTime.participantStats[hater.who].avgGiven)} ({plural(hater.n, 'song')}).
                  </p>
                </div>
              )}
            </div>
            <div>
              <h3 style={{ marginTop: 0 }}>Everyone, vs their own baseline</h3>
              <ShowMore items={fanBoard} initial={8} noun="rankers">
                {(shown) => (
                  <div className="scroll-x">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Ranker</th>
                          <th className="num">Avg for {name}</th>
                          <th className="num">vs their usual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((f) => (
                          <tr key={f.who}>
                            <td>
                              <Name n={f.who} />
                            </td>
                            <td className="num">{fmt(f.avg)}</td>
                            <td
                              className="num"
                              style={{ color: f.delta >= 0 ? 'var(--green)' : 'var(--vermillion)', fontWeight: 600 }}
                            >
                              {f.delta >= 0 ? '+' : ''}
                              {fmt(f.delta)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </ShowMore>
            </div>
          </div>
        </>
      )}

      <h2>The catalog</h2>
      <ShowMore items={songs} initial={12} noun="songs">
        {(shown) => (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th className="num">All-time</th>
                  <th>Song</th>
                  <th className="num">Year</th>
                  <th className="num">Year rank</th>
                  <th className="num">Avg</th>
                  <th className="num">σ</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={`${s.year}-${s.id}`}>
                    <td className="num">#{s.overallRank}</td>
                    <td>
                      <SongCell
                        s={s}
                        sub={s.artists.length > 1 ? `with ${s.artists.filter((a) => a !== name).join(', ')}` : undefined}
                      />
                    </td>
                    <td className="num">{s.year}</td>
                    <td className="num">
                      <RankBadge rank={s.rank} />
                    </td>
                    <td className="num">{fmt(s.average)}</td>
                    <td className="num">{fmt(s.stddev)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ShowMore>

      <h2>The shape of the catalog</h2>
      <div className="two-col">
        <div>
          <h3>Each song: consensus vs controversy</h3>
          <Scatter
            points={songs.map((s) => ({
              x: s.average,
              y: s.stddev,
              label: `${s.title} (${s.year}) — avg ${fmt(s.average)}, σ ${fmt(s.stddev)}`,
              color: yearColor(s.year, yearNums),
            }))}
            xLabel="Average score"
            yLabel="Disagreement (σ)"
          />
          <YearLegend years={[...new Set(songs.map((s) => s.year))].sort()} all={yearNums} />
          {divisive && songs.length > 1 && (
            <p className="note">
              Most divisive: “{divisive.title}” ({divisive.year}), σ {fmt(divisive.stddev)}.
            </p>
          )}
        </div>
        {trend.length > 1 && (
          <div>
            <h3>Average score by year</h3>
            <TrendLine series={trend} domain={[5, 10]} />
            <p className="note">{trend.map((t) => `${t.year}: ${t.n} song${t.n === 1 ? '' : 's'}`).join(' · ')}</p>
          </div>
        )}
      </div>

      {elevens.length > 0 && (
        <>
          <h2>11s received</h2>
          <table className="data">
            <tbody>
              {elevens.map(({ who, song }) => (
                <tr key={`${who}-${song.id}`}>
                  <td>
                    <ScoreChip v={11} />
                  </td>
                  <td>
                    <Name n={who} /> <span className="note">→</span> <SongTitle s={song} withYear />
                    <SongNote s={song} who={who} />
                  </td>
                  <td className="num">finished #{song.rank}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="note" style={{ marginTop: 30 }}>
        Explore another artist:{' '}
        {Object.values(allTime.artists)
          .filter((a) => a.count >= 3 && a.name !== name)
          .sort((a, b) => b.avgScore - a.avgScore || b.count - a.count)
          .slice(0, 8)
          .map((a, i) => (
            <span key={a.name}>
              {i > 0 && ' · '}
              <Link to={`/artist/${encodeURIComponent(a.name)}`}>{a.name}</Link>
            </span>
          ))}
      </p>
    </>
  )
}
