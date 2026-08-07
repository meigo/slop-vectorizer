import { describe, it, expect } from 'vitest'
import { firstDirtyStage, sameImageData } from '../src/worker/vectorize.worker'
import { DEFAULT_OPTIONS } from '../src/types'
import type { RasterImage } from '../src/types'

describe('firstDirtyStage', () => {
  const base = DEFAULT_OPTIONS
  it('new image -> palette', () =>
    expect(firstDirtyStage(base, base, false)).toBe('palette'))
  it('colorCount change -> palette', () =>
    expect(firstDirtyStage(base, { ...base, colorCount: 4 }, true)).toBe('palette'))
  it('despeckle change -> segment', () =>
    expect(firstDirtyStage(base, { ...base, despeckleSize: 9 }, true)).toBe('segment'))
  it('smoothness change -> fit', () =>
    expect(firstDirtyStage(base, { ...base, smoothness: 0.9 }, true)).toBe('fit'))
  it('no prev -> palette', () =>
    expect(firstDirtyStage(null, base, true)).toBe('palette'))
})

describe('sameImageData', () => {
  it('null previous -> false', () => {
    const b: RasterImage = { width: 2, height: 1, data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]) }
    expect(sameImageData(null, b)).toBe(false)
  })

  it('identical buffers -> true', () => {
    const a: RasterImage = { width: 2, height: 1, data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]) }
    const b: RasterImage = { width: 2, height: 1, data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]) }
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
    const width = 32, height = 32
    const aData = new Uint8ClampedArray(width * height * 4).fill(10)
    const bData = new Uint8ClampedArray(aData)
    bData[5] = 11 // offset 5 is not a multiple of 16 — the old probe would miss this edit
    const a: RasterImage = { width, height, data: aData }
    const b: RasterImage = { width, height, data: bData }
    expect(sameImageData(a, b)).toBe(false)
  })
})
