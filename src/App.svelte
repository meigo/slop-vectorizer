<!-- src/App.svelte -->
<script lang="ts">
  import Dropzone from './lib/Dropzone.svelte'
  import CompareView from './lib/CompareView.svelte'
  import { VectorizerClient } from './lib/workerClient'
  import { fileToRasterImage } from './lib/decode'
  import { DEFAULT_OPTIONS, type VectorResult, type RasterImage, type StageName } from './types'

  const client = new VectorizerClient()
  let image = $state<RasterImage | null>(null)
  let result = $state<VectorResult | null>(null)
  let stage = $state<StageName | null>(null)
  let error = $state<string | null>(null)
  let notice = $state<string | null>(null)

  // The pipeline emits an SVG with only a viewBox (no width/height), so a bare
  // {@html} render would size it via CSS (100%/auto) instead of viewBox scale.
  // CompareView requires the SVG to render at exact image-pixel scale so its
  // coordinates line up with the bitmap layer under the same transform — inject
  // explicit width/height matching the raster image before handing it over.
  const sizedSvg = $derived(
    result && image ? result.svg.replace('<svg ', `<svg width="${image.width}" height="${image.height}" `) : ''
  )

  async function handleFile(file: File) {
    error = null; notice = null; result = null
    try {
      const { image: img, downscaled } = await fileToRasterImage(file)
      if (downscaled) notice = 'Large image was downscaled to 4096px'
      image = img
      result = await client.vectorize(img, DEFAULT_OPTIONS, s => (stage = s))
      stage = null
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'cancelled') return // superseded by a newer call; let that call own the UI state
      error = msg === 'undecodable' ? 'Could not decode that file — try a PNG, JPEG, GIF, or WebP.' : msg
      stage = null
    }
  }
</script>

<main>
  <h1>slop-vectorizer</h1>
  {#if !image}
    <Dropzone onfile={handleFile} {error} />
  {:else}
    {#if stage}<p>Vectorizing… ({stage})</p>{/if}
    {#if notice}<p>{notice}</p>{/if}
    {#if error}<p class="error">{error}</p>{/if}
    {#if result && image}
      <CompareView {image} svg={sizedSvg} />
      <pre>{JSON.stringify(result.stats, null, 2)}</pre>
    {/if}
    <button onclick={() => { client.cancel(); image = null; result = null; error = null }}>New image</button>
  {/if}
</main>

<style>
  main { max-width: 960px; margin: 0 auto; padding: 1rem; font-family: system-ui, sans-serif; }
  .error { color: #c0392b; }
</style>
