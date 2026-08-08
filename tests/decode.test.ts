import { describe, it, expect } from 'vitest'
import { scaledDims } from '../src/lib/decode'

describe('scaledDims', () => {
  it('applies upscale then the 4096 clamp', () => {
    expect(scaledDims(100, 80, 2)).toEqual({ w: 200, h: 160, downscaled: false })
    expect(scaledDims(3000, 1000, 2)).toEqual({ w: 4096, h: 1365, downscaled: true })
    expect(scaledDims(5000, 5000, 1)).toEqual({ w: 4096, h: 4096, downscaled: true })
  })
})
