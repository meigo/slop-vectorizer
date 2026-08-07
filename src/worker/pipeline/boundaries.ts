import type { RasterImage, Palette, Segmentation, RegionLoops } from '../../types'

// Directed boundary edges on the integer lattice, region kept on the LEFT while walking.
// Vertex ids: v = y * (w+1) + x for lattice point (x, y).

export function extractBoundaries(image: RasterImage, seg: Segmentation, palette: Palette): RegionLoops[] {
  const { width: w, height: h } = image
  const { labelMap } = seg
  const lab = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h) ? -1 : labelMap[y * w + x]

  // --- Sub-pixel refinement, cached per undirected pixel-edge ---
  const refined = new Map<string, [number, number]>()
  const orig = (x: number, y: number, c: number) => image.data[(y * w + x) * 4 + c]
  /** Fraction of pixel (x,y)'s original color explained by palette color ci vs cj. */
  const coverage = (x: number, y: number, ci: number, cj: number): number => {
    const ax = palette.colors[3 * ci] - palette.colors[3 * cj]
    const ay = palette.colors[3 * ci + 1] - palette.colors[3 * cj + 1]
    const az = palette.colors[3 * ci + 2] - palette.colors[3 * cj + 2]
    const len2 = ax * ax + ay * ay + az * az
    if (len2 === 0) return 0.5
    const dx = orig(x, y, 0) - palette.colors[3 * cj]
    const dy = orig(x, y, 1) - palette.colors[3 * cj + 1]
    const dz = orig(x, y, 2) - palette.colors[3 * cj + 2]
    return Math.max(0, Math.min(1, (dx * ax + dy * ay + dz * az) / len2))
  }
  /**
   * Refined midpoint of the boundary edge between 4-adjacent pixels a=(ax,ay), b=(bx,by).
   * Model: centers at t=0 (a) and t=1 (b); pixel border at t=0.5. Both pixels are read,
   * because on a slanted edge both are partially covered:
   *   t = fa + fb - 0.5
   * Axis-aligned edge inside a: fb = 0 -> t = fa - 0.5. Inside b: fa = 1 -> t = fb + 0.5.
   * For any straight edge crossing the 1x2 box of the two pixels without leaving it
   * sideways, fa + fb is exactly the edge's position along the a->b axis measured from
   * a's far border, so the formula is exact for arbitrary edge slope, not just 0/90 deg.
   */
  const refineEdge = (ax: number, ay: number, bx: number, by: number): [number, number] => {
    const k = ax < bx || (ax === bx && ay < by) ? `${ax},${ay},${bx},${by}` : `${bx},${by},${ax},${ay}`
    const hit = refined.get(k)
    if (hit) return hit
    const mx = (ax + bx + 1) / 2, my = (ay + by + 1) / 2 // midpoint of the two pixel centers
    let out: [number, number] = [mx, my]
    const ra = lab(ax, ay), rb = lab(bx, by)
    if (ra >= 0 && rb >= 0) {
      const ca = seg.regionColor[ra], cb = seg.regionColor[rb]
      const fa = coverage(ax, ay, ca, cb) // fraction of A-color in pixel a
      const fb = coverage(bx, by, ca, cb) // fraction of A-color in pixel b
      const t = Math.max(-0.5, Math.min(1.5, fa + fb - 0.5))
      out = [mx + (bx - ax) * (t - 0.5), my + (by - ay) * (t - 0.5)]
    }
    refined.set(k, out)
    return out
  }

  // --- Collect directed edges per region ---
  const V = (x: number, y: number) => y * (w + 1) + x
  const perRegion = new Map<number, Map<number, number[]>>() // region -> startVertex -> endVertices
  const addEdge = (region: number, x0: number, y0: number, x1: number, y1: number) => {
    if (region < 0) return
    let m = perRegion.get(region)
    if (!m) { m = new Map(); perRegion.set(region, m) }
    const s = V(x0, y0)
    let ends = m.get(s)
    if (!ends) { ends = []; m.set(s, ends) }
    ends.push(V(x1, y1))
  }
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x < w; x++) { // horizontal edges (x,y)-(x+1,y): pixels (x,y-1) above, (x,y) below
      const above = lab(x, y - 1), below = lab(x, y)
      if (above === below) continue
      addEdge(above, x, y, x + 1, y)      // dir +x keeps 'above' on left
      addEdge(below, x + 1, y, x, y)      // dir -x keeps 'below' on left
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x <= w; x++) { // vertical edges (x,y)-(x,y+1): pixels (x-1,y) left, (x,y) right
      const left = lab(x - 1, y), right = lab(x, y)
      if (left === right) continue
      addEdge(right, x, y, x, y + 1)      // dir +y keeps 'right' pixel on left side of travel
      addEdge(left, x, y + 1, x, y)       // dir -y keeps 'left' pixel on left side of travel
    }
  }

  // --- Chain directed edges into loops; at 4-way junctions prefer the sharpest left turn ---
  // A vertex is ambiguous only where a region touches itself diagonally. Regions are
  // 4-connected, so the two opposite quadrants of the *other* colour there belong to
  // separate regions and have no choice but to hug their own quadrant; this region must
  // therefore pass straight through the vertex, which is what preferring the left turn does.
  // Hugging instead (sharpest right) would make the two sides' outlines cross.
  const results: RegionLoops[] = []
  for (const [region, edges] of perRegion) {
    const loops: Float64Array[] = []
    for (const [start, ends] of edges) {
      while (ends.length > 0) {
        const verts: number[] = [start]
        let prev = start, cur = ends.pop()!
        while (cur !== start) {
          verts.push(cur)
          const outs = edges.get(cur)
          if (!outs || outs.length === 0) throw new Error('boundaries: open chain (bug)')
          let pick = 0
          if (outs.length > 1) { // junction: pick sharpest left turn relative to incoming direction
            const dx = (cur % (w + 1)) - (prev % (w + 1)), dy = ((cur / (w + 1)) | 0) - ((prev / (w + 1)) | 0)
            let bestScore = -Infinity
            outs.forEach((o, i) => {
              const ox = (o % (w + 1)) - (cur % (w + 1)), oy = ((o / (w + 1)) | 0) - ((cur / (w + 1)) | 0)
              const cross = dx * oy - dy * ox, dot = dx * ox + dy * oy
              const score = cross > 0 ? 2 : dot > 0 ? 1 : cross < 0 ? 0 : -1 // left > straight > right > back
              if (score > bestScore) { bestScore = score; pick = i }
            })
          }
          prev = cur
          cur = outs.splice(pick, 1)[0]
        }
        // Convert lattice-vertex loop -> refined midpoints of consecutive edges
        const pts: number[] = []
        for (let i = 0; i < verts.length; i++) {
          const a = verts[i], b = verts[(i + 1) % verts.length]
          const axv = a % (w + 1), ayv = (a / (w + 1)) | 0
          const bxv = b % (w + 1), byv = (b / (w + 1)) | 0
          // The two pixels flanking this lattice edge:
          let p: [number, number], q: [number, number]
          if (ayv === byv) { // horizontal edge: pixels above/below
            const ex = Math.min(axv, bxv)
            p = [ex, ayv - 1]; q = [ex, ayv]
          } else {           // vertical edge: pixels left/right
            const ey = Math.min(ayv, byv)
            p = [axv - 1, ey]; q = [axv, ey]
          }
          const inImg = (px: number, py: number) => px >= 0 && py >= 0 && px < w && py < h
          if (inImg(...p) && inImg(...q)) pts.push(...refineEdge(p[0], p[1], q[0], q[1]))
          else pts.push((axv + bxv) / 2, (ayv + byv) / 2) // image border: keep lattice midpoint
        }
        loops.push(new Float64Array(pts))
      }
    }
    results.push({ region, loops })
  }
  return results
}
