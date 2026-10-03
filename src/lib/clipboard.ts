/** The clipboard by tap, for an iPad with no keyboard (no Cmd+V, so no paste event). Reading
 *  asks the browser each time: an image copied in another app is invisible until then, so the
 *  buttons are never dimmed, and a refusal or a non-image is reported in words that tell the
 *  cases apart. Copying writes the SVG as text/plain, which slop-vector-editor's paste takes. */

/** The first image type among a clipboard item's types, if any. */
export function imageType(types: readonly string[]): string | undefined {
  return types.find((t) => t.startsWith('image/'))
}

/** What the clipboard holds, for the no-image message: "text/plain, text/html" or "nothing". */
export function clipboardTypes(items: readonly { types: readonly string[] }[]): string {
  const types = [...new Set(items.flatMap((i) => [...i.types]))]
  return types.length ? types.join(', ') : 'nothing'
}

export type ClipboardRead = { kind: 'image'; file: File } | { kind: 'error'; message: string }

/** The first image on the system clipboard. Call it straight from the tap: `read()` runs before
 *  any await, so Safari still counts it as the user's. */
export async function readClipboardImage(): Promise<ClipboardRead> {
  let items: ClipboardItems
  try {
    if (!navigator.clipboard?.read) throw new Error('not supported in this browser')
    items = await navigator.clipboard.read()
  } catch (e) {
    // Say what the browser said: a dismissed Paste callout, a blocked permission and no support
    // each have a different remedy.
    const why = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    return { kind: 'error', message: `Can't read the clipboard (${why})` }
  }
  for (const item of items) {
    const type = imageType(item.types)
    if (!type) continue
    const blob = await item.getType(type)
    // Nameless, like a pasted file, so the SVG is saved as vectorized.svg.
    return { kind: 'image', file: new File([blob], '', { type }) }
  }
  return {
    kind: 'error',
    message: `No image on the clipboard (it holds: ${clipboardTypes(items)})`,
  }
}
