import { describe, expect, it } from 'vitest'
import { packProject, projectFileName, unpackProject, type ProjectData } from '../src/lib/project'
import { DEFAULT_OPTIONS } from '../src/types'
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'

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
    expect(back.options.localCircles).toEqual([circle])
    expect(new Uint8Array(await back.source.arrayBuffer())).toEqual(bytes)
    expect(back.source.type).toBe('image/png')
  })

  it('names the source entry after the original extension and stores it uncompressed', async () => {
    const zip = await packProject(data())
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()))
    expect(Object.keys(entries).sort()).toEqual(['project.json', 'source.png'])
    expect(entries['source.png']).toEqual(bytes)
  })

  it('writes the current project version', async () => {
    const zip = await packProject(data())
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()))
    const project = JSON.parse(strFromU8(entries['project.json']))
    expect(project.version).toBe(2)
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
    expect(back.options.localCircles).toEqual([circle])
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
      unpackProject(zipOf({ app: 'slop-vectorizer', version: 3, sourceName: 'x.png' })),
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

describe('v1 migration', () => {
  const v1 = (options: Record<string, unknown>, localSaved?: unknown) =>
    new Blob([
      zipSync({
        'project.json': strToU8(
          JSON.stringify({
            app: 'slop-vectorizer',
            version: 1,
            sourceName: 'old.png',
            scale: 1,
            options,
            ...(localSaved === undefined ? {} : { localSaved }),
          }),
        ),
        'source.png': bytes,
      }),
    ])
  const old = { cx: 0.4, cy: 0.6, inner: 0.1, outer: 0.2, blackPoint: 30, whitePoint: 220 }

  it('turns a v1 circle into a one-item list', async () => {
    const back = await unpackProject(v1({ localLevels: old }))
    expect(back.options.localCircles).toEqual([{ ...old, hidden: false }])
  })

  it('keeps a v1 remembered-but-off circle as a hidden one', async () => {
    const back = await unpackProject(v1({ localLevels: null }, old))
    expect(back.options.localCircles).toEqual([{ ...old, hidden: true }])
  })

  it('a v1 project with no circle at all gets an empty list', async () => {
    const back = await unpackProject(v1({}))
    expect(back.options.localCircles).toEqual([])
  })

  it('still rejects a version newer than this build', async () => {
    await expect(
      unpackProject(
        new Blob([
          zipSync({
            'project.json': strToU8(
              JSON.stringify({ app: 'slop-vectorizer', version: 3, sourceName: 'x.png' }),
            ),
            'source.png': bytes,
          }),
        ]),
      ),
    ).rejects.toThrow(/newer version/i)
  })

  it('sanitises circles from a hand-edited file', async () => {
    const zeroInner = { ...old, inner: 0 }
    const negInner = { ...old, inner: -5 }
    const back = await unpackProject(
      v1({
        localCircles: [old, 'nope', { ...old, cx: 'x' }, zeroInner, negInner],
      } as Record<string, unknown>),
    )
    // only well-formed circles survive; the rest are dropped rather than crashing a render.
    // inner: 0 and inner: -5 are clamped to a tiny positive epsilon (spec: outer >= inner > 0).
    expect(back.options.localCircles).toEqual([
      { ...old, hidden: false },
      { ...zeroInner, inner: 1e-6, hidden: false },
      { ...negInner, inner: 1e-6, hidden: false },
    ])
  })
})

describe('circle list cap', () => {
  it('caps a hand-edited list at 256 circles', async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ ...circle, cx: i / 300 }))
    const zip = new Blob([
      zipSync({
        'project.json': strToU8(
          JSON.stringify({
            app: 'slop-vectorizer',
            version: 2,
            sourceName: 'x.png',
            scale: 1,
            options: { localCircles: many },
          }),
        ),
        'source.png': bytes,
      }),
    ])
    const back = await unpackProject(zip)
    expect(back.options.localCircles.length).toBe(256)
    expect(back.options.localCircles).toEqual(
      many.slice(0, 256).map((c) => ({ ...c, hidden: false })),
    )
  })
})
