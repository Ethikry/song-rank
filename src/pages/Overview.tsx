import { Link } from 'react-router-dom'
import { useScopedDataset } from '../components/identity'
import { COMPILATION_URLS, SITE } from '../lib/site'
import { AWARDS, crownHistory } from '../lib/awards'
import { allScores, marginalia, yearMeans } from '../lib/insights'
import { fmt, plural } from '../lib/format'
import { ArtistCredit, Histogram, Name, RankBadge, ShowMore, SongCell, SongTitle, Thumb, Tile } from '../components/bits'
import { Scatter, ScoreDistributions, yearColor } from '../components/charts'

/**
 * The trail's direction in one sentence. Deliberately first-to-last rather than
 * a fitted trend: with four points a regression line would dress up a reading
 * the eye can already take off the chart, and would keep asserting a direction
 * once the path starts doubling back.
 */
function driftSentence(means: { year: number; mean: number; spread: number }[]): string {
  if (means.length < 2) return ''
  const first = means[0]
  const last = means[means.length - 1]
  const dMean = last.mean - first.mean
  const dSpread = last.spread - first.spread
  const warmth =
    Math.abs(dMean) < 0.1 ? 'scoring about as warmly' : dMean > 0 ? `scoring ${fmt(dMean)} higher` : `scoring ${fmt(-dMean)} lower`
  const unity =
    Math.abs(dSpread) < 0.05
      ? 'and arguing about as much'
      : dSpread > 0
        ? 'and arguing more'
        : 'and agreeing more'
  return `Between ${first.year} and ${last.year} the room ended up ${warmth} ${unity}.`
}

export default function Overview() {
  // Follows the edition preference; see components/identity.tsx.
  const dataset = useScopedDataset()
  const { years, allTime, perYear } = dataset
  const veterans = allTime.participants.filter((p) => allTime.participantStats[p].years.length === years.length)
  const topAllTime = [...allTime.songs].sort((a, b) => b.average - a.average).slice(0, 25)
  const crowns = crownHistory(dataset)
  const facts = marginalia(dataset)
  const means = yearMeans(dataset)
  const yearNums = years.map((y) => y.year)
  const rosterSizes = years.map((y) => y.participants.length)

  return (
    <>
      <h1>Front Page</h1>
      <p className="subtitle">
        {plural(years.length, 'year')} of {SITE.rankingsOf}, recomputed from the master sheets.
      </p>

      <div className="tiles">
        <Tile value={allTime.songs.length} label="Songs ranked" detail={years.map((y) => `${y.year}: ${y.songs.length}`).join(' · ')} />
        <Tile value={allTime.participants.length} label="Rankers all-time" detail={`${veterans.length} present every year`} />
        <Tile value={Object.keys(allTime.artists).length} label="Artists represented" />
        <Tile
          value={allTime.songs.reduce((a, s) => a + Object.keys(s.scores).length, 0).toLocaleString()}
          label="Scores cast"
        />
      </div>

      <h2>The editions</h2>
      <div className="card-grid">
        {years.map((y) => {
          const podium = perYear[y.year].songs.filter((s) => s.rank <= 3).sort((a, b) => a.rank - b.rank)
          const mean = means.find((m) => m.year === y.year)!
          return (
            <div className="card" key={y.year}>
              <h3 style={{ marginTop: 0 }}>
                <Link to={`/year/${y.year}`}>The {y.year} Edition</Link>
              </h3>
              <p className="note" style={{ marginTop: 0 }}>
                {y.songs.length} songs · {y.participants.length} rankers · songs averaged {fmt(mean.mean)}
              </p>
              <div className="podium" style={{ flexDirection: 'column' }}>
                {podium.map((s) => (
                  <div className="slot" key={s.id}>
                    <div className="song-cell">
                      <Thumb s={s} />
                      <div>
                        <RankBadge rank={s.rank} />{' '}
                        <span className="song">
                          <SongTitle s={s} />
                        </span>
                        <div className="artist">
                          <ArtistCredit s={s} />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Histogram values={allScores(y.songs)} height={64} />
              <p className="note" style={{ marginBottom: 0, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <Link to={`/year/${y.year}`} className="chapter-link">
                  Read the {y.year} chapter →
                </Link>
                {COMPILATION_URLS[y.year] && (
                  <a href={COMPILATION_URLS[y.year]} target="_blank" rel="noreferrer" className="chapter-link">
                    ▶ Watch compilation
                  </a>
                )}
              </p>
            </div>
          )
        })}
      </div>

      <h2>All-time greatest songs</h2>
      <ShowMore items={topAllTime} initial={10} noun="songs">
        {(shown) => (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Song</th>
                  <th>Artist</th>
                  <th className="num">Year</th>
                  <th className="num">Year rank</th>
                  <th className="num">Average</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s, i) => (
                  <tr key={`${s.year}-${s.id}`}>
                    <td>
                      <RankBadge rank={i + 1} />
                    </td>
                    <td>
                      <SongCell s={s} />
                    </td>
                    <td>
                      <ArtistCredit s={s} />
                    </td>
                    <td className="num">{s.year}</td>
                    <td className="num">#{s.rank}</td>
                    <td className="num">{fmt(s.average)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ShowMore>
      <p className="note">
        Cross-year averages mislead — rosters and fields differ. Year ranks are more reliable; see each{' '}
        <Link to="/songs">edition's chapter</Link>.
      </p>

      {/* Two charts of the same four editions, side by side: one asks where each
          year landed, the other what shape it had. Reading them together is the
          point, so they share a row rather than stacking. */}
      <h2>The drift</h2>
      <div className="drift-pair">
        <div>
          <h3>Where each edition landed</h3>
          <p className="note">
            Mean score (right = higher) against σ within a song (up = more divided), in year order.
          </p>
          <Scatter
            points={means.map((m) => ({
              x: m.mean,
              y: m.spread,
              label: `${m.year} — songs averaged ${fmt(m.mean)}, average σ ${fmt(m.spread)}`,
              text: String(m.year),
              color: yearColor(m.year, yearNums),
            }))}
            xLabel="harsher → kinder"
            /* No "σ" in an axis label: .axis-label uppercases, and σ becomes Σ — which
               reads as a sum. The caption above carries the definition instead. */
            yLabel="united → divided"
            width={470}
            height={340}
            r={6}
            path
          />
          <p className="note">{driftSentence(means)}</p>
        </div>
        <div>
          <h3>Every edition, overlaid</h3>
          <p className="note">
            Each score as a share of its year's total (rosters ran {Math.min(...rosterSizes)}–
            {Math.max(...rosterSizes)}). Hover to compare years, click one to bring it forward. Half-points are a third
            of all scores, hence the saw-tooth.
          </p>
          <ScoreDistributions
            series={years.map((y) => ({ year: y.year, values: allScores(y.songs) }))}
            years={yearNums}
            width={470}
            height={340}
          />
        </div>
      </div>

      <h2>Roll of honor</h2>
      <div className="scroll-x">
        <table className="roll">
          <thead>
            <tr>
              <th>Award</th>
              {years.map((y) => (
                <th key={y.year}>{y.year}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AWARDS.map((a) => (
              <tr key={a.key}>
                <td className="award-name">
                  {a.emoji} {a.title}
                </td>
                {years.map((y) => {
                  const c = crowns.find((cr) => cr.year === y.year && cr.award.key === a.key)
                  return (
                    <td key={y.year}>
                      {c ? (
                        c.winners.map((w, i) => (
                          <span key={w} className="winner">
                            {i > 0 && ' & '}
                            <Name n={w} />
                          </span>
                        ))
                      ) : (
                        '—'
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        Shared cells are ties. Full leaderboards on the <Link to="/awards">Awards page</Link>.
      </p>

      <h2>Marginalia</h2>
      <div className="marginalia">
        {facts.map((f) => (
          <div className="item" key={f.k}>
            <div className="k">{f.k}</div>
            <div className="v">{f.v}</div>
            {f.d && <div className="d">{f.d}</div>}
          </div>
        ))}
      </div>
    </>
  )
}
