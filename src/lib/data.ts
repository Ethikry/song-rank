import { attachComments, parseComments, parseSortedData } from './parse'
import { computeDataset } from './stats'
import type { Dataset } from './types'

/**
 * Every CSV under data/<year>/ is bundled at build time (via the @data alias,
 * which the public demo build points at demo/data/). Adding a new year is
 * just dropping the exported "<...> - Sorted Data.csv" into data/<year>/ —
 * it is auto-discovered here, no code changes needed.
 */
const files = import.meta.glob('@data/*/*.csv', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function loadDataset(): Dataset {
  const byYear = new Map<number, string>()
  const commentsByYear = new Map<number, string>()
  for (const [path, raw] of Object.entries(files)) {
    const sorted = path.match(/\/(\d{4})\/.*- Sorted Data\.csv$/)
    if (sorted) byYear.set(Number(sorted[1]), raw)
    // Optional: only some years' master sheets have a Comments tab.
    const comments = path.match(/\/(\d{4})\/.*- Comments\.csv$/)
    if (comments) commentsByYear.set(Number(comments[1]), raw)
  }
  const years = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, csv]) => {
      const parsed = parseSortedData(year, csv)
      const comments = commentsByYear.get(year)
      if (comments) attachComments(parsed, parseComments(comments))
      return parsed
    })
  return computeDataset(years)
}

export const dataset = loadDataset()
