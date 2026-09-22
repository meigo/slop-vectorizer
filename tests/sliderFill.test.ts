import { describe, expect, it } from 'vitest'
import { sliderFill } from '../src/lib/sliderFill'

describe('sliderFill', () => {
  it('maps the value onto the range as a percentage', () => {
    expect(sliderFill(0, 0, 1)).toBe('--fill-from:0%;--fill-to:0.00%')
    expect(sliderFill(0.5, 0, 1)).toBe('--fill-from:0%;--fill-to:50.00%')
    expect(sliderFill(255, 1, 255)).toBe('--fill-from:0%;--fill-to:100.00%')
  })
  it('clamps out-of-range values and survives an empty range', () => {
    expect(sliderFill(9, 0, 6)).toBe('--fill-from:0%;--fill-to:100.00%')
    expect(sliderFill(3, 0, 0)).toBe('--fill-from:0%;--fill-to:0.00%')
  })
})
