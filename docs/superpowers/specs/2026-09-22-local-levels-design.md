# slop-vectorizer — Local Levels

**Date:** 2026-09-22
**Status:** Approved in conversation (scope: black/white point only, one region)

## Motivation

One pair of levels rarely suits a whole image: a character's face wants different black/white
points than its body to keep (or drop) a different kind of detail. A single circular region with a
soft edge gets its own black/white point, blended into the global ones.

## Scope

- Overrides **black point and white point only**. Blur/saturation/flatten stay global (flatten fits
  a sheet-wide gradient and is meaningless locally). Blur is the obvious later addition.
- **One region**, on or off. The option shape leaves room for a list later; nothing else is built
  for it now.
- Acts on the **input** (the `pre` stage). An output-side region would need two vectorizations
  spliced with seams.

## Option

`PipelineOptions.localLevels: LocalLevels | null`, default `null` (off).

```ts
interface LocalLevels {
  cx: number // centre, fraction of image width
  cy: number // centre, fraction of image height
  inner: number // full-strength radius, fraction of image width
  outer: number // zero-strength radius, fraction of image width; outer >= inner
  blackPoint: number // 0..254
  whitePoint: number // 1..255
}
```

Normalised coordinates keep the circle round and in place across Scale changes. Off is sent as
`null`; the last circle and values are kept in UI state so re-enabling restores them.

## Pipeline

- **Weight** `localWeight(dist, inner, outer)`: 1 for `dist <= inner`, 0 for `dist >= outer`,
  smoothstep between; `inner === outer` is a hard edge. Exported from `preprocess.ts`.
- **Blend** in `preprocess`, after flatten/blur/saturation as today: each channel is levelled with
  the global points AND with the local points, and the two results are mixed by the pixel's weight.
  Mixing outputs (not the points) keeps the mapping monotonic in tone everywhere — no halos.
  Pixels with weight 0 take the existing fast path.
- **Identity**: `isIdentityPre` is also true only when `localLevels` is null or its points equal
  the global ones.
- **Palette ignores local levels**: estimated from the globally-preprocessed palette source as
  today. Keeps circle drags off the slowest stage and swatches/overrides stable. Trade-off: a tone
  that exists only inside the circle snaps to the nearest existing colour instead of getting its
  own swatch.
- **Cache**: any `localLevels` change makes `firstDirtyStage` return `'pre'`; it does not count in
  `preFieldsChanged`, so the palette is not re-estimated.

## UI

**Panel:** new "Local levels" section below Input: an on/off toggle (the family fill-on toggle),
then Black point / White point sliders with readouts, shown while on. First enable places the
circle at the centre of the current view with `inner` ≈ ¼ of the visible short side (image px),
`outer` = 1.5 × `inner`, and copies the current global points, so enabling changes nothing visible.
Off hides the gizmo and removes the effect. New image resets it to never-enabled.

**Gizmo** (drawn on both panes and in split view while on):
- centre dot — drag to move; dragging anywhere inside the inner ring also moves;
- inner solid ring — drag to resize; pushes the outer ring out if it would cross it;
- outer dashed ring — drag to set the soft edge; clamped to `>= inner`;
- dragging elsewhere pans, two fingers pinch-zoom, exactly as today.

Handles are a constant screen size (overlay SVG outside the zoom transform), white with a dark
outline to read on light and dark artwork, and get ~12px wider hit zones under
`(any-pointer: coarse)`. The cursor shows move/resize over each part. Gizmo changes rerun through
the existing 150 ms debounce. The Unmodified toggle still shows the input before all levels.

## Code

- `src/types.ts` — `LocalLevels`, `PipelineOptions.localLevels`, default `null`.
- `src/worker/pipeline/preprocess.ts` — `localWeight`, blend, identity rule.
- `src/worker/vectorize.worker.ts` — pass `localLevels` into `PreOptions`; dirty-stage rule.
- `src/lib/localGizmo.ts` (new, pure) — screen↔image mapping from the viewport, hit test
  (`'move' | 'inner' | 'outer' | null`), drag update with the ring constraints.
- `src/lib/LocalGizmo.svelte` (new) — the overlay; used by `ImagePane` and `CompareView`, which
  route a pointer-down to it when the hit test claims it, else pan.
- `src/lib/ControlsPanel.svelte`, `src/App.svelte` — section, state, first-enable placement, reset.

## Tests

- `localWeight`: 1 inside, 0 outside, monotonic non-increasing, hard edge when equal.
- `preprocess`: inside pixel = local levels, outside = global, fade pixel strictly between;
  `localLevels` equal to global ⇒ identical output to no region.
- Worker cache: `localLevels` change ⇒ `'pre'`, palette not re-estimated; `null` ⇒ identity.
- `localGizmo`: hit test across zoom/pan, `outer >= inner` held by both ring drags, normalised
  coords survive a scale change.
- Browser: place and shape the circle on a real image, confirm the SVG follows while dragging.
