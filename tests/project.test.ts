import { describe, expect, it } from 'vitest'
import { packProject, projectFileName, unpackProject, type ProjectData } from '../src/lib/project'
import { DEFAULT_OPTIONS } from '../src/types'
import { unzipSync, zipSync, strToU8 } from 'fflate'

const circle = {
  cx: 0.4,
  cy: 0.6,
  inner: 0.1,
  outer: 0.2,
  blackPoint: 30,
  whitePoint: 220,
  hidden: false,
}
const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])

function data(over: Partial<ProjectData> = {}): ProjectData {
  return {
    source: new Blob([bytes], { type: 'image/png' }),
    sourceName: 'logo.png',
    scale: 2,
    options: {
      ...DEFAULT_OPTIONS,
      colorCount: 5,
      colorOverrides: ['#ff0000'],
      localCircles: [circle],
    },
    localSaved: circle,
    ...over,
  }
}

describe('projectFileName', () => {
  it('replaces the source extension with .vectorizer.zip', () => {
    expect(projectFileName('logo.png')).toBe('logo.vectorizer.zip')
    expect(projectFileName('photo.final.jpeg')).toBe('photo.final.vectorizer.zip')
    expect(projectFileName('scan')).toBe('scan.vectorizer.zip')
  })
  it('falls back when there is no usable name', () => {
    expect(projectFileName(undefined)).toBe('vectorized.vectorizer.zip')
    expect(projectFileName('')).toBe('vectorized.vectorizer.zip')
  })
})

describe('pack/unpack round trip', () => {
  it('restores the options, scale, circle and source bytes exactly', async () => {
    const back = await unpackProject(await packProject(data()))
    expect(back.sourceName).toBe('logo.png')
    expect(back.scale).toBe(2)
    expect(back.options).toEqual(data().options)
    expect(back.localSaved).toEqual(circle)
    expect(new Uint8Array(await back.source.arrayBuffer())).toEqual(bytes)
    expect(back.source.type).toBe('image/png')
  })

  it('names the source entry after the original extension and stores it uncompressed', async () => {
    const zip = await packProject(data())
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()))
    expect(Object.keys(entries).sort()).toEqual(['project.json', 'source.png'])
    expect(entries['source.png']).toEqual(bytes)
  })

  it('keeps a nameless source openable', async () => {
    const back = await unpackProject(
      await packProject(
        data({ sourceName: '', source: new Blob([bytes], { type: 'image/webp' }) }),
      ),
    )
    expect(new Uint8Array(await back.source.arrayBuffer())).toEqual(bytes)
  })
})

describe('compatibility', () => {
  const zipOf = (project: unknown) =>
    new Blob([
      zipSync({
        'project.json': strToU8(JSON.stringify(project)),
        'source.png': bytes,
      }),
    ])

  it('fills options missing from an older project from the defaults', async () => {
    const back = await unpackProject(
      zipOf({
        app: 'slop-vectorizer',
        version: 1,
        sourceName: 'old.png',
        scale: 1,
        options: { colorCount: 3 },
      }),
    )
    expect(back.options).toEqual({ ...DEFAULT_OPTIONS, colorCount: 3 })
    expect(back.localSaved).toBe(null)
  })

  it('remembers a circle saved only as the active one', async () => {
    const back = await unpackProject(
      zipOf({
        app: 'slop-vectorizer',
        version: 1,
        sourceName: 'x.png',
        scale: 1,
        options: { localCircles: [circle] },
      }),
    )
    expect(back.localSaved).toEqual(circle)
  })

  it('sanitises colorOverrides so only clean #rrggbb entries survive', async () => {
    const malicious = 'x"/><img src=x onerror=alert(1)><path fill="y'
    const back = await unpackProject(
      zipOf({
        app: 'slop-vectorizer',
        version: 1,
        sourceName: 'x.png',
        scale: 1,
        options: { colorOverrides: [malicious, '#00ff00', 42] },
      }),
    )
    expect(back.options.colorOverrides).toEqual([null, '#00ff00', null])
  })

  it('falls back to default options when options is not a plain object', async () => {
    const back = await unpackProject(
      zipOf({
        app: 'slop-vectorizer',
        version: 1,
        sourceName: 'x.png',
        scale: 1,
        options: 'not-an-object',
      }),
    )
    expect(back.options).toEqual(DEFAULT_OPTIONS)
  })

  it('rejects a newer version, a foreign zip and damaged bytes', async () => {
    await expect(
      unpackProject(zipOf({ app: 'slop-vectorizer', version: 2, sourceName: 'x.png' })),
    ).rejects.toThrow(/newer version/i)
    await expect(unpackProject(zipOf({ app: 'something-else', version: 1 }))).rejects.toThrow(
      /not a slop-vectorizer project/i,
    )
    await expect(unpackProject(new Blob([zipSync({ 'a.txt': strToU8('hi') })]))).rejects.toThrow(
      /not a slop-vectorizer project/i,
    )
    await expect(unpackProject(new Blob([new Uint8Array([1, 2, 3, 4])]))).rejects.toThrow(
      /damaged|not a slop-vectorizer project/i,
    )
  })
})
