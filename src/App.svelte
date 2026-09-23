<!-- src/App.svelte -->
<script lang="ts">
  import Dropzone from './lib/Dropzone.svelte'
  import CompareView from './lib/CompareView.svelte'
  import ControlsPanel from './lib/ControlsPanel.svelte'
  import ImagePane from './lib/ImagePane.svelte'
  import ShareReadyDialog from './lib/ShareReadyDialog.svelte'
  import { Viewport } from './lib/viewport.svelte'
  import { VectorizerClient } from './lib/workerClient'
  import { fileToRasterImage, maxGapClosing, type DecodeResult } from './lib/decode'
  import { initialLocal } from './lib/localGizmo'
  import {
    DEFAULT_OPTIONS,
    type ClientResult,
    type LocalCircle,
    type RasterImage,
    type StageName,
  } from './types'
  import { remapOverrides } from './lib/paletteRemap'
  import { saveToFilesAvailable } from './lib/share'
  import { commandFor, isTypingTarget } from './lib/shortcuts'
  import {
    deliverFile,
    errorMessage,
    svgFileName,
    writeProjectFile,
    writeSvgFile,
  } from './lib/saveFile'
  import { packProject, projectFileName, unpackProject } from './lib/project'
  import {
    getAutosave,
    makeThumb,
    putAutosave,
    SaveGeneration,
    type AutosaveSummary,
  } from './lib/autosave'
  import ContinueCard from './lib/ContinueCard.svelte'

  const client = new VectorizerClient()
  const viewport = new Viewport()
  let mode = $state<'side' | 'split'>('side')
  // View-only: show the decoded input without pre-effects. Never affects the output.
  let showUnmodified = $state(false)
  // The circles live in the options (they are pipeline input); only the selection is view state.
  let selected = $state(-1)

  function setCircles(next: LocalCircle[]) {
    options.localCircles = next
    rerun()
  }
  function addCircle() {
    const img = displayImage
    if (!img) return
    const c = initialLocal(
      viewport,
      paneW(),
      viewsH,
      img.width,
      img.height,
      options.blackPoint,
      options.whitePoint,
    )
    setCircles([...$state.snapshot(options.localCircles), c])
    selected = options.localCircles.length - 1
  }
  function deleteCircle() {
    if (selected < 0) return
    const next = $state.snapshot(options.localCircles).filter((_, i) => i !== selected)
    setCircles(next)
    selected = Math.min(selected, next.length - 1)
  }
  function toggleHidden(i: number) {
    const next = $state.snapshot(options.localCircles)
    next[i] = { ...next[i], hidden: !next[i].hidden }
    setCircles(next)
  }
  function updateCircle(i: number, c: LocalCircle) {
    const next = $state.snapshot(options.localCircles)
    next[i] = c
    setCircles(next)
  }
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
  let options = $state({ ...DEFAULT_OPTIONS, localCircles: [] as LocalCircle[] })
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

  let projectHandle: FileSystemFileHandle | null = null
  let projectSavedName = $state<string | null>(null)

  function forgetProjectSave() {
    projectHandle = null
    projectSavedName = null
  }

  /** Everything needed to carry on working: the ORIGINAL file plus the settings. */
  function projectData() {
    if (!sourceFile) return null
    return {
      source: sourceFile,
      sourceName: sourceFile.name,
      scale,
      options: $state.snapshot(options),
    }
  }

  // File menu: Open project… reaches the same path as dropping a zip on the start screen.
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const mod = isMac ? '\u2318' : 'Ctrl+'
  let projectInput: HTMLInputElement

  function openProjectPicker() {
    projectInput.click()
  }
  function projectPicked() {
    const f = projectInput.files?.[0]
    if (f) void openProject(f)
    projectInput.value = ''
  }
  function shortcut(e: KeyboardEvent) {
    if (isTypingTarget(e.target)) return
    const cmd = commandFor(e)
    if (!cmd) return
    if (cmd === 'open') {
      e.preventDefault()
      openProjectPicker()
      return
    }
    if (!result?.svg) return // nothing to save yet; leave the key to the browser
    e.preventDefault()
    void save(cmd === 'saveAs')
  }

  async function saveProject(asNew: boolean) {
    const d = projectData()
    if (!d) return
    const name = projectFileName(d.sourceName)
    saveStatus = null
    try {
      const zip = await packProject(d)
      if (saveToFiles) {
        const file = new File([zip], name, { type: 'application/zip' })
        const r = await deliverFile(file)
        if (r.kind === 'shared') saveStatus = `Sent ${name} to the share sheet`
        else if (r.kind === 'downloaded') saveStatus = `Downloaded ${name}`
        else if (r.kind === 'dismissed') saveStatus = 'Not saved — the share sheet was closed'
        else shareReady = { file, error: r.error }
        return
      }
      const r = await writeProjectFile(zip, name, asNew ? null : projectHandle, asNew)
      if (!r || sourceFile !== d.source) return // cancelled, or a new image arrived meanwhile
      projectHandle = r.handle
      projectSavedName = r.handle ? r.name : null
      saveStatus = r.handle ? `Saved ${r.name}` : `Downloaded ${r.name}`
    } catch (e) {
      error = `Save failed: ${errorMessage(e)}`
    }
  }

  /** Open a .zip project: unpack, prime the palette source at ×1 if the saved scale isn't
   *  ×1, then decode once at the saved scale. */
  async function openProject(file: File): Promise<boolean> {
    const prevSource = sourceFile
    let d
    try {
      d = await unpackProject(file)
    } catch (e) {
      error = errorMessage(e)
      return false
    }
    // A newer openProject call already took over while this one was unpacking — don't let
    // this call's stale continuation undo it.
    if (sourceFile !== prevSource) return false
    const src = new File([d.source], d.sourceName || 'image', { type: d.source.type })
    sourceFile = src
    forgetSave()
    forgetProjectSave()
    options = d.options
    selected = d.options.localCircles.length > 0 ? 0 : -1
    lastPalette = null
    baseImage = null
    image = null
    result = null
    fittedW = 0
    fittedH = 0
    scale = d.scale
    lastScale = d.scale
    if (d.scale !== 1) {
      try {
        baseImage = (await fileToRasterImage(src, 1)).image
      } catch {
        /* decodeAndRun reports a bad source */
      }
    }
    await decodeAndRun(src)
    return true
  }

  // Autosave: one slot, written ~1s after the last change and only once a result has arrived, so
  // it never competes with the pipeline. New image never clears it — the next load replaces it.
  const autosaveGen = new SaveGeneration()
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined
  // Only the summary the Continue card renders — never the zip bytes, so a full copy of the
  // source image isn't pinned in memory for the tab's whole lifetime. resume() reads the
  // bytes back from the slot on demand.
  let resumable = $state<AutosaveSummary | null>(null)

  function scheduleAutosave() {
    clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => void writeAutosave(), 1000)
  }

  async function writeAutosave() {
    const d = projectData()
    const img = image
    if (!d || !img) return
    const gen = autosaveGen.bump()
    try {
      const [zip, thumb] = await Promise.all([packProject(d), makeThumb(img)])
      if (!autosaveGen.isCurrent(gen)) return // superseded by a newer write
      const rec = { zip, sourceName: d.sourceName, thumb, savedAt: Date.now() }
      const ok = await putAutosave(rec)
      // keep the card in sync with the slot — but only once something was actually stored
      if (ok && autosaveGen.isCurrent(gen))
        resumable = { sourceName: rec.sourceName, thumb: rec.thumb, savedAt: rec.savedAt }
    } catch {
      // Autosave is best-effort; a failure must never interrupt the session.
    }
  }

  async function resume() {
    if (!resumable) return
    const rec = await getAutosave()
    if (!rec) {
      error = 'Could not load the autosaved session.'
      return
    }
    const ok = await openProject(new File([rec.zip], 'autosave.zip', { type: 'application/zip' }))
    if (ok) resumable = null // only once the restore actually succeeded — the start screen unmounts then anyway
  }

  $effect(() => {
    void getAutosave().then(
      (rec) =>
        (resumable = rec && { sourceName: rec.sourceName, thumb: rec.thumb, savedAt: rec.savedAt }),
    )
  })

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

  const UNDECODABLE = 'Could not decode that file — try a PNG, JPEG, GIF, or WebP.'

  /** `decoded` skips the decode when the caller already has it at the current scale. */
  async function decodeAndRun(file: Blob, decoded?: DecodeResult) {
    error = null
    notice = null
    result = null
    stage = null
    try {
      const { image: img, clamped } = decoded ?? (await fileToRasterImage(file, scale))
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
      scheduleAutosave()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'cancelled') return // superseded by a newer call; let that call own the UI state
      error = msg === 'undecodable' ? UNDECODABLE : msg
      stage = null
    }
  }

  const isProjectFile = (f: File) =>
    f.name.toLowerCase().endsWith('.zip') || f.type === 'application/zip'

  async function handleFile(file: File) {
    if (isProjectFile(file)) {
      void openProject(file)
      return
    }
    // Decode before touching the session: over the editor, an undecodable file must leave the
    // current work exactly as it was. A new image always starts at ×1, so this decode is the one
    // decodeAndRun would make.
    const prevSource = sourceFile
    let decoded: DecodeResult
    try {
      decoded = await fileToRasterImage(file, 1)
    } catch {
      error = UNDECODABLE
      return
    }
    if (sourceFile !== prevSource) return // a newer file arrived while this one decoded
    // A new image starts fresh at ×1 with no circles (settings carry over, as before).
    clearTimeout(debounce) // a slider rerun queued for the old image
    sourceFile = file
    forgetSave()
    forgetProjectSave()
    scale = 1
    lastScale = 1
    preserveNextFraming = false
    baseImage = null
    fittedW = 0
    fittedH = 0
    selected = -1
    options.localCircles = []
    void decodeAndRun(file, decoded)
  }

  // New image picks a file first and only then replaces the session, so cancelling the picker
  // loses nothing. The start screen's Dropzone has its own input; this one serves the editor.
  let imageInput: HTMLInputElement
  function imagePicked() {
    const f = imageInput.files?.[0]
    if (f) handleFile(f)
    imageInput.value = ''
  }

  // Drop and paste work over the editor too (the Dropzone owns them on the start screen). The
  // window must accept every file drag, or a missed drop navigates the tab away from the work.
  let dropping = $state(false)
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
  function editorDragOver(e: DragEvent) {
    if (!image || !hasFiles(e)) return
    e.preventDefault()
    dropping = true
  }
  function editorDragLeave(e: DragEvent) {
    if (!e.relatedTarget) dropping = false // left the window, not just crossed a child
  }
  function editorDrop(e: DragEvent) {
    if (!image || !hasFiles(e)) return
    e.preventDefault()
    dropping = false
    const f = e.dataTransfer?.files?.[0]
    if (f) handleFile(f)
  }
  function editorPaste(e: ClipboardEvent) {
    if (!image || isTypingTarget(e.target)) return
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
    const f = item?.getAsFile()
    if (f) handleFile(f)
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
        scheduleAutosave()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg === 'cancelled') return // superseded by a newer call; let that call own the UI state
        error = msg
        stage = null
      }
    }, 150)
  }
</script>

<svelte:window
  onkeydown={shortcut}
  ondragover={editorDragOver}
  ondragleave={editorDragLeave}
  ondrop={editorDrop}
  onpaste={editorPaste}
/>
<input type="file" accept="image/*" hidden bind:this={imageInput} onchange={imagePicked} />
<input
  type="file"
  accept=".zip,application/zip"
  hidden
  bind:this={projectInput}
  onchange={projectPicked}
/>

{#if !image}
  <main class="empty">
    <div class="intro">
      <h1>slop-vectorizer</h1>
      <p>
        Turn logos, sketches, and flat art into clean SVG — with sub-pixel edge recovery, entirely
        in your browser. Nothing is uploaded.
      </p>
      {#if resumable}<ContinueCard rec={resumable} onopen={resume} />{/if}
      <Dropzone onfile={handleFile} {error} />
      <button class="open-project" onclick={openProjectPicker}>
        Open project… <span class="kbd">{mod}O</span>
      </button>
    </div>
  </main>
{:else}
  <div class="app-grid">
    <div class="views" class:side={twoColumn} bind:clientWidth={viewsW} bind:clientHeight={viewsH}>
      {#if result && displayImage && mode === 'split'}
        <CompareView
          image={displayImage}
          svg={sizedSvg}
          {viewport}
          circles={options.localCircles}
          {selected}
          size={displayImage}
          onselect={(i) => (selected = i)}
          oncircle={updateCircle}
        />
      {:else}
        <ImagePane
          image={displayImage}
          label={adjusted ? 'Adjusted' : 'Original'}
          {viewport}
          circles={options.localCircles}
          {selected}
          size={displayImage}
          onselect={(i) => (selected = i)}
          oncircle={updateCircle}
        />
        <!-- No circles on the OUTPUT pane: the rings are only useful where you can act on
             them, and the point of this pane is to judge the result unobstructed. Editing
             happens on the input pane (and, in split view, on its half). -->
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
        {projectSavedName}
        {mod}
        onopen={openProjectPicker}
        circles={options.localCircles}
        {selected}
        onadd={addCircle}
        ondelete={deleteCircle}
        onselect={(i) => (selected = i)}
        ontogglehidden={toggleHidden}
        oncircle={updateCircle}
        onsave={save}
        onsaveproject={saveProject}
        onchange={rerun}
        onscale={handleScale}
        onfit={fit}
        onnew={() => imageInput.click()}
      />
    </aside>
  </div>
  {#if dropping}<div class="drop-overlay"><span>Drop to open</span></div>{/if}
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
  .drop-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px dashed var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
    pointer-events: none; /* the drag's target stays the page beneath, so dragleave stays honest */
  }
  .drop-overlay span {
    background: var(--color-panel);
    border: 1px solid var(--color-line);
    color: var(--color-text);
    font-size: 14px;
    padding: 8px 16px;
    border-radius: 999px;
  }
  .open-project {
    margin-top: 1rem;
  }
  .open-project .kbd {
    color: var(--color-muted);
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
