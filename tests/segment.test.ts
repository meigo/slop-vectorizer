import { describe, it, expect } from 'vitest'
import { estimatePalette, mulberry32 } from '../src/worker/pipeline/palette'
import { segmentImage } from '../src/worker/pipeline/segment'
import { renderShape, insideCircle } from './helpers/render'
import type { RasterImage } from '../src/types'

describe('segmentImage', () => {
  const img = renderShape(64, 64, insideCircle(32, 32, 20), [200, 30, 30], [245, 245, 245])
  const pal = estimatePalette(img, 2)

  it('produces exactly two regions for circle-on-background', () => {
    const seg = segmentImage(img, pal, 4)
    expect(seg.regionCount).toBe(2)
  })

  it('despeckle removes single-pixel noise', () => {
    const noisy = renderShape(64, 64, insideCircle(32, 32, 20), [200, 30, 30], [245, 245, 245])
    noisy.data.set([200, 30, 30, 255], (5 * 64 + 5) * 4) // lone fg pixel in bg
    const seg = segmentImage(noisy, pal, 4)
    expect(seg.regionCount).toBe(2)
    expect(seg.labelMap[5 * 64 + 5]).toBe(seg.labelMap[0]) // absorbed into background
  })

  it('region sizes sum to pixel count', () => {
    const seg = segmentImage(img, pal, 4)
    expect([...seg.regionSize].reduce((a, b) => a + b, 0)).toBe(64 * 64)
  })
})

const INK = 30, PAPER = 245

function strokesFixture(withThin: boolean): RasterImage {
  const w = 120, h = 64
  const data = new Uint8ClampedArray(w * h * 4)
  const rand = mulberry32(7)
  for (let p = 0; p < data.length; p += 4) {
    const v = PAPER + (rand() - 0.5) * 16 // paper texture noise
    data[p] = v; data[p + 1] = v; data[p + 2] = v; data[p + 3] = 255
  }
  const set = (x: number, y: number, v: number) => {
    const o = (y * w + x) * 4
    data[o] = v; data[o + 1] = v; data[o + 2] = v
  }
  for (let y = 40; y < 48; y++) for (let x = 8; x < 112; x++) set(x, y, INK) // thick anchor
  if (withThin) {
    // Dashed thin stroke: 6px solid-ink dashes separated by 3px gaps carrying a faint
    // near-ink residue (v=145). despeckleSize=4 in these tests, so each 6px dash survives
    // as its own region at gapClosing 0 (fragmentation); each 3px gap is <= 2*gapClosing(2),
    // so a gapClosing-2 morphological close bridges it. The guard (1.3x) only welds a gap
    // pixel to ink when it's already color-ambiguous: |v-INK| <= 1.3*|v-PAPER| holds up to
    // v=151.5 here, so v=145 passes (residue) while clean PAPER (v=245) never does.
    const DASH = 6, GAP = 3, PERIOD = DASH + GAP, RESIDUE = 145
    for (let x = 8; x < 112; x++)
      set(x, 20, (x - 8) % PERIOD < DASH ? INK : RESIDUE)
  }
  return { width: w, height: h, data }
}

function inkRegionCount(img: RasterImage, gapClosing: number): number {
  const pal = estimatePalette(img, 2)
  const seg = segmentImage(img, pal, 4, gapClosing)
  // ink palette index = darker color
  const lum = (i: number) => pal.colors[3 * i] + pal.colors[3 * i + 1] + pal.colors[3 * i + 2]
  const ink = lum(0) < lum(1) ? 0 : 1
  let count = 0
  for (let r = 0; r < seg.regionCount; r++) if (seg.regionColor[r] === ink) count++
  return count
}

describe('gap closing', () => {
  it('gapClosing 0 fragments the oscillating thin stroke (the bug exists)', () => {
    expect(inkRegionCount(strokesFixture(true), 0)).toBeGreaterThan(2)
  })

  it('gapClosing 2 connects the thin stroke: exactly anchor + one stroke', () => {
    expect(inkRegionCount(strokesFixture(true), 2)).toBe(2)
  })

  it('guard: two clean parallel strokes 3px apart do NOT weld', () => {
    const w = 120, h = 64
    const data = new Uint8ClampedArray(w * h * 4)
    for (let p = 0; p < data.length; p += 4) { data[p] = PAPER; data[p + 1] = PAPER; data[p + 2] = PAPER; data[p + 3] = 255 }
    const set = (x: number, y: number) => { const o = (y * w + x) * 4; data[o] = INK; data[o + 1] = INK; data[o + 2] = INK }
    for (let x = 8; x < 112; x++) { set(x, 20); set(x, 24) } // rows 20 and 24, clean paper between
    const img: RasterImage = { width: w, height: h, data }
    expect(inkRegionCount(img, 2)).toBe(2) // still two separate strokes
  })

  it('gapClosing 0 is byte-identical to previous behavior', () => {
    const img = strokesFixture(false)
    const pal = estimatePalette(img, 2)
    const a = segmentImage(img, pal, 4, 0)
    const b = segmentImage(img, pal, 4) // default param
    expect([...a.labelMap]).toEqual([...b.labelMap])
  })
})
