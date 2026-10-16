export interface FitResult {
  zoom: number
  panX: number
  panY: number
}

/** The zoom range for wheel and pinch. A fit or a scale change may set a zoom outside it. */
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 64

/** Zoom after multiplying by `factor`, kept in range — but a zoom already outside the range is
 *  only ever moved toward it, so zooming out from a 0.086 fit never jumps in to 0.1. */
export function nextZoom(zoom: number, factor: number): number {
  return Math.min(Math.max(MAX_ZOOM, zoom), Math.max(Math.min(MIN_ZOOM, zoom), zoom * factor))
}

export function computeFit(cw: number, ch: number, iw: number, ih: number): FitResult {
  // floored above 0: a pane laid out at zero height would otherwise give zoom 0, and every
  // later zoom step divides by it
  const zoom = Math.max(1e-3, Math.min(1, cw / iw, ch / ih))
  return {
    zoom,
    panX: (cw - iw * zoom) / 2,
    panY: (ch - ih * zoom) / 2,
  }
}

export interface Point {
  x: number
  y: number
}

export interface PinchStep {
  factor: number // zoom multiplier, ratio of finger distances
  cx: number // previous midpoint: the point to zoom about (client coords)
  cy: number
  dx: number // midpoint movement, applied as a pan after zooming
  dy: number
}

// One step of a two-finger gesture: fingers a,b moved from a0,b0 to a1,b1.
export function pinchStep(a0: Point, b0: Point, a1: Point, b1: Point): PinchStep {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y)
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y)
  const cx = (a0.x + b0.x) / 2
  const cy = (a0.y + b0.y) / 2
  return {
    factor: d0 > 0 ? d1 / d0 : 1,
    cx,
    cy,
    dx: (a1.x + b1.x) / 2 - cx,
    dy: (a1.y + b1.y) / 2 - cy,
  }
}
