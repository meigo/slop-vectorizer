/** The project file: a zip holding the ORIGINAL source image plus every setting needed to carry
 *  on working (spec docs/superpowers/specs/2026-09-22-projects-design.md). The same blob is what
 *  the autosave slot stores, so the slot can never drift from the file format.
 *
 *  Pure: no DOM, no storage. Everything that decides the format lives here. */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { DEFAULT_OPTIONS, type LocalLevels, type PipelineOptions } from '../types'

export const PROJECT_VERSION = 1

export interface ProjectData {
  /** The original file's bytes, never re-encoded. */
  source: Blob
  sourceName: string
  scale: number
  options: PipelineOptions
  /** The remembered circle, kept even while the toggle is off. */
  localSaved: LocalLevels | null
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
}
const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

const baseName = (name: string | undefined) => (name ?? '').replace(/\.[^./\\]*$/, '').trim()

/** `logo.png` → `logo.vectorizer.zip`; distinct from the `logo.svg` the same session exports. */
export function projectFileName(sourceName: string | undefined): string {
  return (baseName(sourceName) || 'vectorized') + '.vectorizer.zip'
}

function sourceExt(d: ProjectData): string {
  const fromName = /\.([a-z0-9]+)$/i.exec(d.sourceName)?.[1]
  return (fromName ?? MIME_EXT[d.source.type] ?? 'bin').toLowerCase()
}

export async function packProject(d: ProjectData): Promise<Blob> {
  const project = {
    app: 'slop-vectorizer',
    version: PROJECT_VERSION,
    sourceName: d.sourceName,
    scale: d.scale,
    options: d.options,
    localSaved: d.localSaved,
  }
  const bytes = new Uint8Array(await d.source.arrayBuffer())
  const zip = zipSync({
    'project.json': strToU8(JSON.stringify(project, null, 2)),
    // level 0: PNG/JPEG/WebP are already compressed, so deflating them only costs time.
    [`source.${sourceExt(d)}`]: [bytes, { level: 0 }],
  })
  return new Blob([zip], { type: 'application/zip' })
}

export async function unpackProject(zip: Blob): Promise<ProjectData> {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(await zip.arrayBuffer()))
  } catch {
    throw new Error('That file is damaged or not a zip.')
  }
  const json = entries['project.json']
  if (!json) throw new Error('Not a slop-vectorizer project.')
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(strFromU8(json)) as Record<string, unknown>
  } catch {
    throw new Error('The project file is damaged.')
  }
  if (parsed.app !== 'slop-vectorizer') throw new Error('Not a slop-vectorizer project.')
  const version = typeof parsed.version === 'number' ? parsed.version : 0
  if (version > PROJECT_VERSION)
    throw new Error('This project was made by a newer version of slop-vectorizer.')

  const name = Object.keys(entries).find((k) => k.startsWith('source.'))
  if (!name) throw new Error('The project file has no source image.')
  const ext = name.slice('source.'.length).toLowerCase()
  // Copy into a fresh buffer: fflate hands back views into its own output.
  const source = new Blob([new Uint8Array(entries[name])], { type: EXT_MIME[ext] ?? '' })

  // Unknown keys are ignored and missing ones default, so older projects keep opening as the
  // app gains options.
  const saved = (parsed.options ?? {}) as Partial<PipelineOptions>
  const options: PipelineOptions = { ...DEFAULT_OPTIONS, ...saved }
  const localSaved =
    (parsed.localSaved as LocalLevels | null | undefined) ?? options.localLevels ?? null
  return {
    source,
    sourceName: typeof parsed.sourceName === 'string' ? parsed.sourceName : '',
    scale: typeof parsed.scale === 'number' ? parsed.scale : 1,
    options,
    localSaved,
  }
}
