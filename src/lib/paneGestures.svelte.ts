/** Pan, pinch-zoom, wheel-zoom and local-levels circle dragging for a view pane. One copy for
 *  ImagePane and CompareView, which differ only in what they draw (and the split divider). */
import type { LocalCircle, RasterImage } from '../types'
import type { Viewport } from './viewport.svelte'
import { pinchStep, type Point } from './viewportMath'
import { applyDrag, cursorFor, hitSlop, hitTestList, toScreen, type GizmoPart } from './localGizmo'

/** What the gestures read from the pane, fresh on every event (props change). */
export interface PaneState {
  el: HTMLElement
  viewport: Viewport
  circles: LocalCircle[]
  selected: number
  size: { width: number; height: number } | null
  onselect?: (i: number) => void
  oncircle?: (i: number, c: LocalCircle) => void
}

const coarse = typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches

export class PaneGestures {
  hoverCursor = $state<string | null>(null)
  // Active touches/pointers by id: one pans, two pinch-zoom.
  private pointers = new Map<number, Point>()
  // A gizmo drag in progress: which pointer, which circle/part it grabbed, and where it started.
  private gz: {
    id: number
    index: number
    part: GizmoPart
    start: LocalCircle
    from: Point
  } | null = null

  constructor(private pane: () => PaneState) {}

  private point(el: HTMLElement, e: PointerEvent): Point {
    const r = el.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private hitAt(s: PaneState, p: Point) {
    if (!s.size) return null
    const r = s.el.getBoundingClientRect()
    return hitTestList(
      s.circles,
      s.selected,
      s.size.width,
      s.size.height,
      s.viewport,
      p.x,
      p.y,
      hitSlop(coarse),
      Math.min(r.width, r.height) / 2, // move cap
    )
  }

  wheel = (e: WheelEvent) => {
    const { el, viewport } = this.pane()
    this.hoverCursor = null // the circle moves under a still mouse as the view zooms
    e.preventDefault()
    const r = el.getBoundingClientRect()
    viewport.wheelAt(e.clientX - r.left, e.clientY - r.top, e.deltaY)
  }

  down = (e: PointerEvent) => {
    const s = this.pane()
    // Only the main button: a right-click's pointerup can be swallowed by the context menu,
    // which left a stale entry that turned plain hover into a pan.
    if (e.pointerType === 'mouse' && e.button !== 0) return
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // Captured on the pane, not the target: the target is often a path in the SVG, which the
    // next result replaces, losing the capture and with it this pointer's pointerup.
    s.el.setPointerCapture(e.pointerId)
    const p = this.point(s.el, e)
    const hit = this.pointers.size === 1 ? this.hitAt(s, p) : null
    if (hit && hit.index !== s.selected) s.onselect?.(hit.index)
    this.gz = hit
      ? {
          id: e.pointerId,
          index: hit.index,
          part: hit.part,
          start: { ...s.circles[hit.index] },
          from: p,
        }
      : null
  }

  move = (e: PointerEvent) => {
    const s = this.pane()
    const gz = this.gz
    if (gz && gz.id === e.pointerId && s.size) {
      s.oncircle?.(
        gz.index,
        applyDrag(
          gz.start,
          gz.part,
          s.size.width,
          s.size.height,
          s.viewport,
          gz.from,
          this.point(s.el, e),
        ),
      )
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      return
    }
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      const p = this.point(s.el, e)
      const hit = this.hitAt(s, p)
      this.hoverCursor = hit
        ? cursorFor(
            hit.part,
            toScreen(s.circles[hit.index], s.size!.width, s.size!.height, s.viewport),
            p.x,
            p.y,
          )
        : null
    }
    const prev = this.pointers.get(e.pointerId)
    if (!prev) return
    const cur = { x: e.clientX, y: e.clientY }
    if (this.pointers.size === 1) {
      s.viewport.panBy(cur.x - prev.x, cur.y - prev.y)
    } else if (this.pointers.size === 2) {
      const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)![1]
      const step = pinchStep(prev, other, cur, other)
      const r = s.el.getBoundingClientRect()
      s.viewport.zoomAt(step.cx - r.left, step.cy - r.top, step.factor)
      s.viewport.panBy(step.dx, step.dy)
    }
    this.pointers.set(e.pointerId, cur)
  }

  up = (e: PointerEvent) => {
    if (this.gz?.id === e.pointerId) this.gz = null
    this.pointers.delete(e.pointerId)
  }

  leave = () => {
    this.hoverCursor = null
  }
}

/** Draw `image` into `canvas` at its own pixel size. */
export function drawImage(canvas: HTMLCanvasElement, image: RasterImage): void {
  canvas.width = image.width
  canvas.height = image.height
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
}
