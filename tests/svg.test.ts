import { describe, it, expect } from 'vitest'
import { assembleSvg, polygonArea, type RegionPath } from '../src/worker/pipeline/svg'
import type { Palette } from '../src/types'
import type { Cubic } from '../src/worker/pipeline/fitcurves'

describe('svg assembly', () => {
  const palette: Palette = { k: 2, colors: new Uint8ClampedArray([245, 245, 245, 200, 30, 30]) }
  const square: RegionPath = {
    paletteIndex: 1,
    area: 100,
    stackOrder: 0,
    loops: [
      [
        [0, 0, 3, 0, 7, 0, 10, 0],
        [10, 0, 10, 3, 10, 7, 10, 10],
        [10, 10, 7, 10, 3, 10, 0, 10],
        [0, 10, 0, 7, 0, 3, 0, 0],
      ],
    ],
  }
  const bg: RegionPath = {
    paletteIndex: 0,
    area: 400,
    stackOrder: 0,
    loops: [[[0, 0, 20, 0, 20, 0, 20, 20]]],
  }

  const V1 = {
    mergePaths: false,
    transparentBg: false,
    optimize: false,
    colorOverrides: null,
    stackedShapes: false,
  }
  const OPT = {
    mergePaths: false,
    transparentBg: false,
    optimize: true,
    colorOverrides: null,
    stackedShapes: false,
  }

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
    const red = svg.split('\n').find((l) => l.includes('#c81e1e'))!
    expect(red.match(/M/g)!.length).toBe(2)
  })

  it('transparentBg drops all background-colored regions', () => {
    const bgPocket: RegionPath = {
      paletteIndex: 0,
      area: 5,
      stackOrder: 0,
      loops: [[[2, 2, 3, 2, 3, 2, 4, 2]]],
    }
    const svg = assembleSvg([square, bg, bgPocket], palette, 20, 20, { ...V1, transparentBg: true })
    expect(svg.match(/<path/g)!.length).toBe(1) // only the square survives
    expect(svg).not.toContain('#f5f5f5')
  })

  it('transparentBg with every region background-colored yields empty-bodied svg', () => {
    const svg = assembleSvg([bg], palette, 20, 20, { ...V1, transparentBg: true })
    expect(svg).not.toContain('<path')
    expect(svg).toContain('viewBox="0 0 20 20"')
  })

  /** Parse an optimized d back to absolute cubic endpoints/controls. */
  function parseCompact(d: string): number[] {
    const abs: number[] = []
    for (const sub of d.split(/M/).filter(Boolean)) {
      const [head, ...cs] = sub.replace(/z$/, '').split('c')
      const nums = (s: string) => s.match(/-?(\d+\.?\d*|\.\d+)/g)!.map(Number)
      let [cx, cy] = nums(head)
      abs.push(cx, cy)
      for (const c of cs) {
        const n = nums(c)
        abs.push(cx + n[0], cy + n[1], cx + n[2], cy + n[3], cx + n[4], cy + n[5])
        cx += n[4]
        cy += n[5]
      }
    }
    return abs
  }

  it('optimize: round-trips to the same coordinates as absolute output', () => {
    const absSvg = assembleSvg([square], palette, 20, 20, { ...OPT, optimize: false })
    const optSvg = assembleSvg([square], palette, 20, 20, OPT)
    const absD = absSvg.match(/d="([^"]*)"/)![1]
    const optD = optSvg.match(/d="([^"]*)"/)![1]
    const absNums = absD.match(/-?(\d+\.?\d*|\.\d+)/g)!.map(Number)
    const optNums = parseCompact(optD)
    expect(optNums.length).toBe(absNums.length)
    optNums.forEach((v, i) => expect(v).toBeCloseTo(absNums[i], 6))
  })

  it('optimize: output is strictly smaller and has compact formatting', () => {
    const absSvg = assembleSvg([square, bg], palette, 20, 20, { ...OPT, optimize: false })
    const optSvg = assembleSvg([square, bg], palette, 20, 20, OPT)
    expect(optSvg.length).toBeLessThan(absSvg.length)
    expect(optSvg).not.toMatch(/ -/) // no space before negatives
    expect(optSvg).not.toMatch(/\d+\.\d*0[" cz]/) // no trailing zeros
  })

  it('colorOverrides replaces exactly the overridden fill', () => {
    const opts = {
      mergePaths: false,
      transparentBg: false,
      optimize: false,
      colorOverrides: [null, '#123456'],
      stackedShapes: false,
    }
    const svg = assembleSvg([square, bg], palette, 20, 20, opts)
    expect(svg).toContain('fill="#123456"') // square (index 1) recolored
    expect(svg).toContain('fill="#f5f5f5"') // bg (index 0) untouched
    expect(svg).not.toContain('#c81e1e')
  })

  it('colorOverrides changes only fills, never geometry', () => {
    const base = {
      mergePaths: true,
      transparentBg: false,
      optimize: true,
      colorOverrides: null,
      stackedShapes: false,
    }
    const a = assembleSvg([square, bg], palette, 20, 20, base)
    const b = assembleSvg([square, bg], palette, 20, 20, {
      ...base,
      colorOverrides: ['#000000', '#ffffff'],
    })
    const paths = (s: string) => [...s.matchAll(/d="([^"]*)"/g)].map((m) => m[1])
    expect(paths(b)).toEqual(paths(a))
  })

  it('short or absent override arrays are no-ops', () => {
    const base = {
      mergePaths: false,
      transparentBg: false,
      optimize: false,
      colorOverrides: null,
      stackedShapes: false,
    }
    const a = assembleSvg([square, bg], palette, 20, 20, base)
    const b = assembleSvg([square, bg], palette, 20, 20, { ...base, colorOverrides: [] })
    expect(b).toBe(a)
  })
})

describe('assembleSvg stacked mode', () => {
  const palette = { k: 2, colors: new Uint8ClampedArray([255, 255, 255, 0, 0, 0]) }
  // one square loop as a Cubic[] (degenerate cubics along straight edges)
  const square = (x0: number, y0: number, s: number): Cubic[] => {
    const pts = [
      [x0, y0],
      [x0 + s, y0],
      [x0 + s, y0 + s],
      [x0, y0 + s],
    ]
    return pts.map((p, i) => {
      const q = pts[(i + 1) % 4]
      return [p[0], p[1], p[0], p[1], q[0], q[1], q[0], q[1]] as Cubic
    })
  }
  const paths: RegionPath[] = [
    { paletteIndex: 1, area: 25, loops: [square(30, 30, 5)], stackOrder: 950 },
    { paletteIndex: 0, area: 100, loops: [square(0, 0, 10)], stackOrder: 0 },
    { paletteIndex: 1, area: 16, loops: [square(10, 10, 4)], stackOrder: 310 },
  ]
  const opts = {
    mergePaths: false,
    transparentBg: false,
    optimize: false,
    colorOverrides: null,
    stackedShapes: true,
  }

  it('paints in ascending stackOrder, not by area', () => {
    const svg = assembleSvg(paths, palette, 40, 40, opts)
    const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1])
    expect(fills).toEqual(['#ffffff', '#000000', '#000000'])
    // area-descending would give the same first element but order 100,25,16 →
    // discriminate via the d attributes: second path must be the stackOrder-310 square
    const ds = [...svg.matchAll(/d="([^"]*)"/g)].map((m) => m[1])
    expect(ds[1]).toContain('M10 10')
    expect(ds[2]).toContain('M30 30')
  })

  it('ignores mergePaths and transparentBg and omits fill-rule', () => {
    const base = assembleSvg(paths, palette, 40, 40, opts)
    const noisy = assembleSvg(paths, palette, 40, 40, {
      ...opts,
      mergePaths: true,
      transparentBg: true,
    })
    expect(noisy).toBe(base)
    expect(base).not.toContain('fill-rule')
  })

  it('flat mode still emits fill-rule and area ordering', () => {
    const svg = assembleSvg(paths, palette, 40, 40, { ...opts, stackedShapes: false })
    expect(svg).toContain('fill-rule="evenodd"')
    const ds = [...svg.matchAll(/d="([^"]*)"/g)].map((m) => m[1])
    expect(ds[0]).toContain('M0 0') // largest area first
  })
})
