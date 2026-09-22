<!-- src/App.svelte -->
<script lang="ts">
  import Dropzone from './lib/Dropzone.svelte'
  import CompareView from './lib/CompareView.svelte'
  import ControlsPanel from './lib/ControlsPanel.svelte'
  import ImagePane from './lib/ImagePane.svelte'
  import ShareReadyDialog from './lib/ShareReadyDialog.svelte'
  import { Viewport } from './lib/viewport.svelte'
  import { VectorizerClient } from './lib/workerClient'
  import { fileToRasterImage, maxGapClosing } from './lib/decode'
  import { DEFAULT_OPTIONS, type ClientResult, type RasterImage, type StageName } from './types'
  import { remapOverrides } from './lib/paletteRemap'
  import { saveToFilesAvailable } from './lib/share'
  import { deliverFile, errorMessage, svgFileName, writeSvgFile } from './lib/saveFile'

  const client = new VectorizerClient()
  const viewport = new Viewport()
  let mode = $state<'side' | 'split'>('side')
  // View-only: show the decoded input without pre-effects. Never affects the output.
  let showUnmodified = $state(false)
  let viewsW = $state(0),
    viewsH = $state(0)
  let fittedW = 0,
    fittedH = 0
  let sourceFile = $state<File | null>(null)
  let scale = $state(1)
  let image = $state<RasterImage | null>(null)
  let result = $state<ClientResult | null>(null)
  let stage = $state<StageName | null>(null)
  let error = $state<string | null>(null)
  let notice = $state<string | null>(null)
  let options = $state({ ...DEFAULT_OPTIONS })
  let debounce: ReturnType<typeof setTimeout> | undefined
  let lastPalette: number[] | null = null
  let lastScale = 1
  let preserveNextFraming = false
  // Original ×1 decode of the current file: the scale-invariant palette source.
  // Palette estimation always reads this, so swatch colors stay constant across
  // scale changes (re-estimating on resampled pixels drifts mid-gray clusters
  // and can flip auto-k). Plain let — it's a large buffer, no reactivity needed.
  let baseImage: RasterImage | null = null

  // Saving. iPad/iPhone go through the share sheet (Save to Files); elsewhere Chromium keeps the
  // picked file's handle so the next Save overwrites it. The handle belongs to the current source
  // image: loading another one forgets it, so Save never overwrites one image's SVG with another's.
  const saveToFiles = saveToFilesAvailable()
  const canSaveAs = !saveToFiles && typeof window.showSaveFilePicker === 'function'
  let fileHandle: FileSystemFileHandle | null = null
  let savedName = $state<string | null>(null)
  let saveStatus = $state<string | null>(null)
  let shareReady = $state<{ file: File; error: string } | null>(null)

  function forgetSave() {
    fileHandle = null
    savedName = null
    saveStatus = null
  }

  async function save(asNew: boolean) {
    const svg = result?.svg
    if (!svg) return
    const source = sourceFile
    const name = svgFileName(source?.name)
    saveStatus = null
    try {
      if (saveToFiles) {
        const file = new File([svg], name, { type: 'image/svg+xml' })
        // Serializing is already done, so the sheet can still ride the tap that started the save.
        const r = await deliverFile(file)
        if (r.kind === 'shared') saveStatus = `Sent ${name} to the share sheet`
        else if (r.kind === 'downloaded') saveStatus = `Downloaded ${name}`
        else if (r.kind === 'dismissed') saveStatus = 'Not saved — the share sheet was closed'
        else shareReady = { file, error: r.error }
        return
      }
      const r = await writeSvgFile(svg, name, fileHandle, asNew)
      if (!r || sourceFile !== source) return // cancelled, or a new image arrived meanwhile
      fileHandle = r.handle
      savedName = r.handle ? r.name : null
      saveStatus = r.handle ? `Saved ${r.name}` : `Downloaded ${r.name}`
    } catch (e) {
      error = `Save failed: ${errorMessage(e)}`
    }
  }

  const stats = $derived(result?.stats ?? null)
  // Compare view shows the preprocessed bitmap (levels/blur/saturation applied) when
  // the pipeline produced one, so pre-effect sliders are visible on the LEFT side —
  // unless the Unmodified toggle asks for the plain decode. Both share dimensions, so
  // toggling never refits the view.
  const adjusted = $derived(!!result?.preImage && !showUnmodified)
  const displayImage = $derived(adjusted ? result!.preImage! : image)

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
    // fit on image-dimension change only, so pan/zoom survive slider drags —
    // except a scale re-decode with a deliberately framed view, which keeps
    // its exact framing (zoom/factor, pan unchanged) instead of refitting
    const img = displayImage
    if (!img || viewsW === 0) return
    if (img.width === fittedW && img.height === fittedH) return
    const prevW = fittedW
    fittedW = img.width
    fittedH = img.height
    if (preserveNextFraming && prevW > 0) {
      // Exact by construction: the ratio comes from the ACTUAL dimensions (the
      // nominal scale factor lies when the 4096px clamp or rounding kicks in).
      viewport.zoom = viewport.zoom * (prevW / img.width)
      preserveNextFraming = false
    } else {
      preserveNextFraming = false
      fit()
    }
  })
  // Auto-refit on pane-geometry changes (window resize, mode/column flips) until
  // the user manually zooms/pans; Fit and new-image fits re-arm via fitTo().
  $effect(() => {
    void viewsW
    void viewsH
    void twoColumn
    if (!viewport.touched && displayImage && viewsW > 0) fit()
  })

  // Overrides are index-aligned with the palette they were made for. Re-estimation
  // can wobble colors, reorder entries, or flip auto-k entirely (scale-sensitive:
  // texture noise at 1x can split a cluster that upscaling re-merges), so when a
  // new palette arrives, overrides MIGRATE by nearest-color match instead of
  // resetting — an override drops only when its color has no near match. Rerun so
  // any remapped render is bounded to one debounce cycle.
  $effect(() => {
    const pal = result?.palette
    if (!pal) return
    // Same k ⇒ keep overrides at their index: the palette is re-estimated from the
    // same source, and pre-effects (levels/blur/saturation) are monotonic — they
    // move colors, sometimes far, but never reorder the luminance-sorted palette.
    // "Override the darkest color" stays meaningful at any levels setting. Only a
    // k change (color-count switch, auto-k flip) needs nearest-color remapping.
    if (lastPalette && lastPalette.length !== pal.length && options.colorOverrides) {
      options.colorOverrides = remapOverrides(lastPalette, pal, options.colorOverrides)
      rerun()
    }
    lastPalette = pal
  })

  async function decodeAndRun(file: Blob) {
    error = null
    notice = null
    result = null
    stage = null
    try {
      const { image: img, clamped } = await fileToRasterImage(file, scale)
      if (clamped) notice = 'Large image was downscaled to 4096px'
      image = img
      if (scale === 1) baseImage = img // ×1 decode = the palette source
      result = await client.vectorize(
        img,
        $state.snapshot(options),
        (s) => (stage = s),
        baseImage ?? undefined,
      )
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
    forgetSave()
    void decodeAndRun(file)
  }

  function handleScale() {
    const factor = scale / lastScale
    lastScale = scale
    // Gap closing is in working-image pixels; rescale it with the image so the
    // PHYSICAL bridge width is preserved (and round-trips: ×1 g=2 → ×2 g=4 → ×1
    // g=2). Clamped anyway: downscaling rounds up as often as down (×1 g=3 → ×½
    // g=2, whose cap is 2), and the cap floor of 1 can't hold a scaled-up value.
    options.gapClosing = Math.min(maxGapClosing(scale), Math.round(options.gapClosing * factor))
    // Preserve the user's deliberate framing across the re-decode; the fit effect
    // computes the exact zoom ratio from the actual before/after dimensions.
    if (viewport.touched && image) preserveNextFraming = true
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
    <div class="intro">
      <h1>slop-vectorizer</h1>
      <p>
        Turn logos, sketches, and flat art into clean SVG — with sub-pixel edge recovery, entirely
        in your browser. Nothing is uploaded.
      </p>
      <Dropzone onfile={handleFile} {error} />
    </div>
  </main>
{:else}
  <div class="app-grid">
    <div class="views" class:side={twoColumn} bind:clientWidth={viewsW} bind:clientHeight={viewsH}>
      {#if result && displayImage && mode === 'split'}
        <CompareView image={displayImage} svg={sizedSvg} {viewport} />
      {:else}
        <ImagePane image={displayImage} label={adjusted ? 'Adjusted' : 'Original'} {viewport} />
        <ImagePane svg={result ? sizedSvg : null} label="SVG" {viewport} />
      {/if}
      {#if stage}<span class="stage-pill">Vectorizing… ({stage})</span>{/if}
    </div>
    <aside class="panel">
      <ControlsPanel
        bind:options
        bind:scale
        bind:mode
        bind:showUnmodified
        hasAdjustments={!!result?.preImage}
        {stats}
        svg={result?.svg ?? null}
        palette={result?.palette ?? null}
        {notice}
        {savedName}
        {canSaveAs}
        {saveStatus}
        onsave={save}
        onchange={rerun}
        onscale={handleScale}
        onfit={fit}
        onnew={() => {
          client.cancel()
          sourceFile = null
          forgetSave()
          scale = 1
          lastScale = 1
          preserveNextFraming = false
          baseImage = null
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
      <button onclick={() => (error = null)} aria-label="Dismiss">×</button>
    </div>
  {/if}
{/if}
{#if shareReady}
  <ShareReadyDialog
    file={shareReady.file}
    error={shareReady.error}
    onclose={(status) => {
      shareReady = null
      saveStatus = status
    }}
  />
{/if}

<style>
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
    background: var(--color-ground);
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
    background: var(--color-panel);
    border: 1px solid var(--color-line);
    color: var(--color-muted);
    font-size: 12px;
    padding: 4px 12px;
    border-radius: 999px;
    pointer-events: none;
  }
  .panel {
    overflow-y: auto;
    border-left: 1px solid var(--color-line);
    background: var(--color-panel);
  }
  .empty {
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .intro {
    max-width: 440px;
    text-align: center;
  }
  .intro h1 {
    font-size: 20px;
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 0.5rem;
  }
  .intro p {
    font-size: 14px;
    color: var(--color-muted);
    line-height: 1.55;
    margin: 0 0 1.5rem;
  }
  .toast {
    position: fixed;
    bottom: 1rem;
    right: 316px;
    max-width: 360px;
    background: var(--color-panel);
    border: 1px solid var(--color-danger);
    color: var(--color-text);
    font-size: 12px;
    padding: 8px 12px;
    border-radius: 6px;
    box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.4);
    display: flex;
    gap: 1rem;
    align-items: center;
  }
  .toast button {
    height: auto;
    padding: 0;
    background: none;
    border: none;
    color: var(--color-muted);
    font-size: 16px;
  }
</style>
