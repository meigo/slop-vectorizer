import { describe, it, expect } from 'vitest'
import { maxGapClosing, resampleSteps, SCALES, scaledDims } from '../src/lib/decode'

describe('scaledDims', () => {
  it('applies scale then the 4096 clamp', () => {
    expect(scaledDims(100, 80, 2)).toEqual({ w: 200, h: 160, clamped: false })
    expect(scaledDims(3000, 1000, 2)).toEqual({ w: 4096, h: 1365, clamped: true })
    expect(scaledDims(5000, 5000, 1)).toEqual({ w: 4096, h: 4096, clamped: true })
  })

  it('downscales below ×1, rounding each side', () => {
    expect(scaledDims(300, 200, 0.5)).toEqual({ w: 150, h: 100, clamped: false })
    expect(scaledDims(3000, 2000, 1 / 3)).toEqual({ w: 1000, h: 667, clamped: false })
  })

  it('reports clamped only for the 4096 cap, not for a deliberate downscale', () => {
    // 6000px at ×1 hits the cap; the same image at ×½ lands under it on its own.
    expect(scaledDims(6000, 3000, 1)).toEqual({ w: 4096, h: 2048, clamped: true })
    expect(scaledDims(6000, 3000, 0.5)).toEqual({ w: 3000, h: 1500, clamped: false })
    // Still clamped when even the downscaled result exceeds the cap.
    expect(scaledDims(30000, 15000, 1 / 3)).toEqual({ w: 4096, h: 2048, clamped: true })
  })

  it('never produces a zero-size side', () => {
    expect(scaledDims(2, 2, 1 / 3)).toEqual({ w: 1, h: 1, clamped: false })
  })
})

describe('maxGapClosing', () => {
  it('scales the 3px native cap with the working image, floored at 1', () => {
    expect(maxGapClosing(1 / 3)).toBe(1)
    expect(maxGapClosing(0.5)).toBe(2)
    expect(maxGapClosing(1)).toBe(3)
    expect(maxGapClosing(2)).toBe(6)
    expect(maxGapClosing(3)).toBe(9)
  })
})

describe('resampleSteps', () => {
  it('is a single draw when the reduction is at most 2×', () => {
    expect(resampleSteps(900, 900, 450, 450)).toEqual([{ w: 450, h: 450 }])
    expect(resampleSteps(900, 600, 500, 334)).toEqual([{ w: 500, h: 334 }])
  })

  it('is a single draw when upscaling or unchanged', () => {
    expect(resampleSteps(100, 80, 300, 240)).toEqual([{ w: 300, h: 240 }])
    expect(resampleSteps(100, 80, 100, 80)).toEqual([{ w: 100, h: 80 }])
  })

  // Chrome point-samples a single drawImage past ~2× minification, so anything
  // stronger has to walk down in halving steps to stay box-filtered.
  it('halves until the last step is at most 2×', () => {
    expect(resampleSteps(900, 900, 300, 300)).toEqual([
      { w: 450, h: 450 },
      { w: 300, h: 300 },
    ])
    expect(resampleSteps(900, 900, 225, 225)).toEqual([
      { w: 450, h: 450 },
      { w: 225, h: 225 },
    ])
    expect(resampleSteps(4000, 4000, 100, 100)).toEqual([
      { w: 2000, h: 2000 },
      { w: 1000, h: 1000 },
      { w: 500, h: 500 },
      { w: 250, h: 250 },
      { w: 125, h: 125 },
      { w: 100, h: 100 },
    ])
  })

  it('never steps below the target on either axis', () => {
    const steps = resampleSteps(1000, 333, 333, 111)
    expect(steps).toEqual([
      { w: 500, h: 167 },
      { w: 333, h: 111 },
    ])
    for (const s of steps) expect(s.w >= 333 && s.h >= 111).toBe(true)
  })

  it('terminates and ends exactly on the target for every scale in SCALES', () => {
    for (const scale of SCALES) {
      for (const [w, h] of [
        [4096, 4096],
        [1920, 1080],
        [37, 3],
        [1, 1],
      ]) {
        const d = scaledDims(w, h, scale)
        const steps = resampleSteps(w, h, d.w, d.h)
        expect(steps.length).toBeGreaterThan(0)
        expect(steps[steps.length - 1]).toEqual({ w: d.w, h: d.h })
      }
    }
  })
})
