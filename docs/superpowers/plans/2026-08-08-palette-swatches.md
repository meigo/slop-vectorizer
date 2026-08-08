# Palette Swatches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clickable palette swatches that recolor the output SVG, per `docs/superpowers/specs/2026-08-08-palette-swatches-design.md`.

**Architecture:** `colorOverrides` rides through `PipelineOptions` into the SVG serialization stage (fill substitution by palette index); the worker ships the detected palette back with each result; the panel renders swatches over hidden native color inputs. Segmentation and geometry untouched.

**Tech Stack:** existing (Svelte 5 runes, TS strict, Vitest). No new dependencies.

## Global Constraints

- Work on branch `feature/palette-swatches` off main (no worktree — user preference).
- Recolor-only semantics: an override may change ONLY fill strings in the output — path data, path count, merging, transparent-bg behavior byte-identical.
- `colorOverrides: (string | null)[] | null`, default `null`; out-of-range/short arrays behave as "no override".
- Overrides change routes to the `'fit'` cache tier (existing fallthrough — assert, don't add tiers).
- Determinism preserved. TS strict, no `any`. All five checks green before each commit: `npx vitest run`, `npm run check`, `npm run lint`, `npm run format:check` (run `npm run format` before committing), `npm run build`.

## File Structure

| File | Change |
|---|---|
| `src/types.ts` | `colorOverrides` in PipelineOptions/defaults; `palette` on result message + ClientResult |
| `src/worker/pipeline/svg.ts` | fill substitution in assembleSvg |
| `src/worker/pipeline/index.ts`, `src/worker/vectorize.worker.ts` | pass overrides; worker posts palette |
| `src/lib/workerClient.ts` | palette passthrough |
| `src/App.svelte` | staleness reset, palette prop |
| `src/lib/ControlsPanel.svelte` | swatch row + reset link |
| `tests/svg.test.ts`, `tests/e2e.test.ts`, `tests/workerCache.test.ts` | coverage |

---

### Task 1: colorOverrides through the pipeline

**Files:**
- Modify: `src/types.ts`, `src/worker/pipeline/svg.ts`, `src/worker/pipeline/index.ts`, `src/worker/vectorize.worker.ts`
- Test: `tests/svg.test.ts`, `tests/e2e.test.ts`, `tests/workerCache.test.ts`

**Interfaces:**
- Consumes: existing `SvgOptions`, `assembleSvg(paths, palette, width, height, opts)`.
- Produces:

```ts
// types.ts
// PipelineOptions gains:
colorOverrides: (string | null)[] | null   // hex '#rrggbb' by palette index; default null
// SvgOptions (svg.ts) gains the same field.
```

- [ ] **Step 1: Write failing tests**

`tests/svg.test.ts` — add inside the existing describe (reuse its `palette`, `square`, `bg` fixtures; extend the file's base options objects with `colorOverrides: null`):

```ts
it('colorOverrides replaces exactly the overridden fill', () => {
  const opts = { mergePaths: false, transparentBg: false, optimize: false, colorOverrides: [null, '#123456'] }
  const svg = assembleSvg([square, bg], palette, 20, 20, opts)
  expect(svg).toContain('fill="#123456"') // square (index 1) recolored
  expect(svg).toContain('fill="#f5f5f5"') // bg (index 0) untouched
  expect(svg).not.toContain('#c81e1e')
})

it('colorOverrides changes only fills, never geometry', () => {
  const base = { mergePaths: true, transparentBg: false, optimize: true, colorOverrides: null }
  const a = assembleSvg([square, bg], palette, 20, 20, base)
  const b = assembleSvg([square, bg], palette, 20, 20, { ...base, colorOverrides: ['#000000', '#ffffff'] })
  const paths = (s: string) => [...s.matchAll(/d="([^"]*)"/g)].map((m) => m[1])
  expect(paths(b)).toEqual(paths(a))
})

it('short or absent override arrays are no-ops', () => {
  const base = { mergePaths: false, transparentBg: false, optimize: false, colorOverrides: null }
  const a = assembleSvg([square, bg], palette, 20, 20, base)
  const b = assembleSvg([square, bg], palette, 20, 20, { ...base, colorOverrides: [] })
  expect(b).toBe(a)
})
```

`tests/workerCache.test.ts`:

```ts
it('colorOverrides change -> fit', () =>
  expect(firstDirtyStage(base, { ...base, colorOverrides: ['#ff0000'] }, true)).toBe('fit'))
```

`tests/e2e.test.ts`:

```ts
it('colorOverrides recolors output and stays byte-deterministic', () => {
  const img = renderShape(96, 96, insideCircle(48, 48, 30), [200, 30, 30], [245, 245, 245])
  const opts = { ...DEFAULT_OPTIONS, colorOverrides: ['#112233', '#445566'] }
  const a = vectorize(img, opts)
  const b = vectorize(img, opts)
  expect(a.svg).toBe(b.svg)
  expect(a.svg).toMatch(/fill="#(112233|445566)"/)
  const plain = vectorize(img, DEFAULT_OPTIONS)
  const paths = (s: string) => [...s.matchAll(/d="([^"]*)"/g)].map((m) => m[1])
  expect(paths(a.svg)).toEqual(paths(plain.svg))
})
```

- [ ] **Step 2: Run to verify fail** — compile errors (missing fields) / assertion failures.

- [ ] **Step 3: Implement**

`src/types.ts`: add `colorOverrides: (string | null)[] | null` to `PipelineOptions` (comment `// output recolor by palette index, '#rrggbb'; null = detected`), `colorOverrides: null` to `DEFAULT_OPTIONS`.

`src/worker/pipeline/svg.ts`: add the field to `SvgOptions`; in `assembleSvg`'s body emit `const fill = opts.colorOverrides?.[p.paletteIndex] ?? hex(palette.colors, p.paletteIndex)` and use `fill="${fill}"`.

`src/worker/pipeline/index.ts` and `src/worker/vectorize.worker.ts`: add `colorOverrides: options.colorOverrides` to the options object each passes to `assembleSvg`. `firstDirtyStage` needs NO change — the fallthrough covers it (that's what the cache test asserts).

- [ ] **Step 4: Run all five checks** (format first).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: colorOverrides recolor output fills by palette index"`

---

### Task 2: palette in the worker result

**Files:**
- Modify: `src/types.ts`, `src/worker/vectorize.worker.ts`, `src/lib/workerClient.ts`
- Test: `tests/workerClient.test.ts`

**Interfaces:**
- Consumes: worker's `cache.palette` (`Palette { k, colors: Uint8ClampedArray }`).
- Produces:

```ts
// types.ts result message variant gains:
palette: number[]   // k*3 RGB
// ClientResult gains:
palette?: number[]
```

- [ ] **Step 1: Write failing test**

`tests/workerClient.test.ts` uses a FakeWorker — extend its fake result message with a `palette` field and assert the client passes it through:

```ts
it('passes palette through to the resolved result', async () => {
  // In the FakeWorker's posted result message, include: palette: [10, 20, 30, 240, 240, 240]
  // (adapt to the file's existing fake-message helper; read the file first)
  const res = await client.vectorize(image, DEFAULT_OPTIONS)
  expect(res.palette).toEqual([10, 20, 30, 240, 240, 240])
})
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

`src/types.ts`: result variant becomes `{ type: 'result'; jobId: number; result: VectorResult; preImage?: RasterImage; palette: number[] }`; `ClientResult` gains `palette?: number[]`.

`src/worker/vectorize.worker.ts`: in the result post, add `palette: Array.from(cache.palette!.colors)`.

`src/lib/workerClient.ts`: resolve `{ ...m.result, preImage: m.preImage, palette: m.palette }`.

- [ ] **Step 4: Run all five checks.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: worker result carries detected palette"`

---

### Task 3: swatch UI + staleness reset

**Files:**
- Modify: `src/lib/ControlsPanel.svelte`, `src/App.svelte`

**Interfaces:**
- Consumes: `ClientResult.palette`, `options.colorOverrides`, existing `onchange` debounce contract.
- Produces: ControlsPanel prop `palette: number[] | null`.

- [ ] **Step 1: ControlsPanel** (read the file first; add under the Colors select in the Vectorize section)

```svelte
<script lang="ts">
  // props gain: palette: number[] | null
  const rgbHex = (p: number[], i: number) =>
    '#' + [p[3 * i], p[3 * i + 1], p[3 * i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')
  function setOverride(i: number, hexColor: string) {
    const k = (palette?.length ?? 0) / 3
    const arr = options.colorOverrides ? [...options.colorOverrides] : Array<string | null>(k).fill(null)
    arr[i] = hexColor
    options.colorOverrides = arr
    onchange()
  }
  function clearOverrides() {
    options.colorOverrides = null
    onchange()
  }
</script>

{#if palette && palette.length >= 3}
  <div class="swatches">
    {#each { length: palette.length / 3 } as _, i}
      {@const effective = options.colorOverrides?.[i] ?? rgbHex(palette, i)}
      <label
        class="swatch"
        class:overridden={!!options.colorOverrides?.[i]}
        title={effective}
        style:background={effective}
      >
        <input
          type="color"
          value={effective}
          oninput={(e) => setOverride(i, (e.target as HTMLInputElement).value)}
        />
      </label>
    {/each}
    {#if options.colorOverrides?.some(Boolean)}
      <button class="reset-colors" onclick={clearOverrides}>reset colors</button>
    {/if}
  </div>
{/if}
```

```css
.swatches { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.4rem; align-items: center; }
.swatch { width: 22px; height: 22px; border: 1px solid #0003; border-radius: 4px; cursor: pointer; position: relative; }
.swatch.overridden::after { content: ''; position: absolute; inset: -3px; border: 2px solid #4a90d9; border-radius: 6px; }
.swatch input { opacity: 0; width: 100%; height: 100%; cursor: pointer; }
.reset-colors { background: none; border: none; color: #4a90d9; cursor: pointer; font-size: 0.8rem; padding: 0; }
```

- [ ] **Step 2: App wiring + staleness**

Pass `palette={result?.palette ?? null}` to ControlsPanel. Add the staleness effect (module-level `let lastPalette: number[] | null = null`, NOT $state):

```ts
// Overrides are index-aligned with the palette they were made for; when a new
// result arrives with a different palette, they're stale — drop them. (The one
// result computed with mismatched overrides renders once; the reset takes effect
// on the next re-run. Accepted transient per spec.)
$effect(() => {
  const pal = result?.palette
  if (!pal) return
  const changed = lastPalette !== null && (lastPalette.length !== pal.length || lastPalette.some((v, i) => v !== pal[i]))
  if (changed && options.colorOverrides) options.colorOverrides = null
  lastPalette = pal
})
```

- [ ] **Step 3: Run all five checks + dev-server curl smoke.** Manual QA (deferred to human): swatches appear after vectorize, click → picker preloaded with current color, pick → that color's shapes recolor (~instantly, fit-tier), ring on overridden swatch, reset link clears, changing Colors count resets overrides, download matches.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: palette swatches with click-to-recolor and reset"`

---

## Self-review notes (completed during plan writing)

- **Spec coverage:** data flow (options field, SvgOptions, worker palette, ClientResult) → T1/T2; recolor-only guarantee → T1's geometry-equality tests; cache tier assertion → T1; staleness rule incl. accepted transient → T3; UI (swatches, hidden native input, ring, reset link, render-only-with-result) → T3; determinism → T1 e2e; out-of-range defensive → `?.[i] ??` semantics + short-array test.
- **Type consistency:** `colorOverrides` shape identical across types/svg/panel; `palette: number[]` k×3 in message, prop, and `rgbHex` indexing.
- **Adaptation points (instructed, not placeholders):** FakeWorker message shape in T2's test; exact insertion points in ControlsPanel/App in T3.
