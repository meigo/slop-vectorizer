<!-- src/lib/CompareView.svelte -->
<script lang="ts">
  import type { RasterImage } from '../types'
  import type { Viewport } from './viewport.svelte'
  import { pinchStep, type Point } from './viewportMath'

  let { image, svg, viewport }: { image: RasterImage; svg: string; viewport: Viewport } = $props()

  let divider = $state(50) // percent
  let container: HTMLDivElement
  let canvas = $state<HTMLCanvasElement | null>(null)
  // Active touches/pointers by id: one pans, two pinch-zoom.
  const pointers = new Map<number, Point>()
  let draggingDivider = false

  $effect(() => {
    if (!canvas) return
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
      0,
      0,
    )
  })

  function wheel(e: WheelEvent) {
    e.preventDefault()
    const rect = container.getBoundingClientRect()
    viewport.wheelAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY)
  }
  function down(e: PointerEvent) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent) {
    if (draggingDivider) {
      const rect = container.getBoundingClientRect()
      divider = Math.min(98, Math.max(2, ((e.clientX - rect.left) / rect.width) * 100))
      return
    }
    const prev = pointers.get(e.pointerId)
    if (!prev) return
    const cur = { x: e.clientX, y: e.clientY }
    if (pointers.size === 1) {
      viewport.panBy(cur.x - prev.x, cur.y - prev.y)
    } else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1]
      const s = pinchStep(prev, other, cur, other)
      const r = container.getBoundingClientRect()
      viewport.zoomAt(s.cx - r.left, s.cy - r.top, s.factor)
      viewport.panBy(s.dx, s.dy)
    }
    pointers.set(e.pointerId, cur)
  }
  function up(e: PointerEvent) {
    pointers.delete(e.pointerId)
    draggingDivider = false
  }
</script>

<div
  class="compare"
  bind:this={container}
  onwheel={wheel}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  role="img"
  aria-label="Compare original and vectorized"
>
  <!-- clip-path lives on an UNtransformed wrapper so it stays in screen space
       (aligned with the divider line); the transform is on the inner layer. -->
  <div class="clip" style:clip-path={`inset(0 ${100 - divider}% 0 0)`}>
    <div
      class="layer"
      style:transform={`translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`}
    >
      <canvas bind:this={canvas} style:image-rendering="pixelated"></canvas>
    </div>
  </div>
  <div class="clip" style:clip-path={`inset(0 0 0 ${divider}%)`}>
    <div
      class="layer"
      style:transform={`translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`}
    >
      {@html svg}
    </div>
  </div>
  <div
    class="divider"
    style:left={`${divider}%`}
    onpointerdown={(e) => {
      e.stopPropagation()
      draggingDivider = true
      ;(e.target as Element).setPointerCapture(e.pointerId)
    }}
    onpointermove={move}
    onpointerup={up}
    onkeydown={(e) => {
      if (e.key === 'ArrowLeft') divider = Math.max(2, divider - 2)
      else if (e.key === 'ArrowRight') divider = Math.min(98, divider + 2)
      else return
      e.preventDefault()
    }}
    role="slider"
    aria-label="Comparison divider"
    aria-orientation="vertical"
    aria-valuenow={Math.round(divider)}
    aria-valuemin={2}
    aria-valuemax={98}
    tabindex="0"
  ></div>
</div>

<style>
  .compare {
    position: relative;
    overflow: hidden;
    height: 100%;
    background: repeating-conic-gradient(
        var(--color-border-light) 0% 25%,
        var(--color-surface) 0% 50%
      )
      0 0 / 16px 16px;
    touch-action: none;
    cursor: grab;
  }
  .clip {
    position: absolute;
    inset: 0;
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
  .divider {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 8px;
    margin-left: -4px;
    cursor: col-resize;
    background: transparent;
  }
  .divider::after {
    content: '';
    position: absolute;
    inset: 0 3px;
    background: var(--color-selection);
  }
</style>
