/** Keyboard shortcuts for the File commands. A pure matcher so the mapping is testable without a
 *  DOM: the handler in App.svelte only dispatches what this returns.
 *
 *  ⌘S saves the SVG, not the project: the SVG is what most sessions are after, so the common key
 *  does the common thing (the project saves from the File menu). */
export type Command = 'save' | 'saveAs' | 'open'

/** The fields this reads from a KeyboardEvent; a test passes a plain object. */
export interface KeyLike {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

/** Typing in a field owns its own keys — ⌘S in a text box is still Save, but the app must not
 *  steal anything from a field that handles it. Color inputs and ranges have no text, so only
 *  real text entry counts. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (el as HTMLInputElement).type
  return type !== 'range' && type !== 'color' && type !== 'checkbox' && type !== 'button'
}

/** Which File command this keystroke means, or null. Mac uses ⌘, everything else Ctrl; Alt is
 *  never part of these, so an AltGr composition can't trigger one. */
export function commandFor(e: KeyLike): Command | null {
  const mod = e.metaKey || e.ctrlKey
  if (!mod || e.altKey) return null
  const key = e.key.toLowerCase()
  if (key === 's') return e.shiftKey ? 'saveAs' : 'save'
  if (key === 'o' && !e.shiftKey) return 'open'
  return null
}
