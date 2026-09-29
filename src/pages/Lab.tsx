import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useScopedDataset } from '../components/identity'
import { carriedSongs, tierImpacts, tierImpactsAllTime } from '../lib/whatif'
import { altRankingsByYear, pooledRanks, SYSTEM_BLURBS, SYSTEM_LABELS, SYSTEMS, type AltRank, type System } from '../lib/consensus'
import { fmt, pct, plural } from '../lib/format'
import { Name, ScopeNote, ScoreChip, ShowMore, SongCell, SongNote, SongTitle, useParamState, useSort, YearScopePills } from '../components/bits'
import {
  isAllYears,
  onlyYear,
  parseYearScope,
  scopedDataset,
  scopeIncludes,
  scopeLabel,
  yearScopeParam,
  type YearScope,
} from '../lib/yearScope'

type SwingKey = 'move' | 'song' | 'official' | 'new' | 'bigLoves' | 'lowballs'

/**
 * What a pill box on this page actually governs.
 *
 * The page carries two independent year selections across three sections, which
 * is invisible in a control bar that looks identical every time: changing the
 * podium's years silently re-scoped "Carried & buried" further down, and the
 * showdown's years looked like they might do the same. Both shared sections now
 * show their own live copy of the pills, and every bar says how far it reaches.
 */
function ScopeReach({ children }: { children: ReactNode }) {
  return <span className="note scope-reach">{children}</span>
}

/** How far a song moved off the official board, as a badge. */
function Move({ delta }: { delta: number }) {
  if (delta === 0) return <span className="note"> —</span>
  return (
    <span className="move" style={{ color: delta > 0 ? 'var(--green)' : 'var(--vermillion)' }}>
      {delta > 0 ? '▲' : '▼'}
      {Math.abs(delta)}
    </span>
  )
}

export default function Lab() {
  // Follows the edition preference; see components/identity.tsx.
  const dataset = useScopedDataset()
  const { years } = dataset
  const yearNums = years.map((y) => y.year)
  /*
   * URL-backed, so a year page can hand off to "what one voice was worth in
   * 2023" and land on that year. The default is still the most recent edition
   * rather than all-time, which is the useful opening view here — hence the
   * empty-string initial: `parseYearScope` only reads a param that's there.
   */
  const [scopeParam, setScopeParam] = useParamState('scope', '')
  const scope = scopeParam ? parseYearScope(scopeParam, yearNums) : [yearNums[yearNums.length - 1]]
  const setScope = (s: YearScope) => setScopeParam(yearScopeParam(s))
  const single = onlyYear(scope)

  // The showdown scopes independently of the counterfactuals below — they answer
  // different questions and are far enough apart on the page that one shared
  // control would change a section nobody was looking at.
  const [tallyScope, setTallyScope] = useState<YearScope>([yearNums[yearNums.length - 1]])
  const [system, setSystem] = useState<System>('borda')
  const tallySingle = onlyYear(tallyScope)

  // Tallied per year and then pooled: Borda points and finishing rank both scale
  // with the size of the field, so a pooled tally would just rank the editions.
  const altRows = useMemo(
    () => altRankingsByYear(years.filter((y) => scopeIncludes(tallyScope, y.year)).map((y) => y.songs)),
    [years, tallyScope],
  )

  // Once more than one edition is in the selection, every column becomes one
  // combined leaderboard: songs from different years are compared on the value the
  // column measures, not on their within-year finish (a #1 of 71 no longer beats a
  // #1 of 111 for free). A single edition keeps its own board — and the raw-average
  // column keeps the site's published ranks, ties and all.
  const isPooled = tallySingle === null
  const pooled = useMemo(() => pooledRanks(altRows), [altRows])
  const rankUnder = (row: AltRank, sys: System) => (isPooled ? pooled[sys].get(row.song)! : row.ranks[sys])

  // Each system's ordering for the top-5 snippet, sharing the pooled/per-year rule.
  const columns = useMemo(() => {
    const out = {} as Record<System, AltRank[]>
    for (const sys of SYSTEMS) {
      out[sys] = isPooled
        ? [...altRows].sort(
            (a, b) =>
              pooled[sys].get(a.song)! - pooled[sys].get(b.song)! ||
              b.poolValue[sys] - a.poolValue[sys] ||
              a.song.id.localeCompare(b.song.id),
          )
        : // Single edition: each column is that year's board under `sys`, so a song
          // it ranks top-5 shows here even if the raw average doesn't. Ties at the
          // boundary break on the raw tally then id, so the fifth slot is a stable,
          // meaningful pick rather than whatever order the songs arrived in.
          [...altRows].sort(
            (a, b) =>
              a.percentiles[sys] - b.percentiles[sys] ||
              b.poolValue[sys] - a.poolValue[sys] ||
              a.song.id.localeCompare(b.song.id),
          )
    }
    return out
  }, [altRows, pooled, isPooled])

  // Default to the new system's own board: the question the section asks is
  // "what does this ranking look like", and a list led by whatever moved most
  // answers a different one. Movement is still a click away.
  const swingSort = useSort<SwingKey>('new', 1)
  const swings = useMemo(() => {
    const dir = swingSort.dir
    // gain: how far the song sits off the official board — places moved in the
    // combined board when pooled, share of its own year's field for one edition.
    const movers = altRows.map((row) => ({
      row,
      gain: isPooled
        ? pooled.mean.get(row.song)! - pooled[system].get(row.song)!
        : row.percentiles.mean - row.percentiles[system],
    }))
    return movers.sort((a, b) => {
      const tie = a.row.song.id.localeCompare(b.row.song.id)
      switch (swingSort.key) {
        case 'move':
          return (Math.abs(a.gain) - Math.abs(b.gain)) * dir || tie
        case 'song':
          return a.row.song.title.localeCompare(b.row.song.title) * dir || tie
        case 'official':
          return (rankUnder(a.row, 'mean') - rankUnder(b.row, 'mean')) * dir || tie
        case 'bigLoves':
          return (a.row.bigLoves - b.row.bigLoves) * dir || rankUnder(a.row, system) - rankUnder(b.row, system) || tie
        case 'lowballs':
          return (a.row.lowballs - b.row.lowballs) * dir || rankUnder(a.row, system) - rankUnder(b.row, system) || tie
        default:
          return (rankUnder(a.row, system) - rankUnder(b.row, system)) * dir || tie
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [altRows, system, pooled, isPooled, swingSort.key, swingSort.dir])
  const moved = useMemo(() => swings.filter((s) => s.gain !== 0).length, [swings])

  // The full re-count is a panel rather than a fourth table on the page: it runs
  // to every song in the selection (371 all-time) and only makes sense once you
  // have read the top five above.
  const [recount, setRecount] = useState(false)
  useEffect(() => {
    if (!recount) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRecount(false)
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [recount])

  const impacts = useMemo(
    () =>
      single === null
        ? tierImpactsAllTime(scopedDataset(dataset, scope))
        : tierImpacts(dataset, single),
    [scope, single, dataset],
  )
  // Scoped by the same selection as the counterfactuals above it — which the
  // section now shows its own pills for: arriving from a year page and reading
  // an all-time table under a "2023" selection made it disagree with its own
  // controls, and a scoped section with no controls at all was no better.
  const carried = useMemo(
    () =>
      carriedSongs(dataset)
        .filter((c) => scopeIncludes(scope, c.song.year))
        .sort(
          (a, b) =>
            Math.abs(b.rankWithout - b.rankWith) - Math.abs(a.rankWithout - a.rankWith) ||
            Math.abs(b.lift) - Math.abs(a.lift),
        )
        .slice(0, 40),
    [dataset, scopeParam],
  )
  /*
   * The headline pair, picked the way the deck picks it: prefer an example
   * where the single voter actually moved the song's placing, since a lift that
   * changed no rank reads as a non-event, and fall back to the biggest raw lift
   * when nothing in the selection shifted one.
   */
  const topCarried = useMemo(
    () => carried.find((c) => c.lift > 0 && c.rankWith < c.rankWithout) ?? carried.find((c) => c.lift > 0),
    [carried],
  )
  const topBuried = useMemo(
    () => carried.find((c) => c.lift < 0 && c.rankWith > c.rankWithout) ?? carried.find((c) => c.lift < 0),
    [carried],
  )
  const field = single === null ? null : dataset.perYear[single].songs.length

  const swingTh = (k: SwingKey, label: string, cls = '', d: 1 | -1 = -1) => (
    <th className={`sortable ${cls}`} onClick={() => swingSort.toggle(k, d)}>
      {label}
      {swingSort.arrow(k)}
    </th>
  )

  return (
    <>
      <h1>The What-If Lab</h1>
      <p className="subtitle">
        How the board changes when one ranker's ballot is removed.
      </p>

      <h2>If we'd counted differently</h2>
      <p className="note">
        The same ballots tallied four ways — the top five of each board, with the full re-count below. The official
        board is a raw average; the other three each curb extreme scores.{' '}
        {isPooled
          ? 'Across editions each column ranks every selected song together, so its five can differ from the next column’s. Badges show places gained or lost (▲ = higher).'
          : 'Badges show the shift off the official board (▲ = higher).'}
      </p>
      <div className="controls">
        <YearScopePills years={yearNums} scope={tallyScope} onChange={setTallyScope} allLabel="All time" />
        <ScopeNote scope={tallyScope} years={yearNums} />
        <ScopeReach>Scopes this section only.</ScopeReach>
      </div>
      <div className="scroll-x">
        <table className="data">
          <thead>
            <tr>
              <th></th>
              {SYSTEMS.map((sys) => (
                <th key={sys} style={{ minWidth: 150 }}>
                  {SYSTEM_LABELS[sys]}
                  <div className="note th-blurb">{SYSTEM_BLURBS[sys]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5].map((pos) => (
              <tr key={pos}>
                <td className="num" style={{ fontWeight: 700 }}>#{pos}</td>
                {SYSTEMS.map((sys) => {
                  // The top of each system's board (see `columns`): the combined
                  // 1..n leaderboard when several editions are pooled, the within-
                  // year finish for a single one. The badge is the same shift off
                  // the official board, measured in whichever board is showing.
                  const row = columns[sys][pos - 1]
                  if (!row) return <td key={sys} />
                  return (
                    <td key={sys}>
                      <SongTitle s={row.song} withYear={tallySingle === null} />
                      {sys !== 'mean' && <Move delta={rankUnder(row, 'mean') - rankUnder(row, sys)} />}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="controls">
        <button className="pill pill-button" onClick={() => setRecount(true)}>
          Explore more →
        </button>
        <span className="note">
          Every song {scopeLabel(tallyScope, yearNums)} re-counted, side by side with its official finish.
        </span>
      </div>

      <h2>Who could rewrite the podium</h2>
      <p className="note">
        Songs sit under the ranker with most pull, shown when removing them moves 2+ ranks around{' '}
        {single === null ? "a year's" : `the ${single}`} top 3 or last 3. 🏆 podium, 🥄 bottom 3.
      </p>
      <div className="controls">
        <YearScopePills years={yearNums} scope={scope} onChange={setScope} allLabel="All time" />
        <ScopeNote scope={scope} years={yearNums} />
        <ScopeReach>One selection, shared with “Carried &amp; buried” below.</ScopeReach>
      </div>
      {impacts.length === 0 ? (
        <p className="note">
          No single ranker changes the {single === null ? '' : `${single} `}extremes.
        </p>
      ) : (
        <div className="card-grid">
          {impacts.slice(0, 6).map((imp) => (
            <div className="card" key={imp.participant}>
              <h3 style={{ marginTop: 0 }}>
                Without <Name n={imp.participant} avatar />…
              </h3>
              {imp.changes.map((c) => (
                <div className="lab-change" key={`${c.song.year}-${c.song.id}`}>
                  <div className="head">
                    <span>{c.to <= 3 || c.from <= 3 ? '🏆' : '🥄'}</span>
                    <SongCell s={c.song} withYear={single === null} sub={c.song.artist} />
                  </div>
                  <div className="meta">
                    <span className="note" style={{ margin: 0 }}>their score:</span>
                    <ScoreChip v={c.score} />
                    <span style={{ whiteSpace: 'nowrap' }}>
                      #{c.from} →{' '}
                      <strong style={{ color: c.to < c.from ? 'var(--green)' : 'var(--vermillion)' }}>#{c.to}</strong>
                    </span>
                  </div>
                  <SongNote s={c.song} who={imp.participant} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {field !== null && single !== null && <p className="note">Ranks out of {field} songs in {single}.</p>}

      <h2>Carried & buried</h2>
      <p className="note">
        Songs most swayed by one ranker, {isAllYears(scope) ? 'all-time' : `in ${scopeLabel(scope, yearNums)}`}, sorted by ranks. Green = raised, red = lowered.
      </p>
      {/* The podium's pills again, on the same state: the section is scoped, so it
          says so where you read it rather than a screen and a half up. */}
      <div className="controls">
        <YearScopePills years={yearNums} scope={scope} onChange={setScope} allLabel="All time" />
        <ScopeNote scope={scope} years={yearNums} />
        <ScopeReach>One selection, shared with “Who could rewrite the podium” above.</ScopeReach>
      </div>
      {/*
        The deck's two cards, brought over.

        The table below is the whole record, but the section opened cold on a
        six-column grid in which the two headline facts — the single biggest
        carry and the single biggest bury — were merely its first two rows,
        indistinguishable from the other thirty-eight and pointing in opposite
        directions. The slide states them as a pair, one each way, which is the
        shape of the question; the table now backs that up rather than standing
        in for it. Both read "without them → with them", so the arrow is what
        that one ballot did.
      */}
      {(topCarried || topBuried) && (
        <div className="lab-heroes">
          {(
            [
              ['💪 Carried it', topCarried, 'up'],
              ['🪦 Buried it', topBuried, 'down'],
            ] as const
          ).map(([title, c, dir]) =>
            c ? (
              <div className="card lab-hero" key={dir}>
                <h3 style={{ marginTop: 0 }}>{title}</h3>
                <div className="lab-hero-who">
                  <Name n={c.who} avatar />
                </div>
                <SongCell s={c.song} withYear sub={c.song.artist} />
                <div className={`lab-hero-move ${dir}`}>
                  <ScoreChip v={c.withScore} />
                  <span className="tri">{dir === 'up' ? '▲' : '▼'}</span>
                  <span className="mv">
                    #{c.rankWithout} → #{c.rankWith}
                  </span>
                </div>
                <p className="note" style={{ margin: '4px 0 0' }}>
                  without them → with them · their score {dir === 'up' ? 'lifted' : 'cost'} it{' '}
                  {fmt(Math.abs(c.lift), 2)} of a point
                </p>
                <SongNote s={c.song} who={c.who} />
              </div>
            ) : null,
          )}
        </div>
      )}
      <ShowMore items={carried} initial={10} noun="songs">
        {(shown) => (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th className="num">Δ rank</th>
                  <th>Song</th>
                  <th>Scorer</th>
                  <th>Their score</th>
                  <th className="num">Avg without → with</th>
                  {/* Both pairs run the same way as the cards above — the state
                      of the board without that ballot, then with it — so the
                      arrow always points at what their vote did. They used to
                      read with → without, which inverted the sign of every row
                      against the Δ column beside them. */}
                  <th className="num">Rank without → with</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const swing = c.rankWithout - c.rankWith // ranks the song would fall without them
                  return (
                    <tr key={`${c.song.year}-${c.song.id}`}>
                      <td
                        className="num"
                        style={{
                          color: swing >= 0 ? 'var(--green)' : 'var(--vermillion)',
                          fontWeight: 700,
                          fontSize: 16,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {swing >= 0 ? '+' : ''}
                        {swing}
                      </td>
                      <td>
                        <SongCell s={c.song} withYear={single === null} sub={c.song.artist} />
                        <SongNote s={c.song} who={c.who} />
                      </td>
                      <td>
                        <Name n={c.who} />
                      </td>
                      <td>
                        <ScoreChip v={c.withScore} />
                      </td>
                      <td className="num">
                        {fmt(c.altAverage)} → {fmt(c.song.average)}
                      </td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        #{c.rankWithout} → #{c.rankWith}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </ShowMore>

      {recount && (
        <div
          className="sheet-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Every song re-counted under ${SYSTEM_LABELS[system].toLowerCase()}`}
        >
          <div className="sheet-panel sheet-panel-wide">
            <div className="sheet-head">
              <div>
                <div className="note">If we'd counted differently</div>
                {/* A plain div, not an h2: the page's section counter increments
                    on every h2 and would number this panel. */}
                <div className="sheet-title">
                  The whole board under {SYSTEM_LABELS[system].toLowerCase()}
                </div>
                <p className="note" style={{ margin: '2px 0 0' }}>
                  All {plural(swings.length, 'song')}{' '}
                  {isAllYears(tallyScope) ? 'all-time' : `from ${scopeLabel(tallyScope, yearNums)}`}, in that
                  system's own order
                  {moved > 0 && <> · {moved} finish somewhere other than their official place</>}
                </p>
              </div>
              <button className="sheet-close" onClick={() => setRecount(false)} aria-label="Close the re-count">
                ×
              </button>
            </div>
            <div className="sheet-body">
              <div className="controls" style={{ marginTop: 12 }}>
                <div className="seg">
                  {SYSTEMS.filter((s) => s !== 'mean').map((s) => (
                    <button key={s} className={system === s ? 'on' : ''} onClick={() => setSystem(s)}>
                      {SYSTEM_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>
              <p className="note">
                Click any column to sort — "Move" for the biggest upsets.{' '}
                {isPooled ? (
                  <>
                    Across editions every column is one combined board, all {plural(swings.length, 'song')} numbered
                    1–{swings.length} (Borda per-field-normalized). Move is places off the official board.
                  </>
                ) : (
                  <>Move is a share of the year's field, so it reads the same whatever the edition's size.</>
                )}{' '}
                {system === 'median' && (
                  <>
                    Medians tie heavily, so ties break on the majority gauge: the share above the grade beats the share
                    below (+), or the smaller share below wins (−).{' '}
                  </>
                )}
                "10+ scores" and "lowballs" (bottom quarter of that year's scores) usually explain it — songs carried
                by a passionate few fall, songs everyone merely liked climb.
              </p>
              <table className="data">
                <thead>
                  <tr>
                    {swingTh('move', 'Move', 'num')}
                    {swingTh('song', 'Song', '', 1)}
                    {swingTh('official', 'Official', 'num', 1)}
                    {swingTh('new', SYSTEM_LABELS[system], 'num', 1)}
                    {swingTh('bigLoves', '10+ scores', 'num')}
                    {swingTh('lowballs', 'Lowballs', 'num')}
                  </tr>
                </thead>
                <tbody>
                  {swings.map(({ row, gain }) => (
                    <tr key={`${row.song.year}-${row.song.id}`}>
                      <td
                        className="num"
                        style={{
                          color: gain === 0 ? undefined : gain > 0 ? 'var(--green)' : 'var(--vermillion)',
                          fontWeight: gain === 0 ? 400 : 700,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {gain === 0 ? (
                          <span className="note">—</span>
                        ) : (
                          `${gain > 0 ? '▲' : '▼'} ${isPooled ? Math.abs(gain) : pct(Math.abs(gain), 1)}`
                        )}
                      </td>
                      <td>
                        <SongCell s={row.song} withYear={tallySingle === null} sub={row.song.artist} />
                      </td>
                      <td className="num">
                        #{rankUnder(row, 'mean')} <span className="note">({fmt(row.scores.mean)})</span>
                      </td>
                      <td className="num">
                        #{rankUnder(row, system)}{' '}
                        <span className="note">
                          {/* Show the value the column is actually ordered on, so it
                              reads in order. Pooled Borda ranks on its per-field-
                              normalized share (100% = everyone's #1), not raw points;
                              Median carries its majority gauge, the tie-break that
                              decides otherwise-equal grades. */}
                          {system === 'borda' ? (
                            `(${isPooled ? pct(row.poolValue.borda, 0) : fmt(row.scores.borda, 0)})`
                          ) : system === 'median' ? (
                            <>
                              ({fmt(row.scores.median, 2)} · {row.mjGauge >= 0 ? '+' : '−'}
                              {pct(Math.abs(row.mjGauge), 0)})
                            </>
                          ) : (
                            `(${fmt(row.scores[system], 2)})`
                          )}
                        </span>
                      </td>
                      <td className="num">{row.bigLoves || ''}</td>
                      <td className="num">{row.lowballs || ''}</td>
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
