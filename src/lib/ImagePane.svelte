<!-- src/lib/ImagePane.svelte -->
<script lang="ts">
  import type { RasterImage } from '../types'
  import type { Viewport } from './viewport.svelte'
  import { pinchStep, type Point } from './viewportMath'

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
  // Active touches/pointers by id: one pans, two pinch-zoom.
  const pointers = new Map<number, Point>()

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
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent) {
    const prev = pointers.get(e.pointerId)
    if (!prev) return
    const cur = { x: e.clientX, y: e.clientY }
    if (pointers.size === 1) {
      viewport.panBy(cur.x - prev.x, cur.y - prev.y)
    } else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1]
      const s = pinchStep(prev, other, cur, other)
      const r = el.getBoundingClientRect()
      viewport.zoomAt(s.cx - r.left, s.cy - r.top, s.factor)
      viewport.panBy(s.dx, s.dy)
    }
    pointers.set(e.pointerId, cur)
  }
  function up(e: PointerEvent) {
    pointers.delete(e.pointerId)
  }
</script>

<div
  class="pane"
  bind:this={el}
  onwheel={wheel}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
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
