import site from '@data/site.json'

/**
 * What this site is about, read from the data root rather than written into
 * components — the same code builds the real party rank and the anonymized
 * public demo (`--mode demo`, see demo/README.md), and the demo's bundle must
 * not carry a single real name. Anything that names the event, its people or
 * its subject belongs in `@data/site.json`, not in a string literal here.
 */
interface SiteConfig {
  /** The browser tab title (substituted into index.html by vite.config.ts). */
  documentTitle: string
  /** Masthead, split where the second half takes the accent colour. */
  brand: [string, string]
  /** "<subject>, ranked annually by …" */
  subject: string
  /** "4 years of <rankingsOf>, …" */
  rankingsOf: string
  /** Credited in the tagline; omitted when null. */
  organizer: string | null
  inauguralYear: number
  /** Per-year YouTube compilation of the results, where one exists. */
  compilations: Record<string, string>
  /** Namespaces localStorage keys: several projects can share one origin. */
  storagePrefix: string
  /** Title of the "liked their own nomination least" footnote. */
  remorseAward: string
  /** Participant keys named in the Nominations page's "nominators who never scored" note. */
  unscoredNominators: string[]
  /** What an artist's grouping is called — agency branches, or music genres. */
  group: { singular: string; plural: string; qualified: string }
  /** Demo only: the ranker a first-time visitor views the site as. */
  demoPersona?: string
}

export const SITE = site as unknown as SiteConfig

/** The masthead as one string: "The Song Rank" */
export const SITE_NAME = SITE.brand.join(' ')

/**
 * The public demo build. It has no auth service behind it, so identity is a
 * persona the visitor picks instead of a Discord login.
 */
export const IS_DEMO = import.meta.env?.MODE === 'demo'

/**
 * The first year the party rank actually ran. Earlier editions on the site were
 * ranked retroactively, so this is deliberately NOT `dataset.years[0].year` —
 * backfilling an older year must not change what "est." says.
 */
export const INAUGURAL_YEAR = SITE.inauguralYear

export const COMPILATION_URLS: Record<number, string> = SITE.compilations

/** A localStorage key namespaced to this site. */
export const storageKey = (name: string) => `${SITE.storagePrefix}-${name}`

/** Capitalize the first letter — for grouping nouns used as headings. */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
