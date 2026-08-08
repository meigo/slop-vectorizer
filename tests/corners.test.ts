import { describe, it, expect } from 'vitest'
import { estimatePalette } from '../src/worker/pipeline/palette'
import { segmentImage } from '../src/worker/pipeline/segment'
import { extractBoundaries } from '../src/worker/pipeline/boundaries'
import { findCorners } from '../src/worker/pipeline/corners'
import { renderShape, insideCircle, insideRotSquare } from './helpers/render'

function shapeLoop(inside: (x: number, y: number) => boolean): Float64Array {
  const img = renderShape(96, 96, inside, [200, 30, 30], [245, 245, 245])
  const pal = estimatePalette(img, 2)
  const seg = segmentImage(img, pal, 4)
  const all = extractBoundaries(img, seg, pal)
  const shape = all.find((r) => seg.regionSize[r.region] < (96 * 96) / 2)!
  return shape.loops[0]
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
