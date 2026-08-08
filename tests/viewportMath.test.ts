import { describe, it, expect } from 'vitest'
import { computeFit } from '../src/lib/viewportMath'

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
