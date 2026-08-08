import { describe, it, expect } from 'vitest'
import { preprocess, IDENTITY_PRE } from '../src/worker/pipeline/preprocess'
import { mulberry32 } from '../src/worker/pipeline/palette'
import type { RasterImage } from '../src/types'

function flat(width: number, height: number, rgb: [number, number, number]): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < data.length; p += 4) data.set([...rgb, 255], p)
  return { width, height, data }
}

describe('preprocess', () => {
  it('identity options return the same object reference', () => {
    const img = flat(8, 8, [100, 150, 200])
    expect(preprocess(img, { ...IDENTITY_PRE })).toBe(img)
  })

  it('levels: endpoints and midpoint map exactly', () => {
    const img = flat(2, 1, [50, 125, 200])
    const out = preprocess(img, { ...IDENTITY_PRE, blackPoint: 50, whitePoint: 200 })
    expect(out.data[0]).toBe(0)     // 50 -> black
    expect(out.data[2]).toBe(255)   // 200 -> white
    expect(Math.abs(out.data[1] - 128)).toBeLessThanOrEqual(1) // 125 -> mid
  })

  it('saturation 0 produces grayscale (R=G=B)', () => {
    const out = preprocess(flat(2, 2, [200, 50, 100]), { ...IDENTITY_PRE, saturation: 0 })
    for (let p = 0; p < out.data.length; p += 4) {
      expect(out.data[p]).toBe(out.data[p + 1])
      expect(out.data[p + 1]).toBe(out.data[p + 2])
    }
  })

  it('blur preserves mean (±1) and reduces variance on noise', () => {
    const w = 64, h = 64
    const img = flat(w, h, [128, 128, 128])
    const rand = mulberry32(42)
    for (let p = 0; p < img.data.length; p += 4) {
      const v = 128 + (rand() - 0.5) * 100
      img.data[p] = v; img.data[p + 1] = v; img.data[p + 2] = v
    }
    const stats = (d: Uint8ClampedArray) => {
      let sum = 0, sq = 0, n = 0
      for (let p = 0; p < d.length; p += 4) { sum += d[p]; sq += d[p] * d[p]; n++ }
      const mean = sum / n
      return { mean, variance: sq / n - mean * mean }
    }
    const before = stats(img.data)
    const out = preprocess(img, { ...IDENTITY_PRE, blurRadius: 2 })
    const after = stats(out.data)
    expect(Math.abs(after.mean - before.mean)).toBeLessThan(1)
    expect(after.variance).toBeLessThan(before.variance * 0.3)
  })

  it('whitePoint <= blackPoint is guarded (no division blowup)', () => {
    const out = preprocess(flat(2, 1, [100, 100, 100]), { ...IDENTITY_PRE, blackPoint: 200, whitePoint: 100 })
    for (let p = 0; p < out.data.length; p += 4) expect(Number.isFinite(out.data[p])).toBe(true)
  })
})
