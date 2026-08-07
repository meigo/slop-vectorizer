# Output Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three output options — merge same-color shapes, transparent background, compact (optimized) serialization — per `docs/superpowers/specs/2026-08-08-output-options-design.md`.

**Architecture:** All three are serialization-stage concerns: `PipelineOptions` gains three booleans, `assembleSvg` gains an options parameter, and the orchestrator/worker pass them through. The worker's `firstDirtyStage` already routes option-only changes to the cheap `'fit'` tier (fallthrough) — tests assert it, no cache code changes. UI adds three checkboxes and a kB output-size stat.

**Tech Stack:** Existing: Svelte 5, TypeScript strict, Vitest. No new dependencies.

## Global Constraints

- Defaults: `mergePaths: true`, `transparentBg: false`, `optimize: true` (exact values from spec).
- Determinism: same input + options ⇒ byte-identical SVG, all modes.
- `optimize: false` must keep the current absolute serialization byte-for-byte.
- Pipeline purity (no DOM/Svelte in `src/worker/pipeline/`), TS strict, no `any`.
- `stats.pathCount` becomes the number of emitted `<path>` elements (count `/<path/g` matches in the SVG string) — with merging on, this is what the user's file actually contains.
- Conventional commits; full suite + `npm run check` + `npm run build` green before each commit.

## File Structure

| File | Change |
|---|---|
| `src/types.ts` | 3 new `PipelineOptions` fields + defaults |
| `src/worker/pipeline/svg.ts` | `SvgOptions` param: merge, transparent-bg, compact writer |
| `src/worker/pipeline/index.ts` | Pass options through; pathCount from emitted paths |
| `src/worker/vectorize.worker.ts` | Same plumbing in the cached path |
| `src/lib/Controls.svelte` | 3 checkboxes + output-size stat |
| `tests/svg.test.ts`, `tests/e2e.test.ts`, `tests/workerCache.test.ts` | Updated + new cases |

---

### Task 1: mergePaths + transparentBg, end to end

**Files:**
- Modify: `src/types.ts`, `src/worker/pipeline/svg.ts`, `src/worker/pipeline/index.ts`, `src/worker/vectorize.worker.ts`
- Test: `tests/svg.test.ts`, `tests/e2e.test.ts`, `tests/workerCache.test.ts`

**Interfaces:**
- Consumes: existing `RegionPath`, `Palette`, `Cubic`, `vectorize()`, worker `run()`.
- Produces (Task 2 and 3 rely on these exact shapes):

```ts
// types.ts — PipelineOptions gains (optimize arrives in Task 2):
mergePaths: boolean    // default true
transparentBg: boolean // default false

// svg.ts
export interface SvgOptions { mergePaths: boolean; transparentBg: boolean }
export function assembleSvg(paths: RegionPath[], palette: Palette, width: number, height: number, opts: SvgOptions): string
```

- [ ] **Step 1: Write failing tests**

Append to `tests/svg.test.ts` (inside the existing `describe`, reusing its `palette`, `square`, `bg` fixtures) and update the two existing `assembleSvg` calls to pass `{ mergePaths: false, transparentBg: false }` as the 5th argument (their expectations are otherwise unchanged):

```ts
const V1 = { mergePaths: false, transparentBg: false }

it('mergePaths: one path per color, subpaths preserved', () => {
  const square2: RegionPath = { ...square, area: 50 } // second region, same color
  const svg = assembleSvg([square, bg, square2], palette, 20, 20, { ...V1, mergePaths: true })
  expect(svg.match(/<path/g)!.length).toBe(2) // 2 colors, not 3 regions
  // both square regions' subpaths live in the red path's d
  const red = svg.split('\n').find(l => l.includes('#c81e1e'))!
  expect(red.match(/M/g)!.length).toBe(2)
})

it('transparentBg drops all background-colored regions', () => {
  const bgPocket: RegionPath = { paletteIndex: 0, area: 5, loops: [[[2, 2, 3, 2, 3, 2, 4, 2]]] }
  const svg = assembleSvg([square, bg, bgPocket], palette, 20, 20, { ...V1, transparentBg: true })
  expect(svg.match(/<path/g)!.length).toBe(1) // only the square survives
  expect(svg).not.toContain('#f5f5f5')
})

it('transparentBg with every region background-colored yields empty-bodied svg', () => {
  const svg = assembleSvg([bg], palette, 20, 20, { ...V1, transparentBg: true })
  expect(svg).not.toContain('<path')
  expect(svg).toContain('viewBox="0 0 20 20"')
})
```

Append to `tests/workerCache.test.ts` (`firstDirtyStage` describe):

```ts
it('mergePaths change -> fit', () =>
  expect(firstDirtyStage(base, { ...base, mergePaths: !base.mergePaths }, true)).toBe('fit'))
it('transparentBg change -> fit', () =>
  expect(firstDirtyStage(base, { ...base, transparentBg: !base.transparentBg }, true)).toBe('fit'))
```

Append to `tests/e2e.test.ts`:

```ts
it('transparentBg circle -> single path, no background color', () => {
  const img = renderShape(96, 96, insideCircle(48, 48, 30), [200, 30, 30], [245, 245, 245])
  const { svg, stats } = vectorize(img, { ...DEFAULT_OPTIONS, transparentBg: true })
  expect(stats.pathCount).toBe(1)
  expect(svg.match(/<path/g)!.length).toBe(1)
})

it('merged ring -> 2 paths (ink, paper), holes intact', () => {
  const ring = (x: number, y: number) => {
    const d = Math.hypot(x - 48, y - 48)
    return d >= 18 && d <= 26
  }
  const img = renderShape(96, 96, ring, [20, 20, 20], [245, 245, 245])
  const { svg, stats } = vectorize(img, { ...DEFAULT_OPTIONS, mergePaths: true })
  expect(stats.pathCount).toBe(2)
  // paper group = border rect + inner disc (2 subpaths); ink = outer + inner edge (2)
  expect(svg.match(/M/g)!.length).toBe(4)
})
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/svg.test.ts tests/workerCache.test.ts tests/e2e.test.ts` → compile errors / failures (5th arg missing, fields missing).

- [ ] **Step 3: Implement**

`src/types.ts` — extend the interface and defaults:

```ts
export interface PipelineOptions {
  colorCount: number | 'auto'
  smoothness: number
  despeckleSize: number
  mergePaths: boolean    // one <path> per palette color
  transparentBg: boolean // skip background-colored regions
}

export const DEFAULT_OPTIONS: PipelineOptions = {
  colorCount: 'auto',
  smoothness: 0.5,
  despeckleSize: 4,
  mergePaths: true,
  transparentBg: false,
}
```

`src/worker/pipeline/svg.ts` — replace `assembleSvg` (keep `polygonArea`, `f`, `hex`, `loopToPath` as-is):

```ts
export interface SvgOptions { mergePaths: boolean; transparentBg: boolean }

export function assembleSvg(
  paths: RegionPath[], palette: Palette, width: number, height: number, opts: SvgOptions,
): string {
  let items: RegionPath[]
  if (opts.mergePaths) {
    const byColor = new Map<number, RegionPath>()
    for (const p of paths) {
      const g = byColor.get(p.paletteIndex)
      if (g) { g.area += p.area; g.loops.push(...p.loops) }
      else byColor.set(p.paletteIndex, { paletteIndex: p.paletteIndex, area: p.area, loops: [...p.loops] })
    }
    items = [...byColor.values()]
  } else {
    items = [...paths]
  }
  if (opts.transparentBg && paths.length > 0) {
    const bg = paths.reduce((a, b) => (b.area > a.area ? b : a)).paletteIndex
    items = items.filter(i => i.paletteIndex !== bg)
  }
  const body = items
    .sort((a, b) => b.area - a.area)
    .map(p => `<path fill="${hex(palette.colors, p.paletteIndex)}" fill-rule="evenodd" d="${p.loops.map(loopToPath).join('')}"/>`)
    .join('\n  ')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n  ${body}\n</svg>\n`
}
```

(Note the merge branch copies `p.loops` into a fresh array before pushing — never mutate the caller's `RegionPath`s; the worker reuses them across cached re-runs.)

`src/worker/pipeline/index.ts` — pass options and derive pathCount from the string. Replace the `svg` stage call and the return:

```ts
const svg = stage('svg', () =>
  assembleSvg(paths, palette, image.width, image.height, {
    mergePaths: options.mergePaths,
    transparentBg: options.transparentBg,
  }))
const pathCount = (svg.match(/<path/g) ?? []).length
return { svg, stats: { pathCount, pointCount, timings } }
```

`src/worker/vectorize.worker.ts` — same two changes in `run()` (the `assembleSvg` call gains the options object; the `result` post uses the string-derived `pathCount`).

- [ ] **Step 4: Run to verify pass** — full `npx vitest run` (the two pre-existing e2e cases must still pass: circle → 2 paths, 3-color → 3 paths — merging doesn't change those counts since each color is one region there). Also `npm run check` and `npm run build`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: merge same-color paths and transparent background options"`

---

### Task 2: Compact writer (`optimize`)

**Files:**
- Modify: `src/types.ts`, `src/worker/pipeline/svg.ts`, `src/worker/pipeline/index.ts`, `src/worker/vectorize.worker.ts`
- Test: `tests/svg.test.ts`

**Interfaces:**
- Consumes: Task 1's `SvgOptions`.
- Produces: `SvgOptions` gains `optimize: boolean`; `PipelineOptions`/`DEFAULT_OPTIONS` gain `optimize: true`. Compact `d` grammar: absolute `M` per subpath, then relative `c` segments, terminated by `z`; numbers are 2-decimal, no trailing zeros, no leading zero for |v|<1, no space before `-`.

- [ ] **Step 1: Write failing tests**

Append to `tests/svg.test.ts`:

```ts
const OPT = { mergePaths: false, transparentBg: false, optimize: true }

/** Parse an optimized d back to absolute cubic endpoints/controls. */
function parseCompact(d: string): number[] {
  const abs: number[] = []
  for (const sub of d.split(/M/).filter(Boolean)) {
    const [head, ...cs] = sub.replace(/z$/, '').split('c')
    const nums = (s: string) => s.match(/-?(\d+\.?\d*|\.\d+)/g)!.map(Number)
    let [cx, cy] = nums(head)
    abs.push(cx, cy)
    for (const c of cs) {
      const n = nums(c)
      abs.push(cx + n[0], cy + n[1], cx + n[2], cy + n[3], cx + n[4], cy + n[5])
      cx += n[4]; cy += n[5]
    }
  }
  return abs
}

it('optimize: round-trips to the same coordinates as absolute output', () => {
  const absSvg = assembleSvg([square], palette, 20, 20, { ...OPT, optimize: false })
  const optSvg = assembleSvg([square], palette, 20, 20, OPT)
  const absD = absSvg.match(/d="([^"]*)"/)![1]
  const optD = optSvg.match(/d="([^"]*)"/)![1]
  const absNums = absD.match(/-?(\d+\.?\d*|\.\d+)/g)!.map(Number)
  const optNums = parseCompact(optD)
  expect(optNums.length).toBe(absNums.length)
  optNums.forEach((v, i) => expect(v).toBeCloseTo(absNums[i], 6))
})

it('optimize: output is strictly smaller and has compact formatting', () => {
  const absSvg = assembleSvg([square, bg], palette, 20, 20, { ...OPT, optimize: false })
  const optSvg = assembleSvg([square, bg], palette, 20, 20, OPT)
  expect(optSvg.length).toBeLessThan(absSvg.length)
  expect(optSvg).not.toMatch(/ -/)   // no space before negatives
  expect(optSvg).not.toMatch(/\d+\.\d*0[" cz]/) // no trailing zeros
})
```

(Also update Task 1's `V1`/`OPT`-style option objects in this file so every `assembleSvg` call now carries all three fields — `V1` becomes `{ mergePaths: false, transparentBg: false, optimize: false }`.)

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/svg.test.ts`.

- [ ] **Step 3: Implement**

`src/types.ts`: add `optimize: boolean` to `PipelineOptions` (comment: `// compact path serialization`) and `optimize: true` to `DEFAULT_OPTIONS`.

`src/worker/pipeline/svg.ts`: add to `SvgOptions`; add the compact writer. Integer centi-units make relative deltas decimal-exact — no cumulative float drift over long subpaths:

```ts
const centi = (v: number) => Math.round(v * 100)

/** Format centi-units: 1234 -> "12.34", 50 -> ".5", -50 -> "-.5", 1200 -> "12", 0 -> "0". */
const fmtCenti = (c: number): string => {
  if (c === 0) return '0'
  const neg = c < 0, a = Math.abs(c)
  const int = Math.floor(a / 100), frac = a % 100
  let s: string
  if (frac === 0) s = String(int)
  else {
    let fs = String(frac).padStart(2, '0')
    if (fs.endsWith('0')) fs = fs.slice(0, 1)
    s = (int === 0 ? '' : String(int)) + '.' + fs
  }
  return (neg ? '-' : '') + s
}

/** Join with single spaces, omitting the space before a negative number. */
const joinNums = (parts: string[]): string =>
  parts.reduce((acc, p) => acc + (acc === '' || p.startsWith('-') ? '' : ' ') + p, '')

function loopToPathCompact(loop: Cubic[]): string {
  if (loop.length === 0) return ''
  let cx = centi(loop[0][0]), cy = centi(loop[0][1])
  let d = 'M' + joinNums([fmtCenti(cx), fmtCenti(cy)])
  for (const c of loop) {
    const n = [centi(c[2]) - cx, centi(c[3]) - cy, centi(c[4]) - cx, centi(c[5]) - cy, centi(c[6]) - cx, centi(c[7]) - cy]
    d += 'c' + joinNums(n.map(fmtCenti))
    cx = centi(c[6]); cy = centi(c[7])
  }
  return d + 'z'
}
```

In `assembleSvg`, pick the writer: `const toPath = opts.optimize ? loopToPathCompact : loopToPath` and use `p.loops.map(toPath).join('')`.

`src/worker/pipeline/index.ts` and `src/worker/vectorize.worker.ts`: add `optimize: options.optimize` to the options object passed to `assembleSvg`.

- [ ] **Step 4: Run to verify pass** — full `npx vitest run` + `npm run check` + `npm run build`. Note: `fmtCenti` in `M` uses centi of the already-2-decimal-rounded coordinate, so `optimize: false` output is untouched (guarded by Task 1's tests still passing with the old `f()` path).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: compact svg serialization (optimize option)"`

---

### Task 3: UI checkboxes + output size stat

**Files:**
- Modify: `src/lib/Controls.svelte`

**Interfaces:**
- Consumes: `PipelineOptions` (now 6 fields), existing `$bindable` options + `onchange` contract, existing `svg: string | null` prop.
- Produces: final UI. No new props.

- [ ] **Step 1: Read the current file** — `src/lib/Controls.svelte` was touched after the original plan (per-stage timings were added to the stats line); adapt the snippets below to what's actually there rather than overwriting.

- [ ] **Step 2: Implement**

After the Despeckle label, add three checkboxes (same visual row, matching label style):

```svelte
<label><input type="checkbox" bind:checked={options.optimize} onchange={onchange} /> Optimize</label>
<label><input type="checkbox" bind:checked={options.mergePaths} onchange={onchange} /> Merge colors</label>
<label><input type="checkbox" bind:checked={options.transparentBg} onchange={onchange} /> Transparent bg</label>
```

In the script, add a byte-size helper; in the stats span, append it after the existing figures:

```ts
const sizeKb = (s: string) => (new TextEncoder().encode(s).length / 1024).toFixed(1) + ' kB'
```

```svelte
{#if svg} · {sizeKb(svg)}{/if}
```

- [ ] **Step 3: Verify**

`npx vitest run` green; `npm run check` 0 errors; `npm run build` succeeds. Dev-server curl smoke. Manual checks (deferred to human if no browser): toggling each checkbox re-runs fast (fit-tier — only `fit`/`svg` in the timings), kB figure drops when Optimize/Merge are on, Transparent bg shows the checkerboard through the SVG side, downloaded file matches the toggles.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: output option controls and size stat"`

---

## Self-review notes (completed during plan writing)

- **Spec coverage:** options model + defaults → Tasks 1-2 types; merge semantics + paint order + no-mutation → Task 1; transparent-bg incl. enclosed pockets + empty-svg edge → Task 1 (pocket test + all-bg test); compact grammar + `optimize:false` byte-identity + determinism → Task 2 (round-trip + size tests; centi-int argument); cache tier → Task 1 workerCache tests; UI checkboxes + kB stat → Task 3; stats.pathCount redefinition → Task 1 (Global Constraints + both call sites).
- **Type consistency:** `SvgOptions` grows across Tasks 1→2; every `assembleSvg` call site listed in both tasks; `V1` fixture object updated in Task 2 when the field lands.
- **Known risk:** e2e ring subpath count (`M` count = 4) assumes despeckle doesn't eat the inner disc — at 96px with r=18 the disc is ~1000px², far above the default threshold, safe.
