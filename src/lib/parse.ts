import Papa from 'papaparse'
import { nameKey } from './names'
import type { Song, YearData } from './types'
import aliases from '@data/aliases.json'

/** Header names that are NOT participant score columns, lowercased. */
const FIXED_COLUMNS = new Set([
  'rank',
  'song id',
  'nominator',
  // The Comments tab writes this one plural where Sorted Data writes it singular
  'nominators',
  'song',
  'artist',
  'music',
  'video',
  'youtube music link',
  'youtube video link',
  'average',
  'avg',
  'total',
  '',
])

/** Known alternate credits (lowercased) folded to one canonical artist — see @data/aliases.json. */
const ARTIST_ALIASES: Record<string, string> = aliases.artists

/** lowercase → first-seen display casing, so "IDOL project/Project/PROJECT" unify */
const artistDisplay = new Map<string, string>()

function canonicalArtist(raw: string): string {
  const aliased = ARTIST_ALIASES[raw.toLowerCase()] ?? raw
  const key = aliased.toLowerCase()
  const existing = artistDisplay.get(key)
  if (existing) return existing
  artistDisplay.set(key, aliased)
  return aliased
}

/**
 * Split a collab artist credit into individual canonical artists.
 * Parenthesized member lists ("Some Unit (Member A, Member B)") are
 * dropped before splitting — the group gets the credit.
 */
export function splitArtists(artist: string): string[] {
  return [
    ...new Set(
      artist
        .replace(/\s*\([^)]*\)?/g, '')
        .split(/\s*&\s*|\s*,\s*|\s+x\s+|\s+×\s+/i)
        .map((a) => a.trim())
        .filter(Boolean)
        .map(canonicalArtist),
    ),
  ]
}

function parseNominators(raw: string): { nominators: string[]; autoIncluded: boolean } {
  const trimmed = raw.trim()
  if (!trimmed || /^top\s*10$/i.test(trimmed)) {
    return { nominators: [], autoIncluded: true }
  }
  return {
    nominators: trimmed.split(',').map((n) => nameKey(n)).filter(Boolean),
    autoIncluded: false,
  }
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}

/**
 * Parse a "Sorted Data" tab into a YearData. Header-based so column order
 * differences between years don't matter; stops at the first row without a
 * numeric rank + song id (trailing stat blocks in some exports).
 */
export function parseSortedData(year: number, csv: string): YearData {
  const { data } = Papa.parse<string[]>(csv.trim(), { skipEmptyLines: false })
  const rows = data as string[][]
  const header = rows[0].map((h) => h.trim())

  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name)
  const rankCol = col('rank')
  const idCol = col('song id')
  const nomCol = col('nominator')
  const songCol = col('song')
  const artistCol = col('artist')
  const musicCol = header.findIndex((h) => /^(music|youtube music link)$/i.test(h))
  const videoCol = header.findIndex((h) => /^(video|youtube video link)$/i.test(h))
  const avgCol = header.findIndex((h) => /^(average|avg)$/i.test(h))

  const participantCols: { name: string; index: number }[] = []
  header.forEach((h, i) => {
    if (!FIXED_COLUMNS.has(h.toLowerCase())) {
      participantCols.push({ name: nameKey(h), index: i })
    }
  })

  const songs: Song[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.length < 3) break
    const rank = Number(row[rankCol])
    const id = (row[idCol] ?? '').trim()
    if (!id || !Number.isFinite(rank)) break

    const scores: Record<string, number> = {}
    for (const { name, index } of participantCols) {
      const cell = (row[index] ?? '').trim()
      if (cell === '') continue
      const v = Number(cell)
      if (Number.isFinite(v)) scores[name] = v
    }
    const values = Object.values(scores)
    const artist = (row[artistCol] ?? '').trim()
    const { nominators, autoIncluded } = parseNominators(row[nomCol] ?? '')
    // Some exports lose the hyperlink and keep only display text — accept real URLs only
    const asUrl = (cell: string | undefined) => {
      const v = (cell ?? '').trim()
      return /^https?:\/\//i.test(v) ? v : ''
    }
    songs.push({
      year,
      id,
      rank,
      nominators,
      autoIncluded,
      title: (row[songCol] ?? '').trim(),
      artist,
      artists: splitArtists(artist),
      musicUrl: asUrl(row[musicCol]),
      videoUrl: asUrl(row[videoCol]),
      scores,
      average: mean(values),
      sheetAverage: Number(row[avgCol]) || NaN,
      stddev: stddev(values),
      overallRank: 0, // assigned once all years are loaded (computeAllTime)
    })
  }

  return { year, participants: participantCols.map((p) => p.name), songs }
}

/**
 * Parse a "Comments" tab into song id -> participant -> comment. Same
 * header-based approach as the Sorted Data tab, and the two tabs share both
 * their `Song ID` values and their participant column names, so the result
 * joins straight onto the parsed songs.
 *
 * Rows without a song id are skipped rather than treated as a terminator: the
 * tab ends with a published stats block ("Individual Comment Rate" / "Total
 * Comment Rate") whose cells sit in the participant columns.
 */
export function parseComments(csv: string): Map<string, Record<string, string>> {
  const { data } = Papa.parse<string[]>(csv.trim(), { skipEmptyLines: false })
  const rows = data as string[][]
  const header = rows[0].map((h) => h.trim())
  const idCol = header.findIndex((h) => h.toLowerCase() === 'song id')

  const participantCols: { name: string; index: number }[] = []
  header.forEach((h, i) => {
    if (!FIXED_COLUMNS.has(h.toLowerCase())) participantCols.push({ name: nameKey(h), index: i })
  })

  const byId = new Map<string, Record<string, string>>()
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const id = (row?.[idCol] ?? '').trim()
    if (!id) continue

    const comments: Record<string, string> = {}
    for (const { name, index } of participantCols) {
      const text = (row[index] ?? '').trim()
      if (text) comments[name] = text
    }
    if (Object.keys(comments).length) byId.set(id, comments)
  }
  return byId
}

/**
 * Hang parsed comments off the songs of a year, in place. Kept separate from
 * `parseSortedData` because the Comments tab is optional — only some years'
 * master sheets have one, and a year without it is simply left with no
 * `comments` on any song.
 */
export function attachComments(year: YearData, byId: Map<string, Record<string, string>>): void {
  for (const song of year.songs) {
    const comments = byId.get(song.id)
    if (comments) song.comments = comments
  }
  // Flagged on the year, not inferred from the songs: a year can have a
  // Comments tab in which some individual song still drew no comment at all.
  year.hasComments = byId.size > 0
}

/**
 * The comment rates the Comments tab publishes for itself, as a fraction.
 * Only used to check our own parse in scripts/validate.ts.
 */
export function parsePublishedCommentRates(csv: string): Map<string, number> {
  const { data } = Papa.parse<string[]>(csv.trim(), { skipEmptyLines: false })
  const rows = data as string[][]
  const header = rows[0].map((h) => h.trim())

  const participantCols: { name: string; index: number }[] = []
  header.forEach((h, i) => {
    if (!FIXED_COLUMNS.has(h.toLowerCase())) participantCols.push({ name: nameKey(h), index: i })
  })

  const out = new Map<string, number>()
  const label = rows.find((r) => r?.some((c) => /individual comment rate/i.test(c ?? '')))
  if (!label) return out
  for (const { name, index } of participantCols) {
    const pct = Number((label[index] ?? '').replace('%', '').trim())
    if (Number.isFinite(pct)) out.set(name, pct / 100)
  }
  return out
}
