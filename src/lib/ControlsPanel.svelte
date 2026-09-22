<!-- src/lib/ControlsPanel.svelte -->
<script lang="ts">
  import {
    Columns2,
    SquareSplitHorizontal,
    Maximize,
    Eye,
    EyeOff,
    Plus,
    Trash2,
  } from '@lucide/svelte'
  import type { LocalCircle, PipelineOptions, PipelineStats } from '../types'
  import { maxGapClosing } from './decode'
  import FileMenu from './FileMenu.svelte'
  import { sliderFill } from './sliderFill'

  type SliderKey =
    | 'smoothness'
    | 'despeckleSize'
    | 'gapClosing'
    | 'blackPoint'
    | 'whitePoint'
    | 'flatten'
    | 'blurRadius'
    | 'saturation'

  let {
    options = $bindable(),
    scale = $bindable(),
    mode = $bindable(),
    showUnmodified = $bindable(),
    hasAdjustments,
    stats,
    svg,
    palette,
    notice,
    savedName,
    canSaveAs,
    saveStatus,
    projectSavedName,
    mod,
    circles,
    selected,
    onchange,
    onscale,
    onfit,
    onnew,
    onopen,
    onsave,
    onsaveproject,
    onadd,
    ondelete,
    onselect,
    ontogglehidden,
    oncircle,
  }: {
    options: PipelineOptions
    scale: number
    mode: 'side' | 'split'
    showUnmodified: boolean
    /** Whether any Input adjustment is active; without one the input is already unmodified. */
    hasAdjustments: boolean
    stats: PipelineStats | null
    svg: string | null
    palette: number[] | null
    notice: string | null
    /** The file Save overwrites (desktop Chromium, after a first save); null = Save asks where. */
    savedName: string | null
    /** Whether a separate "Save as…" means anything: only with a save picker, i.e. not iPad. */
    canSaveAs: boolean
    saveStatus: string | null
    /** The file Save project overwrites, after a first save; null = it asks where. */
    projectSavedName: string | null
    /** '⌘' or 'Ctrl+', for the menu's shortcut hints. */
    mod: string
    circles: LocalCircle[]
    selected: number
    onchange: () => void
    onscale: () => void
    onfit: () => void
    onnew: () => void
    onopen: () => void
    onsave: (asNew: boolean) => void
    onsaveproject: (asNew: boolean) => void
    onadd: () => void
    ondelete: () => void
    onselect: (i: number) => void
    ontogglehidden: (i: number) => void
    oncircle: (i: number, c: LocalCircle) => void
  } = $props()

  const rgbHex = (p: number[], i: number) =>
    '#' +
    [p[3 * i], p[3 * i + 1], p[3 * i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')
  function setOverride(i: number, hexColor: string) {
    const k = (palette?.length ?? 0) / 3
    const arr = options.colorOverrides
      ? [...options.colorOverrides]
      : Array<string | null>(k).fill(null)
    arr[i] = hexColor
    options.colorOverrides = arr
    onchange()
  }
  function clearOverrides() {
    options.colorOverrides = null
    onchange()
  }

  const totalMs = (s: PipelineStats) =>
    Object.values(s.timings)
      .reduce((a, b) => a + (b ?? 0), 0)
      .toFixed(0)
  // Stages skipped by the worker cache are absent from timings, so they stay out of the line.
  const stageMs = (s: PipelineStats) =>
    Object.entries(s.timings)
      .map(([name, ms]) => `${name} ${(ms ?? 0).toFixed(0)}`)
      .join(' · ')
  const sizeKb = (s: string) => (new TextEncoder().encode(s).length / 1024).toFixed(1) + ' kB'
</script>

<!-- label | slider | value. The value box is fixed-width and tabular so the slider does not
     resize as digits change (guide §6). -->
{#snippet slider(
  label: string,
  key: SliderKey,
  min: number,
  max: number,
  step: number,
  digits: number,
)}
  <label class="slider-row">
    <span class="name">{label}</span>
    <input
      type="range"
      {min}
      {max}
      {step}
      bind:value={options[key]}
      oninput={onchange}
      style={sliderFill(options[key], min, max)}
    />
    <span class="value">{options[key].toFixed(digits)}</span>
  </label>
{/snippet}

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

<div class="cp">
  <header class="top">
    <strong>slop-vectorizer</strong>
    <FileMenu
      canNew={!!svg}
      canSaveProject={!!svg}
      {projectSavedName}
      {canSaveAs}
      {mod}
      {onnew}
      {onopen}
      {onsaveproject}
    />
  </header>

  <section>
    <h2 class="section-head">View</h2>
    <div class="body">
      <div class="icon-row">
        <button
          class="icon-btn"
          class:ui-on={mode === 'side'}
          aria-pressed={mode === 'side'}
          onclick={() => (mode = 'side')}
          title="Side by side"><Columns2 size={16} /></button
        >
        <button
          class="icon-btn"
          class:ui-on={mode === 'split'}
          aria-pressed={mode === 'split'}
          onclick={() => (mode = 'split')}
          title="Split"><SquareSplitHorizontal size={16} /></button
        >
        <button class="icon-btn" onclick={onfit} title="Fit"><Maximize size={16} /></button>
        <button
          class="unmodified"
          class:ui-on={showUnmodified && hasAdjustments}
          aria-pressed={showUnmodified}
          disabled={!hasAdjustments}
          title={hasAdjustments
            ? 'Show the input without Input adjustments (view only)'
            : 'No Input adjustments are active'}
          onclick={() => (showUnmodified = !showUnmodified)}>Unmodified</button
        >
      </div>
    </div>
  </section>

  <section>
    <h2 class="section-head">Vectorize</h2>
    <div class="body">
      <label class="select-row">
        <span class="name">Colors</span>
        <select
          value={options.colorCount === 'auto' ? 'auto' : String(options.colorCount)}
          onchange={(e) => {
            const v = (e.target as HTMLSelectElement).value
            options.colorCount = v === 'auto' ? 'auto' : Number(v)
            onchange()
          }}
        >
          <option value="auto">auto</option>
          {#each Array.from({ length: 15 }, (_, i) => i + 2) as k}
            <option value={String(k)}>{k}</option>
          {/each}
        </select>
      </label>
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
            <button class="link" onclick={clearOverrides}>Reset colors</button>
          {/if}
        </div>
      {/if}
      {@render slider('Smoothness', 'smoothness', 0, 1, 0.05, 2)}
      {@render slider('Despeckle', 'despeckleSize', 1, 64, 1, 0)}
      <!-- Max scales with the working image: gaps span scale× more pixels, so the
           cap keeps the same ~6px physical bridge limit at native scale. -->
      {@render slider('Gap closing', 'gapClosing', 0, maxGapClosing(scale), 1, 0)}
    </div>
  </section>

  <section>
    <h2 class="section-head">Input</h2>
    <div class="body">
      <!-- Below ×1 the resampler averages away paper texture and pixel noise, which
           yields smoother shapes and fewer boundary points; above ×1 it gives thin
           strokes more pixels to survive segmentation. -->
      <label class="select-row">
        <span class="name">Scale</span>
        <select bind:value={scale} onchange={onscale}>
          <option value={1 / 3}>×⅓</option><option value={0.5}>×½</option><option value={1}
            >×1</option
          ><option value={2}>×2</option><option value={3}>×3</option>
        </select>
      </label>
      {@render slider('Black point', 'blackPoint', 0, 254, 1, 0)}
      {@render slider('White point', 'whitePoint', 1, 255, 1, 0)}
      <!-- Divides out a fitted lighting gradient, for photographed/scanned art where
           the paper drifts bright enough on one side to break into blotches. -->
      {@render slider('Flatten', 'flatten', 0, 1, 0.05, 2)}
      {@render slider('Blur', 'blurRadius', 0, 10, 0.5, 1)}
      {@render slider('Saturation', 'saturation', 0, 2, 0.05, 2)}
      <button
        class="reset"
        onclick={() => {
          options.blackPoint = 0
          options.whitePoint = 255
          options.blurRadius = 0
          options.saturation = 1
          options.flatten = 0
          onchange()
        }}>Reset</button
      >
    </div>
  </section>

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

  <section>
    <h2 class="section-head">Output</h2>
    <!-- Toggle buttons, not checkboxes: the view buttons above already say "on" by filling,
         and one app expresses one idea one way (guide §6). -->
    <div class="body toggles">
      <button
        class:ui-on={options.optimize}
        aria-pressed={options.optimize}
        onclick={() => {
          options.optimize = !options.optimize
          onchange()
        }}>Optimize</button
      >
      <button
        class:ui-on={options.stackedShapes}
        aria-pressed={options.stackedShapes}
        onclick={() => {
          options.stackedShapes = !options.stackedShapes
          onchange()
        }}>Stacked shapes</button
      >
      <button
        class:ui-on={options.mergePaths && !options.stackedShapes}
        aria-pressed={options.mergePaths}
        disabled={options.stackedShapes}
        title={options.stackedShapes ? 'Not used with stacked shapes' : undefined}
        onclick={() => {
          options.mergePaths = !options.mergePaths
          onchange()
        }}>Merge colors</button
      >
      <button
        class:ui-on={options.transparentBg && !options.stackedShapes}
        aria-pressed={options.transparentBg}
        disabled={options.stackedShapes}
        title={options.stackedShapes ? 'Not used with stacked shapes' : undefined}
        onclick={() => {
          options.transparentBg = !options.transparentBg
          onchange()
        }}>Transparent bg</button
      >
    </div>
  </section>

  <div class="save">
    <div class="save-buttons">
      <button
        class="btn-primary grow"
        onclick={() => onsave(false)}
        disabled={!svg}
        title={savedName ? `Overwrite ${savedName}` : undefined}>Save SVG</button
      >
      {#if canSaveAs && savedName}
        <button onclick={() => onsave(true)} disabled={!svg}>Save as…</button>
      {/if}
    </div>
    {#if savedName}<p class="hint">Saves over {savedName}</p>{/if}
    {#if saveStatus}<p class="hint" role="status">{saveStatus}</p>{/if}
  </div>

  <footer>
    {#if notice}<p class="notice">{notice}</p>{/if}
    {#if stats}
      <span class="stats">
        <span
          >{stats.pathCount} paths · {stats.pointCount} points · {totalMs(stats)} ms{#if svg}
            · {sizeKb(svg)}{/if}</span
        >
        {#if stageMs(stats)}<span>{stageMs(stats)}</span>{/if}
      </span>
    {/if}
  </footer>
</div>

<style>
  .cp {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    font-size: 12px;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 44px;
    padding: 0 12px;
    flex-shrink: 0;
  }
  .top strong {
    font-size: 14px;
    font-weight: 600;
  }
  /* A raised band like slop-vector-editor's panel headers: the boundary between sections is a
     change of colour, not a 1px line one step from its background. */
  .section-head {
    margin: 0;
    height: 32px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    background: var(--color-raised);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-muted);
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
  .body {
    padding: 8px 12px 12px;
  }
  .name {
    color: var(--color-muted);
    white-space: nowrap;
  }
  .select-row,
  .slider-row {
    display: grid;
    align-items: center;
    gap: 8px;
    min-height: var(--ctl-h);
    margin: 2px 0;
  }
  .select-row {
    grid-template-columns: 1fr auto;
  }
  .slider-row {
    grid-template-columns: 76px minmax(0, 1fr) 32px;
  }
  .value {
    color: var(--color-muted);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .icon-row {
    display: flex;
    gap: 4px;
  }
  .icon-btn {
    width: var(--ctl-h);
    padding: 0;
  }
  .unmodified {
    margin-left: auto;
  }
  .toggles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .reset {
    margin-top: 6px;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 6px 0;
    align-items: center;
  }
  .swatch {
    width: 22px;
    height: 22px;
    border: 1px solid var(--color-line);
    border-radius: 4px;
    cursor: pointer;
    position: relative;
  }
  /* Out of flow, so marking a swatch never moves its neighbours (guide §5). */
  .swatch.overridden::after {
    content: '';
    position: absolute;
    inset: -3px;
    border: 2px solid var(--color-accent);
    border-radius: 6px;
  }
  .swatch input {
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
  }
  .link {
    height: auto;
    padding: 0;
    border: none;
    background: none;
    color: var(--color-accent);
    font-size: 11px;
  }
  .link:hover:not(:disabled) {
    color: var(--color-accent-hover);
  }
  .save {
    padding: 12px;
    border-top: 1px solid var(--color-line);
  }
  .save-buttons {
    display: flex;
    gap: 6px;
  }
  .grow {
    flex: 1;
  }
  .hint {
    margin: 6px 0 0;
    color: var(--color-muted);
    font-size: 11px;
    overflow-wrap: anywhere;
  }
  .notice {
    margin: 0 0 4px;
    color: var(--color-warn);
  }
  footer {
    margin-top: auto;
    padding: 8px 12px;
    color: var(--color-muted);
    font-size: 11px;
  }
  footer .stats {
    display: flex;
    flex-direction: column;
    line-height: 1.35;
    font-variant-numeric: tabular-nums;
  }
</style>
