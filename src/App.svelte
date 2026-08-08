<!-- src/App.svelte -->
<script lang="ts">
  import Dropzone from './lib/Dropzone.svelte'
  import CompareView from './lib/CompareView.svelte'
  import Controls from './lib/Controls.svelte'
  import { VectorizerClient } from './lib/workerClient'
  import { fileToRasterImage } from './lib/decode'
  import { DEFAULT_OPTIONS, type ClientResult, type RasterImage, type StageName } from './types'

  const client = new VectorizerClient()
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
    result && image ? result.svg.replace('<svg ', `<svg width="${image.width}" height="${image.height}" `) : ''
  )

  async function decodeAndRun(file: Blob) {
    error = null; notice = null; result = null; stage = null
    try {
      const { image: img, downscaled } = await fileToRasterImage(file, upscale)
      if (downscaled) notice = 'Large image was downscaled to 4096px'
      image = img
      result = await client.vectorize(img, $state.snapshot(options), s => (stage = s))
      stage = null
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'cancelled') return // superseded by a newer call; let that call own the UI state
      error = msg === 'undecodable' ? 'Could not decode that file — try a PNG, JPEG, GIF, or WebP.' : msg
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
        result = await client.vectorize($state.snapshot(image), $state.snapshot(options), s => (stage = s))
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

<main>
  <h1>slop-vectorizer</h1>
  {#if !image}
    <Dropzone onfile={handleFile} {error} />
  {:else}
    {#if stage}<p>Vectorizing… ({stage})</p>{/if}
    {#if notice}<p>{notice}</p>{/if}
    {#if error}
      <div class="toast" role="alert">
        {error}
        <button onclick={() => (error = null)}>×</button>
      </div>
    {/if}
    {#if result && displayImage}
      <CompareView image={displayImage} svg={sizedSvg} />
    {/if}
    <Controls bind:options bind:upscale {stats} svg={result?.svg ?? null} onchange={rerun} onupscale={handleUpscale} />
    <button onclick={() => { client.cancel(); sourceFile = null; upscale = 1; image = null; result = null; error = null; stage = null }}>New image</button>
  {/if}
</main>

<style>
  main { max-width: 960px; margin: 0 auto; padding: 1rem; font-family: system-ui, sans-serif; }
  .toast {
    position: fixed; bottom: 1rem; right: 1rem; background: #c0392b; color: white;
    padding: 0.75rem 1rem; border-radius: 6px; display: flex; gap: 1rem; align-items: center;
  }
  .toast button { background: none; border: none; color: white; cursor: pointer; font-size: 1rem; }
</style>
