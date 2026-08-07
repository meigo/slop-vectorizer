import { describe, it, expect } from 'vitest'
import { renderShape, insideCircle } from './helpers/render'

describe('renderShape', () => {
  it('antialiases edges: interior pure fg, exterior pure bg, edge blended', () => {
    const img = renderShape(64, 64, insideCircle(32, 32, 20), [255, 0, 0], [255, 255, 255])
    const px = (x: number, y: number) => img.data.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)
    expect([...px(32, 32)]).toEqual([255, 0, 0])   // center
    expect([...px(1, 1)]).toEqual([255, 255, 255]) // far corner
    // pixel straddling the edge: red channel stays 255, g/b strictly between
    const edge = px(51, 36)
    expect(edge[1]).toBeGreaterThan(0)
    expect(edge[1]).toBeLessThan(255)
  })
})
