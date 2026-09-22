/** Saving the SVG. Three paths, picked by what the browser can do:
 *  - iPad / iPhone: the share sheet's Save to Files (`deliverFile`), since Safari has no picker.
 *  - Chromium desktop: the File System Access API. The handle is kept, so the next Save
 *    overwrites the same file instead of piling up renumbered copies in Downloads.
 *  - Everything else (Firefox): a plain download. */
import { canShareFile, shareFile, type ShareOutcome } from './share'

type PickerType = { description: string; accept: Record<string, string[]> }

declare global {
  interface Window {
    showSaveFilePicker?: (opts: {
      suggestedName: string
      types: PickerType[]
    }) => Promise<FileSystemFileHandle>
  }
}

const TYPES: PickerType[] = [{ description: 'SVG image', accept: { 'image/svg+xml': ['.svg'] } }]
const PROJECT_TYPES: PickerType[] = [
  { description: 'slop-vectorizer project', accept: { 'application/zip': ['.zip'] } },
]

/** How long the object URL outlives the click. The browser only has to have STARTED the fetch by
 *  the time it is revoked, and on iPad a short revoke can kill a download it has just begun. */
const REVOKE_DELAY_MS = 60_000

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** `photo.final.png` → `photo.final.svg`; a nameless blob (pasted image) → `vectorized.svg`. */
export function svgFileName(sourceName: string | undefined): string {
  const base = (sourceName ?? '').replace(/\.[^./\\]*$/, '').trim()
  return (base || 'vectorized') + '.svg'
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'

async function writeTo(handle: FileSystemFileHandle, data: Blob | string): Promise<void> {
  const w = await handle.createWritable()
  await w.write(data)
  await w.close()
}

/** Save a blob through the best path this browser has: an existing handle (overwrite in place),
 *  the save picker (Chromium), or a download. Resolves null when the user cancels the picker. */
async function writeFile(
  blob: Blob,
  name: string,
  handle: FileSystemFileHandle | null,
  asNew: boolean,
  types: PickerType[],
): Promise<{ name: string; handle: FileSystemFileHandle | null } | null> {
  if (handle && !asNew) {
    await writeTo(handle, blob)
    return { name: handle.name, handle }
  }
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: name, types })
      await writeTo(h, blob)
      return { name: h.name, handle: h }
    } catch (err) {
      if (isAbort(err)) return null
      throw err
    }
  }
  downloadBlob(blob, name)
  return { name, handle: null }
}

/** Desktop save. Writes in place when there is a handle and `asNew` is false; otherwise asks
 *  where (Chromium) or downloads. Resolves null when the user cancels the picker. */
export function writeSvgFile(
  text: string,
  name: string,
  handle: FileSystemFileHandle | null,
  asNew: boolean,
) {
  return writeFile(new Blob([text], { type: 'image/svg+xml' }), name, handle, asNew, TYPES)
}

export function writeProjectFile(
  blob: Blob,
  name: string,
  handle: FileSystemFileHandle | null,
  asNew: boolean,
) {
  return writeFile(blob, name, handle, asNew, PROJECT_TYPES)
}

/** What happened to a file sent toward Save to Files. `ready` means the caller should raise the
 *  fresh-tap dialog. */
export type DeliverResult =
  | { kind: 'shared' }
  | { kind: 'dismissed' }
  | { kind: 'downloaded' }
  | { kind: 'ready'; error: string }

/** Injected for tests; the app passes nothing and gets the real ones. */
export type DeliverDeps = {
  canShare?: (file: File) => boolean
  share?: (file: File) => Promise<{ outcome: ShareOutcome; error?: unknown }>
  download?: (blob: Blob, name: string) => void
}

/** Send a finished file toward Save to Files; the caller has checked `saveToFilesAvailable()`.
 *  The sheet opens immediately, riding the tap that started the save (serializing is synchronous,
 *  so the tap is still live). Anything but a completed or dismissed sheet falls through to the
 *  dialog, where a fresh tap opens it. Ported from slop-vector-editor/src/persist/deliver.ts. */
export async function deliverFile(file: File, deps: DeliverDeps = {}): Promise<DeliverResult> {
  const canShare = deps.canShare ?? canShareFile
  const share = deps.share ?? shareFile
  const download = deps.download ?? downloadBlob

  if (!canShare(file)) {
    download(file, file.name)
    return { kind: 'downloaded' }
  }
  const r = await share(file)
  if (r.outcome === 'shared') return { kind: 'shared' }
  if (r.outcome === 'dismissed') return { kind: 'dismissed' }
  // An expired tap is expected and needs no message; a real failure carries the browser's own.
  return { kind: 'ready', error: r.outcome === 'failed' ? errorMessage(r.error) : '' }
}
