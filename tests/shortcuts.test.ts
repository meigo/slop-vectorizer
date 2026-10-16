import { describe, expect, it } from 'vitest'
import { commandFor } from '../src/lib/shortcuts'

describe('commandFor', () => {
  it('maps the three File shortcuts, on either modifier', () => {
    expect(commandFor({ key: 's', metaKey: true })).toBe('save')
    expect(commandFor({ key: 's', ctrlKey: true })).toBe('save')
    expect(commandFor({ key: 'S', metaKey: true, shiftKey: true })).toBe('saveAs')
    expect(commandFor({ key: 'o', metaKey: true })).toBe('open')
  })
  it('ignores the same keys without a modifier', () => {
    expect(commandFor({ key: 's' })).toBe(null)
    expect(commandFor({ key: 'o' })).toBe(null)
  })
  it('ignores Alt combinations and unrelated keys', () => {
    expect(commandFor({ key: 's', metaKey: true, altKey: true })).toBe(null)
    expect(commandFor({ key: 'o', ctrlKey: true, shiftKey: true })).toBe(null)
    expect(commandFor({ key: 'p', metaKey: true })).toBe(null)
    expect(commandFor({ key: 'Enter', metaKey: true })).toBe(null)
  })
  it('reads the physical key on a non-Latin layout', () => {
    expect(commandFor({ key: 'ы', code: 'KeyS', ctrlKey: true })).toBe('save')
    expect(commandFor({ key: 'щ', code: 'KeyO', ctrlKey: true })).toBe('open')
    // a Latin layout keeps its own letter, wherever the key sits
    expect(commandFor({ key: 's', code: 'KeyO', ctrlKey: true })).toBe('save')
  })
})
