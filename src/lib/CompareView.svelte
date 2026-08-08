<!-- src/lib/CompareView.svelte -->
<script lang="ts">
  import type { RasterImage } from '../types'
  import type { Viewport } from './viewport.svelte'

  let { image, svg, viewport }: { image: RasterImage; svg: string; viewport: Viewport } = $props()

  let divider = $state(50) // percent
  let container: HTMLDivElement
  let canvas = $state<HTMLCanvasElement | null>(null)
  let panning = false
  let draggingDivider = false
  let lastX = 0, lastY = 0

  $effect(() => {
    if (!canvas) return
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  })

  function wheel(e: WheelEvent) {
    e.preventDefault()
    const rect = container.getBoundingClientRect()
    viewport.wheelAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY)
  }
  function down(e: PointerEvent) {
    panning = true; lastX = e.clientX; lastY = e.clientY
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent) {
    if (draggingDivider) {
      const rect = container.getBoundingClientRect()
      divider = Math.min(98, Math.max(2, ((e.clientX - rect.left) / rect.width) * 100))
    } else if (panning) {
      viewport.panBy(e.clientX - lastX, e.clientY - lastY)
      lastX = e.clientX; lastY = e.clientY
    }
  }
  function up() { panning = false; draggingDivider = false }
</script>

<div
  class="compare" bind:this={container}
  onwheel={wheel} onpointerdown={down} onpointermove={move} onpointerup={up}
  role="img" aria-label="Compare original and vectorized"
>
  <!-- clip-path lives on an UNtransformed wrapper so it stays in screen space
       (aligned with the divider line); the transform is on the inner layer. -->
  <div class="clip" style:clip-path={`inset(0 ${100 - divider}% 0 0)`}>
    <div class="layer" style:transform={`translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`}>
      <canvas bind:this={canvas} style:image-rendering="pixelated"></canvas>
    </div>
  </div>
  <div class="clip" style:clip-path={`inset(0 0 0 ${divider}%)`}>
    <div class="layer" style:transform={`translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`}>
      {@html svg}
    </div>
  </div>
  <div class="divider" style:left={`${divider}%`}
       onpointerdown={(e) => { e.stopPropagation(); draggingDivider = true; (e.target as Element).setPointerCapture(e.pointerId) }}
       onpointermove={move} onpointerup={up}
       role="separator" aria-label="Comparison divider" tabindex="0"></div>
</div>

<style>
  .compare {
    position: relative; overflow: hidden; height: 100%;
    background: repeating-conic-gradient(#f0f0f0 0% 25%, #fff 0% 50%) 0 0 / 16px 16px;
    touch-action: none; cursor: grab;
  }
  .clip { position: absolute; inset: 0; }
  .layer { position: absolute; inset: 0; transform-origin: 0 0; }
  .layer :global(svg), .layer canvas { display: block; width: auto; height: auto; }
  .divider {
    position: absolute; top: 0; bottom: 0; width: 8px; margin-left: -4px;
    cursor: col-resize; background: transparent;
  }
  .divider::after {
    content: ''; position: absolute; inset: 0 3px; background: #4a90d9;
  }
</style>
