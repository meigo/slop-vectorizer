/** One autosave slot in IndexedDB, holding the very zip `packProject` writes plus a thumbnail —
 *  one serializer, so the slot can never drift from the file format. Storage failures are silent:
 *  the user did not ask for this save, so a private window simply has no Continue card. */
import type { RasterImage } from '../types'

const DB = 'slop-vectorizer'
const STORE = 'kv'
const KEY = 'autosave'

export interface AutosaveRecord {
  zip: Blob
  sourceName: string
  thumb: Blob | null
  savedAt: number
}

/** What the Continue card needs — never the zip bytes, so they aren't pinned in memory for
 *  the whole tab session just to render a start-screen card. */
export interface AutosaveSummary {
  sourceName: string
  thumb: Blob | null
  savedAt: number
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function putAutosave(rec: AutosaveRecord): Promise<boolean> {
  try {
    await withStore('readwrite', (s) => s.put(rec, KEY))
    return true
  } catch {
    // Storage unavailable (private window, blocked site data): nothing to tell the user.
    return false
  }
}

export async function getAutosave(): Promise<AutosaveRecord | null> {
  try {
    const rec = await withStore<AutosaveRecord | undefined>('readonly', (s) => s.get(KEY))
    return rec?.zip instanceof Blob && typeof rec.savedAt === 'number' ? rec : null
  } catch {
    return null
  }
}

/** Which write is the newest: an older one that finishes late must not overwrite it. */
export class SaveGeneration {
  private n = 0
  bump(): number {
    return ++this.n
  }
  current(): number {
    return this.n
  }
  isCurrent(n: number): boolean {
    return n === this.n
  }
}

/** A small JPEG for the Continue card; null when canvas encoding is unavailable. */
export async function makeThumb(image: RasterImage, max = 160): Promise<Blob | null> {
  try {
    const scale = Math.min(1, max / Math.max(image.width, image.height))
    const w = Math.max(1, Math.round(image.width * scale))
    const h = Math.max(1, Math.round(image.height * scale))
    const full = new OffscreenCanvas(image.width, image.height)
    full
      .getContext('2d')!
      .putImageData(
        new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height),
        0,
        0,
      )
    const small = new OffscreenCanvas(w, h)
    const ctx = small.getContext('2d')!
    ctx.drawImage(full, 0, 0, w, h)
    return await small.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
  } catch {
    return null
  }
}

export function savedAtLabel(savedAt: number, now = Date.now()): string {
  const d = new Date(savedAt)
  const sameDay = new Date(now).toDateString() === d.toDateString()
  return sameDay
    ? `saved ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`
    : `saved ${d.toLocaleDateString()}`
}
