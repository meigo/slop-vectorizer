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

/** Sample low-gradient (interior) pixels so anti-aliased blends don't become palette entries. */
function samplePixels(img: RasterImage, maxSamples: number): Float64Array {
  const { width: w, height: h, data } = img
  const idx = (x: number, y: number) => (y * w + x) * 4
  const flat: number[] = []
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const o = idx(x, y)
      let g = 0
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ] as const) {
        const n = idx(nx, ny)
        g = Math.max(
          g,
          Math.abs(data[o] - data[n]),
          Math.abs(data[o + 1] - data[n + 1]),
          Math.abs(data[o + 2] - data[n + 2]),
        )
      }
      if (g < 24) flat.push(data[o], data[o + 1], data[o + 2])
    }
  }
  // Fallback: tiny/noisy image where nothing is flat
  if (flat.length === 0)
    for (let o = 0; o < data.length; o += 4) flat.push(data[o], data[o + 1], data[o + 2])
  const n = flat.length / 3
  const stride = Math.max(1, Math.floor(n / maxSamples))
  const out: number[] = []
  for (let i = 0; i < n; i += stride) out.push(flat[3 * i], flat[3 * i + 1], flat[3 * i + 2])
  return new Float64Array(out)
}

/** Centroids closer than this (RGB units) describe the same color. */
const DUP_DIST = 4
/** Full-image pixels within this distance (RGB units) of a re-seed join the sample set. */
const SEED_RADIUS = 24

/** k-means++ init, seeded. */
function seedCenters(samples: Float64Array, k: number, rand: () => number): Float64Array {
  const n = samples.length / 3
  const centers = new Float64Array(k * 3)
  const first = Math.floor(rand() * n)
  centers.set(samples.subarray(first * 3, first * 3 + 3), 0)
  const d2 = new Float64Array(n).fill(Infinity)
  for (let c = 1; c < k; c++) {
    let sum = 0
    for (let i = 0; i < n; i++) {
      const dx = samples[3 * i] - centers[(c - 1) * 3]
      const dy = samples[3 * i + 1] - centers[(c - 1) * 3 + 1]
      const dz = samples[3 * i + 2] - centers[(c - 1) * 3 + 2]
      d2[i] = Math.min(d2[i], dx * dx + dy * dy + dz * dz)
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
    centers.set(samples.subarray(pick * 3, pick * 3 + 3), c * 3)
  }
  return centers
}

/** Lloyd iterations in place. Returns the last assignment's {counts, sse}. */
function lloyd(samples: Float64Array, centers: Float64Array, k: number, iters: number) {
  const n = samples.length / 3
  const assign = new Int32Array(n)
  let counts = new Int32Array(k),
    sse = 0
  for (let iter = 0; iter < iters; iter++) {
    sse = 0
    for (let i = 0; i < n; i++) {
      let best = 0,
        bestD = Infinity
      for (let c = 0; c < k; c++) {
        const dx = samples[3 * i] - centers[3 * c]
        const dy = samples[3 * i + 1] - centers[3 * c + 1]
        const dz = samples[3 * i + 2] - centers[3 * c + 2]
        const d = dx * dx + dy * dy + dz * dz
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      assign[i] = best
      sse += bestD
    }
    const sums = new Float64Array(k * 3)
    counts = new Int32Array(k)
    for (let i = 0; i < n; i++) {
      const c = assign[i]
      sums[3 * c] += samples[3 * i]
      sums[3 * c + 1] += samples[3 * i + 1]
      sums[3 * c + 2] += samples[3 * i + 2]
      counts[c]++
    }
    for (let c = 0; c < k; c++)
      if (counts[c] > 0)
        for (let d = 0; d < 3; d++) centers[3 * c + d] = sums[3 * c + d] / counts[c]
  }
  return { counts, sse }
}

/** Full-image pixel farthest in color from `alive` centers, plus that squared distance. */
function farthestPixel(image: RasterImage, centers: Float64Array, alive: number[]) {
  const { data } = image
  let bestD = -1,
    best = 0
  for (let o = 0; o < data.length; o += 4) {
    let d = Infinity
    for (const c of alive) {
      const dx = data[o] - centers[3 * c],
        dy = data[o + 1] - centers[3 * c + 1],
        dz = data[o + 2] - centers[3 * c + 2]
      d = Math.min(d, dx * dx + dy * dy + dz * dz)
      if (d <= bestD) break
    }
    if (d > bestD) {
      bestD = d
      best = o
    }
  }
  return { color: [data[best], data[best + 1], data[best + 2]], dist2: bestD }
}

/**
 * True if `color` sits on the segment between two surviving centers, i.e. it is explainable as
 * an anti-aliased blend of colors we already have rather than a color of its own.
 */
function isBlend(color: number[], centers: Float64Array, alive: number[], tol = 8): boolean {
  for (let i = 0; i < alive.length; i++)
    for (let j = i + 1; j < alive.length; j++) {
      const a = 3 * alive[i],
        b = 3 * alive[j]
      let dot = 0,
        len2 = 0
      for (let d = 0; d < 3; d++) {
        const ab = centers[b + d] - centers[a + d]
        dot += (color[d] - centers[a + d]) * ab
        len2 += ab * ab
      }
      const t = len2 > 0 ? Math.max(0, Math.min(1, dot / len2)) : 0
      let d2 = 0
      for (let d = 0; d < 3; d++)
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
      dz = data[o + 2] - color[2]
    return dx * dx + dy * dy + dz * dz <= r2
  }
  let count = 0
  for (let o = 0; o < data.length; o += 4) if (near(o)) count++
  const stride = Math.max(1, Math.ceil(count / cap))
  const out = new Float64Array(Math.ceil(count / stride) * 3)
  let seen = 0,
    w = 0
  for (let o = 0; o < data.length; o += 4)
    if (near(o) && seen++ % stride === 0) {
      out[w++] = data[o]
      out[w++] = data[o + 1]
      out[w++] = data[o + 2]
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
  let { counts, sse } = lloyd(samples, centers, k, 20)
  for (let pass = 0; pass < 4; pass++) {
    const alive: number[] = [],
      dead: number[] = []
    for (let c = 0; c < k; c++) {
      const dup = alive.some((a) => {
        const dx = centers[3 * a] - centers[3 * c],
          dy = centers[3 * a + 1] - centers[3 * c + 1]
        const dz = centers[3 * a + 2] - centers[3 * c + 2]
        return dx * dx + dy * dy + dz * dz < DUP_DIST * DUP_DIST
      })
      ;(counts[c] > 0 && !dup ? alive : dead).push(c)
    }
    if (dead.length === 0) break
    const extra: Float64Array[] = []
    for (const c of dead) {
      const { color, dist2 } = farthestPixel(image, centers, alive)
      // Nothing new left in the image, or only anti-aliased blends of what we already have
      if (dist2 < DUP_DIST * DUP_DIST || isBlend(color, centers, alive)) break
      centers.set(color, 3 * c)
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
    ;({ counts, sse } = lloyd(samples, centers, k, 10))
  }
  return { centers, sse, n: samples.length / 3 }
}

export function estimatePalette(image: RasterImage, colorCount: number | 'auto'): Palette {
  const base = samplePixels(image, 50000)
  const toPalette = (k: number, centers: Float64Array): Palette => {
    // Sort by luminance for stable ordering
    const order = [...Array(k).keys()].sort(
      (a, b) =>
        centers[3 * a] * 3 +
        centers[3 * a + 1] * 6 +
        centers[3 * a + 2] -
        (centers[3 * b] * 3 + centers[3 * b + 1] * 6 + centers[3 * b + 2]),
    )
    const colors = new Uint8ClampedArray(k * 3)
    order.forEach((c, i) =>
      colors.set([centers[3 * c], centers[3 * c + 1], centers[3 * c + 2]], i * 3),
    )
    return { k, colors }
  }
  if (colorCount !== 'auto') {
    const k = Math.max(2, Math.min(16, colorCount))
    return toPalette(k, fitPalette(image, base, k, 12345).centers)
  }
  // Auto-k: smallest k whose RMS per-pixel distance is below threshold (flat art hits ~0 at true k)
  for (let k = 2; k <= 16; k++) {
    const { centers, sse, n } = fitPalette(image, base, k, 12345)
    if (Math.sqrt(sse / n) < 8) return toPalette(k, centers)
  }
  return toPalette(16, fitPalette(image, base, 16, 12345).centers)
}
