<!-- src/lib/ControlsPanel.svelte -->
<script lang="ts">
  import { Moon, Sun, Columns2, SquareSplitHorizontal, Maximize } from '@lucide/svelte'
  import { theme } from './theme.svelte'
  import type { PipelineOptions, PipelineStats } from '../types'

  let {
    options = $bindable(),
    upscale = $bindable(),
    mode = $bindable(),
    stats,
    svg,
    palette,
    notice,
    onchange,
    onupscale,
    onfit,
    onnew,
  }: {
    options: PipelineOptions
    upscale: 1 | 2 | 3
    mode: 'side' | 'split'
    stats: PipelineStats | null
    svg: string | null
    palette: number[] | null
    notice: string | null
    onchange: () => void
    onupscale: () => void
    onfit: () => void
    onnew: () => void
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

  function download() {
    if (!svg) return
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'vectorized.svg'
    a.click()
    URL.revokeObjectURL(url)
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

<div class="cp">
  <header>
    <strong>slop-vectorizer</strong>
    <button class="icon-btn" onclick={() => theme.toggle()} title="Toggle theme">
      {#if theme.current === 'dark'}<Sun size={14} />{:else}<Moon size={14} />{/if}
    </button>
    <button onclick={onnew}>New image</button>
  </header>

  <section>
    <div class="label">View</div>
    <div class="row">
      <button onclick={() => (mode = 'side')} class:active={mode === 'side'} title="Side by side"
        ><Columns2 size={14} /></button
      >
      <button onclick={() => (mode = 'split')} class:active={mode === 'split'} title="Split"
        ><SquareSplitHorizontal size={14} /></button
      >
      <button onclick={onfit} title="Fit"><Maximize size={14} /></button>
    </div>
  </section>

  <section>
    <div class="label">Vectorize</div>
    <label>
      Colors
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
          <button class="reset-colors" onclick={clearOverrides}>reset colors</button>
        {/if}
      </div>
    {/if}
    <label>
      Smoothness
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        bind:value={options.smoothness}
        oninput={onchange}
      />
    </label>
    <label>
      Despeckle
      <input
        type="range"
        min="1"
        max="64"
        step="1"
        bind:value={options.despeckleSize}
        oninput={onchange}
      />
    </label>
    <!-- Max scales with upscale: gaps span upscale× more pixels, so the cap keeps
         the same ~6px physical bridge limit at native scale. -->
    <label
      >Gap closing <input
        type="range"
        min="0"
        max={3 * upscale}
        step="1"
        bind:value={options.gapClosing}
        oninput={onchange}
      /></label
    >
  </section>

  <section>
    <div class="label">Input</div>
    <label>
      Upscale
      <select bind:value={upscale} onchange={onupscale}>
        <option value={1}>×1</option><option value={2}>×2</option><option value={3}>×3</option>
      </select>
    </label>
    <label
      >Black point <input
        type="range"
        min="0"
        max="254"
        step="1"
        bind:value={options.blackPoint}
        oninput={onchange}
      /></label
    >
    <label
      >White point <input
        type="range"
        min="1"
        max="255"
        step="1"
        bind:value={options.whitePoint}
        oninput={onchange}
      /></label
    >
    <!-- Divides out a fitted lighting gradient, for photographed/scanned art where
         the paper drifts bright enough on one side to break into blotches. -->
    <label
      >Flatten <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        bind:value={options.flatten}
        oninput={onchange}
      /></label
    >
    <label
      >Blur <input
        type="range"
        min="0"
        max="10"
        step="0.5"
        bind:value={options.blurRadius}
        oninput={onchange}
      /></label
    >
    <label
      >Saturation <input
        type="range"
        min="0"
        max="2"
        step="0.05"
        bind:value={options.saturation}
        oninput={onchange}
      /></label
    >
    <button
      onclick={() => {
        options.blackPoint = 0
        options.whitePoint = 255
        options.blurRadius = 0
        options.saturation = 1
        options.flatten = 0
        onchange()
      }}>Reset</button
    >
  </section>

  <section>
    <div class="label">Output</div>
    <label class="check"
      ><input type="checkbox" bind:checked={options.optimize} {onchange} /> Optimize</label
    >
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
  </section>

  <button class="download" onclick={download} disabled={!svg}>Download SVG</button>

  <footer>
    {#if notice}<p class="notice">{notice}</p>{/if}
    {#if stats}
      <span class="stats">
        <span
          >{stats.pathCount} paths · {stats.pointCount} points · {totalMs(stats)} ms{#if svg}
            · {sizeKb(svg)}{/if}</span
        >
        {#if stageMs(stats)}<span class="stages">{stageMs(stats)}</span>{/if}
      </span>
    {/if}
  </footer>
</div>

<style>
  .cp {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    font-size: 11px;
    color: var(--color-text-secondary);
    min-height: 100%;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  header strong {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text);
  }
  .label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-secondary);
    margin-bottom: 0.4rem;
  }
  section label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    margin: 0.3rem 0;
    font-size: 11px;
  }
  section label.check {
    justify-content: flex-start;
    gap: 0.5rem;
  }
  .check.disabled {
    opacity: 0.45;
  }
  .row {
    display: flex;
    gap: 0.4rem;
  }
  .row button {
    padding: 0;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .row button.active {
    background: var(--color-accent);
    color: var(--color-accent-text);
    border-color: var(--color-accent);
  }
  .icon-btn {
    padding: 0;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
  }
  .icon-btn:hover {
    background: var(--color-surface-hover);
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.4rem;
    align-items: center;
  }
  .swatch {
    width: 22px;
    height: 22px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    cursor: pointer;
    position: relative;
  }
  .swatch.overridden::after {
    content: '';
    position: absolute;
    inset: -3px;
    border: 2px solid var(--color-selection);
    border-radius: 6px;
  }
  .swatch input {
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
  }
  .reset-colors {
    background: none;
    border: none;
    color: var(--color-selection);
    cursor: pointer;
    font-size: 10px;
    padding: 0;
  }
  .download {
    padding: 0.5rem;
    background: var(--color-accent);
    color: var(--color-accent-text);
    border-color: var(--color-accent);
  }
  .download:hover:not(:disabled) {
    opacity: 0.85;
  }
  .download:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .notice {
    color: #b8860b;
  }
  footer {
    margin-top: auto;
    color: var(--color-text-muted);
    font-size: 10px;
  }
  footer .stats {
    display: flex;
    flex-direction: column;
    line-height: 1.35;
  }
  footer .stages {
    color: var(--color-text-muted);
    font-size: 10px;
  }
</style>
