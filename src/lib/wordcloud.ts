import type { Song } from './types'

/**
 * Function words only. Vocabulary that describes the music — "song", "lyrics",
 * "banger", "catchy", "peak" — is deliberately kept: those ARE what the room
 * talked about, and stripping them to make the cloud look more surprising would
 * misrepresent it.
 */
const STOPWORDS = new Set([
  'the', 'this', 'that', "that's", 'these', 'those', 'and', 'but', 'not', 'for', 'its', "it's", 'was', 'are',
  'were', 'have', 'has', 'had', 'you', 'your', 'she', 'her', 'his', 'him', 'they', 'them', 'their', 'with',
  'from', 'when', 'what', 'why', 'how', 'who', 'all', 'any', 'can', 'could', 'would', 'should', 'will',
  'just', 'too', 'very', 'more', 'most', 'much', 'many', 'some', 'than', 'then', 'there', 'here', 'been',
  'being', 'because', 'about', 'into', 'over', 'only', 'also', 'even', 'ever', 'never', 'still', 'get',
  'got', 'one', 'two', 'out', 'off', 'own', 'per', 'via', 'yet', 'now', 'not', "don't", "doesn't", "didn't",
  "can't", "won't", "isn't", "wasn't", "i'm", "i've", "i'd", "i'll", "you're", "it'd", 'shes', 'hes',
  'was', 'does', 'did', 'doing', 'done', 'let', 'lot', 'bit', 'way', 'thing', 'things',
  // People type contractions both ways; the apostrophe-less spellings are the
  // ones that otherwise surface in the cloud looking like typos.
  'dont', 'doesnt', 'didnt', 'cant', 'wont', 'isnt', 'wasnt', 'arent', 'werent', 'hasnt', 'havent',
  'wouldnt', 'couldnt', 'shouldnt', 'thats', 'theres', 'whats', 'youre', 'theyre', 'ive', 'ill', 'youve',
])

export interface WordCount {
  word: string
  count: number
  /**
   * Optional sizing signal that isn't the raw count — keyness, say. When present
   * the cloud scales on this instead, so one component serves both a "what got
   * said" cloud and a "what got said *here*" one.
   */
  weight?: number
}

/** Token counts with no folding applied. */
function rawCounts(songs: Song[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const s of songs) {
    for (const text of Object.values(s.comments ?? {})) {
      for (const raw of text.toLowerCase().match(/[a-z][a-z']*/g) ?? []) {
        const w = raw.replace(/^'+|'+$/g, '')
        if (w.length < 3 || STOPWORDS.has(w)) continue
        counts.set(w, (counts.get(w) ?? 0) + 1)
      }
    }
  }
  return counts
}

/**
 * Fold plurals into the singular, but only where the singular is actually a word
 * the room used — so "song"/"songs" merge while "lyrics" is left alone rather
 * than becoming a "lyric" nobody wrote.
 *
 * `vocabulary` decides which singulars count as attested, and defaults to the
 * counts being folded. It has to be overridable: when a slice of the notes is
 * compared against the whole corpus, both sides must fold *identically*, and a
 * slice that happens to contain "songs" but not "song" would otherwise keep a
 * key the corpus had already folded away — leaving the comparison matching two
 * different words against each other.
 */
function foldPlurals(counts: Map<string, number>, vocabulary = counts): Map<string, number> {
  const out = new Map(counts)
  for (const [w, n] of [...out]) {
    if (!w.endsWith('s')) continue
    const singular = w.slice(0, -1)
    if (vocabulary.has(singular)) {
      out.set(singular, (out.get(singular) ?? 0) + n)
      out.delete(w)
    }
  }
  return out
}

/** Folded token counts over every note left on a set of songs. */
export function tokenCounts(songs: Song[]): Map<string, number> {
  return foldPlurals(rawCounts(songs))
}

/** Word frequencies across every note left on a set of songs. */
export function commentWordCounts(songs: Song[], { minCount = 2, limit = 60 } = {}): WordCount[] {
  return [...tokenCounts(songs).entries()]
    .filter(([, n]) => n >= minCount)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit)
}

/**
 * What a slice of the notes says that the notes as a whole don't.
 *
 * A plain frequency count of the top-scoring songs' notes mostly returns the
 * same words as a count of all of them — "song", "love", "this" are common
 * everywhere, and the cloud ends up describing the vocabulary rather than the
 * tier. Keyness asks the sharper question: which words are *over*-represented
 * here relative to the whole corpus.
 *
 * The measure is the log-odds ratio with an informative Dirichlet prior (Monroe,
 * Colaresi & Quinn 2008), z-scored. The prior is the full corpus itself, which
 * is what makes it behave on a corpus this small: a word appearing twice in a
 * tier and twice overall gets pulled hard toward zero instead of topping the
 * chart, the way a raw ratio would have it.
 *
 * `corpus` must be the *whole* set the subset was drawn from, subset included —
 * not the complement.
 */
export function commentKeyness(
  subset: Song[],
  corpus: Song[],
  { minCount = 3, limit = 45, alpha = 12 } = {},
): WordCount[] {
  // Both sides fold against the corpus's vocabulary, so every key means the same
  // word on both — see foldPlurals.
  const corpusRaw = rawCounts(corpus)
  const sub = foldPlurals(rawCounts(subset), corpusRaw)
  const all = foldPlurals(corpusRaw, corpusRaw)
  const nSub = [...sub.values()].reduce((a, b) => a + b, 0)
  const nAll = [...all.values()].reduce((a, b) => a + b, 0)
  const nRest = nAll - nSub
  if (!nSub || !nRest) return []

  const out: WordCount[] = []
  for (const [word, inSub] of sub) {
    const total = all.get(word) ?? inSub
    if (total < minCount) continue
    const inRest = total - inSub
    // Prior pseudocount for this word, scaled to its corpus-wide frequency.
    const prior = alpha * (total / nAll)
    const lo = Math.log((inSub + prior) / (nSub + alpha - inSub - prior)) -
      Math.log((inRest + prior) / (nRest + alpha - inRest - prior))
    const variance = 1 / (inSub + prior) + 1 / (inRest + prior)
    const z = lo / Math.sqrt(variance)
    if (z <= 0) continue // under-represented words belong to the other tier's cloud
    out.push({ word, count: inSub, weight: z })
  }
  return out
    .sort((a, b) => b.weight! - a.weight! || a.word.localeCompare(b.word))
    .slice(0, limit)
}

export interface Quote {
  who: string
  text: string
  song: Song
  score: number
  /** their score minus the song's final average */
  dev: number
}

/**
 * The spiciest notes: biggest breaks from consensus, and nothing else.
 *
 * Deliberately un-deduplicated — one ranker repeating the same terse verdict on
 * an artist's whole catalog ("drake :(") sweeping the list is the joke,
 * not a bug to be filtered out.
 */
export function hardestNotes(songs: Song[], limit = 5): Quote[] {
  const quotes = songs.flatMap((s) =>
    Object.entries(s.comments ?? {}).flatMap(([who, text]) => {
      const score = s.scores[who]
      return Number.isFinite(score) ? [{ who, text, song: s, score, dev: score - s.average }] : []
    }),
  )
  return quotes.sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev)).slice(0, limit)
}

export interface ExtremityBucket {
  /** Inclusive lower bound of |score − song average| for this bucket. */
  from: number
  /** Exclusive upper bound, or Infinity for the open top bucket. */
  to: number
  label: string
  /** Scores cast that landed in this bucket. */
  scores: number
  /** How many of them came with a note. */
  comments: number
  rate: number
}

const EXTREMITY_BANDS: [number, number, string][] = [
  [0, 0.5, 'with the room (< 0.5)'],
  [0.5, 1, '0.5 – 1.0 off'],
  [1, 1.5, '1.0 – 1.5 off'],
  [1.5, 2.5, '1.5 – 2.5 off'],
  [2.5, Infinity, 'way off (2.5+)'],
]

/**
 * Do people write when they feel strongly, or when they feel differently?
 *
 * Buckets every score cast on a commented song by how far it sat from that
 * song's final average, and reports how often each bucket came with a note. Only
 * songs from years that collected comments are counted — a year with no Comments
 * tab would otherwise read as a room that never had anything to say.
 */
export function commentRateByExtremity(songs: Song[]): ExtremityBucket[] {
  const buckets = EXTREMITY_BANDS.map(([from, to, label]) => ({
    from,
    to,
    label,
    scores: 0,
    comments: 0,
    rate: 0,
  }))
  for (const s of songs) {
    if (!s.comments) continue
    for (const [who, v] of Object.entries(s.scores)) {
      const dev = Math.abs(v - s.average)
      const b = buckets.find((x) => dev >= x.from && dev < x.to)
      if (!b) continue
      b.scores++
      if (s.comments[who]) b.comments++
    }
  }
  for (const b of buckets) b.rate = b.scores ? b.comments / b.scores : 0
  return buckets.filter((b) => b.scores > 0)
}

/**
 * Scatter the words so the big ones don't all cluster at the front, without
 * randomness — a cloud that reshuffles on every render is unreadable and its
 * screenshots never match. Hashing the word gives a fixed, arbitrary-looking
 * order that is identical on every visit.
 */
export function scatter<T extends { word: string }>(words: T[]): T[] {
  return [...words].sort((a, b) => hash(a.word) - hash(b.word))
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003
  return h
}
