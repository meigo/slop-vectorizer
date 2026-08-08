import { computeFit } from './viewportMath'

export class Viewport {
  zoom = $state(1)
  panX = $state(0)
  panY = $state(0)
  // True after a manual zoom/pan; cleared by fitTo() so fits re-arm auto-refit.
  touched = $state(false)

  wheelAt(cx: number, cy: number, deltaY: number): void {
    this.touched = true
    const factor = Math.exp(-deltaY * 0.002)
    const next = Math.min(64, Math.max(0.1, this.zoom * factor))
    this.panX = cx - (cx - this.panX) * (next / this.zoom)
    this.panY = cy - (cy - this.panY) * (next / this.zoom)
    this.zoom = next
  }

  panBy(dx: number, dy: number): void {
    this.touched = true
    this.panX += dx
    this.panY += dy
  }

  fitTo(cw: number, ch: number, iw: number, ih: number): void {
    const f = computeFit(cw, ch, iw, ih)
    this.zoom = f.zoom
    this.panX = f.panX
    this.panY = f.panY
    this.touched = false
  }
}
