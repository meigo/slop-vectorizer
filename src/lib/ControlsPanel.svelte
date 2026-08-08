<!-- src/lib/ControlsPanel.svelte -->
<script lang="ts">
  import type { PipelineOptions, PipelineStats } from '../types'

  let {
    options = $bindable(),
    upscale = $bindable(),
    mode = $bindable(),
    stats,
    svg,
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
    notice: string | null
    onchange: () => void
    onupscale: () => void
    onfit: () => void
    onnew: () => void
  } = $props()

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
    <label
      >Gap closing <input
        type="range"
        min="0"
        max="3"
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
    <label
      >Blur <input
        type="range"
        min="0"
        max="10"
        step="1"
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
      ><input type="checkbox" bind:checked={options.mergePaths} {onchange} /> Merge colors</label
    >
    <label class="check"
      ><input type="checkbox" bind:checked={options.transparentBg} {onchange} /> Transparent bg</label
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
    font-size: 0.9rem;
    color: #444;
    min-height: 100%;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #999;
    margin-bottom: 0.4rem;
  }
  section label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    margin: 0.3rem 0;
  }
  section label.check {
    justify-content: flex-start;
    gap: 0.5rem;
  }
  .row {
    display: flex;
    gap: 0.4rem;
  }
  .row button.active {
    background: #4a90d9;
    color: white;
  }
  .download {
    padding: 0.5rem;
  }
  .notice {
    color: #b8860b;
  }
  footer {
    margin-top: auto;
    color: #888;
    font-size: 0.8rem;
  }
  footer .stats {
    display: flex;
    flex-direction: column;
    line-height: 1.35;
  }
  footer .stages {
    color: #aaa;
    font-size: 0.75rem;
  }
</style>
