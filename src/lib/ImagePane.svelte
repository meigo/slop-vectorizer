<!-- src/lib/ImagePane.svelte -->
<script lang="ts">
  import type { RasterImage } from '../types'
  import type { Viewport } from './viewport.svelte'

  let {
    image = null,
    svg = null,
    label,
    viewport,
  }: {
    image?: RasterImage | null
    svg?: string | null
    label: string
    viewport: Viewport
  } = $props()

  let el: HTMLDivElement
  let canvas = $state<HTMLCanvasElement | null>(null)
  let panning = false,
    lastX = 0,
    lastY = 0

  $effect(() => {
    if (!canvas || !image) return
    canvas.width = image.width
    canvas.height = image.height
    canvas
      .getContext('2d')!
      .putImageData(
        new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
        0,
        0,
      )
  })

  function wheel(e: WheelEvent) {
    e.preventDefault()
    const r = el.getBoundingClientRect()
    viewport.wheelAt(e.clientX - r.left, e.clientY - r.top, e.deltaY)
  }
  function down(e: PointerEvent) {
    panning = true
    lastX = e.clientX
    lastY = e.clientY
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent) {
    if (!panning) return
    viewport.panBy(e.clientX - lastX, e.clientY - lastY)
    lastX = e.clientX
    lastY = e.clientY
  }
  function up() {
    panning = false
  }
</script>

<div
  class="pane"
  bind:this={el}
  onwheel={wheel}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  role="img"
  aria-label={label}
>
  <div
    class="layer"
    style:transform={`translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`}
  >
    {#if image}
      <canvas bind:this={canvas} style:image-rendering="pixelated"></canvas>
    {:else if svg}
      {@html svg}
    {/if}
  </div>
  <span class="pane-label">{label}</span>
</div>

<style>
  .pane {
    position: relative;
    overflow: hidden;
    background: repeating-conic-gradient(
        var(--color-border-light) 0% 25%,
        var(--color-surface) 0% 50%
      )
      0 0 / 16px 16px;
    touch-action: none;
    cursor: grab;
  }
  .layer {
    position: absolute;
    inset: 0;
    transform-origin: 0 0;
  }
  .layer :global(svg),
  .layer canvas {
    display: block;
    width: auto;
    height: auto;
  }
  .pane-label {
    position: absolute;
    top: 8px;
    left: 10px;
    font-size: 12px;
    color: var(--color-text-secondary);
    background: color-mix(in srgb, var(--color-surface) 80%, transparent);
    padding: 2px 8px;
    border-radius: 4px;
    pointer-events: none;
  }
</style>
