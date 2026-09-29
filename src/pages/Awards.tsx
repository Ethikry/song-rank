import { useState } from 'react'
import { useScopedDataset } from '../components/identity'
import {
  AWARDS,
  COMMENTARY,
  allTimeBoard,
  allTimeCommentaryBoard,
  commentaryBoard,
  crownHistory,
  hasAnyComments,
  yearBoard,
} from '../lib/awards'
import type { AwardKey } from '../lib/types'
import { fmt } from '../lib/format'
import { HBar, Name, ScopeNote, ShowMore, useParamState, YearScopePills } from '../components/bits'
import { displayName } from '../lib/names'
import {
  onlyYear,
  parseYearScope,
  scopeIncludes,
  scopeLabel,
  scopedDataset,
  yearScopeParam,
  type YearScope,
} from '../lib/yearScope'

export default function Awards() {
  // Follows the edition preference; see components/identity.tsx.
  const dataset = useScopedDataset()
  const { years } = dataset
  const [awardParam, setAwardParam] = useParamState('award', 'tasteRep')
  const awardKey = (AWARDS.some((a) => a.key === awardParam) ? awardParam : 'tasteRep') as AwardKey
  const setAwardKey = (k: AwardKey) => setAwardParam(k)
  const [scopeParam, setScopeParam] = useParamState('scope', 'all')
  const yearNums = years.map((y) => y.year)
  const scope = parseYearScope(scopeParam, yearNums)
  const setScope = (s: YearScope) => setScopeParam(yearScopeParam(s))
  const award = AWARDS.find((a) => a.key === awardKey)!

  // Any selection that pools more than one year is a cumulative board over just
  // those years, so it reuses the all-time path over a recomputed dataset. Only
  // a single-year pick gets that year's own board.
  const scoped = scopedDataset(dataset, scope)
  const single = onlyYear(scope)
  const board = single === null
    ? allTimeBoard(scoped, awardKey)
    : yearBoard(dataset.perYear[single], awardKey)
  const clean = board.filter((e) => Number.isFinite(e.value))
  const maxVal = Math.max(...clean.map((e) => Math.abs(e.value)), 0)
  const digits = awardKey === 'tasteRep' ? 3 : awardKey === 'hater' || awardKey === 'lover' ? 0 : awardKey === 'nominator' && single === null ? 2 : 1

  // Crowns are a per-year record, so a selection filters which years' rows show
  // rather than recomputing anything: who won 2023 doesn't change because the
  // rest of the page is pooling a different set of years.
  const crowns = crownHistory(dataset)
    .filter((c) => c.award.key === awardKey)
    .filter((c) => scopeIncludes(scope, c.year))

  // Shown only where notes were actually collected — see COMMENTARY in awards.ts
  // for why these are boards rather than a sixth crown.
  const showCommentary = single === null
    ? hasAnyComments(scoped)
    : (dataset.perYear[single]?.hasComments ?? false)
  const commentYears = scoped.years.filter((y) => y.hasComments).map((y) => y.year)

  return (
    <>
      <h1>Awards</h1>
      <p className="subtitle">The five official awards — per year and cumulative all-time.</p>

      <div className="controls">
        <div className="seg">
          {AWARDS.map((a) => (
            <button key={a.key} className={awardKey === a.key ? 'on' : ''} onClick={() => setAwardKey(a.key)}>
              {a.emoji} {a.title}
            </button>
          ))}
        </div>
        <YearScopePills years={yearNums} scope={scope} onChange={setScope} allLabel="All-time" />
        <ScopeNote scope={scope} years={yearNums} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <strong>
          {award.emoji} {award.title}
        </strong>{' '}
        <span className="note">{award.description}</span>
        <div className="note">
          Metric: {single === null ? award.allTimeMetric : award.metric}
          {single === null && awardKey === 'nominator' && ' (0 = every nom finished #1; min 2 noms)'}
          {scope.length > 0 && ` · computed over ${scopeLabel(scope, yearNums)}`}
        </div>
        {single !== null && (
          <div className="note">
            👑 {crowns.find((c) => c.year === single)?.winners.map((w) => displayName(w)).join(', ') ?? '—'}
          </div>
        )}
        {single === null && crowns.length > 0 && (
          <div className="note">
            Crown history: {crowns.map((c) => `${c.year}: ${c.winners.map((w) => displayName(w)).join(' & ')}`).join(' · ')}
          </div>
        )}
      </div>

      <ShowMore items={clean} initial={12} noun="rankers">
        {(shown) => (
          <div className="bars">
            {shown.map((e, i) => (
              <HBar
                key={e.name}
                label={
                  <>
                    {i === 0 && '👑 '}
                    <Name n={e.name} />
                  </>
                }
                value={award.betterIs === 'low' ? maxVal - e.value + maxVal * 0.05 : Math.max(0, e.value)}
                max={maxVal * 1.05}
                display={`${fmt(e.value, digits)}${e.detail ? ` · ${e.detail}` : ''}`}
                color={i === 0 ? 'var(--vermillion)' : undefined}
              />
            ))}
          </div>
        )}
      </ShowMore>
      {showCommentary && (
        <>
          <h2 style={{ marginTop: 30 }}>The commentary</h2>
          <p className="note">
            Not official awards — only {commentYears.join(', ')} collected written notes.
          </p>
          <div className="card-grid">
            {COMMENTARY.map((def) => {
              const b = single === null
                ? allTimeCommentaryBoard(scoped, def.key)
                : commentaryBoard(dataset.perYear[single], def.key)
              if (!b.length) return null
              return (
                <div className="card" key={def.key}>
                  <strong>
                    {def.emoji} {def.title}
                  </strong>
                  <div className="note" style={{ marginBottom: 6 }}>
                    {def.description}
                  </div>
                  <table className="data">
                    <tbody>
                      {b.slice(0, 5).map((e, i) => (
                        <tr key={e.name}>
                          <td>
                            {i === 0 && '🏅 '}
                            <Name n={e.name} />
                          </td>
                          <td className="num">
                            {def.key === 'prolific'
                              ? `${fmt(e.value, 0)}%`
                              : `${fmt(e.value, 0)} chars`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        </>
      )}
      {single === 2025 && awardKey === 'nominator' && (
        <p className="note">
          Numbers credit every co-nominator, so a few differ from the 2025 master sheet.
        </p>
      )}
    </>
  )
}
