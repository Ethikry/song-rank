import { useEffect, useRef, useState, type ReactNode } from 'react'
import { binScore, SCORE_BINS, scoreBins } from '../lib/stats'

/**
 * Hover state for chart marks that also survives a finger.
 *
 * These charts were wired to onMouseEnter/onMouseLeave, which a tap never
 * fires, so on a phone the readouts simply did not exist — and the slideshow is
 * watched on phones. Touch has no resting position to hover from, so it gets an
 * explicit model instead of a simulated one: tap a mark to pin its readout, tap
 * the same mark again or anywhere off the chart to dismiss. Mouse is untouched.
 */
export function useMarkHover() {
  const [active, setActive] = useState<number | null>(null)
  const wrap = useRef<HTMLDivElement | null>(null)
  /** Whether the tap being processed is the one that revealed `active`. */
  const revealed = useRef(false)
  /** Set by a mark's own pointerdown so the wrapper can tell a miss from a hit. */
  const onMark = useRef(false)

  // A pinned readout is dismissed by the next touch anywhere outside the chart.
  useEffect(() => {
    if (active === null) return
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      if (!wrap.current?.contains(e.target as Node)) setActive(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [active])

  /** Spread onto a mark (dot, hit strip, …) at index `i`. */
  const mark = (i: number) => ({
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') setActive(i)
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') setActive((cur) => (cur === i ? null : cur))
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') {
        revealed.current = false
        return
      }
      // Runs before the wrapper's handler below, which is how the wrapper knows
      // this tap landed on something rather than on empty plot area.
      onMark.current = true
      revealed.current = active !== i
      setActive((cur) => (cur === i ? null : i))
    },
  })

  /** Spread onto the chart's wrapper: a tap on empty chart area clears the pin. */
  const background = {
    ref: wrap,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return
      if (!onMark.current) setActive(null)
      onMark.current = false
    },
  }

  return { active, mark, background, revealed }
}

/** Year → ink color, stable as new years are appended (values live in styles.css so dark mode can retint). */
const YEAR_COLORS = ['var(--year-0)', 'var(--year-1)', 'var(--year-2)', 'var(--year-3)', 'var(--year-4)', 'var(--year-5)']
export function yearColor(year: number, years: number[]): string {
  const i = years.indexOf(year)
  return YEAR_COLORS[(i >= 0 ? i : 0) % YEAR_COLORS.length]
}

/**
 * Stable colour for an arbitrary category (artist, nominator, …) where there are
 * far too many to hand-pick a palette. Hashes the name to a hue; lightness comes
 * from --cat-l so it stays legible in both themes.
 */
export function categoryColor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360
  return `hsl(${h} 55% var(--cat-l))`
}

/**
 * Swatches for the years a chart is currently showing.
 *
 * `all` is the palette basis and must be the same list the marks were coloured
 * from — `yearColor` assigns by position, so deriving the swatch from a
 * filtered `years` instead renumbers every entry and quietly mislabels the
 * chart (2023's dots explained by 2022's colour). Pass the page's full year
 * list here and the visible subset in `years`.
 *
 * Required rather than defaulting to `years`, because the wrong answer looks
 * perfectly plausible on screen — the legend is only ever checked against the
 * chart by someone who already suspects it.
 */
export function YearLegend({ years, all }: { years: number[]; all: number[] }) {
  return (
    <div className="chart-legend">
      {years.map((y) => (
        <span key={y}>
          <span className="swatch" style={{ background: yearColor(y, all) }} /> {y}
        </span>
      ))}
    </div>
  )
}

export interface ScatterPoint {
  x: number
  y: number
  label: string
  color?: string
  onClick?: () => void
  /** Optional small text rendered beside the dot (e.g. a name on a map). */
  text?: string
}

// Ticks never get coarser than this, so every axis keeps a labelled gridline at
// least this often. Our axes all span small ranges (scores, correlations,
// averages), so capping here just guarantees density without flooding a big range.
const MAX_TICK_STEP = 2

/** A "nice" round step (1, 2, 5 × 10ⁿ) that splits a span into about `n` parts. */
function niceStep(span: number, n = 5): number {
  const raw = (span || 1) / n
  const exp = Math.floor(Math.log10(raw))
  const base = raw / 10 ** exp
  const nice = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10
  return Math.min(nice * 10 ** exp, MAX_TICK_STEP)
}

/** Domain bounds rounded outward to whole multiples of a nice step. */
function niceBounds(lo: number, hi: number, n = 5): [number, number] {
  const step = niceStep(hi - lo, n)
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step]
}

/** Tick values at nice round multiples of the step across [lo, hi]. */
function ticks(lo: number, hi: number, n = 5): number[] {
  const step = niceStep(hi - lo, n)
  const out: number[] = []
  for (let k = Math.ceil(lo / step - 1e-6); k <= Math.floor(hi / step + 1e-6); k++) {
    out.push(Math.round(k * step * 1e6) / 1e6)
  }
  return out
}

/**
 * Enough decimals to tell neighbouring ticks apart.
 *
 * A fixed single decimal was fine while every axis here spanned whole points,
 * but a narrow one — the editions' mean σ covers 1.54 to 1.64 — then prints
 * "1.6" against three gridlines in a row, which reads as a broken chart.
 */
const tickFmt = (v: number, step: number) =>
  Math.abs(v) >= 10 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(Math.max(1, Math.ceil(-Math.log10(step))))

/**
 * Generic scatter plot. Hover a point for its label; points with onClick
 * navigate. Pure SVG, print-inked.
 */
export function Scatter({
  points,
  xLabel,
  yLabel,
  xDomain,
  yDomain,
  diagonal = false,
  width = 480,
  height = 360,
  r = 4.5,
  bare = false,
  refX,
  refY,
  path = false,
}: {
  points: ScatterPoint[]
  xLabel: string
  yLabel: string
  xDomain?: [number, number]
  yDomain?: [number, number]
  diagonal?: boolean
  width?: number
  height?: number
  r?: number
  /** Hide axes/grid/labels — for maps where only relative position matters. */
  bare?: boolean
  /** Dashed reference lines (e.g. the room median) at these data values. */
  refX?: number
  refY?: number
  /**
   * Join the points in array order with a line. Only meaningful when that order
   * is itself the story — a walk through time, say — never for a cloud of
   * independent observations, where it would imply a sequence that isn't there.
   */
  path?: boolean
}) {
  const { active: hovered, mark, background, revealed } = useMarkHover()
  // With explicit domains the frame is meaningful on its own, so an empty result
  // (e.g. a search that matches nothing) still renders axes instead of vanishing.
  if (!points.length && !(xDomain && yDomain)) return null
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  // Round auto domains outward to nice bounds so the axis ticks land on clean
  // numbers; a small pad first keeps points off the frame when the data max
  // already sits exactly on a gridline. Explicit domains are honored as-is.
  const auto = (lo: number, hi: number): [number, number] => {
    const m = (hi - lo || 1) * 0.06
    return niceBounds(lo - m, hi + m)
  }
  const [x0, x1] = xDomain ?? auto(Math.min(...xs), Math.max(...xs))
  const [y0, y1] = yDomain ?? auto(Math.min(...ys), Math.max(...ys))
  const L = 46
  const B = 34
  const T = 8
  const R = 10
  const px = (x: number) => L + ((x - x0) / (x1 - x0)) * (width - L - R)
  const py = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (height - T - B)
  const hoveredPt = hovered !== null ? points[hovered] : null

  return (
    <div className="chart-wrap" style={{ maxWidth: width + 100 }} {...background}>
      {hoveredPt && (
        <div
          className="chart-tip"
          style={{
            left: `${Math.min(88, Math.max(10, (px(hoveredPt.x) / width) * 100))}%`,
            top: `${(py(hoveredPt.y) / height) * 100}%`,
          }}
        >
          {hoveredPt.label}
        </div>
      )}
    <svg className="chart scatter" viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', display: 'block' }}>
      {!bare &&
        ticks(x0, x1).map((t, i) => (
          <g key={`x${i}`}>
            <line className="grid" x1={px(t)} y1={T} x2={px(t)} y2={height - B} />
            <text className="tick" x={px(t)} y={height - B + 14} textAnchor="middle">
              {tickFmt(t, niceStep(x1 - x0))}
            </text>
          </g>
        ))}
      {!bare &&
        ticks(y0, y1).map((t, i) => (
          <g key={`y${i}`}>
            <line className="grid" x1={L} y1={py(t)} x2={width - R} y2={py(t)} />
            <text className="tick" x={L - 6} y={py(t) + 3} textAnchor="end">
              {tickFmt(t, niceStep(y1 - y0))}
            </text>
          </g>
        ))}
      {diagonal && (
        <line
          className="diag"
          x1={px(Math.max(x0, y0))}
          y1={py(Math.max(x0, y0))}
          x2={px(Math.min(x1, y1))}
          y2={py(Math.min(x1, y1))}
        />
      )}
      {refX !== undefined && <line className="diag" x1={px(refX)} y1={T} x2={px(refX)} y2={height - B} />}
      {refY !== undefined && <line className="diag" x1={L} y1={py(refY)} x2={width - R} y2={py(refY)} />}
      {!bare && (
        <>
          <line className="axis" x1={L} y1={height - B} x2={width - R} y2={height - B} />
          <line className="axis" x1={L} y1={T} x2={L} y2={height - B} />
          <text className="axis-label" x={(L + width - R) / 2} y={height - 4} textAnchor="middle">
            {xLabel}
          </text>
          <text
            className="axis-label"
            x={12}
            y={(T + height - B) / 2}
            textAnchor="middle"
            transform={`rotate(-90 12 ${(T + height - B) / 2})`}
          >
            {yLabel}
          </text>
        </>
      )}
      {/* under the dots, so the trail never cuts across a point it connects */}
      {path && points.length > 1 && (
        <polyline
          className="trend-line"
          points={points.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')}
          fill="none"
        />
      )}
      {/* hovered point renders last so it rises above overlapping neighbors */}
      {points
        .map((p, i) => ({ p, i }))
        .sort((a, b) => (a.i === hovered ? 1 : b.i === hovered ? -1 : 0))
        .map(({ p, i }) => {
          const isHover = i === hovered
          return (
            <g
              key={i}
              className={`pt-group${p.onClick ? ' clickable' : ''}${isHover ? ' hovered' : ''}`}
              onClick={() => {
                // On touch the first tap only reveals the label — a dot is a
                // 4px target with no hover to preview it, so navigating on
                // that tap means leaving the page before reading what was hit.
                // The second tap on an already-revealed dot follows through.
                if (revealed.current) return
                p.onClick?.()
              }}
              {...mark(i)}
            >
              <circle
                className={p.onClick ? 'pt clickable' : 'pt'}
                cx={px(p.x)}
                cy={py(p.y)}
                r={isHover ? r + 2.5 : r}
                style={{ fill: p.color ?? 'var(--navy)' }}
              />
              {p.text && (
                <text className="pt-label" x={px(p.x) + r + 4} y={py(p.y) + 3.5}>
                  {p.text}
                </text>
              )}
            </g>
          )
        })}
    </svg>
    </div>
  )
}

/** Small line chart over a per-year series. */
export function TrendLine({
  series,
  height = 120,
  format = (v) => v.toFixed(2),
  domain,
}: {
  series: { year: number; value: number }[]
  height?: number
  format?: (v: number) => string
  domain?: [number, number]
}) {
  const { active: hovered, mark, background } = useMarkHover()
  if (series.length === 0) return null
  const width = 300
  const L = 14
  const R = 14
  const T = 18
  const B = 20
  const vals = series.map((s) => s.value)
  const [lo, hi] = domain ?? [Math.min(...vals), Math.max(...vals)]
  const span = hi - lo || 1
  const px = (i: number) => (series.length === 1 ? width / 2 : L + (i / (series.length - 1)) * (width - L - R))
  const py = (v: number) => T + (1 - (v - lo) / span) * (height - T - B)
  const hov = hovered !== null ? series[hovered] : null
  return (
    <div className="chart-wrap" style={{ maxWidth: 340 }} {...background}>
      {hov && (
        <div
          className="chart-tip"
          style={{
            left: `${Math.min(85, Math.max(15, (px(hovered!) / width) * 100))}%`,
            top: `${(py(hov.value) / height) * 100}%`,
          }}
        >
          {hov.year}: {format(hov.value)}
        </div>
      )}
      <svg className="chart trend" viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', display: 'block' }}>
        <polyline
          className="trend-line"
          points={series.map((s, i) => `${px(i)},${py(s.value)}`).join(' ')}
          fill="none"
        />
        {series.map((s, i) => {
          /*
           * Put the value on whichever side of the point the line isn't.
           *
           * A fixed offset above the dot works until the series dips: at a
           * trough both segments climb away above the point and the label lands
           * on top of them. There the number goes underneath instead, where
           * nothing is drawn. Peaks and slopes keep the label above — a slope
           * has line on both sides at the dot's own x, which is what the paper
           * halo below is for.
           */
          const prevV = series[i - 1]?.value ?? s.value
          const nextV = series[i + 1]?.value ?? s.value
          const trough = s.value <= prevV && s.value <= nextV && !(s.value === prevV && s.value === nextV)
          // …but only if going below doesn't put the number on top of the year
          // axis, which is exactly where a trough near the floor would land it.
          const below = trough && py(s.value) + 18 < height - B - 2
          return (
            <g key={s.year} {...mark(i)}>
              {/* generous invisible hit area — the dot itself is tiny, and a
                  fingertip is coarser still, so this is sized for touch */}
              <circle cx={px(i)} cy={py(s.value)} r={22} fill="transparent" />
              <circle className="pt" cx={px(i)} cy={py(s.value)} r={hovered === i ? 6 : 4} style={{ fill: 'var(--navy)' }} />
              <text className="tick" x={px(i)} y={height - 5} textAnchor="middle">
                {s.year}
              </text>
              <text
                className="val"
                x={px(i)}
                y={py(s.value) + (below ? 18 : -9)}
                textAnchor="middle"
                /* paper halo, so a label that still meets a line stays legible */
                stroke="var(--paper)"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {format(s.value)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Dots along a 0→1 axis (percentiles), with an instant styled tooltip. */
export function DotStrip({
  dots,
  height = 26,
}: {
  dots: { at: number; label: string; color?: string; big?: boolean }[]
  height?: number
}) {
  const width = 420
  const { active, mark, background } = useMarkHover()
  const tip = active !== null ? dots[active] : null
  return (
    <div className="strip-wrap" {...background}>
      {tip && (
        <div className="chart-tip" style={{ left: `${Math.min(78, Math.max(6, tip.at * 100))}%` }}>
          {tip.label}
        </div>
      )}
      <svg className="chart strip" viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxWidth: 460, display: 'block' }}>
        <line className="axis" x1={4} y1={height / 2} x2={width - 4} y2={height / 2} />
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} className="grid" x1={4 + t * (width - 8)} y1={height / 2 - 4} x2={4 + t * (width - 8)} y2={height / 2 + 4} />
        ))}
        {dots.map((d, i) => {
          const isTip = active === i
          const r = isTip ? 8 : d.big ? 7 : 5
          return (
            <g key={i} {...mark(i)}>
              {/* a coarser hit area under a dot drawn at 5–8px. Kept modest
                  rather than fingertip-sized: these strips pack dots close
                  together, so an over-wide target just swallows its neighbours. */}
              <circle cx={4 + d.at * (width - 8)} cy={height / 2} r={10} fill="transparent" />
              <circle
                className="pt"
                cx={4 + d.at * (width - 8)}
                cy={height / 2}
                r={r}
                style={{ fill: d.color ?? 'var(--navy)' }}
                fillOpacity={isTip || d.big ? 1 : 0.8}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/**
 * Several years' score distributions on one set of axes.
 *
 * Frequency polygons rather than overlaid bars: four bar series on shared bins
 * either hide each other or have to be dodged into quarter-width slivers, and
 * the question here — did the room's shape shift between editions — is about
 * where each curve sits relative to the others, which lines answer directly.
 *
 * Every series is plotted as a **share** of its own scores. Rosters differ by a
 * third, so counts would rank the editions by turnout and say nothing about
 * shape.
 *
 * Hovering a score reads *every* year at once. Per-series tooltips would make
 * the reader hover four times and hold three numbers in their head to make the
 * only comparison the chart exists for.
 */
export function ScoreDistributions({
  series,
  years,
  height = 300,
  width = 640,
}: {
  /** One entry per year, in chronological order. */
  series: { year: number; values: number[] }[]
  /** The page's full year list — the palette basis, as for YearLegend. */
  years: number[]
  height?: number
  width?: number
}) {
  // The zig-zag is real, not noise: about 30% of scores are half-points, so the
  // .5 bins sit consistently below their integer neighbours. Every year does it
  // in phase, which is why the curves stay parallel and comparable.
  const { active: hovered, mark, background } = useMarkHover()
  /*
   * Picked years come forward and the rest fade back. With four curves crossing
   * the same peak, following one of them by colour alone is genuinely hard —
   * dimming the others is the difference between "there are four lines here"
   * and "here is what 2024 did".
   *
   * A set rather than a single selection, because the useful comparison is
   * often two years against the rest. Empty means no emphasis, the resting
   * state, and clicking a picked year again returns to it.
   */
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set())
  const isPicked = (year: number) => picked.has(year)
  const togglePick = (year: number) =>
    setPicked((cur) => {
      const next = new Set(cur)
      if (!next.delete(year)) next.add(year)
      return next
    })

  const shaped = series.map((s) => {
    const bins = scoreBins(s.values)
    const total = s.values.length || 1
    return { year: s.year, total, shares: bins.map((b) => b / total), counts: bins }
  })
  if (!shaped.length) return null

  const L = 44
  const R = 12
  const T = 10
  const B = 34
  const peak = Math.max(...shaped.flatMap((s) => s.shares), 0.01)
  // Round up to the next 5% rather than using niceBounds: these shares peak
  // just under 20%, and a 4-tick "nice" axis rounds that all the way to 30%,
  // leaving a third of the chart empty and squashing the curves into the floor.
  const yStep = 0.05
  const yMax = Math.ceil(peak / yStep) * yStep
  const px = (i: number) => L + (i / (SCORE_BINS - 1)) * (width - L - R)
  const py = (v: number) => T + (1 - v / yMax) * (height - T - B)
  const yTicks = Array.from({ length: Math.round(yMax / yStep) + 1 }, (_, i) => i * yStep)

  return (
    <div className="chart-wrap" style={{ maxWidth: width + 60 }} {...background}>
      {hovered !== null && (
        <div
          className="chart-tip"
          style={{ left: `${Math.min(78, Math.max(4, (px(hovered) / width) * 100))}%`, top: 0 }}
        >
          <strong>Score {binScore(hovered)}</strong>
          {[...shaped]
            .sort((a, b) => b.shares[hovered] - a.shares[hovered])
            .map((s) => (
              <div key={s.year}>
                <span className="swatch" style={{ background: yearColor(s.year, years) }} /> {s.year}:{' '}
                {pctLabel(s.shares[hovered])} ({s.counts[hovered]})
              </div>
            ))}
        </div>
      )}
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', display: 'block' }}>
        {yTicks.map((t) => (
          <g key={t}>
            <line className="grid" x1={L} y1={py(t)} x2={width - R} y2={py(t)} />
            <text className="tick" x={L - 6} y={py(t) + 3} textAnchor="end">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {/* the hovered score gets a full-height guide, so the eye can drop
            straight down every curve at once */}
        {hovered !== null && (
          <line className="grid hover-guide" x1={px(hovered)} y1={T} x2={px(hovered)} y2={height - B} />
        )}
        {/* Lines only, no fills: four translucent areas over the same bins stack
            into one opaque wash and the individual years stop being findable.
            Picked years are drawn last so the highlighted curve sits on top of
            the ones it has to be compared against. */}
        {[...shaped]
          .sort((a, b) => Number(isPicked(a.year)) - Number(isPicked(b.year)))
          .map((s) => (
            <polyline
              key={s.year}
              points={s.shares.map((v, i) => `${px(i)},${py(v)}`).join(' ')}
              fill="none"
              stroke={yearColor(s.year, years)}
              strokeWidth={isPicked(s.year) ? 3 : 2}
              strokeLinejoin="round"
              opacity={picked.size === 0 || isPicked(s.year) ? 1 : 0.18}
            />
          ))}
        {shaped.map((s) =>
          hovered === null ? null : (
            <circle
              key={s.year}
              cx={px(hovered)}
              cy={py(s.shares[hovered])}
              r={4}
              fill={yearColor(s.year, years)}
              opacity={picked.size === 0 || isPicked(s.year) ? 1 : 0.18}
            />
          ),
        )}
        <line className="axis" x1={L} y1={height - B} x2={width - R} y2={height - B} />
        {[1, 3, 5, 7, 9, 11].map((score) => (
          <text key={score} className="tick" x={px((score - 1) * 2)} y={height - B + 16} textAnchor="middle">
            {score}
          </text>
        ))}
        <text className="axis-label" x={(L + width - R) / 2} y={height - 4} textAnchor="middle">
          Score given
        </text>
        {/* full-height hit strips: the curves are 2px targets, the columns aren't */}
        {Array.from({ length: SCORE_BINS }, (_, i) => (
          <rect
            key={`hit${i}`}
            x={px(i) - (width - L - R) / (SCORE_BINS - 1) / 2}
            y={T}
            width={(width - L - R) / (SCORE_BINS - 1)}
            height={height - T - B}
            fill="transparent"
            {...mark(i)}
          />
        ))}
      </svg>
      {/*
        * Doubles as the legend. Making the existing swatch row the control keeps
        * the key and the filter in one place — a separate row of buttons beside
        * a separate row of swatches would say the same four things twice.
        */}
      <div className="chart-legend picker">
        {series.map((s) => (
          <button
            key={s.year}
            type="button"
            className={picked.size === 0 || isPicked(s.year) ? 'on' : ''}
            aria-pressed={isPicked(s.year)}
            onClick={() => togglePick(s.year)}
          >
            <span className="swatch" style={{ background: yearColor(s.year, years) }} /> {s.year}
          </button>
        ))}
        {picked.size > 0 && (
          <button type="button" className="clear" onClick={() => setPicked(new Set())}>
            show all
          </button>
        )}
      </div>
    </div>
  )
}

/** One decimal for the readout, where a 0.4% bin shouldn't round to nothing. */
const pctLabel = (v: number) => `${(v * 100).toFixed(1)}%`

export function ChartCaption({ children }: { children: ReactNode }) {
  return <p className="note">{children}</p>
}

export interface PieSlice {
  label: string
  value: number
  color: string
}

/**
 * Share-of-total pie. Deliberately plain: no legend of its own, because the
 * caller already lists the same categories beside it — a second key would just
 * make the reader look twice.
 */
export function PieChart({ slices, size = 220 }: { slices: PieSlice[]; size?: number }) {
  const total = slices.reduce((a, s) => a + s.value, 0)
  if (total <= 0) return null
  const r = size / 2 - 1
  const c = size / 2
  let angle = -Math.PI / 2 // start at 12 o'clock
  return (
    <svg className="chart" viewBox={`0 0 ${size} ${size}`} style={{ width: size, maxWidth: '100%' }}>
      {slices.map((s) => {
        const sweep = (s.value / total) * Math.PI * 2
        const x0 = c + r * Math.cos(angle)
        const y0 = c + r * Math.sin(angle)
        angle += sweep
        const x1 = c + r * Math.cos(angle)
        const y1 = c + r * Math.sin(angle)
        // A single category filling the pie can't be drawn as an arc — the two
        // endpoints coincide and the path collapses — so it becomes a circle.
        const d =
          sweep >= Math.PI * 2 - 1e-9
            ? `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} Z`
            : `M ${c} ${c} L ${x0} ${y0} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x1} ${y1} Z`
        return (
          <path key={s.label} d={d} fill={s.color} stroke="var(--paper)" strokeWidth={1.5}>
            <title>
              {s.label}: {s.value} ({Math.round((s.value / total) * 100)}%)
            </title>
          </path>
        )
      })}
    </svg>
  )
}
