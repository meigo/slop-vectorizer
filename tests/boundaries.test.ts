import { describe, it, expect } from 'vitest'
import { estimatePalette } from '../src/worker/pipeline/palette'
import { segmentImage } from '../src/worker/pipeline/segment'
import { extractBoundaries } from '../src/worker/pipeline/boundaries'
import { renderShape, insideCircle } from './helpers/render'
import type { Palette, RasterImage } from '../src/types'

describe('extractBoundaries', () => {
  const img = renderShape(64, 64, insideCircle(32, 32, 20.3), [200, 30, 30], [245, 245, 245])
  const pal = estimatePalette(img, 2)
  const seg = segmentImage(img, pal, 4)
  const all = extractBoundaries(img, seg, pal)

  it('circle region has exactly one loop', () => {
    const circleRegion = all.find(r => seg.regionSize[r.region] < 64 * 64 / 2)!
    expect(circleRegion.loops.length).toBe(1)
  })

  it('sub-pixel: refined points lie within 0.1px of true radius', () => {
    const circleRegion = all.find(r => seg.regionSize[r.region] < 64 * 64 / 2)!
    const pts = circleRegion.loops[0]
    let maxErr = 0
    for (let i = 0; i < pts.length; i += 2) {
      const r = Math.hypot(pts[i] - 32, pts[i + 1] - 32)
      maxErr = Math.max(maxErr, Math.abs(r - 20.3))
    }
    expect(maxErr).toBeLessThan(0.1)
  })

  it('shared boundary is identical between the two regions', () => {
    const key = (x: number, y: number) => x.toFixed(6) + ',' + y.toFixed(6)
    const sets = all.map(r => {
      const s = new Set<string>()
      for (const l of r.loops) for (let i = 0; i < l.length; i += 2) s.add(key(l[i], l[i + 1]))
      return s
    })
    // every point of the smaller set appears in the larger (image-border points excluded from the circle's set)
    const [a, b] = sets.sort((x, y) => x.size - y.size)
    for (const p of a) expect(b.has(p)).toBe(true)
  })
})

describe('extractBoundaries: diagonal junction', () => {
  // Region A touches itself diagonally at lattice vertex (2,2) and encloses a 1px hole
  // at pixel (2,1). Under 4-connectivity the two B quadrants meeting at (2,2) are
  // *separate* regions, so each must hug its own quadrant and A's outline must pass
  // straight through the vertex — otherwise the two sides' outlines cross.
  const pattern = ['BAAA', 'BABA', 'BBAA', 'BBBB']
  const w = 4, h = 4
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    data.set(pattern[y][x] === 'A' ? [200, 30, 30, 255] : [245, 245, 245, 255], (y * w + x) * 4)
  const img: RasterImage = { width: w, height: h, data }
  const pal: Palette = { k: 2, colors: new Uint8ClampedArray([200, 30, 30, 245, 245, 245]) }
  const seg = segmentImage(img, pal, 1)
  const all = extractBoundaries(img, seg, pal)
  const byRegion = (size: number) => all.find(r => seg.regionSize[r.region] === size)!

  it('splits into three regions, each fully traced', () => {
    expect(seg.regionCount).toBe(3)
    expect(all.length).toBe(3)
  })

  it('the pinched region gets an outer loop plus a hole loop', () => {
    const a = byRegion(7)
    expect(a.loops.length).toBe(2)
    expect(a.loops.map(l => l.length / 2).sort((x, y) => x - y)).toEqual([4, 12])
  })

  it('the hole loop matches the enclosed 1px region exactly', () => {
    const key = (l: Float64Array) => {
      const s: string[] = []
      for (let i = 0; i < l.length; i += 2) s.push(l[i] + ',' + l[i + 1])
      return s.sort().join(' ')
    }
    const hole = byRegion(7).loops.find(l => l.length === 8)!
    expect(key(hole)).toBe(key(byRegion(1).loops[0]))
  })
})
