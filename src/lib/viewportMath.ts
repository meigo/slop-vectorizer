export interface FitResult {
  zoom: number
  panX: number
  panY: number
}

export function computeFit(cw: number, ch: number, iw: number, ih: number): FitResult {
  const zoom = Math.min(1, cw / iw, ch / ih)
  return {
    zoom,
    panX: (cw - iw * zoom) / 2,
    panY: (ch - ih * zoom) / 2,
  }
}
