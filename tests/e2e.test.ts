import { describe, it, expect } from 'vitest'
import { vectorize } from '../src/worker/pipeline'
import { DEFAULT_OPTIONS } from '../src/types'
import { renderShape, insideCircle, insideRing, insideRotSquare } from './helpers/render'

describe('vectorize round-trip', () => {
  it('circle on background -> 2 paths, sane stats, progress in order', () => {
    const img = renderShape(96, 96, insideCircle(48, 48, 30), [200, 30, 30], [245, 245, 245])
    const stages: string[] = []
    const { svg, stats } = vectorize(img, DEFAULT_OPTIONS, (s) => stages.push(s))
    expect(stats.pathCount).toBe(2)
    expect(svg).toContain('<path')
    expect(stages).toEqual(['palette', 'segment', 'boundaries', 'corners', 'fit', 'svg'])
    // circle should need few cubics: pointCount well under the raw boundary point count
    expect(stats.pointCount).toBeLessThan(80)
  })

  it('two-shape three-color image -> 3 paths', () => {
    const circle = insideCircle(30, 48, 20),
      square = insideRotSquare(66, 48, 14, 0.2)
    const img = renderShape(
      96,
      96,
      (x, y) => circle(x, y) || square(x, y),
      [200, 30, 30],
      [245, 245, 245],
    )
    // overpaint square area in blue for a 3rd color
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 96; x++)
        if (square(x + 0.5, y + 0.5)) {
          const o = (y * 96 + x) * 4
          img.data[o] = 30
          img.data[o + 1] = 30
          img.data[o + 2] = 200
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

  it('transparentBg circle -> single path, no background color', () => {
    const img = renderShape(96, 96, insideCircle(48, 48, 30), [200, 30, 30], [245, 245, 245])
    const { svg, stats } = vectorize(img, { ...DEFAULT_OPTIONS, transparentBg: true })
    expect(stats.pathCount).toBe(1)
    expect(svg.match(/<path/g)!.length).toBe(1)
  })

  it('merged ring -> 2 paths (ink, paper), holes intact', () => {
    const ring = (x: number, y: number) => {
      const d = Math.hypot(x - 48, y - 48)
      return d >= 18 && d <= 26
    }
    const img = renderShape(96, 96, ring, [20, 20, 20], [245, 245, 245])
    const { svg, stats } = vectorize(img, { ...DEFAULT_OPTIONS, mergePaths: true })
    expect(stats.pathCount).toBe(2)
    // paper = 2 disjoint regions (outer annulus + inner disc): outer contributes its own
    // border rect PLUS the ring's outer edge as a hole (2 loops), inner disc is 1 loop -> 3.
    // ink = 1 region, outer edge + inner edge as a hole -> 2 loops. Total 3 + 2 = 5.
    expect(svg.match(/M/g)!.length).toBe(5)
  })

  it('is byte-deterministic with all output options enabled', () => {
    const img = renderShape(96, 96, insideCircle(48, 48, 30), [200, 30, 30], [245, 245, 245])
    const opts = {
      ...DEFAULT_OPTIONS,
      mergePaths: true,
      transparentBg: true,
      optimize: true,
      gapClosing: 2,
      blackPoint: 15,
    }
    const a = vectorize(img, opts)
    const b = vectorize(img, opts)
    expect(a.svg).toBe(b.svg)
  })

  it('non-identity pre runs first and appears in timings', () => {
    const img = renderShape(96, 96, insideCircle(48, 48, 30), [200, 30, 30], [245, 245, 245])
    const stages: string[] = []
    const { stats } = vectorize(img, { ...DEFAULT_OPTIONS, blackPoint: 20 }, (s) => stages.push(s))
    expect(stages[0]).toBe('pre')
    expect(stats.timings.pre).toBeGreaterThanOrEqual(0)
    expect(stats.pathCount).toBe(2) // mild levels don't change the circle result
  })

  it('identity pre is skipped entirely', () => {
    const img = renderShape(96, 96, insideCircle(48, 48, 30), [200, 30, 30], [245, 245, 245])
    const stages: string[] = []
    const { stats } = vectorize(img, DEFAULT_OPTIONS, (s) => stages.push(s))
    expect(stages).not.toContain('pre')
    expect(stats.timings.pre).toBeUndefined()
  })

  it('colorOverrides recolors output and stays byte-deterministic', () => {
    const img = renderShape(96, 96, insideCircle(48, 48, 30), [200, 30, 30], [245, 245, 245])
    const opts = { ...DEFAULT_OPTIONS, colorOverrides: ['#112233', '#445566'] }
    const a = vectorize(img, opts)
    const b = vectorize(img, opts)
    expect(a.svg).toBe(b.svg)
    expect(a.svg).toMatch(/fill="#(112233|445566)"/)
    const plain = vectorize(img, DEFAULT_OPTIONS)
    const paths = (s: string) => [...s.matchAll(/d="([^"]*)"/g)].map((m) => m[1])
    expect(paths(a.svg)).toEqual(paths(plain.svg))
  })
})
