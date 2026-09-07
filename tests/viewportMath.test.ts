import { describe, it, expect } from 'vitest'
import { computeFit, pinchStep } from '../src/lib/viewportMath'

describe('computeFit', () => {
  it('fits a wide image to container width, vertically centered', () => {
    const f = computeFit(1000, 800, 2000, 1000)
    expect(f.zoom).toBeCloseTo(0.5)
    expect(f.panX).toBeCloseTo(0)
    expect(f.panY).toBeCloseTo((800 - 500) / 2)
  })
  it('fits a tall image to container height, horizontally centered', () => {
    const f = computeFit(1000, 500, 400, 1000)
    expect(f.zoom).toBeCloseTo(0.5)
    expect(f.panX).toBeCloseTo((1000 - 200) / 2)
    expect(f.panY).toBeCloseTo(0)
  })
  it('never upscales: small image renders at zoom 1, centered', () => {
    const f = computeFit(1000, 800, 100, 60)
    expect(f.zoom).toBe(1)
    expect(f.panX).toBeCloseTo(450)
    expect(f.panY).toBeCloseTo(370)
  })
})

describe('pinchStep', () => {
  it('spreading fingers symmetrically zooms about the midpoint without panning', () => {
    const s = pinchStep(
      { x: 90, y: 100 },
      { x: 110, y: 100 },
      { x: 80, y: 100 },
      { x: 120, y: 100 },
    )
    expect(s.factor).toBeCloseTo(2)
    expect(s.cx).toBeCloseTo(100)
    expect(s.cy).toBeCloseTo(100)
    expect(s.dx).toBeCloseTo(0)
    expect(s.dy).toBeCloseTo(0)
  })
  it('moving both fingers together pans without zooming', () => {
    const s = pinchStep({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 7 }, { x: 15, y: 7 })
    expect(s.factor).toBeCloseTo(1)
    expect(s.dx).toBeCloseTo(5)
    expect(s.dy).toBeCloseTo(7)
  })
  it('does not divide by zero when the previous fingers coincide', () => {
    const s = pinchStep({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 10 })
    expect(Number.isFinite(s.factor)).toBe(true)
  })
})
