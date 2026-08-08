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
const TOL_SQ = 20 * 20 // Euclidean RGB tolerance, matches perceptual "same color, re-estimated"

export function remapOverrides(
  oldPalette: number[],
  newPalette: number[],
  overrides: (string | null)[],
): (string | null)[] | null {
  const kNew = newPalette.length / 3
  const best = new Map<number, { distSq: number; hex: string }>()
  for (let i = 0; i < overrides.length; i++) {
    const hex = overrides[i]
    if (!hex || 3 * i + 2 >= oldPalette.length) continue
    let bestJ = -1
    let bestD = Infinity
    for (let j = 0; j < kNew; j++) {
      const dr = oldPalette[3 * i] - newPalette[3 * j]
      const dg = oldPalette[3 * i + 1] - newPalette[3 * j + 1]
      const db = oldPalette[3 * i + 2] - newPalette[3 * j + 2]
      const d = dr * dr + dg * dg + db * db
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
