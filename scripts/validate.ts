/**
 * Validation harness: recomputes every statistic from the Sorted Data tabs
 * and compares them against the values published in each year's
 * "Data Analysis" and "Taste Comparison" tabs.
 *
 * Run with: npm run validate
 */
import fs from 'node:fs'
import path from 'node:path'
import Papa from 'papaparse'
import {
  attachComments,
  parseComments,
  parsePublishedCommentRates,
  parseSortedData,
} from '../src/lib/parse'
import { computeDataset } from '../src/lib/stats'
import { nameKey, displayName } from '../src/lib/names'

// The public demo validates its anonymized copy the same way:
//   DATA_DIR=demo/data tsx --tsconfig tsconfig.demo.json scripts/validate.ts
// (the tsconfig points the @data imports inside src/lib at the same root).
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.resolve(import.meta.dirname, '../data'))

function readTab(year: string, tab: string): string | null {
  const dir = path.join(DATA_DIR, year)
  const file = fs.readdirSync(dir).find((f) => f.endsWith(`- ${tab}.csv`))
  return file ? fs.readFileSync(path.join(dir, file), 'utf8') : null
}

const yearDirs = fs
  .readdirSync(DATA_DIR)
  .filter((d) => /^\d{4}$/.test(d))
  .sort()

const years = yearDirs.map((y) => {
  const year = parseSortedData(Number(y), readTab(y, 'Sorted Data')!)
  const comments = readTab(y, 'Comments')
  if (comments) attachComments(year, parseComments(comments))
  return year
})
const dataset = computeDataset(years)

let failures = 0
let checks = 0

function check(label: string, ok: boolean, detail = '') {
  checks++
  if (!ok) {
    failures++
    console.log(`  FAIL ${label} ${detail}`)
  }
}

interface PublishedAnalysis {
  tasteRep: Map<string, number>
  clairvoyant: Map<string, number>
  reds: Map<string, number>
  greens: Map<string, number>
  nominator: Map<string, number>
}

function parseDataAnalysis(csv: string): PublishedAnalysis {
  const rows = Papa.parse<string[]>(csv.trim()).data as string[][]
  const out: PublishedAnalysis = {
    tasteRep: new Map(),
    clairvoyant: new Map(),
    reds: new Map(),
    greens: new Map(),
    nominator: new Map(),
  }
  const slots: [keyof PublishedAnalysis, number][] = [
    ['tasteRep', 1],
    ['clairvoyant', 4],
    ['reds', 7],
    ['greens', 10],
    ['nominator', 13],
  ]
  for (const row of rows) {
    for (const [slot, col] of slots) {
      const name = (row[col] ?? '').trim()
      const value = Number(row[col + 1])
      if (name && !/^(Taste|Most|Biggest|Nominator|Data)/.test(name) && Number.isFinite(value)) {
        out[slot].set(nameKey(name), value)
      }
    }
  }
  return out
}

for (const y of yearDirs) {
  const year = Number(y)
  const stats = dataset.perYear[year]
  console.log(`\n=== ${year} (${stats.songs.length} songs, ${stats.participants.length} participants) ===`)

  // 1. Recomputed song averages match the sheet's Average column
  let avgMismatch = 0
  for (const s of stats.songs) {
    if (Number.isFinite(s.sheetAverage) && Math.abs(s.average - s.sheetAverage) > 0.005) avgMismatch++
  }
  check(`song averages match sheet`, avgMismatch === 0, `(${avgMismatch} mismatches)`)

  const daCsv = readTab(y, 'Data Analysis')
  if (daCsv) {
    const pub = parseDataAnalysis(daCsv)

    for (const [name, val] of pub.tasteRep) {
      const ours = stats.participantStats[name]?.corrToAvg
      check(`tasteRep ${displayName(name)}`, ours !== undefined && Math.abs(ours - val) < 0.002, `ours=${ours?.toFixed(3)} sheet=${val}`)
    }
    for (const [name, val] of pub.clairvoyant) {
      const ours = stats.participantStats[name]?.totalAbsDiff
      check(`clairvoyant ${displayName(name)}`, ours !== undefined && Math.abs(ours - val) < 0.05, `ours=${ours?.toFixed(2)} sheet=${val}`)
    }
    for (const [name, val] of pub.reds) {
      const ours = stats.participantStats[name]?.reds
      check(`reds ${displayName(name)}`, ours === val, `ours=${ours} sheet=${val}`)
    }
    for (const [name, val] of pub.greens) {
      const ours = stats.participantStats[name]?.greens
      check(`greens ${displayName(name)}`, ours === val, `ours=${ours} sheet=${val}`)
    }
    // 2025's published Nominator Dominator excluded a handful of auto-carried
    // nominations (a block of one artist's low-ID songs) that the Sorted Data tab
    // still credits to nominators. We credit every listed nominator, so 2025
    // deltas are reported as warnings, not failures.
    for (const [name, val] of pub.nominator) {
      const ours = stats.nominators[name]?.avgRank
      const match = ours !== undefined && Math.abs(ours - val) < 0.15
      if (!match && year === 2025) {
        console.log(`  warn nominator ${displayName(name)} ours=${ours?.toFixed(1)} sheet=${val} (known variance)`)
      } else {
        check(`nominator ${displayName(name)}`, match, `ours=${ours?.toFixed(1)} sheet=${val}`)
      }
    }
  } else {
    console.log('  (no Data Analysis tab)')
  }

  const tcCsv = readTab(y, 'Taste Comparison')
  if (tcCsv) {
    const rows = Papa.parse<string[]>(tcCsv.trim()).data as string[][]
    const headerIdx = rows.findIndex((r) => (r[1] ?? '').trim() !== '' && (r[2] ?? '').trim() !== '')
    const header = rows[headerIdx].map((h) => nameKey(h))
    let tcChecks = 0
    let tcFails = 0
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r]
      const rowName = nameKey(row[0] ?? '')
      if (!rowName) continue
      for (let c = 1; c < header.length; c++) {
        const colName = header[c]
        if (colName === rowName) continue
        const val = Number(row[c])
        if (!Number.isFinite(val)) continue
        const entry = stats.pairwise.find(
          (p) => (p.a === rowName && p.b === colName) || (p.a === colName && p.b === rowName),
        )
        if (!entry) continue
        tcChecks++
        if (Math.abs(entry.corr - val) > 0.006) {
          tcFails++
          if (tcFails <= 5) console.log(`  FAIL pairwise ${displayName(rowName)}~${displayName(colName)} ours=${entry.corr.toFixed(2)} sheet=${val}`)
        }
      }
    }
    checks++
    if (tcFails > 0) failures++
    console.log(`  pairwise: ${tcChecks - tcFails}/${tcChecks} match`)
  }
}

// Branch map coverage: new years bring new artists — list any that fell
// through to the fallback so data/branches.json can be extended.
const { branchOf, unmappedArtists } = await import('../src/lib/branches')
for (const y of dataset.years) for (const s of y.songs) for (const a of s.artists) branchOf(a)
const missing = unmappedArtists()
if (missing.length) {
  console.log(`\nArtists missing from the branch map (add to branches.json): ${missing.join(', ')}`)
} else {
  console.log('\nBranch map covers every artist ✔')
}

// Year-subset isolation. computeAllTime assigns song.overallRank by mutating
// Song objects in place, and those objects are shared with the global dataset —
// so building a "my editions only" subset must not disturb all-time ranks for
// everyone else. This is invisible in the UI until someone notices a song's
// all-time rank changed, so assert it here.
{
  const { subsetOf } = await import('../src/lib/subset')
  const snapshot = dataset.allTime.songs.map((s) => `${s.year}:${s.id}:${s.overallRank}`)

  const someYears = dataset.years.slice(-1).map((y) => y.year)
  const sub = subsetOf(dataset, someYears)

  const drifted = dataset.allTime.songs.filter(
    (s, i) => `${s.year}:${s.id}:${s.overallRank}` !== snapshot[i],
  )
  check('subset leaves global overallRank untouched', drifted.length === 0, `${drifted.length} songs drifted`)

  // The subset must still be internally coherent: ranks 1..n over its own songs.
  const ranks = sub.allTime.songs.map((s) => s.overallRank).sort((a, b) => a - b)
  check(
    'subset ranks are 1..n internally',
    ranks.length > 0 && ranks[0] === 1 && ranks[ranks.length - 1] === ranks.length,
  )
  check('subset contains only the requested years', sub.years.every((y) => someYears.includes(y.year)))
  check('all-years subset returns the base dataset', subsetOf(dataset, dataset.years.map((y) => y.year)) === dataset)
  console.log(`\nSubset isolation: ${drifted.length === 0 ? 'clean ✔' : `${drifted.length} songs MUTATED`}`)
}

// The year selection behind every pill box. It rides on subsetOf, so the
// isolation guarantees above carry over; what needs asserting here is that a
// selection pools exactly the years chosen — for every single year, and for
// every "all but one" combination, which is how an exclusion is now expressed.
//
// The failure that motivates this: subsetOf reads an EMPTY year list as
// "everything", and the empty selection legitimately means all-time. A
// selection that accidentally computed to nothing would therefore show the
// whole dataset rather than a filtered one, with no visible symptom.
{
  const { parseYearScope, scopeYears, scopedDataset, toggleYear, yearScopeParam, onlyYear } =
    await import('../src/lib/yearScope')
  const allYears = dataset.years.map((y) => y.year)
  const snapshot = dataset.allTime.songs.map((s) => `${s.year}:${s.id}:${s.overallRank}`)

  // Selections are recomputes, so assert against the real pooled data.
  const checkSelection = (label: string, picked: number[]) => {
    const scope = parseYearScope(picked.join(','), allYears)
    check(`${label} parses to exactly the picked years`, scope.join(',') === [...picked].sort().join(','))
    check(`${label} round-trips through the URL`,
      parseYearScope(yearScopeParam(scope), allYears).join(',') === scope.join(','))

    const kept = scopeYears(scope, allYears)
    check(`${label} covers only picked years`, kept.join(',') === [...picked].sort().join(','))
    check(`${label} is never empty`, kept.length > 0)

    const sub = scopedDataset(dataset, scope)
    check(`${label} subset holds only those years`, sub.years.every((y) => picked.includes(y.year)))
    check(`${label} subset holds all of them`, sub.years.length === picked.length)

    const expected = dataset.allTime.songs.filter((s) => picked.includes(s.year)).length
    check(`${label} pools exactly those songs`, sub.allTime.songs.length === expected,
      `${sub.allTime.songs.length} vs ${expected}`)

    // The global ranking must be a fresh 1..n over the pooled songs — this is
    // what "the displayed ranking reflects the selection" actually means.
    const ranks = sub.allTime.songs.map((s) => s.overallRank).sort((a, b) => a - b)
    check(`${label} reranks 1..n over the pool`,
      ranks.length === expected && ranks[0] === 1 && ranks[ranks.length - 1] === expected)

    // Every ranker present keeps exactly their picked years, no more.
    for (const [name, st] of Object.entries(sub.allTime.participantStats)) {
      const full = dataset.allTime.participantStats[name]
      if (!full) { check(`${label} invents no rankers`, false, name); continue }
      check(`${label} ${name} keeps their picked years`,
        st.years.join(',') === full.years.filter((y) => picked.includes(y)).join(','))
    }
  }

  for (const y of allYears) checkSelection(`[${y}]`, [y])
  // "All but one" — the exclusion case, now just a multi-year selection.
  for (const dropped of allYears) {
    checkSelection(`all but ${dropped}`, allYears.filter((y) => y !== dropped))
  }
  // A couple of arbitrary multi-year pools, including a non-adjacent pair.
  if (allYears.length >= 2) checkSelection('first two', allYears.slice(0, 2))
  if (allYears.length >= 3) checkSelection('ends only', [allYears[0], allYears[allYears.length - 1]])

  // Toggling: adding accumulates rather than replacing, and removing the last
  // selected year returns to all-time rather than an empty (= broken) filter.
  {
    const [a, b] = allYears
    let scope = toggleYear([], a)
    check('first click selects one year', scope.join(',') === String(a))
    check('one year reads as a single-year view', onlyYear(scope) === a)
    scope = toggleYear(scope, b)
    check('second click ADDS rather than replaces', scope.join(',') === [a, b].sort().join(','))
    check('two years is no longer a single-year view', onlyYear(scope) === null)
    scope = toggleYear(scope, a)
    check('clicking a selected year removes it', scope.join(',') === String(b))
    scope = toggleYear(scope, b)
    check('removing the last year returns to all-time', scope.length === 0)
  }

  // Selecting every year is the same pool as all-time, and must hand back the
  // base dataset rather than a needless recompute.
  check('selecting every year is all-time',
    scopedDataset(dataset, parseYearScope(allYears.join(','), allYears)) === dataset)
  check('unknown years are dropped', parseYearScope('1999,2050', allYears).length === 0)
  check('partly-valid selection keeps the valid part',
    parseYearScope(`1999,${allYears[0]}`, allYears).join(',') === String(allYears[0]))

  const drifted2 = dataset.allTime.songs.filter(
    (s, i) => `${s.year}:${s.id}:${s.overallRank}` !== snapshot[i],
  )
  check('year selection leaves global overallRank untouched', drifted2.length === 0, `${drifted2.length} drifted`)
  console.log(`Year selection: checked ${allYears.length} single + ${allYears.length} all-but-one pools ${drifted2.length === 0 ? '✔' : 'MUTATED'}`)
}

// The Comments tab publishes its own answer key: an "Individual Comment Rate"
// row under the songs. Checking our parse against it means the comment data is
// verified the same way every score-derived statistic already is.
for (const y of yearDirs) {
  const csv = readTab(y, 'Comments')
  if (!csv) continue
  const published = parsePublishedCommentRates(csv)
  if (!published.size) continue
  const stats = dataset.perYear[Number(y)].participantStats
  console.log(`\n${y} Comments`)
  let commented = 0
  for (const [name, rate] of published) {
    const computed = stats[name]?.commentRate
    if (computed === undefined) {
      check(`${y} ${displayName(name)} is a known ranker`, false)
      continue
    }
    commented += stats[name].commentCount
    // The sheet rounds to whole percents, so allow half a point of slack.
    check(
      `${y} comment rate ${displayName(name)}`,
      Math.abs(computed - rate) <= 0.005,
      `computed ${(computed * 100).toFixed(1)}% vs published ${(rate * 100).toFixed(0)}%`,
    )
  }
  console.log(`  ${published.size} rankers, ${commented} comments cross-checked`)
}

// The alternative tallies have no published counterpart to check against — the
// sheets only ever computed a mean — so they're held to their own invariants
// instead. The Borda one is the point of the exercise: tie handling is the only
// subtle part of that tally, and a bug there produces a plausible-looking
// ranking that is really just CSV order leaking through.
{
  const { altRankings, trimmedMean, SYSTEMS } = await import('../src/lib/consensus')
  const { mean } = await import('../src/lib/stats')
  console.log('\nAlternative tallies')

  for (const y of dataset.years) {
    const rows = altRankings(y.songs)
    check(`${y.year} tallies every song`, rows.length === y.songs.length)

    for (const sys of SYSTEMS) {
      const ranks = rows.map((r) => r.ranks[sys]).sort((a, b) => a - b)
      // Ties share a rank, so this is a valid competition ranking rather than a
      // strict permutation: rank 1 always exists and nothing exceeds the field.
      check(`${y.year} ${sys} starts at #1`, ranks[0] === 1)
      check(`${y.year} ${sys} stays inside the field`, ranks[ranks.length - 1] <= y.songs.length)
      check(
        `${y.year} ${sys} skips exactly as many ranks as it ties`,
        ranks.every((r, i) => r <= i + 1),
      )
    }

    // The raw-mean column is the published finish by construction, so what's
    // worth checking is that the published board really is an ordering by mean —
    // *up to ties*. It can't be checked more strictly than that: tied averages
    // are everywhere (36 songs in 2022, 47 in 2023) and the sheets break them
    // inconsistently, 2022 seating both at #3 where 2023 hands out #5 and #6.
    let inverted = 0
    for (const a of rows) {
      for (const b of rows) {
        if (a.scores.mean - b.scores.mean > 1e-9 && a.song.rank > b.song.rank) inverted++
      }
    }
    check(`${y.year} the published board is an ordering by mean`, inverted === 0, `(${inverted} inversions)`)

    // Trimming nothing is the plain mean — proves the trim path isn't shifting
    // the result on its own before the real 10% trim is applied.
    const untrimmed = y.songs.filter((s) => {
      const xs = Object.values(s.scores)
      return Math.abs(trimmedMean(xs, 0) - mean(xs)) > 1e-9
    })
    check(`${y.year} a 0% trim is the raw mean`, untrimmed.length === 0)

    // Borda reads only each ranker's ordering, so rescaling one person's scores
    // monotonically must leave the tally byte-identical. Tied blocks are what
    // this catches: order them by position rather than by average rank and the
    // transform reshuffles the ties, changing the result.
    const victim = y.participants[0]
    const rescaled = y.songs.map((s) => ({
      ...s,
      scores: { ...s.scores, [victim]: s.scores[victim] * 2 + 1 },
    }))
    const before = rows.map((r) => `${r.song.id}:${r.ranks.borda}`).join(',')
    const after = altRankings(rescaled).map((r) => `${r.song.id}:${r.ranks.borda}`).join(',')
    check(`${y.year} Borda ignores ${displayName(victim)}'s personal scale`, before === after)

    // Order of the input must not reach the output either.
    const shuffled = altRankings([...y.songs].reverse())
    const byId = new Map(shuffled.map((r) => [r.song.id, r]))
    const orderDependent = rows.filter((r) => SYSTEMS.some((s) => byId.get(r.song.id)!.ranks[s] !== r.ranks[s]))
    check(`${y.year} tallies don't depend on row order`, orderDependent.length === 0,
      `(${orderDependent.length} songs moved)`)
  }
  console.log(`  ${dataset.years.length} editions × ${SYSTEMS.length} systems`)
}

// Shared artists claim to be a decomposition of the pair's correlation, which is
// a strong claim and the whole reason the feature is trustworthy: the per-song
// terms must add back up to the exact r shown beside them, or the percentages
// are decoration.
{
  const { sharedArtistsIn } = await import('../src/lib/affinity')
  const { mean, pearson } = await import('../src/lib/stats')
  console.log('\nTaste decomposition')

  const pairs = [...dataset.allTime.pairwise].sort((a, b) => b.corr - a.corr).slice(0, 12)
  for (const p of pairs) {
    const both = dataset.allTime.songs.filter(
      (s) => s.scores[p.a] !== undefined && s.scores[p.b] !== undefined,
    )
    const baseA = mean(both.map((s) => s.scores[p.a]))
    const baseB = mean(both.map((s) => s.scores[p.b]))
    let ssA = 0
    let ssB = 0
    let num = 0
    for (const s of both) {
      const da = s.scores[p.a] - baseA
      const db = s.scores[p.b] - baseB
      ssA += da * da
      ssB += db * db
      num += da * db
    }
    const r = num / Math.sqrt(ssA * ssB)
    check(
      `${displayName(p.a)}×${displayName(p.b)} decomposition base matches the published r`,
      Math.abs(r - p.corr) < 1e-9,
      `ours=${r.toFixed(6)} pairwise=${p.corr.toFixed(6)}`,
    )

    // Every song's term, summed over songs rather than artists, is r itself.
    let total = 0
    for (const s of both) {
      total += ((s.scores[p.a] - baseA) * (s.scores[p.b] - baseB)) / Math.sqrt(ssA * ssB)
    }
    check(
      `${displayName(p.a)}×${displayName(p.b)} per-song shares sum to r`,
      Math.abs(total - r) < 1e-9,
      `sum=${total.toFixed(6)} r=${r.toFixed(6)}`,
    )

    // No artist may claim more of the correlation than exists, and the reported
    // direction has to match the deviations it was derived from.
    const shared = sharedArtistsIn(dataset.allTime.songs, p.a, p.b, { limit: 50 })
    check(
      `${displayName(p.a)}×${displayName(p.b)} shares are positive and bounded`,
      shared.every((s) => s.share > 0 && s.share <= Math.abs(r) + 1e-9),
    )
    check(
      `${displayName(p.a)}×${displayName(p.b)} direction agrees with both deviations`,
      shared.every((s) =>
        s.direction === 'up' ? s.devA > 0 && s.devB > 0 : s.devA < 0 && s.devB < 0,
      ),
    )
    // Order of the songs must not change the answer.
    const rev = sharedArtistsIn([...dataset.allTime.songs].reverse(), p.a, p.b, { limit: 50 })
    check(
      `${displayName(p.a)}×${displayName(p.b)} decomposition ignores row order`,
      shared.map((s) => s.artist).join(',') === rev.map((s) => s.artist).join(','),
    )
    // Symmetric: correlation has no direction, so neither does its breakdown.
    const swapped = sharedArtistsIn(dataset.allTime.songs, p.b, p.a, { limit: 50 })
    check(
      `${displayName(p.a)}×${displayName(p.b)} decomposition is symmetric`,
      shared.map((s) => `${s.artist}:${s.share.toFixed(9)}`).join(',') ===
        swapped.map((s) => `${s.artist}:${s.share.toFixed(9)}`).join(','),
    )
  }
  // `fraction` is what the UI prints as a percentage, and it is not the same
  // number as `share`: 0.33 of a 0.55 correlation is 60% of it, not 33%. An
  // early version printed the wrong one.
  for (const p of pairs.slice(0, 4)) {
    for (const s of sharedArtistsIn(dataset.allTime.songs, p.a, p.b, { limit: 20 })) {
      check(
        `${displayName(p.a)}×${displayName(p.b)} ${s.artist} fraction is share ÷ r`,
        Math.abs(s.fraction - s.share / p.corr) < 1e-9,
      )
    }
  }

  // The disagree half: a nemesis pairing's splits must be genuinely opposed and
  // genuinely negative, or the "what they fell out over" list is decoration.
  const foes = [...dataset.allTime.pairwise].sort((a, b) => a.corr - b.corr).slice(0, 8)
  for (const p of foes) {
    const split = sharedArtistsIn(dataset.allTime.songs, p.a, p.b, { want: 'disagree', limit: 20 })
    check(
      `${displayName(p.a)}×${displayName(p.b)} splits are opposed on both sides`,
      split.every((s) => s.direction === 'split' && s.devA > 0 !== s.devB > 0),
    )
    check(
      `${displayName(p.a)}×${displayName(p.b)} splits pull the correlation down`,
      split.every((s) => s.share < 0),
    )
    // Agreement and disagreement must not both claim the same artist.
    const agree = new Set(
      sharedArtistsIn(dataset.allTime.songs, p.a, p.b, { limit: 50 }).map((s) => s.artist),
    )
    check(
      `${displayName(p.a)}×${displayName(p.b)} no artist is both common ground and battleground`,
      split.every((s) => !agree.has(s.artist)),
    )
  }

  // The artist web is the same decomposition with the axes swapped: two artists
  // over the rankers who scored both. Same invariants must hold.
  const { artistWeb } = await import('../src/lib/artistWeb')
  const { artistPairDrivers } = await import('../src/lib/affinity')
  const web = artistWeb(dataset)
  const artistPairs = [...web.pairs].sort((a, b) => b.corr - a.corr).slice(0, 8)
  for (const p of artistPairs) {
    const drivers = artistPairDrivers(web.vectors.get(p.a)!, web.vectors.get(p.b)!, { limit: 100 })
    check(
      `${p.a}×${p.b} drivers are real rankers`,
      drivers.every((d) => dataset.allTime.participantStats[d.participant] !== undefined),
    )
    check(
      `${p.a}×${p.b} driver shares stay inside the pairing`,
      drivers.every((d) => d.share > 0 && d.share <= Math.abs(p.corr) + 1e-9),
    )
    check(
      `${p.a}×${p.b} driver fractions are share ÷ r`,
      drivers.every((d) => Math.abs(d.fraction - d.share / p.corr) < 1e-9),
    )
    const swapped = artistPairDrivers(web.vectors.get(p.b)!, web.vectors.get(p.a)!, { limit: 100 })
    check(
      `${p.a}×${p.b} driver decomposition is symmetric`,
      drivers.map((d) => `${d.participant}:${d.share.toFixed(9)}`).join(',') ===
        swapped.map((d) => `${d.participant}:${d.share.toFixed(9)}`).join(','),
    )
  }
  console.log(
    `  ${pairs.length} taste pairs, ${foes.length} nemeses, ${artistPairs.length} artist pairs decomposed`,
  )
  void pearson
}

// The drift chart reads `spread` off yearMeans, a value nothing rendered until
// now — so it has never been checked against anything.
{
  const { yearMeans } = await import('../src/lib/stats')
  for (const m of yearMeans(dataset)) {
    const songs = dataset.perYear[m.year].songs
    const expectMean = songs.reduce((a, s) => a + s.average, 0) / songs.length
    const expectSpread = songs.reduce((a, s) => a + s.stddev, 0) / songs.length
    check(`${m.year} yearMeans mean`, Math.abs(m.mean - expectMean) < 1e-9)
    check(`${m.year} yearMeans spread`, Math.abs(m.spread - expectSpread) < 1e-9)
    check(`${m.year} spread is a real σ`, m.spread > 0 && m.spread < 5, `got ${m.spread.toFixed(3)}`)
  }
}

// Comment analytics: keyness is scored against the whole year, so a tier drawn
// from that year can never contain a word the corpus doesn't, and the extremity
// buckets must partition every score cast exactly once.
{
  const { commentKeyness, commentRateByExtremity, tokenCounts } = await import('../src/lib/wordcloud')
  for (const y of dataset.years) {
    if (!y.hasComments) continue
    const byScore = [...y.songs].sort((a, b) => b.average - a.average)
    const cut = Math.ceil(byScore.length / 3)
    const corpusWords = tokenCounts(y.songs)
    for (const [label, tier] of [['top', byScore.slice(0, cut)], ['bottom', byScore.slice(-cut)]] as const) {
      const key = commentKeyness(tier, y.songs)
      check(`${y.year} ${label}-third keyness stays inside the year's vocabulary`,
        key.every((k) => corpusWords.has(k.word)))
      check(`${y.year} ${label}-third keyness is over-representation only`,
        key.every((k) => (k.weight ?? 0) > 0))
      check(`${y.year} ${label}-third keyness counts don't exceed the corpus`,
        key.every((k) => k.count <= corpusWords.get(k.word)!))
    }

    const buckets = commentRateByExtremity(y.songs)
    const cast = y.songs.reduce((a, s) => a + Object.keys(s.scores).length, 0)
    const noted = y.songs.reduce((a, s) => a + Object.keys(s.comments ?? {}).length, 0)
    check(`${y.year} extremity buckets cover every score exactly once`,
      buckets.reduce((a, b) => a + b.scores, 0) === cast)
    check(`${y.year} extremity buckets account for every note`,
      buckets.reduce((a, b) => a + b.comments, 0) === noted)
    check(`${y.year} extremity rates are rates`, buckets.every((b) => b.rate >= 0 && b.rate <= 1))
    console.log(`  ${y.year} comment analytics: ${cast} scores, ${noted} notes, ${buckets.length} bands`)
  }
}

// The auth service matches Discord accounts to rankers by name, so it needs the
// roster. Emit it from the real parser here rather than teaching the server to
// read CSVs — this way a new year updates it as a side effect of the validation
// that deploy.sh already runs, and any drift shows up as a git diff.
{
  const rosterPath = path.join(DATA_DIR, 'roster.json')
  const roster = [...dataset.allTime.participants].sort()
  const next = `${JSON.stringify(roster, null, 2)}\n`
  const prev = fs.existsSync(rosterPath) ? fs.readFileSync(rosterPath, 'utf8') : ''
  if (prev !== next) {
    fs.writeFileSync(rosterPath, next)
    console.log(`\nRewrote ${path.relative(process.cwd(), rosterPath)} (${roster.length} participants)`)
  } else {
    console.log(`\n${path.relative(process.cwd(), rosterPath)} up to date (${roster.length} participants)`)
  }
}

console.log(`\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILURES` : ' ✔'}`)
process.exit(failures ? 1 : 0)
