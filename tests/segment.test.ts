import { describe, it, expect } from 'vitest'
import { estimatePalette } from '../src/worker/pipeline/palette'
import { segmentImage } from '../src/worker/pipeline/segment'
import { renderShape, insideCircle } from './helpers/render'

describe('segmentImage', () => {
  const img = renderShape(64, 64, insideCircle(32, 32, 20), [200, 30, 30], [245, 245, 245])
  const pal = estimatePalette(img, 2)

  it('produces exactly two regions for circle-on-background', () => {
    const seg = segmentImage(img, pal, 4)
    expect(seg.regionCount).toBe(2)
  })

  it('despeckle removes single-pixel noise', () => {
    const noisy = renderShape(64, 64, insideCircle(32, 32, 20), [200, 30, 30], [245, 245, 245])
    noisy.data.set([200, 30, 30, 255], (5 * 64 + 5) * 4) // lone fg pixel in bg
    const seg = segmentImage(noisy, pal, 4)
    expect(seg.regionCount).toBe(2)
    expect(seg.labelMap[5 * 64 + 5]).toBe(seg.labelMap[0]) // absorbed into background
  })

  it('region sizes sum to pixel count', () => {
    const seg = segmentImage(img, pal, 4)
    expect([...seg.regionSize].reduce((a, b) => a + b, 0)).toBe(64 * 64)
  })
})
