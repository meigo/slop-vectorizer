# Local Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One movable, resizable, soft-edged circle whose own black/white point is blended into the global levels in the `pre` stage.

**Architecture:** `PipelineOptions.localLevels` (normalised circle + two points, or `null`) flows into `PreOptions`. `preprocess` levels each pixel with both the global and the local points and mixes the results by a smoothstep weight of the pixel's distance from the centre. The palette is estimated with `localLevels` stripped, so circle edits never re-estimate it. The UI side is a pure geometry module (`localGizmo.ts`: screen mapping, hit test, drag rules, placement), a stateless SVG overlay, pointer routing in both panes, and a panel section.

**Tech Stack:** TypeScript, Svelte 5 runes, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-22-local-levels-design.md`

## Global Constraints

- `localLevels` defaults to `null`; with it `null`, output must be **byte-identical** to today (all existing tests pass unchanged).
- Circle coordinates are fractions: `cx` of image width, `cy` of image height, `inner`/`outer` of image **width**. Invariant `outer >= inner > 0`.
- Weight: 1 at `dist <= inner`, 0 at `dist >= outer`, smoothstep between; `inner === outer` is a hard edge.
- Palette never sees `localLevels` (estimated from `globalPre(preOpts)`).
- A `localLevels` change makes `firstDirtyStage` return `'pre'`; structural equality (not reference) decides "changed".
- `src/worker/pipeline/index.ts` and `src/worker/vectorize.worker.ts` are intentionally parallel — apply identical changes to BOTH.
- Style: no semicolons, single quotes, 2-space indent (Prettier). Colours via `var(--color-*)` tokens, except the gizmo's white/black contrast strokes (artwork overlay, documented in place).
- Verification for every task: `npx vitest run`, `npm run check`, `npm run lint`, `npx prettier --check src tests`, `npm run build` — all clean.

---

### Task 1: Pipeline — local levels in `pre`

**Files:**
- Modify: `src/types.ts` (new `LocalLevels`; `PipelineOptions.localLevels`; `DEFAULT_OPTIONS`)
- Modify: `src/worker/pipeline/preprocess.ts` (`PreOptions`, `IDENTITY_PRE`, `isIdentityPre`, new `localWeight`, `sameLocalLevels`, `globalPre`, blend in `preprocess`)
- Modify: `src/worker/vectorize.worker.ts` (`firstDirtyStage`, `preOpts`, palette input)
- Modify: `src/worker/pipeline/index.ts` (`preOpts`, palette input)
- Test: `tests/preprocess.test.ts`, `tests/workerCache.test.ts`, `tests/e2e.test.ts`

**Interfaces:**
- Produces:
  - `export interface LocalLevels { cx: number; cy: number; inner: number; outer: number; blackPoint: number; whitePoint: number }` in `src/types.ts`
  - `PipelineOptions.localLevels: LocalLevels | null`
  - `export function localWeight(d: number, inner: number, outer: number): number`
  - `export function sameLocalLevels(a: LocalLevels | null, b: LocalLevels | null): boolean`
  - `export function globalPre(o: PreOptions): PreOptions`

- [ ] **Step 1: Write the failing tests**

Append to `tests/preprocess.test.ts` (extend the import to `import { preprocess, IDENTITY_PRE, localWeight, sameLocalLevels, globalPre } from '../src/worker/pipeline/preprocess'` and add `import type { LocalLevels } from '../src/types'`):

```ts
describe('localWeight', () => {
  it('is 1 inside the inner radius and 0 beyond the outer', () => {
    expect(localWeight(0, 4, 6)).toBe(1)
    expect(localWeight(4, 4, 6)).toBe(1)
    expect(localWeight(6, 4, 6)).toBe(0)
    expect(localWeight(99, 4, 6)).toBe(0)
  })
  it('falls monotonically across the soft edge', () => {
    let prev = 1
    for (let d = 4; d <= 6; d += 0.1) {
      const w = localWeight(d, 4, 6)
      expect(w).toBeLessThanOrEqual(prev)
      prev = w
    }
    expect(localWeight(5, 4, 6)).toBeCloseTo(0.5)
  })
  it('is a hard edge when inner equals outer', () => {
    expect(localWeight(3.99, 4, 4)).toBe(1)
    expect(localWeight(4.01, 4, 4)).toBe(0)
  })
})

describe('local levels', () => {
  // 20x20 → circle centre (10,10) px, inner 4 px, outer 6 px
  const circle = (blackPoint: number, whitePoint: number): LocalLevels => ({
    cx: 0.5,
    cy: 0.5,
    inner: 0.2,
    outer: 0.3,
    blackPoint,
    whitePoint,
  })
  const at = (img: RasterImage, x: number, y: number) => img.data[(y * img.width + x) * 4]

  it('inside follows the local points, outside the global, the edge lies between', () => {
    const out = preprocess(flat(20, 20, [100, 100, 100]), {
      ...IDENTITY_PRE,
      localLevels: circle(100, 200),
    })
    expect(at(out, 10, 10)).toBe(0) // local: 100 → black
    expect(at(out, 0, 0)).toBe(100) // global identity
    const edge = at(out, 15, 10) // pixel centre 5.5 px from the centre
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(100)
  })

  it('local points equal to the global ones are an identity', () => {
    const img = flat(8, 8, [100, 150, 200])
    expect(preprocess(img, { ...IDENTITY_PRE, localLevels: circle(0, 255) })).toBe(img)
  })

  it('local points equal to non-identity global points change nothing', () => {
    const img = flat(20, 20, [120, 120, 120])
    const g = { ...IDENTITY_PRE, blackPoint: 40, whitePoint: 220 }
    const a = preprocess(img, g)
    const b = preprocess(img, { ...g, localLevels: circle(40, 220) })
    expect(Array.from(b.data)).toEqual(Array.from(a.data))
  })

  it('sameLocalLevels compares by value', () => {
    expect(sameLocalLevels(null, null)).toBe(true)
    expect(sameLocalLevels(circle(1, 2), null)).toBe(false)
    expect(sameLocalLevels(circle(1, 2), circle(1, 2))).toBe(true)
    expect(sameLocalLevels(circle(1, 2), { ...circle(1, 2), cx: 0.4 })).toBe(false)
  })

  it('globalPre strips the circle and keeps everything else', () => {
    const o = { ...IDENTITY_PRE, blackPoint: 9, localLevels: circle(1, 2) }
    expect(globalPre(o)).toEqual({ ...IDENTITY_PRE, blackPoint: 9, localLevels: null })
  })
})
```

Append inside `describe('firstDirtyStage', …)` in `tests/workerCache.test.ts`:

```ts
  const circle = { cx: 0.5, cy: 0.5, inner: 0.1, outer: 0.2, blackPoint: 60, whitePoint: 200 }
  it('localLevels change -> pre', () => {
    expect(firstDirtyStage(base, { ...base, localLevels: circle }, true)).toBe('pre')
    const on = { ...base, localLevels: circle }
    expect(firstDirtyStage(on, { ...on, localLevels: { ...circle, cx: 0.6 } }, true)).toBe('pre')
  })
  it('an equal localLevels copy is not a change', () => {
    const on = { ...base, localLevels: circle }
    expect(firstDirtyStage(on, { ...on, localLevels: { ...circle } }, true)).toBe('fit')
  })
```

Append inside `describe('vectorize round-trip', …)` in `tests/e2e.test.ts`:

```ts
  it('local levels never change the palette when a palette source is given', () => {
    const img = renderShape(96, 96, insideCircle(48, 48, 30), [200, 30, 30], [245, 245, 245])
    const fills = (svg: string) => [...svg.matchAll(/fill="(#[0-9a-f]+)"/g)].map((m) => m[1]).sort()
    const plain = vectorize(img, DEFAULT_OPTIONS, undefined, img)
    const local = vectorize(
      img,
      {
        ...DEFAULT_OPTIONS,
        localLevels: { cx: 0.5, cy: 0.5, inner: 0.2, outer: 0.3, blackPoint: 120, whitePoint: 200 },
      },
      undefined,
      img,
    )
    expect(fills(local.svg)).toEqual(fills(plain.svg))
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/preprocess.test.ts tests/workerCache.test.ts tests/e2e.test.ts`
Expected: FAIL — `localWeight`/`sameLocalLevels`/`globalPre` are not exported; `localLevels` is not a known option (type errors surface in `npm run check`).

- [ ] **Step 3: Add the type**

In `src/types.ts`, above `PipelineOptions`:

```ts
/** A soft-edged circle with its own black/white point, blended into the global levels.
 *  Fractions: cx of image width, cy of image height, inner/outer of image WIDTH (so it stays
 *  round and in place across scale changes). outer >= inner. */
export interface LocalLevels {
  cx: number
  cy: number
  inner: number // full-strength radius
  outer: number // zero-strength radius
  blackPoint: number // 0..254
  whitePoint: number // 1..255
}
```

Add to `PipelineOptions` after `stackedShapes`:

```ts
  localLevels: LocalLevels | null // null = off
```

Add to `DEFAULT_OPTIONS` after `stackedShapes: false,`:

```ts
  localLevels: null,
```

- [ ] **Step 4: Implement in `preprocess.ts`**

Change the import to `import type { LocalLevels, RasterImage } from '../../types'`. Add `localLevels: LocalLevels | null` to `PreOptions` and `localLevels: null,` to `IDENTITY_PRE`. Replace `isIdentityPre` and add the helpers:

```ts
/** A circle whose points equal the global ones changes nothing. */
function localIsNoop(o: PreOptions): boolean {
  const l = o.localLevels
  return !l || (l.blackPoint === o.blackPoint && l.whitePoint === o.whitePoint)
}

export function isIdentityPre(o: PreOptions): boolean {
  return (
    o.blackPoint === 0 &&
    o.whitePoint === 255 &&
    o.blurRadius === 0 &&
    o.saturation === 1 &&
    o.flatten === 0 &&
    localIsNoop(o)
  )
}

/** The pre-effects without the local circle: what palette estimation sees, so moving the circle
 *  never re-estimates the palette (and swatches/overrides stay put). */
export function globalPre(o: PreOptions): PreOptions {
  return { ...o, localLevels: null }
}

export function sameLocalLevels(a: LocalLevels | null, b: LocalLevels | null): boolean {
  if (!a || !b) return a === b
  return (
    a.cx === b.cx &&
    a.cy === b.cy &&
    a.inner === b.inner &&
    a.outer === b.outer &&
    a.blackPoint === b.blackPoint &&
    a.whitePoint === b.whitePoint
  )
}

/** Local-levels strength at distance d: 1 inside inner, 0 beyond outer, smoothstep between
 *  (no visible band at either ring). inner === outer is a hard edge. */
export function localWeight(d: number, inner: number, outer: number): number {
  if (d <= inner) return 1
  if (d >= outer) return 0
  const t = (outer - d) / (outer - inner)
  return t * t * (3 - 2 * t)
}
```

In `preprocess`, replace everything from `const black = opts.blackPoint` to the end of the function with:

```ts
  const black = opts.blackPoint
  const white = Math.max(opts.whitePoint, black + 1)
  const scale = 255 / (white - black)
  const sat = opts.saturation
  // Local circle, in pixels. Each pixel is levelled with the global AND the local points and
  // the two results are mixed by its weight — mixing outputs rather than points keeps the tone
  // mapping monotonic everywhere, so the soft edge cannot halo.
  const local = localIsNoop(opts) ? null : opts.localLevels!
  const lBlack = local?.blackPoint ?? 0
  const lScale = local ? 255 / (Math.max(local.whitePoint, lBlack + 1) - lBlack) : 1
  const lx = (local?.cx ?? 0) * w
  const ly = (local?.cy ?? 0) * h
  const lIn = (local?.inner ?? 0) * w
  const lOut = Math.max(local?.outer ?? 0, local?.inner ?? 0) * w
  const lev = (v: number, b: number, s: number) => Math.min(255, Math.max(0, (v - b) * s))
  const out = new Uint8ClampedArray(working.length)
  for (let p = 0, i = 0; p < working.length; p += 4, i++) {
    let r = working[p],
      g = working[p + 1],
      b = working[p + 2]
    if (sat !== 1) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      r = lum + (r - lum) * sat
      g = lum + (g - lum) * sat
      b = lum + (b - lum) * sat
    }
    const wt = local ? localWeight(Math.hypot((i % w) + 0.5 - lx, ((i / w) | 0) + 0.5 - ly), lIn, lOut) : 0
    if (wt === 0) {
      out[p] = (r - black) * scale // Uint8ClampedArray clamps + rounds
      out[p + 1] = (g - black) * scale
      out[p + 2] = (b - black) * scale
    } else {
      const gr = lev(r, black, scale),
        gg = lev(g, black, scale),
        gb = lev(b, black, scale)
      out[p] = gr + (lev(r, lBlack, lScale) - gr) * wt
      out[p + 1] = gg + (lev(g, lBlack, lScale) - gg) * wt
      out[p + 2] = gb + (lev(b, lBlack, lScale) - gb) * wt
    }
    out[p + 3] = 255
  }
  return { width: w, height: h, data: out }
}
```

- [ ] **Step 5: Wire the worker and the pure pipeline**

`src/worker/vectorize.worker.ts`: change the preprocess import to `import { preprocess, isIdentityPre, globalPre, sameLocalLevels, type PreOptions } from './pipeline/preprocess'`. In `firstDirtyStage`, extend the pre condition:

```ts
    prev.flatten !== next.flatten ||
    !sameLocalLevels(prev.localLevels, next.localLevels)
  )
    return 'pre'
```

In `run`, add `localLevels: options.localLevels,` to the `preOpts` literal, add below `const identity = isIdentityPre(preOpts)`:

```ts
  // The palette never sees the local circle (spec: palette ignores local levels).
  const palOpts = globalPre(preOpts)
  const palIdentity = isIdentityPre(palOpts)
```

Leave `preFieldsChanged` as is (it must NOT include `localLevels`). In the palette stage replace

```ts
        ? identity
          ? palBase
          : (cache.palPre ??= preprocess(palBase, preOpts))
```

with

```ts
        ? palIdentity
          ? palBase
          : (cache.palPre ??= preprocess(palBase, palOpts))
```

`src/worker/pipeline/index.ts`: import `globalPre` alongside `preprocess, isIdentityPre`; add `localLevels: options.localLevels,` to `preOpts`; replace the palette input with:

```ts
  const palOpts = globalPre(preOpts)
  const palette = stage('palette', () => {
    const palInput = paletteImage
      ? isIdentityPre(palOpts)
        ? paletteImage
        : preprocess(paletteImage, palOpts)
      : src
    return estimatePalette(palInput, options.colorCount)
  })
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run && npm run check`
Expected: all tests PASS (existing ones unchanged), 0 check errors.

- [ ] **Step 7: Full verification and commit**

Run: `npm run lint && npx prettier --write src tests && npm run build`

```bash
git add src/types.ts src/worker tests/preprocess.test.ts tests/workerCache.test.ts tests/e2e.test.ts
git commit -m "feat: local levels — a soft-edged circle blended into the pre stage"
```

---

### Task 2: Gizmo geometry (pure)

**Files:**
- Create: `src/lib/localGizmo.ts`
- Test: `tests/localGizmo.test.ts`

**Interfaces:**
- Consumes: `LocalLevels` from `src/types.ts` (Task 1).
- Produces (all exported from `src/lib/localGizmo.ts`):
  - `type GizmoPart = 'move' | 'inner' | 'outer'`
  - `interface ViewXf { zoom: number; panX: number; panY: number }` — `Viewport` satisfies it structurally
  - `interface ScreenCircle { x: number; y: number; inner: number; outer: number }`
  - `const DOT_R = 5`
  - `function hitSlop(coarse: boolean): number` — 18 for touch, 6 otherwise
  - `function toScreen(l: LocalLevels, iw: number, ih: number, v: ViewXf): ScreenCircle`
  - `function hitTest(c: ScreenCircle, px: number, py: number, slop: number): GizmoPart | null`
  - `function applyDrag(start: LocalLevels, part: GizmoPart, iw: number, ih: number, v: ViewXf, from: Point, to: Point): LocalLevels`
  - `function initialLocal(v: ViewXf, paneW: number, paneH: number, iw: number, ih: number, blackPoint: number, whitePoint: number): LocalLevels`
  - `function cursorFor(part: GizmoPart, c: ScreenCircle, px: number, py: number): string`

- [ ] **Step 1: Write the failing test**

Create `tests/localGizmo.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  applyDrag,
  cursorFor,
  hitTest,
  initialLocal,
  toScreen,
  type ViewXf,
} from '../src/lib/localGizmo'
import type { LocalLevels } from '../src/types'

// 200x100 image; circle centre (100,50) px, inner 20 px, outer 40 px
const L: LocalLevels = { cx: 0.5, cy: 0.5, inner: 0.1, outer: 0.2, blackPoint: 10, whitePoint: 240 }
const V1: ViewXf = { zoom: 1, panX: 0, panY: 0 }
const V2: ViewXf = { zoom: 2, panX: 30, panY: -10 }

describe('toScreen', () => {
  it('maps the circle through zoom and pan', () => {
    expect(toScreen(L, 200, 100, V1)).toEqual({ x: 100, y: 50, inner: 20, outer: 40 })
    expect(toScreen(L, 200, 100, V2)).toEqual({ x: 230, y: 90, inner: 40, outer: 80 })
  })
})

describe('hitTest', () => {
  const c = toScreen(L, 200, 100, V2) // (230,90), inner 40, outer 80
  it('finds the centre, the rings, the inside and nothing', () => {
    expect(hitTest(c, 231, 91, 6)).toBe('move')
    expect(hitTest(c, 230 + 40, 90, 6)).toBe('inner')
    expect(hitTest(c, 230, 90 + 81, 6)).toBe('outer')
    expect(hitTest(c, 230 + 25, 90, 6)).toBe('move')
    expect(hitTest(c, 230 + 60, 90, 6)).toBe(null)
    expect(hitTest(c, 230 + 200, 90, 6)).toBe(null)
  })
  it('with overlapping rings, outside grabs the outer and inside the inner', () => {
    const hard = { x: 0, y: 0, inner: 50, outer: 52 }
    expect(hitTest(hard, 53, 0, 6)).toBe('outer')
    expect(hitTest(hard, 48, 0, 6)).toBe('inner')
  })
  it('a wider touch slop reaches further', () => {
    expect(hitTest(c, 230 + 40 + 15, 90, 6)).toBe(null)
    expect(hitTest(c, 230 + 40 + 15, 90, 18)).not.toBe(null)
  })
})

describe('applyDrag', () => {
  it('moves by the pointer delta in image space', () => {
    const m = applyDrag(L, 'move', 200, 100, V2, { x: 0, y: 0 }, { x: 40, y: 20 })
    expect(m.cx).toBeCloseTo(0.5 + 20 / 200)
    expect(m.cy).toBeCloseTo(0.5 + 10 / 100)
    expect(m.inner).toBe(L.inner)
  })
  it('keeps the centre on the image', () => {
    const m = applyDrag(L, 'move', 200, 100, V1, { x: 0, y: 0 }, { x: 9999, y: -9999 })
    expect(m.cx).toBe(1)
    expect(m.cy).toBe(0)
  })
  it('resizes the inner ring by the radial delta, without a jump at grab', () => {
    // grab 3 px outside the inner ring, then move 10 px further out
    const r = applyDrag(L, 'inner', 200, 100, V1, { x: 123, y: 50 }, { x: 133, y: 50 })
    expect(r.inner * 200).toBeCloseTo(30)
    expect(r.outer).toBe(L.outer)
  })
  it('the inner ring pushes the outer one out', () => {
    const r = applyDrag(L, 'inner', 200, 100, V1, { x: 120, y: 50 }, { x: 170, y: 50 })
    expect(r.inner * 200).toBeCloseTo(70)
    expect(r.outer).toBeCloseTo(r.inner)
  })
  it('the outer ring stops at the inner one, and the inner stays positive', () => {
    const o = applyDrag(L, 'outer', 200, 100, V1, { x: 140, y: 50 }, { x: 100, y: 50 })
    expect(o.outer).toBeCloseTo(L.inner)
    const i = applyDrag(L, 'inner', 200, 100, V1, { x: 120, y: 50 }, { x: 100, y: 50 })
    expect(i.inner).toBeGreaterThan(0)
  })
  it('keeps the levels untouched', () => {
    const m = applyDrag(L, 'outer', 200, 100, V1, { x: 140, y: 50 }, { x: 150, y: 50 })
    expect([m.blackPoint, m.whitePoint]).toEqual([10, 240])
  })
})

describe('initialLocal', () => {
  it('centres on the visible area with a quarter of its short side, outer 1.5×', () => {
    // 400x300 pane showing the 200x100 image at zoom 2 from (0,0)
    const l = initialLocal({ zoom: 2, panX: 0, panY: 0 }, 400, 300, 200, 100, 30, 220)
    expect(l.cx).toBeCloseTo(100 / 200)
    expect(l.cy).toBeCloseTo(75 / 100) // visible centre: 150 screen px / zoom 2
    expect(l.inner * 200).toBeCloseTo(300 / 4 / 2)
    expect(l.outer).toBeCloseTo(l.inner * 1.5)
    expect([l.blackPoint, l.whitePoint]).toEqual([30, 220])
  })
})

describe('cursorFor', () => {
  const c = { x: 0, y: 0, inner: 10, outer: 20 }
  it('shows move for the centre and a radial resize for the rings', () => {
    expect(cursorFor('move', c, 0, 0)).toBe('move')
    expect(cursorFor('inner', c, 10, 0)).toBe('ew-resize')
    expect(cursorFor('outer', c, 0, -20)).toBe('ns-resize')
    expect(cursorFor('outer', c, 14, 14)).toBe('nwse-resize')
    expect(cursorFor('inner', c, -7, 7)).toBe('nesw-resize')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/localGizmo.test.ts`
Expected: FAIL — cannot resolve `../src/lib/localGizmo`.

- [ ] **Step 3: Implement**

Create `src/lib/localGizmo.ts`:

```ts
/** Geometry of the local-levels gizmo: a centre dot (move), a solid inner ring (full strength,
 *  resize) and a dashed outer ring (soft edge). Pure, so hit-testing and the drag rules are
 *  testable without a DOM. Screen coordinates are pane-relative CSS pixels. */
import type { LocalLevels } from '../types'
import type { Point } from './viewportMath'

export type GizmoPart = 'move' | 'inner' | 'outer'
/** The slice of Viewport this module reads; Viewport satisfies it structurally. */
export interface ViewXf {
  zoom: number
  panX: number
  panY: number
}
export interface ScreenCircle {
  x: number
  y: number
  inner: number
  outer: number
}

/** Centre dot radius, screen px. */
export const DOT_R = 5
/** How far from a ring a pointer still grabs it: wider for fingers. */
export const hitSlop = (coarse: boolean) => (coarse ? 18 : 6)

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function toScreen(l: LocalLevels, iw: number, ih: number, v: ViewXf): ScreenCircle {
  return {
    x: v.panX + l.cx * iw * v.zoom,
    y: v.panY + l.cy * ih * v.zoom,
    inner: l.inner * iw * v.zoom,
    outer: l.outer * iw * v.zoom,
  }
}

/** Which part a pointer at (px,py) would grab. The dot wins, then the nearer ring (when both
 *  are in reach, the side of the inner ring decides: outside widens the edge, inside resizes);
 *  anywhere else inside the inner ring moves; outside is null (the pane pans). */
export function hitTest(c: ScreenCircle, px: number, py: number, slop: number): GizmoPart | null {
  const d = Math.hypot(px - c.x, py - c.y)
  if (d <= DOT_R + slop / 2) return 'move'
  const nearInner = Math.abs(d - c.inner) <= slop
  const nearOuter = Math.abs(d - c.outer) <= slop
  if (nearInner && nearOuter) return d > c.inner ? 'outer' : 'inner'
  if (nearInner) return 'inner'
  if (nearOuter) return 'outer'
  return d < c.inner ? 'move' : null
}

/** The circle after dragging `part` from `from` to `to` (screen px), starting from `start`.
 *  Rings change by the RADIAL delta, so grabbing a ring a few px off it does not jump. The
 *  inner ring pushes the outer one; the outer stops at the inner; the centre stays on the
 *  image. */
export function applyDrag(
  start: LocalLevels,
  part: GizmoPart,
  iw: number,
  ih: number,
  v: ViewXf,
  from: Point,
  to: Point,
): LocalLevels {
  if (part === 'move') {
    return {
      ...start,
      cx: clamp01(start.cx + (to.x - from.x) / v.zoom / iw),
      cy: clamp01(start.cy + (to.y - from.y) / v.zoom / ih),
    }
  }
  const c = toScreen(start, iw, ih, v)
  const delta =
    (Math.hypot(to.x - c.x, to.y - c.y) - Math.hypot(from.x - c.x, from.y - c.y)) / v.zoom / iw
  if (part === 'inner') {
    const inner = Math.max(1 / iw, start.inner + delta)
    return { ...start, inner, outer: Math.max(start.outer, inner) }
  }
  return { ...start, outer: Math.max(start.inner, start.outer + delta) }
}

/** First-enable placement: centred on the visible part of the image, inner radius a quarter of
 *  the pane's short side, outer 1.5×, carrying the given (current global) points. */
export function initialLocal(
  v: ViewXf,
  paneW: number,
  paneH: number,
  iw: number,
  ih: number,
  blackPoint: number,
  whitePoint: number,
): LocalLevels {
  const inner = Math.min(paneW, paneH) / 4 / v.zoom / iw
  return {
    cx: clamp01((paneW / 2 - v.panX) / v.zoom / iw),
    cy: clamp01((paneH / 2 - v.panY) / v.zoom / ih),
    inner,
    outer: inner * 1.5,
    blackPoint,
    whitePoint,
  }
}

/** Hover cursor: move for the centre, a resize arrow pointing along the radius for a ring. */
export function cursorFor(part: GizmoPart, c: ScreenCircle, px: number, py: number): string {
  if (part === 'move') return 'move'
  const a = ((Math.atan2(py - c.y, px - c.x) * 180) / Math.PI + 360) % 180
  if (a < 22.5 || a >= 157.5) return 'ew-resize'
  if (a < 67.5) return 'nwse-resize'
  if (a < 112.5) return 'ns-resize'
  return 'nesw-resize'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/localGizmo.test.ts`
Expected: PASS.

- [ ] **Step 5: Full verification and commit**

Run: `npx vitest run && npm run check && npm run lint && npx prettier --write src tests && npm run build`

```bash
git add src/lib/localGizmo.ts tests/localGizmo.test.ts
git commit -m "feat: local-levels gizmo geometry — hit test, drag rules, placement"
```

---

### Task 3: Gizmo overlay, pane routing, panel section

**Files:**
- Create: `src/lib/LocalGizmo.svelte`
- Modify: `src/lib/ImagePane.svelte`, `src/lib/CompareView.svelte` (props, pointer routing, overlay)
- Modify: `src/lib/ControlsPanel.svelte` (Local levels section)
- Modify: `src/App.svelte` (state, toggle, placement, reset, props)
- Modify: `README.md` (features list)

**Interfaces:**
- Consumes: everything Task 2 produces; `LocalLevels`; `PipelineOptions.localLevels`.
- Produces (component props):
  - `LocalGizmo`: `{ c: ScreenCircle }`
  - `ImagePane` and `CompareView` gain `local?: LocalLevels | null`, `size?: { width: number; height: number } | null`, `onlocal?: (l: LocalLevels) => void`
  - `ControlsPanel` gains `localOn: boolean`, `local: LocalLevels | null`, `ontogglelocal: () => void`, `onlocal: (l: LocalLevels) => void`

This task is UI; its verification is `npm run check` plus a browser pass (Step 6). No new unit tests — the logic it relies on is Task 2's.

- [ ] **Step 1: Overlay component**

Create `src/lib/LocalGizmo.svelte`:

```svelte
<!-- src/lib/LocalGizmo.svelte -->
<!-- Draws the local-levels circle in pane (screen) coordinates, outside the zoom transform, so
     strokes and the dot keep their size at any zoom. Pointer handling lives in the panes. White
     over a dark halo rather than theme tokens: it sits on ARTWORK, which may be light or dark. -->
<script lang="ts">
  import { DOT_R, type ScreenCircle } from './localGizmo'

  let { c }: { c: ScreenCircle } = $props()
</script>

<svg class="gizmo" aria-hidden="true">
  <g fill="none">
    <circle cx={c.x} cy={c.y} r={c.outer} class="halo" />
    <circle cx={c.x} cy={c.y} r={c.outer} class="ring dashed" />
    <circle cx={c.x} cy={c.y} r={c.inner} class="halo" />
    <circle cx={c.x} cy={c.y} r={c.inner} class="ring" />
  </g>
  <circle cx={c.x} cy={c.y} r={DOT_R} class="dot" />
</svg>

<style>
  .gizmo {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .halo {
    stroke: rgb(0 0 0 / 0.55);
    stroke-width: 3;
  }
  .ring {
    stroke: #fff;
    stroke-width: 1.5;
  }
  .dashed {
    stroke-dasharray: 6 4;
  }
  .dot {
    fill: #fff;
    stroke: rgb(0 0 0 / 0.55);
    stroke-width: 1.5;
  }
</style>
```

- [ ] **Step 2: Route pointers in `ImagePane.svelte`**

Imports: add `import type { LocalLevels } from '../types'`, `import LocalGizmo from './LocalGizmo.svelte'`, `import { applyDrag, cursorFor, hitSlop, hitTest, toScreen, type GizmoPart } from './localGizmo'`.

Props: add to the destructure and its type:

```ts
    local = null,
    size = null,
    onlocal,
```

```ts
    local?: LocalLevels | null
    size?: { width: number; height: number } | null
    onlocal?: (l: LocalLevels) => void
```

Below `const pointers = new Map<number, Point>()` add:

```ts
  const coarse = typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches
  // A gizmo drag in progress: which pointer, what it grabbed, and where it started.
  let gz: { id: number; part: GizmoPart; start: LocalLevels; from: Point } | null = null
  let hoverCursor = $state<string | null>(null)
  const circle = $derived(local && size ? toScreen(local, size.width, size.height, viewport) : null)

  function panePoint(e: PointerEvent): Point {
    const r = el.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
```

Replace `down`, `move`, `up` with:

```ts
  function down(e: PointerEvent) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    ;(e.target as Element).setPointerCapture(e.pointerId)
    // Only a lone pointer can grab the gizmo; a second finger turns it into a pinch.
    const p = panePoint(e)
    const part = pointers.size === 1 && circle ? hitTest(circle, p.x, p.y, hitSlop(coarse)) : null
    gz = part && local ? { id: e.pointerId, part, start: { ...local }, from: p } : null
  }
  function move(e: PointerEvent) {
    if (gz && gz.id === e.pointerId && size) {
      onlocal?.(applyDrag(gz.start, gz.part, size.width, size.height, viewport, gz.from, panePoint(e)))
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      return
    }
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      const p = panePoint(e)
      const part = circle ? hitTest(circle, p.x, p.y, hitSlop(coarse)) : null
      hoverCursor = part && circle ? cursorFor(part, circle, p.x, p.y) : null
    }
    const prev = pointers.get(e.pointerId)
    if (!prev) return
    const cur = { x: e.clientX, y: e.clientY }
    if (pointers.size === 1) {
      viewport.panBy(cur.x - prev.x, cur.y - prev.y)
    } else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1]
      const s = pinchStep(prev, other, cur, other)
      const r = el.getBoundingClientRect()
      viewport.zoomAt(s.cx - r.left, s.cy - r.top, s.factor)
      viewport.panBy(s.dx, s.dy)
    }
    pointers.set(e.pointerId, cur)
  }
  function up(e: PointerEvent) {
    if (gz?.id === e.pointerId) gz = null
    pointers.delete(e.pointerId)
  }
```

Markup: add `style:cursor={hoverCursor}` to the `.pane` div, and before `<span class="pane-label">` add:

```svelte
  {#if circle}<LocalGizmo c={circle} />{/if}
```

- [ ] **Step 3: Same routing in `CompareView.svelte`**

Same imports, props (`local = null, size = null, onlocal` with the same types), the same `coarse` / `gz` / `hoverCursor` / `circle` / `panePoint` block (using `container` instead of `el` in `panePoint`).

Replace `down` with the Step 2 `down`. In `move`, keep the divider branch first, then insert the gizmo-drag and hover blocks from Step 2 before `const prev = pointers.get(e.pointerId)`; the pinch branch stays as it is. In `up`, add `if (gz?.id === e.pointerId) gz = null` before `pointers.delete(e.pointerId)`.

Markup: `style:cursor={hoverCursor}` on the `.compare` div; `{#if circle}<LocalGizmo c={circle} />{/if}` after the second `.clip` div and BEFORE the `.divider` div (the divider must stay on top so it remains draggable).

- [ ] **Step 4: Panel section in `ControlsPanel.svelte`**

Import `import type { LocalLevels, PipelineOptions, PipelineStats } from '../types'` (extend the existing type import). Add props `localOn`, `local`, `ontogglelocal`, `onlocal` to the destructure and:

```ts
    localOn: boolean
    /** The remembered circle; kept while off so re-enabling restores it. */
    local: LocalLevels | null
    ontogglelocal: () => void
    onlocal: (l: LocalLevels) => void
```

Add a snippet next to `slider`:

```svelte
{#snippet localSlider(label: string, key: 'blackPoint' | 'whitePoint', min: number, max: number)}
  {#if local}
    <label class="slider-row">
      <span class="name">{label}</span>
      <input
        type="range"
        {min}
        {max}
        step="1"
        value={local[key]}
        style={sliderFill(local[key], min, max)}
        oninput={(e) => onlocal({ ...local!, [key]: Number((e.target as HTMLInputElement).value) })}
      />
      <span class="value">{local[key]}</span>
    </label>
  {/if}
{/snippet}
```

Insert a section between the Input and Output sections:

```svelte
  <section>
    <h2 class="section-head">Local levels</h2>
    <div class="body">
      <button class="wide" class:ui-on={localOn} aria-pressed={localOn} onclick={ontogglelocal}
        >Circle</button
      >
      {#if localOn}
        {@render localSlider('Black point', 'blackPoint', 0, 254)}
        {@render localSlider('White point', 'whitePoint', 1, 255)}
        <p class="hint">Drag the dot to move, the solid ring to resize, the dashed ring to soften.</p>
      {/if}
    </div>
  </section>
```

Add to the style block:

```css
  .wide {
    width: 100%;
    margin-bottom: 4px;
  }
```

- [ ] **Step 5: State and wiring in `App.svelte`**

Imports: `import { initialLocal } from './lib/localGizmo'` and add `LocalLevels` to the `./types` type import.

Below `let showUnmodified = $state(false)` add:

```ts
  // Local levels: the circle is remembered while off, so re-enabling restores it; only the
  // pipeline option goes null. First enable places it on the visible area with the current
  // global points, so turning it on changes nothing until a local slider moves.
  let localOn = $state(false)
  let localSaved = $state<LocalLevels | null>(null)
  function applyLocal() {
    options.localLevels = localOn && localSaved ? $state.snapshot(localSaved) : null
    rerun()
  }
  function toggleLocal() {
    localOn = !localOn
    const img = displayImage
    if (localOn && !localSaved && img)
      localSaved = initialLocal(
        viewport,
        paneW(),
        viewsH,
        img.width,
        img.height,
        options.blackPoint,
        options.whitePoint,
      )
    applyLocal()
  }
  function setLocal(l: LocalLevels) {
    localSaved = l
    applyLocal()
  }
```

(`paneW` is a function declaration further down; hoisting makes the call fine.)

Pass the gizmo to the panes:

```svelte
        <CompareView
          image={displayImage}
          svg={sizedSvg}
          {viewport}
          local={localOn ? localSaved : null}
          size={displayImage}
          onlocal={setLocal}
        />
```

```svelte
        <ImagePane
          image={displayImage}
          label={adjusted ? 'Adjusted' : 'Original'}
          {viewport}
          local={localOn ? localSaved : null}
          size={displayImage}
          onlocal={setLocal}
        />
        <ImagePane
          svg={result ? sizedSvg : null}
          label="SVG"
          {viewport}
          local={localOn ? localSaved : null}
          size={displayImage}
          onlocal={setLocal}
        />
```

To `<ControlsPanel …>` add:

```svelte
        {localOn}
        local={localSaved}
        ontogglelocal={toggleLocal}
        onlocal={setLocal}
```

In the `onnew` handler, after `forgetSave()` add:

```ts
          localOn = false
          localSaved = null
          options.localLevels = null
```

In `README.md`, add to the features list: `- Local levels: a movable, soft-edged circle with its own black/white point`.

- [ ] **Step 6: Verify**

Run: `npx vitest run && npm run check && npm run lint && npx prettier --write src tests README.md && npm run build`
Expected: all clean.

Browser (`npx vite --port 5189 --strictPort --host 127.0.0.1`, feed an image by synthetic paste as in earlier sessions):
1. Local levels → Circle: gizmo appears centred on the visible image, both panes; SVG unchanged.
2. Local Black point up: only the circle area darkens in the Adjusted pane and the SVG follows; the edge fades between the rings.
3. Drag the dot and the inside: moves. Drag the solid ring: resizes; past the dashed ring it pushes it. Drag the dashed ring inward: stops at the solid ring. Drag outside the circle: pans. Wheel zoom: gizmo scales with the image, strokes stay thin.
4. Hover shows move / radial resize cursors.
5. Split view: one gizmo over both halves; the divider still drags.
6. Scale ×2: circle stays on the same spot of the image.
7. Circle off: gizmo gone, effect gone; on again: same circle and values. New image: reset.

- [ ] **Step 7: Commit**

```bash
git add src/lib/LocalGizmo.svelte src/lib/ImagePane.svelte src/lib/CompareView.svelte src/lib/ControlsPanel.svelte src/App.svelte README.md
git commit -m "feat: local levels UI — draggable circle gizmo and panel section"
```
