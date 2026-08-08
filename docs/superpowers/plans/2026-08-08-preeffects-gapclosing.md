# Pre-effects, Gap Closing, Upscale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bitmap pre-effects (levels/blur/saturation) as a new pipeline stage, guarded morphological gap closing for dashed thin strokes, and decode-time upscaling, per `docs/superpowers/specs/2026-08-08-preeffects-hysteresis-design.md`.

**Architecture:** `preprocess.ts` is a new pure module feeding every downstream stage; the worker gains a `pre` cache tier and ships the preprocessed bitmap back for the compare view. Gap closing is a labeling post-pass inside `segment.ts`. Upscale happens at decode on the main thread (a scale change is a new image).

**Tech Stack:** Existing only — Svelte 5, TS strict, Vitest. No new dependencies.

## Global Constraints

- Defaults (exact): `blackPoint: 0`, `whitePoint: 255`, `blurRadius: 0`, `saturation: 1`, `gapClosing: 0`, upscale `1`.
- Identity pre-options ⇒ `preprocess` returns the input **object unchanged** (same reference), no `pre` timing entry, no `pre` progress event, no `preImage` in the worker result.
- `gapClosing: 0` ⇒ segmentation byte-identical to current behavior.
- Guard constant for gap closing: flip pixel to color c only if `√d_c ≤ 1.3 × √d_current` (exact value 1.3).
- Pipeline purity (no DOM in `src/worker/pipeline/`), determinism (mulberry32 only), TS strict, no `any`.
- Full suite + `npm run check` + `npm run build` green before every commit; conventional commits.

## File Structure

| File | Change |
|---|---|
| `src/worker/pipeline/preprocess.ts` | NEW: PreOptions, isIdentityPre, preprocess (blur→saturation→levels) |
| `src/types.ts` | 5 new PipelineOptions fields, `'pre'` in StageName, preImage on result message, ClientResult |
| `src/worker/pipeline/index.ts` | pre stage in vectorize() |
| `src/worker/vectorize.worker.ts` | pre cache tier, preImage in result post |
| `src/lib/workerClient.ts` | preImage passthrough |
| `src/worker/pipeline/segment.ts` | gap-closing post-pass, `gapClosing` param |
| `src/lib/decode.ts` | upscale parameter |
| `src/App.svelte` | retain source blob, upscale state, displayImage |
| `src/lib/Controls.svelte` | Input row (upscale/levels/blur/saturation/reset), Gap closing slider |
| `src/lib/CompareView.svelte` | dimension-keyed refit |
| `tests/preprocess.test.ts` (NEW), `tests/segment.test.ts`, `tests/workerCache.test.ts`, `tests/e2e.test.ts`, `tests/decode.test.ts` (NEW) | coverage |

---

### Task 1: preprocess module

**Files:**
- Create: `src/worker/pipeline/preprocess.ts`
- Test: `tests/preprocess.test.ts`

**Interfaces:**
- Consumes: `RasterImage` from `src/types.ts`; `mulberry32` from `./palette` (tests only).
- Produces (Task 2 depends on these exact names):

```ts
export interface PreOptions {
  blackPoint: number  // 0–254
  whitePoint: number  // 1–255
  blurRadius: number  // 0–10 px
  saturation: number  // 0–2
}
export const IDENTITY_PRE: PreOptions
export function isIdentityPre(o: PreOptions): boolean
export function preprocess(image: RasterImage, opts: PreOptions): RasterImage
```

- [ ] **Step 1: Write failing tests**

```ts
// tests/preprocess.test.ts
import { describe, it, expect } from 'vitest'
import { preprocess, IDENTITY_PRE } from '../src/worker/pipeline/preprocess'
import { mulberry32 } from '../src/worker/pipeline/palette'
import type { RasterImage } from '../src/types'

function flat(width: number, height: number, rgb: [number, number, number]): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < data.length; p += 4) data.set([...rgb, 255], p)
  return { width, height, data }
}

describe('preprocess', () => {
  it('identity options return the same object reference', () => {
    const img = flat(8, 8, [100, 150, 200])
    expect(preprocess(img, { ...IDENTITY_PRE })).toBe(img)
  })

  it('levels: endpoints and midpoint map exactly', () => {
    const img = flat(2, 1, [50, 125, 200])
    const out = preprocess(img, { ...IDENTITY_PRE, blackPoint: 50, whitePoint: 200 })
    expect(out.data[0]).toBe(0)     // 50 -> black
    expect(out.data[2]).toBe(255)   // 200 -> white
    expect(Math.abs(out.data[1] - 128)).toBeLessThanOrEqual(1) // 125 -> mid
  })

  it('saturation 0 produces grayscale (R=G=B)', () => {
    const out = preprocess(flat(2, 2, [200, 50, 100]), { ...IDENTITY_PRE, saturation: 0 })
    for (let p = 0; p < out.data.length; p += 4) {
      expect(out.data[p]).toBe(out.data[p + 1])
      expect(out.data[p + 1]).toBe(out.data[p + 2])
    }
  })

  it('blur preserves mean (±1) and reduces variance on noise', () => {
    const w = 64, h = 64
    const img = flat(w, h, [128, 128, 128])
    const rand = mulberry32(42)
    for (let p = 0; p < img.data.length; p += 4) {
      const v = 128 + (rand() - 0.5) * 100
      img.data[p] = v; img.data[p + 1] = v; img.data[p + 2] = v
    }
    const stats = (d: Uint8ClampedArray) => {
      let sum = 0, sq = 0, n = 0
      for (let p = 0; p < d.length; p += 4) { sum += d[p]; sq += d[p] * d[p]; n++ }
      const mean = sum / n
      return { mean, variance: sq / n - mean * mean }
    }
    const before = stats(img.data)
    const out = preprocess(img, { ...IDENTITY_PRE, blurRadius: 2 })
    const after = stats(out.data)
    expect(Math.abs(after.mean - before.mean)).toBeLessThan(1)
    expect(after.variance).toBeLessThan(before.variance * 0.3)
  })

  it('whitePoint <= blackPoint is guarded (no division blowup)', () => {
    const out = preprocess(flat(2, 1, [100, 100, 100]), { ...IDENTITY_PRE, blackPoint: 200, whitePoint: 100 })
    for (let p = 0; p < out.data.length; p += 4) expect(Number.isFinite(out.data[p])).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/preprocess.test.ts` → module not found.

- [ ] **Step 3: Implement**

```ts
// src/worker/pipeline/preprocess.ts
import type { RasterImage } from '../../types'

export interface PreOptions {
  blackPoint: number
  whitePoint: number
  blurRadius: number
  saturation: number
}

export const IDENTITY_PRE: PreOptions = { blackPoint: 0, whitePoint: 255, blurRadius: 0, saturation: 1 }

export function isIdentityPre(o: PreOptions): boolean {
  return o.blackPoint === 0 && o.whitePoint === 255 && o.blurRadius === 0 && o.saturation === 1
}

const clampi = (i: number, n: number) => (i < 0 ? 0 : i >= n ? n - 1 : i)

/** One 2-D box pass (horizontal then vertical sliding window), RGB channels, edge-clamped. */
function boxBlurPass(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
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

export function preprocess(image: RasterImage, opts: PreOptions): RasterImage {
  if (isIdentityPre(opts)) return image
  const { width: w, height: h } = image
  let data = new Float32Array(image.data)
  if (opts.blurRadius > 0) {
    const r = Math.max(1, Math.round(opts.blurRadius))
    for (let i = 0; i < 3; i++) data = boxBlurPass(data, w, h, r) // 3 passes ≈ gaussian
  }
  const black = opts.blackPoint
  const white = Math.max(opts.whitePoint, black + 1)
  const scale = 255 / (white - black)
  const sat = opts.saturation
  const out = new Uint8ClampedArray(data.length)
  for (let p = 0; p < data.length; p += 4) {
    let r = data[p], g = data[p + 1], b = data[p + 2]
    if (sat !== 1) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      r = lum + (r - lum) * sat
      g = lum + (g - lum) * sat
      b = lum + (b - lum) * sat
    }
    out[p] = (r - black) * scale       // Uint8ClampedArray clamps + rounds
    out[p + 1] = (g - black) * scale
    out[p + 2] = (b - black) * scale
    out[p + 3] = 255
  }
  return { width: w, height: h, data: out }
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/preprocess.test.ts`, then full suite.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: bitmap preprocess module (levels, blur, saturation)"`

---

### Task 2: Pipeline + worker integration of the pre stage

**Files:**
- Modify: `src/types.ts`, `src/worker/pipeline/index.ts`, `src/worker/vectorize.worker.ts`, `src/lib/workerClient.ts`
- Test: `tests/workerCache.test.ts`, `tests/e2e.test.ts`

**Interfaces:**
- Consumes: Task 1's `preprocess`/`isIdentityPre`/`PreOptions`.
- Produces:

```ts
// types.ts changes
export type StageName = 'pre' | 'palette' | 'segment' | 'boundaries' | 'corners' | 'fit' | 'svg'
// PipelineOptions gains (defaults in DEFAULT_OPTIONS):
blackPoint: number   // 0
whitePoint: number   // 255
blurRadius: number   // 0
saturation: number   // 1
// result message variant becomes:
| { type: 'result'; jobId: number; result: VectorResult; preImage?: RasterImage }
// new: what the client resolves with
export type ClientResult = VectorResult & { preImage?: RasterImage }
```

`VectorizerClient.vectorize` returns `Promise<ClientResult>`. Worker includes `preImage` only when pre is non-identity (plain postMessage — structured clone, never transfer).

- [ ] **Step 1: Write failing tests**

`tests/workerCache.test.ts` — UPDATE two existing expectations (image-change and no-prev now route to `'pre'`) and add pre-field cases:

```ts
it('new image -> pre', () =>
  expect(firstDirtyStage(base, base, false)).toBe('pre'))     // was 'palette'
it('no prev -> pre', () =>
  expect(firstDirtyStage(null, base, true)).toBe('pre'))      // was 'palette'
it('blackPoint change -> pre', () =>
  expect(firstDirtyStage(base, { ...base, blackPoint: 40 }, true)).toBe('pre'))
it('blurRadius change -> pre', () =>
  expect(firstDirtyStage(base, { ...base, blurRadius: 2 }, true)).toBe('pre'))
```

`tests/e2e.test.ts` additions:

```ts
it('non-identity pre runs first and appears in timings', () => {
  const img = renderShape(96, 96, insideCircle(48, 48, 30), [200, 30, 30], [245, 245, 245])
  const stages: string[] = []
  const { stats } = vectorize(img, { ...DEFAULT_OPTIONS, blackPoint: 20 }, s => stages.push(s))
  expect(stages[0]).toBe('pre')
  expect(stats.timings.pre).toBeGreaterThanOrEqual(0)
  expect(stats.pathCount).toBe(2) // mild levels don't change the circle result
})

it('identity pre is skipped entirely', () => {
  const img = renderShape(96, 96, insideCircle(48, 48, 30), [200, 30, 30], [245, 245, 245])
  const stages: string[] = []
  const { stats } = vectorize(img, DEFAULT_OPTIONS, s => stages.push(s))
  expect(stages).not.toContain('pre')
  expect(stats.timings.pre).toBeUndefined()
})
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

`src/types.ts`: apply the Interfaces block above (add 4 fields + defaults, `'pre'` first in StageName, `preImage` on the result variant, `ClientResult`).

`src/worker/pipeline/index.ts` — at the top of `vectorize()`:

```ts
import { preprocess, isIdentityPre, type PreOptions } from './preprocess'

const preOpts: PreOptions = {
  blackPoint: options.blackPoint, whitePoint: options.whitePoint,
  blurRadius: options.blurRadius, saturation: options.saturation,
}
const src = isIdentityPre(preOpts) ? image : stage('pre', () => preprocess(image, preOpts))
```

Every downstream use of `image` inside `vectorize()` becomes `src` — EXCEPT `assembleSvg`'s width/height, which are identical either way. (`estimatePalette(src, …)`, `segmentImage(src, …)`, `extractBoundaries(src, …)`.)

`src/worker/vectorize.worker.ts`:
- `ORDER` becomes `['pre', 'palette', 'segment', 'boundaries', 'corners', 'fit', 'svg']`.
- `firstDirtyStage`:

```ts
export function firstDirtyStage(
  prev: PipelineOptions | null, next: PipelineOptions, sameImage: boolean,
): StageName {
  if (!prev || !sameImage) return 'pre'
  if (prev.blackPoint !== next.blackPoint || prev.whitePoint !== next.whitePoint ||
      prev.blurRadius !== next.blurRadius || prev.saturation !== next.saturation) return 'pre'
  if (prev.colorCount !== next.colorCount) return 'palette'
  if (prev.despeckleSize !== next.despeckleSize) return 'segment'
  return 'fit'
}
```

- Cache gains `pre?: RasterImage`. In `run()`, before the palette stage:

```ts
const preOpts: PreOptions = { blackPoint: options.blackPoint, whitePoint: options.whitePoint, blurRadius: options.blurRadius, saturation: options.saturation }
const identity = isIdentityPre(preOpts)
if (fromIdx <= ORDER.indexOf('pre') || !cache.pre)
  cache.pre = identity ? image : stage('pre', () => preprocess(image, preOpts))
const src = cache.pre
```

Palette/segment/boundaries stages consume `src`. The result post becomes:

```ts
post({ type: 'result', jobId, result: { svg, stats: { pathCount, pointCount, timings } }, ...(identity ? {} : { preImage: src }) })
```

(plain postMessage clones `src`; the cached copy stays intact — never pass a transfer list.)

`src/lib/workerClient.ts`: return type `Promise<ClientResult>`; on result: `resolve({ ...m.result, preImage: m.preImage })`.

- [ ] **Step 4: Run to verify pass** — full suite + `npm run check` + `npm run build`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: pre-effects pipeline stage with worker cache tier and preImage"`

---

### Task 3: Gap closing

**Files:**
- Modify: `src/types.ts` (gapClosing field), `src/worker/pipeline/segment.ts`, `src/worker/pipeline/index.ts` + `src/worker/vectorize.worker.ts` (pass param, cache tier)
- Test: `tests/segment.test.ts`, `tests/workerCache.test.ts`

**Interfaces:**
- Consumes: existing segmentation internals.
- Produces: `segmentImage(image: RasterImage, palette: Palette, despeckleSize: number, gapClosing?: number)` (default 0); `PipelineOptions.gapClosing: number` (default 0).

- [ ] **Step 1: Write failing tests**

Append to `tests/segment.test.ts`:

```ts
import { vectorize } from '../src/worker/pipeline'
import { DEFAULT_OPTIONS } from '../src/types'
import { mulberry32 } from '../src/worker/pipeline/palette'

const INK = 30, PAPER = 245

function strokesFixture(withThin: boolean): RasterImage {
  const w = 120, h = 64
  const data = new Uint8ClampedArray(w * h * 4)
  const rand = mulberry32(7)
  for (let p = 0; p < data.length; p += 4) {
    const v = PAPER + (rand() - 0.5) * 16 // paper texture noise
    data[p] = v; data[p + 1] = v; data[p + 2] = v; data[p + 3] = 255
  }
  const set = (x: number, y: number, v: number) => {
    const o = (y * w + x) * 4
    data[o] = v; data[o + 1] = v; data[o + 2] = v
  }
  for (let y = 40; y < 48; y++) for (let x = 8; x < 112; x++) set(x, y, INK) // thick anchor
  if (withThin)
    for (let x = 8; x < 112; x++) {
      const cov = 0.5 + 0.1 * Math.sin(x * 1.1) // oscillates 40–60% ink
      set(x, 20, INK * cov + PAPER * (1 - cov))
    }
  return { width: w, height: h, data }
}

function inkRegionCount(img: RasterImage, gapClosing: number): number {
  const pal = estimatePalette(img, 2)
  const seg = segmentImage(img, pal, 4, gapClosing)
  // ink palette index = darker color
  const lum = (i: number) => pal.colors[3 * i] + pal.colors[3 * i + 1] + pal.colors[3 * i + 2]
  const ink = lum(0) < lum(1) ? 0 : 1
  let count = 0
  for (let r = 0; r < seg.regionCount; r++) if (seg.regionColor[r] === ink) count++
  return count
}

describe('gap closing', () => {
  it('gapClosing 0 fragments the oscillating thin stroke (the bug exists)', () => {
    expect(inkRegionCount(strokesFixture(true), 0)).toBeGreaterThan(2)
  })

  it('gapClosing 2 connects the thin stroke: exactly anchor + one stroke', () => {
    expect(inkRegionCount(strokesFixture(true), 2)).toBe(2)
  })

  it('guard: two clean parallel strokes 3px apart do NOT weld', () => {
    const w = 120, h = 64
    const data = new Uint8ClampedArray(w * h * 4)
    for (let p = 0; p < data.length; p += 4) { data[p] = PAPER; data[p + 1] = PAPER; data[p + 2] = PAPER; data[p + 3] = 255 }
    const set = (x: number, y: number) => { const o = (y * w + x) * 4; data[o] = INK; data[o + 1] = INK; data[o + 2] = INK }
    for (let x = 8; x < 112; x++) { set(x, 20); set(x, 24) } // rows 20 and 24, clean paper between
    const img: RasterImage = { width: w, height: h, data }
    expect(inkRegionCount(img, 2)).toBe(2) // still two separate strokes
  })

  it('gapClosing 0 is byte-identical to previous behavior', () => {
    const img = strokesFixture(false)
    const pal = estimatePalette(img, 2)
    const a = segmentImage(img, pal, 4, 0)
    const b = segmentImage(img, pal, 4) // default param
    expect([...a.labelMap]).toEqual([...b.labelMap])
  })
})
```

Append to `tests/workerCache.test.ts`:

```ts
it('gapClosing change -> segment', () =>
  expect(firstDirtyStage(base, { ...base, gapClosing: 2 }, true)).toBe('segment'))
```

(Adjust imports at the top of segment.test.ts to include what the new tests use.)

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

`src/types.ts`: add `gapClosing: number` to `PipelineOptions` (comment `// 0–3 px, bridges dashed thin strokes`), `gapClosing: 0` to `DEFAULT_OPTIONS`.

`src/worker/pipeline/segment.ts`: add the post-pass between nearest-color labeling and connected components. The existing function computes `colorIdx` first — insert after that:

```ts
export function segmentImage(image: RasterImage, palette: Palette, despeckleSize: number, gapClosing = 0): Segmentation {
  // ... existing colorIdx computation ...
  if (gapClosing > 0) closeGaps(colorIdx, image, palette, Math.min(3, Math.round(gapClosing)))
  // ... existing connected components + despeckle, unchanged ...
}

/** Chebyshev-window min/max filter, two 1-D passes. isMax=true → dilate, false → erode. */
function minMaxFilter(src: Uint8Array, dst: Uint8Array, w: number, h: number, r: number, isMax: boolean): void {
  const tmp = new Uint8Array(src.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = src[y * w + x]
      for (let d = -r; d <= r; d++) {
        const xx = x + d
        if (xx < 0 || xx >= w) continue
        const s = src[y * w + xx]
        v = isMax ? Math.max(v, s) : Math.min(v, s)
      }
      tmp[y * w + x] = v
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x]
      for (let d = -r; d <= r; d++) {
        const yy = y + d
        if (yy < 0 || yy >= h) continue
        const s = tmp[yy * w + x]
        v = isMax ? Math.max(v, s) : Math.min(v, s)
      }
      dst[y * w + x] = v
    }
}

function closeGaps(colorIdx: Int32Array, image: RasterImage, palette: Palette, r: number): void {
  const { width: w, height: h, data } = image
  const n = w * h
  const freq = new Int32Array(palette.k)
  for (let p = 0; p < n; p++) freq[colorIdx[p]]++
  const order = [...Array(palette.k).keys()].sort((a, b) => freq[a] - freq[b] || a - b)
  const bg = order[order.length - 1] // most common color never closes
  const dist = (p: number, c: number): number => {
    const dr = data[4 * p] - palette.colors[3 * c]
    const dg = data[4 * p + 1] - palette.colors[3 * c + 1]
    const db = data[4 * p + 2] - palette.colors[3 * c + 2]
    return dr * dr + dg * dg + db * db
  }
  const mask = new Uint8Array(n), dil = new Uint8Array(n), closed = new Uint8Array(n)
  const flipped = new Uint8Array(n)
  for (const c of order) {
    if (c === bg || freq[c] === 0) continue
    for (let p = 0; p < n; p++) mask[p] = colorIdx[p] === c ? 1 : 0
    minMaxFilter(mask, dil, w, h, r, true)    // dilate
    minMaxFilter(dil, closed, w, h, r, false) // erode
    for (let p = 0; p < n; p++) {
      if (!closed[p] || colorIdx[p] === c || flipped[p]) continue
      if (Math.sqrt(dist(p, c)) <= 1.3 * Math.sqrt(dist(p, colorIdx[p]))) {
        colorIdx[p] = c
        flipped[p] = 1
      }
    }
  }
}
```

**Note:** the existing `segmentImage` names its per-pixel palette array `colorIdx` — reuse it; if the current variable layout differs slightly, adapt the insertion point, not the algorithm.

`src/worker/pipeline/index.ts` and `src/worker/vectorize.worker.ts`: pass `options.gapClosing` as the 4th argument to `segmentImage`. In `firstDirtyStage`, extend the segment tier: `if (prev.despeckleSize !== next.despeckleSize || prev.gapClosing !== next.gapClosing) return 'segment'`.

- [ ] **Step 4: Run to verify pass** — full suite + check + build. If the fragmentation test's `> 2` fails because auto palette merges ink into paper on the fixture, the anchor stroke is doing its job wrong — verify `estimatePalette(img, 2)` returns one dark and one light color before touching thresholds; the fixture, not the algorithm, is the suspect.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: guarded morphological gap closing for dashed thin strokes"`

---

### Task 4: Upscale + UI

**Files:**
- Modify: `src/lib/decode.ts`, `src/App.svelte`, `src/lib/Controls.svelte`, `src/lib/CompareView.svelte`
- Test: `tests/decode.test.ts` (NEW, dimension math only)

**Interfaces:**
- Consumes: `ClientResult.preImage`, `PipelineOptions` pre fields + `gapClosing`.
- Produces:

```ts
// decode.ts
export async function fileToRasterImage(file: Blob, upscale?: 1 | 2 | 3): Promise<DecodeResult> // default 1
export function scaledDims(w: number, h: number, upscale: number): { w: number; h: number; downscaled: boolean } // exported for tests
```

Controls props gain: `upscale: 1 | 2 | 3` ($bindable) and `onupscale: () => void`.

- [ ] **Step 1: Write failing test**

```ts
// tests/decode.test.ts
import { describe, it, expect } from 'vitest'
import { scaledDims } from '../src/lib/decode'

describe('scaledDims', () => {
  it('applies upscale then the 4096 clamp', () => {
    expect(scaledDims(100, 80, 2)).toEqual({ w: 200, h: 160, downscaled: false })
    expect(scaledDims(3000, 1000, 2)).toEqual({ w: 4096, h: 1365, downscaled: true })
    expect(scaledDims(5000, 5000, 1)).toEqual({ w: 4096, h: 4096, downscaled: true })
  })
})
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

`src/lib/decode.ts` — extract the dimension math and add the parameter:

```ts
export function scaledDims(w: number, h: number, upscale: number): { w: number; h: number; downscaled: boolean } {
  const tw = w * upscale, th = h * upscale
  const clamp = Math.min(1, MAX_SIDE / Math.max(tw, th))
  return {
    w: Math.max(1, Math.round(tw * clamp)),
    h: Math.max(1, Math.round(th * clamp)),
    downscaled: clamp < 1,
  }
}

export async function fileToRasterImage(file: Blob, upscale: 1 | 2 | 3 = 1): Promise<DecodeResult> {
  // ...createImageBitmap as today...
  const { w, h, downscaled } = scaledDims(bmp.width, bmp.height, upscale)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // ...fillRect white, drawImage(bmp, 0, 0, w, h), getImageData as today...
  return { image: { width: w, height: h, data: data.data }, downscaled }
}
```

`src/App.svelte` (adapt to the current file — read it first):
- New state: `let sourceFile = $state<Blob | null>(null)`, `let upscale = $state<1 | 2 | 3>(1)`.
- `handleFile` stores `sourceFile = file` and calls a shared `decodeAndRun(file)` which passes `upscale` to `fileToRasterImage`.
- New `onupscale` handler: if `sourceFile`, re-run `decodeAndRun(sourceFile)` (full pipeline; view refits because dimensions change).
- Derived display image for the compare view: `const displayImage = $derived(result?.preImage ?? image)`; pass `image={displayImage}` (keep the sizedSvg injection reading `image.width/height` — identical dims either way).
- "New image" also clears `sourceFile` and resets `upscale = 1`.

`src/lib/Controls.svelte` (adapt to current file):
- Props add `upscale = $bindable()` and `onupscale: () => void`.
- New second row:

```svelte
<div class="controls input-row">
  <label>
    Upscale
    <select bind:value={upscale} onchange={onupscale}>
      <option value={1}>×1</option><option value={2}>×2</option><option value={3}>×3</option>
    </select>
  </label>
  <label>Black point <input type="range" min="0" max="254" step="1" bind:value={options.blackPoint} oninput={onchange} /></label>
  <label>White point <input type="range" min="1" max="255" step="1" bind:value={options.whitePoint} oninput={onchange} /></label>
  <label>Blur <input type="range" min="0" max="10" step="0.5" bind:value={options.blurRadius} oninput={onchange} /></label>
  <label>Saturation <input type="range" min="0" max="2" step="0.05" bind:value={options.saturation} oninput={onchange} /></label>
  <button onclick={() => { options.blackPoint = 0; options.whitePoint = 255; options.blurRadius = 0; options.saturation = 1; onchange() }}>Reset</button>
</div>
```

(`select` with numeric option values needs `bind:value` on a number-typed state — Svelte 5 handles the coercion when the bound variable is typed `1 | 2 | 3`; if the template complains, use string values + explicit Number() conversion in a change handler.)

- First row gains, after Despeckle: `<label>Gap closing <input type="range" min="0" max="3" step="1" bind:value={options.gapClosing} oninput={onchange} /></label>`

`src/lib/CompareView.svelte` — dimension-keyed refit (replace the current fit effect's guard):

```ts
let fittedW = 0, fittedH = 0
$effect(() => {
  const { width, height } = image
  if (!container) return
  if (width === fittedW && height === fittedH) return
  fittedW = width; fittedH = height
  const cw = container.clientWidth, ch = container.clientHeight
  const z = Math.min(1, cw / width, ch / height)
  zoom = z
  panX = (cw - width * z) / 2
  panY = (ch - height * z) / 2
})
```

- [ ] **Step 4: Verify** — full suite + `npm run check` + `npm run build`; dev-server curl smoke. Manual QA (deferred to human): upscale ×2 re-decodes and refits; levels sliders visibly crush paper texture on the LEFT side (preprocessed bitmap); Gap closing 2 connects a dashed faint stroke; Reset restores identity; zoom/pan survives pre-effect slider drags.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: decode upscale, input pre-effect controls, gap closing slider"`

---

## Self-review notes (completed during plan writing)

- **Spec coverage:** PreOptions/order/identity fast path → Task 1; downstream stages consume preprocessed image + 'pre' StageName/tier/preImage/ClientResult → Task 2; gap closing algorithm incl. guard 1.3, rarest-first, bg-never-closes, flip-once, byte-identity at 0 → Task 3; upscale decode + App blob retention + Input row + Gap closing slider + dimension refit + preprocessed compare feed → Task 4. Stats: 'pre' timing appears automatically via existing per-stage display (map iteration).
- **Type consistency:** `preprocess/isIdentityPre/PreOptions` (T1) used in T2; `segmentImage(image, palette, despeckleSize, gapClosing = 0)` (T3) called with 4 args in both call sites; `ClientResult` (T2) consumed by App in T4; `scaledDims` exported for T4's test.
- **Known risks flagged in-task:** fixture-driven palette behavior (T3 step 4 note); Svelte numeric select coercion (T4 note); segment.ts variable-name adaptation note (T3).
