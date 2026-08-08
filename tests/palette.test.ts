import { describe, it, expect } from 'vitest'
import { estimatePalette } from '../src/worker/pipeline/palette'
import { renderShape, insideCircle, insideRing } from './helpers/render'

const nearest = (p: Uint8ClampedArray, c: number[]) => {
  let best = Infinity
  for (let i = 0; i < p.length; i += 3)
    best = Math.min(best, Math.hypot(p[i] - c[0], p[i + 1] - c[1], p[i + 2] - c[2]))
  return best
}

describe('estimatePalette', () => {
  const img = renderShape(64, 64, insideCircle(32, 32, 20), [200, 30, 30], [245, 245, 245])

  it('auto mode finds k=2 for a two-color image', () => {
    const pal = estimatePalette(img, 'auto')
    expect(pal.k).toBe(2)
  })

  it('recovers both colors within tolerance, no invented edge colors', () => {
    const pal = estimatePalette(img, 2)
    expect(nearest(pal.colors, [200, 30, 30])).toBeLessThan(10)
    expect(nearest(pal.colors, [245, 245, 245])).toBeLessThan(10)
  })

  it('is deterministic', () => {
    const a = estimatePalette(img, 'auto'),
      b = estimatePalette(img, 'auto')
    expect([...a.colors]).toEqual([...b.colors])
  })
})

describe('estimatePalette with thin strokes', () => {
  // 1.5px stroke: no foreground pixel is low-gradient, so plain sampling sees only background
  const ring = renderShape(128, 128, insideRing(64, 64, 40, 0.75), [0, 0, 0], [255, 255, 255])

  it('recovers a stroke-only color instead of collapsing onto the background', () => {
    const pal = estimatePalette(ring, 2)
    expect(nearest(pal.colors, [0, 0, 0])).toBeLessThan(10)
    expect(nearest(pal.colors, [255, 255, 255])).toBeLessThan(10)
  })

  it('auto mode finds k=2 with distinct centroids', () => {
    const pal = estimatePalette(ring, 'auto')
    expect(pal.k).toBe(2)
    expect(nearest(pal.colors, [0, 0, 0])).toBeLessThan(10)
    expect(nearest(pal.colors, [255, 255, 255])).toBeLessThan(10)
  })

  it('is deterministic', () => {
    const a = estimatePalette(ring, 'auto'),
      b = estimatePalette(ring, 'auto')
    expect([...a.colors]).toEqual([...b.colors])
  })

  it('recovers a stroke-only third color next to a solid shape', () => {
    // solid red disc + thin blue ring on white: blue exists only as a 1.5px stroke
    const img2 = renderShape(128, 128, insideCircle(40, 64, 22), [200, 30, 30], [245, 245, 245])
    const stroke = insideRing(95, 64, 22, 0.75)
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        let cov = 0
        for (let sj = 0; sj < 8; sj++)
          for (let si = 0; si < 8; si++) if (stroke(x + (si + 0.5) / 8, y + (sj + 0.5) / 8)) cov++
        const a = cov / 64,
          o = (y * 128 + x) * 4
        if (a === 0) continue
        for (let d = 0; d < 3; d++)
          img2.data[o + d] = [30, 30, 200][d] * a + img2.data[o + d] * (1 - a)
      }
    const pal = estimatePalette(img2, 3)
    expect(nearest(pal.colors, [30, 30, 200])).toBeLessThan(10)
    expect(nearest(pal.colors, [200, 30, 30])).toBeLessThan(10)
    expect(nearest(pal.colors, [245, 245, 245])).toBeLessThan(10)
  })

  it('does not invent anti-aliased edge colors when k exceeds the real color count', () => {
    const two = renderShape(96, 96, insideCircle(48, 48, 30), [200, 30, 30], [245, 245, 245])
    const pal = estimatePalette(two, 8)
    // every centroid must still be one of the two real colors, not an edge blend
    for (let i = 0; i < pal.colors.length; i += 3)
      expect(
        Math.min(
          Math.hypot(pal.colors[i] - 200, pal.colors[i + 1] - 30, pal.colors[i + 2] - 30),
          Math.hypot(pal.colors[i] - 245, pal.colors[i + 1] - 245, pal.colors[i + 2] - 245),
        ),
      ).toBeLessThan(10)
  })

  it('keeps a small accent region as its own palette entry', () => {
    const img2 = renderShape(96, 96, insideCircle(40, 48, 24), [200, 30, 30], [245, 245, 245])
    const dot = insideCircle(78, 20, 4)
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 96; x++)
        if (dot(x + 0.5, y + 0.5)) {
          const o = (y * 96 + x) * 4
          img2.data[o] = 30
          img2.data[o + 1] = 30
          img2.data[o + 2] = 200
        }
    expect(estimatePalette(img2, 'auto').k).toBe(3)
    expect(nearest(estimatePalette(img2, 3).colors, [30, 30, 200])).toBeLessThan(10)
  })
})
