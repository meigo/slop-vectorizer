# Stacked Shapes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `Output → Stacked shapes` toggle that emits each region as a solid shape (outer loop only, no holes) painted in containment order, roughly halving boundary geometry in the SVG.

**Architecture:** The option changes only loop selection, paint order, and serialization — arcs, corners, and fitted cubics are untouched, so geometry is byte-identical to flat mode where shared. Fit stage: per region, keep only the largest-|area| loop and skip fitting arcs no kept loop uses. Svg stage: sort by first-pixel scan order (containers first) instead of area, ignore merge/transparent, drop `fill-rule` (single-subpath paths need none). Spec: `docs/superpowers/specs/2026-08-09-stacked-shapes-design.md`.

**Tech Stack:** TypeScript, Vitest, Svelte 5 runes. No new dependencies.

## Global Constraints

- `stackedShapes` defaults to `false`; flat output must stay **byte-identical** to current output when it is off (existing determinism/e2e tests must pass unchanged).
- While stacked is on, `mergePaths` and `transparentBg` are ignored by the pipeline (byte-equal output whatever their values) and their checkboxes disabled in the UI.
- `firstDirtyStage` must return `'fit'` for a `stackedShapes` change (no new cache tier).
- Determinism: same input + options ⇒ byte-identical SVG (stack order = first-pixel index, unique per region).
- The orchestration in `src/worker/pipeline/index.ts` and `src/worker/vectorize.worker.ts` is intentionally parallel — apply identical changes to BOTH, matching each file's local style.
- Verification suite for every task: `npx vitest run`, `npm run check`, `npm run lint`, `npm run format:check`, `npm run build` — all clean.

---

### Task 1: Pipeline stacked mode

**Files:**
- Modify: `src/types.ts` (PipelineOptions, DEFAULT_OPTIONS)
- Modify: `src/worker/pipeline/svg.ts` (RegionPath, SvgOptions, assembleSvg)
- Modify: `src/worker/pipeline/index.ts` (areas/outer-loop computation, fit + svg stages)
- Modify: `src/worker/vectorize.worker.ts` (same, against the cache; `firstDirtyStage` comment only)
- Test: `tests/svg.test.ts`, `tests/e2e.test.ts`, `tests/workerCache.test.ts`

**Interfaces:**
- Consumes: `Boundaries { arcs, regions }`, `loopPointsOf(arcs, refs): Float64Array`, `polygonArea(loop): number`, `fitArc`, `reverseCubics` — all existing, unchanged.
- Produces: `PipelineOptions.stackedShapes: boolean`; `RegionPath.stackOrder: number` (always set; row-major index of the region's first pixel); `SvgOptions.stackedShapes: boolean`. Task 2 relies on `options.stackedShapes` existing with default `false`.

- [ ] **Step 1: Write the failing unit tests for assembleSvg stacked mode** in `tests/svg.test.ts` (append a new describe block; reuse the file's existing palette/RegionPath fabrication style — adapt property names if the existing helpers differ, but keep the assertions exactly):

```ts
describe('assembleSvg stacked mode', () => {
  const palette = { k: 2, colors: new Uint8ClampedArray([255, 255, 255, 0, 0, 0]) }
  // one square loop as a Cubic[] (degenerate cubics along straight edges)
  const square = (x0: number, y0: number, s: number): Cubic[] => {
    const pts = [
      [x0, y0],
      [x0 + s, y0],
      [x0 + s, y0 + s],
      [x0, y0 + s],
    ]
    return pts.map((p, i) => {
      const q = pts[(i + 1) % 4]
      return [p[0], p[1], p[0], p[1], q[0], q[1], q[0], q[1]] as Cubic
    })
  }
  const paths: RegionPath[] = [
    { paletteIndex: 1, area: 25, loops: [square(30, 30, 5)], stackOrder: 950 },
    { paletteIndex: 0, area: 100, loops: [square(0, 0, 10)], stackOrder: 0 },
    { paletteIndex: 1, area: 16, loops: [square(10, 10, 4)], stackOrder: 310 },
  ]
  const opts = {
    mergePaths: false,
    transparentBg: false,
    optimize: false,
    colorOverrides: null,
    stackedShapes: true,
  }

  it('paints in ascending stackOrder, not by area', () => {
    const svg = assembleSvg(paths, palette, 40, 40, opts)
    const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1])
    expect(fills).toEqual(['#ffffff', '#000000', '#000000'])
    // area-descending would give the same first element but order 100,25,16 →
    // discriminate via the d attributes: second path must be the stackOrder-310 square
    const ds = [...svg.matchAll(/d="([^"]*)"/g)].map((m) => m[1])
    expect(ds[1]).toContain('M10 10')
    expect(ds[2]).toContain('M30 30')
  })

  it('ignores mergePaths and transparentBg and omits fill-rule', () => {
    const base = assembleSvg(paths, palette, 40, 40, opts)
    const noisy = assembleSvg(paths, palette, 40, 40, {
      ...opts,
      mergePaths: true,
      transparentBg: true,
    })
    expect(noisy).toBe(base)
    expect(base).not.toContain('fill-rule')
  })

  it('flat mode still emits fill-rule and area ordering', () => {
    const svg = assembleSvg(paths, palette, 40, 40, { ...opts, stackedShapes: false })
    expect(svg).toContain('fill-rule="evenodd"')
    const ds = [...svg.matchAll(/d="([^"]*)"/g)].map((m) => m[1])
    expect(ds[0]).toContain('M0 0') // largest area first
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/svg.test.ts`
Expected: FAIL — `stackedShapes` not in SvgOptions / `stackOrder` not in RegionPath (type error surfaces at runtime as ignored option: first two tests fail on ordering/equality).

- [ ] **Step 3: Add the option and svg-stage support**

In `src/types.ts`, add to `PipelineOptions` after `colorOverrides`:

```ts
  stackedShapes: boolean // solid shapes painted in containment order, no holes
```

and to `DEFAULT_OPTIONS`: `stackedShapes: false,`.

In `src/worker/pipeline/svg.ts`:

```ts
export interface RegionPath {
  paletteIndex: number
  area: number
  stackOrder: number // row-major index of the region's first pixel; paint order in stacked mode
  loops: Cubic[][]
}
```

`SvgOptions` gains `stackedShapes: boolean`. In `assembleSvg`, branch before the existing merge logic:

```ts
  if (opts.stackedShapes) {
    const toPath = opts.optimize ? loopToPathCompact : loopToPath
    const body = [...paths]
      .sort((a, b) => a.stackOrder - b.stackOrder)
      .map((p) => {
        const fill = opts.colorOverrides?.[p.paletteIndex] ?? hex(palette.colors, p.paletteIndex)
        return `<path fill="${fill}" d="${p.loops.map(toPath).join('')}"/>`
      })
      .join('\n  ')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n  ${body}\n</svg>\n`
  }
```

The existing flat path below stays byte-for-byte as-is.

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run tests/svg.test.ts`
Expected: PASS (fix any fabrication-style mismatches against the file's existing helpers first). Other suites will fail to typecheck until Step 5 sets `stackOrder` at the call sites — that's expected mid-task.

- [ ] **Step 5: Wire the pipeline in BOTH orchestrators**

In `src/worker/pipeline/index.ts`:

(a) Replace the `areas` computation so it also finds each region's outer loop:

```ts
  const loopAreas = bounds.regions.map((r) =>
    r.loops.map((refs) => Math.abs(polygonArea(loopPointsOf(bounds.arcs, refs)))),
  )
  const areas = loopAreas.map((la) => Math.max(...la))
  const outerLoop = loopAreas.map((la) => la.indexOf(Math.max(...la)))
```

(b) Before the fit stage, compute stack order and the used-arc set (only when stacked):

```ts
  const stacked = options.stackedShapes
  const firstPixel = new Int32Array(seg.regionCount).fill(-1)
  if (stacked) {
    let seen = 0
    for (let i = 0; i < seg.labelMap.length && seen < seg.regionCount; i++) {
      if (firstPixel[seg.labelMap[i]] === -1) {
        firstPixel[seg.labelMap[i]] = i
        seen++
      }
    }
  }
```

(c) In the fit stage, fit only the arcs a kept loop uses, and keep only outer loops when stacked:

```ts
  const paths = stage('fit', () => {
    // Each arc is fitted once, in its stored direction; the region that traverses it
    // backwards reuses the same cubics reversed exactly, so a shared boundary is the
    // same curve on both sides by construction. Stacked mode keeps only each region's
    // outer loop, so hole-only arcs are never fitted.
    const used = stacked ? new Set<number>() : null
    if (used)
      bounds.regions.forEach((r, ri) => {
        for (const ref of r.loops[outerLoop[ri]]) used.add(ref.arc)
      })
    const arcCubics = bounds.arcs.map((a, i) =>
      used && !used.has(i) ? [] : fitArc(a.points, cornersPerArc[i], a.closed, maxErrorPx),
    )
    return bounds.regions.map((r, ri): RegionPath => {
      const keptLoops = stacked ? [r.loops[outerLoop[ri]]] : r.loops
      const loops: Cubic[][] = keptLoops.map((refs) => {
        const cubics = refs.flatMap((ref) =>
          ref.reversed ? reverseCubics(arcCubics[ref.arc]) : arcCubics[ref.arc],
        )
        pointCount += cubics.length * 3 + 1
        return cubics
      })
      return {
        paletteIndex: seg.regionColor[r.region],
        area: areas[ri],
        stackOrder: firstPixel[r.region],
        loops,
      }
    })
  })
```

(d) Pass the flag to assembleSvg: add `stackedShapes: options.stackedShapes,` to its options object.

In `src/worker/vectorize.worker.ts`, apply the same four changes against the cache's local style: cache `loopAreas`-derived values alongside `cache.areas` (add `outerLoop?: number[]` to the `Cache` interface and fill it where `cache.areas` is computed in the boundaries block); compute `firstPixel` from `cache.seg!` inside the fit stage (it is cheap and only runs when `stacked`); mirror (c) and (d) exactly with `cache.bounds!`/`cache.corners!`/`cache.areas!`. Extend the trailing comment on `firstDirtyStage`'s final return to include `stackedShapes` in its list of fit-tier fields — no logic change.

- [ ] **Step 6: Write the failing e2e + cache tests**

In `tests/workerCache.test.ts`, append (reusing the file's existing base-options fixture name):

```ts
it('stackedShapes change re-enters at fit', () => {
  expect(firstDirtyStage(base, { ...base, stackedShapes: true }, true)).toBe('fit')
})
```

In `tests/e2e.test.ts`, append a describe block. Fixture: 80×80 white image with a black ring (annulus) centered at (40,40), outer radius 25, inner radius 12 — three regions (white background, black ring, white inner disc), two palette colors, and a background-colored counter (the exact case that makes transparentBg unsafe in stacked mode). Build it with the file's existing raster-fabrication helpers; run the full `vectorize` with `colorCount: 2`, `despeckleSize: 0`, defaults otherwise:

```ts
describe('stacked shapes e2e', () => {
  const flatOpts = { ...DEFAULT_OPTIONS, colorCount: 2, despeckleSize: 0, mergePaths: false }
  const stackedOpts = { ...flatOpts, stackedShapes: true }

  it('emits solid single-subpath shapes in containment order and shrinks the file', () => {
    const flat = vectorize(ring(), flatOpts).svg
    const stacked = vectorize(ring(), stackedOpts).svg
    expect((stacked.match(/<path/g) ?? []).length).toBe(3)
    // one subpath per path: 3 M commands total vs 5 flat (bg + ring each carry a hole)
    expect((stacked.match(/M/g) ?? []).length).toBe(3)
    expect((flat.match(/M/g) ?? []).length).toBe(5)
    // containment order: white bg first, black ring second, white disc last (visible)
    const fills = [...stacked.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1])
    expect(fills[0]).toBe(fills[2]) // bg and disc share the white palette color
    expect(fills[1]).not.toBe(fills[0]) // ring between them
    expect(stacked.length).toBeLessThan(flat.length)
  })

  it('ignores transparentBg and mergePaths while stacked', () => {
    const base = vectorize(ring(), stackedOpts).svg
    const noisy = vectorize(ring(), {
      ...stackedOpts,
      transparentBg: true,
      mergePaths: true,
    }).svg
    expect(noisy).toBe(base)
  })
})
```

(`ring()` = the annulus fixture above, written with the file's helper style; `M` counting works for both serializers — compact mode also emits exactly one `M` per subpath and lowercase `c`/`z` elsewhere. If the existing fixtures in the file use a shared builder, follow it.)

- [ ] **Step 7: Run the new tests, then the full verification suite**

Run: `npx vitest run` then `npm run check && npm run lint && npm run format:check && npm run build`
Expected: all pass — including every pre-existing test unchanged (byte-identical flat output). If a pre-existing test fails, the flat path was disturbed: fix the regression, never the test.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/worker/pipeline/svg.ts src/worker/pipeline/index.ts src/worker/vectorize.worker.ts tests/svg.test.ts tests/e2e.test.ts tests/workerCache.test.ts
git commit -m "feat: stacked shapes output — solid regions painted in containment order"
```

---

### Task 2: Stacked shapes UI

**Files:**
- Modify: `src/lib/ControlsPanel.svelte` (Output section, `src/lib/ControlsPanel.svelte:228-239`)

**Interfaces:**
- Consumes: `options.stackedShapes: boolean` from Task 1 (bound like the sibling checkboxes; `onchange` triggers the rerun).
- Produces: nothing consumed later.

- [ ] **Step 1: Add the checkbox and disable the conflicting options**

In the Output section, add a "Stacked shapes" checkbox after "Optimize", and disable "Merge colors" and "Transparent bg" while it is on (values are preserved, just inert — the pipeline already ignores them):

```svelte
    <label class="check"
      ><input type="checkbox" bind:checked={options.stackedShapes} {onchange} /> Stacked shapes</label
    >
    <label class="check" class:disabled={options.stackedShapes}
      ><input
        type="checkbox"
        bind:checked={options.mergePaths}
        disabled={options.stackedShapes}
        {onchange}
      /> Merge colors</label
    >
    <label class="check" class:disabled={options.stackedShapes}
      ><input
        type="checkbox"
        bind:checked={options.transparentBg}
        disabled={options.stackedShapes}
        {onchange}
      /> Transparent bg</label
    >
```

If the stylesheet has no `.check.disabled` rule, add one beside the existing `.check` styles:

```css
  .check.disabled {
    opacity: 0.45;
  }
```

Match the component's existing formatting exactly (Prettier will verify).

- [ ] **Step 2: Verify in the full suite**

Run: `npx vitest run && npm run check && npm run lint && npm run format:check && npm run build`
Expected: all clean. (No new component test — the panel has no existing test file and the binding is declarative; the pipeline behavior is covered by Task 1.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/ControlsPanel.svelte
git commit -m "feat: stacked shapes toggle in output controls"
```
