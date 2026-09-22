# Multiple Local Circles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single local-levels circle into an ordered list of circles with add, delete, select and hide, stacked in painter order.

**Architecture:** `PipelineOptions.localCircles: LocalCircle[]` replaces `localLevels`. `preprocess` levels each pixel globally, then blends each visible circle's own mapping of the ORIGINAL tone over the running result by that circle's weight (so a circle's middle always shows exactly its own levels and overlaps never seam). `localGizmo` gains a list-aware hit test (topmost first, hidden skipped); the panes draw one overlay per circle and route select-and-drag; the panel gets a row list with header add/delete and sliders bound to the selection. The project format goes to version 2, migrating v1's single circle (and its remembered-but-off circle) into the list.

**Tech Stack:** TypeScript, Svelte 5 runes, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-23-multiple-local-circles-design.md`

## Global Constraints

- `localCircles` defaults to `[]`; with no effective circle, output must be **byte-identical** to today (existing tests unchanged).
- A circle is **effective** when `!hidden` and its points differ from the global ones. Only effective circles are computed or compared.
- Stacking: for each pixel, start from the globally-levelled value; for each effective circle in list order, blend **that circle's mapping of the ORIGINAL (post flatten/blur/saturation) tone** over the running value by its weight. Never level an already-levelled value.
- Per-circle bounding-box (squared-distance) early-out before any sqrt; pixels outside every circle keep the current fast path.
- Palette never sees any circle (`globalPre` clears `localCircles`); circle edits never re-estimate it.
- Any change to the effective list dirties `'pre'`; nothing else changes about caching.
- Project format `PROJECT_VERSION = 2`; v1 files migrate (single circle → one item; remembered-but-off → one hidden item); `version > 2` refused with the existing message.
- Circle coordinates stay fractions (`cx` of width, `cy` of height, `inner`/`outer` of **width**), invariant `outer >= inner > 0`.
- Selection is UI state, never saved.
- `src/worker/pipeline/index.ts` and `src/worker/vectorize.worker.ts` are intentionally parallel — apply identical changes to BOTH.
- Style: no semicolons, single quotes, 2-space indent (Prettier). Colours via `var(--color-*)` tokens.
- Verification for every task: `npx vitest run`, `npm run check`, `npm run lint`, `npm run format:check`, `npm run build` — all clean.

---

### Task 1: The stacked pipeline

**Files:**
- Modify: `src/types.ts` (`LocalCircle` replaces `LocalLevels`; `localCircles`)
- Modify: `src/worker/pipeline/preprocess.ts` (list helpers, stacked blend)
- Modify: `src/worker/vectorize.worker.ts`, `src/worker/pipeline/index.ts`
- Modify (mechanical, type rename only): `src/lib/localGizmo.ts`, `src/lib/project.ts`, `src/App.svelte`, `src/lib/ControlsPanel.svelte`, `src/lib/ImagePane.svelte`, `src/lib/CompareView.svelte`
- Test: `tests/preprocess.test.ts`, `tests/workerCache.test.ts`

**Interfaces:**
- Produces:
  - `export interface LocalCircle { cx: number; cy: number; inner: number; outer: number; blackPoint: number; whitePoint: number; hidden: boolean }` in `src/types.ts`; `LocalLevels` is removed (rename every use).
  - `PipelineOptions.localCircles: LocalCircle[]`, default `[]`; `localLevels` removed.
  - `preprocess.ts`: `export function effectiveCircles(o: { blackPoint: number; whitePoint: number; localCircles: LocalCircle[] }): LocalCircle[]`, `export function sameCircleList(a: LocalCircle[], b: LocalCircle[]): boolean`, and the existing `localWeight` unchanged. `sameLocalLevels`/`effectiveLocal` are removed.

This task is the widest, because the type rename touches every file that mentions a circle. Do the rename mechanically first (a circle gains `hidden: boolean`), keep the UI on a single-element list so it still compiles and runs (`options.localCircles[0]`), and leave real list UI to Tasks 3–4.

- [ ] **Step 1: Write the failing tests**

In `tests/preprocess.test.ts`, replace the existing `describe('local levels', …)` block's helper and add stacking cases. The `circle` helper becomes:

```ts
  const circle = (over: Partial<LocalCircle> = {}): LocalCircle => ({
    cx: 0.5,
    cy: 0.5,
    inner: 0.2,
    outer: 0.3,
    blackPoint: 100,
    whitePoint: 200,
    hidden: false,
    ...over,
  })
```

Keep the existing single-circle assertions, adapted to `localCircles: [circle({ blackPoint, whitePoint })]`, and add:

```ts
  it('a later circle wins in its middle, an earlier one keeps its own middle elsewhere', () => {
    // 40x20: circle A centred on x=10, circle B on x=30, both radius 4/6 px
    const a = circle({ cx: 10 / 40, cy: 0.5, inner: 4 / 40, outer: 6 / 40, blackPoint: 100, whitePoint: 200 })
    const b = circle({ cx: 30 / 40, cy: 0.5, inner: 4 / 40, outer: 6 / 40, blackPoint: 0, whitePoint: 120 })
    const out = preprocess(flat(40, 20, [120, 120, 120]), { ...IDENTITY_PRE, localCircles: [a, b] })
    const lev = (v: number, bp: number, wp: number) => Math.round(((v - bp) * 255) / (wp - bp))
    expect(at(out, 10, 10)).toBe(lev(120, 100, 200)) // A's middle: A's own points
    expect(at(out, 30, 10)).toBe(lev(120, 0, 120)) // B's middle: B's own points
    expect(at(out, 20, 10)).toBe(120) // between them: global identity
  })

  it('overlapping circles: the later one owns the shared middle, edges lie between', () => {
    // centres 4 px apart, so each middle is inside the other's fade
    const a = circle({ cx: 18 / 40, cy: 0.5, inner: 3 / 40, outer: 8 / 40, blackPoint: 100, whitePoint: 200 })
    const b = circle({ cx: 22 / 40, cy: 0.5, inner: 3 / 40, outer: 8 / 40, blackPoint: 0, whitePoint: 120 })
    const out = preprocess(flat(40, 20, [120, 120, 120]), { ...IDENTITY_PRE, localCircles: [a, b] })
    const lev = (v: number, bp: number, wp: number) => Math.round(((v - bp) * 255) / (wp - bp))
    expect(at(out, 22, 10)).toBe(lev(120, 0, 120)) // B's middle is pure B despite overlapping A
    const edge = at(out, 26, 10) // inside B's fade only
    expect(edge).toBeGreaterThan(Math.min(120, lev(120, 0, 120)))
    expect(edge).toBeLessThan(Math.max(120, lev(120, 0, 120)))
  })

  it('each circle levels the ORIGINAL tone, so stacking two identical circles changes nothing extra', () => {
    const one = circle({ blackPoint: 50, whitePoint: 200 })
    const img = flat(20, 20, [120, 120, 120])
    const single = preprocess(img, { ...IDENTITY_PRE, localCircles: [one] })
    const doubled = preprocess(img, { ...IDENTITY_PRE, localCircles: [one, { ...one }] })
    expect(Array.from(doubled.data)).toEqual(Array.from(single.data))
  })

  it('hidden circles are skipped, and an empty list is an identity', () => {
    const img = flat(20, 20, [120, 120, 120])
    expect(preprocess(img, { ...IDENTITY_PRE, localCircles: [] })).toBe(img)
    expect(preprocess(img, { ...IDENTITY_PRE, localCircles: [circle({ hidden: true })] })).toBe(img)
  })

  it('effectiveCircles drops hidden and no-op circles, keeping order', () => {
    const keep = circle({ blackPoint: 10, whitePoint: 250 })
    const noop = circle({ blackPoint: 0, whitePoint: 255 })
    const hidden = circle({ blackPoint: 10, whitePoint: 250, hidden: true })
    const o = { blackPoint: 0, whitePoint: 255, localCircles: [noop, keep, hidden] }
    expect(effectiveCircles(o)).toEqual([keep])
  })

  it('sameCircleList compares by value, in order', () => {
    const a = circle()
    const b = circle({ cx: 0.4 })
    expect(sameCircleList([a, b], [{ ...a }, { ...b }])).toBe(true)
    expect(sameCircleList([a, b], [b, a])).toBe(false)
    expect(sameCircleList([a], [a, b])).toBe(false)
    expect(sameCircleList([], [])).toBe(true)
  })
```

Extend the imports to `effectiveCircles`, `sameCircleList`, and `import type { LocalCircle } from '../src/types'`.

In `tests/workerCache.test.ts`, replace the `localLevels` cases with:

```ts
  const circle = {
    cx: 0.5,
    cy: 0.5,
    inner: 0.1,
    outer: 0.2,
    blackPoint: 60,
    whitePoint: 200,
    hidden: false,
  }
  it('adding, moving or hiding an effective circle -> pre', () => {
    expect(firstDirtyStage(base, { ...base, localCircles: [circle] }, true)).toBe('pre')
    const on = { ...base, localCircles: [circle] }
    expect(firstDirtyStage(on, { ...on, localCircles: [{ ...circle, cx: 0.6 }] }, true)).toBe('pre')
    expect(firstDirtyStage(on, { ...on, localCircles: [{ ...circle, hidden: true }] }, true)).toBe(
      'pre',
    )
  })
  it('an equal list, and edits to an ineffective circle, are not changes', () => {
    const on = { ...base, localCircles: [circle] }
    expect(firstDirtyStage(on, { ...on, localCircles: [{ ...circle }] }, true)).toBe('fit')
    // a no-op circle (points equal to the global ones) is not effective, so moving it changes nothing
    const noop = { ...circle, blackPoint: base.blackPoint, whitePoint: base.whitePoint }
    const off = { ...base, localCircles: [noop] }
    expect(firstDirtyStage(off, { ...off, localCircles: [{ ...noop, cx: 0.9 }] }, true)).toBe('fit')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/preprocess.test.ts tests/workerCache.test.ts`
Expected: FAIL — `localCircles`, `effectiveCircles`, `sameCircleList` do not exist.

- [ ] **Step 3: Rename the type and the option**

In `src/types.ts`, replace the `LocalLevels` interface with:

```ts
/** A soft-edged circle with its own black/white point, blended into the global levels.
 *  Fractions: cx of image width, cy of image height, inner/outer of image WIDTH (so it stays
 *  round and in place across scale changes). outer >= inner. */
export interface LocalCircle {
  cx: number
  cy: number
  inner: number // full-strength radius
  outer: number // zero-strength radius
  blackPoint: number // 0..254
  whitePoint: number // 1..255
  hidden: boolean // kept in the list, but has no effect on the output
}
```

In `PipelineOptions`, replace `localLevels: LocalLevels | null` with `localCircles: LocalCircle[] // stacked in painter order; [] = none`, and in `DEFAULT_OPTIONS` replace `localLevels: null,` with `localCircles: [],`.

Then update every remaining `LocalLevels` reference to `LocalCircle` (`src/lib/localGizmo.ts`, `src/lib/project.ts`, `src/App.svelte`, `src/lib/ControlsPanel.svelte`, `src/lib/ImagePane.svelte`, `src/lib/CompareView.svelte`). `npm run check` lists them all.

**Interim UI wiring (replaced in Tasks 3–4, keep it minimal):** in `src/App.svelte`, `applyLocal` becomes

```ts
  function applyLocal() {
    options.localCircles = localOn && localSaved ? [$state.snapshot(localSaved)] : []
    rerun()
  }
```

`initialLocal` (in `localGizmo.ts`) returns the circle with `hidden: false`; `openProject` sets `localOn = d.options.localCircles.length > 0`; `projectData()` keeps sending `localSaved`. In `src/lib/project.ts`, read/write `localCircles` in place of `localLevels` for now (the v1 migration and the version bump are Task 2).

- [ ] **Step 4: Implement the stacked blend**

In `src/worker/pipeline/preprocess.ts`: `PreOptions.localLevels` becomes `localCircles: LocalCircle[]`; `IDENTITY_PRE` gets `localCircles: []`. Replace `effectiveLocal`, `localIsNoop` and `sameLocalLevels` with:

```ts
/** The circles that actually affect pixels: visible, and with points that differ from the global
 *  ones (a circle matching them maps every tone to itself, so it is a no-op). Order is kept. */
export function effectiveCircles(o: {
  blackPoint: number
  whitePoint: number
  localCircles: LocalCircle[]
}): LocalCircle[] {
  return o.localCircles.filter(
    (c) => !c.hidden && (c.blackPoint !== o.blackPoint || c.whitePoint !== o.whitePoint),
  )
}

export function sameCircleList(a: LocalCircle[], b: LocalCircle[]): boolean {
  if (a.length !== b.length) return false
  return a.every((c, i) => {
    const d = b[i]
    return (
      c.cx === d.cx &&
      c.cy === d.cy &&
      c.inner === d.inner &&
      c.outer === d.outer &&
      c.blackPoint === d.blackPoint &&
      c.whitePoint === d.whitePoint &&
      c.hidden === d.hidden
    )
  })
}
```

`isIdentityPre`'s last clause becomes `effectiveCircles(o).length === 0`, and `globalPre` returns `{ ...o, localCircles: [] }`.

In `preprocess`, replace the single-circle preamble and the pixel loop's local part with a per-circle prepared list and a stacked blend:

```ts
  const lev = (v: number, b: number, s: number) => Math.min(255, Math.max(0, (v - b) * s))
  // Each circle in pixels, with its own levels. A circle levels the ORIGINAL tone and is blended
  // over the running result by its weight (painter order): its full-strength middle therefore
  // always shows exactly its own points, and only the soft edges mix, so overlaps cannot seam.
  const circles = effectiveCircles(opts).map((c) => {
    const cBlack = c.blackPoint
    const inner = c.inner * w
    const outer = Math.max(c.outer, c.inner) * w
    return {
      x: c.cx * w,
      y: c.cy * h,
      inner,
      outer,
      outer2: outer * outer,
      black: cBlack,
      scale: 255 / (Math.max(c.whitePoint, cBlack + 1) - cBlack),
    }
  })
  const out = new Uint8ClampedArray(working.length)
  for (let y = 0, p = 0; y < h; y++) {
    // Per row, each circle's vertical offset is fixed; the per-pixel work only adds dx.
    const dys = circles.map((c) => {
      const dy = y + 0.5 - c.y
      return dy * dy
    })
    for (let x = 0; x < w; x++, p += 4) {
      let r = working[p],
        g = working[p + 1],
        b = working[p + 2]
      if (sat !== 1) {
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        r = lum + (r - lum) * sat
        g = lum + (g - lum) * sat
        b = lum + (b - lum) * sat
      }
      let orr = (r - black) * scale,
        og = (g - black) * scale,
        ob = (b - black) * scale
      for (let i = 0; i < circles.length; i++) {
        const c = circles[i]
        const dx = x + 0.5 - c.x
        const d2 = dx * dx + dys[i]
        // Squared-distance early-out: no sqrt for a pixel outside this circle.
        if (d2 > c.outer2) continue
        const wt = localWeight(Math.sqrt(d2), c.inner, c.outer)
        if (wt === 0) continue
        // Both sides clamped before mixing, so the blend matches the fast path in the limit.
        const gr = Math.min(255, Math.max(0, orr)),
          gg = Math.min(255, Math.max(0, og)),
          gb = Math.min(255, Math.max(0, ob))
        orr = gr + (lev(r, c.black, c.scale) - gr) * wt
        og = gg + (lev(g, c.black, c.scale) - gg) * wt
        ob = gb + (lev(b, c.black, c.scale) - gb) * wt
      }
      out[p] = orr // Uint8ClampedArray clamps + rounds
      out[p + 1] = og
      out[p + 2] = ob
      out[p + 3] = 255
    }
  }
  return { width: w, height: h, data: out }
}
```

(The `circles.map` per row allocates one small array per row; if `npm run build` or a quick timing shows that matters, hoist a `Float64Array(circles.length)` outside the loop and fill it per row — same result.)

- [ ] **Step 5: Wire the worker and the pure pipeline**

Both files: import `sameCircleList` instead of `sameLocalLevels`, `effectiveCircles` where needed, and pass `localCircles: options.localCircles` into `preOpts`.

In `firstDirtyStage` (`vectorize.worker.ts`), the pre clause becomes:

```ts
    !sameCircleList(effectiveCircles(prev), effectiveCircles(next))
```

(`effectiveCircles` takes the whole options object, which has all three fields it reads.)

`palOpts`/`palIdentity` and the palette fallback stay exactly as they are — `globalPre` now clears the list.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run && npm run check`
Expected: all PASS, 0 errors. Existing tests must pass untouched apart from the renamed option.

- [ ] **Step 7: Full verification and commit**

Run: `npm run lint && npm run format:check && npm run build`

```bash
git add -A
git commit -m "feat: stack a list of local circles in the pre stage"
```

---

### Task 2: Project format version 2

**Files:**
- Modify: `src/lib/project.ts`
- Test: `tests/project.test.ts`

**Interfaces:**
- Consumes: `LocalCircle`, `PipelineOptions.localCircles` (Task 1).
- Produces: `PROJECT_VERSION = 2`; `ProjectData.localSaved` is removed — `ProjectData` is now `{ source, sourceName, scale, options }`.

- [ ] **Step 1: Write the failing tests**

In `tests/project.test.ts`, update `data()` to drop `localSaved` and use `localCircles: [circle]` (where `circle` gains `hidden: false`), then add:

```ts
describe('v1 migration', () => {
  const v1 = (options: Record<string, unknown>, localSaved?: unknown) =>
    new Blob([
      zipSync({
        'project.json': strToU8(
          JSON.stringify({
            app: 'slop-vectorizer',
            version: 1,
            sourceName: 'old.png',
            scale: 1,
            options,
            ...(localSaved === undefined ? {} : { localSaved }),
          }),
        ),
        'source.png': bytes,
      }),
    ])
  const old = { cx: 0.4, cy: 0.6, inner: 0.1, outer: 0.2, blackPoint: 30, whitePoint: 220 }

  it('turns a v1 circle into a one-item list', async () => {
    const back = await unpackProject(v1({ localLevels: old }))
    expect(back.options.localCircles).toEqual([{ ...old, hidden: false }])
  })

  it('keeps a v1 remembered-but-off circle as a hidden one', async () => {
    const back = await unpackProject(v1({ localLevels: null }, old))
    expect(back.options.localCircles).toEqual([{ ...old, hidden: true }])
  })

  it('a v1 project with no circle at all gets an empty list', async () => {
    const back = await unpackProject(v1({}))
    expect(back.options.localCircles).toEqual([])
  })

  it('still rejects a version newer than this build', async () => {
    await expect(
      unpackProject(
        new Blob([
          zipSync({
            'project.json': strToU8(
              JSON.stringify({ app: 'slop-vectorizer', version: 3, sourceName: 'x.png' }),
            ),
            'source.png': bytes,
          }),
        ]),
      ),
    ).rejects.toThrow(/newer version/i)
  })

  it('sanitises circles from a hand-edited file', async () => {
    const back = await unpackProject(
      v1({ localCircles: [old, 'nope', { ...old, cx: 'x' }] } as Record<string, unknown>),
    )
    // only well-formed circles survive; the rest are dropped rather than crashing a render
    expect(back.options.localCircles).toEqual([{ ...old, hidden: false }])
  })
})
```

Also update the existing round-trip test to assert `back.options.localCircles` survives and that `packProject` writes `version: 2`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/project.test.ts`
Expected: FAIL — version is still 1 and no migration exists.

- [ ] **Step 3: Implement**

In `src/lib/project.ts`:

```ts
export const PROJECT_VERSION = 2
```

Drop `localSaved` from `ProjectData` and from the object `packProject` serialises (it now writes `options` carrying `localCircles`).

Add a validator and the migration, and call them where `localSaved` used to be resolved:

```ts
const NUM = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

/** One circle from an untrusted file, or null. Everything that reaches the pipeline must be
 *  numbers in the right shape: a hand-edited or corrupt project must not crash a render. */
function readCircle(v: unknown, hidden: boolean): LocalCircle | null {
  if (typeof v !== 'object' || v === null) return null
  const c = v as Record<string, unknown>
  if (!NUM(c.cx) || !NUM(c.cy) || !NUM(c.inner) || !NUM(c.outer)) return null
  if (!NUM(c.blackPoint) || !NUM(c.whitePoint)) return null
  const inner = Math.max(0, c.inner as number)
  return {
    cx: c.cx as number,
    cy: c.cy as number,
    inner,
    outer: Math.max(inner, c.outer as number),
    blackPoint: c.blackPoint as number,
    whitePoint: c.whitePoint as number,
    hidden: typeof c.hidden === 'boolean' ? c.hidden : hidden,
  }
}

/** v1 stored ONE circle (`options.localLevels`) plus the circle the UI remembered while the
 *  toggle was off (`localSaved`). A remembered-but-off circle becomes a hidden one, so opening
 *  an old project loses nothing. */
function readCircles(parsed: Record<string, unknown>, saved: Partial<PipelineOptions>): LocalCircle[] {
  const list = (saved as { localCircles?: unknown }).localCircles
  if (Array.isArray(list)) return list.map((c) => readCircle(c, false)).filter((c) => c !== null)
  const active = readCircle((saved as { localLevels?: unknown }).localLevels, false)
  if (active) return [active]
  const remembered = readCircle(parsed.localSaved, true)
  return remembered ? [remembered] : []
}
```

In `unpackProject`, after the `options` merge, force the list through the reader:

```ts
  const options: PipelineOptions = {
    ...DEFAULT_OPTIONS,
    ...saved,
    colorOverrides: sanitizeColorOverrides((saved as { colorOverrides?: unknown }).colorOverrides),
    localCircles: readCircles(parsed, saved),
  }
```

(Keep the existing `colorOverrides` sanitising exactly as it is; only the `localCircles` line is new.) Return `{ source, sourceName, scale, options }`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/project.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the callers**

`src/App.svelte`: `projectData()` drops `localSaved`; `openProject` sets the interim `localSaved`/`localOn` from `d.options.localCircles[0] ?? null` (Task 4 replaces this).

- [ ] **Step 6: Full verification and commit**

Run: `npx vitest run && npm run check && npm run lint && npm run format:check && npm run build`

```bash
git add -A
git commit -m "feat: project format v2 — a list of circles, migrating v1 files"
```

---

### Task 3: List-aware gizmo geometry and overlay

**Files:**
- Modify: `src/lib/localGizmo.ts`
- Modify: `src/lib/LocalGizmo.svelte`
- Test: `tests/localGizmo.test.ts`

**Interfaces:**
- Produces:
  - `export type GizmoState = 'selected' | 'unselected' | 'hidden'`
  - `export interface GizmoHit { index: number; part: GizmoPart }`
  - `export function hitTestList(circles: LocalCircle[], selected: number, iw: number, ih: number, v: ViewXf, px: number, py: number, slop: number, maxMoveRadius: number): GizmoHit | null`
  - `LocalGizmo.svelte` props become `{ c: ScreenCircle; state: GizmoState }`
  - Existing `toScreen`, `hitTest`, `applyDrag`, `initialLocal`, `cursorFor`, `DOT_R`, `hitSlop` keep their signatures (`initialLocal` returns `hidden: false`).

- [ ] **Step 1: Write the failing test**

Append to `tests/localGizmo.test.ts`:

```ts
describe('hitTestList', () => {
  const base = { inner: 0.1, outer: 0.2, blackPoint: 10, whitePoint: 240, hidden: false }
  const A: LocalCircle = { ...base, cx: 0.25, cy: 0.5 } // centre (50,50) px at zoom 1
  const B: LocalCircle = { ...base, cx: 0.75, cy: 0.5 } // centre (150,50) px
  const V: ViewXf = { zoom: 1, panX: 0, panY: 0 }
  const hit = (circles: LocalCircle[], selected: number, px: number, py: number) =>
    hitTestList(circles, selected, 200, 100, V, px, py, 6, 9999)

  it('finds the circle under the pointer, whichever is selected', () => {
    expect(hit([A, B], 0, 150, 50)).toEqual({ index: 1, part: 'move' })
    expect(hit([A, B], 1, 50, 50)).toEqual({ index: 0, part: 'move' })
    expect(hit([A, B], 0, 50 + 20, 50)).toEqual({ index: 0, part: 'inner' })
  })
  it('prefers the topmost circle where two overlap', () => {
    const over: LocalCircle = { ...base, cx: 0.25, cy: 0.5, inner: 0.15, outer: 0.2 }
    expect(hit([A, over], 0, 50, 50)).toEqual({ index: 1, part: 'move' })
  })
  it('ignores hidden circles', () => {
    expect(hit([{ ...A, hidden: true }, B], 1, 50, 50)).toBe(null)
  })
  it('returns null where no circle is', () => {
    expect(hit([A, B], 0, 100, 95)).toBe(null)
  })
  it('an empty list or no selection is safe', () => {
    expect(hit([], -1, 10, 10)).toBe(null)
    expect(hit([A], -1, 50, 50)).toEqual({ index: 0, part: 'move' })
  })
})
```

Extend the imports with `hitTestList` and `type LocalCircle`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/localGizmo.test.ts`
Expected: FAIL — `hitTestList` is not exported.

- [ ] **Step 3: Implement the list hit test**

Append to `src/lib/localGizmo.ts`:

```ts
export type GizmoState = 'selected' | 'unselected' | 'hidden'
export interface GizmoHit {
  index: number
  part: GizmoPart
}

/** Which circle a pointer grabs, and where. Searched from the top of the stack down, so the
 *  circle that paints last is the one a click reaches; hidden circles are transparent. The
 *  SELECTED circle is tried first, so its handles stay reachable under an overlapping neighbour
 *  — the one you are editing must not become hard to grab. */
export function hitTestList(
  circles: LocalCircle[],
  selected: number,
  iw: number,
  ih: number,
  v: ViewXf,
  px: number,
  py: number,
  slop: number,
  maxMoveRadius: number,
): GizmoHit | null {
  const test = (i: number) => {
    const c = circles[i]
    if (!c || c.hidden) return null
    const part = hitTest(toScreen(c, iw, ih, v), px, py, slop, maxMoveRadius)
    return part ? { index: i, part } : null
  }
  const first = selected >= 0 ? test(selected) : null
  if (first) return first
  for (let i = circles.length - 1; i >= 0; i--) {
    if (i === selected) continue
    const h = test(i)
    if (h) return h
  }
  return null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/localGizmo.test.ts`
Expected: PASS.

- [ ] **Step 5: Three states in the overlay**

`src/lib/LocalGizmo.svelte` takes `state` and renders accordingly — selected as today (halo + rings + dot); unselected as one thin ring at `inner` with its halo and no dot; hidden as a dashed thin ring with no dot:

```svelte
<script lang="ts">
  import { DOT_R, type GizmoState, type ScreenCircle } from './localGizmo'

  let { c, state }: { c: ScreenCircle; state: GizmoState } = $props()
</script>

<svg class="gizmo" aria-hidden="true">
  {#if state === 'selected'}
    <g fill="none">
      <circle cx={c.x} cy={c.y} r={c.outer} class="halo" />
      <circle cx={c.x} cy={c.y} r={c.outer} class="ring dashed" />
      <circle cx={c.x} cy={c.y} r={c.inner} class="halo" />
      <circle cx={c.x} cy={c.y} r={c.inner} class="ring" />
    </g>
    <circle cx={c.x} cy={c.y} r={DOT_R} class="dot" />
  {:else}
    <g fill="none">
      <circle cx={c.x} cy={c.y} r={c.inner} class="halo" />
      <circle
        cx={c.x}
        cy={c.y}
        r={c.inner}
        class={['ring', 'quiet', state === 'hidden' && 'dashed']}
      />
    </g>
  {/if}
</svg>
```

Add to its style block (keep the existing rules):

```css
  .quiet {
    stroke-width: 1;
    opacity: 0.7;
  }
```

- [ ] **Step 6: Full verification and commit**

Run: `npx vitest run && npm run check && npm run lint && npm run format:check && npm run build`

```bash
git add src/lib/localGizmo.ts src/lib/LocalGizmo.svelte tests/localGizmo.test.ts
git commit -m "feat: gizmo geometry and overlay for a list of circles"
```

---

### Task 4: The list UI, selection and canvas routing

**Files:**
- Modify: `src/lib/ImagePane.svelte`, `src/lib/CompareView.svelte` (per-circle overlays, select-and-drag)
- Modify: `src/lib/ControlsPanel.svelte` (the row list and its header buttons)
- Modify: `src/App.svelte` (selection, add/delete/hide, project restore)
- Modify: `README.md` (feature line)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces (props):
  - panes: `circles?: LocalCircle[]`, `selected?: number`, `size?: { width: number; height: number } | null`, `onselect?: (i: number) => void`, `oncircle?: (i: number, c: LocalCircle) => void` — replacing `local`/`onlocal`.
  - `ControlsPanel`: `circles: LocalCircle[]`, `selected: number`, `onadd: () => void`, `ondelete: () => void`, `onselect: (i: number) => void`, `ontogglehidden: (i: number) => void`, `oncircle: (i: number, c: LocalCircle) => void` — replacing `localOn`/`local`/`ontogglelocal`/`onlocal`.

- [ ] **Step 1: Pane routing**

In `src/lib/ImagePane.svelte`, replace the `local`/`onlocal` props with the list ones above and drop the single `circle` derived. Render one overlay per circle (the selected one is drawn in its own state, so stacking order only matters for overlap appearance):

```svelte
  {#if size}
    {#each circles as c, i (i)}
      <LocalGizmo
        c={toScreen(c, size.width, size.height, viewport)}
        state={c.hidden ? 'hidden' : i === selected ? 'selected' : 'unselected'}
      />
    {/each}
  {/if}
```

The pointer handlers use the list hit test, and a hit on an unselected circle selects it **and** starts the drag in the same gesture:

```ts
  function down(e: PointerEvent) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const p = panePoint(e)
    const hit =
      pointers.size === 1 && size
        ? hitTestList(
            circles,
            selected,
            size.width,
            size.height,
            viewport,
            p.x,
            p.y,
            hitSlop(coarse),
            moveCap(),
          )
        : null
    if (hit && hit.index !== selected) onselect?.(hit.index)
    gz = hit ? { id: e.pointerId, index: hit.index, part: hit.part, start: { ...circles[hit.index] }, from: p } : null
  }
```

`move` applies the drag to the dragged circle and reports it by index:

```ts
    if (gz && gz.id === e.pointerId && size) {
      oncircle?.(gz.index, applyDrag(gz.start, gz.part, size.width, size.height, viewport, gz.from, panePoint(e)))
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      return
    }
```

The hover-cursor branch uses `hitTestList` the same way (cursor from `cursorFor(hit.part, toScreen(circles[hit.index], …), p.x, p.y)`). `moveCap()` is the existing `Math.min(rect.width, rect.height) / 2` expression — extract it to a small local function if it is currently inline, so `down` and `move` share it.

Apply the identical changes to `src/lib/CompareView.svelte` (its divider branch stays first in `move`; the overlays render before the divider).

- [ ] **Step 2: The panel list**

In `src/lib/ControlsPanel.svelte`, replace the Local levels section with:

```svelte
  <section>
    <h2 class="section-head">
      Local levels
      <span class="head-actions">
        <button class="icon-btn" title="Add a circle" aria-label="Add a circle" onclick={onadd}
          ><Plus size={14} /></button
        >
        <button
          class="icon-btn"
          title="Delete the selected circle"
          aria-label="Delete the selected circle"
          disabled={selected < 0}
          onclick={ondelete}><Trash2 size={14} /></button
        >
      </span>
    </h2>
    <div class="body">
      {#if circles.length === 0}
        <p class="hint">Add a circle to adjust the levels of one area.</p>
      {:else}
        <div class="rows">
          {#each circles as c, i (i)}
            <div class="row" class:sel={i === selected}>
              <button
                class="icon-btn"
                title={c.hidden ? 'Show' : 'Hide'}
                aria-label={c.hidden ? 'Show' : 'Hide'}
                aria-pressed={!c.hidden}
                onclick={() => ontogglehidden(i)}
              >
                {#if c.hidden}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
              </button>
              <button class="name-btn" aria-pressed={i === selected} onclick={() => onselect(i)}
                >Circle {i + 1}</button
              >
            </div>
          {/each}
        </div>
        {#if selected >= 0 && circles[selected]}
          {@render circleSlider('Black point', 'blackPoint', 0, 254)}
          {@render circleSlider('White point', 'whitePoint', 1, 255)}
          <p class="hint">
            Drag the dot to move, the solid ring to resize, the dashed ring to soften.
          </p>
        {/if}
      {/if}
    </div>
  </section>
```

with the snippet (replacing `localSlider`):

```svelte
{#snippet circleSlider(label: string, key: 'blackPoint' | 'whitePoint', min: number, max: number)}
  {@const c = circles[selected]}
  <label class="slider-row">
    <span class="name">{label}</span>
    <input
      type="range"
      {min}
      {max}
      step="1"
      value={c[key]}
      style={sliderFill(c[key], min, max)}
      oninput={(e) =>
        oncircle(selected, { ...c, [key]: Number((e.target as HTMLInputElement).value) })}
    />
    <span class="value">{c[key]}</span>
  </label>
{/snippet}
```

Import `Eye`, `EyeOff`, `Plus`, `Trash2` from `@lucide/svelte`. Styles to add (the selected row follows the family's out-of-flow treatment, so selecting never moves anything):

```css
  .section-head {
    justify-content: space-between;
  }
  .head-actions {
    display: flex;
    gap: 2px;
  }
  .rows {
    display: flex;
    flex-direction: column;
    margin-bottom: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    border-radius: 4px;
  }
  .row.sel {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    box-shadow: inset 2px 0 0 var(--color-accent);
  }
  .name-btn {
    flex: 1;
    justify-content: flex-start;
    height: var(--ctl-h);
    border: none;
    background: none;
  }
  .name-btn:hover:not(:disabled) {
    color: var(--color-text);
  }
```

(`.section-head` already sets `display: flex; align-items: center`.)

- [ ] **Step 3: App state**

In `src/App.svelte`, replace `localOn`/`localSaved`/`applyLocal`/`toggleLocal`/`setLocal` with:

```ts
  // The circles live in the options (they are pipeline input); only the selection is view state.
  let selected = $state(-1)

  function setCircles(next: LocalCircle[]) {
    options.localCircles = next
    rerun()
  }
  function addCircle() {
    const img = displayImage
    if (!img) return
    const c = initialLocal(
      viewport,
      paneW(),
      viewsH,
      img.width,
      img.height,
      options.blackPoint,
      options.whitePoint,
    )
    setCircles([...$state.snapshot(options.localCircles), c])
    selected = options.localCircles.length - 1
  }
  function deleteCircle() {
    if (selected < 0) return
    const next = $state.snapshot(options.localCircles).filter((_, i) => i !== selected)
    setCircles(next)
    selected = Math.min(selected, next.length - 1)
  }
  function toggleHidden(i: number) {
    const next = $state.snapshot(options.localCircles)
    next[i] = { ...next[i], hidden: !next[i].hidden }
    setCircles(next)
  }
  function updateCircle(i: number, c: LocalCircle) {
    const next = $state.snapshot(options.localCircles)
    next[i] = c
    setCircles(next)
  }
```

`openProject` sets `selected = d.options.localCircles.length > 0 ? 0 : -1` (and drops the old `localOn`/`localSaved` lines); `onnew` sets `selected = -1` and `options.localCircles = []`.

Pass to the panes (all three call sites) `circles={options.localCircles} {selected} size={displayImage} onselect={(i) => (selected = i)} oncircle={updateCircle}` in place of `local`/`onlocal`, and to `<ControlsPanel>`: `circles={options.localCircles} {selected} onadd={addCircle} ondelete={deleteCircle} onselect={(i) => (selected = i)} ontogglehidden={toggleHidden} oncircle={updateCircle}`.

In `README.md`, change the local-levels feature line to mention several circles.

- [ ] **Step 4: Verify**

Run: `npx vitest run && npm run check && npm run lint && npm run format:check && npm run build`

Browser (`npx vite --port 5189 --strictPort --host 127.0.0.1`; feed an image by synthetic paste; the panes listen for POINTER events):
1. Add three circles; each appears centred on the view and becomes selected; the sliders follow the selection.
2. Drag each by its dot; unselected circles show as thin rings; clicking one selects it and drags in the same gesture.
3. Give two overlapping circles different levels: the later one's middle shows its own levels, the overlap fades, and nothing seams.
4. Hide the middle circle: it becomes a dashed outline, stops affecting the SVG, and ignores clicks. Show it again.
5. Delete the selected circle: rows renumber, selection moves to a neighbour, output updates.
6. Save the project, New image, reopen it: all circles come back in order with their hidden flags; the first is selected.
7. Empty list: no gizmo, and the output matches a session that never had a circle.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: a list of local circles with add, delete, select and hide"
```
