# slop-vectorizer — Palette Swatches (v1.4)

**Date:** 2026-08-08
**Status:** Approved (brainstorming session; recolor semantics chosen over classification-palette editing)

## Summary

Show the detected palette as clickable swatch squares in the controls panel; clicking one opens a color picker and the chosen color replaces that palette entry's fill in the output SVG. Pure output recoloring: segmentation, merging, and transparent-bg detection are untouched, so an edit can never change or lose shapes.

## Data flow

- Worker result message gains `palette: number[]` (k×3 RGB, copied from the worker's cached palette; always included — a few dozen bytes). `ClientResult` carries it through to App.
- `PipelineOptions` gains `colorOverrides: (string | null)[] | null` (default null). Hex strings (`#rrggbb`), index-aligned with the palette; `null` entry = detected color unchanged; `null` array = no overrides.
- `SvgOptions` gains the same field. `assembleSvg` emits `colorOverrides?.[paletteIndex] ?? hex(detected)` as the fill. Out-of-range/short arrays are handled as "no override" (defensive).
- Cache tier: a `colorOverrides` change routes to the existing `'fit'` fallthrough (cheap tail re-run). No new tiers.
- Transparent-bg interaction: none — bg is dropped by palette *index* before fills are emitted.
- Determinism: overrides are part of options ⇒ same input + options ⇒ identical bytes, unchanged.

## Staleness

Overrides are only meaningful against the palette they were made for. App keeps the palette array from the latest result; when a new result's palette differs (different length or any RGB value), App resets `colorOverrides` to null before the next edit. (Slider tweaks that don't change the palette — smoothness, output toggles — keep overrides alive; changing color count, a new image, or a palette-shifting pre-effect clears them.)

## UI (ControlsPanel, Vectorize section, under the Colors select)

- A wrap row of k swatch squares (~22px, 1px border, radius 4) showing the effective color (override ?? detected), tooltip = hex.
- Each swatch overlays a hidden native `<input type="color">` initialized to the effective color; picking a color sets `colorOverrides[i]` and fires the standard debounced `onchange`.
- Overridden swatches show a small ring/dot indicator; a "reset colors" link (visible only when ≥1 override) clears all overrides and fires `onchange`.
- Swatches render only when a result with a palette exists.

## Testing

- `svg.test`: override changes exactly its index's fill and no others; combined with `mergePaths` and `optimize`; short/absent arrays are no-ops.
- `e2e.test`: vectorize with `colorOverrides` recolors the expected path; byte-determinism with overrides active.
- `workerCache.test`: `colorOverrides` change ⇒ `'fit'`.
- Staleness reset is App logic verified by check/build + manual QA (no component test harness).

## Out of scope

Classification-palette editing (re-clustering to user colors), adding/removing/merging palette entries, per-region recoloring, palette import/export.
