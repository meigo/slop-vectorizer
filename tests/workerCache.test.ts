import { describe, it, expect } from 'vitest'
import { firstDirtyStage } from '../src/worker/vectorize.worker'
import { DEFAULT_OPTIONS } from '../src/types'

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
