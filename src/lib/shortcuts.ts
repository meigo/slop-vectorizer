/** Keyboard shortcuts for the File commands. A pure matcher so the mapping is testable without a
 *  DOM: the handler in App.svelte only dispatches what this returns.
 *
 *  ⌘S saves the SVG, not the project: the SVG is what most sessions are after, so the common key
 *  does the common thing (the project saves from the File menu). */
export type Command = 'save' | 'saveAs' | 'open'

/** The fields this reads from a KeyboardEvent; a test passes a plain object. */
export interface KeyLike {
  key: string
  code?: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

/** Typing in a field owns its own keys (the app's paste must not take a field's paste). Color
 *  inputs and ranges have no text, so only real text entry counts. The File shortcuts don't ask:
 *  no field handles ⌘S or ⌘O, so they work from a text box or a focused select too. */
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
 *  never part of these, so an AltGr composition can't trigger one. The letter comes from the
 *  layout when it is a Latin one (so AZERTY's S is S), else from the physical key: on a Russian
 *  layout Ctrl+S reports 'ы'. */
export function commandFor(e: KeyLike): Command | null {
  const mod = e.metaKey || e.ctrlKey
  if (!mod || e.altKey) return null
  const typed = e.key.toLowerCase()
  const key = /^[a-z]$/.test(typed)
    ? typed
    : (/^Key([A-Z])$/.exec(e.code ?? '')?.[1].toLowerCase() ?? typed)
  if (key === 's') return e.shiftKey ? 'saveAs' : 'save'
  if (key === 'o' && !e.shiftKey) return 'open'
  return null
}
