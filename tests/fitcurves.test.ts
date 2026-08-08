// tests/fitcurves.test.ts
import { describe, it, expect } from 'vitest'
import { fitLoop, type Cubic } from '../src/worker/pipeline/fitcurves'

function circleLoop(cx: number, cy: number, r: number, n = 200): Float64Array {
  const pts = new Float64Array(n * 2)
  for (let i = 0; i < n; i++) {
    pts[2 * i] = cx + r * Math.cos((2 * Math.PI * i) / n)
    pts[2 * i + 1] = cy + r * Math.sin((2 * Math.PI * i) / n)
  }
  return pts
}

const evalCubic = (c: Cubic, t: number): [number, number] => {
  const u = 1 - t
  return [
    u * u * u * c[0] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6],
    u * u * u * c[1] + 3 * u * u * t * c[3] + 3 * u * t * t * c[5] + t * t * t * c[7],
  ]
}

describe('fitLoop', () => {
  it('fits a circle with few segments, all within tolerance of the true radius', () => {
    const cubics = fitLoop(circleLoop(50, 50, 30), [], 0.5)
    expect(cubics.length).toBeLessThanOrEqual(8)
    for (const c of cubics)
      for (let t = 0; t <= 1; t += 0.1) {
        const [x, y] = evalCubic(c, t)
        expect(Math.abs(Math.hypot(x - 50, y - 50) - 30)).toBeLessThan(0.5)
      }
  })

  it('cubics chain: each ends where the next starts, loop closes', () => {
    const cubics = fitLoop(circleLoop(50, 50, 30), [], 0.5)
    for (let i = 0; i < cubics.length; i++) {
      const next = cubics[(i + 1) % cubics.length]
      expect(cubics[i][6]).toBeCloseTo(next[0], 9)
      expect(cubics[i][7]).toBeCloseTo(next[1], 9)
    }
  })

  it('respects corners: square with 4 corners yields exactly 4 segments', () => {
    const sq: number[] = []
    for (let s = 0; s < 4; s++)
      for (let i = 0; i < 25; i++) {
        const t = i / 25
        const corners4 = [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
        ]
        const [x0, y0] = corners4[s],
          [x1, y1] = corners4[(s + 1) % 4]
        sq.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
      }
    const cubics = fitLoop(new Float64Array(sq), [0, 25, 50, 75], 0.5)
    expect(cubics.length).toBe(4)
  })
})

describe('control point blowup regression', () => {
  const contained = (loop: Float64Array, tol: number, factor: number) => {
    const n = loop.length / 2
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, loop[2 * i])
      maxX = Math.max(maxX, loop[2 * i])
      minY = Math.min(minY, loop[2 * i + 1])
      maxY = Math.max(maxY, loop[2 * i + 1])
    }
    const diam = Math.max(maxX - minX, maxY - minY, 0.5)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    for (const c of fitLoop(loop, [], tol))
      for (let k = 0; k < 8; k += 2)
        expect(Math.hypot(c[k] - cx, c[k + 1] - cy)).toBeLessThan(diam * factor)
  }

  it('4-point speck (fuzz worst case: 1.28M× blowup) stays contained', () => {
    contained(new Float64Array([0.12, 1.34, 1.92, 0.4, 0.07, 1.51, 1.15, 2.56]), 1.0, 10)
  })

  it('thin sliver specks stay contained', () => {
    contained(
      new Float64Array([
        2.41, 0.23, 2.94, 0.25, 0.19, 0.44, 0.95, 0.34, 2.87, 0.45, 2.51, 0.06, 1.01, 0.3,
      ]),
      0.25,
      10,
    )
    contained(
      new Float64Array([2.75, 0.41, 0.19, 0.29, 2.82, 0.37, 1.25, 0.34, 0.58, 0.09]),
      2.0,
      10,
    )
  })
})
