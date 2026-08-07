<!-- src/App.svelte -->
<script lang="ts">
  import Dropzone from './lib/Dropzone.svelte'
  import { VectorizerClient } from './lib/workerClient'
  import { fileToRasterImage } from './lib/decode'
  import { DEFAULT_OPTIONS, type VectorResult, type RasterImage, type StageName } from './types'

  const client = new VectorizerClient()
  let image = $state<RasterImage | null>(null)
  let result = $state<VectorResult | null>(null)
  let stage = $state<StageName | null>(null)
  let error = $state<string | null>(null)
  let notice = $state<string | null>(null)

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
    {#if result}
      <div class="raw-svg">{@html result.svg}</div>
      <pre>{JSON.stringify(result.stats, null, 2)}</pre>
    {/if}
    <button onclick={() => { image = null; result = null; error = null }}>New image</button>
  {/if}
</main>

<style>
  main { max-width: 960px; margin: 0 auto; padding: 1rem; font-family: system-ui, sans-serif; }
  .raw-svg :global(svg) { max-width: 100%; height: auto; border: 1px solid #ddd; }
  .error { color: #c0392b; }
</style>
