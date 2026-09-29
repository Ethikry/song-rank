import aliases from '@data/aliases.json'
import { artistSlug } from './slug'

export { artistSlug }

/**
 * Artist portraits.
 *
 * `@data/artist_avatars/<slug>.webp`, bundled at build time the same way the
 * year CSVs are (`src/lib/data.ts`) — dropping a new file in that folder is all
 * it takes for that artist to gain a picture, no code change.
 *
 * Coverage is deliberately partial: 62 of the 103 canonical artists have a
 * portrait, and the other 41 are units, generations and guest musicians that
 * have no single face to show. Every call site therefore has to survive a miss, which is why
 * this returns `undefined` rather than a placeholder — a generic silhouette
 * beside a group credit is worse than no image at all.
 */

const files = import.meta.glob('@data/artist_avatars/*.webp', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * Credits whose slug doesn't reach their file — spelling, not identity. Listed
 * in @data/aliases.json with the data they correct.
 */
const ALIASES: Record<string, string> = aliases.portraits

const bySlug = new Map<string, string>()
for (const [path, url] of Object.entries(files)) {
  const slug = path.match(/([^/]+)\.webp$/)?.[1]
  if (slug) bySlug.set(slug, url)
}

export interface PhotoCredit {
  artist: string
  /** File title on Wikimedia Commons. */
  title: string
  author: string
  license: string
  licenseUrl?: string
  /** The file's Commons page. */
  source: string
}

// Only the public demo has photo credits: its portraits are Wikimedia Commons
// photos (see demo/scripts/fetchArtistPhotos.ts), while the real site's are
// official art. A glob rather than an import, so the file may be absent.
const creditFiles = import.meta.glob('@data/artist_avatars/credits.json', {
  import: 'default',
  eager: true,
}) as Record<string, PhotoCredit[]>

export const PHOTO_CREDITS: PhotoCredit[] = Object.values(creditFiles)[0] ?? []

/** The Commons credit for an artist's portrait, when it needs one. */
export function photoCredit(name: string): PhotoCredit | undefined {
  return PHOTO_CREDITS.find((c) => c.artist === name)
}

/** The portrait URL for an artist credit, or undefined when there isn't one. */
export function artistAvatar(name: string): string | undefined {
  const slug = artistSlug(name)
  return bySlug.get(slug) ?? bySlug.get(ALIASES[slug] ?? '')
}
