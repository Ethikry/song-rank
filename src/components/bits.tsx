import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { displayName } from '../lib/names'
import { Avatar, useIdentity } from './identity'
import { fmt, medal, plural, scoreColor } from '../lib/format'
import { isDeadThumb, thumbFor, videoIds } from '../lib/youtube'
import { artistAvatar } from '../lib/artistAvatar'
import type { Song } from '../lib/types'
import { scoreBins } from '../lib/stats'
import { useMarkHover } from './charts'
import { scatter, type WordCount } from '../lib/wordcloud'
import { ALL_YEARS, isAllYears, scopeLabel, toggleYear, type YearScope } from '../lib/yearScope'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/**
 * Avatars are opt-in rather than automatic: `Name` also renders inside dense
 * score tables and ScoreBreakdown, where an image per row would wreck the
 * layout. Turn it on only where there's room.
 */
/**
 * A ranker's name, linked to their profile.
 *
 * `chip` draws it as a bordered token. Wherever names sit loose in a table cell
 * or a run of prose they read as stray words — the eye can't tell where one
 * ends and the next begins — and a box gives each one an edge.
 */
export function Name({ n, avatar = false, chip = false }: { n: string; avatar?: boolean; chip?: boolean }) {
  // The viewer's own name gets a quiet highlight everywhere it appears, so they
  // can find themselves in dense tables at a glance.
  const { isMe } = useIdentity()
  const link = (
    <Link className={isMe(n) ? 'name-me' : undefined} to={`/participant/${encodeURIComponent(n)}`}>
      {displayName(n)}
    </Link>
  )
  if (!avatar && !chip) return link
  return (
    <span className={`name-with-avatar${chip ? ' name-chip' : ''}`}>
      {avatar && <Avatar participant={n} size={20} />}
      {link}
    </span>
  )
}

/**
 * An artist's portrait, or nothing when we don't have one — most units and
 * guest musicians don't (see lib/artistAvatar.ts), so this never renders a
 * placeholder and call sites never need their own conditional.
 */
export function ArtistAvatar({ a, size = 24 }: { a: string; size?: number }) {
  const src = artistAvatar(a)
  if (!src) return null
  return (
    <img
      className="avatar artist-avatar"
      src={src}
      // Intrinsic size prevents a one-frame jump while the image decodes.
      width={size}
      height={size}
      alt=""
      loading="lazy"
      decoding="async"
      title={a}
    />
  )
}

export function ArtistLink({
  a,
  className,
  title,
  avatar = false,
}: {
  a: string
  className?: string
  title?: string
  avatar?: boolean
}) {
  const link = (
    <Link to={`/artist/${encodeURIComponent(a)}`} className={className} title={title}>
      {a}
    </Link>
  )
  if (!avatar) return link
  // The wrapper is only worth its inline-flex when a picture actually lands, and
  // an artist with no portrait should read exactly as it did before.
  if (!artistAvatar(a)) return link
  return (
    <span className="name-with-avatar">
      <ArtistAvatar a={a} size={20} />
      {link}
    </span>
  )
}

export function YearLink({ y }: { y: number }) {
  return <Link to={`/year/${y}`}>{y}</Link>
}

/** The full credit string with each individual artist linked. */
export function ArtistCredit({ s }: { s: Song }) {
  if (s.artists.length <= 1) return <ArtistLink a={s.artists[0] ?? s.artist} />
  return (
    <>
      {s.artists.map((a, i) => (
        <span key={a}>
          {i > 0 && ' × '}
          <ArtistLink a={a} />
        </span>
      ))}
    </>
  )
}

export function ScoreChip({ v }: { v: number }) {
  const { bg, fg, border } = scoreColor(v)
  return (
    <span
      className="chip"
      style={{ background: bg, color: fg, borderColor: border }}
      data-tip={v === 11 ? 'The 11 — super vote' : undefined}
    >
      {v === 11 ? '11★' : v}
    </span>
  )
}

export function RankBadge({ rank }: { rank: number }) {
  return <span className="rank-medal">{medal(rank)}</span>
}

/**
 * Lazy YouTube thumbnail for a song. Walks the song's candidate ids (video link,
 * then music link) and renders nothing once they are all exhausted, so a taken-down
 * video never shows YouTube's grey placeholder.
 */
export function Thumb({ s, size = 'small' }: { s: Song; size?: 'small' | 'large' }) {
  const ids = videoIds(s)
  const [i, setI] = useState(0)
  const [loaded, setLoaded] = useState(false)
  if (i >= ids.length) return null
  return (
    <img
      // keyed so advancing the id remounts rather than reusing the old decode
      key={ids[i]}
      className={`thumb ${size}${loaded ? ' loaded' : ''}`}
      src={thumbFor(ids[i])}
      alt=""
      loading="lazy"
      onLoad={(e) => {
        if (isDeadThumb(e.currentTarget)) setI(i + 1)
        else setLoaded(true)
      }}
      onError={() => setI(i + 1)}
    />
  )
}

/**
 * First candidate id whose thumbnail actually exists, probed off-screen. Used where
 * the poster is a CSS background (no load/error events to hook). `undefined` while
 * still resolving, `null` when nothing resolves.
 */
function useLiveVideo(ids: string[]): { id: string; poster: string } | null | undefined {
  const key = ids.join(',')
  const [out, setOut] = useState<{ id: string; poster: string } | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    const probe = (n: number) => {
      if (cancelled) return
      if (n >= ids.length) return setOut(null)
      const img = new Image()
      img.onload = () => {
        if (cancelled) return
        if (isDeadThumb(img)) probe(n + 1)
        else setOut({ id: ids[n], poster: thumbFor(ids[n]) })
      }
      img.onerror = () => probe(n + 1)
      img.src = thumbFor(ids[n])
    }
    setOut(undefined)
    probe(0)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return out
}

/**
 * A YouTube player that stays a thumbnail poster until clicked (no iframe until
 * then — faster, and it hides the "embedding disabled" error for the common
 * case).
 */
export function VideoFacade({ ids, title }: { ids: string[]; title: string }) {
  const [playing, setPlaying] = useState(false)
  const live = useLiveVideo(ids)
  // hold the slot while probing so the poster's arrival doesn't shift the page
  if (live === undefined) return <div className="yt-player" />
  // every candidate is a removed video — a player here would only show YouTube's
  // "unavailable" screen, so show nothing and let WatchLinks carry the raw links
  if (!live) return null
  return (
    <div className="yt-player">
      {playing ? (
        <iframe
          className="yt-embed"
          src={`https://www.youtube-nocookie.com/embed/${live.id}?autoplay=1`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button
          className="yt-facade"
          style={{ backgroundImage: `url(${live.poster})` }}
          onClick={() => setPlaying(true)}
          aria-label={`Play ${title}`}
        >
          <span className="play" />
        </button>
      )}
    </div>
  )
}

/** VideoFacade for a song, using whichever of its links still resolves. */
export function YouTubeEmbed({ s }: { s: Song }) {
  return <VideoFacade ids={videoIds(s)} title={s.title} />
}

/** Table-cell pairing of thumbnail + title/subtitle stack. */
export function SongCell({ s, withYear, sub }: { s: Song; withYear?: boolean; sub?: ReactNode }) {
  return (
    <div className="song-cell">
      <Thumb s={s} />
      <div>
        <SongTitle s={s} withYear={withYear} />
        {sub !== undefined && <div className="note">{sub}</div>}
      </div>
    </div>
  )
}

export function Tile({ value, label, detail }: { value: ReactNode; label: string; detail?: ReactNode }) {
  return (
    <div className="tile">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
      {detail !== undefined && <div className="detail">{detail}</div>}
    </div>
  )
}

export function SongTitle({ s, withYear }: { s: Song; withYear?: boolean }) {
  return (
    <>
      <Link to={`/song/${s.year}/${encodeURIComponent(s.id)}`}>{s.title}</Link>
      {withYear && <span className="pill" style={{ marginLeft: 6 }}>{s.year}</span>}
    </>
  )
}

/** Explicit external YouTube links (only rendered for real URLs). */
export function WatchLinks({ s }: { s: Song }) {
  const links = [
    { url: s.videoUrl, label: '▶ video' },
    { url: s.musicUrl, label: '♫ music' },
  ].filter((l) => l.url)
  if (!links.length) return null
  return (
    <>
      {links.map((l) => (
        <a key={l.label} className="pill" href={l.url} target="_blank" rel="noreferrer" style={{ borderColor: 'var(--navy)' }}>
          {l.label}
        </a>
      ))}
    </>
  )
}

/** Expandable row of every participant's score for one song. */
export function ScoreBreakdown({ s }: { s: Song }) {
  const entries = Object.entries(s.scores).sort((a, b) => b[1] - a[1])
  return (
    <div className="reveal" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 0' }}>
      {entries.map(([n, v]) => (
        <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <ScoreChip v={v} />
          <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
            <Name n={n} />
          </span>
        </span>
      ))}
    </div>
  )
}

export function useSort<K extends string>(initial: K, initialDir: 1 | -1 = -1) {
  const [key, setKey] = useState<K>(initial)
  const [dir, setDir] = useState<1 | -1>(initialDir)
  const toggle = (k: K, defaultDir: 1 | -1 = -1) => {
    if (k === key) setDir((d) => (d === 1 ? -1 : 1))
    else {
      setKey(k)
      setDir(defaultDir)
    }
  }
  const arrow = (k: K) => (k === key ? (dir === 1 ? ' ↑' : ' ↓') : '')
  return { key, dir, toggle, arrow }
}

export function HBar({ label, value, max, display, color }: { label: ReactNode; value: number; max: number; display: ReactNode; color?: string }) {
  return (
    <div className="row">
      <div className="name">{label}</div>
      <div className="track">
        <div className="fill" style={{ width: `${max > 0 ? (Math.max(0, value) / max) * 100 : 0}%`, background: color }} />
      </div>
      <div className="val">{display}</div>
    </div>
  )
}

/** Renders the first `initial` items with a small-caps toggle to reveal the rest. */
export function ShowMore<T>({
  items,
  initial,
  children,
  noun = 'entries',
}: {
  items: T[]
  initial: number
  children: (shown: T[]) => ReactNode
  noun?: string
}) {
  const [open, setOpen] = useState(false)
  const shown = open ? items : items.slice(0, initial)
  return (
    <>
      {children(shown)}
      {items.length > initial && (
        <button className="showmore" onClick={() => setOpen((o) => !o)}>
          {open ? 'Show fewer ▴' : `Show all ${items.length} ${noun} ▾`}
        </button>
      )}
    </>
  )
}


const binLabel = (i: number, b: number) => `score ${1 + i / 2} — ${b} time${b === 1 ? '' : 's'}`

/**
 * Score-distribution histogram (half-point bins from 1 to 11), plain SVG.
 *
 * Single-series only, and scaled to its own tallest bar. Comparing several
 * distributions is a different chart with different rules — see
 * `ScoreDistributions` in charts.tsx, which shares one axis and plots shares
 * rather than counts.
 */
export function Histogram({ values, height = 110 }: { values: number[]; height?: number }) {
  const { active: hovered, mark, background } = useMarkHover()
  const bins = scoreBins(values)
  const maxBin = Math.max(...bins, 1)
  const w = 460
  const barW = w / bins.length
  const plotH = height - 18
  const barH = (b: number) => (b / maxBin) * (plotH - 4)
  return (
    <div className="chart-wrap" style={{ maxWidth: 560 }} {...background}>
      {hovered !== null && bins[hovered] > 0 && (
        <div
          className="chart-tip"
          style={{
            left: `${Math.min(85, Math.max(10, ((hovered * barW + barW / 2) / w) * 100))}%`,
            top: `${((plotH - barH(bins[hovered])) / height) * 100}%`,
          }}
        >
          {binLabel(hovered, bins[hovered])}
        </div>
      )}
      <svg className="histogram" viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', display: 'block' }}>
        {bins.map((b, i) => (
          <rect
            key={i}
            x={i * barW + 1}
            y={plotH - barH(b)}
            width={barW - 2}
            height={barH(b)}
            style={hovered === i ? { fill: 'var(--vermillion)' } : undefined}
          />
        ))}
        {/* full-height invisible hit strips so short bars are easy to hover */}
        {bins.map((b, i) => (
          <rect
            key={`hit${i}`}
            x={i * barW}
            y={0}
            width={barW}
            height={plotH}
            style={{ fill: 'transparent', animation: 'none' }}
            {...(b > 0 ? mark(i) : {})}
          />
        ))}
        <line className="axis" x1={0} y1={plotH} x2={w} y2={plotH} />
        {[1, 3, 5, 7, 9, 11].map((s) => (
          <text key={s} x={(s - 1) * 2 * barW + barW / 2} y={height - 5} textAnchor="middle">
            {s}
          </text>
        ))}
      </svg>
    </div>
  )
}

/** The same distribution rotated: score axis vertical, 11 at the top, bars growing rightward. */
export function VertHistogram({ values, height = 210 }: { values: number[]; height?: number }) {
  const { active: hovered, mark, background } = useMarkHover()
  const bins = scoreBins(values)
  const maxBin = Math.max(...bins, 1)
  const w = 300
  const L = 26
  const rowH = height / bins.length
  const barLen = (b: number) => (b / maxBin) * (w - L - 40)
  const rowY = (i: number) => (bins.length - 1 - i) * rowH // i=20 (score 11) at top
  return (
    <div className="chart-wrap" style={{ maxWidth: 340 }} {...background}>
      {hovered !== null && bins[hovered] > 0 && (
        <div
          className="chart-tip"
          style={{
            left: `${Math.min(80, ((L + barLen(bins[hovered])) / w) * 100 + 6)}%`,
            top: `${((rowY(hovered) + rowH / 2) / height) * 100 + 4}%`,
          }}
        >
          {binLabel(hovered, bins[hovered])}
        </div>
      )}
      <svg className="histogram vert" viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', display: 'block' }}>
        {bins.map((b, i) => (
          <rect
            key={i}
            x={L + 1}
            y={rowY(i) + 1}
            width={barLen(b)}
            height={rowH - 2}
            style={hovered === i ? { fill: 'var(--vermillion)' } : undefined}
          />
        ))}
        {bins.map((b, i) => (
          <rect
            key={`hit${i}`}
            x={L}
            y={rowY(i)}
            width={w - L}
            height={rowH}
            style={{ fill: 'transparent', animation: 'none' }}
            {...(b > 0 ? mark(i) : {})}
          />
        ))}
        <line className="axis" x1={L} y1={0} x2={L} y2={height} />
        {[1, 3, 5, 7, 9, 11].map((s) => (
          <text key={s} x={L - 6} y={rowY((s - 1) * 2) + rowH / 2 + 3.5} textAnchor="end">
            {s}
          </text>
        ))}
      </svg>
    </div>
  )
}

/** URL-backed string state (replace semantics) so filtered views are linkable. */
export function useParamState(key: string, initial: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(key) ?? initial
  const set = (v: string) => {
    const next = new URLSearchParams(params)
    if (v === initial || v === '') next.delete(key)
    else next.set(key, v)
    setParams(next, { replace: true })
  }
  return [value, set]
}

/**
 * The site-wide year filter: an "all" button plus one pill per year, each
 * toggling that year in and out of the selection (see lib/yearScope.ts).
 *
 * Multi-select, not one-of: picking 2022 and then 2023 shows the two pooled.
 * Everything downstream is recomputed over exactly the selected years, so the
 * board on screen is the board those years would have produced on their own.
 *
 * Two looks, because the pill box predates this component in two places: `seg`
 * is the joined button strip used in page control bars, `pill` the loose chips
 * on a profile header. Behaviour is identical.
 *
 * `inertYears` render as dead chips rather than buttons — a year the subject of
 * the page took no part in, which there is nothing to scope to.
 */
export function YearScopePills({
  years,
  scope,
  onChange,
  variant = 'seg',
  allLabel = 'All years',
  inertYears,
  inertTitle = 'No data',
}: {
  years: readonly number[]
  scope: YearScope
  onChange: (next: YearScope) => void
  variant?: 'seg' | 'pill'
  allLabel?: string
  inertYears?: readonly number[]
  inertTitle?: string
}) {
  const cls = (on: boolean) =>
    variant === 'pill' ? `pill pill-button${on ? ' on' : ''}` : on ? 'on' : ''

  return (
    <span className={variant === 'pill' ? 'year-pills' : 'seg'}>
      <button
        className={cls(isAllYears(scope))}
        onClick={() => onChange(ALL_YEARS)}
        aria-pressed={isAllYears(scope)}
        title="Every year, pooled"
      >
        {allLabel}
      </button>
      {years.map((y) => {
        if (inertYears?.includes(y)) {
          return (
            <span key={y} className="pill inert-year" title={inertTitle}>
              {y}
            </span>
          )
        }
        // "All years" is the empty selection, so no individual pill is lit in
        // that state — the year is included, but not picked.
        const on = scope.includes(y)
        return (
          <button
            key={y}
            className={cls(on)}
            onClick={() => onChange(toggleYear(scope, y))}
            aria-pressed={on}
            aria-label={on ? `Remove ${y} from selection` : `Add ${y} to selection`}
            title={on ? `Remove ${y}` : scope.length ? `Add ${y}` : `Only ${y}`}
          >
            {y}
          </button>
        )
      })}
    </span>
  )
}

/** The standing explanation of the pill box, for a page's control bar. */
export function ScopeNote({ scope, years }: { scope: YearScope; years?: readonly number[] }) {
  if (isAllYears(scope)) return null
  return (
    <span className="note">
      Showing {scopeLabel(scope, years)} — click to change.
    </span>
  )
}

interface SearchHit {
  group: string
  label: string
  to: string
}

/** Masthead quick-search across songs, artists, and rankers. */
export function QuickSearch({ songs, artists, participants }: { songs: Song[]; artists: string[]; participants: string[] }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)

  const hits = useMemo<SearchHit[]>(() => {
    const needle = q.trim().toLowerCase()
    if (needle.length < 2) return []
    const out: SearchHit[] = []
    for (const p of participants) {
      if (displayName(p).toLowerCase().includes(needle))
        out.push({ group: 'Ranker', label: displayName(p), to: `/participant/${encodeURIComponent(p)}` })
    }
    for (const a of artists) {
      if (a.toLowerCase().includes(needle)) out.push({ group: 'Artist', label: a, to: `/artist/${encodeURIComponent(a)}` })
    }
    for (const s of songs) {
      if (s.title.toLowerCase().includes(needle))
        out.push({ group: 'Song', label: `${s.title} (${s.year})`, to: `/song/${s.year}/${encodeURIComponent(s.id)}` })
    }
    return out.slice(0, 8)
  }, [q, songs, artists, participants])

  const go = (hit: SearchHit) => {
    setQ('')
    setOpen(false)
    navigate(hit.to)
  }

  return (
    <div className="qsearch">
      <input
        type="search"
        placeholder="Find a song, artist, or ranker…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 150)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) go(hits[0])
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && hits.length > 0 && (
        <div className="qsearch-drop">
          {hits.map((h) => (
            <button key={h.group + h.to + h.label} onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)}>
              <span className="g">{h.group}</span> {h.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export { displayName, fmt }

/**
 * The note a ranker typed next to a song while scoring it. Renders nothing when
 * they left none, or when that year's sheet had no Comments tab at all — so it
 * can be dropped anywhere a single score is highlighted without guarding.
 *
 * `who` takes a pair for the head-to-head views, where either side may have
 * written something; names are shown only when there is more than one note to
 * tell apart.
 */
export function SongNote({ s, who }: { s: Song; who: string | string[] }) {
  const names = Array.isArray(who) ? who : [who]
  const notes = names.flatMap((n) => {
    const text = s.comments?.[n]
    return text ? [{ n, text }] : []
  })
  if (!notes.length) return null
  return (
    <div className="song-notes">
      {notes.map(({ n, text }) => (
        <p className="voice-quote" key={n}>
          {notes.length > 1 && <span className="note-by">{displayName(n)}</span>}
          {text}
        </p>
      ))}
    </div>
  )
}

/**
 * Word cloud as scaled inline type rather than a packed spiral: a spiral needs
 * rotated words and fixed dimensions to fill its space, which reads badly on a
 * phone and badly on a projector. Flowing text wraps anywhere and stays legible.
 *
 * Size runs on the square root of frequency — linear sizing lets one common word
 * tower over everything and squash the tail into unreadability.
 */
export function WordCloud({ words, onPick }: { words: WordCount[]; onPick?: (w: string) => void }) {
  if (!words.length) return null
  // Words carrying a `weight` (keyness) are sized on that instead of raw
  // frequency; the caller sorts by whichever it chose, so the ends of the list
  // bound the scale either way.
  const sizeOf = (w: WordCount) => w.weight ?? w.count
  const max = sizeOf(words[0])
  const min = sizeOf(words[words.length - 1])
  const span = Math.max(0.001, Math.sqrt(max) - Math.sqrt(min))
  return (
    <div className="wordcloud">
      {scatter(words).map((w) => {
        const t = Math.max(0, (Math.sqrt(sizeOf(w)) - Math.sqrt(min)) / span)
        return (
          <button
            key={w.word}
            type="button"
            className="wc-word"
            style={{ fontSize: `${(0.85 + t * 2.1).toFixed(2)}em`, opacity: 0.55 + t * 0.45 }}
            title={
              w.weight === undefined
                ? plural(w.count, 'mention')
                : `${plural(w.count, 'mention')} — ${w.weight.toFixed(1)}σ above the year's rate`
            }
            onClick={() => onPick?.(w.word)}
          >
            {w.word}
          </button>
        )
      })}
    </div>
  )
}
