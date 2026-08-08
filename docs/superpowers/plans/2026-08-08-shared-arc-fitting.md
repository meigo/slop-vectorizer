# Shared-Arc Fitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fit each shared boundary exactly once so abutting shapes emit mathematically identical curves — eliminating smoothing cracks by construction — per `docs/superpowers/specs/2026-08-08-shared-arc-fitting-design.md`.

**Architecture:** `extractBoundaries` splits traced loops into **arcs** (maximal constant-neighbor runs, deduped exactly via the refinement cache's edge ids, junction lattice vertices as shared endpoints); corners and Bézier fitting run once per arc; region paths are assembled by concatenating per-arc cubics with exact reversal.

**Tech Stack:** existing only (TS strict, Vitest).

## Global Constraints

- Boundary point geometry unchanged except: junction lattice vertices (integer coords) are ADDED as shared arc endpoints — the only geometric delta, at ≥3-region meets only.
- Determinism: same input + options ⇒ byte-identical SVG. No Math.random, stable iteration orders only.
- Existing sub-pixel tests (0.1px circle etc.) must pass untouched. Cubic-count assertions may change ONLY with stated justification in the task report.
- `stats.pointCount` continues counting per-path output.
- Worker cache tier semantics unchanged (boundaries stage caches arcs+refs, corners stage per-arc corners, fit tier refits+reassembles).
- No changes to svg.ts — output options consume assembled loops as before.
- All five checks green before every commit (`npx vitest run`, `npm run check`, `npm run lint`, `npm run format:check` after `npm run format`, `npm run build`); conventional commits; branch `feature/shared-arcs`.

## File Structure

| File | Change |
|---|---|
| `src/types.ts` | `BoundaryArc`, `ArcRef`, `RegionArcs`, `Boundaries` (replace `RegionLoops`) |
| `src/worker/pipeline/boundaries.ts` | arc extraction; `loopPointsOf` assembly helper |
| `src/worker/pipeline/corners.ts` | `findOpenCorners` (open-polyline variant) |
| `src/worker/pipeline/fitcurves.ts` | `fitArc`, `reverseCubics` |
| `src/worker/pipeline/index.ts`, `src/worker/vectorize.worker.ts` | per-arc corners/fit + assembly |
| `tests/boundaries.test.ts`, `tests/corners.test.ts`, `tests/fitcurves.test.ts`, `tests/e2e.test.ts` | adapted + new arc/crack/junction tests |

---

### Task 1: Arc extraction (the tracer restructure)

**Files:**
- Modify: `src/types.ts`, `src/worker/pipeline/boundaries.ts`
- Test: `tests/boundaries.test.ts`

**Interfaces:**
- Consumes: existing tracer internals (directed-edge walk, `refineEdge` cache, junction tie-break — all preserved verbatim).
- Produces (Tasks 2–4 rely on these exact shapes):

```ts
// types.ts — REPLACES RegionLoops
export interface BoundaryArc {
  points: Float64Array // interleaved x,y in canonical (first-traversal) direction
  closed: boolean // true: full loop (blob/border loop), no junction endpoints
}
export interface ArcRef {
  arc: number // index into Boundaries.arcs
  reversed: boolean // this region traverses the arc against stored direction
}
export interface RegionArcs {
  region: number
  loops: ArcRef[][] // one ArcRef list per boundary loop, in traversal order
}
export interface Boundaries {
  arcs: BoundaryArc[]
  regions: RegionArcs[]
}

// boundaries.ts
export function extractBoundaries(image, seg, palette): Boundaries
/** Reassemble one loop's raw polyline from its arcs (junction points deduped). */
export function loopPointsOf(arcs: BoundaryArc[], loop: ArcRef[]): Float64Array
```

Semantics locked down:
- **Open arc points** = `[startJunctionVertex, ...refined edge midpoints, endJunctionVertex]` — junction vertices are integer lattice coords, shared exactly by every arc meeting there.
- **Closed arc points** = the refined midpoints only (no junction, no duplicated first point) — a loop whose neighbor never changes.
- **Dedup**: each lattice edge has id `V(x,y)*2 + (vertical ? 1 : 0)`; an arc's identity is the MINIMUM edge id it covers (arcs partition edges ⇒ unique). First traversal stores the arc (canonical direction); the second traverser of the same id gets `reversed: true` (opposite-side walks are always opposite-direction).
- `loopPointsOf`: single closed-arc loop → the points (reversed if flagged); multi-arc loop → concatenate, skipping each arc's FIRST point (its start junction equals the previous arc's end junction; the loop's opening junction is supplied by the final arc's end). No point appears twice; no trailing duplicate of the first point.

- [ ] **Step 1: Write failing tests**

Rewrite `tests/boundaries.test.ts`'s existing assertions to consume the new shape via `loopPointsOf` (the circle-radius 0.1px test, single-loop test, and shared-point-identity test keep their EXACT tolerances — geometry is unchanged for the junction-free circle fixture), and add:

```ts
it('arcs: shared arcs referenced exactly twice with opposite directions', () => {
  // two abutting rectangles on background -> 3 regions, junctions where they meet the bg
  const img = renderShape(120, 80, (x, y) => x >= 20 && x < 60 && y >= 20 && y < 60, [200, 30, 30], [245, 245, 245])
  for (let y = 20; y < 60; y++)
    for (let x = 60; x < 100; x++) {
      const o = (y * 120 + x) * 4
      img.data[o] = 30
      img.data[o + 1] = 30
      img.data[o + 2] = 200
    }
  const pal = estimatePalette(img, 3)
  const seg = segmentImage(img, pal, 4)
  const b = extractBoundaries(img, seg, pal)
  const refCount = new Map<number, { n: number; dirs: boolean[] }>()
  for (const r of b.regions)
    for (const loop of r.loops)
      for (const ref of loop) {
        const e = refCount.get(ref.arc) ?? { n: 0, dirs: [] }
        e.n++
        e.dirs.push(ref.reversed)
        refCount.set(ref.arc, e)
      }
  for (const [arc, e] of refCount) {
    expect(e.n).toBeLessThanOrEqual(2)
    if (e.n === 2) expect(e.dirs[0]).not.toBe(e.dirs[1]) // opposite directions
    void arc
  }
  // every arc is referenced at least once
  expect([...refCount.keys()].length).toBe(b.arcs.length)
})

it('arcs: open-arc endpoints are integer junction vertices shared across arcs', () => {
  // same fixture as above (extract into a helper in this file)
  const b = abuttingRectsBoundaries()
  const endpoints = new Set<string>()
  for (const a of b.arcs) {
    if (a.closed) continue
    const sx = a.points[0], sy = a.points[1]
    const ex = a.points[a.points.length - 2], ey = a.points[a.points.length - 1]
    for (const [x, y] of [[sx, sy], [ex, ey]]) {
      expect(Number.isInteger(x)).toBe(true)
      expect(Number.isInteger(y)).toBe(true)
      endpoints.add(`${x},${y}`)
    }
  }
  expect(endpoints.size).toBeGreaterThan(0)
})

it('loopPointsOf: loops close without duplicated points', () => {
  const b = abuttingRectsBoundaries()
  for (const r of b.regions)
    for (const loop of r.loops) {
      const pts = loopPointsOf(b.arcs, loop)
      const seen = new Set<string>()
      for (let i = 0; i < pts.length; i += 2) {
        const k = `${pts[i]},${pts[i + 1]}`
        expect(seen.has(k)).toBe(false)
        seen.add(k)
      }
    }
})
```

- [ ] **Step 2: Run to verify fail** — type errors (RegionLoops gone) and missing exports.

- [ ] **Step 3: Implement**

In `boundaries.ts`, keep everything through the loop walk (`verts` collection, the left-turn junction tie-break) verbatim. Replace the loop→points conversion (currently the `pts` block) with arc splitting:

```ts
// module-level within extractBoundaries, before the region loop:
const arcs: BoundaryArc[] = []
const arcByKey = new Map<number, number>() // min edge id -> arc index
const vertX = (v: number) => v % (w + 1)
const vertY = (v: number) => (v / (w + 1)) | 0

// ... inside the per-loop block, after `verts` is complete, replacing the pts block:
const m = verts.length
const nbr = new Int32Array(m) // neighbor region per lattice edge
const eid = new Int32Array(m) // undirected edge id per lattice edge
const mid = new Float64Array(2 * m) // refined midpoint per lattice edge
for (let i = 0; i < m; i++) {
  const a = verts[i],
    b = verts[(i + 1) % m]
  const axv = vertX(a),
    ayv = vertY(a),
    bxv = vertX(b),
    byv = vertY(b)
  let p: [number, number], q: [number, number], id: number
  if (ayv === byv) {
    const ex = Math.min(axv, bxv)
    p = [ex, ayv - 1]
    q = [ex, ayv]
    id = V(ex, ayv) * 2
  } else {
    const ey = Math.min(ayv, byv)
    p = [axv - 1, ey]
    q = [axv, ey]
    id = V(axv, ey) * 2 + 1
  }
  const lp = lab(...p),
    lq = lab(...q)
  nbr[i] = lp === region ? lq : lp
  eid[i] = id
  const inImg = (px: number, py: number) => px >= 0 && py >= 0 && px < w && py < h
  if (inImg(...p) && inImg(...q)) {
    const [rx, ry] = refineEdge(p[0], p[1], q[0], q[1])
    mid[2 * i] = rx
    mid[2 * i + 1] = ry
  } else {
    mid[2 * i] = (axv + bxv) / 2
    mid[2 * i + 1] = (ayv + byv) / 2
  }
}
// find a neighbor-change point to start arc runs at
let startI = -1
for (let i = 0; i < m; i++)
  if (nbr[i] !== nbr[(i - 1 + m) % m]) {
    startI = i
    break
  }
const loopRefs: ArcRef[] = []
if (startI < 0) {
  // constant neighbor: one closed arc
  let minE = Infinity
  for (let i = 0; i < m; i++) minE = Math.min(minE, eid[i])
  const existing = arcByKey.get(minE)
  if (existing === undefined) {
    const idx = arcs.push({ points: mid.slice(), closed: true }) - 1
    arcByKey.set(minE, idx)
    loopRefs.push({ arc: idx, reversed: false })
  } else {
    loopRefs.push({ arc: existing, reversed: true })
  }
} else {
  let i = startI
  do {
    const runNbr = nbr[i]
    const pts: number[] = [vertX(verts[i]), vertY(verts[i])] // start junction
    let minE = Infinity
    let j = i
    do {
      pts.push(mid[2 * j], mid[2 * j + 1])
      minE = Math.min(minE, eid[j])
      j = (j + 1) % m
    } while (nbr[j] === runNbr && j !== startI)
    pts.push(vertX(verts[j]), vertY(verts[j])) // end junction
    const existing = arcByKey.get(minE)
    if (existing === undefined) {
      const idx = arcs.push({ points: new Float64Array(pts), closed: false }) - 1
      arcByKey.set(minE, idx)
      loopRefs.push({ arc: idx, reversed: false })
    } else {
      loopRefs.push({ arc: existing, reversed: true })
    }
    i = j
  } while (i !== startI)
}
// per-region collection becomes RegionArcs:
regionLoops.push(loopRefs) // gather per region, emit { region, loops } as before
```

Return `{ arcs, regions }`. Then the helper:

```ts
function reversePts(p: Float64Array): Float64Array {
  const n = p.length / 2
  const out = new Float64Array(p.length)
  for (let i = 0; i < n; i++) {
    out[2 * i] = p[2 * (n - 1 - i)]
    out[2 * i + 1] = p[2 * (n - 1 - i) + 1]
  }
  return out
}

export function loopPointsOf(arcs: BoundaryArc[], loop: ArcRef[]): Float64Array {
  if (loop.length === 1 && arcs[loop[0].arc].closed) {
    const p = arcs[loop[0].arc].points
    return loop[0].reversed ? reversePts(p) : p.slice()
  }
  const out: number[] = []
  for (const ref of loop) {
    const p = arcs[ref.arc].points
    const pts = ref.reversed ? reversePts(p) : p
    for (let i = 2; i < pts.length; i += 2) out.push(pts[i], pts[i + 1]) // skip start junction
  }
  return new Float64Array(out)
}
```

Note: `src/worker/pipeline/index.ts` and `vectorize.worker.ts` won't compile until Task 3 — to keep this task's gate green, update them minimally in THIS task to consume `loopPointsOf` (fit per assembled loop exactly as today: `bounds.regions.map(r => r.loops.map(refs => loopPointsOf(bounds.arcs, refs)))` feeding the existing per-loop corners+fit). That keeps behavior byte-equivalent-modulo-junction-points while Task 3 lands the real per-arc path.

- [ ] **Step 4: Run to verify pass** — full suite. The diagonal-junction boundary test may need adaptation (junction vertices now appear as points); justify any change in the report.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: boundary arcs with exact shared-arc dedup"`

---

### Task 2: Open-polyline corner detection

**Files:**
- Modify: `src/worker/pipeline/corners.ts`
- Test: `tests/corners.test.ts`

**Interfaces:**
- Consumes: module's existing `SCALES` / `ANGLE_THRESHOLD` constants and closed-loop `findCorners`.
- Produces: `export function findOpenCorners(loop: Float64Array): number[]` — ascending INTERIOR indices (never 0 or n−1); same thresholds; scale windows truncate at endpoints (per-scale step = `min(s, i, n-1-i)`, skipped when < 1); NMS window clamped to [1, n−2].

- [ ] **Step 1: Write failing tests**

```ts
it('findOpenCorners: right angle mid-polyline is found, endpoints are not corners', () => {
  const pts: number[] = []
  for (let i = 0; i <= 20; i++) pts.push(i, 0) // along x
  for (let i = 1; i <= 20; i++) pts.push(20, i) // turn 90° at index 20
  const corners = findOpenCorners(new Float64Array(pts))
  expect(corners).toEqual([20])
})

it('findOpenCorners: straight and gently-curved open lines have none', () => {
  const straight: number[] = []
  for (let i = 0; i <= 30; i++) straight.push(i, 0.05 * i)
  expect(findOpenCorners(new Float64Array(straight))).toEqual([])
  const gentle: number[] = []
  for (let i = 0; i <= 40; i++) gentle.push(i, 10 * Math.sin(i / 15))
  expect(findOpenCorners(new Float64Array(gentle))).toEqual([])
})
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** — mirror `findCorners`'s deviation+NMS structure without wraparound:

```ts
export function findOpenCorners(loop: Float64Array): number[] {
  const n = loop.length / 2
  if (n < 5) return []
  const px = (i: number) => loop[2 * i]
  const py = (i: number) => loop[2 * i + 1]
  const deviation = new Float64Array(n)
  for (let i = 1; i < n - 1; i++) {
    let minDev = Infinity
    for (const s of SCALES) {
      const step = Math.min(s, i, n - 1 - i)
      if (step < 1) continue
      const ax = px(i) - px(i - step),
        ay = py(i) - py(i - step)
      const bx = px(i + step) - px(i),
        by = py(i + step) - py(i)
      const dot = ax * bx + ay * by,
        cross = ax * by - ay * bx
      minDev = Math.min(minDev, Math.abs(Math.atan2(cross, dot)))
    }
    deviation[i] = minDev === Infinity ? 0 : minDev
  }
  const win = SCALES[SCALES.length - 1]
  const corners: number[] = []
  for (let i = 1; i < n - 1; i++) {
    if (deviation[i] < ANGLE_THRESHOLD) continue
    let isMax = true
    for (let d = -win; d <= win; d++) {
      if (d === 0) continue
      const j = i + d
      if (j < 1 || j > n - 2) continue
      if (deviation[j] > deviation[i] || (deviation[j] === deviation[i] && j < i)) {
        isMax = false
        break
      }
    }
    if (isMax) corners.push(i)
  }
  return corners
}
```

- [ ] **Step 4: Run to verify pass** — full suite.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: open-polyline corner detection for arcs"`

---

### Task 3: Per-arc fitting + exact-reversal assembly

**Files:**
- Modify: `src/worker/pipeline/fitcurves.ts`, `src/worker/pipeline/index.ts`, `src/worker/vectorize.worker.ts`, `src/types.ts` (worker cache typing if needed)
- Test: `tests/fitcurves.test.ts`

**Interfaces:**
- Consumes: `Boundaries`/`loopPointsOf` (T1), `findOpenCorners` (T2), existing `fitLoop`/`fitCubic`.
- Produces:

```ts
export function fitArc(points: Float64Array, corners: number[], closed: boolean, maxErrorPx: number): Cubic[]
export function reverseCubics(cubics: Cubic[]): Cubic[] // exact: per-cubic endpoint/control swap + list reversal
```

- [ ] **Step 1: Write failing tests**

```ts
it('reverseCubics is an exact involution and preserves geometry', () => {
  const cubics = fitLoop(circleLoop(50, 50, 30), [], 0.5)
  const back = reverseCubics(reverseCubics(cubics))
  expect(back).toEqual(cubics)
  const rev = reverseCubics(cubics)
  // reversed chain still closes and visits the same endpoint set
  for (let i = 0; i < rev.length; i++) {
    const next = rev[(i + 1) % rev.length]
    expect(rev[i][6]).toBeCloseTo(next[0], 12)
    expect(rev[i][7]).toBeCloseTo(next[1], 12)
  }
})

it('fitArc (open): endpoints are pinned exactly, interior corner honored', () => {
  const pts: number[] = []
  for (let i = 0; i <= 20; i++) pts.push(i, 0)
  for (let i = 1; i <= 20; i++) pts.push(20, i)
  const arc = new Float64Array(pts)
  const cubics = fitArc(arc, [20], false, 0.5)
  expect(cubics[0][0]).toBe(0) // first endpoint exact
  expect(cubics[0][1]).toBe(0)
  expect(cubics[cubics.length - 1][6]).toBe(20) // last endpoint exact
  expect(cubics[cubics.length - 1][7]).toBe(20)
  expect(cubics.length).toBe(2) // one straight run per side of the corner
})
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

```ts
export function reverseCubics(cubics: Cubic[]): Cubic[] {
  return cubics
    .map((c): Cubic => [c[6], c[7], c[4], c[5], c[2], c[3], c[0], c[1]])
    .reverse()
}

/** Fit one arc once. Open arcs break at [start, ...interior corners, end] with
 * one-sided tangents (junction endpoints are corner-like by design). */
export function fitArc(
  points: Float64Array,
  corners: number[],
  closed: boolean,
  maxErrorPx: number,
): Cubic[] {
  if (closed) return fitLoop(points, corners, maxErrorPx)
  const n = points.length / 2
  const p = (i: number): V => ({ x: points[2 * i], y: points[2 * i + 1] })
  const breaks = [0, ...corners.filter((c) => c > 0 && c < n - 1), n - 1]
  const errSq = maxErrorPx * maxErrorPx
  const out: Cubic[] = []
  for (let b = 0; b + 1 < breaks.length; b++) {
    const seg: V[] = []
    for (let i = breaks[b]; i <= breaks[b + 1]; i++) seg.push(p(i))
    if (seg.length < 2) continue
    const tHat1 = normalize(sub(seg[1], seg[0]))
    const tHat2 = normalize(sub(seg[seg.length - 2], seg[seg.length - 1]))
    fitCubic(seg, tHat1, tHat2, errSq, out)
  }
  return out
}
```

Then rewire BOTH `src/worker/pipeline/index.ts` and `src/worker/vectorize.worker.ts` (identical logic in each):

```ts
const cornersPerArc = stage('corners', () =>
  bounds.arcs.map((a) => (a.closed ? findCorners(a.points) : findOpenCorners(a.points))),
)
// fit stage:
const arcCubics = bounds.arcs.map((a, i) => fitArc(a.points, cornersPerArc[i], a.closed, maxErrorPx))
const paths = bounds.regions.map((r): RegionPath => {
  const loops: Cubic[][] = r.loops.map((refs) => {
    const cubics = refs.flatMap((ref) =>
      ref.reversed ? reverseCubics(arcCubics[ref.arc]) : arcCubics[ref.arc],
    )
    pointCount += cubics.length * 3 + 1
    return cubics
  })
  const area = Math.max(...r.loops.map((refs) => Math.abs(polygonArea(loopPointsOf(bounds.arcs, refs)))))
  return { paletteIndex: seg.regionColor[r.region], area, loops }
})
```

Remove Task 1's temporary `loopPointsOf`-based fitting path. Worker `Cache.corners` type becomes `number[][]` (per arc).

- [ ] **Step 4: Run to verify pass** — full suite; cubic-count assertions that shift get justified in the report (e.g., junction endpoints add segment breaks).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: fit each boundary arc once and assemble regions by exact reversal"`

---

### Task 4: Crack + junction regression suite

**Files:**
- Test: `tests/e2e.test.ts`

**Interfaces:**
- Consumes: full pipeline.
- Produces: the tests that make the feature's promise falsifiable.

- [ ] **Step 1: Write the tests (failing before T3, passing after — this task runs them against the completed pipeline)**

```ts
function parseCubics(d: string): number[][] {
  // absolute output (optimize:false): M x y C c1x c1y c2x c2y x y C ...
  const cubics: number[][] = []
  for (const sub of d.split('M').filter(Boolean)) {
    const nums = sub.match(/-?\d+\.?\d*/g)!.map(Number)
    let cx = nums[0],
      cy = nums[1]
    for (let i = 2; i + 5 < nums.length; i += 6) {
      cubics.push([cx, cy, nums[i], nums[i + 1], nums[i + 2], nums[i + 3], nums[i + 4], nums[i + 5]])
      cx = nums[i + 4]
      cy = nums[i + 5]
    }
  }
  return cubics
}
const canon = (c: number[]) => {
  const rev = [c[6], c[7], c[4], c[5], c[2], c[3], c[0], c[1]]
  return JSON.stringify(c.join() < rev.join() ? c : rev)
}

it('shared boundaries emit identical curves in both neighbors (no cracks at max smoothness)', () => {
  const img = renderShape(120, 80, (x, y) => x >= 20 && x < 60 && y >= 20 && y < 60, [200, 30, 30], [245, 245, 245])
  for (let y = 20; y < 60; y++)
    for (let x = 60; x < 100; x++) {
      const o = (y * 120 + x) * 4
      img.data[o] = 30
      img.data[o + 1] = 30
      img.data[o + 2] = 200
    }
  const { svg } = vectorize(img, { ...DEFAULT_OPTIONS, colorCount: 3, smoothness: 1, mergePaths: false, optimize: false })
  const paths = [...svg.matchAll(/d="([^"]*)"/g)].map((m) => parseCubics(m[1]))
  // find the two shape paths (not the background = largest cubic count area... use fills)
  const fills = [...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1])
  const idxRed = fills.findIndex((f) => f !== fills[0] && true) // adapt: identify red/blue paths by fill hex from the result's palette
  // For each cubic in one shape path lying along the shared edge (both endpoints with x in [58,62]),
  // its canonical form must appear in the OTHER shape path.
  const setOf = (cubics: number[][]) => new Set(cubics.map(canon))
  const shapePaths = paths.filter((_, i) => i !== 0) // background painted first (largest area)
  const [a, bPath] = shapePaths
  const bSet = setOf(bPath)
  const sharedInA = a.filter((c) => Math.abs(c[0] - 60) < 3 && Math.abs(c[6] - 60) < 3)
  expect(sharedInA.length).toBeGreaterThan(0)
  for (const c of sharedInA) expect(bSet.has(canon(c))).toBe(true)
})

it('all loops chain closed through junctions (three colors meeting)', () => {
  // same fixture; every subpath's cubics must chain end-to-start and close
  const img = /* same as above */
  const { svg } = vectorize(img, { ...DEFAULT_OPTIONS, colorCount: 3, smoothness: 0.8, mergePaths: false, optimize: false })
  for (const m of svg.matchAll(/d="([^"]*)"/g)) {
    for (const sub of m[1].split('M').filter(Boolean)) {
      const nums = sub.match(/-?\d+\.?\d*/g)!.map(Number)
      let cx = nums[0], cy = nums[1]
      const sx = cx, sy = cy
      for (let i = 2; i + 5 < nums.length; i += 6) {
        cx = nums[i + 4]
        cy = nums[i + 5]
      }
      expect(cx).toBeCloseTo(sx, 6)
      expect(cy).toBeCloseTo(sy, 6)
    }
  }
})
```

(The parse helpers account for the rounded 2-decimal absolute output; the `canon` matching works because both neighbors serialize the SAME rounded numbers. The implementer adapts the red/blue path identification to the actual emitted fills — read the result's palette or filter by known hex.)

- [ ] **Step 2: Run, verify pass; run all five checks.**

- [ ] **Step 3: Commit** — `git add -A && git commit -m "test: crack-free shared boundaries and junction closure regression"`

---

## Self-review notes (completed during plan writing)

- **Spec coverage:** arc model + canonical direction + exact dedup + closed-arc handling → T1 (canonical simplified to first-traversal order — deterministic, noted as an approved deviation from "lower region id": reversal is exact either way, and first-traversal avoids a second pass); junction vertices as shared endpoints → T1; per-arc corners with truncated windows + junction-as-corner endpoints → T2/T3; fit-once + exact reversal + assembly → T3; invariants (sub-pixel tests untouched, determinism, pointCount, cache tiers, svg.ts untouched) → constraints + T3; crack + junction + arc-sanity tests → T1/T4.
- **Type consistency:** `Boundaries`/`BoundaryArc`/`ArcRef`/`RegionArcs`/`loopPointsOf`/`findOpenCorners`/`fitArc`/`reverseCubics` names match across tasks.
- **Sequencing:** T1 keeps the pipeline green via the temporary assembled-loop fitting path; T3 replaces it. Cubic counts may shift at junction fixtures only, with per-report justification.
- **Known risks flagged in-task:** diagonal-junction boundary test adaptation (T1 step 4); shape-path identification in the crack test (T4 note).
