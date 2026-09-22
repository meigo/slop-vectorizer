/** Geometry of the local-levels gizmo: a centre dot (move), a solid inner ring (full strength,
 *  resize) and a dashed outer ring (soft edge). Pure, so hit-testing and the drag rules are
 *  testable without a DOM. Screen coordinates are pane-relative CSS pixels. */
import type { LocalCircle } from '../types'
import type { Point } from './viewportMath'

export type GizmoPart = 'move' | 'inner' | 'outer'
/** The slice of Viewport this module reads; Viewport satisfies it structurally. */
export interface ViewXf {
  zoom: number
  panX: number
  panY: number
}
export interface ScreenCircle {
  x: number
  y: number
  inner: number
  outer: number
}

/** Centre dot radius, screen px. */
export const DOT_R = 5
/** How far from a ring a pointer still grabs it: wider for fingers. */
export const hitSlop = (coarse: boolean) => (coarse ? 18 : 6)

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function toScreen(l: LocalCircle, iw: number, ih: number, v: ViewXf): ScreenCircle {
  return {
    x: v.panX + l.cx * iw * v.zoom,
    y: v.panY + l.cy * ih * v.zoom,
    inner: l.inner * iw * v.zoom,
    outer: l.outer * iw * v.zoom,
  }
}

/** Which part a pointer at (px,py) would grab. The dot wins, then the nearer ring (when both
 *  are in reach, the side of the inner ring decides: outside widens the edge, inside resizes);
 *  anywhere else inside the inner ring moves, but only while the inner ring's screen radius is
 *  under `maxMoveRadius` — past that (zoomed into a large circle) the interior falls through to
 *  null so the pane can still pan; outside the inner ring is always null. */
export function hitTest(
  c: ScreenCircle,
  px: number,
  py: number,
  slop: number,
  maxMoveRadius: number,
): GizmoPart | null {
  const d = Math.hypot(px - c.x, py - c.y)
  // Half slop, not full: keeps a small circle's rings grabbable from just outside the dot,
  // while a wider dot zone would swallow them (below ~8 px inner screen radius, 14 px on
  // touch, the dot zone covers the ring anyway — zoom in to resize).
  if (d <= DOT_R + slop / 2) return 'move'
  const nearInner = Math.abs(d - c.inner) <= slop
  const nearOuter = Math.abs(d - c.outer) <= slop
  if (nearInner && nearOuter) return d > c.inner ? 'outer' : 'inner'
  if (nearInner) return 'inner'
  if (nearOuter) return 'outer'
  return d < c.inner && c.inner < maxMoveRadius ? 'move' : null
}

/** The circle after dragging `part` from `from` to `to` (screen px), starting from `start`.
 *  Rings change by the RADIAL delta, so grabbing a ring a few px off it does not jump. The
 *  inner ring pushes the outer one; the outer stops at the inner; the centre stays on the
 *  image. */
export function applyDrag(
  start: LocalCircle,
  part: GizmoPart,
  iw: number,
  ih: number,
  v: ViewXf,
  from: Point,
  to: Point,
): LocalCircle {
  if (part === 'move') {
    return {
      ...start,
      cx: clamp01(start.cx + (to.x - from.x) / v.zoom / iw),
      cy: clamp01(start.cy + (to.y - from.y) / v.zoom / ih),
    }
  }
  const c = toScreen(start, iw, ih, v)
  const delta =
    (Math.hypot(to.x - c.x, to.y - c.y) - Math.hypot(from.x - c.x, from.y - c.y)) / v.zoom / iw
  if (part === 'inner') {
    const inner = Math.max(1 / iw, start.inner + delta)
    return { ...start, inner, outer: Math.max(start.outer, inner) }
  }
  return { ...start, outer: Math.max(start.inner, start.outer + delta) }
}

/** First-enable placement: centred on the visible part of the image, inner radius a quarter of
 *  the pane's short side, outer 1.5×, carrying the given (current global) points. */
export function initialLocal(
  v: ViewXf,
  paneW: number,
  paneH: number,
  iw: number,
  ih: number,
  blackPoint: number,
  whitePoint: number,
): LocalCircle {
  const inner = Math.min(paneW, paneH) / 4 / v.zoom / iw
  return {
    cx: clamp01((paneW / 2 - v.panX) / v.zoom / iw),
    cy: clamp01((paneH / 2 - v.panY) / v.zoom / ih),
    inner,
    outer: inner * 1.5,
    blackPoint,
    whitePoint,
    hidden: false,
  }
}

export type GizmoState = 'selected' | 'unselected' | 'hidden'
export interface GizmoHit {
  index: number
  part: GizmoPart
}

/** Which circle a pointer grabs, and where. The SELECTED circle's ring handles ('inner' /
 *  'outer') are tried first, so an overlapping neighbour drawn on top can never steal them —
 *  the rings of the circle being edited must stay reachable. Its centre dot and interior get no
 *  such priority: where circles coincide, a dot or interior click goes to whichever is visibly
 *  on top, same as any other overlap — otherwise two circles sharing a centre could never select
 *  the top one by clicking it. Failing a ring match, the rest are scanned from the top of the
 *  stack down (their dot, rings and interior all count); if none of them match either, the
 *  selected circle's own dot/interior hit (if any) is used last, so dragging inside it still
 *  moves it instead of falling through to a pane pan. Hidden circles are transparent. */
export function hitTestList(
  circles: LocalCircle[],
  selected: number,
  iw: number,
  ih: number,
  v: ViewXf,
  px: number,
  py: number,
  slop: number,
  maxMoveRadius: number,
): GizmoHit | null {
  const test = (i: number) => {
    const c = circles[i]
    if (!c || c.hidden) return null
    const part = hitTest(toScreen(c, iw, ih, v), px, py, slop, maxMoveRadius)
    return part ? { index: i, part } : null
  }
  const handle = selected >= 0 ? test(selected) : null
  if (handle && handle.part !== 'move') return handle
  for (let i = circles.length - 1; i >= 0; i--) {
    if (i === selected) continue
    const h = test(i)
    if (h) return h
  }
  return handle
}

/** Hover cursor: move for the centre, a resize arrow pointing along the radius for a ring. */
export function cursorFor(part: GizmoPart, c: ScreenCircle, px: number, py: number): string {
  if (part === 'move') return 'move'
  const a = ((Math.atan2(py - c.y, px - c.x) * 180) / Math.PI + 360) % 180
  if (a < 22.5 || a >= 157.5) return 'ew-resize'
  if (a < 67.5) return 'nwse-resize'
  if (a < 112.5) return 'ns-resize'
  return 'nesw-resize'
}
