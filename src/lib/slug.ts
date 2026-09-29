// Kept apart from artistAvatar.ts, whose import.meta.glob only exists under
// Vite: the demo's photo fetcher (a plain tsx script) needs the same slugs.

/**
 * Filename form of an artist's name: accents folded, punctuation dropped
 * entirely rather than turned into separators, words joined by a dash.
 *
 * Dropping punctuation instead of replacing it is what makes "P!nk" and
 * "Destiny's Child" land on `pnk` and `destinys-child` — the way the
 * files are actually named.
 */
export function artistSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}
