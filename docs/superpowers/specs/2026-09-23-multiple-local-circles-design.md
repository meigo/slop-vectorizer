# slop-vectorizer — Multiple local-levels circles

**Date:** 2026-09-23
**Status:** Approved in conversation
**Supersedes:** the single-circle scope of `2026-09-22-local-levels-design.md` (everything else there still holds)

## Motivation

One circle covers "face versus body". Real drawings need more: a face, a hand, a dark corner of the
paper. The single circle also has no way to ask "is this adjustment helping?" without deleting it.

## Scope

- Any number of circles, as an ordered list with add, delete, select and hide.
- NOT in scope: renaming circles, drag-to-reorder, per-circle blur, copying a circle between
  projects. The list being ordered leaves room for reordering later.

## Model

`PipelineOptions.localCircles: LocalCircle[]`, default `[]`, replacing `localLevels`.

```ts
interface LocalCircle {
  cx: number // centre, fraction of image width
  cy: number // centre, fraction of image height
  inner: number // full-strength radius, fraction of image WIDTH
  outer: number // zero-strength radius, fraction of image width; outer >= inner
  blackPoint: number // 0..254
  whitePoint: number // 1..255
  hidden: boolean // kept in the list, but has no effect on the output
}
```

**Stacking (painter order).** For each pixel: start from the globally-levelled value, then for each
visible circle in list order, compute **that circle's own mapping of the ORIGINAL tone** (the value
after flatten/blur/saturation, as today) and blend it over the running result by the circle's
weight. Each circle levels the original, never the previous circle's output — otherwise overlapping
circles would stretch the tones twice and neither would do what its sliders say. Consequences:

- a circle's full-strength middle always shows exactly its own levels;
- only soft edges mix, so overlaps never seam;
- a later circle wins over an earlier one where both are at full strength.

`localWeight` is unchanged. A circle is **effective** when it is not hidden and its points differ
from the global ones; only effective circles are computed, and a list with none of them is an
identity (byte-identical output to a build without the feature).

**Palette still ignores every circle** (`globalPre` clears `localCircles`), so swatches and colour
overrides never move while tuning — as in the single-circle spec.

**Cost.** Per circle, a bounding-box test precedes any distance maths, so pixels outside every
circle keep today's fast path; several small circles cost far less than one large one. Edits stay on
the existing 150 ms debounce.

**Cache.** Any change to the effective list dirties the `pre` stage (structural comparison of the
effective circles); it never counts toward palette re-estimation.

## UI

**Panel — the "Local levels" section:**

- Header carries **+** (add) and **delete**; delete acts on the selected row and is disabled with no
  selection. Destructive control out of the rows, per the family guide.
- **Rows:** an eye toggle (hide), the label `Circle <n>`, and the selected row drawn with the
  family's selected-row treatment (accent tint plus a 2px left edge, both out of flow).
- **Below the list:** Black point / White point sliders for the selected circle, plus the drag hint.
  Hidden entirely when nothing is selected.
- **Labels are positions** (`Circle 1` is the first row): deleting renumbers the rows below. The list
  is short and this keeps circles stateless — no stored names.
- **Add** places a circle in the middle of the current view (`initialLocal`, as today) with the
  current global points, appends it and selects it. **Delete** selects the neighbouring row.
- The single-circle on/off toggle is gone: an empty list is off.

**Canvas:**

- Every visible circle is drawn. **Selected:** centre dot and both rings, as today. **Unselected:**
  one thin ring, no handles. **Hidden:** a dashed outline, no handles.
- Pointer down on an unselected circle **selects it and begins the drag in the same gesture**.
- Overlapping circles: the topmost (latest in the list) takes the click.
- Hidden circles ignore clicks; unhide to edit.
- Unchanged: panning outside any circle, pinch-zoom, the ring drag rules (inner pushes outer, outer
  clamps to inner), the interior-move cap that keeps a large circle from blocking panning, and the
  coarse-pointer hit slop.

## Project files

Format **version 2**, storing `localCircles`; `project.json` otherwise unchanged.

- **v1 files open unchanged in meaning:** `options.localLevels` becomes a one-item list. A v1 file
  whose circle was remembered but switched off (`localSaved` set, `localLevels` null) becomes a
  **hidden** circle, so nothing is lost.
- A **v2 file in an older build** is refused with the existing "made by a newer version" message,
  rather than silently dropping circles.
- Autosave is unaffected: it stores whatever the serializer writes.
- **Selection is not saved** — view state, like zoom and split mode.

## Code

- `src/types.ts` — `LocalCircle`, `PipelineOptions.localCircles`; `LocalLevels` removed.
- `src/worker/pipeline/preprocess.ts` — stacked blend, effective-list helpers, `globalPre`.
- `src/worker/vectorize.worker.ts`, `src/worker/pipeline/index.ts` — pass the list; dirty rule.
- `src/lib/localGizmo.ts` — hit test across a list (topmost first, skipping hidden), returning which
  circle and which part; drag helpers unchanged per circle.
- `src/lib/LocalGizmo.svelte` — draw one circle in one of three states (selected / unselected /
  hidden); the panes render one per circle.
- `src/lib/ImagePane.svelte`, `src/lib/CompareView.svelte` — select-and-drag routing.
- `src/lib/ControlsPanel.svelte` — the list, its header buttons, the selected circle's sliders.
- `src/App.svelte` — selection state, add/delete/hide, first-add placement.
- `src/lib/project.ts` — version 2 and the v1 migration.

## Tests

- Stacking: a later circle's middle maps exactly by its own points; an earlier circle's middle is
  untouched outside the later one; the overlap lies between the two; an empty list is byte-identical
  to no feature; hidden circles are skipped; a circle whose points equal the global ones is a no-op.
- Weight and drag rules: unchanged behaviour per circle.
- Hit test: topmost non-hidden circle wins; hidden circles are transparent to clicks; the
  interior-move cap still applies.
- Project: v1 single circle → one-item list; v1 remembered-but-off → one hidden circle; v2
  round-trip; `version: 3` refused.
- Cache: a change to any circle dirties `pre`; hiding an already-ineffective circle does not; the
  palette is never re-estimated.
- Browser: three overlapping circles, select by clicking each, hide/show, delete the middle one,
  then save and reopen the project.
