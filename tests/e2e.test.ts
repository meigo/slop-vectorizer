import { describe, it, expect } from 'vitest'
import { vectorize } from '../src/worker/pipeline'
import { DEFAULT_OPTIONS } from '../src/types'
import { renderShape, insideCircle, insideRing, insideRotSquare } from './helpers/render'

describe('vectorize round-trip', () => {
  it('circle on background -> 2 paths, sane stats, progress in order', () => {
    const img = renderShape(96, 96, insideCircle(48, 48, 30), [200, 30, 30], [245, 245, 245])
    const stages: string[] = []
    const { svg, stats } = vectorize(img, DEFAULT_OPTIONS, s => stages.push(s))
    expect(stats.pathCount).toBe(2)
    expect(svg).toContain('<path')
    expect(stages).toEqual(['palette', 'segment', 'boundaries', 'corners', 'fit', 'svg'])
    // circle should need few cubics: pointCount well under the raw boundary point count
    expect(stats.pointCount).toBeLessThan(80)
  })

  it('two-shape three-color image -> 3 paths', () => {
    const circle = insideCircle(30, 48, 20), square = insideRotSquare(66, 48, 14, 0.2)
    const img = renderShape(96, 96, (x, y) => circle(x, y) || square(x, y), [200, 30, 30], [245, 245, 245])
    // overpaint square area in blue for a 3rd color
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 96; x++)
        if (square(x + 0.5, y + 0.5)) {
          const o = (y * 96 + x) * 4
          img.data[o] = 30; img.data[o + 1] = 30; img.data[o + 2] = 200
        }
    const { stats } = vectorize(img, DEFAULT_OPTIONS)
    expect(stats.pathCount).toBe(3)
  })

  it('thin stroke logo -> stroke survives instead of a blank rect', () => {
    const img = renderShape(128, 128, insideRing(64, 64, 40, 0.75), [0, 0, 0], [255, 255, 255])
    for (const colorCount of ['auto', 2] as const) {
      const { svg, stats } = vectorize(img, { ...DEFAULT_OPTIONS, colorCount })
      expect(stats.pathCount).toBeGreaterThanOrEqual(2) // background + ring (+ its hole)
      expect(svg).toContain('<path')
    }
  })
})
