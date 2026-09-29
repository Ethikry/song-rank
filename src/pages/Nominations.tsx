import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useScopedDataset } from '../components/identity'
import { fmt, pct, plural } from '../lib/format'
import { Name, ScopeNote, SongCell, SongTitle, useParamState, useSort, YearScopePills } from '../components/bits'
import { DotStrip, YearLegend, yearColor } from '../components/charts'
import { displayName } from '../lib/names'
import { SITE } from '../lib/site'
import {
  onlyYear,
  parseYearScope,
  scopeIncludes,
  scopeLabel,
  scopedDataset,
  yearScopeParam,
  type YearScope,
} from '../lib/yearScope'
import type { NominatorStats, Song } from '../lib/types'

type SortKey =
  | 'name'
  | 'count'
  | 'neutralAvgRank'
  | 'neutralAvgPercentile'
  | 'neutralTop10Count'
  | 'neutralBottom10Count'

/** Sentinel for the synthesized auto-included row; cannot collide with a real name. */
const AUTO_KEY = '__auto_top10__'

export default function Nominations() {
  // Follows the edition preference; see components/identity.tsx.
  const dataset = useScopedDataset()
  const { allTime, years } = dataset
  const yearNums = years.map((y) => y.year)
  const [minNoms, setMinNoms] = useState(2)
  const sort = useSort<SortKey>('neutralAvgPercentile', 1)

  // "Every pick" filters, kept in the URL so a filtered view is shareable
  const [axisYearParam, setAxisYearParam] = useParamState('picks', 'all')
  const axisScope = parseYearScope(axisYearParam, yearNums)
  const setAxisScope = (s: YearScope) => setAxisYearParam(yearScopeParam(s))
  const [axisMinParam, setAxisMinParam] = useParamState('picksmin', '3')
  const axisMin = Number(axisMinParam)
  const setAxisMin = (n: number) => setAxisMinParam(String(n))

  const axisRows = useMemo(() => {
    // A multi-year selection pools those years, so it takes the cumulative path
    // over a recomputed dataset — same shape as all-time.
    const single = onlyYear(axisScope)
    const pool = single === null
      ? scopedDataset(dataset, axisScope).allTime
      : dataset.perYear[single]
    // Field sizes always come from the real year, never the subset: a song's
    // finish is against the field it actually ran in.
    const fieldSizeOf = (song: Song) => dataset.perYear[song.year].songs.length

    // Auto-included songs are credited to nobody, so they never reach
    // computeNominators — synthesize their row rather than deriving it.
    // Nobody nominated these, so there is no ballot to strike: the auto row's
    // neutral figures are its published ones.
    const autoNoms = pool.songs
      .filter((s) => s.autoIncluded)
      .map((song) => ({
        song,
        fieldSize: fieldSizeOf(song),
        neutralRank: song.rank,
        includedRank: song.rank,
      }))
    const autoRow: NominatorStats | null = autoNoms.length
      ? {
          name: AUTO_KEY,
          noms: autoNoms,
          count: autoNoms.length,
          avgRank: autoNoms.reduce((a, x) => a + x.song.rank, 0) / autoNoms.length,
          avgPercentile: autoNoms.reduce((a, x) => a + x.song.rank / x.fieldSize, 0) / autoNoms.length,
          top10Count: autoNoms.filter((x) => x.song.rank <= 10).length,
          bottom10Count: autoNoms.filter((x) => x.song.rank > x.fieldSize - 10).length,
          neutralAvgRank: autoNoms.reduce((a, x) => a + x.song.rank, 0) / autoNoms.length,
          neutralAvgPercentile: autoNoms.reduce((a, x) => a + x.song.rank / x.fieldSize, 0) / autoNoms.length,
          neutralTop10Count: autoNoms.filter((x) => x.song.rank <= 10).length,
          neutralBottom10Count: autoNoms.filter((x) => x.song.rank > x.fieldSize - 10).length,
        }
      : null

    const nominators = Object.values(pool.nominators)
    if (single === null) {
      // The auto row competes on the same axis as everyone else, so it sorts
      // inline by average finish rather than sitting apart at the bottom.
      return [...nominators.filter((n) => n.count >= axisMin), ...(autoRow ? [autoRow] : [])].sort(
        (a, b) => a.neutralAvgPercentile - b.neutralAvgPercentile,
      )
    }

    // Within a single year, show every ranker who took part — people who scored but
    // nominated nothing, and (per the note below) nominators who never scored.
    const withPicks = [...nominators, ...(autoRow ? [autoRow] : [])].sort(
      (a, b) => a.neutralAvgPercentile - b.neutralAvgPercentile,
    )
    const named = new Set(withPicks.map((n) => n.name))
    const silent: NominatorStats[] = dataset.perYear[single].participants
      .filter((p) => !named.has(p))
      .sort((a, b) => displayName(a).localeCompare(displayName(b)))
      .map((name) => ({
        name,
        noms: [],
        count: 0,
        avgRank: 0,
        avgPercentile: 0,
        top10Count: 0,
        bottom10Count: 0,
        neutralAvgRank: 0,
        neutralAvgPercentile: 0,
        neutralTop10Count: 0,
        neutralBottom10Count: 0,
      }))
    return [...withPicks, ...silent]
  }, [dataset, allTime, axisYearParam, axisMin])

  const rows = useMemo(() => {
    const list = Object.values(allTime.nominators).filter((n) => n.count >= minNoms)
    const dir = sort.dir
    return list.sort((a, b) => {
      if (sort.key === 'name') return a.name.localeCompare(b.name) * dir
      return (a[sort.key] - b[sort.key]) * dir
    })
  }, [allTime.nominators, minNoms, sort.key, sort.dir])

  /*
   * Editions that allowed a song to be nominated twice.
   *
   * Some years disallowed duplicates outright, and there every song has exactly
   * one nominator — "nobody else picked it" is the rule of the year rather than
   * anything the nominator did, and those editions were supplying two thirds of
   * the honor roll below. A year is open if any song in it drew a second
   * nominator; that can only be true where duplicates were permitted, and no
   * edition that permitted them failed to produce one.
   */
  const openYears = useMemo(
    () => new Set(years.filter((y) => y.songs.some((s) => s.nominators.length > 1)).map((y) => y.year)),
    [years],
  )
  // Solo finds: songs one single person nominated (no co-signs, not auto-included)
  // that still cracked their year's top 10 — the crate-digger honor roll.
  const soloFinds = allTime.songs
    .filter((s) => openYears.has(s.year) && !s.autoIncluded && s.nominators.length === 1 && s.rank <= 10)
    .sort((a, b) => a.rank / dataset.perYear[a.year].songs.length - b.rank / dataset.perYear[b.year].songs.length)
  const closedYears = yearNums.filter((y) => !openYears.has(y))

  const th = (k: SortKey, label: string, cls = '', d: 1 | -1 = -1) => (
    <th className={`sortable ${cls}`} onClick={() => sort.toggle(k, d)}>
      {label}
      {sort.arrow(k)}
    </th>
  )

  return (
    <>
      <h1>Nominations</h1>
      <p className="subtitle">
        Who brings the bangers. Cross-year figures use share of the field - lower is better. 
      </p>
      <p className="note">
        <strong>Every finish here is scored without the nominator's own ballot</strong>, since nearly everyone rates
        their own pick above the room. The published finishes, own votes included, decide the{' '}
        <Link to="/awards">Nominator Dominator</Link> award.
      </p>

      <h2>Every pick, on one axis</h2>
      <p className="note">
        Each dot is one nomination, placed by its finish that year with the nominator's own scores struck out; the
        right column is that average, as a share of the field.
      </p>
      <div className="controls">
        <YearScopePills years={yearNums} scope={axisScope} onChange={setAxisScope} />
        <ScopeNote scope={axisScope} years={yearNums} />
        {onlyYear(axisScope) === null && (
          <>
            <label className="note">Min nominations:</label>
            <div className="seg">
              {[1, 3, 9].map((n) => (
                <button key={n} className={axisMin === n ? 'on' : ''} onClick={() => setAxisMin(n)}>
                  {n}+
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="scroll-x">
        <table className="data" style={{ minWidth: 480, maxWidth: 760 }}>
          <thead>
            <tr>
              <th>Nominator</th>
              <th>
                <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>← finished #1</span>
                  <span>dead last →</span>
                </span>
              </th>
              <th className="num">Avg finish</th>
            </tr>
          </thead>
          <tbody>
            {axisRows.map((n) => (
              <tr key={n.name}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {n.name === AUTO_KEY ? (
                    <>
                      Auto Top 10 <span className="pill">auto</span>
                    </>
                  ) : (
                    <Name n={n.name} avatar />
                  )}
                </td>
                <td style={{ width: '70%' }}>
                  <DotStrip
                    dots={n.noms.map(({ song, fieldSize, neutralRank, includedRank }) => ({
                      at: (neutralRank - 1) / Math.max(1, fieldSize - 1),
                      label:
                        `${song.title} (${song.year}) — #${fmt(neutralRank, 0)} of ${fieldSize} without their vote` +
                        (neutralRank === includedRank
                          ? ''
                          : ` (their own ballot ${
                              neutralRank > includedRank ? 'carried it' : 'held it back'
                            } ${fmt(Math.abs(neutralRank - includedRank), 1)} places)`),
                      color: yearColor(song.year, yearNums),
                    }))}
                  />
                </td>
                <td className="num note">{n.count ? pct(n.neutralAvgPercentile) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onlyYear(axisScope) === null && (
        <YearLegend years={yearNums.filter((y) => scopeIncludes(axisScope, y))} all={yearNums} />
      )}

      <h2>Solo finds</h2>
      <p className="note">
        Nobody else spotted these: songs a single person nominated — no co-signs, no auto-inclusion — that still cracked
        their year's top 10. The purest crate-digging on record.{' '}
        {closedYears.length > 0 && (
          <>
            {scopeLabel(closedYears)} {closedYears.length > 1 ? 'are' : 'is'} left out:{' '}
            {closedYears.length > 1 ? 'those editions' : 'that edition'} disallowed duplicate nominations, so every song
            in {closedYears.length > 1 ? 'them' : 'it'} was a solo find by rule rather than by nerve.
          </>
        )}
      </p>
      {soloFinds.length === 0 ? (
        <p className="note">Nothing to show: no edition here allowed a song to be nominated twice.</p>
      ) : (
        <div className="scroll-x">
          <table className="data" style={{ maxWidth: 760 }}>
            <tbody>
              {soloFinds.map((song) => (
                <tr key={`${song.year}-${song.id}`}>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    #{song.rank}
                    <span className="note">/{dataset.perYear[song.year].songs.length}</span>
                  </td>
                  <td>
                    <SongCell s={song} withYear sub={song.artist} />
                  </td>
                  <td>
                    found by <Name n={song.nominators[0]} avatar />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Nominator leaderboard</h2>
      <div className="controls">
        <label className="note">Min nominations:</label>
        <div className="seg">
          {[1, 2, 3, 5].map((n) => (
            <button key={n} className={minNoms === n ? 'on' : ''} onClick={() => setMinNoms(n)}>
              {n}+
            </button>
          ))}
        </div>
        <span className="note">{plural(rows.length, 'nominator')}</span>
      </div>
      <div className="scroll-x">
        <table className="data">
          <thead>
            <tr>
              {th('name', 'Nominator', '', 1)}
              {th('count', 'Noms', 'num')}
              {th('neutralAvgPercentile', 'Avg percentile', 'num', 1)}
              {th('neutralAvgRank', 'Avg rank', 'num', 1)}
              {th('neutralTop10Count', 'Top 10s', 'num')}
              {th('neutralBottom10Count', 'Bottom 10s', 'num')}
              <th className="num" title="Places their own ballot moved their picks, on average">
                Own vote
              </th>
              <th>Best pick</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const bestNom = [...n.noms].sort((a, b) => a.neutralRank / a.fieldSize - b.neutralRank / b.fieldSize)[0]
              // Positive = their picks finished higher with their own scores in.
              const lift = n.count
                ? n.noms.reduce((a, x) => a + (x.neutralRank - x.includedRank), 0) / n.count
                : 0
              return (
                <tr key={n.name}>
                  <td>
                    <Name n={n.name} avatar />
                  </td>
                  <td className="num">{n.count}</td>
                  <td className="num">{pct(n.neutralAvgPercentile)}</td>
                  <td className="num">{fmt(n.neutralAvgRank, 1)}</td>
                  <td className="num">{n.neutralTop10Count || ''}</td>
                  <td className="num">{n.neutralBottom10Count || ''}</td>
                  <td
                    className="num note"
                    title={`Their own scores were worth ${fmt(Math.abs(lift), 1)} places ${
                      lift >= 0 ? 'up' : 'down'
                    } per pick`}
                  >
                    {Math.abs(lift) < 0.05 ? '—' : `${lift > 0 ? '+' : '−'}${fmt(Math.abs(lift), 1)}`}
                  </td>
                  <td>
                    <SongTitle s={bestNom.song} withYear />{' '}
                    <span className="note">#{fmt(bestNom.neutralRank, 0)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="note">
        2025: every co-nominator is credited here, so a few averages differ from the master sheet. Nominators who never
        scored (
        {SITE.unscoredNominators
          .filter((n) => allTime.nominators[n])
          .map((n) => displayName(n))
          .join(', ')}
        ) still appear.
      </p>
    </>
  )
}
