import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useScopedDataset } from '../components/identity'
import { corrColor, corrInk, fmt, pct, plural } from '../lib/format'
import { TrendLine } from '../components/charts'
import { TasteWeb } from '../components/TasteWeb'
import { BRANCH_LABELS, branchStats } from '../lib/branches'
import { SITE, cap } from '../lib/site'
import { artistWeb } from '../lib/artistWeb'
import { artistPairDrivers } from '../lib/affinity'
import { displayName } from '../lib/names'
import { tasteMap } from '../lib/mds'
import { ArtistLink, HBar, SongTitle, useParamState, useSort } from '../components/bits'

type SortKey = 'name' | 'count' | 'avgScore' | 'firstPlaces' | 'podiums' | 'top10s'

export default function Artists() {
  // Follows the edition preference; see components/identity.tsx.
  const dataset = useScopedDataset()
  const { allTime } = dataset
  const [webMin, setWebMin] = useState(0.3)
  const web = useMemo(() => {
    const { names, pairs, vectors } = artistWeb(dataset)
    return { pairs, vectors, pts: tasteMap(pairs, names) }
  }, [])

  // Decomposed from the same affinity profiles the web's threads were drawn
  // from, so the names under a pairing explain the number beside it.
  const topPairs = useMemo(
    () =>
      [...web.pairs]
        .sort((x, y) => y.corr - x.corr)
        .slice(0, 6)
        .map((p) => ({
          ...p,
          drivers: artistPairDrivers(web.vectors.get(p.a)!, web.vectors.get(p.b)!, { limit: 5 }),
        })),
    [web],
  )
  const [minParam, setMinParam] = useParamState('min', '2')
  const minSongs = Number(minParam) || 2
  const setMinSongs = (n: number) => setMinParam(String(n))
  const sort = useSort<SortKey>('avgScore')

  const artists = useMemo(() => {
    const list = Object.values(allTime.artists).filter((a) => a.count >= minSongs)
    const dir = sort.dir
    return list.sort((a, b) => {
      if (sort.key === 'name') return a.name.localeCompare(b.name) * dir
      // Ties favor the artist with more songs — a matching average over a
      // bigger catalogue is the stronger showing.
      return (a[sort.key] - b[sort.key]) * dir || b.count - a.count
    })
  }, [allTime.artists, minSongs, sort.key, sort.dir])

  const th = (k: SortKey, label: string, cls = '') => (
    <th className={`sortable ${cls}`} onClick={() => sort.toggle(k)}>
      {label}
      {sort.arrow(k)}
    </th>
  )

  return (
    <>
      <h1>Artists</h1>
      <p className="subtitle">
        Every artist, all years. Collabs credit each artist on the track.
      </p>

      <h2>The {SITE.group.singular} report</h2>
      <p className="note">A collab counts for every {SITE.group.singular} on the track.</p>
      <div className="scroll-x">
        <table className="data" style={{ maxWidth: 720 }}>
          <thead>
            <tr>
              <th>{cap(SITE.group.singular)}</th>
              <th className="num">Songs</th>
              <th className="num">Avg score</th>
              <th className="num">Podiums</th>
              <th className="num">Top 10s</th>
              <th>Avg by year</th>
            </tr>
          </thead>
          <tbody>
            {branchStats(dataset).map((b) => (
              <tr key={b.branch}>
                <td style={{ fontWeight: 700 }}>{BRANCH_LABELS[b.branch]}</td>
                <td className="num">{b.songs}</td>
                <td className="num">{fmt(b.avg)}</td>
                <td className="num">{b.podiums || ''}</td>
                <td className="num">{b.top10s || ''}</td>
                <td className="note">{b.byYear.map((e) => `${e.year}: ${fmt(e.value)} (${e.n})`).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-grid" style={{ marginTop: 14 }}>
        {branchStats(dataset)
          .filter((b) => b.byYear.length > 1 && b.songs >= 10)
          .map((b) => (
            <div className="card" key={b.branch}>
              <h3 style={{ marginTop: 0 }}>{BRANCH_LABELS[b.branch]}</h3>
              <TrendLine series={b.byYear.map((e) => ({ year: e.year, value: e.value }))} domain={[6, 9]} />
            </div>
          ))}
      </div>

      <h2>Quality and quantity</h2>
      <div className="two-col">
        <div>
          <h3>Best received <span className="note">(3+ songs)</span></h3>
          <div className="bars">
            {Object.values(allTime.artists)
              .filter((a) => a.count >= 3)
              .sort((x, y) => y.avgScore - x.avgScore || y.count - x.count)
              .slice(0, 12)
              .map((a, i) => (
                <HBar
                  key={a.name}
                  label={<ArtistLink a={a.name} avatar />}
                  value={a.avgScore - 5}
                  max={4}
                  display={`${fmt(a.avgScore)} · ${plural(a.count, 'song')}`}
                  color={i === 0 ? 'var(--vermillion)' : undefined}
                />
              ))}
          </div>
          <p className="note">Bars start at a score of 5.</p>
        </div>
        <div>
          <h3>Most prolific</h3>
          <div className="bars">
            {Object.values(allTime.artists)
              .sort((x, y) => y.count - x.count)
              .slice(0, 12)
              .map((a, i) => (
                <HBar
                  key={a.name}
                  label={<ArtistLink a={a.name} avatar />}
                  value={a.count}
                  max={Math.max(...Object.values(allTime.artists).map((x) => x.count))}
                  display={`${plural(a.count, 'song')} · avg ${fmt(a.avgScore)}`}
                  color={i === 0 ? 'var(--vermillion)' : undefined}
                />
              ))}
          </div>
        </div>
      </div>

      <h2>The commonality web</h2>
      <p className="note">
        <strong>Distance is shared feeling</strong>: artists sit close when the room feels the same way about both,
        measured against each ranker's own baseline (3+ songs each). <strong>Colour is which feeling</strong> — warm
        for a pair the room likes, cold for one it dislikes; thickness is the strength of the bond.
      </p>
      <div className="controls">
        <label className="note">Show kinships of at least:</label>
        <div className="seg">
          {[0.2, 0.3, 0.4].map((t) => (
            <button key={t} className={webMin === t ? 'on' : ''} onClick={() => setWebMin(t)}>
              {t.toFixed(1)}
            </button>
          ))}
        </div>
      </div>
      <TasteWeb
        nodes={web.pts.map((p) => ({
          name: p.name,
          x: p.x,
          y: p.y,
          z: p.z,
          label: p.name,
          misfit: p.misfit,
        }))}
        edges={web.pairs
          .filter((p) => Number.isFinite(p.corr) && p.corr >= webMin)
          .flatMap((p) => {
            const i = web.pts.findIndex((n) => n.name === p.a)
            const j = web.pts.findIndex((n) => n.name === p.b)
            return i >= 0 && j >= 0 ? [{ i, j, w: p.corr, tone: p.tone }] : []
          })}
        threads={{
          colorBy: 'tone',
          label: 'shared feeling',
          lo: 'both disliked',
          hi: 'both loved',
          toneUnit: 'against their own averages',
        }}
      />

      <h3>Whose taste ties them together</h3>
      <p className="note">
        The closest pairs, broken down by ranker: <span className="agree-up">above their baseline on both</span> or{' '}
        <span className="agree-down">below on both</span>, relative to the average fan. Hover a name for its share.
      </p>
      <div className="artist-drivers">
        {topPairs.map((p) => (
          <div className="card" key={`${p.a}|${p.b}`}>
            <div className="ad-head">
              <span>
                <ArtistLink a={p.a} avatar /> <span className="note">×</span> <ArtistLink a={p.b} avatar />
              </span>
              <span className="ad-corr" style={{ background: corrColor(p.corr), color: corrInk(p.corr) }}>
                {fmt(p.corr, 2)}
              </span>
            </div>
            <div className="shared-artists">
              {p.drivers.map((d) => (
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

      <h2>The leaderboard</h2>
      <div className="controls">
        <label className="note">Min songs:</label>
        <div className="seg">
          {[1, 2, 3, 5].map((n) => (
            <button key={n} className={minSongs === n ? 'on' : ''} onClick={() => setMinSongs(n)}>
              {n}+
            </button>
          ))}
        </div>
        <span className="note">{plural(artists.length, 'artist')}</span>
      </div>

      <div className="scroll-x">
        <table className="data">
          <thead>
            <tr>
              <th className="num">#</th>
              {th('name', 'Artist')}
              {th('count', 'Songs', 'num')}
              {th('avgScore', 'Avg score', 'num')}
              {th('firstPlaces', '#1s', 'num')}
              {th('podiums', 'Podiums', 'num')}
              {th('top10s', 'Top 10s', 'num')}
              <th>Best song</th>
              <th>Weakest song</th>
            </tr>
          </thead>
          <tbody>
            {artists.map((a, i) => (
              <tr key={a.name}>
                <td className="num" style={{ fontWeight: 700 }}>
                  {i + 1}
                </td>
                <td>
                  <ArtistLink a={a.name} avatar />
                </td>
                <td className="num">{a.count}</td>
                <td className="num">{fmt(a.avgScore)}</td>
                <td className="num">{a.firstPlaces || ''}</td>
                <td className="num">{a.podiums || ''}</td>
                <td className="num">{a.top10s || ''}</td>
                <td>
                  <SongTitle s={a.best} withYear /> <span className="note">avg {fmt(a.best.average)}</span>
                </td>
                <td>
                  <SongTitle s={a.worst} withYear /> <span className="note">avg {fmt(a.worst.average)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
