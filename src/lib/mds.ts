import type { PairwiseEntry } from './types'

/**
 * Place participants in 3D so that distance ≈ (1 − taste correlation).
 * Missing pairs fall back to the mean observed distance. No dependencies,
 * and deterministic (fixed-seed power iteration, then a fixed iteration count).
 *
 * Two stages:
 *
 *  1. Classical MDS — an eigendecomposition that is exact only when the
 *     distances are genuinely Euclidean. Taste correlations are not, so on its
 *     own it leaves pairs badly misplaced: in 2022 it parked two rankers
 *     0.07 apart (visually on top of each other) though they correlate at 0.03.
 *  2. SMACOF stress majorization, started from that — this one actually
 *     minimises the thing we care about, the total gap between drawn distance
 *     and target distance, moving points until it stops improving.
 *
 * Stage 2 lifts the fit from r = 0.76 to 0.80 (2022) and 0.73 to 0.77 (2025),
 * and roughly halves the worst false-closeness case. It cannot fix it outright:
 * 32 people have 496 pairwise distances but only 96 coordinates to satisfy them,
 * so some pairs are always sacrificed. Threads (drawn from raw correlations) are
 * exact; distance stays an approximation.
 */
export function tasteMap(
  pairs: PairwiseEntry[],
  names: string[],
): { name: string; x: number; y: number; z: number; misfit: number }[] {
  const n = names.length
  if (n < 4) return names.map((name, i) => ({ name, x: i, y: 0, z: 0, misfit: 0 }))
  const idx = new Map(names.map((name, i) => [name, i]))

  const D = Array.from({ length: n }, () => new Array<number>(n).fill(NaN))
  let sum = 0
  let cnt = 0
  for (const p of pairs) {
    const i = idx.get(p.a)
    const j = idx.get(p.b)
    if (i === undefined || j === undefined) continue
    const d = 1 - p.corr
    D[i][j] = D[j][i] = d
    sum += d
    cnt++
  }
  const meanD = cnt ? sum / cnt : 1
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) D[i][j] = 0
      else if (Number.isNaN(D[i][j])) D[i][j] = meanD
    }
  }

  // B = -1/2 · J D² J  (double centering)
  const D2 = D.map((row) => row.map((d) => d * d))
  const rowMean = D2.map((row) => row.reduce((a, b) => a + b, 0) / n)
  const totalMean = rowMean.reduce((a, b) => a + b, 0) / n
  const B = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => -0.5 * (D2[i][j] - rowMean[i] - rowMean[j] + totalMean)),
  )

  // Top-3 eigenvectors by power iteration with deflation
  const mulB = (v: number[]): number[] => B.map((row) => row.reduce((a, b, j) => a + b * v[j], 0))
  const norm = (v: number[]) => Math.sqrt(v.reduce((a, b) => a + b * b, 0))
  const eigen = (deflate: { vec: number[] }[], seed: number) => {
    let v = Array.from({ length: n }, (_, i) => Math.sin(i + seed)) // fixed pseudo-random seed
    for (let iter = 0; iter < 300; iter++) {
      let w = mulB(v)
      for (const d of deflate) {
        const proj = w.reduce((a, b, i) => a + b * d.vec[i], 0)
        w = w.map((x, i) => x - proj * d.vec[i])
      }
      const len = norm(w)
      if (len < 1e-12) break
      v = w.map((x) => x / len)
    }
    const Bv = mulB(v)
    const val = v.reduce((a, b, i) => a + b * Bv[i], 0)
    return { vec: v, val }
  }
  const e1 = eigen([], 1)
  const e2 = eigen([e1], 2)
  const e3 = eigen([e1, e2], 3)

  const s1 = Math.sqrt(Math.max(0, e1.val))
  const s2 = Math.sqrt(Math.max(0, e2.val))
  const s3 = Math.sqrt(Math.max(0, e3.val))
  const X: number[][] = names.map((_, i) => [e1.vec[i] * s1, e2.vec[i] * s2, e3.vec[i] * s3])

  refine(X, D)

  /**
   * How far this point's drawn distances still miss their targets, on average,
   * in the same units as the coordinates. Read it as a radius of doubt: a point
   * with misfit 0.15 is one whose relationships would be equally well described
   * by it sitting anywhere within about 0.15 of where it landed.
   */
  const misfit = X.map((_, i) => {
    let sum = 0
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const d = Math.hypot(X[i][0] - X[j][0], X[i][1] - X[j][1], X[i][2] - X[j][2])
      sum += Math.abs(d - D[i][j])
    }
    return sum / (n - 1)
  })

  return names.map((name, i) => ({ name, x: X[i][0], y: X[i][1], z: X[i][2], misfit: misfit[i] }))
}

/**
 * SMACOF stress majorization, in place. Each pass replaces every point with the
 * weighted average of where all the other points would like it to be — which is
 * guaranteed never to increase stress, so it converges without a step size.
 *
 * With uniform weights the Guttman transform's linear solve collapses to
 * X ← (1/n)·B(X)·X: V = nI − J, whose pseudo-inverse is (1/n)(I − J/n), and the
 * J term vanishes because B has zero row sums. So no matrix inversion is needed
 * and a pass is just one O(n²) sweep.
 *
 * Uniform weights beat 1/δ (Sammon) weighting on this data — Sammon prioritises
 * short distances, which sounds right for a map read by proximity, but measured
 * out slightly worse on every metric, so it isn't worth the extra term.
 */
function refine(X: number[][], D: number[][], iters = 300): void {
  const n = X.length
  const BX = Array.from({ length: n }, () => [0, 0, 0])
  for (let iter = 0; iter < iters; iter++) {
    for (let i = 0; i < n; i++) BX[i][0] = BX[i][1] = BX[i][2] = 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = X[i][0] - X[j][0]
        const dy = X[i][1] - X[j][1]
        const dz = X[i][2] - X[j][2]
        const d = Math.hypot(dx, dy, dz)
        // Coincident points have no direction to be pushed apart along; leaving
        // them is safe because the next pass sees them moved by other pairs.
        if (d < 1e-9) continue
        const w = D[i][j] / d
        // b = -w for the (i,j) off-diagonal, +w on both diagonals; accumulating
        // the pair's contribution to B·X directly avoids materialising B.
        BX[i][0] += w * dx; BX[i][1] += w * dy; BX[i][2] += w * dz
        BX[j][0] -= w * dx; BX[j][1] -= w * dy; BX[j][2] -= w * dz
      }
    }
    for (let i = 0; i < n; i++) {
      X[i][0] = BX[i][0] / n
      X[i][1] = BX[i][1] / n
      X[i][2] = BX[i][2] / n
    }
  }
}
