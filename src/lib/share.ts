/** Save to Files, via the share sheet (`navigator.share` with files). The only way a web page on
 *  iPad can put a file somewhere the user picks: Safari has no save picker, and a download always
 *  lands in Downloads as a new, possibly renumbered copy. Whether Files then offers to replace a
 *  same-named file is up to iPadOS. Ported from slop-vector-editor/src/persist/share.ts. */

/** Why a share did not complete. `needs-tap`: Safari only opens the sheet during a recent tap, and
 *  building the file took long enough for the tap to expire, so a fresh one is needed. */
export type ShareFailure = 'dismissed' | 'needs-tap' | 'failed'
export type ShareOutcome = 'shared' | ShareFailure

/** The slice of `navigator` this module asks about, so a test can pass its own. Method shorthand
 *  is deliberate: it gets bivariant parameter checking, which `Navigator.canShare` needs. */
type ShareCapable = { canShare?(data: unknown): boolean }

/** iPhone / iPad. iPadOS Safari reports a Mac user agent and `MacIntel`, so a UA test alone misses
 *  every modern iPad; a Mac platform WITH touch points is an iPad, since no Mac has a touch screen. */
export function isAppleTouch(ua: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1)
}

export function classifyShareError(e: unknown): ShareFailure {
  const name = typeof e === 'object' && e !== null ? (e as { name?: unknown }).name : undefined
  if (name === 'AbortError') return 'dismissed'
  if (name === 'NotAllowedError') return 'needs-tap'
  return 'failed'
}

/** Whether this device gets Save to Files at all. Desktop share sheets have no Save to Files, so
 *  offering it where a real save picker exists would be a downgrade. */
export function saveToFilesAvailable(): boolean {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.canShare !== 'function' ||
    typeof navigator.share !== 'function'
  )
    return false
  return isAppleTouch(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)
}

/** Whether the share sheet accepts this particular file: `image/svg+xml` is not guaranteed. */
export function canShareFile(
  file: File,
  nav: ShareCapable | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): boolean {
  try {
    return nav?.canShare?.({ files: [file] }) ?? false
  } catch {
    return false
  }
}

export async function shareFile(file: File): Promise<{ outcome: ShareOutcome; error?: unknown }> {
  try {
    await navigator.share({ files: [file] })
    return { outcome: 'shared' }
  } catch (error) {
    return { outcome: classifyShareError(error), error }
  }
}
