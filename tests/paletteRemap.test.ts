import { describe, it, expect } from 'vitest'
import { remapOverrides } from '../src/lib/paletteRemap'

describe('remapOverrides', () => {
  const inkPaper = [30, 30, 30, 245, 245, 245]

  it('survives wobble: same k, slightly shifted colors keep overrides at their index', () => {
    const out = remapOverrides(inkPaper, [31, 31, 31, 244, 244, 244], ['#0000ff', null])
    expect(out).toEqual(['#0000ff', null])
  })

  it('survives reorder: override follows its color to the new index', () => {
    const swapped = [245, 245, 245, 30, 30, 30]
    const out = remapOverrides(inkPaper, swapped, ['#0000ff', null])
    expect(out).toEqual([null, '#0000ff'])
  })

  it('survives k-split: override maps to the nearest of the new clusters', () => {
    // paper 245 splits into 240 + 250 (auto-k flip across scales)
    const split = [30, 30, 30, 240, 240, 240, 250, 250, 250]
    const out = remapOverrides(inkPaper, split, [null, '#ff00ff'])
    // 245 is equidistant to 240 and 250; strict-< scan keeps the FIRST minimum (index 1)
    expect(out).toEqual([null, '#ff00ff', null])
  })

  it('drops overrides whose color has no near match in the new palette', () => {
    const out = remapOverrides(inkPaper, [30, 30, 30, 100, 100, 100], [null, '#ff00ff'])
    expect(out).toBeNull() // paper vanished; ink had no override; nothing to keep
  })

  it('two overrides competing for one new index: closest wins', () => {
    const merged = [30, 30, 30, 245, 245, 245]
    const old4 = [30, 30, 30, 240, 240, 240, 250, 250, 250, 100, 100, 100]
    const out = remapOverrides(old4, merged, [null, '#aaaaaa', '#bbbbbb', null])
    // 240 and 250 both map to 245 (dist 8.66 each) — first (index 1) wins the tie
    expect(out).toEqual([null, '#aaaaaa'])
  })

  it('returns null when no override survives (caller clears)', () => {
    expect(remapOverrides(inkPaper, [0, 0, 0, 90, 90, 90], ['#123456', '#654321'])).toBeNull()
  })
})
