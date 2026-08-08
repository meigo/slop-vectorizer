export type Cubic = [number, number, number, number, number, number, number, number]

type V = { x: number; y: number }
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y })
const scale = (a: V, s: number): V => ({ x: a.x * s, y: a.y * s })
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y
const norm = (a: V) => Math.hypot(a.x, a.y)
const normalize = (a: V): V => {
  const l = norm(a)
  return l === 0 ? { x: 0, y: 0 } : scale(a, 1 / l)
}

const bez = (c: V[], t: number): V => {
  const u = 1 - t
  return {
    x: u ** 3 * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t ** 3 * c[3].x,
    y: u ** 3 * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t ** 3 * c[3].y,
  }
}

function chordLengthParams(pts: V[]): number[] {
  const u = [0]
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + norm(sub(pts[i], pts[i - 1])))
  const total = u[u.length - 1] || 1
  return u.map((v) => v / total)
}

function generateBezier(pts: V[], u: number[], tHat1: V, tHat2: V): V[] {
  const n = pts.length
  const first = pts[0],
    last = pts[n - 1]
  let c00 = 0,
    c01 = 0,
    c11 = 0,
    x0 = 0,
    x1 = 0
  for (let i = 0; i < n; i++) {
    const t = u[i],
      v = 1 - t
    const a1 = scale(tHat1, 3 * v * v * t)
    const a2 = scale(tHat2, 3 * v * t * t)
    c00 += dot(a1, a1)
    c01 += dot(a1, a2)
    c11 += dot(a2, a2)
    const tmp = sub(
      pts[i],
      add(scale(first, v ** 3 + 3 * v * v * t), scale(last, t ** 3 + 3 * v * t * t)),
    )
    x0 += dot(a1, tmp)
    x1 += dot(a2, tmp)
  }
  const det = c00 * c11 - c01 * c01
  let alpha1 = det !== 0 ? (x0 * c11 - x1 * c01) / det : 0
  let alpha2 = det !== 0 ? (c00 * x1 - c01 * x0) / det : 0
  const segLen = norm(sub(last, first))
  const eps = 1e-6 * segLen
  if (alpha1 < eps || alpha2 < eps) alpha1 = alpha2 = segLen / 3 // Wu/Barsky heuristic
  return [first, add(first, scale(tHat1, alpha1)), add(last, scale(tHat2, alpha2)), last]
}

function maxError(pts: V[], curve: V[], u: number[]): { err: number; split: number } {
  let err = 0,
    split = pts.length >> 1
  for (let i = 1; i < pts.length - 1; i++) {
    const d = norm(sub(bez(curve, u[i]), pts[i]))
    if (d * d > err) {
      err = d * d
      split = i
    }
  }
  return { err, split }
}

function reparameterize(pts: V[], curve: V[], u: number[]): number[] {
  // one Newton-Raphson step per point
  const d1 = [0, 1, 2].map((i) => scale(sub(curve[i + 1], curve[i]), 3))
  const d2 = [0, 1].map((i) => scale(sub(d1[i + 1], d1[i]), 2))
  const bez2 = (c: V[], t: number): V => {
    const u2 = 1 - t
    return {
      x: u2 * u2 * c[0].x + 2 * u2 * t * c[1].x + t * t * c[2].x,
      y: u2 * u2 * c[0].y + 2 * u2 * t * c[1].y + t * t * c[2].y,
    }
  }
  const bez1 = (c: V[], t: number): V => ({
    x: (1 - t) * c[0].x + t * c[1].x,
    y: (1 - t) * c[0].y + t * c[1].y,
  })
  return u.map((t, i) => {
    const q = sub(bez(curve, t), pts[i])
    const qp = bez2(d1, t),
      qpp = bez1(d2, t)
    const num = dot(q, qp)
    const den = dot(qp, qp) + dot(q, qpp)
    return den === 0 ? t : Math.max(0, Math.min(1, t - num / den))
  })
}

function fitCubic(pts: V[], tHat1: V, tHat2: V, errSq: number, out: Cubic[]): void {
  if (pts.length === 2) {
    const d = norm(sub(pts[1], pts[0])) / 3
    const c = [pts[0], add(pts[0], scale(tHat1, d)), add(pts[1], scale(tHat2, d)), pts[1]]
    out.push([c[0].x, c[0].y, c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y])
    return
  }
  let u = chordLengthParams(pts)
  let curve = generateBezier(pts, u, tHat1, tHat2)
  let { err, split } = maxError(pts, curve, u)
  if (err > errSq) {
    for (let i = 0; i < 4 && err > errSq; i++) {
      // iterate reparameterization
      u = reparameterize(pts, curve, u)
      curve = generateBezier(pts, u, tHat1, tHat2)
      ;({ err, split } = maxError(pts, curve, u))
    }
  }
  if (err <= errSq) {
    out.push([
      curve[0].x,
      curve[0].y,
      curve[1].x,
      curve[1].y,
      curve[2].x,
      curve[2].y,
      curve[3].x,
      curve[3].y,
    ])
    return
  }
  // split at max-error point with a centered tangent
  const centerTangent = normalize(sub(pts[split - 1], pts[split + 1]))
  fitCubic(pts.slice(0, split + 1), tHat1, centerTangent, errSq, out)
  fitCubic(pts.slice(split), scale(centerTangent, -1), tHat2, errSq, out)
}

/** Fit a closed loop. corners: ascending vertex indices to break at (may be empty). */
export function fitLoop(loop: Float64Array, corners: number[], maxErrorPx: number): Cubic[] {
  const n = loop.length / 2
  const p = (i: number): V => ({
    x: loop[2 * (((i % n) + n) % n)],
    y: loop[2 * (((i % n) + n) % n) + 1],
  })
  const breaks = corners.length > 0 ? corners : [0]
  const errSq = maxErrorPx * maxErrorPx
  const out: Cubic[] = []
  for (let b = 0; b < breaks.length; b++) {
    const i0 = breaks[b],
      i1 = breaks[(b + 1) % breaks.length]
    const len = (i1 - i0 + n) % n || n
    const seg: V[] = []
    for (let i = 0; i <= len; i++) seg.push(p(i0 + i))
    // End tangents: one-sided at true corners; central-difference at the artificial
    // break of an all-smooth loop (G1 across the seam).
    let tHat1: V, tHat2: V
    if (corners.length > 0) {
      tHat1 = normalize(sub(seg[1], seg[0]))
      tHat2 = normalize(sub(seg[seg.length - 2], seg[seg.length - 1]))
    } else {
      const t = normalize(sub(p(i0 + 1), p(i0 - 1)))
      tHat1 = t
      tHat2 = scale(t, -1)
    }
    fitCubic(seg, tHat1, tHat2, errSq, out)
  }
  return out
}
