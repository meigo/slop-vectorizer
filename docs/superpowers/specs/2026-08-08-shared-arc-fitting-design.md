# slop-vectorizer — Shared-Arc Fitting (v1.6)

**Date:** 2026-08-08
**Status:** Approved (brainstorming session; chosen over a VM-style "stacked shapes" option — the user's actual pain is smoothing gaps between neighboring shapes, and shared-arc fitting eliminates ALL of them at the root while preserving the flat output semantics the user prefers)

## Problem

Adjacent regions share boundary POINTS exactly (byte-identical refined polylines), but each region fits its Bézier curves independently. At high smoothness, the two fits of the same boundary deviate differently within tolerance, opening visible cracks up to ~2× maxErrorPx between abutting shapes. Stacking would fix only parent-child contacts; fitting each shared boundary once fixes every contact by construction.

## The arc model (extractBoundaries)

- **Arc** = maximal run of consecutive boundary points along which the adjacent region PAIR is constant. Arcs end at **junctions** (lattice vertices where ≥3 regions — the image border counts as pseudo-region −1 — meet), or are **closed** (an isolated blob inside a parent: one full-loop arc).
- Tracing and sub-pixel refinement are unchanged (same refined edge-midpoints, same refinement cache). The stage's output becomes:
  - a global **arc table**: each arc's points stored ONCE in a canonical direction, flagged `closed`;
  - per region, each loop as an ordered list of `{ arc, reversed }` references.
- **Canonical direction**: the traversal from the lower-numbered region's side (border pseudo-region −1 counts as lowest). Deterministic.
- **Dedup is exact**: every boundary point maps to an undirected pixel-edge key (the refinement cache's key); an arc is identified by the minimal edge key it covers. Both traversals cover the same edge set ⇒ same identity ⇒ one table entry. Closed arcs are additionally rotated to a canonical start (the point of the minimal edge key) so both sides agree on the sequence origin.
- Border arcs (region vs image edge) participate identically; they're unshared but flow through the same structure.

## Corners (per arc, once)

- Open arcs: multi-scale corner detection (existing thresholds) on the open polyline — scale windows truncate at endpoints instead of wrapping; junction endpoints act as implicit corners (each arc's fit terminates there with one-sided tangents — a ≥3-region meeting point cannot be smooth for all parties).
- Closed arcs: existing closed-loop treatment (wraparound detection; two artificial farthest-point breaks with G1 seams, per the blowup fix).

## Fitting + assembly

- Each arc is fitted ONCE (existing Schneider machinery, tolerance mapping, and blowup guards) → `Cubic[]` in canonical direction, stored per arc.
- A region's output loop = concatenation of its arcs' cubics in reference order, **reversing** cubics where `reversed` (cubic reversal is exact: reverse list, swap p0/c1 with p1/c2). Both neighbors therefore emit mathematically identical shared curves — cracks are impossible by construction at any smoothness.
- G1 is preserved interior to arcs and at the artificial breaks of closed arcs; junction endpoints are corner-like (one-sided), as today's corners are.

## Invariants (must hold)

- Boundary point geometry unchanged ⇒ existing sub-pixel accuracy tests (0.1px circle etc.) pass untouched.
- Determinism: same input + options ⇒ byte-identical SVG.
- `stats.pointCount` continues to count per-path output (a shared curve appears in both paths, as in the file).
- Worker cache tiers unchanged: the boundaries stage caches arcs + per-region references, the corners stage caches per-arc corners, the fit tier re-fits arcs and reassembles.
- All output options (mergePaths, transparentBg, colorOverrides, optimize) consume assembled loops exactly as before — no changes in svg.ts.

## Testing

- **Crack regression (the point of the feature):** two abutting different-colored rectangles on a background, smoothness 1.0 — every shared-boundary cubic in one region's path must appear exactly reversed in the neighbor's path.
- **Junction fixture:** three colors meeting at a point — every assembled loop chains endpoint-to-endpoint and closes; arcs terminate at the junction.
- **Arc table sanity:** every boundary edge belongs to exactly one arc; shared arcs referenced by exactly two regions with opposite directions.
- Existing suite stays green; cubic-count assertions may shift only with stated justification in the implementing task's report.

## Out of scope

Stacked-shapes output arrangement (may be built later on top of the containment data), G2 continuity, arc-level simplification sharing across colors after merge.
