# slop-vectorizer — Stacked Shapes (v1.7)

**Date:** 2026-08-09
**Status:** Approved (design per docs/ROADMAP.md entry, activated by user for the file-size benefit)

## Motivation

File size: flat/cutout output serializes every boundary twice (once as a shape's outline, once as the
neighbor's hole) and traces the background around every shape. Stacked output serializes each
boundary once and reduces the background to its outer rectangle — roughly halving boundary geometry
on typical art, most visibly with non-transparent backgrounds. (The original gap motivation was
already solved by shared-arc fitting; overlap-safety is moot since abutting curves are identical.)

## Option

`PipelineOptions.stackedShapes: boolean`, default `false`. Output section checkbox "Stacked shapes".
While ON: `mergePaths` and `transparentBg` are IGNORED by the pipeline and their checkboxes disabled
in the UI (per-color grouping breaks per-region stacking order; dropping bg-colored regions is wrong
when a solid parent extends beneath a counter). Cache tier: `'fit'` fallthrough (no new tiers).

## Pipeline (fit + svg stages only)

- **Outer loop only:** per region, emit only its largest-|polygonArea| loop (regions are 4-connected
  components ⇒ exactly one outer loop; the rest are holes). A used-arc guard skips fitting arcs no
  kept loop references — in practice every arc is the inner side's outer loop, so the win is in
  serialization, not fitting. Loop polylines come from `loopPointsOf` as today.
- **Stack order:** regions sorted ascending by the row-major index of their first pixel in
  `seg.labelMap` (one O(n) scan, only when stacked is on). If B contains A, B's first pixel precedes
  A's ⇒ containers always paint first; siblings follow scan order (harmless — solid siblings don't
  overlap). `RegionPath` gains `stackOrder?: number`; `SvgOptions` gains `stackedShapes: boolean` and
  sorts by `stackOrder` ascending instead of area descending when set.
- Determinism preserved. `stats.pathCount`/`pointCount` reflect the (smaller) stacked output.

## Testing

- Nested-ring fixture (bg / ring / inner disc): stacked ⇒ 3 paths, each a SINGLE subpath (total M
  count 3 vs 5 flat), painted in containment order (bg, ring, disc — the disc must come after the
  ring or it would be hidden); stacked SVG strictly smaller than flat non-merged SVG of the same
  input.
- Interplay: with stacked on, `transparentBg: true` and `mergePaths: true` have no effect (byte-equal
  to stacked with them off).
- `workerCache`: `stackedShapes` change ⇒ `'fit'`.
- Crack invariance is inherited (shared arcs) and not re-tested here.

## Out of scope

Stacked + merge coexistence (same-layer grouping), stacked + transparent bg (hole restoration),
containment-tree exposure in the UI.
