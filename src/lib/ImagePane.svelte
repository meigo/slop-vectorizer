<!-- src/lib/ImagePane.svelte -->
<script lang="ts">
  import type { LocalCircle, RasterImage } from '../types'
  import type { Viewport } from './viewport.svelte'
  import { pinchStep, type Point } from './viewportMath'
  import LocalGizmo from './LocalGizmo.svelte'
  import { applyDrag, cursorFor, hitSlop, hitTest, toScreen, type GizmoPart } from './localGizmo'

  let {
    image = null,
    svg = null,
    label,
    viewport,
    local = null,
    size = null,
    onlocal,
  }: {
    image?: RasterImage | null
    svg?: string | null
    label: string
    viewport: Viewport
    local?: LocalCircle | null
    size?: { width: number; height: number } | null
    onlocal?: (l: LocalCircle) => void
  } = $props()

  let el: HTMLDivElement
  let canvas = $state<HTMLCanvasElement | null>(null)
  // Active touches/pointers by id: one pans, two pinch-zoom.
  const pointers = new Map<number, Point>()
  const coarse = typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches
  // A gizmo drag in progress: which pointer, what it grabbed, and where it started.
  let gz: { id: number; part: GizmoPart; start: LocalCircle; from: Point } | null = null
  let hoverCursor = $state<string | null>(null)
  const circle = $derived(local && size ? toScreen(local, size.width, size.height, viewport) : null)

  function panePoint(e: PointerEvent): Point {
    const r = el.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

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
    hoverCursor = null // the circle moves under a still mouse as the view zooms
    e.preventDefault()
    const r = el.getBoundingClientRect()
    viewport.wheelAt(e.clientX - r.left, e.clientY - r.top, e.deltaY)
  }
  function down(e: PointerEvent) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    ;(e.target as Element).setPointerCapture(e.pointerId)
    // Only a lone pointer can grab the gizmo; a second finger turns it into a pinch.
    const p = panePoint(e)
    const r = el.getBoundingClientRect()
    const part =
      pointers.size === 1 && circle
        ? hitTest(circle, p.x, p.y, hitSlop(coarse), Math.min(r.width, r.height) / 2)
        : null
    gz = part && local ? { id: e.pointerId, part, start: { ...local }, from: p } : null
  }
  function move(e: PointerEvent) {
    if (gz && gz.id === e.pointerId && size) {
      onlocal?.(
        applyDrag(gz.start, gz.part, size.width, size.height, viewport, gz.from, panePoint(e)),
      )
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      return
    }
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      const p = panePoint(e)
      const r = el.getBoundingClientRect()
      const part = circle
        ? hitTest(circle, p.x, p.y, hitSlop(coarse), Math.min(r.width, r.height) / 2)
        : null
      hoverCursor = part && circle ? cursorFor(part, circle, p.x, p.y) : null
    }
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
    if (gz?.id === e.pointerId) gz = null
    pointers.delete(e.pointerId)
  }
</script>

<div
  class="pane"
  bind:this={el}
  style:cursor={hoverCursor}
  onwheel={wheel}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onpointerleave={() => (hoverCursor = null)}
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
  {#if circle}<LocalGizmo c={circle} />{/if}
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
