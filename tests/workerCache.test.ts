import { describe, it, expect } from 'vitest'
import { firstDirtyStage, run, sameImageData } from '../src/worker/vectorize.worker'
import { vectorize } from '../src/worker/pipeline'
import { DEFAULT_OPTIONS } from '../src/types'
import type { RasterImage } from '../src/types'

describe('firstDirtyStage', () => {
  const base = DEFAULT_OPTIONS
  it('new image -> pre', () => expect(firstDirtyStage(base, base, false)).toBe('pre'))
  it('colorCount change -> palette', () =>
    expect(firstDirtyStage(base, { ...base, colorCount: 4 }, true)).toBe('palette'))
  it('despeckle change -> segment', () =>
    expect(firstDirtyStage(base, { ...base, despeckleSize: 9 }, true)).toBe('segment'))
  it('smoothness change -> fit', () =>
    expect(firstDirtyStage(base, { ...base, smoothness: 0.9 }, true)).toBe('fit'))
  it('no prev -> pre', () => expect(firstDirtyStage(null, base, true)).toBe('pre'))
  it('mergePaths change -> fit', () =>
    expect(firstDirtyStage(base, { ...base, mergePaths: !base.mergePaths }, true)).toBe('fit'))
  it('transparentBg change -> fit', () =>
    expect(firstDirtyStage(base, { ...base, transparentBg: !base.transparentBg }, true)).toBe(
      'fit',
    ))
  it('optimize change -> fit', () =>
    expect(firstDirtyStage(base, { ...base, optimize: !base.optimize }, true)).toBe('fit'))
  it('blackPoint change -> pre', () =>
    expect(firstDirtyStage(base, { ...base, blackPoint: 40 }, true)).toBe('pre'))
  it('blurRadius change -> pre', () =>
    expect(firstDirtyStage(base, { ...base, blurRadius: 2 }, true)).toBe('pre'))
  it('gapClosing change -> segment', () =>
    expect(firstDirtyStage(base, { ...base, gapClosing: 2 }, true)).toBe('segment'))
  it('colorOverrides change -> fit', () =>
    expect(firstDirtyStage(base, { ...base, colorOverrides: ['#ff0000'] }, true)).toBe('fit'))
  it('stackedShapes change re-enters at fit', () => {
    expect(firstDirtyStage(base, { ...base, stackedShapes: true }, true)).toBe('fit')
  })
  const circle = {
    cx: 0.5,
    cy: 0.5,
    inner: 0.1,
    outer: 0.2,
    blackPoint: 60,
    whitePoint: 200,
    hidden: false,
  }
  it('adding, moving or hiding an effective circle -> pre', () => {
    expect(firstDirtyStage(base, { ...base, localCircles: [circle] }, true)).toBe('pre')
    const on = { ...base, localCircles: [circle] }
    expect(firstDirtyStage(on, { ...on, localCircles: [{ ...circle, cx: 0.6 }] }, true)).toBe('pre')
    expect(firstDirtyStage(on, { ...on, localCircles: [{ ...circle, hidden: true }] }, true)).toBe(
      'pre',
    )
  })
  it('an equal list, and edits to an ineffective circle, are not changes', () => {
    const on = { ...base, localCircles: [circle] }
    expect(firstDirtyStage(on, { ...on, localCircles: [{ ...circle }] }, true)).toBe('fit')
    // a no-op circle (points equal to the global ones) is not effective, so moving it changes nothing
    const noop = { ...circle, blackPoint: base.blackPoint, whitePoint: base.whitePoint }
    const off = { ...base, localCircles: [noop] }
    expect(firstDirtyStage(off, { ...off, localCircles: [{ ...noop, cx: 0.9 }] }, true)).toBe('fit')
  })
})

describe('sameImageData', () => {
  it('null previous -> false', () => {
    const b: RasterImage = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]),
    }
    expect(sameImageData(null, b)).toBe(false)
  })

  it('identical buffers -> true', () => {
    const a: RasterImage = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]),
    }
    const b: RasterImage = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]),
    }
    expect(sameImageData(a, b)).toBe(true)
  })

  it('different dimensions -> false', () => {
    const a: RasterImage = { width: 2, height: 1, data: new Uint8ClampedArray(8) }
    const b: RasterImage = { width: 1, height: 1, data: new Uint8ClampedArray(4) }
    expect(sameImageData(a, b)).toBe(false)
  })

  it('detects a localized edit the old 256-sample stride would have skipped (regression)', () => {
    // Buffer large enough that the old implementation's stride
    // (floor(len/256) = 16 for len=4096) would only compare every 16th byte.
    const width = 32,
      height = 32
    const aData = new Uint8ClampedArray(width * height * 4).fill(10)
    const bData = new Uint8ClampedArray(aData)
    bData[5] = 11 // offset 5 is not a multiple of 16 — the old probe would miss this edit
    const a: RasterImage = { width, height, data: aData }
    const b: RasterImage = { width, height, data: bData }
    expect(sameImageData(a, b)).toBe(false)
  })
})

describe('palette source at another scale', () => {
  // white with a 2 px red and a 2 px blue stripe, and the same at ×3 (nearest neighbour)
  const stripes = (s: number, sw = 2): RasterImage => {
    const w = 120 * s
    const data = new Uint8ClampedArray(w * w * 4)
    for (let p = 0; p < w * w; p++) {
      const y = Math.floor(p / w) / s
      const c =
        y >= 30 && y < 30 + sw
          ? [220, 20, 20]
          : y >= 60 && y < 60 + sw
            ? [20, 20, 220]
            : [255, 255, 255]
      data.set([...c, 255], p * 4)
    }
    return { width: w, height: w, data }
  }
  const fills = (svg: string) => [...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1])
  const opts = { ...DEFAULT_OPTIONS, colorCount: 3, blurRadius: 3 }
  // the stroke colours stay as strong as the working image's own (#e86464); the over-blurred
  // source gave #f8cece and #cecef8
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)
  const reddish = (hex: string) => ch(hex, 0) > 180 && ch(hex, 1) < 120
  const bluish = (hex: string) => ch(hex, 2) > 180 && ch(hex, 1) < 120

  it('blurs the ×1 palette source as much, relative to the artwork, as the working image', () => {
    const out = fills(vectorize(stripes(3), opts, undefined, stripes(1)).svg)
    expect(out.some(reddish) && out.some(bluish)).toBe(true)
  })
  it('the worker does too', () => {
    let svg = ''
    run(stripes(3), opts, (m) => m.type === 'result' && (svg = m.result.svg), 1, stripes(1))
    expect(fills(svg).some(reddish) && fills(svg).some(bluish)).toBe(true)
  })
  it('a new palette source re-segments the same working image', () => {
    const img = stripes(1, 10)
    const post = () => {}
    run(img, { ...DEFAULT_OPTIONS, colorCount: 'auto' }, post, 1, stripes(1, 10))
    // a palette source with fewer colours (no blue stripe) and the same working image
    const twoTone = stripes(1, 10)
    for (let p = 0; p < 120 * 120; p++)
      if (twoTone.data[p * 4 + 2] === 220) twoTone.data.set([255, 255, 255], p * 4)
    let result = ''
    run(
      img,
      { ...DEFAULT_OPTIONS, colorCount: 'auto' },
      (m) => m.type === 'result' && (result = m.result.svg),
      2,
      twoTone,
    )
    expect(fills(result).length).toBeGreaterThan(0)
  })
})
