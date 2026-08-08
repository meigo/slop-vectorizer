<!-- src/App.svelte -->
<script lang="ts">
  import Dropzone from './lib/Dropzone.svelte'
  import CompareView from './lib/CompareView.svelte'
  import ControlsPanel from './lib/ControlsPanel.svelte'
  import ImagePane from './lib/ImagePane.svelte'
  import { Viewport } from './lib/viewport.svelte'
  import { VectorizerClient } from './lib/workerClient'
  import { fileToRasterImage } from './lib/decode'
  import { DEFAULT_OPTIONS, type ClientResult, type RasterImage, type StageName } from './types'

  const client = new VectorizerClient()
  const viewport = new Viewport()
  let mode = $state<'side' | 'split'>('side')
  let viewsW = $state(0),
    viewsH = $state(0)
  let fittedW = 0,
    fittedH = 0
  let sourceFile = $state<Blob | null>(null)
  let upscale = $state<1 | 2 | 3>(1)
  let image = $state<RasterImage | null>(null)
  let result = $state<ClientResult | null>(null)
  let stage = $state<StageName | null>(null)
  let error = $state<string | null>(null)
  let notice = $state<string | null>(null)
  let options = $state({ ...DEFAULT_OPTIONS })
  let debounce: ReturnType<typeof setTimeout> | undefined

  const stats = $derived(result?.stats ?? null)
  // Compare view shows the preprocessed bitmap (levels/blur/saturation applied) when
  // the pipeline produced one, so pre-effect sliders are visible on the LEFT side.
  const displayImage = $derived(result?.preImage ?? image)

  // The pipeline emits an SVG with only a viewBox (no width/height), so a bare
  // {@html} render would size it via CSS (100%/auto) instead of viewBox scale.
  // CompareView requires the SVG to render at exact image-pixel scale so its
  // coordinates line up with the bitmap layer under the same transform — inject
  // explicit width/height matching the raster image before handing it over.
  const sizedSvg = $derived(
    result && image
      ? result.svg.replace('<svg ', `<svg width="${image.width}" height="${image.height}" `)
      : '',
  )

  // Two panes lay out side by side both in 'side' mode and when 'split' mode
  // has no result yet (CompareView needs a single combined pane instead).
  const twoColumn = $derived(mode === 'side' || !(result && displayImage))
  function paneW(): number {
    return twoColumn ? (viewsW - 2) / 2 : viewsW
  }
  function fit() {
    const img = displayImage
    if (img) viewport.fitTo(paneW(), viewsH, img.width, img.height)
  }
  $effect(() => {
    // fit on image-dimension change only, so pan/zoom survive slider drags
    const img = displayImage
    if (!img || viewsW === 0) return
    if (img.width === fittedW && img.height === fittedH) return
    fittedW = img.width
    fittedH = img.height
    fit()
  })
  // Auto-refit on pane-geometry changes (window resize, mode/column flips) until
  // the user manually zooms/pans; Fit and new-image fits re-arm via fitTo().
  $effect(() => {
    void viewsW
    void viewsH
    void twoColumn
    if (!viewport.touched && displayImage && viewsW > 0) fit()
  })

  async function decodeAndRun(file: Blob) {
    error = null
    notice = null
    result = null
    stage = null
    try {
      const { image: img, downscaled } = await fileToRasterImage(file, upscale)
      if (downscaled) notice = 'Large image was downscaled to 4096px'
      image = img
      result = await client.vectorize(img, $state.snapshot(options), (s) => (stage = s))
      stage = null
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'cancelled') return // superseded by a newer call; let that call own the UI state
      error =
        msg === 'undecodable' ? 'Could not decode that file — try a PNG, JPEG, GIF, or WebP.' : msg
      stage = null
    }
  }

  function handleFile(file: File) {
    sourceFile = file
    void decodeAndRun(file)
  }

  function handleUpscale() {
    if (sourceFile) void decodeAndRun(sourceFile)
  }

  // Debounced staged re-run triggered by Controls on any option change. Does NOT
  // call client.cancel() — that would terminate the worker and destroy its stage
  // cache (see workerCache: colorCount -> from palette, despeckleSize -> from
  // segment, smoothness -> from fit), defeating the point of caching for slider
  // drags. Instead it relies on jobId staleness: the worker processes messages
  // serially, so the newest request always runs last and its result wins; older
  // in-flight promises get rejected with 'cancelled' by vectorize() itself.
  function rerun() {
    clearTimeout(debounce)
    debounce = setTimeout(async () => {
      if (!image) return
      try {
        result = await client.vectorize(
          $state.snapshot(image),
          $state.snapshot(options),
          (s) => (stage = s),
        )
        stage = null
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg === 'cancelled') return // superseded by a newer call; let that call own the UI state
        error = msg
        stage = null
      }
    }, 150)
  }
</script>

{#if !image}
  <main class="empty">
    <Dropzone onfile={handleFile} {error} />
  </main>
{:else}
  <div class="app-grid">
    <div class="views" class:side={twoColumn} bind:clientWidth={viewsW} bind:clientHeight={viewsH}>
      {#if result && displayImage && mode === 'split'}
        <CompareView image={displayImage} svg={sizedSvg} {viewport} />
      {:else}
        <ImagePane image={displayImage} label="Original" {viewport} />
        <ImagePane svg={result ? sizedSvg : null} label="SVG" {viewport} />
      {/if}
      {#if stage}<span class="stage-pill">Vectorizing… ({stage})</span>{/if}
    </div>
    <aside class="panel">
      <ControlsPanel
        bind:options
        bind:upscale
        bind:mode
        {stats}
        svg={result?.svg ?? null}
        {notice}
        onchange={rerun}
        onupscale={handleUpscale}
        onfit={fit}
        onnew={() => {
          client.cancel()
          sourceFile = null
          upscale = 1
          image = null
          result = null
          error = null
          stage = null
          fittedW = 0
          fittedH = 0
        }}
      />
    </aside>
  </div>
  {#if error}
    <div class="toast" role="alert">
      {error}
      <button onclick={() => (error = null)}>×</button>
    </div>
  {/if}
{/if}

<style>
  :global(html),
  :global(body),
  :global(#app) {
    height: 100%;
    margin: 0;
  }
  .app-grid {
    display: grid;
    grid-template-columns: 1fr 300px;
    grid-template-rows: minmax(0, 1fr);
    height: 100vh;
  }
  .views {
    display: grid;
    min-width: 0;
    position: relative;
  }
  .views.side {
    grid-template-columns: 1fr 1fr;
    gap: 2px;
  }
  .stage-pill {
    position: absolute;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    background: #333c;
    color: white;
    font-family: system-ui, sans-serif;
    font-size: 0.85rem;
    padding: 0.35rem 0.9rem;
    border-radius: 999px;
    pointer-events: none;
  }
  .panel {
    overflow-y: auto;
    border-left: 1px solid #ddd;
    padding: 0.75rem;
    font-family: system-ui, sans-serif;
  }
  .empty {
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, sans-serif;
  }
  .toast {
    position: fixed;
    bottom: 1rem;
    right: 316px;
    background: #c0392b;
    color: white;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    display: flex;
    gap: 1rem;
    align-items: center;
  }
  .toast button {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    font-size: 1rem;
  }
</style>
