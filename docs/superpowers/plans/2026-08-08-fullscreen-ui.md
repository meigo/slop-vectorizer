# Full-screen Compare UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full-viewport workspace — two zoom/pan-synced image panes plus a 300px right controls panel, with the divider-split view kept as a second mode — per `docs/superpowers/specs/2026-08-08-fullscreen-ui-design.md`.

**Architecture:** Shared viewport state (`Viewport` class over `$state` fields, pure fit math in a plain module) consumed by two new `ImagePane`s, the refactored `CompareView`, and App. `ControlsPanel` replaces `Controls` with a sectioned vertical layout. Pipeline/worker untouched.

**Tech Stack:** Svelte 5 (runes), TypeScript strict, Vitest. No new dependencies.

## Global Constraints

- **PREREQUISITE:** the working branch must contain PR #1's changes (pre-effects/gap-closing/upscale — Controls has an Input row, App has `sourceFile`/`upscale`/`decodeAndRun`/`displayImage`). If `git log` lacks commit `0b30028`, STOP and report — the base is wrong.
- The pipeline test suite (67 tests) must pass **unchanged** — this is a pure UI refactor; only NEW tests may be added.
- Grid: `1fr 300px`; wheel-zoom clamp 0.1–64× around cursor (existing math, exact); fit = min(1, fit-to-container), centered.
- Mode switch preserves zoom/pan. Fit triggers on image-dimension change only (not on resize, not on mode switch).
- Svelte 5 runes only (`$state`, `$props`, `$derived`, `$effect`, `$bindable`). TS strict, no `any`.
- Every task: full suite + `npm run check` (0 errors; the 1 pre-existing CompareView a11y warning is expected) + `npm run build` green before commit; conventional commits.
- Read each Svelte file before editing — App.svelte and Controls.svelte contain PR #1 state the snippets below don't fully reproduce; adapt, don't overwrite blindly.

## File Structure

| File | Change |
|---|---|
| `src/lib/viewportMath.ts` | NEW: pure `computeFit` |
| `src/lib/viewport.svelte.ts` | NEW: `Viewport` class ($state fields, wheel/pan/fit methods) |
| `src/lib/ImagePane.svelte` | NEW: one synced pane (canvas bitmap OR svg) |
| `src/lib/CompareView.svelte` | Refactor: consume shared Viewport, drop local zoom/pan/fit |
| `src/App.svelte` | Full-viewport grid, mode state, fit wiring, empty state |
| `src/lib/ControlsPanel.svelte` | NEW: sectioned right panel (replaces Controls.svelte) |
| `src/lib/Controls.svelte` | Deleted in Task 3 |
| `src/app.css` or App `:global` styles | html/body/#app full-height reset |
| `tests/viewportMath.test.ts` | NEW |

---

### Task 1: Viewport state + fit math

**Files:**
- Create: `src/lib/viewportMath.ts`, `src/lib/viewport.svelte.ts`
- Test: `tests/viewportMath.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (Tasks 2–3 rely on these exact names):

```ts
// viewportMath.ts
export interface FitResult { zoom: number; panX: number; panY: number }
export function computeFit(cw: number, ch: number, iw: number, ih: number): FitResult

// viewport.svelte.ts
export class Viewport {
  zoom: number   // $state, init 1
  panX: number   // $state, init 0
  panY: number   // $state, init 0
  wheelAt(cx: number, cy: number, deltaY: number): void
  panBy(dx: number, dy: number): void
  fitTo(cw: number, ch: number, iw: number, ih: number): void
}
```

- [ ] **Step 1: Write failing tests**

```ts
// tests/viewportMath.test.ts
import { describe, it, expect } from 'vitest'
import { computeFit } from '../src/lib/viewportMath'

describe('computeFit', () => {
  it('fits a wide image to container width, vertically centered', () => {
    const f = computeFit(1000, 800, 2000, 1000)
    expect(f.zoom).toBeCloseTo(0.5)
    expect(f.panX).toBeCloseTo(0)
    expect(f.panY).toBeCloseTo((800 - 500) / 2)
  })
  it('fits a tall image to container height, horizontally centered', () => {
    const f = computeFit(1000, 500, 400, 1000)
    expect(f.zoom).toBeCloseTo(0.5)
    expect(f.panX).toBeCloseTo((1000 - 200) / 2)
    expect(f.panY).toBeCloseTo(0)
  })
  it('never upscales: small image renders at zoom 1, centered', () => {
    const f = computeFit(1000, 800, 100, 60)
    expect(f.zoom).toBe(1)
    expect(f.panX).toBeCloseTo(450)
    expect(f.panY).toBeCloseTo(370)
  })
})
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/viewportMath.test.ts` → module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/viewportMath.ts
export interface FitResult { zoom: number; panX: number; panY: number }

export function computeFit(cw: number, ch: number, iw: number, ih: number): FitResult {
  const zoom = Math.min(1, cw / iw, ch / ih)
  return { zoom, panX: (cw - iw * zoom) / 2, panY: (ch - ih * zoom) / 2 }
}
```

```ts
// src/lib/viewport.svelte.ts
import { computeFit } from './viewportMath'

export class Viewport {
  zoom = $state(1)
  panX = $state(0)
  panY = $state(0)

  wheelAt(cx: number, cy: number, deltaY: number): void {
    const factor = Math.exp(-deltaY * 0.002)
    const next = Math.min(64, Math.max(0.1, this.zoom * factor))
    this.panX = cx - (cx - this.panX) * (next / this.zoom)
    this.panY = cy - (cy - this.panY) * (next / this.zoom)
    this.zoom = next
  }

  panBy(dx: number, dy: number): void {
    this.panX += dx
    this.panY += dy
  }

  fitTo(cw: number, ch: number, iw: number, ih: number): void {
    const f = computeFit(cw, ch, iw, ih)
    this.zoom = f.zoom
    this.panX = f.panX
    this.panY = f.panY
  }
}
```

(`.svelte.ts` suffix is required — it tells the Svelte compiler to process the `$state` runes. `viewportMath.ts` stays a plain module so vitest needs no Svelte transform.)

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/viewportMath.test.ts`, then full suite (70 = 67 + 3), `npm run check`, `npm run build`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: shared viewport state with pure fit math"`

---

### Task 2: ImagePane + CompareView refactor + full-screen App grid

Deliverable: the app runs full-viewport with side-by-side synced panes as default, split mode toggleable, old Controls still functional in the right column (temporary placement — Task 3 replaces it).

**Files:**
- Create: `src/lib/ImagePane.svelte`
- Modify: `src/lib/CompareView.svelte`, `src/App.svelte`, `index.html` (only if a global style hook is needed)

**Interfaces:**
- Consumes: `Viewport`/`computeFit` from Task 1; existing `RasterImage`, `displayImage`, `sizedSvg` in App.
- Produces (Task 3 relies on): App state `mode: 'side' | 'split'` and `fit(): void`; `ImagePane` props `{ image?: RasterImage | null, svg?: string | null, label: string, viewport: Viewport }`; `CompareView` props now `{ image: RasterImage, svg: string, viewport: Viewport }`.

- [ ] **Step 1: Implement ImagePane**

```svelte
<!-- src/lib/ImagePane.svelte -->
<script lang="ts">
  import type { RasterImage } from '../types'
  import type { Viewport } from './viewport.svelte'

  let { image = null, svg = null, label, viewport }: {
    image?: RasterImage | null
    svg?: string | null
    label: string
    viewport: Viewport
  } = $props()

  let el: HTMLDivElement
  let canvas = $state<HTMLCanvasElement | null>(null)
  let panning = false, lastX = 0, lastY = 0

  $effect(() => {
    if (!canvas || !image) return
    canvas.width = image.width
    canvas.height = image.height
    canvas.getContext('2d')!.putImageData(
      new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  })

  function wheel(e: WheelEvent) {
    e.preventDefault()
    const r = el.getBoundingClientRect()
    viewport.wheelAt(e.clientX - r.left, e.clientY - r.top, e.deltaY)
  }
  function down(e: PointerEvent) {
    panning = true; lastX = e.clientX; lastY = e.clientY
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent) {
    if (!panning) return
    viewport.panBy(e.clientX - lastX, e.clientY - lastY)
    lastX = e.clientX; lastY = e.clientY
  }
  function up() { panning = false }
</script>

<div class="pane" bind:this={el}
     onwheel={wheel} onpointerdown={down} onpointermove={move} onpointerup={up}
     role="img" aria-label={label}>
  <div class="layer" style:transform={`translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`}>
    {#if image}
      <canvas bind:this={canvas} style:image-rendering="pixelated"></canvas>
    {:else if svg}
      {@html svg}
    {/if}
  </div>
  <span class="pane-label">{label}</span>
</div>

<style>
  .pane {
    position: relative; overflow: hidden;
    background: repeating-conic-gradient(#f0f0f0 0% 25%, #fff 0% 50%) 0 0 / 16px 16px;
    touch-action: none; cursor: grab;
  }
  .layer { position: absolute; inset: 0; transform-origin: 0 0; }
  .layer :global(svg), .layer canvas { display: block; width: auto; height: auto; }
  .pane-label {
    position: absolute; top: 8px; left: 10px; font-size: 12px; color: #555;
    background: #ffffffcc; padding: 2px 8px; border-radius: 4px; pointer-events: none;
  }
</style>
```

Note the caveat: with two panes sharing one `viewport`, coordinates must agree — the grid gives both panes identical sizes (`1fr 1fr`), so a pan/zoom made in one lands identically in the other.

- [ ] **Step 2: Refactor CompareView to the shared viewport**

Read the current file first. Remove: `zoom/panX/panY` state, `fittedW/fittedH` + the fit `$effect`, and the `wheel` zoom math. Add prop `viewport: Viewport`. Wheel handler becomes `viewport.wheelAt(...)` (same rect math); pan branch of `move()` becomes `viewport.panBy(...)`; both layer transforms read `viewport.panX/panY/zoom`. Divider logic, clip wrappers, canvas effect: unchanged.

- [ ] **Step 3: Rework App.svelte to the full-screen grid**

Read the current file first; keep ALL existing state/handlers (worker client, decodeAndRun, sourceFile, upscale, options, rerun, toast, sizedSvg, displayImage). Changes:

```svelte
<script lang="ts">
  // add:
  import ImagePane from './lib/ImagePane.svelte'
  import { Viewport } from './lib/viewport.svelte'
  const viewport = new Viewport()
  let mode = $state<'side' | 'split'>('side')
  let viewsW = $state(0), viewsH = $state(0)
  let fittedW = 0, fittedH = 0

  function paneW(): number { return mode === 'side' ? (viewsW - 2) / 2 : viewsW }
  function fit() {
    const img = displayImage
    if (img) viewport.fitTo(paneW(), viewsH, img.width, img.height)
  }
  $effect(() => { // fit on image-dimension change only
    const img = displayImage
    if (!img || viewsW === 0) return
    if (img.width === fittedW && img.height === fittedH) return
    fittedW = img.width; fittedH = img.height
    fit()
  })
</script>

{#if !image}
  <main class="empty">
    <Dropzone onfile={handleFile} {error} />
  </main>
{:else}
  <div class="app-grid">
    <div class="views" class:side={mode === 'side'}
         bind:clientWidth={viewsW} bind:clientHeight={viewsH}>
      {#if mode === 'side'}
        <ImagePane image={displayImage} label="Original" {viewport} />
        <ImagePane svg={result ? sizedSvg : null} label="SVG" {viewport} />
      {:else if result}
        <CompareView image={displayImage} svg={sizedSvg} {viewport} />
      {/if}
    </div>
    <aside class="panel">
      <!-- TEMPORARY until Task 3: -->
      <div class="view-controls">
        <button onclick={() => (mode = 'side')} disabled={mode === 'side'}>Side by side</button>
        <button onclick={() => (mode = 'split')} disabled={mode === 'split'}>Split</button>
        <button onclick={fit}>Fit</button>
      </div>
      <Controls ... existing props ... />
      ... existing notice/stats markup if any ...
    </aside>
  </div>
{/if}
... existing toast markup ...

<style>
  :global(html), :global(body), :global(#app) { height: 100%; margin: 0; }
  .app-grid { display: grid; grid-template-columns: 1fr 300px; height: 100vh; }
  .views { display: grid; min-width: 0; }
  .views.side { grid-template-columns: 1fr 1fr; gap: 2px; }
  .panel { overflow-y: auto; border-left: 1px solid #ddd; padding: 0.75rem; font-family: system-ui, sans-serif; }
  .empty { height: 100vh; display: flex; align-items: center; justify-content: center; }
  .view-controls { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
</style>
```

Adapt: the old `<main>` wrapper, `<h1>`, and the CompareView height CSS (`70vh`) go away; CompareView must fill its grid cell (`height: 100%` on `.compare` — adjust its style). If `src/app.css` exists and sets body margins, fix it there instead of `:global`. Delete the old fit `$effect` from CompareView (done in Step 2) — App now owns fit.

- [ ] **Step 4: Verify**

`npx vitest run` (70, unchanged pipeline tests green), `npm run check` (0 errors), `npm run build`, dev-server curl smoke. Report manual QA as deferred: side-by-side sync from either pane, mode toggle preserves zoom/pan, fit button, split divider still works full-height.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: full-screen grid with synced side-by-side panes and split mode"`

---

### Task 3: ControlsPanel + empty state polish

**Files:**
- Create: `src/lib/ControlsPanel.svelte`
- Modify: `src/App.svelte` (replace temporary view-controls + Controls with ControlsPanel; move notice/stats in)
- Delete: `src/lib/Controls.svelte`

**Interfaces:**
- Consumes: Task 2's `mode`/`fit`; all existing option/callback contracts from Controls (options $bindable, stats, svg, onchange, upscale $bindable, onupscale).
- Produces: final UI. ControlsPanel props:

```ts
{
  options: PipelineOptions            // $bindable
  upscale: 1 | 2 | 3                  // $bindable
  mode: 'side' | 'split'              // $bindable
  stats: PipelineStats | null
  svg: string | null
  notice: string | null
  onchange: () => void
  onupscale: () => void
  onfit: () => void
  onnew: () => void
}
```

- [ ] **Step 1: Implement ControlsPanel**

Port every control from the current Controls.svelte (read it — it has Vectorize sliders, Input row, Output checkboxes, download, stats with per-stage timings and kB) into this vertical sectioned layout, preserving every binding and handler exactly:

```svelte
<!-- src/lib/ControlsPanel.svelte — structure; port existing control markup into it -->
<script lang="ts">
  // imports + props per Interfaces block; port download() and stats helpers from Controls.svelte
</script>

<div class="cp">
  <header>
    <strong>slop-vectorizer</strong>
    <button onclick={onnew}>New image</button>
  </header>

  <section>
    <div class="label">View</div>
    <div class="row">
      <button onclick={() => (mode = 'side')} class:active={mode === 'side'}>Side by side</button>
      <button onclick={() => (mode = 'split')} class:active={mode === 'split'}>Split</button>
      <button onclick={onfit}>Fit</button>
    </div>
  </section>

  <section>
    <div class="label">Vectorize</div>
    <!-- Colors select, Smoothness, Despeckle, Gap closing — ported verbatim, vertical -->
  </section>

  <section>
    <div class="label">Input</div>
    <!-- Upscale select, Black point, White point, Blur, Saturation, Reset — ported verbatim -->
  </section>

  <section>
    <div class="label">Output</div>
    <!-- Optimize, Merge colors, Transparent bg checkboxes — ported verbatim -->
  </section>

  <button class="download" onclick={download} disabled={!svg}>Download SVG</button>

  <footer>
    {#if notice}<p class="notice">{notice}</p>{/if}
    <!-- stats line + per-stage timings — ported verbatim -->
  </footer>
</div>

<style>
  .cp { display: flex; flex-direction: column; gap: 1rem; font-size: 0.9rem; color: #444; }
  header { display: flex; justify-content: space-between; align-items: center; }
  .label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: #999; margin-bottom: 0.4rem; }
  section label { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; margin: 0.3rem 0; }
  .row { display: flex; gap: 0.4rem; }
  .row button.active { background: #4a90d9; color: white; }
  .download { padding: 0.5rem; }
  .notice { color: #b8860b; }
  footer { margin-top: auto; color: #888; font-size: 0.8rem; }
</style>
```

- [ ] **Step 2: Wire into App, delete leftovers**

Replace the temporary `.view-controls` block and `<Controls .../>` with `<ControlsPanel bind:options bind:upscale bind:mode {stats} svg={result?.svg ?? null} {notice} onchange={rerun} {onupscale} onfit={fit} onnew={...existing New-image handler...} />`. Move the downscale notice text into the `notice` prop. Delete `src/lib/Controls.svelte` and any now-unused imports/CSS (`.controls` row styles). "New image" behavior unchanged (cancel, reset state incl. upscale).

- [ ] **Step 3: Verify**

`npx vitest run` (70 green), `npm run check` (0 errors; expect the deletion to surface any missed Controls reference), `npm run build`, curl smoke. Manual QA deferred list in report: every slider/checkbox still re-runs, download works, New image → centered dropzone → new file round-trip, mode buttons + Fit.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: sectioned controls panel, full-screen empty state"`

---

## Self-review notes (completed during plan writing)

- **Spec coverage:** grid/full-viewport + no h1 → T2; shared Viewport + pure computeFit + tests → T1; ImagePane sync + labels + checkerboard → T2; split mode kept on shared viewport → T2; mode toggle preserves zoom/pan (viewport survives mode switch — state lives in App) → T2; fit on dimension change only + Fit button → T2; panel sections/header/footer/notice → T3; empty state centered dropzone + hidden panel → T2 markup ({#if !image}) with T3 polish; pipeline untouched → Global Constraints.
- **Type consistency:** `Viewport` methods used in ImagePane/CompareView/App match T1; ControlsPanel props match App's wiring in T3; `mode` union `'side' | 'split'` consistent.
- **Known adaptation points (explicitly instructed, not placeholders):** App/Controls contain PR #1 code the plan can't reproduce verbatim — tasks direct reading + porting "verbatim" rather than authoring anew; CompareView height change from 70vh to cell-filling.
