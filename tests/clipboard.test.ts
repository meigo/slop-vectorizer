import { describe, expect, it, vi } from 'vitest'
import { clipboardTypes, imageType, readClipboardImage } from '../src/lib/clipboard'

describe('imageType', () => {
  it('picks the first image/* type', () => {
    expect(imageType(['text/plain', 'image/png', 'image/jpeg'])).toBe('image/png')
  })
  it('is undefined when there is no image', () => {
    expect(imageType(['text/plain', 'text/html'])).toBeUndefined()
    expect(imageType([])).toBeUndefined()
  })
})

describe('clipboardTypes', () => {
  it('lists every type once, across items', () => {
    expect(
      clipboardTypes([{ types: ['text/plain', 'text/html'] }, { types: ['text/plain'] }]),
    ).toBe('text/plain, text/html')
  })
  it('says "nothing" for an empty clipboard', () => {
    expect(clipboardTypes([])).toBe('nothing')
    expect(clipboardTypes([{ types: [] }])).toBe('nothing')
  })
})

describe('readClipboardImage', () => {
  it('reports an image that fails to load instead of rejecting', async () => {
    const item = {
      types: ['image/png'],
      getType: () => Promise.reject(new DOMException('gone', 'NotFoundError')),
    }
    vi.stubGlobal('navigator', { clipboard: { read: async () => [item] } })
    try {
      const r = await readClipboardImage()
      expect(r).toEqual({
        kind: 'error',
        message: "Can't read the clipboard (NotFoundError: gone)",
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
