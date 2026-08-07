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
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        const n = idx(nx, ny)
        g = Math.max(g,
          Math.abs(data[o] - data[n]),
          Math.abs(data[o + 1] - data[n + 1]),
          Math.abs(data[o + 2] - data[n + 2]))
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

/** k-means with k-means++ init, seeded. Returns {centers, sse}. */
function kmeans(samples: Float64Array, k: number, seed: number) {
  const n = samples.length / 3
  const rand = mulberry32(seed)
  const centers = new Float64Array(k * 3)
  // k-means++ init
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
    let target = rand() * sum, pick = n - 1
    for (let i = 0; i < n; i++) { target -= d2[i]; if (target <= 0) { pick = i; break } }
    centers.set(samples.subarray(pick * 3, pick * 3 + 3), c * 3)
  }
  const assign = new Int32Array(n)
  let sse = 0
  for (let iter = 0; iter < 20; iter++) {
    sse = 0
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity
      for (let c = 0; c < k; c++) {
        const dx = samples[3 * i] - centers[3 * c]
        const dy = samples[3 * i + 1] - centers[3 * c + 1]
        const dz = samples[3 * i + 2] - centers[3 * c + 2]
        const d = dx * dx + dy * dy + dz * dz
        if (d < bestD) { bestD = d; best = c }
      }
      assign[i] = best; sse += bestD
    }
    const sums = new Float64Array(k * 3), counts = new Int32Array(k)
    for (let i = 0; i < n; i++) {
      const c = assign[i]
      sums[3 * c] += samples[3 * i]; sums[3 * c + 1] += samples[3 * i + 1]; sums[3 * c + 2] += samples[3 * i + 2]
      counts[c]++
    }
    for (let c = 0; c < k; c++)
      if (counts[c] > 0)
        for (let d = 0; d < 3; d++) centers[3 * c + d] = sums[3 * c + d] / counts[c]
  }
  return { centers, sse }
}

export function estimatePalette(image: RasterImage, colorCount: number | 'auto'): Palette {
  const samples = samplePixels(image, 50000)
  const n = samples.length / 3
  const build = (k: number): Palette => {
    const { centers } = kmeans(samples, k, 12345)
    // Sort by luminance for stable ordering
    const order = [...Array(k).keys()].sort((a, b) =>
      (centers[3 * a] * 3 + centers[3 * a + 1] * 6 + centers[3 * a + 2]) -
      (centers[3 * b] * 3 + centers[3 * b + 1] * 6 + centers[3 * b + 2]))
    const colors = new Uint8ClampedArray(k * 3)
    order.forEach((c, i) => colors.set([centers[3 * c], centers[3 * c + 1], centers[3 * c + 2]], i * 3))
    return { k, colors }
  }
  if (colorCount !== 'auto') return build(Math.max(2, Math.min(16, colorCount)))
  // Auto-k: smallest k whose RMS per-pixel distance is below threshold (flat art hits ~0 at true k)
  for (let k = 2; k <= 16; k++) {
    const { sse } = kmeans(samples, k, 12345)
    if (Math.sqrt(sse / n) < 8) return build(k)
  }
  return build(16)
}
