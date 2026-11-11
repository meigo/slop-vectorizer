import type { RasterImage, Palette } from '../../types'

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Pixels are premultiplied RGBA (see alpha.ts): every distance here is over 4 channels. On an
 *  opaque image alpha is 255 everywhere, adds nothing to any distance, and the palette is exactly
 *  the RGB one. */

/** Sample low-gradient (interior) pixels so anti-aliased blends don't become palette entries.
 *  Two passes, counting the flat pixels first and then taking every stride-th: collecting them
 *  all to keep `maxSamples` cost ~0.7 GB and ~0.7 s on a 4096² image. */
function samplePixels(img: RasterImage, maxSamples: number): Float64Array {
  const { width: w, height: h, data } = img
  const diff = (o: number, n: number) =>
    Math.max(
      Math.abs(data[o] - data[n]),
      Math.abs(data[o + 1] - data[n + 1]),
      Math.abs(data[o + 2] - data[n + 2]),
      Math.abs(data[o + 3] - data[n + 3]),
    )
  const isFlat = (o: number) =>
    Math.max(diff(o, o + 4), diff(o, o - 4), diff(o, o + 4 * w), diff(o, o - 4 * w)) < 24
  let n = 0
  for (let y = 1; y < h - 1; y++)
    for (let x = 1, o = (y * w + 1) * 4; x < w - 1; x++, o += 4) if (isFlat(o)) n++
  const out: number[] = []
  const take = (o: number) => out.push(data[o], data[o + 1], data[o + 2], data[o + 3])
  if (n === 0) {
    // Fallback: tiny/noisy image where nothing is flat
    const stride = Math.max(1, Math.floor((w * h) / maxSamples))
    for (let i = 0; i < w * h; i += stride) take(i * 4)
  } else {
    const stride = Math.max(1, Math.floor(n / maxSamples))
    let i = 0
    for (let y = 1; y < h - 1; y++)
      for (let x = 1, o = (y * w + 1) * 4; x < w - 1; x++, o += 4)
        if (isFlat(o) && i++ % stride === 0) take(o)
  }
  return new Float64Array(out)
}

/** Centroids closer than this (RGBA units) describe the same color. */
const DUP_DIST = 4
/** Full-image pixels within this distance (RGBA units) of a re-seed join the sample set. */
const SEED_RADIUS = 24

/** k-means++ init, seeded. */
function seedCenters(samples: Float64Array, k: number, rand: () => number): Float64Array {
  const n = samples.length / 4
  const centers = new Float64Array(k * 4)
  const first = Math.floor(rand() * n)
  centers.set(samples.subarray(first * 4, first * 4 + 4), 0)
  const d2 = new Float64Array(n).fill(Infinity)
  for (let c = 1; c < k; c++) {
    let sum = 0
    for (let i = 0; i < n; i++) {
      const dx = samples[4 * i] - centers[(c - 1) * 4]
      const dy = samples[4 * i + 1] - centers[(c - 1) * 4 + 1]
      const dz = samples[4 * i + 2] - centers[(c - 1) * 4 + 2]
      const dw = samples[4 * i + 3] - centers[(c - 1) * 4 + 3]
      d2[i] = Math.min(d2[i], dx * dx + dy * dy + dz * dz + dw * dw)
      sum += d2[i]
    }
    let target = rand() * sum,
      pick = n - 1
    for (let i = 0; i < n; i++) {
      target -= d2[i]
      if (target <= 0) {
        pick = i
        break
      }
    }
    centers.set(samples.subarray(pick * 4, pick * 4 + 4), c * 4)
  }
  return centers
}

/** Lloyd iterations in place. Returns the last assignment, with its {counts, sse}. */
function lloyd(samples: Float64Array, centers: Float64Array, k: number, iters: number) {
  const n = samples.length / 4
  const assign = new Int32Array(n)
  let counts = new Int32Array(k),
    sse = 0
  for (let iter = 0; iter < iters; iter++) {
    sse = 0
    for (let i = 0; i < n; i++) {
      let best = 0,
        bestD = Infinity
      for (let c = 0; c < k; c++) {
        const dx = samples[4 * i] - centers[4 * c]
        const dy = samples[4 * i + 1] - centers[4 * c + 1]
        const dz = samples[4 * i + 2] - centers[4 * c + 2]
        const dw = samples[4 * i + 3] - centers[4 * c + 3]
        const d = dx * dx + dy * dy + dz * dz + dw * dw
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      assign[i] = best
      sse += bestD
    }
    const sums = new Float64Array(k * 4)
    counts = new Int32Array(k)
    for (let i = 0; i < n; i++) {
      const c = assign[i]
      sums[4 * c] += samples[4 * i]
      sums[4 * c + 1] += samples[4 * i + 1]
      sums[4 * c + 2] += samples[4 * i + 2]
      sums[4 * c + 3] += samples[4 * i + 3]
      counts[c]++
    }
    for (let c = 0; c < k; c++)
      if (counts[c] > 0)
        for (let d = 0; d < 4; d++) centers[4 * c + d] = sums[4 * c + d] / counts[c]
  }
  return { assign, counts, sse }
}

/** Full-image pixel farthest in color from `alive` centers, plus that squared distance. */
function farthestPixel(image: RasterImage, centers: Float64Array, alive: number[]) {
  const { data } = image
  let bestD = -1,
    best = 0
  for (let o = 0; o < data.length; o += 4) {
    let d = Infinity
    for (const c of alive) {
      const dx = data[o] - centers[4 * c],
        dy = data[o + 1] - centers[4 * c + 1],
        dz = data[o + 2] - centers[4 * c + 2],
        dw = data[o + 3] - centers[4 * c + 3]
      d = Math.min(d, dx * dx + dy * dy + dz * dz + dw * dw)
      if (d <= bestD) break
    }
    if (d > bestD) {
      bestD = d
      best = o
    }
  }
  return { color: [data[best], data[best + 1], data[best + 2], data[best + 3]], dist2: bestD }
}

/**
 * True if `color` sits on the segment between two surviving centers, i.e. it is explainable as
 * an anti-aliased blend of colors we already have rather than a color of its own.
 */
function isBlend(color: number[], centers: Float64Array, alive: number[], tol = 8): boolean {
  for (let i = 0; i < alive.length; i++)
    for (let j = i + 1; j < alive.length; j++) {
      const a = 4 * alive[i],
        b = 4 * alive[j]
      let dot = 0,
        len2 = 0
      for (let d = 0; d < 4; d++) {
        const ab = centers[b + d] - centers[a + d]
        dot += (color[d] - centers[a + d]) * ab
        len2 += ab * ab
      }
      const t = len2 > 0 ? Math.max(0, Math.min(1, dot / len2)) : 0
      let d2 = 0
      for (let d = 0; d < 4; d++)
        d2 += (color[d] - (centers[a + d] + t * (centers[b + d] - centers[a + d]))) ** 2
      if (d2 < tol * tol) return true
    }
  return false
}

/** Full-image pixels within `radius` of `color`, strided down to at most `cap`. */
function pixelsNear(
  image: RasterImage,
  color: number[],
  radius: number,
  cap = 20000,
): Float64Array {
  const { data } = image,
    r2 = radius * radius
  const near = (o: number) => {
    const dx = data[o] - color[0],
      dy = data[o + 1] - color[1],
      dz = data[o + 2] - color[2],
      dw = data[o + 3] - color[3]
    return dx * dx + dy * dy + dz * dz + dw * dw <= r2
  }
  let count = 0
  for (let o = 0; o < data.length; o += 4) if (near(o)) count++
  const stride = Math.max(1, Math.ceil(count / cap))
  const out = new Float64Array(Math.ceil(count / stride) * 4)
  let seen = 0,
    w = 0
  for (let o = 0; o < data.length; o += 4)
    if (near(o) && seen++ % stride === 0) {
      out[w++] = data[o]
      out[w++] = data[o + 1]
      out[w++] = data[o + 2]
      out[w++] = data[o + 3]
    }
  return out.subarray(0, w)
}

/**
 * k-means over the low-gradient samples, then repair degenerate clusters: an image whose
 * only foreground is thin strokes has no low-gradient foreground pixels, so every centroid
 * collapses onto the background. Empty and duplicate centroids are re-seeded from the
 * full-image pixel farthest from the survivors, and the pixels around that seed are added
 * to the sample set so the re-seeded cluster has support to converge on.
 */
function fitPalette(image: RasterImage, base: Float64Array, k: number, seed: number) {
  const centers = seedCenters(base, k, mulberry32(seed))
  let samples = base
  let { assign, counts, sse } = lloyd(samples, centers, k, 20)
  for (let pass = 0; pass < 4; pass++) {
    const alive: number[] = [],
      dead: number[] = []
    for (let c = 0; c < k; c++) {
      const dup = alive.some((a) => {
        const dx = centers[4 * a] - centers[4 * c],
          dy = centers[4 * a + 1] - centers[4 * c + 1]
        const dz = centers[4 * a + 2] - centers[4 * c + 2],
          dw = centers[4 * a + 3] - centers[4 * c + 3]
        return dx * dx + dy * dy + dz * dz + dw * dw < DUP_DIST * DUP_DIST
      })
      ;(counts[c] > 0 && !dup ? alive : dead).push(c)
    }
    if (dead.length === 0) break
    const extra: Float64Array[] = []
    for (const c of dead) {
      const { color, dist2 } = farthestPixel(image, centers, alive)
      // Nothing new left in the image, or only anti-aliased blends of what we already have
      if (dist2 < DUP_DIST * DUP_DIST || isBlend(color, centers, alive)) break
      centers.set(color, 4 * c)
      alive.push(c)
      extra.push(pixelsNear(image, color, SEED_RADIUS))
    }
    const added = extra.reduce((a, e) => a + e.length, 0)
    if (added === 0) break
    const merged = new Float64Array(samples.length + added)
    merged.set(samples)
    let at = samples.length
    for (const e of extra) {
      merged.set(e, at)
      at += e.length
    }
    samples = merged
    ;({ assign, counts, sse } = lloyd(samples, centers, k, 10))
  }
  return { centers, sse, n: samples.length / 4, samples, assign }
}

/**
 * Per cluster, the alpha its centroid snaps to: 255 when most of its samples are fully opaque, 0
 * when most are fully transparent, else -1 (keep the mean). A mean lands between the ends
 * whenever a cluster reaches into a soft edge: a solid core came out 91% opaque, and the empty
 * background as a faint film over the whole canvas. On an opaque image every cluster snaps to
 * 255, which it already is.
 */
function alphaSnaps(samples: Float64Array, assign: Int32Array, k: number): Int32Array {
  const total = new Int32Array(k),
    opaque = new Int32Array(k),
    clear = new Int32Array(k)
  for (let i = 0; i < assign.length; i++) {
    const c = assign[i],
      a = samples[4 * i + 3]
    total[c]++
    if (a === 255) opaque[c]++
    else if (a === 0) clear[c]++
  }
  const out = new Int32Array(k)
  for (let c = 0; c < k; c++)
    out[c] = 2 * opaque[c] > total[c] ? 255 : 2 * clear[c] > total[c] ? 0 : -1
  return out
}

export function estimatePalette(image: RasterImage, colorCount: number | 'auto'): Palette {
  const base = samplePixels(image, 50000)
  const toPalette = (k: number, fit: ReturnType<typeof fitPalette>): Palette => {
    // Centroids are premultiplied; the palette is straight RGBA. A centroid's straight colour is
    // its members' alpha-weighted mean, so it stays right when its alpha snaps. A fully
    // transparent entry has no colour of its own and comes out as (0,0,0,0).
    const { centers } = fit
    const snaps = alphaSnaps(fit.samples, fit.assign, k)
    const straight = new Uint8ClampedArray(k * 4)
    for (let c = 0; c < k; c++) {
      const a = snaps[c] >= 0 ? snaps[c] : centers[4 * c + 3]
      const f = a > 0 && centers[4 * c + 3] > 0 ? 255 / centers[4 * c + 3] : 0
      for (let d = 0; d < 3; d++) straight[4 * c + d] = centers[4 * c + d] * f
      straight[4 * c + 3] = a
    }
    // Sort by luminance for stable ordering, on the rounded colours (one colour's bands differ
    // in the last float digits); bands of one colour most opaque first
    const lum = (c: number) => straight[4 * c] * 3 + straight[4 * c + 1] * 6 + straight[4 * c + 2]
    const order = [...Array(k).keys()].sort(
      (a, b) => lum(a) - lum(b) || straight[4 * b + 3] - straight[4 * a + 3],
    )
    const colors = new Uint8ClampedArray(k * 4)
    order.forEach((c, i) => colors.set(straight.subarray(4 * c, 4 * c + 4), i * 4))
    return { k, colors }
  }
  if (colorCount !== 'auto') {
    const k = Math.max(2, Math.min(16, colorCount))
    return toPalette(k, fitPalette(image, base, k, 12345))
  }
  // Auto-k: smallest k whose RMS per-pixel distance is below threshold (flat art hits ~0 at true k)
  for (let k = 2; k <= 16; k++) {
    const fit = fitPalette(image, base, k, 12345)
    if (Math.sqrt(fit.sse / fit.n) < 8) return toPalette(k, fit)
  }
  return toPalette(16, fitPalette(image, base, 16, 12345))
}
