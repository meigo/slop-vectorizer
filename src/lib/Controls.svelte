<!-- src/lib/Controls.svelte -->
<script lang="ts">
  import type { PipelineOptions, PipelineStats } from '../types'

  let { options = $bindable(), upscale = $bindable(), stats, svg, onchange, onupscale }: {
    options: PipelineOptions
    upscale: 1 | 2 | 3
    stats: PipelineStats | null
    svg: string | null
    onchange: () => void
    onupscale: () => void
  } = $props()

  function download() {
    if (!svg) return
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'vectorized.svg'; a.click()
    URL.revokeObjectURL(url)
  }
  const totalMs = (s: PipelineStats) =>
    Object.values(s.timings).reduce((a, b) => a + (b ?? 0), 0).toFixed(0)
  // Stages skipped by the worker cache are absent from timings, so they stay out of the line.
  const stageMs = (s: PipelineStats) =>
    Object.entries(s.timings).map(([name, ms]) => `${name} ${(ms ?? 0).toFixed(0)}`).join(' · ')
  const sizeKb = (s: string) => (new TextEncoder().encode(s).length / 1024).toFixed(1) + ' kB'
</script>

<div class="controls">
  <label>
    Colors
    <select
      value={options.colorCount === 'auto' ? 'auto' : String(options.colorCount)}
      onchange={(e) => {
        const v = (e.target as HTMLSelectElement).value
        options.colorCount = v === 'auto' ? 'auto' : Number(v)
        onchange()
      }}>
      <option value="auto">auto</option>
      {#each Array.from({ length: 15 }, (_, i) => i + 2) as k}
        <option value={String(k)}>{k}</option>
      {/each}
    </select>
  </label>
  <label>
    Smoothness
    <input type="range" min="0" max="1" step="0.05" bind:value={options.smoothness} oninput={onchange} />
  </label>
  <label>
    Despeckle
    <input type="range" min="1" max="64" step="1" bind:value={options.despeckleSize} oninput={onchange} />
  </label>
  <label>Gap closing <input type="range" min="0" max="3" step="1" bind:value={options.gapClosing} oninput={onchange} /></label>
  <label><input type="checkbox" bind:checked={options.optimize} onchange={onchange} /> Optimize</label>
  <label><input type="checkbox" bind:checked={options.mergePaths} onchange={onchange} /> Merge colors</label>
  <label><input type="checkbox" bind:checked={options.transparentBg} onchange={onchange} /> Transparent bg</label>
  <button onclick={download} disabled={!svg}>Download SVG</button>
  {#if stats}
    <span class="stats">
      <span>{stats.pathCount} paths · {stats.pointCount} points · {totalMs(stats)} ms{#if svg} · {sizeKb(svg)}{/if}</span>
      {#if stageMs(stats)}<span class="stages">{stageMs(stats)}</span>{/if}
    </span>
  {/if}
</div>

<div class="controls input-row">
  <label>
    Upscale
    <select bind:value={upscale} onchange={onupscale}>
      <option value={1}>×1</option><option value={2}>×2</option><option value={3}>×3</option>
    </select>
  </label>
  <label>Black point <input type="range" min="0" max="254" step="1" bind:value={options.blackPoint} oninput={onchange} /></label>
  <label>White point <input type="range" min="1" max="255" step="1" bind:value={options.whitePoint} oninput={onchange} /></label>
  <label>Blur <input type="range" min="0" max="10" step="1" bind:value={options.blurRadius} oninput={onchange} /></label>
  <label>Saturation <input type="range" min="0" max="2" step="0.05" bind:value={options.saturation} oninput={onchange} /></label>
  <button onclick={() => { options.blackPoint = 0; options.whitePoint = 255; options.blurRadius = 0; options.saturation = 1; onchange() }}>Reset</button>
</div>

<style>
  .controls { display: flex; gap: 1.5rem; align-items: center; flex-wrap: wrap; padding: 0.75rem 0; }
  label { display: flex; gap: 0.5rem; align-items: center; font-size: 0.9rem; color: #444; }
  .stats { color: #888; font-size: 0.85rem; margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; line-height: 1.35; }
  .stages { color: #aaa; font-size: 0.75rem; }
</style>
