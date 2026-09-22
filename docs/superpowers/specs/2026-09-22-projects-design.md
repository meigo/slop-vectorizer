# slop-vectorizer — Project files and autosave

**Date:** 2026-09-22
**Status:** Approved in conversation

## Motivation

The SVG is output, not a document: it holds no source image, no settings, no colour overrides and no
local-levels circle, and the app cannot open an SVG at all. Reloading the page loses everything. A
project file makes a session keepable and movable; an autosave slot makes an accidental reload
harmless.

## Scope

- A `.zip` project file — save, and open from the start screen. Same shape as slop-animator's
  (media + JSON), same zip library (`fflate`).
- One IndexedDB autosave slot, offered as a **Continue** card on the start screen (never restored
  silently, never destroyed by New image).
- NOT in scope: multiple slots, a project browser, deleting the slot from the UI, embedding project
  data in the SVG.

## Project file

Named after the source image: `logo.png` → `logo.vectorizer.zip` (distinct from `logo.svg`), MIME
`application/zip`. Entries:

- `source.<ext>` — the original file's bytes, unmodified (never re-encoded; the zip is about the
  size of the original). `<ext>` comes from the original name, else from its MIME type, else `bin`.
  Stored uncompressed (level 0): images are already compressed.
- `project.json`:

```jsonc
{
  "app": "slop-vectorizer",
  "version": 1,
  "sourceName": "logo.png", // original file name, for the title and re-saving
  "scale": 1, // Input → Scale
  "options": {
    /* PipelineOptions verbatim: colorOverrides and localLevels (the ACTIVE circle, or null) */
  },
  "localSaved": {
    /* the remembered circle even while the toggle is off, or null */
  }
}
```

View state (zoom/pan, side-by-side vs split, Unmodified) is not saved: it belongs to the window,
not the document.

**Restore order** (matters): decode the source at ×1 first — it is the scale-invariant palette
source that keeps swatch colours stable — then decode at the saved scale, then apply options and
the circle, then vectorize. `localOn` is `options.localLevels !== null`; `localSaved` falls back to
`options.localLevels` when absent.

**Compatibility:** unknown keys are ignored and missing options take `DEFAULT_OPTIONS`, so older
projects keep opening as the app gains options. `version > 1`, a missing `project.json`, a foreign
`app`, or a corrupt zip → a clear error; the current session is left untouched.

**Saving** mirrors Save SVG exactly (`saveFile.ts`): File System Access with a remembered handle on
Chromium (later saves overwrite), Save to Files on iPad, a download elsewhere. The project handle is
separate from the SVG handle.

**Opening:** the start screen's drop zone and file picker also accept `.zip`. While working, New
image returns to the start screen.

## Autosave

One slot in IndexedDB (`localStorage` cannot hold images), holding **the same zip Save project
writes** plus a thumbnail and a timestamp — one serializer, so the slot can never drift from the
file format.

- Record: `{ zip: Blob, sourceName: string, thumb: Blob, savedAt: number }`. Thumbnail: the decoded
  working image scaled to fit 160px, JPEG q0.7.
- Written after a new image or project loads, and ~1s after the last change to options, scale,
  colour overrides or the circle — after the pipeline's result arrives, so it never competes with
  vectorizing. A newer write supersedes an in-flight older one (generation counter, as in
  slop-animator's autosave).
- **Start screen:** with a slot present, a Continue card above the drop zone — thumbnail,
  `sourceName`, and "saved 14:32" (time today, date otherwise). Clicking restores through the
  project-open path.
- **New image never clears it**; it is replaced when the next image or project has its first
  autosave. No delete button.
- Unavailable or unreadable storage: no card, no autosave, no error toast (the user did not ask for
  it). A slot that fails to load is ignored and replaced by the next write.

## Code

- `src/lib/project.ts` (pure) — `packProject(source: Blob, meta): Promise<Blob>`,
  `unpackProject(zip: Blob): Promise<{ source: Blob; sourceName: string; scale: number; options:
  PipelineOptions; localSaved: LocalLevels | null }>`, `projectFileName(sourceName)`.
- `src/lib/autosave.ts` — IndexedDB open/put/get for the single slot, plus the generation guard;
  `makeThumb(image: RasterImage): Promise<Blob>`.
- `src/lib/saveFile.ts` — reused as is for the project's save paths.
- `src/App.svelte` — save/open/restore wiring, the debounced autosave trigger, Continue handling.
- `src/lib/Dropzone.svelte` (or a small `ContinueCard.svelte`) — the card and `.zip` acceptance.
- `src/lib/ControlsPanel.svelte` — the Save project button under Save SVG.
- New dependency: `fflate` (~8 kB), already the family's choice.

## Tests

- Round-trip: pack → unpack gives identical option values, scale, circle and source bytes.
- Old project (options removed from the JSON) fills from `DEFAULT_OPTIONS`; unknown keys ignored.
- Rejections: `version: 2`, foreign `app`, missing `project.json`, non-zip bytes — each a clear
  error, no partial state.
- `projectFileName`: `logo.png` → `logo.vectorizer.zip`; nameless → `vectorized.vectorizer.zip`.
- Autosave debounce/supersede logic as pure functions.
- Browser: reload → Continue restores image, settings, circle and SVG; New image leaves the card;
  Save project → New image → open the zip restores the same session.
