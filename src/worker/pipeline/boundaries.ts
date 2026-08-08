import type {
  RasterImage,
  Palette,
  Segmentation,
  Boundaries,
  BoundaryArc,
  ArcRef,
  RegionArcs,
} from '../../types'

// Directed boundary edges on the integer lattice, region kept on the LEFT while walking.
// Vertex ids: v = y * (w+1) + x for lattice point (x, y).

export function extractBoundaries(
  image: RasterImage,
  seg: Segmentation,
  palette: Palette,
): Boundaries {
  const { width: w, height: h } = image
  const { labelMap } = seg
  const lab = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? -1 : labelMap[y * w + x]

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
    const k =
      ax < bx || (ax === bx && ay < by) ? `${ax},${ay},${bx},${by}` : `${bx},${by},${ax},${ay}`
    const hit = refined.get(k)
    if (hit) return hit
    const mx = (ax + bx + 1) / 2,
      my = (ay + by + 1) / 2 // midpoint of the two pixel centers
    let out: [number, number] = [mx, my]
    const ra = lab(ax, ay),
      rb = lab(bx, by)
    if (ra >= 0 && rb >= 0) {
      const ca = seg.regionColor[ra],
        cb = seg.regionColor[rb]
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
    if (!m) {
      m = new Map()
      perRegion.set(region, m)
    }
    const s = V(x0, y0)
    let ends = m.get(s)
    if (!ends) {
      ends = []
      m.set(s, ends)
    }
    ends.push(V(x1, y1))
  }
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x < w; x++) {
      // horizontal edges (x,y)-(x+1,y): pixels (x,y-1) above, (x,y) below
      const above = lab(x, y - 1),
        below = lab(x, y)
      if (above === below) continue
      addEdge(above, x, y, x + 1, y) // dir +x keeps 'above' on left
      addEdge(below, x + 1, y, x, y) // dir -x keeps 'below' on left
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x <= w; x++) {
      // vertical edges (x,y)-(x,y+1): pixels (x-1,y) left, (x,y) right
      const left = lab(x - 1, y),
        right = lab(x, y)
      if (left === right) continue
      addEdge(right, x, y, x, y + 1) // dir +y keeps 'right' pixel on left side of travel
      addEdge(left, x, y + 1, x, y) // dir -y keeps 'left' pixel on left side of travel
    }
  }

  // --- Chain directed edges into loops; at 4-way junctions prefer the sharpest left turn ---
  // A vertex is ambiguous only where a region touches itself diagonally. Regions are
  // 4-connected, so the two opposite quadrants of the *other* colour there belong to
  // separate regions and have no choice but to hug their own quadrant; this region must
  // therefore pass straight through the vertex, which is what preferring the left turn does.
  // Hugging instead (sharpest right) would make the two sides' outlines cross.
  //
  // Each loop is then cut at its junction vertices (where the neighbouring region
  // changes) into arcs. A junction is a property of the lattice vertex, not of the
  // region reading it: at a vertex of degree 2, or of degree 4 where two quadrants
  // share a region, every incident pass keeps the same neighbour across it; at
  // degree 3, or degree 4 with four distinct regions, every incident pass changes
  // neighbour. So both sides of a shared boundary cut it at the same vertices, the
  // arcs partition the undirected boundary edges, and an arc's minimum edge id
  // identifies it from either side.
  const arcs: BoundaryArc[] = []
  const arcByKey = new Map<number, number>() // min edge id -> arc index
  const vertX = (v: number) => v % (w + 1)
  const vertY = (v: number) => (v / (w + 1)) | 0
  /** Store the arc under its identity, or reference the copy the other side stored. */
  const emit = (minEdge: number, points: Float64Array, closed: boolean): ArcRef => {
    const existing = arcByKey.get(minEdge)
    if (existing === undefined) {
      const idx = arcs.push({ points, closed }) - 1
      arcByKey.set(minEdge, idx)
      return { arc: idx, reversed: false }
    }
    if (arcs[existing].points.length !== points.length || arcs[existing].closed !== closed)
      throw new Error('boundaries: shared arc split differently by its two sides (bug)')
    return { arc: existing, reversed: true }
  }

  const results: RegionArcs[] = []
  for (const [region, edges] of perRegion) {
    const loops: ArcRef[][] = []
    for (const [start, ends] of edges) {
      while (ends.length > 0) {
        const verts: number[] = [start]
        let prev = start,
          cur = ends.pop()!
        while (cur !== start) {
          verts.push(cur)
          const outs = edges.get(cur)
          if (!outs || outs.length === 0) throw new Error('boundaries: open chain (bug)')
          let pick = 0
          if (outs.length > 1) {
            // junction: pick sharpest left turn relative to incoming direction
            const dx = (cur % (w + 1)) - (prev % (w + 1)),
              dy = ((cur / (w + 1)) | 0) - ((prev / (w + 1)) | 0)
            let bestScore = -Infinity
            outs.forEach((o, i) => {
              const ox = (o % (w + 1)) - (cur % (w + 1)),
                oy = ((o / (w + 1)) | 0) - ((cur / (w + 1)) | 0)
              const cross = dx * oy - dy * ox,
                dot = dx * ox + dy * oy
              const score = cross > 0 ? 2 : dot > 0 ? 1 : cross < 0 ? 0 : -1 // left > straight > right > back
              if (score > bestScore) {
                bestScore = score
                pick = i
              }
            })
          }
          prev = cur
          cur = outs.splice(pick, 1)[0]
        }
        // Per lattice edge of the loop: neighbouring region, undirected edge id, refined midpoint
        const m = verts.length
        const nbr = new Int32Array(m)
        const eid = new Int32Array(m)
        const mid = new Float64Array(2 * m)
        for (let i = 0; i < m; i++) {
          const a = verts[i],
            b = verts[(i + 1) % m]
          const axv = vertX(a),
            ayv = vertY(a)
          const bxv = vertX(b),
            byv = vertY(b)
          // The two pixels flanking this lattice edge:
          let p: [number, number], q: [number, number], id: number
          if (ayv === byv) {
            // horizontal edge: pixels above/below
            const ex = Math.min(axv, bxv)
            p = [ex, ayv - 1]
            q = [ex, ayv]
            id = V(ex, ayv) * 2
          } else {
            // vertical edge: pixels left/right
            const ey = Math.min(ayv, byv)
            p = [axv - 1, ey]
            q = [axv, ey]
            id = V(axv, ey) * 2 + 1
          }
          const lp = lab(...p),
            lq = lab(...q)
          nbr[i] = lp === region ? lq : lp
          eid[i] = id
          const inImg = (px: number, py: number) => px >= 0 && py >= 0 && px < w && py < h
          if (inImg(...p) && inImg(...q)) {
            const [rx, ry] = refineEdge(p[0], p[1], q[0], q[1])
            mid[2 * i] = rx
            mid[2 * i + 1] = ry
          } else {
            mid[2 * i] = (axv + bxv) / 2 // image border: keep lattice midpoint
            mid[2 * i + 1] = (ayv + byv) / 2
          }
        }
        // Cut the loop into arcs at the vertices where the neighbouring region changes
        let startI = -1
        for (let i = 0; i < m; i++)
          if (nbr[i] !== nbr[(i - 1 + m) % m]) {
            startI = i
            break
          }
        const loopRefs: ArcRef[] = []
        if (startI < 0) {
          // one neighbour all the way round: a single closed arc, no junction points
          let minE = Infinity
          for (let i = 0; i < m; i++) minE = Math.min(minE, eid[i])
          loopRefs.push(emit(minE, mid.slice(), true))
        } else {
          let i = startI
          do {
            const runNbr = nbr[i]
            const pts: number[] = [vertX(verts[i]), vertY(verts[i])] // start junction
            let minE = Infinity
            let j = i
            do {
              pts.push(mid[2 * j], mid[2 * j + 1])
              minE = Math.min(minE, eid[j])
              j = (j + 1) % m
            } while (nbr[j] === runNbr && j !== startI)
            pts.push(vertX(verts[j]), vertY(verts[j])) // end junction
            loopRefs.push(emit(minE, new Float64Array(pts), false))
            i = j
          } while (i !== startI)
        }
        loops.push(loopRefs)
      }
    }
    results.push({ region, loops })
  }
  return { arcs, regions: results }
}

function reversePts(p: Float64Array): Float64Array {
  const n = p.length / 2
  const out = new Float64Array(p.length)
  for (let i = 0; i < n; i++) {
    out[2 * i] = p[2 * (n - 1 - i)]
    out[2 * i + 1] = p[2 * (n - 1 - i) + 1]
  }
  return out
}

/**
 * Reassemble one loop's raw polyline from its arcs, in this region's traversal
 * direction. Each arc contributes everything but its first point: that start junction
 * is the previous arc's end junction, and the loop's opening junction comes from the
 * last arc's end. So every junction appears exactly once and the loop has no
 * duplicated closing point.
 */
export function loopPointsOf(arcs: BoundaryArc[], loop: ArcRef[]): Float64Array {
  if (loop.length === 1 && arcs[loop[0].arc].closed) {
    const p = arcs[loop[0].arc].points
    return loop[0].reversed ? reversePts(p) : p.slice()
  }
  const out: number[] = []
  for (const ref of loop) {
    const p = arcs[ref.arc].points
    const pts = ref.reversed ? reversePts(p) : p
    for (let i = 2; i < pts.length; i += 2) out.push(pts[i], pts[i + 1])
  }
  return new Float64Array(out)
}
