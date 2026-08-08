/**
 * Corner = vertex where the polyline turns sharply at EVERY scale (single-scale
 * reads anti-aliasing jitter as corners). Turning angle measured between the
 * chords to vertices ±s away, for s in SCALES; a vertex is a corner candidate
 * if the minimum deviation over scales exceeds ANGLE_THRESHOLD.
 * Non-maximum suppression keeps one vertex per corner neighborhood.
 */
const SCALES = [2, 4, 8]
const ANGLE_THRESHOLD = (40 * Math.PI) / 180

export function findCorners(loop: Float64Array): number[] {
  const n = loop.length / 2
  if (n < 8) return []
  const px = (i: number) => loop[2 * (((i % n) + n) % n)]
  const py = (i: number) => loop[2 * (((i % n) + n) % n) + 1]
  const deviation = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let minDev = Infinity
    for (const s of SCALES) {
      const step = Math.min(s, Math.floor((n - 1) / 2))
      const ax = px(i) - px(i - step),
        ay = py(i) - py(i - step)
      const bx = px(i + step) - px(i),
        by = py(i + step) - py(i)
      const dot = ax * bx + ay * by,
        cross = ax * by - ay * bx
      minDev = Math.min(minDev, Math.abs(Math.atan2(cross, dot)))
    }
    deviation[i] = minDev
  }
  // Non-maximum suppression over a window of the largest scale
  const win = SCALES[SCALES.length - 1]
  const corners: number[] = []
  for (let i = 0; i < n; i++) {
    if (deviation[i] < ANGLE_THRESHOLD) continue
    let isMax = true
    for (let d = -win; d <= win; d++) {
      if (d === 0) continue
      const j = (((i + d) % n) + n) % n
      if (deviation[j] > deviation[i] || (deviation[j] === deviation[i] && j < i)) {
        isMax = false
        break
      }
    }
    if (isMax) corners.push(i)
  }
  return corners
}

export function findOpenCorners(loop: Float64Array): number[] {
  const n = loop.length / 2
  if (n < 5) return []
  const px = (i: number) => loop[2 * i]
  const py = (i: number) => loop[2 * i + 1]
  const deviation = new Float64Array(n)
  for (let i = 1; i < n - 1; i++) {
    let minDev = Infinity
    for (const s of SCALES) {
      const step = Math.min(s, i, n - 1 - i)
      if (step < 2) continue
      const ax = px(i) - px(i - step),
        ay = py(i) - py(i - step)
      const bx = px(i + step) - px(i),
        by = py(i + step) - py(i)
      const dot = ax * bx + ay * by,
        cross = ax * by - ay * bx
      minDev = Math.min(minDev, Math.abs(Math.atan2(cross, dot)))
    }
    deviation[i] = minDev === Infinity ? 0 : minDev
  }
  const win = SCALES[SCALES.length - 1]
  const corners: number[] = []
  for (let i = 1; i < n - 1; i++) {
    if (deviation[i] < ANGLE_THRESHOLD) continue
    let isMax = true
    for (let d = -win; d <= win; d++) {
      if (d === 0) continue
      const j = i + d
      if (j < 1 || j > n - 2) continue
      if (deviation[j] > deviation[i] || (deviation[j] === deviation[i] && j < i)) {
        isMax = false
        break
      }
    }
    if (isMax) corners.push(i)
  }
  return corners
}
