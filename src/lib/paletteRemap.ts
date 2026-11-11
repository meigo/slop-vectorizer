/**
 * Migrate color overrides from an old palette to a new one by nearest-color
 * matching. Overrides are index-aligned with the palette they were made for;
 * re-estimation can wobble colors, reorder entries, or change k entirely
 * (auto-k is scale-sensitive: texture noise at 1x can split a cluster that
 * re-merges after upscaling smooths it). Matching by color instead of index
 * survives all three. An override drops only when its old color has no new
 * palette entry within tolerance; when two old colors compete for the same
 * new entry, the closer one wins.
 *
 * Returns the new index-aligned override array, or null when nothing survives.
 */
const TOL_SQ = 20 * 20 // Euclidean RGBA tolerance, matches perceptual "same color, re-estimated"

/** Squared distance between entry i of `a` and entry j of `b` (straight RGBA, 4 per entry). Alpha
 *  counts: the bands of one blurred colour share their RGB and differ only in it. */
function distSq(a: number[], i: number, b: number[], j: number): number {
  let s = 0
  for (let d = 0; d < 4; d++) s += (a[4 * i + d] - b[4 * j + d]) ** 2
  return s
}

export function remapOverrides(
  oldPalette: number[],
  newPalette: number[],
  overrides: (string | null)[],
): (string | null)[] | null {
  const kNew = newPalette.length / 4
  const best = new Map<number, { distSq: number; hex: string }>()
  for (let i = 0; i < overrides.length; i++) {
    const hex = overrides[i]
    if (!hex || 4 * i + 3 >= oldPalette.length) continue
    let bestJ = -1
    let bestD = Infinity
    for (let j = 0; j < kNew; j++) {
      const d = distSq(oldPalette, i, newPalette, j)
      if (d < bestD) {
        bestD = d
        bestJ = j
      }
    }
    if (bestJ < 0 || bestD > TOL_SQ) continue
    const cur = best.get(bestJ)
    if (!cur || bestD < cur.distSq) best.set(bestJ, { distSq: bestD, hex })
  }
  if (best.size === 0) return null
  const out: (string | null)[] = Array(kNew).fill(null)
  for (const [j, v] of best) out[j] = v.hex
  return out
}

/**
 * For two palettes of the same size: old index → new index, as the one-to-one pairing with the
 * least total colour distance (Hungarian method; k ≤ 16). Pre-effects can move every colour far
 * (levels) or reorder the luminance-sorted palette (saturation pivots on a different luma than
 * the sort), so neither "same index" nor "nearest colour" alone follows them.
 */
export function matchPalettes(oldPalette: number[], newPalette: number[]): number[] {
  const n = oldPalette.length / 4
  const cost = (i: number, j: number) => Math.sqrt(distSq(oldPalette, i, newPalette, j))
  // 1-based potentials u (rows), v (columns); p[j] = row matched to column j
  const u = new Float64Array(n + 1),
    v = new Float64Array(n + 1)
  const p = new Int32Array(n + 1),
    way = new Int32Array(n + 1)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Float64Array(n + 1).fill(Infinity)
    const used = new Uint8Array(n + 1)
    do {
      used[j0] = 1
      const i0 = p[j0]
      let delta = Infinity,
        j1 = 0
      for (let j = 1; j <= n; j++)
        if (!used[j]) {
          const cur = cost(i0 - 1, j - 1) - u[i0] - v[j]
          if (cur < minv[j]) {
            minv[j] = cur
            way[j] = j0
          }
          if (minv[j] < delta) {
            delta = minv[j]
            j1 = j
          }
        }
      for (let j = 0; j <= n; j++)
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else minv[j] -= delta
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0)
  }
  const out = new Array<number>(n)
  for (let j = 1; j <= n; j++) out[p[j] - 1] = j - 1
  return out
}

/** Overrides moved to the new indices `matchPalettes` gave. */
export function permuteOverrides(overrides: (string | null)[], map: number[]): (string | null)[] {
  const out: (string | null)[] = Array(map.length).fill(null)
  overrides.forEach((hex, i) => {
    if (i < map.length) out[map[i]] = hex
  })
  return out
}
