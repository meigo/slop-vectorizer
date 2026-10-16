<!-- src/lib/ImagePane.svelte -->
<script lang="ts">
  import type { LocalCircle, RasterImage } from '../types'
  import type { Viewport } from './viewport.svelte'
  import LocalGizmo from './LocalGizmo.svelte'
  import { toScreen } from './localGizmo'
  import { drawImage, PaneGestures } from './paneGestures.svelte'

  let {
    image = null,
    svg = null,
    label,
    viewport,
    circles = [],
    selected = -1,
    size = null,
    onselect,
    oncircle,
  }: {
    image?: RasterImage | null
    svg?: string | null
    label: string
    viewport: Viewport
    circles?: LocalCircle[]
    selected?: number
    size?: { width: number; height: number } | null
    onselect?: (i: number) => void
    oncircle?: (i: number, c: LocalCircle) => void
  } = $props()

  let el: HTMLDivElement
  let canvas = $state<HTMLCanvasElement | null>(null)
  const g = new PaneGestures(() => ({ el, viewport, circles, selected, size, onselect, oncircle }))

  $effect(() => {
    if (canvas && image) drawImage(canvas, image)
  })
</script>

<div
  class="pane"
  bind:this={el}
  style:cursor={g.hoverCursor}
  onwheel={g.wheel}
  onpointerdown={g.down}
  onpointermove={g.move}
  onpointerup={g.up}
  onpointercancel={g.up}
  onlostpointercapture={g.up}
  onpointerleave={g.leave}
  role="img"
  aria-label={label}
>
  <div
    class="layer"
    style:transform={`translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`}
    style:--zoom={viewport.zoom}
  >
    {#if image}
      <canvas bind:this={canvas} style:image-rendering="pixelated"></canvas>
    {:else if svg}
      {@html svg}
    {/if}
  </div>
  {#if size}
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
  {/if}
  <span class="pane-label">{label}</span>
</div>

<style>
  .pane {
    position: relative;
    overflow: hidden;
    background: var(--color-ground);
    touch-action: none;
    cursor: grab;
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
  .pane-label {
    position: absolute;
    top: 8px;
    left: 10px;
    font-size: 11px;
    color: var(--color-muted);
    background: color-mix(in srgb, var(--color-panel) 85%, transparent);
    padding: 2px 8px;
    border-radius: 4px;
    pointer-events: none;
  }
</style>
