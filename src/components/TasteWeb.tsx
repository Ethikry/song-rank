import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { heatColor, heatGradient } from '../lib/format'
import { categoryColor } from './charts'

export interface WebNode3 {
  name: string
  label: string
  x: number
  y: number
  z: number
  /**
   * Radius of doubt, in the same units as x/y/z: how far this point's drawn
   * distances still miss their targets on average. Drawn as a wireframe sphere
   * on hover, so a position the fit is confident about reads as a point and a
   * compromised one reads as a region. Omitted → no sphere.
   */
  misfit?: number
  onClick?: () => void
}

export interface WebEdge3 {
  i: number
  j: number
  /** Bond strength. Always drives thickness; drives colour unless `tone` is used. */
  w: number
  /**
   * Optional second dimension, signed and centred on zero: which *way* the bond
   * runs, as opposed to how strong it is. Only read when the web is configured
   * with `threads.colorBy: 'tone'`.
   */
  tone?: number
}

/**
 * What a thread's colour says. By default it's bond strength, cold→hot, and
 * strength is the only thing a thread encodes.
 *
 * `colorBy: 'tone'` moves colour onto each edge's signed `tone`, scaled
 * symmetrically about zero — so cold and hot become the two directions of a
 * feeling rather than the two ends of a magnitude — and leaves thickness to
 * carry strength on its own.
 */
export interface ThreadScale {
  colorBy: 'tone'
  /** Legend caption, and the words at its cold and hot ends. */
  label: string
  lo: string
  hi: string
  /** Sentence fragment appended after the signed tone in a thread's tooltip. */
  toneUnit?: string
}

/** Widest the drawing ever gets; past this the cloud just floats in space. */
const MAX_WEB_W = 820

/**
 * Vertices evenly scattered over a unit sphere (Fibonacci lattice) plus the
 * near-neighbour pairs among them. Fixed count, so this is computed once and
 * every sphere reuses it — only the rotation and radius differ per node.
 */
const WIRE = (() => {
  const N = 26
  const golden = Math.PI * (3 - Math.sqrt(5))
  const pts: [number, number, number][] = []
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2
    const rad = Math.sqrt(Math.max(0, 1 - y * y))
    const th = i * golden
    pts.push([Math.cos(th) * rad, y, Math.sin(th) * rad])
  }
  const links: [number, number][] = []
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2])
      if (d < 0.78) links.push([i, j])
    }
  }
  return { pts, links }
})()

/**
 * The radius-of-doubt sphere: a mesh of nodes and links wrapped over the ball,
 * so it reads as a lattice of connections rather than a globe's lat/long grid.
 *
 * It shares the web's own yaw and pitch, so it turns with the cloud it belongs
 * to, and vertices are sized and faded by depth so the far half of the mesh
 * sits behind the near half.
 */
function WireSphere({
  cx,
  cy,
  r,
  color,
  yaw,
  pitch,
}: {
  cx: number
  cy: number
  r: number
  color: string
  yaw: number
  pitch: number
}) {
  const cyw = Math.cos(yaw)
  const syw = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const proj = WIRE.pts.map(([x, y, z]) => {
    const x1 = x * cyw + z * syw
    const z1 = -x * syw + z * cyw
    const y2 = y * cp - z1 * sp
    const z2 = y * sp + z1 * cp
    return { px: cx + x1 * r, py: cy - y2 * r, t: (z2 + 1) / 2 }
  })
  return (
    <g className="pt-wire" stroke={color} fill={color}>
      {WIRE.links.map(([i, j], k) => {
        const a = proj[i]
        const b = proj[j]
        const depth = (a.t + b.t) / 2
        return (
          <line
            key={`l${k}`}
            x1={a.px}
            y1={a.py}
            x2={b.px}
            y2={b.py}
            strokeWidth={0.5 + 0.5 * depth}
            strokeOpacity={0.1 + 0.3 * depth}
            // staggered so the lattice knits itself together rather than
            // appearing all at once
            style={{ animationDelay: `${(k % 20) * 16}ms` }}
          />
        )
      })}
      {proj.map((p, i) => (
        <circle
          key={`v${i}`}
          cx={p.px}
          cy={p.py}
          r={0.9 + 1.5 * p.t}
          stroke="none"
          fillOpacity={0.25 + 0.55 * p.t}
          style={{ animationDelay: `${i * 14}ms` }}
        />
      ))}
    </g>
  )
}

/**
 * A 3D "taste web": nodes from a 3-component MDS embedding, threads between
 * strongly correlated pairs. Drag to spin, scroll to zoom. Depth is shown by
 * size and ink strength; thread color runs cold→hot with bond strength;
 * the hovered node rises to the front with its label.
 */
export function TasteWeb({
  nodes,
  edges,
  height = 520,
  threads,
  marginOfError = true,
}: {
  nodes: WebNode3[]
  edges: WebEdge3[]
  /** Shorter on the slideshow, where the slide also has to fit a stats row. */
  height?: number
  /** Defaults to colouring threads by strength; see ThreadScale. */
  threads?: ThreadScale
  /**
   * Off on the slideshow: it's a control nobody can reach from the back of the
   * room, and its caption is a paragraph of caveat at projector scale.
   */
  marginOfError?: boolean
}) {
  const [yaw, setYaw] = useState(0.7)
  const [pitch, setPitch] = useState(0.3)
  const [zoom, setZoom] = useState(1)
  const [hovered, setHovered] = useState<number | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null)
  // Off by default: the map is easier to read clean, and the margin of error is
  // something you opt into when you want to interrogate a placement.
  const [showDoubt, setShowDoubt] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const gid = useId().replace(/:/g, '')
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number; moved: boolean } | null>(null)

  /** A thread is "hot" when hovered directly, or when either end is the hovered node. */
  const isHotEdge = (e: WebEdge3, k: number) => hoveredEdge === k || hovered === e.i || hovered === e.j

  /*
   * The viewBox is measured, not fixed.
   *
   * It used to be a fixed 680 wide, which meant that on a 390px phone the whole
   * drawing was scaled to 0.57 and a 9.5px name label rendered at five and a
   * half pixels — the web arrived as a cloud of illegible specks. Measuring the
   * element and matching the viewBox to it keeps one SVG unit at one CSS pixel
   * at every width, so the labels are the size they say they are.
   */
  const [boxW, setBoxW] = useState(680)
  useLayoutEffect(() => {
    // The wrapper, not the <svg>: Chrome delivers no ResizeObserver entries at
    // all for an SVG root — it is a replaced element with no CSS content box to
    // report — so observing the drawing itself silently never fires and the
    // viewBox stays at its initial guess forever. The wrapper is a plain block.
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      // The svg is capped by its own max-width, so a wider column does not make
      // a wider drawing.
      const w = Math.round(Math.min(el.getBoundingClientRect().width, MAX_WEB_W))
      /*
       * Only a real resize gets through.
       *
       * The height below is derived from this width, and changing the height
       * can add or remove the scrolling ancestor's vertical scrollbar — which
       * changes the width straight back. That is a ResizeObserver feedback loop
       * that would spin forever. A threshold wider than any scrollbar breaks
       * it, and the residual error is at most a couple of percent of scale.
       */
      setBoxW((prev) => (w > 0 && Math.abs(w - prev) > 24 ? w : prev))
    }
    // Measure once directly rather than waiting to be told. A ResizeObserver's
    // first callback only arrives at a rendering opportunity, which a hidden or
    // backgrounded tab never reaches — the web would then paint its whole life
    // at the placeholder width if it was mounted while the tab was in the
    // background. The observer below is only for later resizes.
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const width = boxW
  /*
   * Portrait on a phone, landscape on a desktop. A 680×430 letterbox on a tall
   * screen spends the height it has on empty margins; below ~560px the box goes
   * slightly taller than it is wide, which is the shape the space actually is.
   *
   * Rounded to a 20px step for the same anti-feedback reason as the threshold
   * above: a height that moves in small continuous increments with the width is
   * exactly what makes a scrollbar oscillate.
   */
  const boxH = Math.round(Math.min(height, Math.max(280, boxW * (boxW < 560 ? 1.1 : 0.72))) / 20) * 20

  // wheel zoom needs a non-passive listener to preventDefault page scroll
  const clampZoom = (z: number) => Math.min(5, Math.max(0.55, z))
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // Generous upper bound so a crowded knot can be opened right up and read.
      setZoom((z) => clampZoom(z * (e.deltaY > 0 ? 0.92 : 1.08)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /*
   * Pinch, for the pointers that have no wheel.
   *
   * Zoom was wheel-only, so on a phone the web could be spun but never opened
   * up — and a crowded knot of names is exactly what you need to zoom into.
   * Live pointers are tracked here; the second one turns the gesture from a
   * spin into a pinch, and rotation is suspended until it lifts so the web
   * doesn't lurch while being scaled.
   */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)
  const pinchDistance = () => {
    const [a, b] = [...pointers.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  const projected = useMemo(() => {
    const cy = Math.cos(yaw)
    const sy = Math.sin(yaw)
    const cp = Math.cos(pitch)
    const sp = Math.sin(pitch)
    const spread = Math.max(...nodes.map((n) => Math.hypot(n.x, n.y, n.z)), 0.001)
    // Margin for the name labels that sit outside each dot. Proportional so a
    // short box (the slideshow) doesn't spend most of its half-height on margin
    // and shrink the cloud to a dot.
    const margin = Math.min(60, Math.min(width, boxH) * 0.14)
    const S = ((Math.min(width, boxH) / 2 - margin) / spread) * zoom
    const pts = nodes.map((n, idx) => {
      const x1 = n.x * cy + n.z * sy
      const z1 = -n.x * sy + n.z * cy
      const y2 = n.y * cp - z1 * sp
      const z2 = n.y * sp + z1 * cp
      return { idx, px: width / 2 + x1 * S, py: boxH / 2 - y2 * S, z: z2 }
    })
    const zs = pts.map((p) => p.z)
    const zLo = Math.min(...zs)
    const zHi = Math.max(...zs)
    const span = zHi - zLo || 1
    // t = 1 nearest viewer
    return { S, pts: pts.map((p) => ({ ...p, t: (p.z - zLo) / span })) }
  }, [nodes, yaw, pitch, zoom, width, boxH])

  const { S } = projected
  const byIdx = projected.pts
  // bond strength normalizes over the edges actually shown, weakest → strongest
  const loW = Math.min(...edges.map((e) => e.w), Infinity)
  const hiW = Math.max(...edges.map((e) => e.w), -Infinity)
  const heatT = (w: number) => (hiW - loW > 1e-9 ? (w - loW) / (hiW - loW) : 1)
  /*
   * Tone keeps zero pinned to the middle of the ramp, so neutral always reads
   * neutral and the colour of a pair doesn't shift when the filter changes.
   *
   * The two halves are scaled separately, and against fixed reference points
   * rather than the largest tone on screen. Dividing by the observed maximum
   * put nearly everything in the green middle: tone runs about −1.3 to +0.7, so
   * a single sour pair set the scale for both directions and the hottest fifth
   * of the ramp was unreachable — no thread could ever be red. These constants
   * are roughly where each side of the distribution actually ends, which
   * spreads the field across the whole spectrum; beyond them a thread simply
   * pins at full blue or full red.
   */
  const TONE_LOVED = 0.55
  const TONE_DISLIKED = 1.0
  const toneT = (tone: number) =>
    0.5 + 0.5 * Math.max(-1, Math.min(1, tone / (tone >= 0 ? TONE_LOVED : TONE_DISLIKED)))
  const colorT = (e: WebEdge3) => (threads?.colorBy === 'tone' ? toneT(e.tone ?? 0) : heatT(e.w))
  const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`
  const drawOrder = [...byIdx].sort((a, b) => a.t - b.t)
  if (hovered !== null) {
    const hi = drawOrder.findIndex((p) => p.idx === hovered)
    if (hi >= 0) drawOrder.push(...drawOrder.splice(hi, 1))
  }
  const tipEdge = hoveredEdge !== null ? edges[hoveredEdge] : null
  const hasDoubt = marginOfError && nodes.some((n) => (n.misfit ?? 0) > 0)

  return (
    <div className="web3-wrap chart-wrap" ref={wrapRef}>
      {tipEdge && (
        <div
          className="chart-tip"
          style={{
            left: `${Math.min(85, Math.max(15, (((byIdx[tipEdge.i].px + byIdx[tipEdge.j].px) / 2) / width) * 100))}%`,
            top: `${(((byIdx[tipEdge.i].py + byIdx[tipEdge.j].py) / 2) / boxH) * 100}%`,
          }}
        >
          {nodes[tipEdge.i].label} × {nodes[tipEdge.j].label}: {tipEdge.w.toFixed(2)}
          {threads?.colorBy === 'tone' && tipEdge.tone !== undefined && (
            <> · {signed(tipEdge.tone)}{threads.toneUnit ? ` ${threads.toneUnit}` : ''}</>
          )}
        </div>
      )}
      <svg
        ref={svgRef}
        className="chart web web3"
        viewBox={`0 0 ${width} ${boxH}`}
        /* Height in px and width from CSS: the element's box is settled before
           the viewBox is written, so the measurement above can't chase itself. */
        style={{ width: '100%', maxWidth: MAX_WEB_W, height: boxH, touchAction: 'none' }}
        onPointerDown={(e) => {
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (pointers.current.size === 2) {
            // Second finger down: this is a pinch, not a spin.
            pinch.current = { dist: pinchDistance(), zoom }
            drag.current = null
            setHovered(null)
            setHoveredEdge(null)
            return
          }
          drag.current = { x: e.clientX, y: e.clientY, yaw, pitch, moved: false }
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          if (e.pointerType === 'mouse') return
          /*
           * Touch stand-in for hover. Spinning the web already worked under a
           * finger, but the labels behind every node and thread were reachable
           * only with a mouse, which left the web on a phone as a cloud of
           * unnamed dots. A tap now labels whatever it landed on, and a tap on
           * empty space clears it. Read off the target here rather than from
           * per-group handlers so it can't fight the drag below for the event.
           */
          const g = (e.target as Element).closest('[data-node],[data-edge]')
          // both are indices, so index 0 has to survive the check
          const idx = (attr: string) => {
            const v = g?.getAttribute(attr)
            return v === null || v === undefined ? null : Number(v)
          }
          setHovered(idx('data-node'))
          setHoveredEdge(idx('data-edge'))
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) {
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          }
          if (pinch.current && pointers.current.size >= 2) {
            const dist = pinchDistance()
            if (dist > 0) setZoom(clampZoom(pinch.current.zoom * (dist / pinch.current.dist)))
            return
          }
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          const dy = e.clientY - d.y
          if (Math.abs(dx) + Math.abs(dy) > 4) {
            // a spin is not a tap: drop any label the gesture started on, or it
            // hangs over the web naming a dot that has since moved
            if (!d.moved && e.pointerType !== 'mouse') {
              setHovered(null)
              setHoveredEdge(null)
            }
            d.moved = true
          }
          setYaw(d.yaw + dx * 0.008)
          setPitch(Math.min(1.35, Math.max(-1.35, d.pitch + dy * 0.008)))
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId)
          drag.current = null
          // A pinch ends when it drops below two fingers; the one still down
          // must not resume spinning from where the pinch left the web.
          if (pointers.current.size < 2) pinch.current = null
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId)
          drag.current = null
          if (pointers.current.size < 2) pinch.current = null
        }}
      >
        <defs>
          {/* One gradient per node so the glow is always its own dot's colour.
              An even falloff from the centre — the depth cue comes from the
              mesh, so shading this like a lit ball only muddied it. */}
          {nodes.map((n, i) => {
            if (!n.misfit) return null
            const c = categoryColor(n.name)
            return (
              <radialGradient id={`${gid}-doubt-${i}`} key={n.name}>
                <stop offset="0%" stopColor={c} stopOpacity="0.42" />
                <stop offset="55%" stopColor={c} stopOpacity="0.2" />
                <stop offset="100%" stopColor={c} stopOpacity="0" />
              </radialGradient>
            )
          })}
        </defs>
        {/* Two passes so a hovered artist's threads paint over the cold ones — otherwise
            they'd be buried under whatever happens to come later in `edges`. */}
        {edges
          .map((e, k) => ({ e, k }))
          .sort((p, q) => Number(isHotEdge(p.e, p.k)) - Number(isHotEdge(q.e, q.k)))
          .map(({ e, k }) => {
            const a = byIdx[e.i]
            const b = byIdx[e.j]
            // Thickness and opacity always read strength; only the ink changes.
            const s = heatT(e.w)
            const depth = (a.t + b.t) / 2
            const hot = isHotEdge(e, k)
            // when an artist is hovered, everything not touching them recedes
            const dimmed = hovered !== null && !hot
            return (
              <g
                key={k}
                data-edge={k}
                onMouseEnter={() => setHoveredEdge(k)}
                onMouseLeave={() => setHoveredEdge((h) => (h === k ? null : h))}
              >
                <line
                  x1={a.px}
                  y1={a.py}
                  x2={b.px}
                  y2={b.py}
                  stroke={heatColor(colorT(e))}
                  strokeWidth={hot ? 2.6 : 1.1 + s * 0.9}
                  strokeOpacity={hot ? 1 : dimmed ? 0.15 : (0.4 + s * 0.25) * (0.5 + 0.5 * depth)}
                />
                {/* invisible fat twin as the hover target — the thread itself is a hairline */}
                <line x1={a.px} y1={a.py} x2={b.px} y2={b.py} stroke="transparent" strokeWidth={7} />
              </g>
            )
          })}
        {drawOrder.map((p) => {
          const n = nodes[p.idx]
          const isHover = hovered === p.idx
          const r = 3.5 + 2.5 * p.t + (isHover ? 2.5 : 0)
          const inkStrength = 0.45 + 0.55 * p.t
          const doubtR = Math.max(r + 1, (n.misfit ?? 0) * S * (0.78 + 0.44 * p.t))
          return (
            <g
              key={n.name}
              data-node={p.idx}
              className={`pt-group${n.onClick ? ' clickable' : ''}${isHover ? ' hovered' : ''}`}
              onClick={() => {
                if (!drag.current?.moved && n.onClick) n.onClick()
              }}
              onMouseEnter={() => setHovered(p.idx)}
              onMouseLeave={() => setHovered((h) => (h === p.idx ? null : h))}
            >
              {/* Rendered always but transparent until hovered, so the fade runs
                  in both directions; showing every halo at once would fog the
                  crowded middle of the cloud. */}
              {showDoubt && n.misfit !== undefined && n.misfit > 0 && (
                <>
                  {/* Glow is always mounted so it can cross-fade both ways with
                      the dot; the mesh mounts on hover so its build-in animation
                      replays each time. */}
                  <circle
                    className="pt-halo"
                    cx={p.px}
                    cy={p.py}
                    r={doubtR}
                    fill={`url(#${gid}-doubt-${p.idx})`}
                    style={{ opacity: isHover ? 1 : 0 }}
                  />
                  {isHover && (
                    <WireSphere
                      cx={p.px}
                      cy={p.py}
                      r={doubtR}
                      color={categoryColor(n.name)}
                      yaw={yaw}
                      pitch={pitch}
                    />
                  )}
                </>
              )}
              <circle
                className="pt"
                cx={p.px}
                cy={p.py}
                r={r}
                /* fillOpacity has to ride in `style`, not as a presentation
                   attribute: the `.pt:hover` / `.clickable:hover` rules set
                   fill-opacity:1 and would otherwise cancel the dissolve. */
                style={{
                  fill: categoryColor(n.name),
                  // Only dissolve when there is a sphere to dissolve into.
                  fillOpacity: isHover && showDoubt ? 0.12 : 0.35 + 0.65 * p.t,
                }}
              />
              <text
                className="pt-label"
                x={p.px + r + 3.5}
                y={p.py + 3.5}
                style={isHover ? undefined : { fontSize: `${9.5 + 2.5 * p.t}px`, fillOpacity: inkStrength }}
              >
                {n.label}
              </text>
            </g>
          )
        })}
      </svg>
      {/* Zoom without a wheel or a second finger. "Refit" is the way back: it's
          easy to zoom into a knot and lose the rest of the cloud off-screen,
          and hunting for the original scale by pinching is miserable. */}
      <div className="web-zoom">
        <button type="button" onClick={() => setZoom((z) => clampZoom(z * 1.25))} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => setZoom((z) => clampZoom(z / 1.25))} aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          className="web-zoom-reset"
          onClick={() => {
            setZoom(1)
            setYaw(0.7)
            setPitch(0.3)
          }}
        >
          Refit
        </button>
      </div>
      {edges.length > 0 && Number.isFinite(loW) && (
        <div className="web-legend">
          <span>{threads?.label ?? 'bond strength'}</span>
          <span>{threads ? threads.lo : loW.toFixed(2)}</span>
          <span className="grad" style={{ background: heatGradient() }} />
          <span>{threads ? threads.hi : hiW.toFixed(2)}</span>
        </div>
      )}
      <p className="note" style={{ marginTop: 2 }}>
        <span className="hint-fine">Drag to spin · scroll to zoom · </span>
        <span className="hint-coarse">Drag to spin · pinch or +/− to zoom · </span>
        nearer names are darker;{' '}
        {threads?.colorBy === 'tone'
          ? 'thicker threads are stronger, and their colour says which way the feeling runs'
          : 'hotter threads are stronger'}
        .
      </p>
      {hasDoubt && (
        <div className="web-toggle">
          <button
            type="button"
            role="switch"
            aria-checked={showDoubt}
            className={`web-switch${showDoubt ? ' on' : ''}`}
            onClick={() => setShowDoubt((v) => !v)}
          >
            <span className="track" aria-hidden="true">
              <span className="knob" />
            </span>
            Margin of error
          </button>
          <span className="note">
            Hover a name to see the range its position could equally have taken — a larger sphere means a less certain
            placement.
          </span>
        </div>
      )}
    </div>
  )
}
