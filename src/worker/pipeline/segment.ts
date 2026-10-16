import type { RasterImage, Palette, Segmentation } from '../../types'

function nearestPaletteIndex(pal: Palette, r: number, g: number, b: number): number {
  let best = 0,
    bestD = Infinity
  for (let c = 0; c < pal.k; c++) {
    const dr = r - pal.colors[3 * c],
      dg = g - pal.colors[3 * c + 1],
      db = b - pal.colors[3 * c + 2]
    const d = dr * dr + dg * dg + db * db
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

export function segmentImage(
  image: RasterImage,
  palette: Palette,
  despeckleSize: number,
  gapClosing = 0,
): Segmentation {
  const { width: w, height: h, data } = image
  const n = w * h
  const colorIdx = new Int32Array(n)
  for (let p = 0; p < n; p++)
    colorIdx[p] = nearestPaletteIndex(palette, data[4 * p], data[4 * p + 1], data[4 * p + 2])

  // Ceiling 9 = max slider (3) × max scale (3); the UI scales the slider with scale.
  if (gapClosing > 0) closeGaps(colorIdx, image, palette, Math.min(9, Math.round(gapClosing)))

  // Connected components (4-connectivity) over colorIdx
  const label = new Int32Array(n).fill(-1)
  const sizes: number[] = [],
    colors: number[] = []
  const stack = new Int32Array(n)
  let regionCount = 0
  for (let p = 0; p < n; p++) {
    if (label[p] !== -1) continue
    const id = regionCount++,
      c = colorIdx[p]
    let top = 0,
      size = 0
    stack[top++] = p
    label[p] = id
    while (top > 0) {
      const q = stack[--top]
      size++
      const x = q % w,
        y = (q / w) | 0
      if (x > 0 && label[q - 1] === -1 && colorIdx[q - 1] === c) {
        label[q - 1] = id
        stack[top++] = q - 1
      }
      if (x < w - 1 && label[q + 1] === -1 && colorIdx[q + 1] === c) {
        label[q + 1] = id
        stack[top++] = q + 1
      }
      if (y > 0 && label[q - w] === -1 && colorIdx[q - w] === c) {
        label[q - w] = id
        stack[top++] = q - w
      }
      if (y < h - 1 && label[q + w] === -1 && colorIdx[q + w] === c) {
        label[q + w] = id
        stack[top++] = q + w
      }
    }
    sizes.push(size)
    colors.push(c)
  }

  // Despeckle: repeatedly absorb small regions into the neighbor sharing the longest border
  const alias = new Int32Array(regionCount)
  for (let i = 0; i < regionCount; i++) alias[i] = i
  const find = (i: number): number => {
    while (alias[i] !== i) {
      alias[i] = alias[alias[i]]
      i = alias[i]
    }
    return i
  }
  // Borders are counted per small region from its own pixels, not in one map of every
  // (small, neighbour) pair: a dithered scan has millions of one-pixel regions, and that map
  // passed V8's 2^24-entry Map limit. A small region has under despeckleSize (≤ 64) pixels,
  // so its neighbour list stays short.
  //
  // Ties and merge order match a raster scan that visits each edge once at its upper-left pixel
  // (right edge before down edge, the upper-left pixel's region first): `order` is the scan
  // position at which a pair, or a small region, is first seen.
  const nbRegion: number[] = [],
    nbCount: number[] = [],
    nbOrder: number[] = []
  for (let pass = 0; pass < 8; pass++) {
    let changed = false
    // pixels of each small region, grouped by region in raster order
    const start = new Int32Array(regionCount + 1)
    for (let p = 0; p < n; p++) {
      const r = find(label[p])
      if (sizes[r] < despeckleSize) start[r + 1]++
    }
    for (let i = 0; i < regionCount; i++) start[i + 1] += start[i]
    const pix = new Int32Array(start[regionCount])
    const fill = start.slice(0, regionCount)
    for (let p = 0; p < n; p++) {
      const r = find(label[p])
      if (sizes[r] < despeckleSize) pix[fill[r]++] = p
    }
    const small: number[] = [],
      target: number[] = [],
      firstSeen: number[] = []
    for (let s = 0; s < regionCount; s++) {
      if (start[s] === start[s + 1]) continue
      nbRegion.length = nbCount.length = nbOrder.length = 0
      let seen = Infinity
      const consider = (p: number, q: number, down: number) => {
        const o = find(label[q])
        if (o === s) return
        const u = Math.min(p, q)
        const order = 2 * (2 * u + down) + (p === u ? 0 : 1)
        let i = nbRegion.indexOf(o)
        if (i < 0) {
          i = nbRegion.push(o) - 1
          nbCount.push(0)
          nbOrder.push(order)
        }
        nbCount[i]++
        if (order < nbOrder[i]) nbOrder[i] = order
        if (order < seen) seen = order
      }
      for (let j = start[s]; j < start[s + 1]; j++) {
        const p = pix[j],
          x = p % w
        if (x > 0) consider(p, p - 1, 0)
        if (x < w - 1) consider(p, p + 1, 0)
        if (p >= w) consider(p, p - w, 1)
        if (p + w < n) consider(p, p + w, 1)
      }
      if (nbRegion.length === 0) continue
      let best = 0
      for (let i = 1; i < nbRegion.length; i++)
        if (
          nbCount[i] > nbCount[best] ||
          (nbCount[i] === nbCount[best] && nbOrder[i] < nbOrder[best])
        )
          best = i
      small.push(s)
      target.push(nbRegion[best])
      firstSeen.push(seen)
    }
    const byScan = small.map((_, i) => i).sort((a, b) => firstSeen[a] - firstSeen[b])
    for (const i of byScan) {
      const rs = find(small[i]),
        ro = find(target[i])
      if (rs === ro || sizes[rs] >= despeckleSize) continue
      alias[rs] = ro
      sizes[ro] += sizes[rs]
      changed = true
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
  for (let i = 0; i < regionCount; i++)
    if (remap[find(i)] !== -1) regionColor[remap[find(i)]] = colors[find(i)]
  return { labelMap, regionColor, regionSize, regionCount: compactCount }
}

/** Chebyshev-window min/max filter, two 1-D passes. isMax=true → dilate, false → erode. */
function minMaxFilter(
  src: Uint8Array,
  dst: Uint8Array,
  w: number,
  h: number,
  r: number,
  isMax: boolean,
): void {
  const tmp = new Uint8Array(src.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = src[y * w + x]
      for (let d = -r; d <= r; d++) {
        const xx = x + d
        if (xx < 0 || xx >= w) continue
        const s = src[y * w + xx]
        v = isMax ? Math.max(v, s) : Math.min(v, s)
      }
      tmp[y * w + x] = v
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x]
      for (let d = -r; d <= r; d++) {
        const yy = y + d
        if (yy < 0 || yy >= h) continue
        const s = tmp[yy * w + x]
        v = isMax ? Math.max(v, s) : Math.min(v, s)
      }
      dst[y * w + x] = v
    }
}

/**
 * Each gap pixel is guarded independently against its own color, not against the gap as a
 * whole: a pixel only flips if it individually sits within 1.3x of the candidate color. A
 * gap whose residue lightens toward its middle (e.g. anti-aliased dash ends fading to full
 * paper) can therefore fail to bridge partway through even when the whole gap is well within
 * 2*gapClosing of a morphological reach — the closing dilates/erodes geometrically regardless,
 * but individual center pixels can still be too far in color to pass the guard, leaving the
 * stroke re-fragmented at that point. This is intentional (it's what stops clean parallel
 * strokes from welding), but it means gap closing alone won't rescue every dashed stroke: the
 * blur/levels pre-effects upstream (src/worker/pipeline/preprocess.ts) are the intended
 * companion — flattening and darkening gap profiles before segmentation so more of each gap
 * survives the guard here.
 */
function closeGaps(colorIdx: Int32Array, image: RasterImage, palette: Palette, r: number): void {
  const { width: w, height: h, data } = image
  const n = w * h
  const freq = new Int32Array(palette.k)
  for (let p = 0; p < n; p++) freq[colorIdx[p]]++
  const order = [...Array(palette.k).keys()].sort((a, b) => freq[a] - freq[b] || a - b)
  const bg = order[order.length - 1] // most common color never closes
  const dist = (p: number, c: number): number => {
    const dr = data[4 * p] - palette.colors[3 * c]
    const dg = data[4 * p + 1] - palette.colors[3 * c + 1]
    const db = data[4 * p + 2] - palette.colors[3 * c + 2]
    return dr * dr + dg * dg + db * db
  }
  const mask = new Uint8Array(n),
    dil = new Uint8Array(n),
    closed = new Uint8Array(n)
  const flipped = new Uint8Array(n)
  for (const c of order) {
    if (c === bg || freq[c] === 0) continue
    for (let p = 0; p < n; p++) mask[p] = colorIdx[p] === c ? 1 : 0
    minMaxFilter(mask, dil, w, h, r, true) // dilate
    minMaxFilter(dil, closed, w, h, r, false) // erode
    for (let p = 0; p < n; p++) {
      if (!closed[p] || colorIdx[p] === c || flipped[p]) continue
      if (Math.sqrt(dist(p, c)) <= 1.3 * Math.sqrt(dist(p, colorIdx[p]))) {
        colorIdx[p] = c
        flipped[p] = 1
      }
    }
  }
}
