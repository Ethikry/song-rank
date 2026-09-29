import type { Song } from './types'

/** Extract a YouTube video id from watch/short/music URLs; null if unparseable. */
export function videoId(url: string): string | null {
  if (!url) return null
  const m =
    url.match(/youtu\.be\/([\w-]{6,})/) ??
    url.match(/[?&]v=([\w-]{6,})/) ??
    url.match(/youtube\.com\/shorts\/([\w-]{6,})/)
  return m ? m[1] : null
}

/**
 * Every id a song could be represented by, best first — the video link, then the
 * music link. Deduped, since the sheets often repeat one URL in both columns.
 *
 * Several entries point at videos that have since been taken down; when the first
 * id is dead the second usually still resolves, so callers should walk this list
 * rather than committing to `[0]`.
 */
export function videoIds(s: Song): string[] {
  const ids = [videoId(s.videoUrl), videoId(s.musicUrl)].filter((x): x is string => !!x)
  return [...new Set(ids)]
}

export function thumbFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
}

/** Thumbnail for a song's video; null if no id parses. May still be dead — see isDeadThumb. */
export function thumbUrl(s: Song): string | null {
  const id = videoIds(s)[0]
  return id ? thumbFor(id) : null
}

/**
 * True when a loaded thumbnail is really YouTube's "no thumbnail" placeholder.
 *
 * A dead id answers with HTTP 404 whose body is nonetheless a *valid* 120x90 grey
 * JPEG, so the browser decodes it and fires `load`, not `error` — the status code
 * is invisible to us and onError never runs. The decoded size is the only reliable
 * signal: a real mqdefault is always 320x180.
 */
export function isDeadThumb(img: HTMLImageElement): boolean {
  return img.naturalWidth === 120 && img.naturalHeight === 90
}
