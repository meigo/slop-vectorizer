import { describe, it, expect } from 'vitest'
import { firstDirtyStage, sameImageData } from '../src/worker/vectorize.worker'
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
  const circle = { cx: 0.5, cy: 0.5, inner: 0.1, outer: 0.2, blackPoint: 60, whitePoint: 200 }
  it('localLevels change -> pre', () => {
    expect(firstDirtyStage(base, { ...base, localLevels: circle }, true)).toBe('pre')
    const on = { ...base, localLevels: circle }
    expect(firstDirtyStage(on, { ...on, localLevels: { ...circle, cx: 0.6 } }, true)).toBe('pre')
  })
  it('an equal localLevels copy is not a change', () => {
    const on = { ...base, localLevels: circle }
    expect(firstDirtyStage(on, { ...on, localLevels: { ...circle } }, true)).toBe('fit')
  })
  describe('effective circle (points vs. the global ones)', () => {
    // Same points as base's global blackPoint/whitePoint (0, 255): a no-op circle.
    const noop = { ...circle, blackPoint: base.blackPoint, whitePoint: base.whitePoint }
    it('moving a circle whose points equal the global ones does not dirty pre', () => {
      const on = { ...base, localLevels: noop }
      expect(firstDirtyStage(on, { ...on, localLevels: { ...noop, cx: 0.6 } }, true)).toBe('fit')
    })
    it('moving a circle with different points -> pre', () => {
      const on = { ...base, localLevels: circle }
      expect(firstDirtyStage(on, { ...on, localLevels: { ...circle, cx: 0.6 } }, true)).toBe('pre')
    })
    it('turning an effective circle off -> pre', () => {
      const on = { ...base, localLevels: circle }
      expect(firstDirtyStage(on, { ...on, localLevels: null }, true)).toBe('pre')
    })
    it('turning a no-op circle off does not dirty pre', () => {
      const on = { ...base, localLevels: noop }
      expect(firstDirtyStage(on, { ...on, localLevels: null }, true)).toBe('fit')
    })
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
