import { useEffect, useRef, useState, type RefObject } from 'react'
import { kindnessPhrase, recapFileName, type RecapData } from '../lib/recap'
import { downloadSvgAsPng } from '../lib/exportPng'
import { fmt, plural } from '../lib/format'
import { displayName } from '../lib/names'
import { isDeadThumb, thumbFor, videoIds } from '../lib/youtube'
import { useIdentity } from './identity'
import { SITE_NAME } from '../lib/site'

export const CARD_W = 1080
export const CARD_H = 1350

// Off-screen canvas for laying the card out: SVG can't report the width of a
// string before it draws it, so anything that has to fit a box — the centred
// [avatar · name] group, the lists, the closing line — is measured here first.
let measureCanvas: HTMLCanvasElement | null = null
function measureText(text: string, font: string): number {
  if (typeof document === 'undefined') {
    // Rough fallback for a non-DOM render: half the point size per character is
    // close enough for a serif at these sizes, and much closer than assuming a
    // fixed width would be at a 62px title and a 22px caption both.
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 30)
    return text.length * size * 0.5
  }
  measureCanvas ??= document.createElement('canvas')
  const ctx = measureCanvas.getContext('2d')!
  ctx.font = font
  return ctx.measureText(text).width
}

/**
 * Truncate to what actually fits, not to a character count.
 *
 * A fixed character budget has to be set for the worst case — all caps and wide
 * glyphs — so every ordinary string gets cut long before it reaches the edge,
 * and a string of narrow letters still overruns. Measuring costs one canvas call
 * and is right in both directions.
 */
function fitText(s: string, font: string, maxWidth: number): string {
  if (measureText(s, font) <= maxWidth) return s
  let lo = 0
  let hi = s.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (measureText(s.slice(0, mid).trimEnd() + '…', font) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return s.slice(0, lo).trimEnd() + '…'
}

/**
 * Greedy word wrap to at most `maxLines`, the last line ellipsised if the text
 * still doesn't fit. Words longer than the box are left to overflow rather than
 * broken mid-word — at these widths that can't happen, and a hyphenless break
 * would read worse than the rare overrun it prevents.
 */
function wrapText(s: string, font: string, maxWidth: number, maxLines: number): string[] {
  const words = s.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (line && measureText(next, font) > maxWidth) {
      lines.push(line)
      line = w
      if (lines.length === maxLines) break
    } else {
      line = next
    }
  }
  if (lines.length < maxLines && line) lines.push(line)
  // Anything that didn't fit gets folded back onto the final line, which is then
  // cut to width — so the card never silently drops the end of a sentence
  // without the ellipsis that says it did.
  const used = lines.join(' ')
  if (lines.length && used !== s.replace(/\s+/g, ' ').trim()) {
    const rest = s.replace(/\s+/g, ' ').trim().slice(used.length - lines[lines.length - 1].length)
    lines[lines.length - 1] = fitText(rest, font, maxWidth)
  }
  // Final guard: a single word wider than the box never got a wrap opportunity,
  // and overflowing the card is the one outcome this whole path exists to
  // prevent. Cheap, and it makes "nothing overruns" true by construction.
  return lines.map((l) => fitText(l, font, maxWidth))
}

/**
 * Share card. Vector except for two optional images — the hero thumbnail and
 * the ranker's Discord avatar — each inlined as a data URL (never an external
 * reference) so the canvas export never taints.
 */
export function RecapCard({
  r,
  svgRef,
  thumb,
  avatar,
  maxWidth = 400,
}: {
  r: RecapData
  svgRef: RefObject<SVGSVGElement>
  thumb: string | null
  avatar: string | null
  maxWidth?: number
}) {
  const paper = '#f6f1e5'
  const ink = '#1e1b14'
  const ink2 = '#55503f'
  const verm = '#b23a1c'
  const navy = '#23456e'
  const rule = '#d9d2bd'
  const serif = "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif"
  const sans = "'Segoe UI',system-ui,sans-serif"
  const kind = kindnessPhrase(r)

  const topSongs = r.topSongs.slice(0, 5)
  const topArtists = r.topArtists.slice(0, 5)

  // hero thumbnail (their favorite song by their #1 artist) — the single inlined
  // image, kept 16:9 and centered; when absent the lists slide up
  const heroW = 620
  const heroH = 349
  const heroX = (CARD_W - heroW) / 2
  const heroY = 400
  const listTop = thumb ? heroY + heroH + 66 : 470

  // two-column "top songs" / "top artists" lists
  const colLeftX = 120
  const colRightX = 580
  const colW = 380
  const rowStep = 46
  const rowFont = `600 30px ${serif}`
  const column = (x: number, header: string, items: string[]) => (
    <g>
      <text x={x} y={listTop} fontFamily={sans} fontSize={22} fontWeight={700} letterSpacing={3} fill={verm}>
        {header}
      </text>
      <line x1={x} y1={listTop + 12} x2={x + colW} y2={listTop + 12} stroke={rule} strokeWidth={1} />
      {items.map((t, i) => (
        <text key={i} x={x} y={listTop + 52 + i * rowStep} fontFamily={serif} fontSize={30} fontWeight={600} fill={ink}>
          <tspan fill={ink2}>{i + 1} </tspan>
          {/* the rank prefix shares the line, so it comes out of the budget */}
          {fitText(t, rowFont, colW - measureText(`${i + 1} `, rowFont))}
        </text>
      ))}
    </g>
  )

  // two big stats at the foot, Wrapped-style
  const statY = 1150
  const stat = (x: number, label: string, value: string, detail?: string) => (
    <g>
      <text x={x} y={statY} fontFamily={sans} fontSize={20} fontWeight={700} letterSpacing={3} fill={ink2}>
        {label}
      </text>
      <text x={x} y={statY + 58} fontFamily={serif} fontSize={62} fontWeight={700} fill={ink}>
        {value}
      </text>
      {detail && (
        <text x={x} y={statY + 88} fontFamily={serif} fontSize={22} fontStyle="italic" fill={ink2}>
          {detail}
        </text>
      )}
    </g>
  )

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      style={{ width: '100%', maxWidth, border: '1px solid var(--rule)', display: 'block' }}
    >
      <rect width={CARD_W} height={CARD_H} fill={paper} />
      <rect x={40} y={40} width={CARD_W - 80} height={CARD_H - 80} fill="none" stroke={ink} strokeWidth={2} />
      <line x1={40} y1={52} x2={CARD_W - 40} y2={52} stroke={ink} strokeWidth={1} />

      <text x={CARD_W / 2} y={120} textAnchor="middle" fontFamily={sans} fontSize={26} fontWeight={700} letterSpacing={6} fill={ink2}>
        {SITE_NAME.toUpperCase()}
      </text>
      <text x={CARD_W / 2} y={235} textAnchor="middle" fontFamily={serif} fontSize={r.scope === 'all' ? 92 : 108} fontWeight={700} fill={ink}>
        {r.scope === 'all' ? 'All-Time Recap' : `${r.scope} Recap`}
      </text>
      {(() => {
        const nameFont = `italic 62px ${serif}`
        // Leave room for the avatar and the card's margins either side.
        const nameStr = fitText(displayName(r.name), nameFont, CARD_W - 240 - 88)
        const nameW = measureText(nameStr, nameFont)
        const avD = 66
        const gap = 22
        const groupW = avatar ? avD + gap + nameW : nameW
        const startX = (CARD_W - groupW) / 2
        const avCx = startX + avD / 2
        const avCy = 325 - 21 // center the circle on the visual middle of the name
        return (
          <>
            {avatar && (
              <>
                <defs>
                  <clipPath id="recap-avatar">
                    <circle cx={avCx} cy={avCy} r={avD / 2} />
                  </clipPath>
                </defs>
                <image
                  href={avatar}
                  x={avCx - avD / 2}
                  y={avCy - avD / 2}
                  width={avD}
                  height={avD}
                  clipPath="url(#recap-avatar)"
                  preserveAspectRatio="xMidYMid slice"
                />
                <circle cx={avCx} cy={avCy} r={avD / 2} fill="none" stroke={ink} strokeWidth={2} />
              </>
            )}
            <text
              x={avatar ? startX + avD + gap : CARD_W / 2}
              y={325}
              textAnchor={avatar ? 'start' : 'middle'}
              fontFamily={serif}
              fontSize={62}
              fontStyle="italic"
              fill={verm}
            >
              {nameStr}
            </text>
          </>
        )
      })()}
      <line x1={120} y1={365} x2={CARD_W - 120} y2={365} stroke={ink} strokeWidth={2} />

      {thumb && (
        <>
          <image href={thumb} x={heroX} y={heroY} width={heroW} height={heroH} preserveAspectRatio="xMidYMid slice" />
          <rect x={heroX} y={heroY} width={heroW} height={heroH} fill="none" stroke={ink} strokeWidth={2} />
          {r.cardSong && (
            <text x={CARD_W / 2} y={heroY + heroH + 34} textAnchor="middle" fontFamily={serif} fontSize={24} fontStyle="italic" fill={ink2}>
              {fitText(`“${r.cardSong.title}” — ${r.cardSong.artist}`, `italic 24px ${serif}`, 840)}
            </text>
          )}
        </>
      )}

      {column(colLeftX, 'TOP SONGS', topSongs.map((s) => s.title))}
      {column(colRightX, 'TOP ARTISTS', topArtists.map((a) => a.artist))}

      <line x1={120} y1={statY - 40} x2={CARD_W - 120} y2={statY - 40} stroke={rule} strokeWidth={1} />
      {stat(colLeftX, 'SONGS SCORED', String(r.songsScored), r.scope === 'all' ? `across ${plural(r.years.length, 'year')}` : `in ${r.scope}`)}
      {stat(colRightX, 'AVG GIVEN', fmt(r.avgGiven), `${kind.word} than ${kind.pct}% of the room`)}

      {/*
        * The closing sign-off, wrapped rather than cut. It used to be capped at
        * 64 characters, which quietly ate the end of any longer sentence — "…you
        * basically ARE the consen…". Two lines hold every sign-off the recap
        * builder can produce (the longest is 82 characters), so in practice
        * nothing is ever truncated now.
        *
        * The second line has to fit between the stat details above and the
        * card's inner border below, which is why two lines drop to 24px: at 26px
        * the ascenders of the first line touch the descenders of the stat
        * captions.
        */}
      {(() => {
        const twoLineFont = `italic 24px ${serif}`
        const oneLineFont = `italic 26px ${serif}`
        const fitsOnOne = measureText(r.closing, oneLineFont) <= 840
        const lines = fitsOnOne ? [r.closing] : wrapText(r.closing, twoLineFont, 840, 2)
        const size = fitsOnOne ? 26 : 24
        // Bottom-aligned: the last line always sits where the single line used to.
        const lastY = CARD_H - 70
        const step = 32
        return lines.map((line, i) => (
          <text
            key={i}
            x={CARD_W / 2}
            y={lastY - (lines.length - 1 - i) * step}
            textAnchor="middle"
            fontFamily={serif}
            fontSize={size}
            fontStyle="italic"
            fill={navy}
          >
            {line}
          </text>
        ))
      })()}
    </svg>
  )
}

/**
 * Whether a draw actually put pixels on the canvas. The thumbnails are opaque
 * JPEGs, so a successful draw leaves every sampled pixel at alpha 255; an empty
 * canvas is transparent everywhere. Samples a handful of points rather than the
 * whole bitmap — one opaque pixel is enough to know the draw landed.
 *
 * Throws on a tainted canvas, same as toDataURL, so callers keep it inside the
 * existing try.
 */
function drewPixels(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): boolean {
  const { width: w, height: h } = canvas
  if (!w || !h) return false
  const pts: [number, number][] = [
    [w >> 1, h >> 1],
    [w >> 2, h >> 2],
    [w - (w >> 2), h >> 2],
    [w >> 2, h - (h >> 2)],
    [w - (w >> 2), h - (h >> 2)],
  ]
  return pts.some(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] > 0)
}

/**
 * Inlines the card's two raster assets (hero thumbnail + Discord avatar) as data
 * URLs so the SVG stays exportable without tainting the canvas. Kept as a hook so
 * both the Recap page and the presentation finale share one implementation.
 */
export function useRecapCardAssets(r: RecapData): { thumb: string | null; avatar: string | null } {
  const { avatarFor } = useIdentity()

  // Favorite-artist thumbnail, inlined via canvas. Skipped silently on CORS/fetch failure.
  const [thumb, setThumb] = useState<string | null>(null)
  const favSong = r.cardSong
  useEffect(() => {
    setThumb(null)
    const ids = favSong ? videoIds(favSong) : []
    if (!ids.length) return
    let cancelled = false
    // walk the candidates: a removed video answers with a decodable grey
    // placeholder, which would otherwise get baked into the share card
    const attempt = (n: number) => {
      if (cancelled || n >= ids.length) return
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onerror = () => attempt(n + 1)
      img.onload = () => {
        if (cancelled) return
        if (isDeadThumb(img)) return attempt(n + 1)
        if (!img.naturalWidth || !img.naturalHeight) return attempt(n + 1)
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        try {
          // JPEG has no alpha, so a draw that silently produced nothing does not
          // fail — it encodes as a solid black rectangle and gets baked into the
          // card. Confirm pixels actually landed before trusting the canvas, and
          // fall through to the next candidate (or the vector-only card) if not.
          if (!drewPixels(ctx, canvas)) return attempt(n + 1)
          setThumb(canvas.toDataURL('image/jpeg', 0.85))
        } catch {
          /* tainted (no CORS) — leave the card vector-only */
        }
      }
      img.src = thumbFor(ids[n])
    }
    attempt(0)
    return () => {
      cancelled = true
    }
  }, [favSong])

  // The ranker's Discord avatar, inlined as a data URL for the same taint-free
  // reason. Same-origin, so it just needs re-encoding.
  const [avatar, setAvatar] = useState<string | null>(null)
  const avatarSrc = avatarFor(r.name)
  useEffect(() => {
    setAvatar(null)
    if (!avatarSrc) return
    let cancelled = false
    fetch(avatarSrc, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('avatar fetch failed'))))
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const fr = new FileReader()
            fr.onload = () => resolve(fr.result as string)
            fr.onerror = () => reject(fr.error)
            fr.readAsDataURL(blob)
          }),
      )
      .then((url) => {
        if (!cancelled) setAvatar(url)
      })
      .catch(() => {
        /* no avatar — the card centers the name on its own */
      })
    return () => {
      cancelled = true
    }
  }, [avatarSrc])

  return { thumb, avatar }
}

/**
 * Self-contained recap share card: inlines assets, renders the SVG, and (when
 * downloadable) offers the taint-free PNG export. Used by the Recap page and the
 * year presentation's finale.
 */
export function RecapShareCard({
  r,
  downloadable = false,
  maxWidth,
}: {
  r: RecapData
  downloadable?: boolean
  maxWidth?: number
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const { thumb, avatar } = useRecapCardAssets(r)
  return (
    <div className="recap-share">
      <RecapCard r={r} svgRef={svgRef} thumb={thumb} avatar={avatar} maxWidth={maxWidth} />
      {downloadable && (
        <button
          className="showmore"
          style={{ margin: '12px 0 0' }}
          onClick={() => svgRef.current && downloadSvgAsPng(svgRef.current, recapFileName(r), CARD_W, CARD_H)}
        >
          Download PNG ↓
        </button>
      )}
    </div>
  )
}
