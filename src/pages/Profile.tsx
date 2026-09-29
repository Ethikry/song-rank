import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { dataset } from '../lib/data'
import { crownHistory } from '../lib/awards'
import { fmt, plural } from '../lib/format'
import { displayName } from '../lib/names'
import {
  ArtistCredit,
  ArtistLink,
  Name,
  RankBadge,
  ScoreChip,
  SongNote,
  SongCell,
  SongTitle,
  Thumb,
  Tile,
  Histogram,
  useParamState,
  YearScopePills,
} from '../components/bits'
import { Avatar } from '../components/identity'
import { Scatter, TrendLine } from '../components/charts'
import { SharedArtists } from './Taste'
import { BRANCH_LABELS, branchAffinity } from '../lib/branches'
import { SITE, cap } from '../lib/site'
import {
  ALL_YEARS,
  isAllYears,
  onlyYear,
  parseYearScope,
  scopeIncludes,
  scopeLabel,
  scopedDataset,
  toggleYear,
  yearScopeParam,
  type YearScope,
} from '../lib/yearScope'
import type { Song } from '../lib/types'

export default function Profile() {
  const { name: raw } = useParams()
  const navigate = useNavigate()
  const key = (raw ?? '').toLowerCase()
  const { years, perYear } = dataset

  // Their all-time record, independent of the year filter. Drives the year
  // pills and the year-by-year table, which have to keep showing every year
  // even when the rest of the page is scoped to one.
  const career = dataset.allTime.participantStats[key]

  // Year scope lives in the URL, using the same idiom as the Songs page.
  // `initial` stays the literal 'all' so the param's presence means the same
  // thing for every viewer (useParamState deletes the key at its initial value).
  const [yearParam, setYearParam] = useParamState('year', 'all')
  // Only years they actually took part in are scopeable — a hand-edited URL or
  // a stale link naming another year degrades to all-time rather than rendering
  // an empty page. Excluding a year they missed would be a no-op, so those
  // aren't offered either.
  const scope = parseYearScope(yearParam, career?.years ?? [])
  const setScope = (s: YearScope) => setYearParam(yearScopeParam(s))
  const single = onlyYear(scope)

  // Recomputing the dataset over the scoped years gives every downstream
  // consumer — stats, pairwise, nominators, branchAffinity — a coherent view
  // with no changes on their side. See subset.ts for why it clones first.
  const data = scopedDataset(dataset, scope)
  const allTime = data.allTime
  const stats = allTime.participantStats[key]

  if (!career || !stats) {
    return (
      <>
        <h1>Unknown participant</h1>
        <p className="subtitle">
          No data for “{raw}”. <Link to="/participants">Back to participants</Link>
        </p>
      </>
    )
  }

  const scored: { song: Song; score: number; dev: number }[] = []
  for (const s of allTime.songs) {
    const v = s.scores[key]
    if (v !== undefined) scored.push({ song: s, score: v, dev: v - s.average })
  }
  const top = [...scored].sort((a, b) => b.score - a.score || b.song.average - a.song.average).slice(0, 10)
  const bottom = [...scored].sort((a, b) => a.score - b.score || a.song.average - b.song.average).slice(0, 5)
  const overrated = [...scored].sort((a, b) => a.dev - b.dev).slice(0, 5)
  const underrated = [...scored].sort((a, b) => b.dev - a.dev).slice(0, 5)

  const artistScores = new Map<string, number[]>()
  for (const { song, score } of scored) {
    for (const a of song.artists) {
      if (!artistScores.has(a)) artistScores.set(a, [])
      artistScores.get(a)!.push(score)
    }
  }
  const favoriteArtists = [...artistScores.entries()]
    .filter(([, v]) => v.length >= 3)
    .map(([a, v]) => ({ artist: a, n: v.length, avg: v.reduce((x, y) => x + y, 0) / v.length }))
    // ties favor the artist with more songs
    .sort((a, b) => b.avg - a.avg || b.n - a.n)
  const leastFavoriteArtists = [...favoriteArtists].reverse()

  const pairs = allTime.pairwise
    .filter((p) => p.a === key || p.b === key)
    .map((p) => ({ other: p.a === key ? p.b : p.a, corr: p.corr, overlap: p.overlap }))
    .sort((a, b) => b.corr - a.corr)
  const twins = pairs.slice(0, 5)
  const nemeses = [...pairs].reverse().slice(0, 5)

  // Scores and room averages share one domain so the y=x diagonal reads as a
  // true 45° "agreed with the room" line. Fitted to the data rather than the
  // full 1–11 range, which would strand every point in one corner.
  const scoreDomain: [number, number] = (() => {
    if (scored.length === 0) return [1, 11]
    const vals = scored.flatMap(({ song, score }) => [score, song.average])
    const lo = Math.floor(Math.min(...vals) - 0.5)
    const hi = Math.ceil(Math.max(...vals) + 0.5)
    return [Math.max(1, lo), Math.min(11, hi)]
  })()

  // The year-by-year trend lines plot one point per year they took part in,
  // narrowed to the selection — otherwise a dropped year would still be drawn
  // on a chart the rest of the page has excluded.
  const scopedCareerYears = career.years.filter((y) => scopeIncludes(scope, y))

  const crowns = crownHistory(dataset)
    .filter((c) => c.winners.includes(key))
    .filter((c) => scopeIncludes(scope, c.year))
  const noms = allTime.nominators[key]

  // Full score sheet for one year, opened from the buttons under the header.
  const [sheetYear, setSheetYear] = useState<number | null>(null)
  const sheet = useMemo(() => {
    if (sheetYear === null) return null
    const ys = dataset.perYear[sheetYear]
    if (!ys) return null
    // Their order, not the room's: highest score first, and where they scored
    // two songs the same, the one the room placed higher leads.
    const rows = ys.songs
      .filter((song) => song.scores[key] !== undefined)
      .map((song) => ({ song, score: song.scores[key], note: song.comments?.[key] ?? '' }))
      .sort((a, b) => b.score - a.score || a.song.rank - b.song.rank)
    return { year: sheetYear, rows, notes: rows.filter((r) => r.note).length }
  }, [sheetYear, key])

  // Esc closes, and the page behind must not scroll while it is open.
  useEffect(() => {
    if (sheetYear === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetYear(null)
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [sheetYear])

  return (
    <>
      <div className="profile-head">
        <Avatar participant={key} size={44} />
        <h1>{displayName(key)}</h1>
        <YearScopePills
          variant="pill"
          allLabel="All-time"
          years={years.map((y) => y.year)}
          // Years they missed stay inert — there is nothing to scope to.
          inertYears={years.map((y) => y.year).filter((y) => !career.years.includes(y))}
          inertTitle="Didn't take part"
          scope={scope}
          onChange={setScope}
        />
      </div>
      <div className="sheet-open">
        <span className="note">Score sheet:</span>
        {career.years.map((y) => (
          <button key={y} className="pill pill-button" onClick={() => setSheetYear(y)}>
            {y}
          </button>
        ))}
      </div>
      {!isAllYears(scope) && (
        <p className="note" style={{ margin: '6px 0 0' }}>
          {`Showing ${displayName(key)}’s ${scopeLabel(scope, career.years)} — every stat below covers `}
          {single === null ? 'those years' : 'that year'} only.{' '}
          <button className="linklike" onClick={() => setScope(ALL_YEARS)}>
            Back to all-time
          </button>
        </p>
      )}
      {crowns.length > 0 && (
        <p style={{ margin: '6px 0 0' }}>
          {crowns.map((c) => (
            <span className="pill" key={`${c.year}-${c.award.key}`} style={{ borderColor: 'var(--gold)' }}>
              👑 {c.award.title} {c.year}
            </span>
          ))}
        </p>
      )}

      <div className="tiles">
        <Tile value={stats.songsScored} label="Songs scored" />
        <Tile value={fmt(stats.avgGiven)} label="Average score given" detail={`σ ${fmt(stats.stddevGiven)}`} />
        <Tile value={fmt(stats.corrToAvg, 3)} label="Consensus correlation" />
        <Tile value={fmt(stats.avgAbsDiff)} label="Avg distance from consensus" />
        <Tile value={stats.reds} label="Reds (song's lowest score)" />
        <Tile value={stats.greens} label="Greens (top score / 10+)" />
      </div>
      <p className="note">
        Compare {displayName(key)} with anyone:{' '}
        <Link to={`/compare?a=${encodeURIComponent(key)}`} className="chapter-link">
          open Head to Head →
        </Link>{' '}
        · Recaps:{' '}
        <Link to={`/recap/all/${encodeURIComponent(key)}`} className="chapter-link">
          all-time →
        </Link>
        {career.years.map((yr) => (
          <span key={yr}>
            {' · '}
            <Link to={`/recap/${yr}/${encodeURIComponent(key)}`} className="chapter-link">
              {yr} →
            </Link>
          </span>
        ))}
      </p>

      <h2>Their scoring signature</h2>
      <div className="two-col">
        <div>
          <h3>
            {isAllYears(scope)
              ? "Every score they've given"
              : `Every score they gave in ${scopeLabel(scope, career.years)}`}
          </h3>
          <Histogram values={scored.map((s) => s.score)} />
          <p className="note">
            {scored.length} scores · mean {fmt(stats.avgGiven)} · σ {fmt(stats.stddevGiven)}
          </p>
        </div>
        {/* Trends are inherently cross-year, so they only make sense unscoped. */}
        {single === null && scopedCareerYears.length > 1 && (
          <div>
            <h3>Year by year</h3>
            <TrendLine
              series={scopedCareerYears.map((yr) => ({ year: yr, value: perYear[yr].participantStats[key].avgGiven }))}
              domain={[4, 10]}
            />
            <p className="note">Average score given per year</p>
            <TrendLine
              series={scopedCareerYears.map((yr) => ({ year: yr, value: perYear[yr].participantStats[key].corrToAvg }))}
              domain={[0, 1]}
              format={(v) => v.toFixed(3)}
            />
            <p className="note">Correlation with the final results, per year</p>
          </div>
        )}
        {/* The per-song view only reads well within a single year, where the
            field is one coherent ranking. */}
        {single !== null && (
          <div>
            <h3>Every song in {single}</h3>
            <Scatter
              points={scored.map(({ song, score }) => ({
                x: song.average,
                y: score,
                label: `${song.title} — ${song.artist} · they gave ${fmt(score, 1)}, room ${fmt(song.average)} (finished #${song.rank})`,
                color: score - song.average >= 0 ? 'var(--green)' : 'var(--vermillion)',
                onClick: () => navigate(`/song/${song.year}/${encodeURIComponent(song.id)}`),
              }))}
              xLabel="Room average"
              yLabel="Their score"
              xDomain={scoreDomain}
              yDomain={scoreDomain}
              diagonal
              width={520}
              height={380}
            />
            <p className="note">
              Each dot is a song; above the line they scored it over the room's average, below under. Click a dot to
              open it.
            </p>
          </div>
        )}
      </div>

      <h2>The 11s ★</h2>
      {stats.elevens.length ? (
        <div className="card-grid">
          {stats.elevens.map((s) => (
            <div className="card" key={`${s.year}-${s.id}`}>
              <div className="song-cell">
                <Thumb s={s} size="large" />
                <div>
                  <div style={{ fontWeight: 650 }}>
                    <SongTitle s={s} withYear />
                  </div>
                  <div style={{ color: 'var(--ink-2)', fontSize: 13 }}>
                    <ArtistCredit s={s} />
                  </div>
                  <div className="note">
                    finished #{s.rank} · avg {fmt(s.average)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="note">Never used an 11.</p>
      )}

      <div className="two-col">
        <div>
          <h2>Their top 10</h2>
          {/* Chip, song cell and rank in a half-width column: a long artist
              credit holds the row open past a small phone's viewport, so this
              scrolls in place like the page's other song tables. */}
          <div className="scroll-x">
            <table className="data">
              <tbody>
                {top.map(({ song, score }) => (
                  <tr key={`${song.year}-${song.id}`}>
                    <td>
                      <ScoreChip v={score} />
                    </td>
                    <td>
                      <SongCell s={song} withYear sub={song.artist} />
                      <SongNote s={song} who={key} />
                    </td>
                    <td className="num">#{song.rank}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>Least favorite</h2>
          <table className="data">
            <tbody>
              {bottom.map(({ song, score }) => (
                <tr key={`${song.year}-${song.id}`}>
                  <td>
                    <ScoreChip v={score} />
                  </td>
                  <td>
                    <SongCell s={song} withYear sub={song.artist} />
                    <SongNote s={song} who={key} />
                  </td>
                  <td className="num">#{song.rank}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h2>Hot takes</h2>
          <h3>Loved more than everyone ({'score − avg'})</h3>
          <table className="data">
            <tbody>
              {underrated.map(({ song, score, dev }) => (
                <tr key={`${song.year}-${song.id}`}>
                  <td>
                    <ScoreChip v={score} />
                  </td>
                  <td>
                    <SongCell s={song} withYear sub={song.artist} />
                    <SongNote s={song} who={key} />
                  </td>
                  <td className="num" style={{ color: 'var(--green)' }}>
                    +{fmt(dev, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Hated more than everyone</h3>
          <table className="data">
            <tbody>
              {overrated.map(({ song, score, dev }) => (
                <tr key={`${song.year}-${song.id}`}>
                  <td>
                    <ScoreChip v={score} />
                  </td>
                  <td>
                    <SongCell s={song} withYear sub={song.artist} />
                    <SongNote s={song} who={key} />
                  </td>
                  <td className="num" style={{ color: 'var(--vermillion)' }}>
                    {fmt(dev, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2>{cap(SITE.group.singular)} loyalties</h2>
      <p className="note">
        Average per {SITE.group.singular}, against their {fmt(stats.avgGiven)} baseline (5+ songs).
      </p>
      <div className="scroll-x">
        <table className="data" style={{ maxWidth: 560 }}>
          <tbody>
            {branchAffinity(data, key).map((b) => (
              <tr key={b.branch}>
                <td style={{ fontWeight: 700 }}>{BRANCH_LABELS[b.branch]}</td>
                <td className="num">{fmt(b.avg)}</td>
                <td className="num note">{plural(b.n, 'song')}</td>
                <td className="num" style={{ color: b.delta >= 0 ? 'var(--green)' : 'var(--vermillion)', fontWeight: 700 }}>
                  {b.delta >= 0 ? '+' : ''}
                  {fmt(b.delta)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="two-col">
        <div>
          <h2>Favorite artists</h2>
          <p className="note">By their average, artists with 3+ songs.</p>
          <table className="data">
            <tbody>
              {favoriteArtists.slice(0, 10).map((a) => (
                <tr key={a.artist}>
                  <td>
                    <ArtistLink a={a.artist} />
                  </td>
                  <td className="num">{fmt(a.avg)}</td>
                  <td className="num note">{a.n} songs</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Least favorite artists</h2>
          {/* Same list read from the other end — deliberately not a separate
              computation, so the two halves can never disagree about a middling
              artist. Shown against their own overall average, because "worst"
              here means worst *for them*: a 7.1 from a generous grader is a
              complaint, and the same 7.1 from a harsh one is praise. */}
          <p className="note">
            Same bar (3+ songs), from the bottom. Overall average {fmt(stats.avgGiven)}.
          </p>
          <table className="data">
            <tbody>
              {leastFavoriteArtists.slice(0, 10).map((a) => (
                <tr key={a.artist}>
                  <td>
                    <ArtistLink a={a.artist} />
                  </td>
                  <td className="num">{fmt(a.avg)}</td>
                  <td
                    className="num"
                    style={{ color: a.avg - stats.avgGiven < 0 ? 'var(--vermillion)' : 'var(--green)' }}
                  >
                    {a.avg - stats.avgGiven >= 0 ? '+' : ''}
                    {fmt(a.avg - stats.avgGiven)}
                  </td>
                  <td className="num note">{a.n} songs</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h2>Taste twins & nemeses</h2>
          {/* Five columns carrying an avatar, three artist chips and two
              figures — the widest table on the page, and the last one here
              still without a wrapper to scroll it on a small phone. */}
          <div className="scroll-x">
            <table className="data">
              <tbody>
                {twins.map((t) => (
                  <tr key={t.other}>
                    <td>🤝</td>
                    <td>
                      <Name n={t.other} avatar />
                      <SharedArtists songs={allTime.songs} a={key} b={t.other} limit={3} />
                    </td>
                    <td className="num">{fmt(t.corr, 2)}</td>
                    <td className="num note">{t.overlap} shared songs</td>
                    <td>
                      <Link to={`/compare?a=${encodeURIComponent(key)}&b=${encodeURIComponent(t.other)}`} className="chapter-link">
                        vs →
                      </Link>
                    </td>
                  </tr>
                ))}
                {nemeses.map((t) => (
                  <tr key={t.other}>
                    <td>⚔️</td>
                    <td>
                      <Name n={t.other} avatar />
                      {/* The other direction for a nemesis: what they fell out over. */}
                      <SharedArtists songs={allTime.songs} a={key} b={t.other} limit={3} want="disagree" />
                    </td>
                    <td className="num">{fmt(t.corr, 2)}</td>
                    <td className="num note">{t.overlap} shared songs</td>
                    <td>
                      <Link to={`/compare?a=${encodeURIComponent(key)}&b=${encodeURIComponent(t.other)}`} className="chapter-link">
                        vs →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Always every year — a cross-year table is the one thing that would be
          useless scoped to a single row, and it doubles as a way back out. */}
      <h2>Year by year</h2>
      <div className="scroll-x">
        <table className="data">
          <thead>
            <tr>
              <th>Year</th>
              <th className="num">Songs</th>
              <th className="num">Avg given</th>
              <th className="num">Consensus corr</th>
              <th className="num">Dist. from consensus</th>
              <th className="num">Reds</th>
              <th className="num">Greens</th>
              <th>The 11</th>
            </tr>
          </thead>
          <tbody>
            {career.years.map((yr) => {
              const p = perYear[yr].participantStats[key]
              return (
                <tr
                  key={yr}
                  className={scope.includes(yr) ? 'row-current' : undefined}
                  // The row mirrors the pill above it: click to add or remove.
                  onClick={() => setScope(toggleYear(scope, yr))}
                  style={{ cursor: 'pointer' }}
                  title={scope.includes(yr) ? `Remove ${yr}` : scope.length ? `Add ${yr}` : `Show only ${yr}`}
                >
                  <td>{yr}</td>
                  <td className="num">{p.songsScored}</td>
                  <td className="num">{fmt(p.avgGiven)}</td>
                  <td className="num">{fmt(p.corrToAvg, 3)}</td>
                  <td className="num">{fmt(p.totalAbsDiff, 1)}</td>
                  <td className="num">{p.reds}</td>
                  <td className="num">{p.greens}</td>
                  <td>{p.elevens.map((s) => s.title).join(', ') || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {noms && (
        <>
          <h2>Nomination record</h2>
          <p className="note">
            {plural(noms.count, 'nomination')} · average rank {fmt(noms.avgRank, 1)} · {noms.top10Count} top-10{' '}
            {noms.top10Count === 1 ? 'finish' : 'finishes'}
          </p>
          <div className="scroll-x">
            <table className="data">
              <tbody>
                {[...noms.noms]
                  .sort((a, b) => a.song.rank / a.fieldSize - b.song.rank / b.fieldSize)
                  .map(({ song, fieldSize }) => (
                    <tr key={`${song.year}-${song.id}`}>
                      <td>
                        <RankBadge rank={song.rank} />
                        <span className="note"> / {fieldSize}</span>
                      </td>
                      <td>
                        <SongTitle s={song} withYear />
                        <div className="note">{song.artist}</div>
                      </td>
                      <td className="num">avg {fmt(song.average)}</td>
                      <td>
                        {song.nominators.length > 1 && (
                          <span className="note">
                            with{' '}
                            {song.nominators
                              .filter((n) => n !== key)
                              .map((n) => displayName(n))
                              .join(', ')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {sheet && (
        <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={`${displayName(key)}'s ${sheet.year} score sheet`}>
          <div className="sheet-panel">
            <div className="sheet-head">
              <div>
                <div className="note">Score sheet</div>
                {/* A plain div, not an h2: the page's section counter increments
                    on every h2 and would number this panel "Nº 11." */}
                <div className="sheet-title">
                  {displayName(key)} · {sheet.year}
                </div>
                <p className="note" style={{ margin: '2px 0 0' }}>
                  All {plural(sheet.rows.length, 'song')} in their order, highest score first
                  {sheet.notes > 0 && <> · {plural(sheet.notes, 'note')} left while ranking</>}
                </p>
              </div>
              <button className="sheet-close" onClick={() => setSheetYear(null)} aria-label="Close score sheet">
                ×
              </button>
            </div>
            <div className="sheet-body">
              <table className="data">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Song</th>
                    <th className="num">Their score</th>
                    <th className="num">Finished</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((r, i) => (
                    <tr key={`${r.song.year}-${r.song.id}`}>
                      <td className="num">{i + 1}</td>
                      <td>
                        <SongCell s={r.song} sub={r.song.artist} />
                        {r.note && <p className="voice-quote sheet-note">{r.note}</p>}
                      </td>
                      <td className="num">
                        <ScoreChip v={r.score} />
                      </td>
                      <td className="num">#{r.song.rank}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
