import { describe, expect, it } from 'vitest'
import { deliverFile, svgFileName, writeProjectFile, type DeliverDeps } from '../src/lib/saveFile'
import type { ShareOutcome } from '../src/lib/share'

describe('svgFileName', () => {
  it('swaps the last extension for .svg', () => {
    expect(svgFileName('logo.png')).toBe('logo.svg')
    expect(svgFileName('photo.final.jpeg')).toBe('photo.final.svg')
    expect(svgFileName('scan')).toBe('scan.svg')
  })
  it('falls back to vectorized.svg with no usable name', () => {
    expect(svgFileName(undefined)).toBe('vectorized.svg')
    expect(svgFileName('')).toBe('vectorized.svg')
    expect(svgFileName('.png')).toBe('vectorized.svg')
  })
})

const file = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })

function deps(over: Partial<DeliverDeps> = {}) {
  const downloaded: { blob: Blob; name: string }[] = []
  const d: DeliverDeps = {
    canShare: () => true,
    share: async () => ({ outcome: 'shared' as ShareOutcome }),
    download: (blob, name) => void downloaded.push({ blob, name }),
    ...over,
  }
  return { d, downloaded }
}

describe('deliverFile', () => {
  it('downloads, without sharing, when the browser refuses the file type', async () => {
    let shared = false
    const { d, downloaded } = deps({
      canShare: () => false,
      share: async () => {
        shared = true
        return { outcome: 'shared' }
      },
    })
    expect(await deliverFile(file, d)).toEqual({ kind: 'downloaded' })
    expect(shared).toBe(false)
    expect(downloaded).toEqual([{ blob: file, name: 'logo.svg' }])
  })
  it('reports a completed sheet as shared', async () => {
    expect(await deliverFile(file, deps().d)).toEqual({ kind: 'shared' })
  })
  it('reports a closed sheet as dismissed, not a failure', async () => {
    const { d } = deps({ share: async () => ({ outcome: 'dismissed' }) })
    expect(await deliverFile(file, d)).toEqual({ kind: 'dismissed' })
  })
  it('falls back to the dialog with no error text when the tap expired', async () => {
    const { d } = deps({ share: async () => ({ outcome: 'needs-tap' }) })
    expect(await deliverFile(file, d)).toEqual({ kind: 'ready', error: '' })
  })
  it("falls back to the dialog carrying the browser's message when sharing failed", async () => {
    const { d } = deps({ share: async () => ({ outcome: 'failed', error: new Error('no sheet') }) })
    expect(await deliverFile(file, d)).toEqual({ kind: 'ready', error: 'no sheet' })
  })
})

describe('writeProjectFile', () => {
  it('offers the project type and writes through the picked handle', async () => {
    const written: Blob[] = []
    let seen: unknown = null
    const handle = {
      name: 'logo.vectorizer.zip',
      createWritable: async () => ({
        write: async (b: Blob) => void written.push(b),
        close: async () => {},
      }),
    }
    ;(globalThis as { window?: unknown }).window = {
      showSaveFilePicker: async (opts: unknown) => {
        seen = opts
        return handle
      },
    }
    const blob = new Blob([new Uint8Array([1, 2])], { type: 'application/zip' })
    const r = await writeProjectFile(blob, 'logo.vectorizer.zip', null, false)
    expect(r).toEqual({ name: 'logo.vectorizer.zip', handle })
    expect(written).toHaveLength(1)
    expect(JSON.stringify(seen)).toContain('.zip')
    delete (globalThis as { window?: unknown }).window
  })
})
