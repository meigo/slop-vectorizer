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
    expect(out.data[0]).toBe(0) // 50 -> black
    expect(out.data[2]).toBe(255) // 200 -> white
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
    const w = 64,
      h = 64
    const img = flat(w, h, [128, 128, 128])
    const rand = mulberry32(42)
    for (let p = 0; p < img.data.length; p += 4) {
      const v = 128 + (rand() - 0.5) * 100
      img.data[p] = v
      img.data[p + 1] = v
      img.data[p + 2] = v
    }
    const stats = (d: Uint8ClampedArray) => {
      let sum = 0,
        sq = 0,
        n = 0
      for (let p = 0; p < d.length; p += 4) {
        sum += d[p]
        sq += d[p] * d[p]
        n++
      }
      const mean = sum / n
      return { mean, variance: sq / n - mean * mean }
    }
    const before = stats(img.data)
    const out = preprocess(img, { ...IDENTITY_PRE, blurRadius: 2 })
    const after = stats(out.data)
    expect(Math.abs(after.mean - before.mean)).toBeLessThan(1)
    expect(after.variance).toBeLessThan(before.variance * 0.3)
  })

  it('fractional blur values produce intermediate strength', () => {
    const w = 64,
      h = 64
    const noise = (): RasterImage => {
      const img = flat(w, h, [128, 128, 128])
      const rand = mulberry32(42)
      for (let p = 0; p < img.data.length; p += 4) {
        const v = 128 + (rand() - 0.5) * 100
        img.data[p] = v
        img.data[p + 1] = v
        img.data[p + 2] = v
      }
      return img
    }
    const variance = (blurRadius: number): number => {
      const d = preprocess(noise(), { ...IDENTITY_PRE, blurRadius }).data
      let sum = 0,
        sq = 0,
        n = 0
      for (let p = 0; p < d.length; p += 4) {
        sum += d[p]
        sq += d[p] * d[p]
        n++
      }
      const mean = sum / n
      return sq / n - mean * mean
    }
    const v1 = variance(1)
    const v15 = variance(1.5)
    const v2 = variance(2)
    expect(v15).toBeLessThan(v1) // 1.5 blurs more than 1
    expect(v2).toBeLessThan(v15) // 2 blurs more than 1.5
    expect(variance(0.5)).toBeLessThan(variance(0)) // even the smallest step blurs
  })

  it('whitePoint <= blackPoint is guarded (no division blowup)', () => {
    const out = preprocess(flat(2, 1, [100, 100, 100]), {
      ...IDENTITY_PRE,
      blackPoint: 200,
      whitePoint: 100,
    })
    for (let p = 0; p < out.data.length; p += 4) expect(Number.isFinite(out.data[p])).toBe(true)
  })
})

describe('preprocess: flatten', () => {
  /**
   * Paper lit unevenly: luminance ramps left-to-right and top-to-bottom, plus grain.
   * `art` adds the case that actually matters — a large solid bright block (a face)
   * and broad dark strokes (ink) on mid-toned paper, so the paper is neither the
   * lightest nor the darkest thing present.
   */
  function litPaper(w: number, h: number, lo: number, hi: number, art = false): RasterImage {
    const rnd = mulberry32(7)
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = (x / (w - 1) + y / (h - 1)) / 2
        let v = lo + (hi - lo) * t + (rnd() - 0.5) * 16
        if (art) {
          if (x > w / 3 && x < (2 * w) / 3 && y > h / 3 && y < (2 * h) / 3) v = 235 // face
          else if (x > (3 * w) / 4 || y > (3 * h) / 4) if ((x + y) % 11 < 5) v = 20 // ink
        }
        const p = (y * w + x) * 4
        data.set([v, v, v, 255], p)
      }
    return { width: w, height: h, data }
  }

  /** Mean luminance of a 12px patch. */
  const patch = (img: RasterImage, x: number, y: number) => {
    let s = 0
    for (let j = 0; j < 12; j++)
      for (let i = 0; i < 12; i++) s += img.data[((y + j) * img.width + x + i) * 4]
    return s / 144
  }

  it('flatten 0 is identity', () => {
    const img = litPaper(64, 64, 108, 177)
    expect(preprocess(img, { ...IDENTITY_PRE, flatten: 0 })).toBe(img)
  })

  it('removes a lighting ramp: corners converge to one paper level', () => {
    const img = litPaper(128, 128, 108, 177)
    const before = Math.abs(patch(img, 4, 4) - patch(img, 110, 110))
    const out = preprocess(img, { ...IDENTITY_PRE, flatten: 1 })
    const after = Math.abs(patch(out, 4, 4) - patch(out, 110, 110))
    expect(before).toBeGreaterThan(50) // the ramp really is there
    expect(after).toBeLessThan(8) // and is gone afterwards
  })

  it('strength scales the correction', () => {
    const img = litPaper(128, 128, 108, 177)
    const spread = (s: number) => {
      const o = preprocess(img, { ...IDENTITY_PRE, flatten: s })
      return Math.abs(patch(o, 4, 4) - patch(o, 110, 110))
    }
    expect(spread(0.5)).toBeGreaterThan(spread(1))
    expect(spread(0.5)).toBeLessThan(spread(0.05))
  })

  it('keeps a large bright region distinct from the paper', () => {
    // the whole point of fitting a stiff global surface rather than a local one:
    // a 40x40 solid bright block must not be read as "paper here is bright"
    const img = litPaper(128, 128, 108, 177, true)
    const out = preprocess(img, { ...IDENTITY_PRE, flatten: 1 })
    const paperLevel = (patch(out, 4, 4) + patch(out, 110, 4)) / 2
    expect(patch(out, 58, 58) - paperLevel).toBeGreaterThan(50)
  })

  it('paper that is neither the lightest nor the darkest tone still flattens', () => {
    // The real failure mode: with ink below the paper and a face above it, a fixed
    // percentile tracks whichever of the two dominates a cell, and plain outlier
    // rejection gives up at ~50% contamination — the surface then follows the ink and
    // the correction amplifies that corner instead of levelling it.
    const img = litPaper(160, 160, 108, 177, true)
    // sample paper only: clear of the face block and of the inked quarters
    const paper = (i: RasterImage) => [
      patch(i, 4, 4),
      patch(i, 105, 4),
      patch(i, 4, 105),
      patch(i, 105, 105),
    ]
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v)
    expect(spread(paper(img))).toBeGreaterThan(30)
    const out = preprocess(img, { ...IDENTITY_PRE, flatten: 1 })
    expect(spread(paper(out))).toBeLessThan(10)
    // and the correction never runs away into clipping
    expect(Math.max(...paper(out))).toBeLessThan(230)
  })

  it('leaves an already-even image essentially alone', () => {
    const img = litPaper(96, 96, 140, 140)
    const out = preprocess(img, { ...IDENTITY_PRE, flatten: 1 })
    expect(Math.abs(patch(out, 4, 4) - patch(img, 4, 4))).toBeLessThan(4)
    expect(Math.abs(patch(out, 80, 80) - patch(img, 80, 80))).toBeLessThan(4)
  })

  it('too small to fit: passes pixels through unchanged', () => {
    const img = litPaper(6, 6, 100, 200)
    const out = preprocess(img, { ...IDENTITY_PRE, flatten: 1 })
    for (let p = 0; p < img.data.length; p += 4) expect(out.data[p]).toBe(img.data[p])
  })
})
