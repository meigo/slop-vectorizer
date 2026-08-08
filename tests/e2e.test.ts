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

  it('shared boundaries are fitted once: neighbours emit bit-identical reversed cubics', () => {
    // Disc whose right half is overpainted blue: the two half-discs share a straight
    // chord, and each shares a curved semicircular arc with the background. Fitted
    // per-region, those curved arcs would land on different control points from each
    // side (different traversal start and direction) and leave hairline cracks.
    const disc = insideCircle(48, 48, 30)
    const img = renderShape(96, 96, disc, [200, 30, 30], [245, 245, 245])
    for (let y = 0; y < 96; y++)
      for (let x = 48; x < 96; x++)
        if (disc(x + 0.5, y + 0.5)) {
          const o = (y * 96 + x) * 4
          img.data[o] = 30
          img.data[o + 1] = 30
          img.data[o + 2] = 200
        }
    const { svg } = vectorize(img, {
      ...DEFAULT_OPTIONS,
      colorCount: 3,
      mergePaths: false,
      optimize: false,
    })
    const cubics: number[][] = []
    for (const m of svg.matchAll(/d="([^"]*)"/g))
      for (const sub of m[1].split('M').slice(1)) {
        const nums = sub
          .split(/[CZ\s]+/)
          .filter((s) => s.length > 0)
          .map(Number)
        let cx = nums[0],
          cy = nums[1]
        for (let i = 2; i + 5 < nums.length; i += 6) {
          cubics.push([
            cx,
            cy,
            nums[i],
            nums[i + 1],
            nums[i + 2],
            nums[i + 3],
            nums[i + 4],
            nums[i + 5],
          ])
          cx = nums[i + 4]
          cy = nums[i + 5]
        }
      }
    // Orientation-independent key: a shared cubic is traversed in opposite directions
    // by the two regions, so it must match after reversing one of them.
    const counts = new Map<string, number>()
    for (const c of cubics) {
      const fwd = c.join(',')
      const rev = [c[6], c[7], c[4], c[5], c[2], c[3], c[0], c[1]].join(',')
      const k = fwd < rev ? fwd : rev
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2) // no cubic emitted 3+ times
    // Every boundary that does not run along the image edge is shared by two regions,
    // so every cubic with both endpoints strictly inside the frame must be paired.
    const interior = cubics.filter((c) =>
      [0, 6].every((i) => c[i] > 0 && c[i] < 96 && c[i + 1] > 0 && c[i + 1] < 96),
    )
    expect(interior.length).toBeGreaterThan(0)
    for (const c of interior) {
      const fwd = c.join(',')
      const rev = [c[6], c[7], c[4], c[5], c[2], c[3], c[0], c[1]].join(',')
      expect(counts.get(fwd < rev ? fwd : rev)).toBe(2)
    }
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

  it('paletteImage keeps output colors constant across scales', () => {
    // Three-tone artwork whose mid-gray cluster drifts when the palette is
    // re-estimated on resampled pixels; with the ×1 image as palette source,
    // an upscaled run must emit exactly the fills of the ×1 run.
    const base = renderShape(
      120,
      80,
      (x, y) => (y > 20 && y < 28) || (y > 40 && y < 44),
      [30, 30, 30],
      [245, 245, 245],
    )
    // add a gray patch
    for (let y = 55; y < 75; y++)
      for (let x = 20; x < 80; x++) {
        const o = (y * 120 + x) * 4
        base.data[o] = 110
        base.data[o + 1] = 110
        base.data[o + 2] = 110
      }
    // bilinear ×2 (approximates the decode-time upscale)
    const w = 240
    const h = 160
    const up = new Uint8ClampedArray(w * h * 4)
    const src = (x: number, y: number, c: number) =>
      base.data[(Math.min(79, Math.max(0, y)) * 120 + Math.min(119, Math.max(0, x))) * 4 + c]
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const fx = (x + 0.5) / 2 - 0.5
        const fy = (y + 0.5) / 2 - 0.5
        const x0 = Math.floor(fx)
        const y0 = Math.floor(fy)
        const tx = fx - x0
        const ty = fy - y0
        for (let c = 0; c < 3; c++)
          up[(y * w + x) * 4 + c] =
            src(x0, y0, c) * (1 - tx) * (1 - ty) +
            src(x0 + 1, y0, c) * tx * (1 - ty) +
            src(x0, y0 + 1, c) * (1 - tx) * ty +
            src(x0 + 1, y0 + 1, c) * tx * ty
        up[(y * w + x) * 4 + 3] = 255
      }
    const upImg = { width: w, height: h, data: up }
    const opts = { ...DEFAULT_OPTIONS, colorCount: 3 }
    const fills = (s: string) => [...s.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]).sort()
    const at1x = vectorize(base, opts)
    const at2x = vectorize(upImg, opts, undefined, base)
    expect(fills(at2x.svg)).toEqual(fills(at1x.svg))
  })
})
