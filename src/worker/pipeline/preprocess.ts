import type { RasterImage } from '../../types'

export interface PreOptions {
  blackPoint: number
  whitePoint: number
  blurRadius: number
  saturation: number
  flatten: number
}

export const IDENTITY_PRE: PreOptions = {
  blackPoint: 0,
  whitePoint: 255,
  blurRadius: 0,
  saturation: 1,
  flatten: 0,
}

export function isIdentityPre(o: PreOptions): boolean {
  return (
    o.blackPoint === 0 &&
    o.whitePoint === 255 &&
    o.blurRadius === 0 &&
    o.saturation === 1 &&
    o.flatten === 0
  )
}

const clampi = (i: number, n: number) => (i < 0 ? 0 : i >= n ? n - 1 : i)

/** One 2-D box pass (horizontal then vertical sliding window), RGB channels, edge-clamped. */
function boxBlurPass(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(new ArrayBuffer(src.length * 4))
  const out = new Float32Array(new ArrayBuffer(src.length * 4))
  const norm = 1 / (2 * r + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let c = 0; c < 3; c++) {
      let sum = 0
      for (let x = -r; x <= r; x++) sum += src[(row + clampi(x, w)) * 4 + c]
      for (let x = 0; x < w; x++) {
        tmp[(row + x) * 4 + c] = sum * norm
        sum += src[(row + clampi(x + r + 1, w)) * 4 + c] - src[(row + clampi(x - r, w)) * 4 + c]
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0
      for (let y = -r; y <= r; y++) sum += tmp[(clampi(y, h) * w + x) * 4 + c]
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 4 + c] = sum * norm
        sum += tmp[(clampi(y + r + 1, h) * w + x) * 4 + c] - tmp[(clampi(y - r, h) * w + x) * 4 + c]
      }
    }
  }
  return out
}

// --- Illumination flattening ---------------------------------------------------
//
// A photographed drawing is reflectance x illumination(x,y). Uneven lighting slides
// the paper's luminance around the sheet, and where it drifts close to a lighter
// palette colour the paper's grain straddles the quantizer boundary and breaks into
// blotches. No value-only control can fix that: levels, gamma and saturation all map
// a pixel by its value alone, so paper at 108 in one corner and paper at 177 in
// another cannot be pulled together without also crushing everything that legitimately
// sits between them. Dividing the illumination back out can, because it is the only
// correction here that knows *where* the pixel is.
//
// The field is a bi-quadratic surface (6 coefficients) fitted to a coarse grid of
// cell luminances. Two things decide whether it works:
//
//   - What counts as "the paper here". The subject is not reliably the darkest or the
//     lightest thing in a cell — this artwork has black ink *and* near-white faces on
//     mid-grey paper — so no fixed percentile finds the paper: a low one tracks the
//     ink, a high one tracks the faces, and both compress the fitted surface toward
//     flat. Instead each cell is measured inside a window around the current surface
//     estimate, which starts at the image's dominant tone and tightens over a few
//     passes. Ink and faces fall outside the window and simply stop voting.
//   - Stiffness. A blur or a fine local grid would happily bend around a large bright
//     area and darken it to paper level; 6 coefficients cannot, so the faces survive.

const FLATTEN_GRID = 32 // cells per axis (fewer on small images)
const FLATTEN_BASIS = 6
// Half-width, in levels, of the band of cell modes accepted as paper on each pass.
// The first is centred on the median cell mode, the rest on the previous surface.
const FLATTEN_WINDOWS = [40, 30, 25, 25]

const basisAt = (u: number, v: number, out: number[]) => {
  out[0] = 1
  out[1] = u
  out[2] = v
  out[3] = u * u
  out[4] = u * v
  out[5] = v * v
}

/** Gaussian elimination with partial pivoting; null when singular. Mutates a and b. */
function solveSym(a: number[][], b: number[], n: number): number[] | null {
  for (let i = 0; i < n; i++) {
    let p = i
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r
    if (Math.abs(a[p][i]) < 1e-9) return null
    ;[a[i], a[p]] = [a[p], a[i]]
    ;[b[i], b[p]] = [b[p], b[i]]
    for (let r = i + 1; r < n; r++) {
      const f = a[r][i] / a[i][i]
      for (let c = i; c < n; c++) a[r][c] -= f * a[i][c]
      b[r] -= f * b[i]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]
    for (let c = i + 1; c < n; c++) s -= a[i][c] * x[c]
    x[i] = s / a[i][i]
  }
  return x
}

const median = (v: number[]): number => {
  const s = [...v].sort((p, q) => p - q)
  return s.length === 0 ? 0 : s[s.length >> 1]
}

const evalSurface = (coef: number[], u: number, v: number, f: number[]) => {
  basisAt(u, v, f)
  let s = 0
  for (let k = 0; k < FLATTEN_BASIS; k++) s += f[k] * coef[k]
  return s
}

/**
 * Fit the illumination surface. Returns its 6 coefficients over normalized coords
 * u = x/w - 0.5, v = y/h - 0.5, or null when the image is too small or degenerate
 * to fit (caller then leaves the pixels alone).
 */
function fitIllumination(src: Float32Array, w: number, h: number): number[] | null {
  const g = Math.max(4, Math.min(FLATTEN_GRID, Math.floor(Math.min(w, h) / 8)))
  const cells = g * g
  if (cells < 3 * FLATTEN_BASIS) return null
  // One 256-bin histogram per cell, built once. Every later pass re-measures each cell
  // inside a different window by walking its bins, so the pixels are only read once.
  const hist = new Int32Array(cells * 256)
  const count = new Int32Array(cells)
  for (let y = 0; y < h; y++) {
    const cy = Math.min(g - 1, Math.floor((y * g) / h))
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      const lum = 0.2126 * src[p] + 0.7152 * src[p + 1] + 0.0722 * src[p + 2]
      const c = cy * g + Math.min(g - 1, Math.floor((x * g) / w))
      hist[c * 256 + (lum < 0 ? 0 : lum > 255 ? 255 : Math.round(lum))]++
      count[c]++
    }
  }
  // Per-cell mode: the most common tone inside the cell. Paper is the plurality of
  // almost every cell, so this finds it without needing to know its level in advance —
  // which matters because the illumination swing here is wider than the gap between
  // the paper and the next palette colour, so no global value window could separate
  // them. Cells that really are mostly ink or mostly subject come out as outliers and
  // are rejected below.
  const us: number[] = [],
    vs: number[] = [],
    ys: number[] = []
  for (let cy = 0; cy < g; cy++)
    for (let cx = 0; cx < g; cx++) {
      const c = cy * g + cx
      if (count[c] === 0) continue
      let mode = 0,
        best = -1
      for (let b = 0; b < 256; b++) {
        let s = 0
        for (let k = -2; k <= 2; k++) {
          const j = b + k
          if (j >= 0 && j < 256) s += hist[c * 256 + j]
        }
        if (s > best) {
          best = s
          mode = b
        }
      }
      us.push((cx + 0.5) / g - 0.5)
      vs.push((cy + 0.5) / g - 0.5)
      ys.push(mode)
    }
  const f = new Array<number>(FLATTEN_BASIS)
  // Which cells are paper? Their modes are trimodal here — ink near 25, paper 125-175,
  // faces 195-220 — so plain outlier rejection fails: at ~50% contamination the MAD is
  // enormous and rejects nothing, and ink cells then drag the surface down until the
  // correction amplifies that corner instead of darkening it. The median cell mode does
  // land on the paper though (paper is the plurality), so the first pass selects around
  // that, and later passes re-select around the fitted surface, which lets the accepted
  // band follow an illumination swing wider than the window itself.
  let centre: number[] = ys.map(() => median(ys))
  let coef: number[] | null = null
  for (let pass = 0; pass < FLATTEN_WINDOWS.length; pass++) {
    const win = FLATTEN_WINDOWS[pass]
    const a = Array.from({ length: FLATTEN_BASIS }, () => new Array<number>(FLATTEN_BASIS).fill(0))
    const rhs = new Array<number>(FLATTEN_BASIS).fill(0)
    let used = 0
    for (let i = 0; i < ys.length; i++) {
      if (Math.abs(ys[i] - centre[i]) > win) continue
      used++
      basisAt(us[i], vs[i], f)
      for (let r = 0; r < FLATTEN_BASIS; r++) {
        for (let k = 0; k < FLATTEN_BASIS; k++) a[r][k] += f[r] * f[k]
        rhs[r] += f[r] * ys[i]
      }
    }
    if (used < 3 * FLATTEN_BASIS) return null
    coef = solveSym(a, rhs, FLATTEN_BASIS)
    if (!coef) return null
    centre = ys.map((_, i) => evalSurface(coef!, us[i], vs[i], f))
  }
  return coef
}

/** Divide out the fitted illumination, in place. strength 0 = off, 1 = full. */
function flattenIllumination(src: Float32Array, w: number, h: number, strength: number): void {
  const coef = fitIllumination(src, w, h)
  if (!coef) return
  const f = new Array<number>(FLATTEN_BASIS)
  const at = (u: number, v: number) => {
    basisAt(u, v, f)
    let s = 0
    for (let k = 0; k < FLATTEN_BASIS; k++) s += f[k] * coef[k]
    return s
  }
  // Reference level: the surface's own median over the sheet, so overall exposure
  // is preserved and only the variation across it is removed.
  const probe: number[] = []
  for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) probe.push(at(i / 8 - 0.5, j / 8 - 0.5))
  const mid = median(probe)
  if (mid <= 1) return
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h - 0.5
    for (let x = 0; x < w; x++) {
      const l = at((x + 0.5) / w - 0.5, v)
      const eff = mid + (l - mid) * strength
      const k = eff <= 1 ? 4 : Math.min(4, Math.max(0.25, mid / eff))
      const p = (y * w + x) * 4
      src[p] *= k
      src[p + 1] *= k
      src[p + 2] *= k
    }
  }
}

/**
 * Apply levels, blur, and saturation adjustments. Aggressive blackPoint/whitePoint levels clip anti-aliased
 * edge gradients toward binary coverage, which degrades downstream sub-pixel boundary refinement toward pixel-grid accuracy.
 */
/**
 * Odd box widths whose composed passes best approximate a Gaussian of the given
 * sigma (standard boxes-for-Gaussian). Fractional sigmas shift the widths at
 * sub-integer increments, making the blur slider effectively continuous.
 */
function boxesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1)
  let wl = Math.floor(wIdeal)
  if (wl % 2 === 0) wl--
  wl = Math.max(1, wl)
  const wu = wl + 2
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)
  const m = Math.min(n, Math.max(0, Math.round(mIdeal)))
  const widths = Array.from({ length: n }, (_, i) => (i < m ? wl : wu))
  // A nonzero blur setting must blur: if sigma rounds every pass to identity
  // (all widths 1, i.e. wl === 1 chosen for every pass), force one minimal real pass.
  if (wl === 1 && m === n) widths[n - 1] = 3
  return widths
}

export function preprocess(image: RasterImage, opts: PreOptions): RasterImage {
  if (isIdentityPre(opts)) return image
  const { width: w, height: h } = image
  const data = new Float32Array(w * h * 4)
  for (let i = 0; i < image.data.length; i++) data[i] = image.data[i]
  let working: Float32Array = data
  // Before blur and levels: those read the corrected tones, and the fit wants the
  // raw grain rather than a blurred version of it.
  if (opts.flatten > 0) flattenIllumination(working, w, h, opts.flatten)
  if (opts.blurRadius > 0) {
    for (const width of boxesForGauss(opts.blurRadius, 3)) {
      const r = (width - 1) / 2
      if (r > 0) working = boxBlurPass(working, w, h, r)
    }
  }
  const black = opts.blackPoint
  const white = Math.max(opts.whitePoint, black + 1)
  const scale = 255 / (white - black)
  const sat = opts.saturation
  const out = new Uint8ClampedArray(working.length)
  for (let p = 0; p < working.length; p += 4) {
    let r = working[p],
      g = working[p + 1],
      b = working[p + 2]
    if (sat !== 1) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      r = lum + (r - lum) * sat
      g = lum + (g - lum) * sat
      b = lum + (b - lum) * sat
    }
    out[p] = (r - black) * scale // Uint8ClampedArray clamps + rounds
    out[p + 1] = (g - black) * scale
    out[p + 2] = (b - black) * scale
    out[p + 3] = 255
  }
  return { width: w, height: h, data: out }
}
