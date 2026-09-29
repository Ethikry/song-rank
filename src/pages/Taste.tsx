import { useMemo, useRef, useState } from 'react'
import { useScopedDataset } from '../components/identity'
import { corrColor, corrInk, fmt, pct, plural } from '../lib/format'
import { displayName } from '../lib/names'
import { tasteMap } from '../lib/mds'
import { ArtistLink, Name, ScopeNote, useParamState, YearScopePills } from '../components/bits'
import { dataset } from '../lib/data'
import { sharedArtistsIn } from '../lib/affinity'
import { TasteWeb } from '../components/TasteWeb'
import { isAllYears, onlyYear, parseYearScope, scopeLabel, scopedDataset, yearScopeParam, type YearScope } from '../lib/yearScope'
import type { PairwiseEntry, Song } from '../lib/types'

function buildMatrix(pairs: PairwiseEntry[], names: string[]) {
  const map = new Map<string, number>()
  for (const p of pairs) {
    map.set(`${p.a}|${p.b}`, p.corr)
    map.set(`${p.b}|${p.a}`, p.corr)
  }
  // Order by average correlation so similar tastes cluster toward the top-left
  const avg = (n: string) => {
    const vals = names.map((m) => map.get(`${n}|${m}`)).filter((v): v is number => v !== undefined)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : -1
  }
  const ordered = [...names].sort((a, b) => avg(b) - avg(a))
  return { map, ordered }
}

/**
 * The artists inside a pairing's number.
 *
 * `want: 'agree'` (the default) names what built it — ▲ both above their own
 * average on that artist, ▼ both below, the second kind being agreement too and
 * often the larger half. `want: 'disagree'` names what's holding it down, which
 * is the interesting half of a nemesis pairing: ⇅ marks an artist one of them
 * rated up and the other down.
 */
export function SharedArtists({
  songs,
  a,
  b,
  limit = 4,
  want = 'agree',
}: {
  songs: Song[]
  a: string
  b: string
  limit?: number
  want?: 'agree' | 'disagree'
}) {
  const shared = useMemo(() => sharedArtistsIn(songs, a, b, { limit, want }), [songs, a, b, limit, want])
  if (!shared.length) return null
  const cls = { up: 'agree-up', down: 'agree-down', split: 'agree-split' } as const
  const verb = (s: (typeof shared)[number]) => {
    if (s.direction === 'up') return `Both rated ${s.artist} above their own average`
    if (s.direction === 'down') return `Both rated ${s.artist} below their own average`
    // Name who sat on which side, so the tag isn't just "you two differ here".
    const [up, down] = s.devA > 0 ? [a, b] : [b, a]
    return `${displayName(up)} rated ${s.artist} up, ${displayName(down)} rated it down`
  }
  return (
    <div className="shared-artists">
      {shared.map((s) => (
        <ArtistLink
          key={s.artist}
          a={s.artist}
          className={cls[s.direction]}
          title={`${verb(s)} — ${pct(s.fraction)} of their ${want === 'agree' ? 'correlation' : 'distance'}, over ${plural(s.n, 'song')}`}
        />
      ))}
    </div>
  )
}

export default function Taste() {
  // Follows the edition preference; see components/identity.tsx.
  const dataset = useScopedDataset()
  const { years, allTime, perYear } = dataset
  const [scopeParam, setScopeParam] = useParamState('scope', 'all')
  const yearNums = years.map((y) => y.year)
  const scope = parseYearScope(scopeParam, yearNums)
  const setScope = (s: YearScope) => setScopeParam(yearScopeParam(s))

  // `songs` is the pool the correlations were computed over, and has to travel
  // with them: decomposing an all-time pairing against one year's songs would
  // be explaining a number that pool never produced.
  const { pairs, names, songs } = useMemo(() => {
    if (isAllYears(scope)) {
      return { pairs: allTime.pairwise, names: allTime.participants, songs: allTime.songs }
    }
    const single = onlyYear(scope)
    if (single !== null) {
      const ys = perYear[single]
      return { pairs: ys.pairwise, names: ys.participants, songs: ys.songs }
    }
    // Correlations aren't poolable after the fact — a multi-year selection means
    // recomputing every pair over just those songs, which is exactly what a
    // subset Dataset gives us.
    const sub = scopedDataset(dataset, scope)
    return { pairs: sub.allTime.pairwise, names: sub.allTime.participants, songs: sub.allTime.songs }
  }, [scopeParam, dataset, allTime, perYear])

  const { map, ordered } = useMemo(() => buildMatrix(pairs, names), [pairs, names])
  const mapPts = useMemo(() => tasteMap(pairs, names), [pairs, names])
  const [webMin, setWebMin] = useState(0.4)
  const heatWrapRef = useRef<HTMLDivElement>(null)
  const [heatTip, setHeatTip] = useState<{ x: number; y: number; label: string } | null>(null)

  // Five a side, not ten: each row carries its own decomposition underneath, so
  // ten of them buried the taste web below two columns of near-identical numbers.
  const sorted = [...pairs].filter((p) => Number.isFinite(p.corr)).sort((a, b) => b.corr - a.corr)
  const twins = sorted.slice(0, 5)
  const nemeses = [...sorted].reverse().slice(0, 5)

  return (
    <>
      <h1>Taste</h1>
      <p className="subtitle">
        Pearson correlation between every pair of rankers
        {isAllYears(scope) && ', pooled across all years (10+ shared songs)'}
        {scope.length > 1 && `, pooled across ${scopeLabel(scope, yearNums)} (10+ shared songs)`}. Blue = positive,
        red = negative.
      </p>

      <div className="controls">
        <YearScopePills years={yearNums} scope={scope} onChange={setScope} allLabel="All-time" />
        <ScopeNote scope={scope} years={yearNums} />
      </div>

      <div className="two-col" style={{ marginBottom: 20 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>🤝 Taste twins</h3>
          <p className="note" style={{ marginTop: 0 }}>
            Artists driving each pair's correlation: <span className="agree-up">both above</span> their own average,
            or <span className="agree-down">both below</span>.
          </p>
          <table className="data">
            <tbody>
              {twins.map((p) => (
                <tr key={`${p.a}|${p.b}`}>
                  <td>
                    <Name n={p.a} /> × <Name n={p.b} />
                    <SharedArtists songs={songs} a={p.a} b={p.b} />
                  </td>
                  <td className="num">{fmt(p.corr, 2)}</td>
                  <td className="num note">{p.overlap} songs</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>⚔️ Nemeses</h3>
          <p className="note" style={{ marginTop: 0 }}>
            Artists driving each pair's distance: <span className="agree-split">one above their average, the other
            below</span>.
          </p>
          <table className="data">
            <tbody>
              {nemeses.map((p) => (
                <tr key={`${p.a}|${p.b}`}>
                  <td>
                    <Name n={p.a} /> × <Name n={p.b} />
                    <SharedArtists songs={songs} a={p.a} b={p.b} want="disagree" />
                  </td>
                  <td className="num">{fmt(p.corr, 2)}</td>
                  <td className="num note">{p.overlap} songs</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2>The taste web</h2>
      <p className="note">
        Rankers placed in 3D so distance ≈ disagreement; threads connect the strongest correlations.
      </p>
      <div className="controls">
        <label className="note">Show kinships of at least:</label>
        <div className="seg">
          {[0.3, 0.4, 0.5].map((t) => (
            <button key={t} className={webMin === t ? 'on' : ''} onClick={() => setWebMin(t)}>
              {t.toFixed(1)}
            </button>
          ))}
        </div>
      </div>
      <TasteWeb
        nodes={mapPts.map((p) => ({
          name: p.name,
          x: p.x,
          y: p.y,
          z: p.z,
          misfit: p.misfit,
          label: displayName(p.name),
        }))}
        edges={pairs
          .filter((p) => Number.isFinite(p.corr) && p.corr >= webMin)
          .flatMap((p) => {
            const i = mapPts.findIndex((n) => n.name === p.a)
            const j = mapPts.findIndex((n) => n.name === p.b)
            return i >= 0 && j >= 0 ? [{ i, j, w: p.corr }] : []
          })}
      />

      <h2>Correlation heatmap</h2>
      <p className="note">Ordered by average similarity; hover a cell for its value.</p>
      <div className="chart-wrap" ref={heatWrapRef} onMouseLeave={() => setHeatTip(null)}>
        {heatTip && (
          <div className="chart-tip" style={{ left: heatTip.x, top: heatTip.y }}>
            {heatTip.label}
          </div>
        )}
        <table className="heatmap">
          <thead>
            <tr>
              <th className="corner"></th>
              {ordered.map((n) => (
                <th key={n} className="colh">
                  {displayName(n)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.map((a) => (
              <tr key={a}>
                <th className="rowh">{displayName(a)}</th>
                {ordered.map((b) => {
                  if (a === b) return <td key={b} style={{ background: 'var(--rule)' }} />
                  const v = map.get(`${a}|${b}`)
                  const label =
                    v === undefined
                      ? `${displayName(a)} × ${displayName(b)}: no shared songs`
                      : `${displayName(a)} × ${displayName(b)}: ${fmt(v, 2)}`
                  return (
                    <td
                      key={b}
                      style={{
                        background: v === undefined ? 'transparent' : corrColor(v),
                        color: v === undefined ? 'inherit' : corrInk(v),
                      }}
                      onMouseEnter={(e) => {
                        const wrap = heatWrapRef.current
                        if (!wrap) return
                        const cell = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        const box = wrap.getBoundingClientRect()
                        setHeatTip({ x: cell.left - box.left + cell.width / 2, y: cell.top - box.top, label })
                      }}
                    >
                      {v !== undefined ? Math.round(v * 100) : ''}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">Cell values are correlation × 100.</p>
    </>
  )
}
