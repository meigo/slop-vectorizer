import { describe, it, expect } from 'vitest'
import { estimatePalette } from '../src/worker/pipeline/palette'
import { segmentImage } from '../src/worker/pipeline/segment'
import { extractBoundaries, loopPointsOf } from '../src/worker/pipeline/boundaries'
import { findCorners, findOpenCorners } from '../src/worker/pipeline/corners'
import { renderShape, insideCircle, insideRotSquare } from './helpers/render'

function shapeLoop(inside: (x: number, y: number) => boolean): Float64Array {
  const img = renderShape(96, 96, inside, [200, 30, 30], [245, 245, 245])
  const pal = estimatePalette(img, 2)
  const seg = segmentImage(img, pal, 4)
  const all = extractBoundaries(img, seg, pal)
  const shape = all.regions.find((r) => seg.regionSize[r.region] < (96 * 96) / 2)!
  return loopPointsOf(all.arcs, shape.loops[0])
}

describe('findCorners', () => {
  it('finds 0 corners on a circle', () => {
    expect(findCorners(shapeLoop(insideCircle(48, 48, 30))).length).toBe(0)
  })
  it('finds exactly 4 corners on a rotated square', () => {
    const corners = findCorners(shapeLoop(insideRotSquare(48, 48, 26, 0.3)))
    expect(corners.length).toBe(4)
  })
})

describe('findOpenCorners', () => {
  it('right angle mid-polyline is found, endpoints are not corners', () => {
    const pts: number[] = []
    for (let i = 0; i <= 20; i++) pts.push(i, 0) // along x
    for (let i = 1; i <= 20; i++) pts.push(20, i) // turn 90° at index 20
    const corners = findOpenCorners(new Float64Array(pts))
    expect(corners).toEqual([20])
  })

  it('straight and gently-curved open lines have none', () => {
    const straight: number[] = []
    for (let i = 0; i <= 30; i++) straight.push(i, 0.05 * i)
    expect(findOpenCorners(new Float64Array(straight))).toEqual([])
    const gentle: number[] = []
    for (let i = 0; i <= 40; i++) gentle.push(i, 10 * Math.sin(i / 15))
    expect(findOpenCorners(new Float64Array(gentle))).toEqual([])
  })

  it('a junction-vertex offset near an arc endpoint is not read as a corner', () => {
    // Quarter-circle arc, radius 30, ~60 points. Point 0 stands in for the
    // integer junction vertex, snapped to the nearest lattice point — up to
    // ~0.5px off the smooth refined chain the rest of the arc follows.
    const r = 30
    const count = 60
    const cx = 40.5
    const cy = 40.5
    const pts: number[] = []
    for (let i = 0; i <= count; i++) {
      const theta = (Math.PI / 2) * (i / count)
      pts.push(cx + r * Math.cos(theta), cy + r * Math.sin(theta))
    }
    pts[0] = Math.round(pts[0])
    pts[1] = Math.round(pts[1])
    const corners = findOpenCorners(new Float64Array(pts))
    expect(corners.some((c) => c < 3)).toBe(false)
  })
})
