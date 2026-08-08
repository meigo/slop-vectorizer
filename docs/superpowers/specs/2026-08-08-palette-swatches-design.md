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

## Addendum (v1.4.1): tolerance-based staleness

Exact palette comparison reset overrides on any re-estimation wobble — notably an Upscale change (re-decode → resampled pixels → k-means lands ±few RGB units off), discarding still-valid overrides for the same artwork. Staleness now uses tolerance: overrides are KEPT when the new palette has the same length and every entry lies within Euclidean distance 20 (RGB units) of the previous entry at the same index (index alignment holds because the palette is luminance-sorted); they reset on different k or any entry moving beyond tolerance. Accepted trade-off: repeated small palette drifts can carry overrides beyond cumulative tolerance — benign direction (user-chosen colors persist; the reset link remains).

## Addendum (v1.4.2): nearest-color override migration (supersedes v1.4.1)

Probing showed tolerance-based index comparison was insufficient: auto-k is scale-sensitive (texture noise at 1x can split a cluster that upscaling re-merges — measured k=4 at 1x vs k=3 at 2x on the same artwork), so the palette LENGTH changes and any index-aligned scheme resets. Overrides now MIGRATE via nearest-color matching (`src/lib/paletteRemap.ts`, unit-tested): each override follows its old palette color to the nearest new palette color within Euclidean tolerance 20; closest wins when two compete for one entry; an override drops only when nothing is near. Additionally, prop values now preserve their MEANING across upscale changes: gapClosing rescales proportionally with the factor (same physical bridge width, exact round-trips, always within the scaled slider max — replacing the down-clamp), and a deliberately framed view (touched viewport) keeps its exact framing across the re-decode (zoom ÷ factor, pan unchanged) instead of refitting.

## Addendum (v1.4.3): scale-invariant palette source

Probing k=3 fixtures showed mid-gray palette clusters drift materially across upscale re-decodes (measured 115 → 101 → 125 across ×1/×2/×3; black and paper stay anchored) because resampled edge-blend ramps feed the middle clusters differently at each scale — and auto-k can flip entirely. Per user direction, the palette is now always estimated from the ORIGINAL ×1 decode: App retains `baseImage` (the ×1 decode of the current file) and sends it as `paletteImage` with decode-triggered vectorize calls (not slider re-runs); the worker caches it (`sameImageData`-checked) and the palette stage reads it — preprocessed with the current pre-effect options — instead of the working image. A working-image-only change (upscale re-decode) no longer re-estimates the palette at all: swatch colors are constant across scale changes by construction, and override migration is exact. Fallback: with no palette source cached (tests, first message), the working image is used as before. e2e pins the invariant: an upscaled run with `paletteImage` emits exactly the fill set of the ×1 run.
