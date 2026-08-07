import { describe, it, expect } from 'vitest'
import { assembleSvg, polygonArea, type RegionPath } from '../src/worker/pipeline/svg'
import type { Palette } from '../src/types'

describe('svg assembly', () => {
  const palette: Palette = { k: 2, colors: new Uint8ClampedArray([245, 245, 245, 200, 30, 30]) }
  const square: RegionPath = {
    paletteIndex: 1, area: 100,
    loops: [[
      [0, 0, 3, 0, 7, 0, 10, 0], [10, 0, 10, 3, 10, 7, 10, 10],
      [10, 10, 7, 10, 3, 10, 0, 10], [0, 10, 0, 7, 0, 3, 0, 0],
    ]],
  }
  const bg: RegionPath = { paletteIndex: 0, area: 400, loops: [[[0, 0, 20, 0, 20, 0, 20, 20]]] }

  const V1 = { mergePaths: false, transparentBg: false }

  it('emits one path per region, larger areas first, correct fills', () => {
    const svg = assembleSvg([square, bg], palette, 20, 20, V1)
    expect(svg).toContain('viewBox="0 0 20 20"')
    const first = svg.indexOf('#f5f5f5') // bg (area 400) painted first
    const second = svg.indexOf('#c81e1e') // square painted on top
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
    expect(svg).toContain('fill-rule="evenodd"')
    expect(svg.match(/<path/g)!.length).toBe(2)
  })

  it('polygonArea: unit square CW in screen coords', () => {
    expect(Math.abs(polygonArea(new Float64Array([0, 0, 1, 0, 1, 1, 0, 1])))).toBeCloseTo(1)
  })

  it('mergePaths: one path per color, subpaths preserved', () => {
    const square2: RegionPath = { ...square, area: 50 } // second region, same color
    const svg = assembleSvg([square, bg, square2], palette, 20, 20, { ...V1, mergePaths: true })
    expect(svg.match(/<path/g)!.length).toBe(2) // 2 colors, not 3 regions
    // both square regions' subpaths live in the red path's d
    const red = svg.split('\n').find(l => l.includes('#c81e1e'))!
    expect(red.match(/M/g)!.length).toBe(2)
  })

  it('transparentBg drops all background-colored regions', () => {
    const bgPocket: RegionPath = { paletteIndex: 0, area: 5, loops: [[[2, 2, 3, 2, 3, 2, 4, 2]]] }
    const svg = assembleSvg([square, bg, bgPocket], palette, 20, 20, { ...V1, transparentBg: true })
    expect(svg.match(/<path/g)!.length).toBe(1) // only the square survives
    expect(svg).not.toContain('#f5f5f5')
  })

  it('transparentBg with every region background-colored yields empty-bodied svg', () => {
    const svg = assembleSvg([bg], palette, 20, 20, { ...V1, transparentBg: true })
    expect(svg).not.toContain('<path')
    expect(svg).toContain('viewBox="0 0 20 20"')
  })
})
