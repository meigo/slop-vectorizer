import { describe, expect, it } from 'vitest'
import { canShareFile, classifyShareError, isAppleTouch } from '../src/lib/share'

const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
// iPadOS Safari's desktop-mode UA: indistinguishable from a Mac except for the touch points.
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

describe('isAppleTouch', () => {
  it('is true for an iPad or iPhone user agent', () => {
    expect(isAppleTouch(IPAD, 'iPad', 5)).toBe(true)
    expect(isAppleTouch(IPHONE, 'iPhone', 5)).toBe(true)
  })
  it('is true for MacIntel with touch points — the iPadOS case a UA test misses', () => {
    expect(isAppleTouch(IPAD_DESKTOP_UA, 'MacIntel', 5)).toBe(true)
  })
  it('is false for a real Mac (0 or 1 touch points) and for Windows', () => {
    expect(isAppleTouch(IPAD_DESKTOP_UA, 'MacIntel', 0)).toBe(false)
    expect(isAppleTouch(IPAD_DESKTOP_UA, 'MacIntel', 1)).toBe(false)
    expect(isAppleTouch(WINDOWS, 'Win32', 10)).toBe(false)
  })
})

describe('classifyShareError', () => {
  it('reads AbortError as dismissed and NotAllowedError as an expired tap', () => {
    expect(classifyShareError({ name: 'AbortError' })).toBe('dismissed')
    expect(classifyShareError({ name: 'NotAllowedError' })).toBe('needs-tap')
  })
  it('reads anything else as a failure, without throwing on odd input', () => {
    for (const e of [new Error('boom'), 'boom', null, undefined, 42])
      expect(classifyShareError(e)).toBe('failed')
  })
})

describe('canShareFile', () => {
  const file = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })

  it('is false with no canShare or no navigator', () => {
    expect(canShareFile(file, {})).toBe(false)
    expect(canShareFile(file, undefined)).toBe(false)
  })
  it('passes the file to canShare and returns its answer', () => {
    let seen: unknown = null
    expect(
      canShareFile(file, {
        canShare: (d) => {
          seen = d
          return true
        },
      }),
    ).toBe(true)
    expect(seen).toEqual({ files: [file] })
    expect(canShareFile(file, { canShare: () => false })).toBe(false)
  })
  it('returns false rather than throwing when canShare raises', () => {
    const canShare = () => {
      throw new TypeError('illegal invocation')
    }
    expect(canShareFile(file, { canShare })).toBe(false)
  })
})
