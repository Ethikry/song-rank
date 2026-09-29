/**
 * Stand-in avatars, development only.
 *
 * Real avatars come from Discord and are captured at login, so a local dev
 * session has almost none of them — which makes every avatar-bearing layout
 * (the register, award boards, the recap card's name row) impossible to judge
 * without deploying. These fill that gap with a deterministic initial-and-colour
 * disc so the spacing, alignment and density are the ones production will show.
 *
 * `import.meta.env.DEV` is substituted at build time, so the whole thing —
 * including the SVG template — is dropped from the production bundle rather
 * than shipped behind a runtime flag. It can never appear on the real site.
 */
import { monogram } from './names'

/** Hashed hue, same trick as the chart category colours but self-contained: a data-URL SVG can't read a CSS variable. */
function hue(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360
  return h
}

const cache = new Map<string, string>()

/**
 * A data-URL avatar for a participant, or undefined outside dev.
 *
 * Data URL rather than a generated file or a blob: the recap share card inlines
 * the avatar through fetch → FileReader before exporting the PNG, and anything
 * cross-origin would taint the canvas and break the download. A data URL passes
 * that path unchanged, so the export is testable in dev too.
 */
export function devAvatar(key: string): string | undefined {
  if (!import.meta.env.DEV) return undefined
  const k = key.toLowerCase()
  const hit = cache.get(k)
  if (hit) return hit

  const h = hue(k)
  const text = monogram(k)
  // Sized 64 and scaled by the consumer; the card draws it at 66px.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<rect width="64" height="64" fill="hsl(${h} 45% 62%)"/>
<text x="32" y="33" font-family="Segoe UI,system-ui,sans-serif" font-size="${text.length > 1 ? 26 : 32}" font-weight="700" fill="hsl(${h} 55% 22%)" text-anchor="middle" dominant-baseline="central">${text}</text>
</svg>`
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  cache.set(k, url)
  return url
}
