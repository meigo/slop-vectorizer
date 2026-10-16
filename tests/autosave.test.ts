import { describe, expect, it, vi } from 'vitest'
import { putAutosave, SaveGeneration, savedAtLabel } from '../src/lib/autosave'

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

describe('putAutosave', () => {
  /** An IndexedDB whose put succeeds and whose transaction then ends as `end`. */
  function fakeDb(end: 'complete' | 'abort') {
    const tx: Record<string, unknown> = { error: new DOMException('full', 'QuotaExceededError') }
    const req: Record<string, unknown> = { result: 'autosave' }
    tx.objectStore = () => ({
      put: () => {
        setTimeout(() => {
          ;(req.onsuccess as () => void)?.()
          setTimeout(() => (tx[`on${end}`] as () => void)?.())
        })
        return req
      },
    })
    const db = { transaction: () => tx, close: () => {} }
    return {
      open: () => {
        const r: Record<string, unknown> = { result: db }
        setTimeout(() => (r.onsuccess as () => void)())
        return r
      },
    }
  }
  const rec = { zip: new Blob([]), sourceName: 'a.png', thumb: null, savedAt: 1 }

  it('reports a write whose commit aborts as not stored', async () => {
    vi.stubGlobal('indexedDB', fakeDb('abort'))
    try {
      expect(await putAutosave(rec)).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('reports a committed write as stored', async () => {
    vi.stubGlobal('indexedDB', fakeDb('complete'))
    try {
      expect(await putAutosave(rec)).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
