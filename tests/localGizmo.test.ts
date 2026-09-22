import { describe, expect, it } from 'vitest'
import {
  applyDrag,
  cursorFor,
  hitTest,
  initialLocal,
  toScreen,
  type ViewXf,
} from '../src/lib/localGizmo'
import type { LocalLevels } from '../src/types'

// 200x100 image; circle centre (100,50) px, inner 20 px, outer 40 px
const L: LocalLevels = { cx: 0.5, cy: 0.5, inner: 0.1, outer: 0.2, blackPoint: 10, whitePoint: 240 }
const V1: ViewXf = { zoom: 1, panX: 0, panY: 0 }
const V2: ViewXf = { zoom: 2, panX: 30, panY: -10 }

describe('toScreen', () => {
  it('maps the circle through zoom and pan', () => {
    expect(toScreen(L, 200, 100, V1)).toEqual({ x: 100, y: 50, inner: 20, outer: 40 })
    expect(toScreen(L, 200, 100, V2)).toEqual({ x: 230, y: 90, inner: 40, outer: 80 })
  })
})

describe('hitTest', () => {
  const c = toScreen(L, 200, 100, V2) // (230,90), inner 40, outer 80
  it('finds the centre, the rings, the inside and nothing', () => {
    expect(hitTest(c, 231, 91, 6)).toBe('move')
    expect(hitTest(c, 230 + 40, 90, 6)).toBe('inner')
    expect(hitTest(c, 230, 90 + 81, 6)).toBe('outer')
    expect(hitTest(c, 230 + 25, 90, 6)).toBe('move')
    expect(hitTest(c, 230 + 60, 90, 6)).toBe(null)
    expect(hitTest(c, 230 + 200, 90, 6)).toBe(null)
  })
  it('with overlapping rings, outside grabs the outer and inside the inner', () => {
    const hard = { x: 0, y: 0, inner: 50, outer: 52 }
    expect(hitTest(hard, 53, 0, 6)).toBe('outer')
    expect(hitTest(hard, 48, 0, 6)).toBe('inner')
  })
  it('a wider touch slop reaches further', () => {
    expect(hitTest(c, 230 + 40 + 15, 90, 6)).toBe(null)
    expect(hitTest(c, 230 + 40 + 15, 90, 18)).not.toBe(null)
  })
})

describe('applyDrag', () => {
  it('moves by the pointer delta in image space', () => {
    const m = applyDrag(L, 'move', 200, 100, V2, { x: 0, y: 0 }, { x: 40, y: 20 })
    expect(m.cx).toBeCloseTo(0.5 + 20 / 200)
    expect(m.cy).toBeCloseTo(0.5 + 10 / 100)
    expect(m.inner).toBe(L.inner)
  })
  it('keeps the centre on the image', () => {
    const m = applyDrag(L, 'move', 200, 100, V1, { x: 0, y: 0 }, { x: 9999, y: -9999 })
    expect(m.cx).toBe(1)
    expect(m.cy).toBe(0)
  })
  it('resizes the inner ring by the radial delta, without a jump at grab', () => {
    // grab 3 px outside the inner ring, then move 10 px further out
    const r = applyDrag(L, 'inner', 200, 100, V1, { x: 123, y: 50 }, { x: 133, y: 50 })
    expect(r.inner * 200).toBeCloseTo(30)
    expect(r.outer).toBe(L.outer)
  })
  it('the inner ring pushes the outer one out', () => {
    const r = applyDrag(L, 'inner', 200, 100, V1, { x: 120, y: 50 }, { x: 170, y: 50 })
    expect(r.inner * 200).toBeCloseTo(70)
    expect(r.outer).toBeCloseTo(r.inner)
  })
  it('the outer ring stops at the inner one, and the inner stays positive', () => {
    const o = applyDrag(L, 'outer', 200, 100, V1, { x: 140, y: 50 }, { x: 100, y: 50 })
    expect(o.outer).toBeCloseTo(L.inner)
    const i = applyDrag(L, 'inner', 200, 100, V1, { x: 120, y: 50 }, { x: 100, y: 50 })
    expect(i.inner).toBeGreaterThan(0)
  })
  it('keeps the levels untouched', () => {
    const m = applyDrag(L, 'outer', 200, 100, V1, { x: 140, y: 50 }, { x: 150, y: 50 })
    expect([m.blackPoint, m.whitePoint]).toEqual([10, 240])
  })
})

describe('initialLocal', () => {
  it('centres on the visible area with a quarter of its short side, outer 1.5×', () => {
    // 400x300 pane showing the 200x100 image at zoom 2 from (0,0)
    const l = initialLocal({ zoom: 2, panX: 0, panY: 0 }, 400, 300, 200, 100, 30, 220)
    expect(l.cx).toBeCloseTo(100 / 200)
    expect(l.cy).toBeCloseTo(75 / 100) // visible centre: 150 screen px / zoom 2
    expect(l.inner * 200).toBeCloseTo(300 / 4 / 2)
    expect(l.outer).toBeCloseTo(l.inner * 1.5)
    expect([l.blackPoint, l.whitePoint]).toEqual([30, 220])
  })
})

describe('cursorFor', () => {
  const c = { x: 0, y: 0, inner: 10, outer: 20 }
  it('shows move for the centre and a radial resize for the rings', () => {
    expect(cursorFor('move', c, 0, 0)).toBe('move')
    expect(cursorFor('inner', c, 10, 0)).toBe('ew-resize')
    expect(cursorFor('outer', c, 0, -20)).toBe('ns-resize')
    expect(cursorFor('outer', c, 14, 14)).toBe('nwse-resize')
    expect(cursorFor('inner', c, -7, 7)).toBe('nesw-resize')
  })
})
