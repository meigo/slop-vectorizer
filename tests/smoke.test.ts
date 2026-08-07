import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs typed-array code', () => {
    const a = new Float64Array([1, 2, 3])
    expect(a.reduce((s, v) => s + v, 0)).toBe(6)
  })
})
