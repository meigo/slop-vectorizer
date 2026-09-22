import { describe, expect, it } from 'vitest'
import { SaveGeneration, savedAtLabel } from '../src/lib/autosave'

describe('SaveGeneration', () => {
  it('only the newest write is current', () => {
    const g = new SaveGeneration()
    const first = g.bump()
    expect(g.isCurrent(first)).toBe(true)
    const second = g.bump()
    expect(g.isCurrent(first)).toBe(false)
    expect(g.isCurrent(second)).toBe(true)
    expect(g.current()).toBe(second)
  })
})

describe('savedAtLabel', () => {
  const now = new Date('2026-09-22T14:40:00').getTime()
  it('shows a time today and a date before that', () => {
    expect(savedAtLabel(new Date('2026-09-22T09:05:00').getTime(), now)).toBe('saved 09:05')
    expect(savedAtLabel(new Date('2026-09-20T09:05:00').getTime(), now)).toMatch(/^saved \d/)
    expect(savedAtLabel(new Date('2026-09-20T09:05:00').getTime(), now)).not.toContain('09:05')
  })
})
