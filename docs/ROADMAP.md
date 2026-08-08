# Roadmap / deferred features

Ideas evaluated and consciously deferred — with enough design context to pick them up cold.

## Stacked / layered shapes (VM-style output arrangement)

**Status:** IMPLEMENTED 2026-08-09 (`docs/superpowers/specs/2026-08-09-stacked-shapes-design.md`) —
activated for file size: each boundary serialized once instead of twice; measured 11–37% smaller than
the flat+merge default on test fixtures. Deferred remainder: stacked+merge coexistence,
stacked+transparent-bg, a deep-nesting e2e fixture (verified empirically at 4 levels, not in suite).

**What it is:** instead of the current flat/cutout output (shapes tile the plane exactly, holes where
other colors sit inside), shapes are emitted solid and extended *beneath* whatever nests inside them,
painted in containment order — background as a plain rectangle first, nested shapes on top. Vector
Magic exposes this as its "stacked" arrangement.

**Remaining value:**
- Editor cleanup ergonomics (the real payoff): deleting/moving a shape in Affinity/Illustrator leaves
  continuous paint underneath instead of a shape-shaped hole. Best substrate for hand-editing away
  unwanted shapes.
- Fewer holes and much simpler low-stack shapes (background = 4 points instead of tracing every
  letter outline in negative); lower point counts.
- The familiar VM output structure.

**Costs:** correctness becomes z-order-dependent; shapes extend invisibly beyond their visible area
(surprises with semi-transparent fills); conflicts with `Transparent bg` (dropping bg-colored regions
is wrong when a solid parent sits beneath a bg-colored counter — would need hole restoration or the
combo disabled) and complicates `Merge colors` (per-color grouping breaks per-region stacking order).

**Implementation sketch (small, post-shared-arcs):**
- Outer loop per region = its largest-|polygonArea| loop (regions are 4-connected components ⇒
  exactly one outer loop + holes). Stacked mode emits ONLY the outer loop; hole fitting skipped.
- Paint order = regions sorted by row-major index of their first pixel in the label map (one O(n)
  scan). If B contains A, B's first pixel precedes A's ⇒ containers always paint first; siblings in
  scan order (harmless — solid siblings don't overlap).
- Surface as an `Output → Stacked shapes` toggle; disable `Transparent bg` + `Merge colors` while on
  (v1). Fit/svg-stage change + UI — comparable effort to the output-options feature.

**Decision rule recorded with the user:** build it if/when hand-cleanup of vectorized output in an
external editor becomes a regular workflow; skip while it stays occasional.
