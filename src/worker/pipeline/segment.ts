import type { RasterImage, Palette, Segmentation } from '../../types'

function nearestPaletteIndex(pal: Palette, r: number, g: number, b: number): number {
  let best = 0, bestD = Infinity
  for (let c = 0; c < pal.k; c++) {
    const dr = r - pal.colors[3 * c], dg = g - pal.colors[3 * c + 1], db = b - pal.colors[3 * c + 2]
    const d = dr * dr + dg * dg + db * db
    if (d < bestD) { bestD = d; best = c }
  }
  return best
}

export function segmentImage(image: RasterImage, palette: Palette, despeckleSize: number): Segmentation {
  const { width: w, height: h, data } = image
  const n = w * h
  const colorIdx = new Int32Array(n)
  for (let p = 0; p < n; p++)
    colorIdx[p] = nearestPaletteIndex(palette, data[4 * p], data[4 * p + 1], data[4 * p + 2])

  // Connected components (4-connectivity) over colorIdx
  const label = new Int32Array(n).fill(-1)
  const sizes: number[] = [], colors: number[] = []
  const stack = new Int32Array(n)
  let regionCount = 0
  for (let p = 0; p < n; p++) {
    if (label[p] !== -1) continue
    const id = regionCount++, c = colorIdx[p]
    let top = 0, size = 0
    stack[top++] = p; label[p] = id
    while (top > 0) {
      const q = stack[--top]; size++
      const x = q % w, y = (q / w) | 0
      if (x > 0 && label[q - 1] === -1 && colorIdx[q - 1] === c) { label[q - 1] = id; stack[top++] = q - 1 }
      if (x < w - 1 && label[q + 1] === -1 && colorIdx[q + 1] === c) { label[q + 1] = id; stack[top++] = q + 1 }
      if (y > 0 && label[q - w] === -1 && colorIdx[q - w] === c) { label[q - w] = id; stack[top++] = q - w }
      if (y < h - 1 && label[q + w] === -1 && colorIdx[q + w] === c) { label[q + w] = id; stack[top++] = q + w }
    }
    sizes.push(size); colors.push(c)
  }

  // Despeckle: repeatedly absorb small regions into the neighbor sharing the longest border
  const alias = new Int32Array(regionCount)
  for (let i = 0; i < regionCount; i++) alias[i] = i
  const find = (i: number): number => { while (alias[i] !== i) { alias[i] = alias[alias[i]]; i = alias[i] } return i }
  for (let pass = 0; pass < 8; pass++) {
    let changed = false
    const border = new Map<string, number>() // "small,neighbor" -> shared edge count
    for (let p = 0; p < n; p++) {
      const a = find(label[p]), x = p % w
      const consider = (q: number) => {
        const b = find(label[q])
        if (a === b) return
        for (const [s, o] of [[a, b], [b, a]] as const)
          if (sizes[s] < despeckleSize) {
            const key = s + ',' + o
            border.set(key, (border.get(key) ?? 0) + 1)
          }
      }
      if (x < w - 1) consider(p + 1)
      if (p + w < n) consider(p + w)
    }
    const bestTarget = new Map<number, [number, number]>() // small -> [neighbor, count]
    for (const [key, count] of border) {
      const [s, o] = key.split(',').map(Number)
      const cur = bestTarget.get(s)
      if (!cur || count > cur[1]) bestTarget.set(s, [o, count])
    }
    for (const [s, [o]] of bestTarget) {
      const rs = find(s), ro = find(o)
      if (rs === ro || sizes[rs] >= despeckleSize) continue
      alias[rs] = ro; sizes[ro] += sizes[rs]; changed = true
    }
    if (!changed) break
  }

  // Compact region ids
  const remap = new Int32Array(regionCount).fill(-1)
  let compactCount = 0
  for (let i = 0; i < regionCount; i++) if (find(i) === i) remap[i] = compactCount++
  const labelMap = new Int32Array(n)
  const regionColor = new Int32Array(compactCount)
  const regionSize = new Int32Array(compactCount)
  for (let p = 0; p < n; p++) {
    const r = remap[find(label[p])]
    labelMap[p] = r
    regionSize[r]++
  }
  for (let i = 0; i < regionCount; i++) if (remap[find(i)] !== -1) regionColor[remap[find(i)]] = colors[find(i)]
  return { labelMap, regionColor, regionSize, regionCount: compactCount }
}
