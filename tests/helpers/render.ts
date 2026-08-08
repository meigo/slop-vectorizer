import type { RasterImage } from '../../src/types'

export function renderShape(
  width: number,
  height: number,
  inside: (x: number, y: number) => boolean,
  fg: [number, number, number],
  bg: [number, number, number],
  supersample = 8,
): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4)
  const ss = supersample,
    inv = 1 / (ss * ss)
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      let cov = 0
      for (let sj = 0; sj < ss; sj++)
        for (let si = 0; si < ss; si++) if (inside(i + (si + 0.5) / ss, j + (sj + 0.5) / ss)) cov++
      const a = cov * inv,
        o = (j * width + i) * 4
      data[o] = fg[0] * a + bg[0] * (1 - a)
      data[o + 1] = fg[1] * a + bg[1] * (1 - a)
      data[o + 2] = fg[2] * a + bg[2] * (1 - a)
      data[o + 3] = 255
    }
  }
  return { width, height, data }
}

export function insideCircle(cx: number, cy: number, r: number) {
  return (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

/** Thin annulus: stroke width is 2*halfWidth px. */
export function insideRing(cx: number, cy: number, r: number, halfWidth: number) {
  return (x: number, y: number) => Math.abs(Math.hypot(x - cx, y - cy) - r) <= halfWidth
}

export function insideRotSquare(cx: number, cy: number, half: number, angleRad: number) {
  const c = Math.cos(-angleRad),
    s = Math.sin(-angleRad)
  return (x: number, y: number) => {
    const dx = x - cx,
      dy = y - cy
    return Math.abs(dx * c - dy * s) <= half && Math.abs(dx * s + dy * c) <= half
  }
}
