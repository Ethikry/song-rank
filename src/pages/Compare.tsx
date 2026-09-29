import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { dataset } from '../lib/data'
import { pearson } from '../lib/stats'
import { fmt } from '../lib/format'
import { displayName } from '../lib/names'
import { Name, ScopeNote, ScoreChip, ShowMore, SongCell, SongTitle, SongNote, YearScopePills } from '../components/bits'
import { Avatar, useIdentity } from '../components/identity'
import { SharedArtists } from './Taste'
import { Scatter, YearLegend, yearColor } from '../components/charts'
import { ALL_YEARS, scopeIncludes, type YearScope } from '../lib/yearScope'
import type { Song } from '../lib/types'

/** Deterministic tiny jitter so identical score pairs don't stack invisibly. */
function jitter(id: string, salt: number): number {
  let h = salt
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997
  return ((h / 997) - 0.5) * 0.36
}

/**
 * One side's picker: a rail of faces you flick through.
 *
 * This was a pair of `<select>` elements. Forty names in a native dropdown is a
 * scrolling list of text with no faces in it, it renders differently on every
 * platform, and on a phone it hands the whole choice to a modal wheel — for the
 * one control this page exists to operate. A rail shows who is in the room,
 * takes a flick or a drag or an arrow key, and keeps the current pick visible
 * next to its neighbours.
 *
 * Selection is a radiogroup rather than a row of buttons: arrow keys then move
 * the choice the way they do in a real one, which is what a keyboard user
 * reaches for after tabbing into it.
 */
function RankerRail({
  names,
  value,
  onChange,
  label,
}: {
  names: string[]
  value: string
  onChange: (name: string) => void
  label: string
}) {
  const railRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)

  // Keep the pick on screen when it changes from anywhere else — the URL, the
  // swap button, an arrow key that ran past the edge of the visible run.
  // `block: 'nearest'` so centring it horizontally can't scroll the page.
  useEffect(() => {
    railRef.current
      ?.querySelector<HTMLElement>('[aria-checked="true"]')
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [value])

  const step = (delta: number) => {
    const i = names.indexOf(value)
    const next = names[Math.min(names.length - 1, Math.max(0, i + delta))]
    if (next && next !== value) onChange(next)
  }

  /** Scroll by most of a screenful, leaving an overlap to keep your place. */
  const page = (dir: -1 | 1) => {
    const el = railRef.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  return (
    <div className="rail-wrap">
      <button type="button" className="rail-arrow" onClick={() => page(-1)} aria-label={`Scroll ${label} left`}>
        ‹
      </button>
      <div
        className="rail"
        ref={railRef}
        role="radiogroup"
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault()
            step(1)
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault()
            step(-1)
          } else if (e.key === 'Home') {
            e.preventDefault()
            onChange(names[0])
          } else if (e.key === 'End') {
            e.preventDefault()
            onChange(names[names.length - 1])
          }
        }}
        /* Grab-and-throw for mice and trackpads, which have no flick. The
           threshold is what keeps a drag from also counting as a click on
           whichever face happened to be under the cursor when it started. */
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse') return
          drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          if (Math.abs(dx) > 4) d.moved = true
          if (d.moved) e.currentTarget.scrollLeft = d.left - dx
        }}
        onPointerUp={() => {
          // Cleared on the next frame so the click this pointerup produces can
          // still see that the gesture was a drag.
          const d = drag.current
          requestAnimationFrame(() => {
            if (drag.current === d) drag.current = null
          })
        }}
        onPointerLeave={() => (drag.current = null)}
      >
        {names.map((n) => {
          const on = n === value
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              // Only the current pick is a tab stop, so tabbing through the page
              // doesn't mean forty stops per side.
              tabIndex={on ? 0 : -1}
              className={`rail-chip${on ? ' on' : ''}`}
              onClick={() => {
                if (!drag.current?.moved) onChange(n)
              }}
            >
              <Avatar participant={n} size={40} fallback />
              <span className="rail-name">{displayName(n)}</span>
            </button>
          )
        })}
      </div>
      <button type="button" className="rail-arrow" onClick={() => page(1)} aria-label={`Scroll ${label} right`}>
        ›
      </button>
    </div>
  )
}

export default function Compare() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [chartScope, setChartScope] = useState<YearScope>(ALL_YEARS)
  const [minGap, setMinGap] = useState(0)
  const { allTime, years } = dataset
  const names = [...allTime.participants].sort((x, y) => displayName(x).localeCompare(displayName(y)))
  // Default side A to whoever is viewing. `me.participant` is already validated
  // against the dataset by the identity provider, but a guild member who never
  // ranked has none — fall back rather than landing them on "Unknown participant".
  const { me } = useIdentity()
  const defaultA = me?.participant && names.includes(me.participant) ? me.participant : names[0]
  // Only fires when ?a= is absent, so existing deep links are untouched.
  const a = params.get('a') ?? defaultA
  const b = params.get('b') ?? names.find((n) => n !== a) ?? names[0]
  const yearNums = years.map((y) => y.year)

  const setSide = (side: 'a' | 'b', value: string) => {
    const next = new URLSearchParams(params)
    next.set('a', side === 'a' ? value : a)
    next.set('b', side === 'b' ? value : b)
    setParams(next, { replace: true })
  }

  const shared = useMemo(() => {
    const out: { song: Song; va: number; vb: number; diff: number }[] = []
    for (const s of allTime.songs) {
      const va = s.scores[a]
      const vb = s.scores[b]
      if (va !== undefined && vb !== undefined) out.push({ song: s, va, vb, diff: va - vb })
    }
    return out
  }, [a, b, allTime.songs])

  // The exact songs `corr` was computed over, so the decomposition explains that
  // number rather than a differently-scoped one.
  const sharedSongs = useMemo(() => shared.map((x) => x.song), [shared])

  const sa = allTime.participantStats[a]
  const sb = allTime.participantStats[b]
  if (!sa || !sb) return <p className="subtitle">Unknown participant.</p>

  const corr = pearson(shared.map((s) => s.va), shared.map((s) => s.vb))
  const pairEntry = allTime.pairwise.find(
    (p) => (p.a === a && p.b === b) || (p.a === b && p.b === a),
  )
  const ranking = [...allTime.pairwise]
    .filter((p) => p.a === a || p.b === a)
    .sort((x, y) => y.corr - x.corr)
  const rankOfB = pairEntry ? ranking.indexOf(pairEntry) + 1 : 0

  const aLoves = [...shared].sort((x, y) => y.diff - x.diff).slice(0, 6)
  const bLoves = [...shared].sort((x, y) => x.diff - y.diff).slice(0, 6)
  const bothLove = shared.filter((s) => s.va >= 9 && s.vb >= 9).sort((x, y) => y.va + y.vb - (x.va + x.vb))
  const bothHate = shared.filter((s) => s.va <= 4 && s.vb <= 4).sort((x, y) => x.va + x.vb - (y.va + y.vb))
  const agree = shared.filter((s) => Math.abs(s.diff) <= 0.5).length

  // Artist-level divergence (3+ shared songs)
  const byArtist = new Map<string, { da: number[]; db: number[] }>()
  for (const { song, va, vb } of shared) {
    for (const artist of song.artists) {
      if (!byArtist.has(artist)) byArtist.set(artist, { da: [], db: [] })
      byArtist.get(artist)!.da.push(va)
      byArtist.get(artist)!.db.push(vb)
    }
  }
  const artistGap = [...byArtist.entries()]
    .filter(([, v]) => v.da.length >= 3)
    .map(([artist, v]) => ({
      artist,
      n: v.da.length,
      avgA: v.da.reduce((x, y) => x + y, 0) / v.da.length,
      avgB: v.db.reduce((x, y) => x + y, 0) / v.db.length,
    }))
    .map((e) => ({ ...e, gap: e.avgA - e.avgB }))
    .sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap))

  const h2h: { label: string; va: string; vb: string }[] = [
    { label: 'Years attended', va: sa.years.join(', '), vb: sb.years.join(', ') },
    { label: 'Songs scored', va: String(sa.songsScored), vb: String(sb.songsScored) },
    { label: 'Average given', va: fmt(sa.avgGiven), vb: fmt(sb.avgGiven) },
    { label: 'Consensus correlation', va: fmt(sa.corrToAvg, 3), vb: fmt(sb.corrToAvg, 3) },
    { label: 'Reds · Greens', va: `${sa.reds} · ${sa.greens}`, vb: `${sb.reds} · ${sb.greens}` },
  ]

  return (
    <>
      <h1>Head to Head</h1>
      <p className="subtitle">Where two rankers agree and diverge.</p>

      <div className="picker">
        <div className="picker-side">
          <div className="picker-label">
            <span className="picker-tag">Side A</span>
            <strong>{displayName(a)}</strong>
          </div>
          <RankerRail names={names} value={a} onChange={(n) => setSide('a', n)} label="Side A" />
        </div>
        <button
          type="button"
          className="picker-swap"
          onClick={() => {
            const next = new URLSearchParams(params)
            next.set('a', b)
            next.set('b', a)
            setParams(next, { replace: true })
          }}
          title="Swap sides"
          aria-label="Swap sides"
        >
          <span className="picker-versus">versus</span>
          <span className="picker-swap-icon" aria-hidden="true">
            ⇅
          </span>
        </button>
        <div className="picker-side">
          <div className="picker-label">
            <span className="picker-tag">Side B</span>
            <strong>{displayName(b)}</strong>
          </div>
          <RankerRail names={names} value={b} onChange={(n) => setSide('b', n)} label="Side B" />
        </div>
      </div>

      {shared.length < 5 ? (
        <p className="note">
          {displayName(a)} and {displayName(b)} share only {shared.length} scored songs — not enough to compare.
        </p>
      ) : (
        <>
          <div className="vs-head">
            <div className="side">
              <Name n={a} avatar />
            </div>
            <div className="mid">
              {corr >= 0.45 ? 'kindred spirits' : corr >= 0.25 ? 'broadly aligned' : corr >= 0.05 ? 'polite disagreement' : 'opposing camps'}
            </div>
            <div className="side right">
              <Name n={b} avatar />
            </div>
          </div>

          <div className="tiles">
            <div className="tile">
              <div className="value">{fmt(corr, 2)}</div>
              <div className="label">Taste correlation</div>
              <div className="detail">
                {rankOfB > 0 && `${displayName(b)} is ${displayName(a)}'s #${rankOfB} closest match of ${ranking.length}`}
              </div>
            </div>
            <div className="tile">
              <div className="value">{shared.length}</div>
              <div className="label">Songs both scored</div>
            </div>
            <div className="tile">
              <div className="value">{Math.round((agree / shared.length) * 100)}%</div>
              <div className="label">Within half a point</div>
            </div>
            <div className="tile">
              <div className="value">{fmt(shared.reduce((x, s) => x + Math.abs(s.diff), 0) / shared.length, 2)}</div>
              <div className="label">Avg gap per song</div>
            </div>
          </div>

          {/* The correlation in the tile above, taken apart: the artists that
              built it and the ones holding it down. Both halves are shown here
              rather than one — on a head-to-head page the question is the whole
              relationship, not just its friendly side. */}
          <h2>What that number is made of</h2>
          <div className="two-col">
            <div>
              <h3>
                <span className="agree-up">Common ground</span>
              </h3>
              <p className="note">
                Artists they land on the same side of: both above their own average, or both below.
              </p>
              <SharedArtists songs={sharedSongs} a={a} b={b} limit={8} />
            </div>
            <div>
              <h3>
                <span className="agree-split">Battlegrounds</span>
              </h3>
              <p className="note">
                Artists pulling them apart — one rated up, the other down. These are what keeps the number from being
                higher.
              </p>
              <SharedArtists songs={sharedSongs} a={a} b={b} limit={8} want="disagree" />
            </div>
          </div>

          <h2>Every shared song</h2>
          <p className="note">
            Each dot is a song; on the dashed line they agreed exactly, farther off is a wider split. Click to open it.
          </p>
          <div className="controls">
            <YearScopePills years={yearNums} scope={chartScope} onChange={setChartScope} />
            <div className="seg">
              {[0, 2, 4].map((g) => (
                <button key={g} className={minGap === g ? 'on' : ''} onClick={() => setMinGap(g)}>
                  {g === 0 ? 'All songs' : `Gap ≥ ${g}`}
                </button>
              ))}
            </div>
            <span className="note">
              {shared.filter((s) => scopeIncludes(chartScope, s.song.year) && Math.abs(s.diff) >= minGap).length}{' '}
              dots
            </span>
            <ScopeNote scope={chartScope} years={yearNums} />
          </div>
          <Scatter
            points={shared
              .filter((s) => scopeIncludes(chartScope, s.song.year) && Math.abs(s.diff) >= minGap)
              .map(({ song, va, vb }) => ({
                x: va + jitter(song.id + song.year, 3),
                y: vb + jitter(song.id + song.year, 7),
                label: `${song.title} (${song.year}) — ${displayName(a)}: ${va}, ${displayName(b)}: ${vb}`,
                color: yearColor(song.year, yearNums),
                onClick: () => navigate(`/song/${song.year}/${encodeURIComponent(song.id)}`),
              }))}
            xLabel={`${displayName(a)}'s score`}
            yLabel={`${displayName(b)}'s score`}
            xDomain={[0.5, 11.5]}
            yDomain={[0.5, 11.5]}
            diagonal
            r={4}
          />
          <YearLegend years={yearNums.filter((y) => scopeIncludes(chartScope, y))} all={yearNums} />

          <h2>Head-to-head record</h2>
          <table className="data h2h" style={{ maxWidth: 620 }}>
            <tbody>
              {h2h.map((r) => (
                <tr key={r.label}>
                  <td className="a">{r.va}</td>
                  <td className="mid">{r.label}</td>
                  <td className="b">{r.vb}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>The great divides</h2>
          <div className="two-col">
            <div>
              <h3>
                <Name n={a} /> loved it, <Name n={b} /> didn't
              </h3>
              <table className="data">
                <tbody>
                  {aLoves.map(({ song, va, vb }) => (
                    <tr key={`${song.year}-${song.id}`}>
                      <td>
                        <ScoreChip v={va} /> <ScoreChip v={vb} />
                      </td>
                      <td>
                        <SongCell s={song} withYear sub={song.artist} />
                        <SongNote s={song} who={[a, b]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3>
                <Name n={b} /> loved it, <Name n={a} /> didn't
              </h3>
              <table className="data">
                <tbody>
                  {bLoves.map(({ song, va, vb }) => (
                    <tr key={`${song.year}-${song.id}`}>
                      <td>
                        <ScoreChip v={vb} /> <ScoreChip v={va} />
                      </td>
                      <td>
                        <SongCell s={song} withYear sub={song.artist} />
                        <SongNote s={song} who={[a, b]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <h2>Common ground</h2>
          <div className="two-col">
            <div>
              <h3>Both loved (9+ from each)</h3>
              {bothLove.length ? (
                <ShowMore items={bothLove} initial={6} noun="songs">
                  {(shown) => (
                    <table className="data">
                      <tbody>
                        {shown.map(({ song, va, vb }) => (
                          <tr key={`${song.year}-${song.id}`}>
                            <td>
                              <ScoreChip v={va} /> <ScoreChip v={vb} />
                            </td>
                            <td>
                              <SongTitle s={song} withYear />
                              <div className="note">{song.artist}</div>
                              <SongNote s={song} who={[a, b]} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </ShowMore>
              ) : (
                <p className="note">Not a single song both rated 9+.</p>
              )}
            </div>
            <div>
              <h3>Both buried (4 or less from each)</h3>
              {bothHate.length ? (
                <ShowMore items={bothHate} initial={6} noun="songs">
                  {(shown) => (
                    <table className="data">
                      <tbody>
                        {shown.map(({ song, va, vb }) => (
                          <tr key={`${song.year}-${song.id}`}>
                            <td>
                              <ScoreChip v={va} /> <ScoreChip v={vb} />
                            </td>
                            <td>
                              <SongTitle s={song} withYear />
                              <div className="note">{song.artist}</div>
                              <SongNote s={song} who={[a, b]} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </ShowMore>
              ) : (
                <p className="note">They never agreed on a dud.</p>
              )}
            </div>
          </div>

          {artistGap.length > 0 && (
            <>
              <h2>Where the artist loyalties split</h2>
              <p className="note">Artists with 3+ songs both scored, ordered by the size of the gap.</p>
              <ShowMore items={artistGap} initial={8} noun="artists">
                {(shown) => (
                  <div className="scroll-x">
                    <table className="data" style={{ maxWidth: 640 }}>
                      <thead>
                        <tr>
                          <th>Artist</th>
                          <th className="num">{displayName(a)}</th>
                          <th className="num">{displayName(b)}</th>
                          <th className="num">Gap</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((e) => (
                          <tr key={e.artist}>
                            <td>
                              <Link to={`/artist/${encodeURIComponent(e.artist)}`}>{e.artist}</Link>{' '}
                              <span className="note">({e.n})</span>
                            </td>
                            <td className="num">{fmt(e.avgA)}</td>
                            <td className="num">{fmt(e.avgB)}</td>
                            <td className="num" style={{ color: e.gap >= 0 ? 'var(--green)' : 'var(--vermillion)', fontWeight: 600 }}>
                              {e.gap >= 0 ? '+' : ''}
                              {fmt(e.gap)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </ShowMore>
            </>
          )}
        </>
      )}
    </>
  )
}
