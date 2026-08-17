import { describe, it, expect } from 'vitest'
import { estimatePalette } from '../src/worker/pipeline/palette'
import { segmentImage } from '../src/worker/pipeline/segment'
import { extractBoundaries, loopPointsOf } from '../src/worker/pipeline/boundaries'
import { renderShape, insideCircle, insideRing } from './helpers/render'
import type { ArcRef, Boundaries, Palette, RasterImage } from '../src/types'

describe('extractBoundaries', () => {
  const img = renderShape(64, 64, insideCircle(32, 32, 20.3), [200, 30, 30], [245, 245, 245])
  const pal = estimatePalette(img, 2)
  const seg = segmentImage(img, pal, 4)
  const all = extractBoundaries(img, seg, pal)
  const circleRegion = () => all.regions.find((r) => seg.regionSize[r.region] < (64 * 64) / 2)!

  it('circle region has exactly one loop', () => {
    expect(circleRegion().loops.length).toBe(1)
  })

  it('sub-pixel: refined points lie within 0.1px of true radius', () => {
    const pts = loopPointsOf(all.arcs, circleRegion().loops[0])
    let maxErr = 0
    for (let i = 0; i < pts.length; i += 2) {
      const r = Math.hypot(pts[i] - 32, pts[i + 1] - 32)
      maxErr = Math.max(maxErr, Math.abs(r - 20.3))
    }
    expect(maxErr).toBeLessThan(0.1)
  })

  it('shared boundary is identical between the two regions', () => {
    const key = (x: number, y: number) => x.toFixed(6) + ',' + y.toFixed(6)
    const sets = all.regions.map((r) => {
      const s = new Set<string>()
      for (const refs of r.loops) {
        const l = loopPointsOf(all.arcs, refs)
        for (let i = 0; i < l.length; i += 2) s.add(key(l[i], l[i + 1]))
      }
      return s
    })
    // every point of the smaller set appears in the larger (image-border points excluded from the circle's set)
    const [a, b] = sets.sort((x, y) => x.size - y.size)
    for (const p of a) expect(b.has(p)).toBe(true)
  })

  it('the junction-free circle boundary is stored once and shared by both regions', () => {
    const circle = circleRegion().loops[0]
    expect(circle.length).toBe(1)
    expect(all.arcs[circle[0].arc].closed).toBe(true)
    const bg = all.regions.find((r) => r !== circleRegion())!
    expect(bg.loops.some((refs) => refs.length === 1 && refs[0].arc === circle[0].arc)).toBe(true)
  })
})

/** Red and blue rectangles abutting on a light background: 3 regions, 2 junctions. */
function abuttingRectsBoundaries(): Boundaries {
  const img = renderShape(
    120,
    80,
    (x, y) => x >= 20 && x < 60 && y >= 20 && y < 60,
    [200, 30, 30],
    [245, 245, 245],
  )
  for (let y = 20; y < 60; y++)
    for (let x = 60; x < 100; x++) {
      const o = (y * 120 + x) * 4
      img.data[o] = 30
      img.data[o + 1] = 30
      img.data[o + 2] = 200
    }
  const pal = estimatePalette(img, 3)
  const seg = segmentImage(img, pal, 4)
  return extractBoundaries(img, seg, pal)
}

describe('extractBoundaries: shared arcs', () => {
  it('arcs: shared arcs referenced exactly twice with opposite directions', () => {
    const b = abuttingRectsBoundaries()
    const refCount = new Map<number, { n: number; dirs: boolean[] }>()
    for (const r of b.regions)
      for (const loop of r.loops)
        for (const ref of loop) {
          const e = refCount.get(ref.arc) ?? { n: 0, dirs: [] }
          e.n++
          e.dirs.push(ref.reversed)
          refCount.set(ref.arc, e)
        }
    for (const e of refCount.values()) {
      expect(e.n).toBeLessThanOrEqual(2)
      if (e.n === 2) expect(e.dirs[0]).not.toBe(e.dirs[1]) // opposite directions
    }
    // every arc is referenced at least once
    expect([...refCount.keys()].length).toBe(b.arcs.length)
    // the two rectangles meet the background and each other -> shared arcs exist
    expect([...refCount.values()].filter((e) => e.n === 2).length).toBeGreaterThan(0)
  })

  it('arcs: open-arc endpoints are integer junction vertices shared across arcs', () => {
    const b = abuttingRectsBoundaries()
    const endpoints = new Set<string>()
    for (const a of b.arcs) {
      if (a.closed) continue
      const sx = a.points[0],
        sy = a.points[1]
      const ex = a.points[a.points.length - 2],
        ey = a.points[a.points.length - 1]
      for (const [x, y] of [
        [sx, sy],
        [ex, ey],
      ]) {
        expect(Number.isInteger(x)).toBe(true)
        expect(Number.isInteger(y)).toBe(true)
        endpoints.add(`${x},${y}`)
      }
    }
    expect(endpoints.size).toBeGreaterThan(0)
    // the three regions meet exactly where the rectangles touch the background
    expect([...endpoints].sort()).toEqual(['60,20', '60,60'])
  })

  it('arcs: dedup holds on a dense image where every vertex is a junction', () => {
    // 4 colors, 1px blocks, no despeckle: maximal junction density, including the
    // degree-4 vertices where a region touches itself diagonally.
    let s = 12345
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
    const img: RasterImage = { width: 41, height: 33, data: new Uint8ClampedArray(41 * 33 * 4) }
    const cols = [
      [10, 10, 10],
      [240, 20, 20],
      [20, 240, 20],
      [20, 20, 240],
    ]
    for (let i = 0; i < 41 * 33; i++) {
      const c = cols[(rnd() * 4) | 0]
      img.data.set([c[0], c[1], c[2], 255], i * 4)
    }
    const pal = estimatePalette(img, 4)
    const b = extractBoundaries(img, segmentImage(img, pal, 0), pal)
    const dirs = new Map<number, boolean[]>()
    for (const r of b.regions)
      for (const loop of r.loops)
        for (const ref of loop) dirs.set(ref.arc, [...(dirs.get(ref.arc) ?? []), ref.reversed])
    expect(dirs.size).toBe(b.arcs.length)
    for (const d of dirs.values()) {
      expect(d.length).toBeLessThanOrEqual(2)
      if (d.length === 2) expect(d[0]).not.toBe(d[1])
    }
    expect([...dirs.values()].filter((d) => d.length === 2).length).toBeGreaterThan(100)
  })

  it('loopPointsOf: loops close without duplicated points', () => {
    const b = abuttingRectsBoundaries()
    for (const r of b.regions)
      for (const loop of r.loops) {
        const pts = loopPointsOf(b.arcs, loop)
        const seen = new Set<string>()
        for (let i = 0; i < pts.length; i += 2) {
          const k = `${pts[i]},${pts[i + 1]}`
          expect(seen.has(k)).toBe(false)
          seen.add(k)
        }
      }
  })
})

describe('extractBoundaries: diagonal junction', () => {
  // Region A touches itself diagonally at lattice vertex (2,2) and encloses a 1px hole
  // at pixel (2,1). Under 4-connectivity the two B quadrants meeting at (2,2) are
  // *separate* regions, so each must hug its own quadrant and A's outline must pass
  // straight through the vertex — otherwise the two sides' outlines cross.
  const pattern = ['BAAA', 'BABA', 'BBAA', 'BBBB']
  const w = 4,
    h = 4
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      data.set(pattern[y][x] === 'A' ? [200, 30, 30, 255] : [245, 245, 245, 255], (y * w + x) * 4)
  const img: RasterImage = { width: w, height: h, data }
  const pal: Palette = { k: 2, colors: new Uint8ClampedArray([200, 30, 30, 245, 245, 245]) }
  const seg = segmentImage(img, pal, 1)
  const all = extractBoundaries(img, seg, pal)
  const byRegion = (size: number) => all.regions.find((r) => seg.regionSize[r.region] === size)!
  const pointsOf = (refs: ArcRef[]) => loopPointsOf(all.arcs, refs)

  it('splits into three regions, each fully traced', () => {
    expect(seg.regionCount).toBe(3)
    expect(all.regions.length).toBe(3)
  })

  it('the pinched region gets an outer loop plus a hole loop', () => {
    const a = byRegion(7)
    expect(a.loops.length).toBe(2)
    // 12 edge midpoints + 2 junction vertices on the outer loop; the hole's neighbour
    // never changes, so it stays a 4-point closed arc.
    expect(a.loops.map((l) => pointsOf(l).length / 2).sort((x, y) => x - y)).toEqual([4, 14])
  })

  it('the outer loop is cut into two arcs at the image-border junctions', () => {
    const outer = byRegion(7).loops.find((l) => l.length > 1)!
    expect(outer.length).toBe(2)
    for (const ref of outer) expect(all.arcs[ref.arc].closed).toBe(false)
  })

  it('the hole loop is the same stored arc as the enclosed 1px region, reversed', () => {
    const key = (l: Float64Array) => {
      const s: string[] = []
      for (let i = 0; i < l.length; i += 2) s.push(l[i] + ',' + l[i + 1])
      return s.sort().join(' ')
    }
    const hole = byRegion(7).loops.find((l) => l.length === 1)!
    const inner = byRegion(1).loops[0]
    expect(inner.length).toBe(1)
    expect(inner[0].arc).toBe(hole[0].arc) // fitted once, not twice
    expect(inner[0].reversed).not.toBe(hole[0].reversed)
    expect(key(pointsOf(hole))).toBe(key(pointsOf(inner)))
  })
})

describe('extractBoundaries: region emission order', () => {
  /** Row-major index of each region's first pixel. */
  const firstPixels = (seg: { labelMap: Int32Array; regionCount: number }) => {
    const f = new Int32Array(seg.regionCount).fill(-1)
    for (let i = 0; i < seg.labelMap.length; i++)
      if (f[seg.labelMap[i]] === -1) f[seg.labelMap[i]] = i
    return f
  }

  // Stacked output paints regions in the order extractBoundaries emits them, with no
  // sort of its own, so this order IS the containment order. Reordering the edge
  // sweeps in boundaries.ts would silently break stacked painting; this catches it.
  const checkOrder = (img: RasterImage, despeckle: number) => {
    const pal = estimatePalette(img, 2)
    const seg = segmentImage(img, pal, despeckle)
    const bounds = extractBoundaries(img, seg, pal)
    const f = firstPixels(seg)
    const keys = bounds.regions.map((r) => f[r.region])
    expect(bounds.regions.length).toBe(seg.regionCount) // every region is emitted
    expect(keys).toEqual([...keys].sort((a, b) => a - b))
    expect(new Set(keys).size).toBe(keys.length) // strictly increasing, no ties
    return keys.length
  }

  it('nested ring: outer region before the one it encloses', () => {
    const img = renderShape(64, 64, insideRing(32, 32, 18, 6), [0, 0, 0], [255, 255, 255])
    expect(checkOrder(img, 0)).toBe(3) // bg, ring, inner disc
  })

  it('hundreds of interleaved regions stay in first-pixel order', () => {
    for (const seed of [1, 7, 99, 12345]) {
      let s = seed
      const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
      const data = new Uint8ClampedArray(64 * 64 * 4).fill(255)
      for (let i = 0; i < 64 * 64; i++) {
        const v = rnd() < 0.5 ? 0 : 255
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
      }
      expect(checkOrder({ width: 64, height: 64, data }, 0)).toBeGreaterThan(100)
    }
  })
})
