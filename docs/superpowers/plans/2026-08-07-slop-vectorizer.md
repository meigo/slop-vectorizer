# slop-vectorizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client-side Svelte web app that vectorizes anti-aliased logos/flat art into SVG with sub-pixel-accurate edges, per the spec at `docs/superpowers/specs/2026-08-07-slop-vectorizer-design.md`.

**Architecture:** Pure-TS pipeline (palette → segment → boundaries → corners → Bézier fit → SVG) running in a Web Worker; Svelte UI with dropzone, synced compare view, and controls. Pipeline modules are pure functions over typed arrays — no DOM — so all algorithm tests run in Node via vitest.

**Tech Stack:** Svelte 5, Vite, TypeScript (strict), Vitest. No runtime dependencies beyond Svelte.

## Global Constraints

- All pipeline code lives in `src/worker/pipeline/` and MUST NOT import Svelte or touch DOM/browser globals (`document`, `window`, `Image`, `OffscreenCanvas`).
- Determinism: no `Math.random()` — use the seeded PRNG defined in Task 3. Same input + options ⇒ byte-identical SVG.
- TypeScript strict mode on. No `any` in pipeline code.
- Coordinates: pixel (i, j) covers the unit square [i, i+1] × [j, j+1]; its center is (i + 0.5, j + 0.5). Lattice vertices are integers. All boundary geometry uses this convention.
- Loops are `Float64Array` of interleaved x,y pairs, implicitly closed (last point connects to first). Never duplicate the first point at the end.
- Palette colors are RGB (alpha ignored; input is composited opaque).
- Commit after every task (conventional commits: `feat:`, `test:`, `chore:`).

## File Structure

| File | Responsibility |
|---|---|
| `src/types.ts` | Shared types: RasterImage, PipelineOptions, Palette, Segmentation, results, worker messages |
| `src/worker/pipeline/palette.ts` | k-means palette estimation with auto-k |
| `src/worker/pipeline/segment.ts` | Per-pixel labeling, connected components, despeckle |
| `src/worker/pipeline/boundaries.ts` | Boundary loop tracing + sub-pixel refinement |
| `src/worker/pipeline/corners.ts` | Corner vs smooth vertex classification |
| `src/worker/pipeline/fitcurves.ts` | Piecewise cubic Bézier fitting (Schneider) |
| `src/worker/pipeline/svg.ts` | Path assembly, paint ordering, serialization |
| `src/worker/pipeline/index.ts` | `vectorize()` orchestrator with timings/progress |
| `src/worker/vectorize.worker.ts` | Worker message handler + stage caching for re-runs |
| `src/lib/workerClient.ts` | Promise wrapper around the worker, cancel = terminate+respawn |
| `src/lib/decode.ts` | File → RasterImage, 4096px clamp |
| `src/lib/Dropzone.svelte` | Drag/drop + paste input |
| `src/lib/CompareView.svelte` | Shared zoom/pan bitmap-vs-SVG with divider slider |
| `src/lib/Controls.svelte` | Color count, smoothness, despeckle, download, stats |
| `src/App.svelte` | Layout + state wiring |
| `tests/helpers/render.ts` | Supersampled analytic rasterizer for ground-truth tests |
| `tests/*.test.ts` | Per-stage unit tests + round-trip e2e |

---

### Task 1: Project scaffold

**Files:**
- Create: Vite Svelte-TS scaffold at repo root (`package.json`, `vite.config.ts`, `svelte.config.js`, `tsconfig.json`, `index.html`, `src/App.svelte`, `src/main.ts`)
- Create: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a repo where `npm run dev`, `npm run build`, and `npx vitest run` all work.

- [ ] **Step 1: Scaffold Vite + Svelte + TS**

```bash
cd /Users/meigo/Projects/slop/slop-vectorizer
npm create vite@latest . -- --template svelte-ts
npm install
npm install -D vitest
```

If `npm create vite` refuses a non-empty dir, scaffold into `/private/tmp/claude-501/-Users-meigo/276fbe1d-0ea8-4823-ab17-3c9e53e573c0/scratchpad/sv-scaffold` and copy everything except `.git` into the repo root.

- [ ] **Step 2: Enable strict TS and vitest**

In `tsconfig.json` (or `tsconfig.app.json` if the template split it) ensure `"strict": true`. Append to `vite.config.ts`:

```ts
// vite.config.ts — add test block
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  test: { include: ['tests/**/*.test.ts'] },
})
```

(If TS complains about the `test` key, add `/// <reference types="vitest/config" />` at the top.)

- [ ] **Step 3: Write smoke test**

```ts
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs typed-array code', () => {
    const a = new Float64Array([1, 2, 3])
    expect(a.reduce((s, v) => s + v, 0)).toBe(6)
  })
})
```

- [ ] **Step 4: Verify**

Run: `npx vitest run` → 1 passing. Run: `npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold vite+svelte+ts with vitest"
```

---

### Task 2: Shared types + synthetic rasterizer test helper

**Files:**
- Create: `src/types.ts`, `tests/helpers/render.ts`
- Test: `tests/render.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces (used by every later task):

```ts
// src/types.ts — exact contents
export interface RasterImage {
  width: number
  height: number
  data: Uint8ClampedArray // RGBA, length = width*height*4
}

export interface PipelineOptions {
  colorCount: number | 'auto' // 2..16 when numeric
  smoothness: number          // 0..1; scales Bézier fit tolerance
  despeckleSize: number       // regions smaller than this (px) get merged
}

export const DEFAULT_OPTIONS: PipelineOptions = {
  colorCount: 'auto',
  smoothness: 0.5,
  despeckleSize: 4,
}

export interface Palette {
  k: number
  colors: Uint8ClampedArray // k*3 RGB
}

export interface Segmentation {
  labelMap: Int32Array    // width*height, pixel -> region id (0..regionCount-1)
  regionColor: Int32Array // region id -> palette index
  regionSize: Int32Array  // region id -> pixel count
  regionCount: number
}

export interface RegionLoops {
  region: number
  loops: Float64Array[] // interleaved x,y; implicitly closed
}

export type StageName = 'palette' | 'segment' | 'boundaries' | 'corners' | 'fit' | 'svg'

export interface PipelineStats {
  pathCount: number
  pointCount: number
  timings: Partial<Record<StageName, number>> // ms
}

export interface VectorResult {
  svg: string
  stats: PipelineStats
}

// Worker protocol
export type WorkerRequest =
  | { type: 'vectorize'; image: RasterImage; options: PipelineOptions; jobId: number }

export type WorkerResponse =
  | { type: 'progress'; jobId: number; stage: StageName }
  | { type: 'result'; jobId: number; result: VectorResult }
  | { type: 'error'; jobId: number; stage: StageName | 'unknown'; message: string }
```

```ts
// tests/helpers/render.ts — exact API
export function renderShape(
  width: number, height: number,
  inside: (x: number, y: number) => boolean,
  fg: [number, number, number], bg: [number, number, number],
  supersample?: number, // default 8
): RasterImage
export function insideCircle(cx: number, cy: number, r: number): (x: number, y: number) => boolean
export function insideRotSquare(cx: number, cy: number, half: number, angleRad: number): (x: number, y: number) => boolean
```

- [ ] **Step 1: Write failing test**

```ts
// tests/render.test.ts
import { describe, it, expect } from 'vitest'
import { renderShape, insideCircle } from './helpers/render'

describe('renderShape', () => {
  it('antialiases edges: interior pure fg, exterior pure bg, edge blended', () => {
    const img = renderShape(64, 64, insideCircle(32, 32, 20), [255, 0, 0], [255, 255, 255])
    const px = (x: number, y: number) => img.data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)
    expect([...px(32, 32)]).toEqual([255, 0, 0])   // center
    expect([...px(1, 1)]).toEqual([255, 255, 255]) // far corner
    // pixel straddling the edge at (52, 32): red channel stays 255, g/b strictly between
    const edge = px(51, 32)
    expect(edge[1]).toBeGreaterThan(0)
    expect(edge[1]).toBeLessThan(255)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/render.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/types.ts` (verbatim from Interfaces above) and the helper**

```ts
// tests/helpers/render.ts
import type { RasterImage } from '../../src/types'

export function renderShape(
  width: number, height: number,
  inside: (x: number, y: number) => boolean,
  fg: [number, number, number], bg: [number, number, number],
  supersample = 8,
): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4)
  const ss = supersample, inv = 1 / (ss * ss)
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      let cov = 0
      for (let sj = 0; sj < ss; sj++)
        for (let si = 0; si < ss; si++)
          if (inside(i + (si + 0.5) / ss, j + (sj + 0.5) / ss)) cov++
      const a = cov * inv, o = (j * width + i) * 4
      data[o] = fg[0] * a + bg[0] * (1 - a)
      data[o + 1] = fg[1] * a + bg[1] * (1 - a)
      data[o + 2] = fg[2] * a + bg[2] * (1 - a)
      data[o + 3] = 255
    }
  }
  return { width, height, data }
}

export function insideCircle(cx: number, cy: number, r: number) {
  return (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

export function insideRotSquare(cx: number, cy: number, half: number, angleRad: number) {
  const c = Math.cos(-angleRad), s = Math.sin(-angleRad)
  return (x: number, y: number) => {
    const dx = x - cx, dy = y - cy
    return Math.abs(dx * c - dy * s) <= half && Math.abs(dx * s + dy * c) <= half
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run tests/render.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: shared types and supersampled test rasterizer"`

---

### Task 3: Palette estimation

**Files:**
- Create: `src/worker/pipeline/palette.ts`
- Test: `tests/palette.test.ts`

**Interfaces:**
- Consumes: `RasterImage`, `Palette` from `src/types.ts`.
- Produces: `estimatePalette(image: RasterImage, colorCount: number | 'auto'): Palette`. Also exports `mulberry32(seed: number): () => number` (reused nowhere else, but defined here).

- [ ] **Step 1: Write failing tests**

```ts
// tests/palette.test.ts
import { describe, it, expect } from 'vitest'
import { estimatePalette } from '../src/worker/pipeline/palette'
import { renderShape, insideCircle } from './helpers/render'

const nearest = (p: Uint8ClampedArray, c: number[]) => {
  let best = Infinity
  for (let i = 0; i < p.length; i += 3)
    best = Math.min(best, Math.hypot(p[i] - c[0], p[i + 1] - c[1], p[i + 2] - c[2]))
  return best
}

describe('estimatePalette', () => {
  const img = renderShape(64, 64, insideCircle(32, 32, 20), [200, 30, 30], [245, 245, 245])

  it('auto mode finds k=2 for a two-color image', () => {
    const pal = estimatePalette(img, 'auto')
    expect(pal.k).toBe(2)
  })

  it('recovers both colors within tolerance, no invented edge colors', () => {
    const pal = estimatePalette(img, 2)
    expect(nearest(pal.colors, [200, 30, 30])).toBeLessThan(10)
    expect(nearest(pal.colors, [245, 245, 245])).toBeLessThan(10)
  })

  it('is deterministic', () => {
    const a = estimatePalette(img, 'auto'), b = estimatePalette(img, 'auto')
    expect([...a.colors]).toEqual([...b.colors])
  })
})
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/palette.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/worker/pipeline/palette.ts
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
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/palette.test.ts` → PASS. If auto-k overshoots (finds 3), the gradient threshold (24) or RMS threshold (8) needs tuning — adjust, don't delete the test.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: k-means palette estimation with auto-k and interior sampling"`

---

### Task 4: Segmentation + despeckle

**Files:**
- Create: `src/worker/pipeline/segment.ts`
- Test: `tests/segment.test.ts`

**Interfaces:**
- Consumes: `estimatePalette` output; types.
- Produces: `segmentImage(image: RasterImage, palette: Palette, despeckleSize: number): Segmentation`

- [ ] **Step 1: Write failing tests**

```ts
// tests/segment.test.ts
import { describe, it, expect } from 'vitest'
import { estimatePalette } from '../src/worker/pipeline/palette'
import { segmentImage } from '../src/worker/pipeline/segment'
import { renderShape, insideCircle } from './helpers/render'

describe('segmentImage', () => {
  const img = renderShape(64, 64, insideCircle(32, 32, 20), [200, 30, 30], [245, 245, 245])
  const pal = estimatePalette(img, 2)

  it('produces exactly two regions for circle-on-background', () => {
    const seg = segmentImage(img, pal, 4)
    expect(seg.regionCount).toBe(2)
  })

  it('despeckle removes single-pixel noise', () => {
    const noisy = renderShape(64, 64, insideCircle(32, 32, 20), [200, 30, 30], [245, 245, 245])
    noisy.data.set([200, 30, 30, 255], (5 * 64 + 5) * 4) // lone fg pixel in bg
    const seg = segmentImage(noisy, pal, 4)
    expect(seg.regionCount).toBe(2)
    expect(seg.labelMap[5 * 64 + 5]).toBe(seg.labelMap[0]) // absorbed into background
  })

  it('region sizes sum to pixel count', () => {
    const seg = segmentImage(img, pal, 4)
    expect([...seg.regionSize].reduce((a, b) => a + b, 0)).toBe(64 * 64)
  })
})
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

```ts
// src/worker/pipeline/segment.ts
import type { RasterImage, Palette, Segmentation } from '../../types'

function nearestPaletteIndex(pal: Palette, r: number, g: number, b: number): number {
  let best = 0, bestD = Infinity
  for (let c = 0; c < pal.k; c++) {
    const dr = r - pal.colors[3 * c], dg = g - pal.colors[3 * c + 1], db = b - pal.colors[3 * c + 2]
    const d = dr * dr + dg * dg + db * db
    if (d < bestD) { bestD = d; best = c }
  }
  return best
}

export function segmentImage(image: RasterImage, palette: Palette, despeckleSize: number): Segmentation {
  const { width: w, height: h, data } = image
  const n = w * h
  const colorIdx = new Int32Array(n)
  for (let p = 0; p < n; p++)
    colorIdx[p] = nearestPaletteIndex(palette, data[4 * p], data[4 * p + 1], data[4 * p + 2])

  // Connected components (4-connectivity) over colorIdx
  const label = new Int32Array(n).fill(-1)
  const sizes: number[] = [], colors: number[] = []
  const stack = new Int32Array(n)
  let regionCount = 0
  for (let p = 0; p < n; p++) {
    if (label[p] !== -1) continue
    const id = regionCount++, c = colorIdx[p]
    let top = 0, size = 0
    stack[top++] = p; label[p] = id
    while (top > 0) {
      const q = stack[--top]; size++
      const x = q % w, y = (q / w) | 0
      if (x > 0 && label[q - 1] === -1 && colorIdx[q - 1] === c) { label[q - 1] = id; stack[top++] = q - 1 }
      if (x < w - 1 && label[q + 1] === -1 && colorIdx[q + 1] === c) { label[q + 1] = id; stack[top++] = q + 1 }
      if (y > 0 && label[q - w] === -1 && colorIdx[q - w] === c) { label[q - w] = id; stack[top++] = q - w }
      if (y < h - 1 && label[q + w] === -1 && colorIdx[q + w] === c) { label[q + w] = id; stack[top++] = q + w }
    }
    sizes.push(size); colors.push(c)
  }

  // Despeckle: repeatedly absorb small regions into the neighbor sharing the longest border
  const alias = new Int32Array(regionCount)
  for (let i = 0; i < regionCount; i++) alias[i] = i
  const find = (i: number): number => { while (alias[i] !== i) { alias[i] = alias[alias[i]]; i = alias[i] } return i }
  for (let pass = 0; pass < 8; pass++) {
    let changed = false
    const border = new Map<string, number>() // "small,neighbor" -> shared edge count
    for (let p = 0; p < n; p++) {
      const a = find(label[p]), x = p % w
      const consider = (q: number) => {
        const b = find(label[q])
        if (a === b) return
        for (const [s, o] of [[a, b], [b, a]] as const)
          if (sizes[s] < despeckleSize) {
            const key = s + ',' + o
            border.set(key, (border.get(key) ?? 0) + 1)
          }
      }
      if (x < w - 1) consider(p + 1)
      if (p + w < n) consider(p + w)
    }
    const bestTarget = new Map<number, [number, number]>() // small -> [neighbor, count]
    for (const [key, count] of border) {
      const [s, o] = key.split(',').map(Number)
      const cur = bestTarget.get(s)
      if (!cur || count > cur[1]) bestTarget.set(s, [o, count])
    }
    for (const [s, [o]] of bestTarget) {
      const rs = find(s), ro = find(o)
      if (rs === ro || sizes[rs] >= despeckleSize) continue
      alias[rs] = ro; sizes[ro] += sizes[rs]; changed = true
    }
    if (!changed) break
  }

  // Compact region ids
  const remap = new Int32Array(regionCount).fill(-1)
  let compactCount = 0
  for (let i = 0; i < regionCount; i++) if (find(i) === i) remap[i] = compactCount++
  const labelMap = new Int32Array(n)
  const regionColor = new Int32Array(compactCount)
  const regionSize = new Int32Array(compactCount)
  for (let p = 0; p < n; p++) {
    const r = remap[find(label[p])]
    labelMap[p] = r
    regionSize[r]++
  }
  for (let i = 0; i < regionCount; i++) if (remap[find(i)] !== -1) regionColor[remap[find(i)]] = colors[find(i)]
  return { labelMap, regionColor, regionSize, regionCount: compactCount }
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/segment.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: segmentation with connected components and despeckle"`

---

### Task 5: Boundary extraction + sub-pixel refinement

This is the heart of the app. Two parts: (a) trace closed loops of lattice edges around each region; (b) replace each boundary-edge midpoint with a sub-pixel position recovered from the original anti-aliased pixels. Refined positions are cached per undirected pixel-edge so both regions sharing a boundary get byte-identical points (spec: no gaps/overlaps).

**Files:**
- Create: `src/worker/pipeline/boundaries.ts`
- Test: `tests/boundaries.test.ts`

**Interfaces:**
- Consumes: `Segmentation`, `Palette`, `RasterImage`.
- Produces: `extractBoundaries(image: RasterImage, seg: Segmentation, palette: Palette): RegionLoops[]` — one entry per region; `loops[0]` is not guaranteed to be the outer loop (svg.ts handles holes via fill-rule).

- [ ] **Step 1: Write failing tests**

```ts
// tests/boundaries.test.ts
import { describe, it, expect } from 'vitest'
import { estimatePalette } from '../src/worker/pipeline/palette'
import { segmentImage } from '../src/worker/pipeline/segment'
import { extractBoundaries } from '../src/worker/pipeline/boundaries'
import { renderShape, insideCircle } from './helpers/render'

describe('extractBoundaries', () => {
  const img = renderShape(64, 64, insideCircle(32, 32, 20.3), [200, 30, 30], [245, 245, 245])
  const pal = estimatePalette(img, 2)
  const seg = segmentImage(img, pal, 4)
  const all = extractBoundaries(img, seg, pal)

  it('circle region has exactly one loop', () => {
    const circleRegion = all.find(r => seg.regionSize[r.region] < 64 * 64 / 2)!
    expect(circleRegion.loops.length).toBe(1)
  })

  it('sub-pixel: refined points lie within 0.1px of true radius', () => {
    const circleRegion = all.find(r => seg.regionSize[r.region] < 64 * 64 / 2)!
    const pts = circleRegion.loops[0]
    let maxErr = 0
    for (let i = 0; i < pts.length; i += 2) {
      const r = Math.hypot(pts[i] - 32, pts[i + 1] - 32)
      maxErr = Math.max(maxErr, Math.abs(r - 20.3))
    }
    expect(maxErr).toBeLessThan(0.1)
  })

  it('shared boundary is identical between the two regions', () => {
    const key = (x: number, y: number) => x.toFixed(6) + ',' + y.toFixed(6)
    const sets = all.map(r => {
      const s = new Set<string>()
      for (const l of r.loops) for (let i = 0; i < l.length; i += 2) s.add(key(l[i], l[i + 1]))
      return s
    })
    // every point of the smaller set appears in the larger (image-border points excluded from the circle's set)
    const [a, b] = sets.sort((x, y) => x.size - y.size)
    for (const p of a) expect(b.has(p)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

```ts
// src/worker/pipeline/boundaries.ts
import type { RasterImage, Palette, Segmentation, RegionLoops } from '../../types'

// Directed boundary edges on the integer lattice, region kept on the LEFT while walking.
// Vertex ids: v = y * (w+1) + x for lattice point (x, y).

export function extractBoundaries(image: RasterImage, seg: Segmentation, palette: Palette): RegionLoops[] {
  const { width: w, height: h } = image
  const { labelMap } = seg
  const lab = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h) ? -1 : labelMap[y * w + x]

  // --- Sub-pixel refinement, cached per undirected pixel-edge ---
  const refined = new Map<string, [number, number]>()
  const orig = (x: number, y: number, c: number) => image.data[(y * w + x) * 4 + c]
  /** Fraction of pixel (x,y)'s original color explained by palette color ci vs cj. */
  const coverage = (x: number, y: number, ci: number, cj: number): number => {
    const ax = palette.colors[3 * ci] - palette.colors[3 * cj]
    const ay = palette.colors[3 * ci + 1] - palette.colors[3 * cj + 1]
    const az = palette.colors[3 * ci + 2] - palette.colors[3 * cj + 2]
    const len2 = ax * ax + ay * ay + az * az
    if (len2 === 0) return 0.5
    const dx = orig(x, y, 0) - palette.colors[3 * cj]
    const dy = orig(x, y, 1) - palette.colors[3 * cj + 1]
    const dz = orig(x, y, 2) - palette.colors[3 * cj + 2]
    return Math.max(0, Math.min(1, (dx * ax + dy * ay + dz * az) / len2))
  }
  /**
   * Refined midpoint of the boundary edge between 4-adjacent pixels a=(ax,ay), b=(bx,by).
   * Model: centers at t=0 (a) and t=1 (b); pixel border at t=0.5. Anti-aliased coverage
   * places the true edge at t = fa - 0.5 (if a is the partial pixel) or t = fb + 0.5 (if b is).
   */
  const refineEdge = (ax: number, ay: number, bx: number, by: number): [number, number] => {
    const k = ax < bx || (ax === bx && ay < by) ? `${ax},${ay},${bx},${by}` : `${bx},${by},${ax},${ay}`
    const hit = refined.get(k)
    if (hit) return hit
    const mx = (ax + bx + 1) / 2, my = (ay + by + 1) / 2 // midpoint of the two pixel centers
    let out: [number, number] = [mx, my]
    const ra = lab(ax, ay), rb = lab(bx, by)
    if (ra >= 0 && rb >= 0) {
      const ca = seg.regionColor[ra], cb = seg.regionColor[rb]
      const fa = coverage(ax, ay, ca, cb) // fraction of A-color in pixel a
      const fb = coverage(bx, by, ca, cb) // fraction of A-color in pixel b
      let t = 0.5
      if (fa > 0.001 && fa < 0.999) t = fa - 0.5
      else if (fb > 0.001 && fb < 0.999) t = fb + 0.5
      t = Math.max(-0.5, Math.min(1.5, t))
      out = [mx + (bx - ax) * (t - 0.5), my + (by - ay) * (t - 0.5)]
    }
    refined.set(k, out)
    return out
  }

  // --- Collect directed edges per region ---
  // Horizontal lattice edge from (x,y)->(x+1,y): pixel above is (x, y-1), below is (x, y).
  // Walking left->right keeps the BELOW pixel's region on the... (screen y grows down; the
  // region on the left of direction (+1,0) is the pixel ABOVE). Edge conventions:
  //   dir (+1,0): left = pixel (x, y-1)   | dir (-1,0): left = pixel (x-1, y) -> actually (x-1? ) see below
  //   dir (0,+1): left = pixel (x, y)     | dir (0,-1): left = pixel (x-1, y-1)
  // We enumerate all 4 directed variants explicitly.
  const V = (x: number, y: number) => y * (w + 1) + x
  const perRegion = new Map<number, Map<number, number[]>>() // region -> startVertex -> endVertices
  const addEdge = (region: number, x0: number, y0: number, x1: number, y1: number) => {
    if (region < 0) return
    let m = perRegion.get(region)
    if (!m) { m = new Map(); perRegion.set(region, m) }
    const s = V(x0, y0)
    let ends = m.get(s)
    if (!ends) { ends = []; m.set(s, ends) }
    ends.push(V(x1, y1))
  }
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x < w; x++) { // horizontal edges (x,y)-(x+1,y): pixels (x,y-1) above, (x,y) below
      const above = lab(x, y - 1), below = lab(x, y)
      if (above === below) continue
      addEdge(above, x, y, x + 1, y)      // dir +x keeps 'above' on left
      addEdge(below, x + 1, y, x, y)      // dir -x keeps 'below' on left
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x <= w; x++) { // vertical edges (x,y)-(x,y+1): pixels (x-1,y) left, (x,y) right
      const left = lab(x - 1, y), right = lab(x, y)
      if (left === right) continue
      addEdge(right, x, y, x, y + 1)      // dir +y keeps 'right' pixel on left side of travel
      addEdge(left, x, y + 1, x, y)       // dir -y keeps 'left' pixel on left side of travel
    }
  }

  // --- Chain directed edges into loops; at 4-way junctions prefer the sharpest left turn ---
  const results: RegionLoops[] = []
  for (const [region, edges] of perRegion) {
    const loops: Float64Array[] = []
    for (const [start, ends] of edges) {
      while (ends.length > 0) {
        const verts: number[] = [start]
        let prev = start, cur = ends.pop()!
        while (cur !== start) {
          verts.push(cur)
          const outs = edges.get(cur)
          if (!outs || outs.length === 0) throw new Error('boundaries: open chain (bug)')
          let pick = 0
          if (outs.length > 1) { // junction: pick sharpest left turn relative to incoming direction
            const dx = (cur % (w + 1)) - (prev % (w + 1)), dy = ((cur / (w + 1)) | 0) - ((prev / (w + 1)) | 0)
            let bestScore = -Infinity
            outs.forEach((o, i) => {
              const ox = (o % (w + 1)) - (cur % (w + 1)), oy = ((o / (w + 1)) | 0) - ((cur / (w + 1)) | 0)
              const cross = dx * oy - dy * ox, dot = dx * ox + dy * oy
              const score = cross > 0 ? 2 : dot > 0 ? 1 : cross < 0 ? 0 : -1 // left > straight > right > back
              if (score > bestScore) { bestScore = score; pick = i }
            })
          }
          prev = cur
          cur = outs.splice(pick, 1)[0]
        }
        // Convert lattice-vertex loop -> refined midpoints of consecutive edges
        const pts: number[] = []
        for (let i = 0; i < verts.length; i++) {
          const a = verts[i], b = verts[(i + 1) % verts.length]
          const axv = a % (w + 1), ayv = (a / (w + 1)) | 0
          const bxv = b % (w + 1), byv = (b / (w + 1)) | 0
          // The two pixels flanking this lattice edge:
          let p: [number, number], q: [number, number]
          if (ayv === byv) { // horizontal edge: pixels above/below
            const ex = Math.min(axv, bxv)
            p = [ex, ayv - 1]; q = [ex, ayv]
          } else {           // vertical edge: pixels left/right
            const ey = Math.min(ayv, byv)
            p = [axv - 1, ey]; q = [axv, ey]
          }
          const inImg = (px: number, py: number) => px >= 0 && py >= 0 && px < w && py < h
          if (inImg(...p) && inImg(...q)) pts.push(...refineEdge(p[0], p[1], q[0], q[1]))
          else pts.push((axv + bxv) / 2, (ayv + byv) / 2) // image border: keep lattice midpoint
        }
        loops.push(new Float64Array(pts))
      }
    }
    results.push({ region, loops })
  }
  return results
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/boundaries.test.ts` → PASS. The 0.1px test is strict; if it fails marginally (< 0.15), inspect whether failures cluster at 45° (diagonal edges have two partial pixels — the `fa`-first rule can pick the wrong one; fix by choosing whichever coverage is farther from {0,1}).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: boundary tracing with sub-pixel anti-aliasing refinement"`

---

### Task 6: Corner detection

**Files:**
- Create: `src/worker/pipeline/corners.ts`
- Test: `tests/corners.test.ts`

**Interfaces:**
- Consumes: a single loop `Float64Array`.
- Produces: `findCorners(loop: Float64Array): number[]` — ascending vertex indices classified as corners; empty array for an all-smooth loop.

- [ ] **Step 1: Write failing tests**

```ts
// tests/corners.test.ts
import { describe, it, expect } from 'vitest'
import { estimatePalette } from '../src/worker/pipeline/palette'
import { segmentImage } from '../src/worker/pipeline/segment'
import { extractBoundaries } from '../src/worker/pipeline/boundaries'
import { findCorners } from '../src/worker/pipeline/corners'
import { renderShape, insideCircle, insideRotSquare } from './helpers/render'

function shapeLoop(inside: (x: number, y: number) => boolean): Float64Array {
  const img = renderShape(96, 96, inside, [200, 30, 30], [245, 245, 245])
  const pal = estimatePalette(img, 2)
  const seg = segmentImage(img, pal, 4)
  const all = extractBoundaries(img, seg, pal)
  const shape = all.find(r => seg.regionSize[r.region] < 96 * 96 / 2)!
  return shape.loops[0]
}

describe('findCorners', () => {
  it('finds 0 corners on a circle', () => {
    expect(findCorners(shapeLoop(insideCircle(48, 48, 30))).length).toBe(0)
  })
  it('finds exactly 4 corners on a rotated square', () => {
    const corners = findCorners(shapeLoop(insideRotSquare(48, 48, 26, 0.3)))
    expect(corners.length).toBe(4)
  })
})
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

```ts
// src/worker/pipeline/corners.ts

/**
 * Corner = vertex where the polyline turns sharply at EVERY scale (single-scale
 * reads anti-aliasing jitter as corners). Turning angle measured between the
 * chords to vertices ±s away, for s in SCALES; a vertex is a corner candidate
 * if the minimum deviation over scales exceeds ANGLE_THRESHOLD.
 * Non-maximum suppression keeps one vertex per corner neighborhood.
 */
const SCALES = [2, 4, 8]
const ANGLE_THRESHOLD = (40 * Math.PI) / 180

export function findCorners(loop: Float64Array): number[] {
  const n = loop.length / 2
  if (n < 8) return []
  const px = (i: number) => loop[2 * (((i % n) + n) % n)]
  const py = (i: number) => loop[2 * (((i % n) + n) % n) + 1]
  const deviation = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let minDev = Infinity
    for (const s of SCALES) {
      const step = Math.min(s, Math.floor((n - 1) / 2))
      const ax = px(i) - px(i - step), ay = py(i) - py(i - step)
      const bx = px(i + step) - px(i), by = py(i + step) - py(i)
      const dot = ax * bx + ay * by, cross = ax * by - ay * bx
      minDev = Math.min(minDev, Math.abs(Math.atan2(cross, dot)))
    }
    deviation[i] = minDev
  }
  // Non-maximum suppression over a window of the largest scale
  const win = SCALES[SCALES.length - 1]
  const corners: number[] = []
  for (let i = 0; i < n; i++) {
    if (deviation[i] < ANGLE_THRESHOLD) continue
    let isMax = true
    for (let d = -win; d <= win; d++) {
      if (d === 0) continue
      const j = ((i + d) % n + n) % n
      if (deviation[j] > deviation[i] || (deviation[j] === deviation[i] && j < i)) { isMax = false; break }
    }
    if (isMax) corners.push(i)
  }
  return corners
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/corners.test.ts` → PASS. If the circle test finds phantom corners, raise `ANGLE_THRESHOLD` or add scale 12; if the square misses corners, the smallest scale is too coarse — add scale 1. Tune, don't weaken tests.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: multi-scale corner detection"`

---

### Task 7: Bézier fitting (Schneider)

**Files:**
- Create: `src/worker/pipeline/fitcurves.ts`
- Test: `tests/fitcurves.test.ts`

**Interfaces:**
- Consumes: loop `Float64Array` + `findCorners` output.
- Produces:

```ts
export type Cubic = [number, number, number, number, number, number, number, number] // p0 c1 c2 p1
export function fitLoop(loop: Float64Array, corners: number[], maxErrorPx: number): Cubic[]
```

Consecutive cubics share endpoints; the last cubic ends at the first cubic's start.

- [ ] **Step 1: Write failing tests**

```ts
// tests/fitcurves.test.ts
import { describe, it, expect } from 'vitest'
import { fitLoop, type Cubic } from '../src/worker/pipeline/fitcurves'

function circleLoop(cx: number, cy: number, r: number, n = 200): Float64Array {
  const pts = new Float64Array(n * 2)
  for (let i = 0; i < n; i++) {
    pts[2 * i] = cx + r * Math.cos((2 * Math.PI * i) / n)
    pts[2 * i + 1] = cy + r * Math.sin((2 * Math.PI * i) / n)
  }
  return pts
}

const evalCubic = (c: Cubic, t: number): [number, number] => {
  const u = 1 - t
  return [
    u * u * u * c[0] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6],
    u * u * u * c[1] + 3 * u * u * t * c[3] + 3 * u * t * t * c[5] + t * t * t * c[7],
  ]
}

describe('fitLoop', () => {
  it('fits a circle with few segments, all within tolerance of the true radius', () => {
    const cubics = fitLoop(circleLoop(50, 50, 30), [], 0.5)
    expect(cubics.length).toBeLessThanOrEqual(8)
    for (const c of cubics)
      for (let t = 0; t <= 1; t += 0.1) {
        const [x, y] = evalCubic(c, t)
        expect(Math.abs(Math.hypot(x - 50, y - 50) - 30)).toBeLessThan(0.5)
      }
  })

  it('cubics chain: each ends where the next starts, loop closes', () => {
    const cubics = fitLoop(circleLoop(50, 50, 30), [], 0.5)
    for (let i = 0; i < cubics.length; i++) {
      const next = cubics[(i + 1) % cubics.length]
      expect(cubics[i][6]).toBeCloseTo(next[0], 9)
      expect(cubics[i][7]).toBeCloseTo(next[1], 9)
    }
  })

  it('respects corners: square with 4 corners yields exactly 4 segments', () => {
    const sq: number[] = []
    for (let s = 0; s < 4; s++)
      for (let i = 0; i < 25; i++) {
        const t = i / 25
        const corners4 = [[0, 0], [100, 0], [100, 100], [0, 100]]
        const [x0, y0] = corners4[s], [x1, y1] = corners4[(s + 1) % 4]
        sq.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
      }
    const cubics = fitLoop(new Float64Array(sq), [0, 25, 50, 75], 0.5)
    expect(cubics.length).toBe(4)
  })
})
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** (Schneider's algorithm, Graphics Gems "FitCurves", adapted to closed loops with corner breakpoints)

```ts
// src/worker/pipeline/fitcurves.ts

export type Cubic = [number, number, number, number, number, number, number, number]

type V = { x: number; y: number }
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y })
const scale = (a: V, s: number): V => ({ x: a.x * s, y: a.y * s })
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y
const norm = (a: V) => Math.hypot(a.x, a.y)
const normalize = (a: V): V => { const l = norm(a); return l === 0 ? { x: 0, y: 0 } : scale(a, 1 / l) }

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
  return u.map(v => v / total)
}

function generateBezier(pts: V[], u: number[], tHat1: V, tHat2: V): V[] {
  const n = pts.length
  const first = pts[0], last = pts[n - 1]
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0
  for (let i = 0; i < n; i++) {
    const t = u[i], v = 1 - t
    const a1 = scale(tHat1, 3 * v * v * t)
    const a2 = scale(tHat2, 3 * v * t * t)
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2)
    const tmp = sub(pts[i], add(scale(first, v ** 3 + 3 * v * v * t), scale(last, t ** 3 + 3 * v * t * t)))
    x0 += dot(a1, tmp); x1 += dot(a2, tmp)
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
  let err = 0, split = pts.length >> 1
  for (let i = 1; i < pts.length - 1; i++) {
    const d = norm(sub(bez(curve, u[i]), pts[i]))
    if (d * d > err) { err = d * d; split = i }
  }
  return { err, split }
}

function reparameterize(pts: V[], curve: V[], u: number[]): number[] {
  // one Newton-Raphson step per point
  const d1 = [0, 1, 2].map(i => scale(sub(curve[i + 1], curve[i]), 3))
  const d2 = [0, 1].map(i => scale(sub(d1[i + 1], d1[i]), 2))
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
    const qp = bez2(d1, t), qpp = bez1(d2, t)
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
    for (let i = 0; i < 4 && err > errSq; i++) { // iterate reparameterization
      u = reparameterize(pts, curve, u)
      curve = generateBezier(pts, u, tHat1, tHat2)
      ;({ err, split } = maxError(pts, curve, u))
    }
  }
  if (err <= errSq) {
    out.push([curve[0].x, curve[0].y, curve[1].x, curve[1].y, curve[2].x, curve[2].y, curve[3].x, curve[3].y])
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
  const p = (i: number): V => ({ x: loop[2 * (((i % n) + n) % n)], y: loop[2 * (((i % n) + n) % n) + 1] })
  const breaks = corners.length > 0 ? corners : [0]
  const errSq = maxErrorPx * maxErrorPx
  const out: Cubic[] = []
  for (let b = 0; b < breaks.length; b++) {
    const i0 = breaks[b], i1 = breaks[(b + 1) % breaks.length]
    const len = ((i1 - i0 + n) % n) || n
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
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/fitcurves.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: piecewise cubic Bezier fitting with corner breakpoints"`

---

### Task 8: SVG assembly

**Files:**
- Create: `src/worker/pipeline/svg.ts`
- Test: `tests/svg.test.ts`

**Interfaces:**
- Consumes: `Cubic` from fitcurves; `Palette`.
- Produces:

```ts
export interface RegionPath {
  paletteIndex: number
  area: number          // absolute area of the region's largest loop, px²
  loops: Cubic[][]      // one Cubic[] per boundary loop (outer + holes)
}
export function polygonArea(loop: Float64Array): number // signed shoelace area
export function assembleSvg(paths: RegionPath[], palette: Palette, width: number, height: number): string
```

- [ ] **Step 1: Write failing tests**

```ts
// tests/svg.test.ts
import { describe, it, expect } from 'vitest'
import { assembleSvg, polygonArea, type RegionPath } from '../src/worker/pipeline/svg'
import type { Palette } from '../src/types'

describe('svg assembly', () => {
  const palette: Palette = { k: 2, colors: new Uint8ClampedArray([245, 245, 245, 200, 30, 30]) }
  const square: RegionPath = {
    paletteIndex: 1, area: 100,
    loops: [[
      [0, 0, 3, 0, 7, 0, 10, 0], [10, 0, 10, 3, 10, 7, 10, 10],
      [10, 10, 7, 10, 3, 10, 0, 10], [0, 10, 0, 7, 0, 3, 0, 0],
    ]],
  }
  const bg: RegionPath = { paletteIndex: 0, area: 400, loops: [[[0, 0, 20, 0, 20, 0, 20, 20]]] }

  it('emits one path per region, larger areas first, correct fills', () => {
    const svg = assembleSvg([square, bg], palette, 20, 20)
    expect(svg).toContain('viewBox="0 0 20 20"')
    const first = svg.indexOf('#f5f5f5') // bg (area 400) painted first
    const second = svg.indexOf('#c81e1e') // square painted on top
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
    expect(svg).toContain('fill-rule="evenodd"')
    expect(svg.match(/<path/g)!.length).toBe(2)
  })

  it('polygonArea: unit square CW in screen coords', () => {
    expect(Math.abs(polygonArea(new Float64Array([0, 0, 1, 0, 1, 1, 0, 1])))).toBeCloseTo(1)
  })
})
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

```ts
// src/worker/pipeline/svg.ts
import type { Palette } from '../../types'
import type { Cubic } from './fitcurves'

export interface RegionPath {
  paletteIndex: number
  area: number
  loops: Cubic[][]
}

export function polygonArea(loop: Float64Array): number {
  let a = 0
  const n = loop.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += loop[2 * i] * loop[2 * j + 1] - loop[2 * j] * loop[2 * i + 1]
  }
  return a / 2
}

const f = (v: number) => {
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

const hex = (c: Uint8ClampedArray, i: number) =>
  '#' + [c[3 * i], c[3 * i + 1], c[3 * i + 2]].map(v => v.toString(16).padStart(2, '0')).join('')

function loopToPath(loop: Cubic[]): string {
  if (loop.length === 0) return ''
  let d = `M${f(loop[0][0])} ${f(loop[0][1])}`
  for (const c of loop) d += `C${f(c[2])} ${f(c[3])} ${f(c[4])} ${f(c[5])} ${f(c[6])} ${f(c[7])}`
  return d + 'Z'
}

export function assembleSvg(paths: RegionPath[], palette: Palette, width: number, height: number): string {
  const sorted = [...paths].sort((a, b) => b.area - a.area) // big first -> painted underneath
  const body = sorted
    .map(p => `<path fill="${hex(palette.colors, p.paletteIndex)}" fill-rule="evenodd" d="${p.loops.map(loopToPath).join('')}"/>`)
    .join('\n  ')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n  ${body}\n</svg>\n`
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/svg.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: svg path assembly with area-ordered painting"`

---

### Task 9: Pipeline orchestrator + round-trip e2e

**Files:**
- Create: `src/worker/pipeline/index.ts`
- Test: `tests/e2e.test.ts`

**Interfaces:**
- Consumes: every pipeline module.
- Produces:

```ts
export function vectorize(
  image: RasterImage,
  options: PipelineOptions,
  onProgress?: (stage: StageName) => void,
): VectorResult
```

`onProgress(stage)` fires when each stage STARTS. Smoothness maps to fit tolerance: `maxErrorPx = 0.25 + 1.75 * options.smoothness`.

- [ ] **Step 1: Write failing test**

```ts
// tests/e2e.test.ts
import { describe, it, expect } from 'vitest'
import { vectorize } from '../src/worker/pipeline'
import { DEFAULT_OPTIONS } from '../src/types'
import { renderShape, insideCircle, insideRotSquare } from './helpers/render'

describe('vectorize round-trip', () => {
  it('circle on background -> 2 paths, sane stats, progress in order', () => {
    const img = renderShape(96, 96, insideCircle(48, 48, 30), [200, 30, 30], [245, 245, 245])
    const stages: string[] = []
    const { svg, stats } = vectorize(img, DEFAULT_OPTIONS, s => stages.push(s))
    expect(stats.pathCount).toBe(2)
    expect(svg).toContain('<path')
    expect(stages).toEqual(['palette', 'segment', 'boundaries', 'corners', 'fit', 'svg'])
    // circle should need few cubics: pointCount well under the raw boundary point count
    expect(stats.pointCount).toBeLessThan(80)
  })

  it('two-shape three-color image -> 3 paths', () => {
    const circle = insideCircle(30, 48, 20), square = insideRotSquare(66, 48, 14, 0.2)
    const img = renderShape(96, 96, (x, y) => circle(x, y) || square(x, y), [200, 30, 30], [245, 245, 245])
    // overpaint square area in blue for a 3rd color
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 96; x++)
        if (square(x + 0.5, y + 0.5)) {
          const o = (y * 96 + x) * 4
          img.data[o] = 30; img.data[o + 1] = 30; img.data[o + 2] = 200
        }
    const { stats } = vectorize(img, DEFAULT_OPTIONS)
    expect(stats.pathCount).toBe(3)
  })
})
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

```ts
// src/worker/pipeline/index.ts
import type { RasterImage, PipelineOptions, StageName, VectorResult, PipelineStats } from '../../types'
import { estimatePalette } from './palette'
import { segmentImage } from './segment'
import { extractBoundaries } from './boundaries'
import { findCorners } from './corners'
import { fitLoop, type Cubic } from './fitcurves'
import { assembleSvg, polygonArea, type RegionPath } from './svg'

export function vectorize(
  image: RasterImage,
  options: PipelineOptions,
  onProgress?: (stage: StageName) => void,
): VectorResult {
  const timings: PipelineStats['timings'] = {}
  const stage = <T>(name: StageName, fn: () => T): T => {
    onProgress?.(name)
    const t0 = performance.now()
    const r = fn()
    timings[name] = performance.now() - t0
    return r
  }
  const palette = stage('palette', () => estimatePalette(image, options.colorCount))
  const seg = stage('segment', () => segmentImage(image, palette, options.despeckleSize))
  const bounds = stage('boundaries', () => extractBoundaries(image, seg, palette))
  const cornersPerLoop = stage('corners', () =>
    bounds.map(r => r.loops.map(l => findCorners(l))))
  const maxErrorPx = 0.25 + 1.75 * options.smoothness
  let pointCount = 0
  const paths = stage('fit', () =>
    bounds.map((r, ri): RegionPath => {
      const loops: Cubic[][] = r.loops.map((l, li) => {
        const cubics = fitLoop(l, cornersPerLoop[ri][li], maxErrorPx)
        pointCount += cubics.length * 3 + 1
        return cubics
      })
      const area = Math.max(...r.loops.map(l => Math.abs(polygonArea(l))))
      return { paletteIndex: seg.regionColor[r.region], area, loops }
    }))
  const svg = stage('svg', () => assembleSvg(paths, palette, image.width, image.height))
  return { svg, stats: { pathCount: paths.length, pointCount, timings } }
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/e2e.test.ts` then the full suite `npx vitest run` → all PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: vectorize orchestrator with timings and progress"`

---

### Task 10: Web Worker + client wrapper with stage caching

**Files:**
- Create: `src/worker/vectorize.worker.ts`, `src/lib/workerClient.ts`
- Test: `tests/workerCache.test.ts` (tests the cache-decision function, which is pure)

**Interfaces:**
- Consumes: pipeline modules, worker protocol types.
- Produces:
  - Worker: handles `WorkerRequest`, posts `WorkerResponse` messages. Caches intermediates so an options tweak only re-runs downstream stages: image or `colorCount` change → from `palette`; `despeckleSize` change → from `segment`; `smoothness` change → from `fit`.
  - `firstDirtyStage(prev: PipelineOptions | null, next: PipelineOptions, sameImage: boolean): StageName` (exported from the worker module for testing).
  - Client:

```ts
// src/lib/workerClient.ts
export class VectorizerClient {
  vectorize(image: RasterImage, options: PipelineOptions,
            onProgress?: (stage: StageName) => void): Promise<VectorResult>
  cancel(): void // terminates + respawns worker; pending promise rejects with Error('cancelled')
}
```

- [ ] **Step 1: Write failing test for the cache decision**

```ts
// tests/workerCache.test.ts
import { describe, it, expect } from 'vitest'
import { firstDirtyStage } from '../src/worker/vectorize.worker'
import { DEFAULT_OPTIONS } from '../src/types'

describe('firstDirtyStage', () => {
  const base = DEFAULT_OPTIONS
  it('new image -> palette', () =>
    expect(firstDirtyStage(base, base, false)).toBe('palette'))
  it('colorCount change -> palette', () =>
    expect(firstDirtyStage(base, { ...base, colorCount: 4 }, true)).toBe('palette'))
  it('despeckle change -> segment', () =>
    expect(firstDirtyStage(base, { ...base, despeckleSize: 9 }, true)).toBe('segment'))
  it('smoothness change -> fit', () =>
    expect(firstDirtyStage(base, { ...base, smoothness: 0.9 }, true)).toBe('fit'))
  it('no prev -> palette', () =>
    expect(firstDirtyStage(null, base, true)).toBe('palette'))
})
```

- [ ] **Step 2: Run to verify fail.**

Note: importing a `.worker.ts` module in vitest must not execute browser-only code at top level — the implementation below guards `self.onmessage` behind a `typeof self` check.

- [ ] **Step 3: Implement worker and client**

```ts
// src/worker/vectorize.worker.ts
import type {
  RasterImage, PipelineOptions, StageName, WorkerRequest, WorkerResponse,
  Palette, Segmentation, RegionLoops, PipelineStats,
} from '../types'
import { estimatePalette } from './pipeline/palette'
import { segmentImage } from './pipeline/segment'
import { extractBoundaries } from './pipeline/boundaries'
import { findCorners } from './pipeline/corners'
import { fitLoop, type Cubic } from './pipeline/fitcurves'
import { assembleSvg, polygonArea, type RegionPath } from './pipeline/svg'

const ORDER: StageName[] = ['palette', 'segment', 'boundaries', 'corners', 'fit', 'svg']

export function firstDirtyStage(
  prev: PipelineOptions | null, next: PipelineOptions, sameImage: boolean,
): StageName {
  if (!prev || !sameImage) return 'palette'
  if (prev.colorCount !== next.colorCount) return 'palette'
  if (prev.despeckleSize !== next.despeckleSize) return 'segment'
  return 'fit' // smoothness (or nothing) changed; fit+svg are cheap
}

interface Cache {
  image: RasterImage | null
  options: PipelineOptions | null
  palette?: Palette
  seg?: Segmentation
  bounds?: RegionLoops[]
  corners?: number[][][]
}
const cache: Cache = { image: null, options: null }

function run(image: RasterImage, options: PipelineOptions, post: (m: WorkerResponse) => void, jobId: number) {
  const from = firstDirtyStage(cache.options, options, cache.image === image || sameImageData(cache.image, image))
  const fromIdx = ORDER.indexOf(from)
  const timings: PipelineStats['timings'] = {}
  const stage = <T>(name: StageName, fn: () => T): T => {
    post({ type: 'progress', jobId, stage: name })
    const t0 = performance.now()
    const r = fn()
    timings[name] = performance.now() - t0
    return r
  }
  if (fromIdx <= ORDER.indexOf('palette') || !cache.palette)
    cache.palette = stage('palette', () => estimatePalette(image, options.colorCount))
  if (fromIdx <= ORDER.indexOf('segment') || !cache.seg)
    cache.seg = stage('segment', () => segmentImage(image, cache.palette!, options.despeckleSize))
  if (fromIdx <= ORDER.indexOf('boundaries') || !cache.bounds) {
    cache.bounds = stage('boundaries', () => extractBoundaries(image, cache.seg!, cache.palette!))
    cache.corners = stage('corners', () => cache.bounds!.map(r => r.loops.map(l => findCorners(l))))
  }
  const maxErrorPx = 0.25 + 1.75 * options.smoothness
  let pointCount = 0
  const paths = stage('fit', () =>
    cache.bounds!.map((r, ri): RegionPath => {
      const loops: Cubic[][] = r.loops.map((l, li) => {
        const cubics = fitLoop(l, cache.corners![ri][li], maxErrorPx)
        pointCount += cubics.length * 3 + 1
        return cubics
      })
      const area = Math.max(...r.loops.map(l => Math.abs(polygonArea(l))))
      return { paletteIndex: cache.seg!.regionColor[r.region], area, loops }
    }))
  const svg = stage('svg', () => assembleSvg(paths, cache.palette!, image.width, image.height))
  cache.image = image
  cache.options = options
  post({ type: 'result', jobId, result: { svg, stats: { pathCount: paths.length, pointCount, timings } } })
}

function sameImageData(a: RasterImage | null, b: RasterImage): boolean {
  if (!a || a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false
  // cheap probe: compare 256 spread samples, not every byte
  const step = Math.max(1, Math.floor(a.data.length / 256))
  for (let i = 0; i < a.data.length; i += step) if (a.data[i] !== b.data[i]) return false
  return true
}

if (typeof self !== 'undefined' && 'postMessage' in self && typeof document === 'undefined') {
  self.onmessage = (e: MessageEvent<WorkerRequest>) => {
    const { image, options, jobId } = e.data
    let currentStage: StageName | 'unknown' = 'unknown'
    try {
      run(image, options, m => {
        if (m.type === 'progress') currentStage = m.stage
        self.postMessage(m)
      }, jobId)
    } catch (err) {
      cache.image = null; cache.options = null // poisoned cache — drop it
      self.postMessage({
        type: 'error', jobId, stage: currentStage,
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse)
    }
  }
}
```

```ts
// src/lib/workerClient.ts
import type { RasterImage, PipelineOptions, StageName, VectorResult, WorkerResponse } from '../types'

export class VectorizerClient {
  private worker: Worker
  private jobId = 0
  private pending: { reject: (e: Error) => void } | null = null

  constructor() { this.worker = this.spawn() }

  private spawn(): Worker {
    return new Worker(new URL('../worker/vectorize.worker.ts', import.meta.url), { type: 'module' })
  }

  vectorize(image: RasterImage, options: PipelineOptions,
            onProgress?: (stage: StageName) => void): Promise<VectorResult> {
    const jobId = ++this.jobId
    return new Promise<VectorResult>((resolve, reject) => {
      this.pending = { reject }
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data
        if (m.jobId !== jobId) return // stale
        if (m.type === 'progress') onProgress?.(m.stage)
        else if (m.type === 'result') { this.pending = null; resolve(m.result) }
        else { this.pending = null; reject(new Error(`${m.stage}: ${m.message}`)) }
      }
      this.worker.onerror = (e) => { this.pending = null; reject(new Error(e.message)) }
      this.worker.postMessage({ type: 'vectorize', image, options, jobId })
    })
  }

  cancel(): void {
    this.worker.terminate()
    this.pending?.reject(new Error('cancelled'))
    this.pending = null
    this.worker = this.spawn()
  }
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/workerCache.test.ts` and full suite → PASS. Also `npm run build` → succeeds (confirms worker URL syntax bundles).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: worker with stage caching and cancelable client"`

---

### Task 11: Dropzone + decode + minimal app wiring

Deliverable: drop or paste an image in the browser → SVG appears (unstyled), proving the full path works end to end in the app.

**Files:**
- Create: `src/lib/decode.ts`, `src/lib/Dropzone.svelte`
- Modify: `src/App.svelte` (replace template content)
- Delete: template demo files (`src/lib/Counter.svelte`, `src/assets/*` if present)

**Interfaces:**
- Consumes: `VectorizerClient`.
- Produces:

```ts
// src/lib/decode.ts
export interface DecodeResult { image: RasterImage; downscaled: boolean }
export async function fileToRasterImage(file: Blob): Promise<DecodeResult> // throws Error('undecodable') on bad input
```

`Dropzone.svelte` props: `{ onfile: (file: File) => void, error: string | null }`. Fires `onfile` for drag/drop and paste.

- [ ] **Step 1: Implement decode**

```ts
// src/lib/decode.ts
import type { RasterImage } from '../types'

const MAX_SIDE = 4096

export interface DecodeResult { image: RasterImage; downscaled: boolean }

export async function fileToRasterImage(file: Blob): Promise<DecodeResult> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    throw new Error('undecodable')
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff' // composite transparency onto white
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const data = ctx.getImageData(0, 0, w, h)
  return { image: { width: w, height: h, data: data.data }, downscaled: scale < 1 }
}
```

- [ ] **Step 2: Implement Dropzone**

```svelte
<!-- src/lib/Dropzone.svelte -->
<script lang="ts">
  let { onfile, error = null }: { onfile: (file: File) => void; error?: string | null } = $props()
  let dragging = $state(false)

  function drop(e: DragEvent) {
    e.preventDefault()
    dragging = false
    const f = e.dataTransfer?.files?.[0]
    if (f) onfile(f)
  }
  function paste(e: ClipboardEvent) {
    const item = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'))
    const f = item?.getAsFile()
    if (f) onfile(f)
  }
</script>

<svelte:window onpaste={paste} />
<div
  class="dropzone" class:dragging
  ondragover={(e) => { e.preventDefault(); dragging = true }}
  ondragleave={() => (dragging = false)}
  ondrop={drop}
  role="button" tabindex="0"
>
  <p>Drop an image here or paste from clipboard</p>
  {#if error}<p class="error">{error}</p>{/if}
</div>

<style>
  .dropzone {
    border: 2px dashed #888; border-radius: 8px; padding: 3rem; text-align: center;
    color: #666; cursor: pointer;
  }
  .dropzone.dragging { border-color: #4a90d9; background: #4a90d910; }
  .error { color: #c0392b; }
</style>
```

- [ ] **Step 3: Wire App.svelte (minimal — CompareView and Controls come next)**

```svelte
<!-- src/App.svelte -->
<script lang="ts">
  import Dropzone from './lib/Dropzone.svelte'
  import { VectorizerClient } from './lib/workerClient'
  import { fileToRasterImage } from './lib/decode'
  import { DEFAULT_OPTIONS, type VectorResult, type RasterImage, type StageName } from './types'

  const client = new VectorizerClient()
  let image = $state<RasterImage | null>(null)
  let result = $state<VectorResult | null>(null)
  let stage = $state<StageName | null>(null)
  let error = $state<string | null>(null)
  let notice = $state<string | null>(null)

  async function handleFile(file: File) {
    error = null; notice = null; result = null
    try {
      const { image: img, downscaled } = await fileToRasterImage(file)
      if (downscaled) notice = 'Large image was downscaled to 4096px'
      image = img
      result = await client.vectorize(img, DEFAULT_OPTIONS, s => (stage = s))
      stage = null
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error = msg === 'undecodable' ? 'Could not decode that file — try a PNG, JPEG, GIF, or WebP.' : msg
      stage = null
    }
  }
</script>

<main>
  <h1>slop-vectorizer</h1>
  {#if !image}
    <Dropzone onfile={handleFile} {error} />
  {:else}
    {#if stage}<p>Vectorizing… ({stage})</p>{/if}
    {#if notice}<p>{notice}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}
    {#if result}
      <div class="raw-svg">{@html result.svg}</div>
      <pre>{JSON.stringify(result.stats, null, 2)}</pre>
    {/if}
    <button onclick={() => { image = null; result = null; error = null }}>New image</button>
  {/if}
</main>

<style>
  main { max-width: 960px; margin: 0 auto; padding: 1rem; font-family: system-ui, sans-serif; }
  .raw-svg :global(svg) { max-width: 100%; height: auto; border: 1px solid #ddd; }
  .error { color: #c0392b; }
</style>
```

- [ ] **Step 4: Verify manually**

Run: `npm run dev`. Drop a small logo PNG → SVG renders below, stats visible. Paste (Cmd+V) a screenshot → same. Drop a `.txt` file → decode error message. `npx vitest run` still all green; `npm run build` succeeds.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: dropzone, decode with 4096px clamp, minimal app wiring"`

---

### Task 12: CompareView (shared zoom/pan + divider)

**Files:**
- Create: `src/lib/CompareView.svelte`
- Modify: `src/App.svelte` (replace `.raw-svg` block with CompareView)

**Interfaces:**
- Consumes: `RasterImage`, svg string.
- Produces: `CompareView.svelte` props: `{ image: RasterImage, svg: string }`. Wheel = zoom around cursor; drag = pan; vertical divider draggable, bitmap left of it, SVG right.

- [ ] **Step 1: Implement**

```svelte
<!-- src/lib/CompareView.svelte -->
<script lang="ts">
  import type { RasterImage } from '../types'

  let { image, svg }: { image: RasterImage; svg: string } = $props()

  let zoom = $state(1)
  let panX = $state(0)
  let panY = $state(0)
  let divider = $state(50) // percent
  let container: HTMLDivElement
  let canvas = $state<HTMLCanvasElement | null>(null)
  let panning = false
  let draggingDivider = false
  let lastX = 0, lastY = 0

  $effect(() => {
    if (!canvas) return
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  })

  function wheel(e: WheelEvent) {
    e.preventDefault()
    const rect = container.getBoundingClientRect()
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top
    const factor = Math.exp(-e.deltaY * 0.002)
    const next = Math.min(64, Math.max(0.1, zoom * factor))
    panX = cx - (cx - panX) * (next / zoom)
    panY = cy - (cy - panY) * (next / zoom)
    zoom = next
  }
  function down(e: PointerEvent) {
    panning = true; lastX = e.clientX; lastY = e.clientY
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent) {
    if (draggingDivider) {
      const rect = container.getBoundingClientRect()
      divider = Math.min(98, Math.max(2, ((e.clientX - rect.left) / rect.width) * 100))
    } else if (panning) {
      panX += e.clientX - lastX; panY += e.clientY - lastY
      lastX = e.clientX; lastY = e.clientY
    }
  }
  function up() { panning = false; draggingDivider = false }
</script>

<div
  class="compare" bind:this={container}
  onwheel={wheel} onpointerdown={down} onpointermove={move} onpointerup={up}
  role="img" aria-label="Compare original and vectorized"
>
  <div class="layer" style:transform={`translate(${panX}px, ${panY}px) scale(${zoom})`}
       style:clip-path={`inset(0 ${100 - divider}% 0 0)`}>
    <canvas bind:this={canvas} style:image-rendering="pixelated"></canvas>
  </div>
  <div class="layer" style:transform={`translate(${panX}px, ${panY}px) scale(${zoom})`}
       style:clip-path={`inset(0 0 0 ${divider}%)`}>
    {@html svg}
  </div>
  <div class="divider" style:left={`${divider}%`}
       onpointerdown={(e) => { e.stopPropagation(); draggingDivider = true; (e.target as Element).setPointerCapture(e.pointerId) }}
       onpointermove={move} onpointerup={up}
       role="separator" aria-label="Comparison divider" tabindex="0"></div>
</div>

<style>
  .compare {
    position: relative; overflow: hidden; height: 70vh;
    border: 1px solid #ddd; border-radius: 8px; background:
      repeating-conic-gradient(#f0f0f0 0% 25%, #fff 0% 50%) 0 0 / 16px 16px;
    touch-action: none; cursor: grab;
  }
  .layer { position: absolute; inset: 0; transform-origin: 0 0; }
  .layer :global(svg), .layer canvas { display: block; width: auto; height: auto; }
  .divider {
    position: absolute; top: 0; bottom: 0; width: 8px; margin-left: -4px;
    cursor: col-resize; background: transparent;
  }
  .divider::after {
    content: ''; position: absolute; inset: 0 3px; background: #4a90d9;
  }
</style>
```

Important detail: both layers get the SAME transform, so bitmap pixel (x, y) and SVG coordinate (x, y) land on the same screen point — the SVG must render at its intrinsic `viewBox` size (`width`/`height` attributes absent, CSS leaves it at viewBox scale). If sizes mismatch on first render, set explicit `width={image.width}` `height={image.height}` on the svg element string in App before passing (string replace on `<svg ` is acceptable).

- [ ] **Step 2: Wire into App**

In `src/App.svelte` replace the `.raw-svg` div with:

```svelte
<CompareView {image} svg={result.svg} />
```

(adding `import CompareView from './lib/CompareView.svelte'`; keep the stats `<pre>` for now).

- [ ] **Step 3: Verify manually**

`npm run dev`: drop a logo → left half bitmap, right half SVG; wheel-zoom deep on an edge — bitmap shows pixels/anti-aliasing, SVG shows a crisp curve tracking the same edge; divider drags; pan works. `npm run build` succeeds.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: compare view with shared zoom/pan and divider"`

---

### Task 13: Controls, debounced re-runs, stats, download

**Files:**
- Create: `src/lib/Controls.svelte`
- Modify: `src/App.svelte`

**Interfaces:**
- Consumes: `PipelineOptions`, `PipelineStats`.
- Produces: `Controls.svelte` props:

```ts
{
  options: PipelineOptions           // bindable ($bindable)
  stats: PipelineStats | null
  svg: string | null
  onchange: () => void               // fired on any option change
}
```

- [ ] **Step 1: Implement Controls**

```svelte
<!-- src/lib/Controls.svelte -->
<script lang="ts">
  import type { PipelineOptions, PipelineStats } from '../types'

  let { options = $bindable(), stats, svg, onchange }: {
    options: PipelineOptions
    stats: PipelineStats | null
    svg: string | null
    onchange: () => void
  } = $props()

  function download() {
    if (!svg) return
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'vectorized.svg'; a.click()
    URL.revokeObjectURL(url)
  }
  const totalMs = (s: PipelineStats) =>
    Object.values(s.timings).reduce((a, b) => a + (b ?? 0), 0).toFixed(0)
</script>

<div class="controls">
  <label>
    Colors
    <select
      value={options.colorCount === 'auto' ? 'auto' : String(options.colorCount)}
      onchange={(e) => {
        const v = (e.target as HTMLSelectElement).value
        options.colorCount = v === 'auto' ? 'auto' : Number(v)
        onchange()
      }}>
      <option value="auto">auto</option>
      {#each Array.from({ length: 15 }, (_, i) => i + 2) as k}
        <option value={String(k)}>{k}</option>
      {/each}
    </select>
  </label>
  <label>
    Smoothness
    <input type="range" min="0" max="1" step="0.05" bind:value={options.smoothness} oninput={onchange} />
  </label>
  <label>
    Despeckle
    <input type="range" min="1" max="64" step="1" bind:value={options.despeckleSize} oninput={onchange} />
  </label>
  <button onclick={download} disabled={!svg}>Download SVG</button>
  {#if stats}
    <span class="stats">
      {stats.pathCount} paths · {stats.pointCount} points · {totalMs(stats)} ms
    </span>
  {/if}
</div>

<style>
  .controls { display: flex; gap: 1.5rem; align-items: center; flex-wrap: wrap; padding: 0.75rem 0; }
  label { display: flex; gap: 0.5rem; align-items: center; font-size: 0.9rem; color: #444; }
  .stats { color: #888; font-size: 0.85rem; margin-left: auto; }
</style>
```

- [ ] **Step 2: Debounced re-run in App**

Add to `src/App.svelte`:

```ts
let options = $state({ ...DEFAULT_OPTIONS })
let debounce: ReturnType<typeof setTimeout> | undefined

function rerun() {
  clearTimeout(debounce)
  debounce = setTimeout(async () => {
    if (!image) return
    client.cancel() // drop any in-flight job (worker cache survives? NO — see note)
    try {
      result = await client.vectorize($state.snapshot(image), $state.snapshot(options), s => (stage = s))
      stage = null
    } catch (e) {
      if ((e as Error).message !== 'cancelled') error = (e as Error).message
      stage = null
    }
  }, 150)
}
```

**Note on cancel vs cache:** `cancel()` terminates the worker, which also destroys its stage cache — making the caching useless for slider drags. Fix in the same step: in `VectorizerClient.vectorize`, if a job is pending, don't terminate — just let the stale result be ignored (jobId check already handles this) and queue the new request. Only expose hard `cancel()` for the "New image" button. Implement by removing `client.cancel()` from `rerun()` and relying on jobId staleness; the worker processes messages serially so the newest request runs last.

And render:

```svelte
<Controls bind:options {stats} svg={result?.svg ?? null} onchange={rerun} />
```

with `stats = result?.stats ?? null` derived (`const stats = $derived(result?.stats ?? null)`).

- [ ] **Step 3: Verify manually**

`npm run dev`: drag smoothness slider — stats line updates, only `fit`/`svg` timings change on re-runs after the first (check `timings` keys in devtools or temporarily log). Change colors 2→4 → full re-run. Download button saves a valid `.svg` that opens in the browser. Full test suite + build still green.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: controls with debounced staged re-runs, stats, download"`

---

### Task 14: Error toast polish + cancel/respawn + final QA

**Files:**
- Modify: `src/App.svelte` (toast display, New-image uses hard cancel)
- Create: `fixtures/README.md`

**Interfaces:**
- Consumes: everything.
- Produces: finished v1 per spec.

- [ ] **Step 1: Toast for worker errors**

In `src/App.svelte`, render worker errors as a dismissible toast naming the failed stage (the client already formats `"{stage}: {message}"`):

```svelte
{#if error}
  <div class="toast" role="alert">
    {error}
    <button onclick={() => (error = null)}>×</button>
  </div>
{/if}
```

```css
.toast {
  position: fixed; bottom: 1rem; right: 1rem; background: #c0392b; color: white;
  padding: 0.75rem 1rem; border-radius: 6px; display: flex; gap: 1rem; align-items: center;
}
.toast button { background: none; border: none; color: white; cursor: pointer; font-size: 1rem; }
```

"New image" button calls `client.cancel()` (hard terminate + respawn) before clearing state.

- [ ] **Step 2: Fixtures note**

```markdown
<!-- fixtures/README.md -->
# Fixtures

Drop real logo PNGs/JPEGs here for manual regression checks: run `npm run dev`,
load each fixture, and eyeball the compare view at deep zoom (edges should be
crisp and track the bitmap edge through the anti-aliasing, corners sharp,
no seams between adjacent regions). Not committed test assets — gitignored
except this README.
```

Add to `.gitignore`: `fixtures/*` and `!fixtures/README.md`.

- [ ] **Step 3: Full verification pass**

- `npx vitest run` → all green.
- `npm run build && npm run preview` → app works in production build (workers bundle differently in prod; this catches it).
- Manual QA checklist: drop PNG ✓, paste ✓, undecodable file shows dropzone error ✓, >4096px image shows downscale notice ✓, deep zoom shows sub-pixel-crisp edges ✓, slider re-runs are fast (fit-only) ✓, download opens in browser ✓, New image resets cleanly ✓.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: error toasts, fixtures dir, v1 polish"`

---

## Self-review notes (completed during plan writing)

- **Spec coverage:** palette/segment/boundaries/corners/fit/svg → Tasks 3–8; orchestrator+progress → 9; worker protocol, cancel, stage caching → 10; dropzone/paste/decode/4096 clamp → 11; compare view with shared coordinate space + divider + deep zoom → 12; controls/debounce/stats/download → 13; toasts + fixtures + prod QA → 14. Round-trip e2e (spec's "rasterize a known SVG") is implemented with the analytic supersampled rasterizer — same intent, no extra deps. UI smoke testing is the manual QA checklist in Task 14 (spec allows "smoke test at most").
- **Known risk (flagged in spec review):** diagonal edges make both flanking pixels partial; Task 5 Step 4 contains the contingency (pick coverage farthest from {0,1}).
- **Type consistency check:** `estimatePalette`/`segmentImage`/`extractBoundaries`/`findCorners`/`fitLoop`/`assembleSvg`/`vectorize`/`firstDirtyStage` signatures are used identically in Tasks 9 and 10; `Cubic` defined once in fitcurves and imported elsewhere.
