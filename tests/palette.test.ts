import { describe, it, expect } from 'vitest'
import { estimatePalette } from '../src/worker/pipeline/palette'
import { renderShape, insideCircle } from './helpers/render'

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
    const a = estimatePalette(img, 'auto'), b = estimatePalette(img, 'auto')
    expect([...a.colors]).toEqual([...b.colors])
  })
})
