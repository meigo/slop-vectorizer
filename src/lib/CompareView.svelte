<!-- src/lib/CompareView.svelte -->
<script lang="ts">
  import type { LocalCircle, RasterImage } from '../types'
  import type { Viewport } from './viewport.svelte'
  import LocalGizmo from './LocalGizmo.svelte'
  import { toScreen } from './localGizmo'
  import { drawImage, PaneGestures } from './paneGestures.svelte'

  let {
    image,
    svg,
    viewport,
    circles = [],
    selected = -1,
    size = null,
    onselect,
    oncircle,
  }: {
    image: RasterImage
    svg: string
    viewport: Viewport
    circles?: LocalCircle[]
    selected?: number
    size?: { width: number; height: number } | null
    onselect?: (i: number) => void
    oncircle?: (i: number, c: LocalCircle) => void
  } = $props()

  let divider = $state(50) // percent
  let container: HTMLDivElement
  let canvas = $state<HTMLCanvasElement | null>(null)
  let dividerPointer: number | null = null // the one pointer dragging the divider
  const g = new PaneGestures(() => ({
    el: container,
    viewport,
    circles,
    selected,
    size,
    onselect,
    oncircle,
  }))

  $effect(() => {
    if (canvas) drawImage(canvas, image)
  })

  function move(e: PointerEvent) {
    if (dividerPointer !== null) {
      if (e.pointerId !== dividerPointer) return // a second finger doesn't move it
      const rect = container.getBoundingClientRect()
      divider = Math.min(98, Math.max(2, ((e.clientX - rect.left) / rect.width) * 100))
      return
    }
    g.move(e)
  }
  function up(e: PointerEvent) {
    g.up(e)
    if (e.pointerId === dividerPointer) dividerPointer = null
  }
</script>

<div
  class="compare"
  bind:this={container}
  style:cursor={g.hoverCursor}
  onwheel={g.wheel}
  onpointerdown={g.down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onlostpointercapture={up}
  onpointerleave={g.leave}
  role="img"
  aria-label="Compare original and vectorized"
>
  <!-- clip-path lives on an UNtransformed wrapper so it stays in screen space
       (aligned with the divider line); the transform is on the inner layer. -->
  <div class="clip" style:clip-path={`inset(0 ${100 - divider}% 0 0)`}>
    <div
      class="layer"
      style:transform={`translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`}
      style:--zoom={viewport.zoom}
    >
      <canvas bind:this={canvas} style:image-rendering="pixelated"></canvas>
    </div>
  </div>
  <div class="clip" style:clip-path={`inset(0 0 0 ${divider}%)`}>
    <div
      class="layer"
      style:transform={`translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`}
      style:--zoom={viewport.zoom}
    >
      {@html svg}
    </div>
  </div>
  {#if size}
    <!-- Clipped to the IMAGE half, exactly like the layer above it: the rings would otherwise
         sit over the SVG half, which exists to be judged clean. Dragging still works there —
         the hit test reads the pointer, not the paint. -->
    <div class="clip gizmos" style:clip-path={`inset(0 ${100 - divider}% 0 0)`}>
      <!-- Paint order must stay the data (list) order: hitTestList scans top-down over this
           same `circles` order to decide which overlay is "on top" for a dot/interior click,
           so reordering the paint here without teaching hitTestList the new order makes the
           visual stack and the hit test disagree (see the fix-7 revert in the fix wave). -->
      {#each circles as c, i (i)}
        <LocalGizmo
          c={toScreen(c, size.width, size.height, viewport)}
          state={c.hidden ? 'hidden' : i === selected ? 'selected' : 'unselected'}
        />
      {/each}
    </div>
  {/if}
  <div
    class="divider"
    style:left={`${divider}%`}
    onpointerdown={(e) => {
      e.stopPropagation()
      dividerPointer = e.pointerId
      ;(e.target as Element).setPointerCapture(e.pointerId)
    }}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
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
    background: var(--color-ground);
    touch-action: none;
    cursor: grab;
  }
  .clip {
    position: absolute;
    inset: 0;
  }
  .gizmos {
    pointer-events: none;
  }
  .layer {
    position: absolute;
    inset: 0;
    transform-origin: 0 0;
  }
  /* The transparency checker sits on the artwork itself, not the pane, so only the image area is
     light (black line art stays visible on the dark ground). Sized 16px / zoom in image space,
     so its squares stay 16 screen pixels at any zoom. */
  .layer :global(svg),
  .layer canvas {
    display: block;
    width: auto;
    height: auto;
    --check: calc(16px / var(--zoom, 1));
    background: repeating-conic-gradient(var(--color-check-b) 0% 25%, var(--color-check-a) 0% 50%) 0
      0 / var(--check) var(--check);
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
    background: var(--color-accent);
  }
</style>
