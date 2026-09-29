import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { dataset } from '../lib/data'
import { fmt, plural } from '../lib/format'
import { displayName } from '../lib/names'
import { Name, useSort } from '../components/bits'
import { Scatter } from '../components/charts'
import { BRANCH_LABELS, PARTISAN_BRANCHES, branchAffinity, type BranchAffinity } from '../lib/branches'
import { SITE, cap } from '../lib/site'

type PartisanEntry = { p: string; aff: BranchAffinity }

/** One branch: its biggest enjoyers and toughest critics, side by side, expandable. */
function PartisanCard({ title, board }: { title: string; board: PartisanEntry[] }) {
  const [open, setOpen] = useState(false)
  // Split at the baseline, not at the midpoint of the board: everyone above their
  // own average lands in enjoyers, everyone below in critics. The two sides are
  // deliberately unequal, and nobody is dropped.
  const allEnjoyers = board.filter((e) => e.aff.delta >= 0)
  const allCritics = board.filter((e) => e.aff.delta < 0).reverse() // harshest first
  const enjoyers = open ? allEnjoyers : allEnjoyers.slice(0, 5)
  const critics = open ? allCritics : allCritics.slice(0, 5)
  const hidden = Math.max(allEnjoyers.length, allCritics.length) > 5
  const row = ({ p, aff }: PartisanEntry) => (
    <div className="p-row" key={p}>
      <span>
        <Name n={p} />
        {/* a delta off 5-9 songs is noisy — say so inline rather than only in the tip */}
        {aff.n < 10 && <span className="note"> n={aff.n}</span>}
      </span>
      <span
        className="delta"
        style={{ color: aff.delta >= 0 ? 'var(--green)' : 'var(--vermillion)' }}
        data-tip={`${fmt(aff.avg)} average over ${plural(aff.n, 'song')}`}
      >
        {aff.delta >= 0 ? '+' : ''}
        {fmt(aff.delta)}
      </span>
    </div>
  )
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div className="partisan-cols">
        <div>
          <div className="col-h">💘 Enjoyers</div>
          {enjoyers.map(row)}
        </div>
        <div>
          <div className="col-h">🥶 Critics</div>
          {critics.map(row)}
        </div>
      </div>
      {hidden && (
        <button className="showmore" onClick={() => setOpen((o) => !o)}>
          {open ? 'Show fewer ▴' : `Show all ${allEnjoyers.length} / ${allCritics.length} ▾`}
        </button>
      )}
    </div>
  )
}

type SortKey = 'name' | 'years' | 'songsScored' | 'avgGiven' | 'reds' | 'greens' | 'corrToAvg'

export default function Participants() {
  const { allTime, years } = dataset
  const navigate = useNavigate()
  const sort = useSort<SortKey>('years')

  const rows = useMemo(() => {
    const list = Object.values(allTime.participantStats)
    const dir = sort.dir
    return [...list].sort((a, b) => {
      if (sort.key === 'name') return a.name.localeCompare(b.name) * dir
      if (sort.key === 'years') return (a.years.length - b.years.length) * dir || a.name.localeCompare(b.name)
      return (a[sort.key] - b[sort.key]) * dir
    })
  }, [allTime.participantStats, sort.key, sort.dir])

  const th = (k: SortKey, label: string, cls = '') => (
    <th className={`sortable ${cls}`} onClick={() => sort.toggle(k)}>
      {label}
      {sort.arrow(k)}
    </th>
  )

  return (
    <>
      <h1>Participants</h1>
      <p className="subtitle">Everyone who has ever ranked.</p>

      <h2>The personality map</h2>
      <p className="note">
        <strong>Average score given</strong> (right = higher) against <strong>correlation with the final results</strong>{' '}
        (top = higher). Dashed lines mark the medians.
      </p>
      {(() => {
        const ps = Object.values(allTime.participantStats)
        const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
        return (
          <Scatter
            points={ps.map((p) => ({
              x: p.avgGiven,
              y: p.corrToAvg,
              label: `${displayName(p.name)} — avg given ${fmt(p.avgGiven)}, consensus corr ${fmt(p.corrToAvg, 2)} (${p.songsScored} songs)`,
              text: displayName(p.name),
              onClick: () => navigate(`/participant/${encodeURIComponent(p.name)}`),
            }))}
            xLabel="tough grader → easy grader"
            yLabel="own beat → agrees with results"
            height={430}
            width={640}
            r={3.5}
            refX={median(ps.map((p) => p.avgGiven))}
            refY={median(ps.map((p) => p.corrToAvg))}
          />
        )
      })()}

      <h2>{cap(SITE.group.singular)} partisans</h2>
      <p className="note">
        Who scores a {SITE.group.singular} furthest from their own baseline, in both directions. Rankers with fewer than
        10 songs in a {SITE.group.singular} are marked — small samples swing hard.
      </p>
      <div className="card-grid">
        {PARTISAN_BRANCHES.map((branch) => {
          const board = allTime.participants
            .flatMap((p) => {
              const aff = branchAffinity(dataset, p, 5).find((b) => b.branch === branch)
              return aff ? [{ p, aff }] : []
            })
            .sort((x, y) => y.aff.delta - x.aff.delta)
          return <PartisanCard key={branch} title={BRANCH_LABELS[branch]} board={board} />
        })}
      </div>

      <h2>The register</h2>
      <div className="scroll-x">
        <table className="data">
          <thead>
            <tr>
              {th('name', 'Participant')}
              {th('years', 'Years attended')}
              {th('songsScored', 'Songs scored', 'num')}
              {th('avgGiven', 'Avg given', 'num')}
              {th('corrToAvg', 'Consensus corr', 'num')}
              {th('reds', 'Reds', 'num')}
              {th('greens', 'Greens', 'num')}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.name}>
                <td>
                  <Name n={p.name} avatar />
                </td>
                <td>
                  {years.map((y) => (
                    <span
                      key={y.year}
                      className="pill"
                      style={p.years.includes(y.year) ? { borderColor: 'var(--navy)', color: 'var(--ink)' } : { opacity: 0.35 }}
                    >
                      {y.year}
                    </span>
                  ))}
                </td>
                <td className="num">{p.songsScored}</td>
                <td className="num">{fmt(p.avgGiven)}</td>
                <td className="num">{fmt(p.corrToAvg, 3)}</td>
                <td className="num">{p.reds}</td>
                <td className="num">{p.greens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
