# slop-vectorizer — Full-screen Compare UI (v1.3)

**Date:** 2026-08-08
**Status:** Approved (brainstorming session with visual companion; user selected layout B of three mockups)

**Sequencing dependency:** builds on the Controls state of PR #1 (pre-effects/gap-closing/upscale branch `worktree-preeffects-gapclosing`). Implementation starts after that PR merges to main, or stacks on its branch if it is still open.

## Summary

Replace the boxed, page-flow layout with a full-viewport workspace: two zoom/pan-synced image panes (Original | SVG result) filling the screen, and a fixed 300px controls panel on the right. The existing divider-split view survives as a second comparison mode behind a toggle. Reference: Vectorizer.AI's compare screen.

## Layout

- `html, body, #app`: full viewport, no margins; app root is a CSS grid `grid-template-columns: 1fr 300px`, height `100vh`. No page `<h1>` — the app name moves into the panel header.
- Left cell hosts the active view mode; right cell is the controls panel.
- **Empty state (no image):** the dropzone alone, centered in the full viewport; the panel is hidden until the first successful decode. "New image" returns to this state.

## View modes

- **Side-by-side (default):** two equal panes in the left cell. Left pane renders the bitmap (preprocessed when pre-effects are active: `result.preImage ?? image`, exactly as today); right pane renders the SVG over the checkerboard. Corner labels "Original" / "SVG". Wheel-zoom (around cursor, 0.1–64×) and drag-pan in **either** pane move **both** — one shared viewport.
- **Split:** the existing divider CompareView, now full-height in the left cell, consuming the same shared viewport state.
- Toggle lives at the top of the panel (View section). Switching modes preserves the current zoom/pan.

## Architecture

- `src/lib/viewport.svelte.ts` — shared viewport state: `class Viewport { zoom; panX; panY; wheelAt(cx, cy, deltaY); panBy(dx, dy); fitTo(cw, ch, iw, ih) }` built on `$state` fields. The fit math (`computeFit(cw, ch, iw, ih) → {zoom, panX, panY}`, min zoom = fit-or-1, centered) is a pure exported function.
- `src/lib/ImagePane.svelte` — one pane: props `{ image: RasterImage | null, svg: string | null, label: string, viewport: Viewport }`; renders canvas (putImageData, pixelated) when `image` given, else `{@html svg}` sized to viewBox dims; applies the shared transform (clip on an untransformed wrapper is not needed here — each pane owns its whole area); forwards wheel/pointer events to the viewport.
- `CompareView.svelte` (split mode) drops its local zoom/pan state and consumes the shared `Viewport`; its divider/clip mechanics stay unchanged.
- `src/lib/ControlsPanel.svelte` — replaces `Controls.svelte` (same option bindings and callbacks, new layout). Sections top-to-bottom:
  1. Header: app name, **New image** button
  2. **View**: mode toggle (side-by-side / split), **Fit** button (re-runs fit for the current pane size)
  3. **Vectorize**: Colors, Smoothness, Despeckle, Gap closing
  4. **Input**: Upscale, Black point, White point, Blur, Saturation, Reset
  5. **Output**: Optimize, Merge colors, Transparent bg
  6. **Download SVG** button
  7. Footer: stats line (paths · points · ms · kB, per-stage timings) and the downscale notice when applicable
- Fit-to-view triggers, as today, when image dimensions change (dimension-keyed), computed against the active mode's pane size.

## Addendum (v1.3.1): fit-until-touched resize refit

`Viewport` gains a `touched` flag ($state, initially false): set by `wheelAt()` and `panBy()` (manual adjustment), cleared by `fitTo()` (fitting re-arms auto-fit; the Fit button and every new-image fit therefore re-arm it). App adds one `$effect` that reads the active pane geometry (`viewsW`, `viewsH`, mode/column state — the same inputs `fit()` uses) and `viewport.touched`, and calls `fit()` on any pane-geometry change while `touched` is false. This yields: auto-refit on window resize until the user manually zooms/pans; deliberate zoom/pan is never yanked by a resize; mode toggles and the split-mode result-arrival column flip also refit while untouched (resolving the parked half-width edge from the final review). No pipeline changes.

## Unchanged

Pipeline, worker, decode, options semantics, debounced re-runs, 'cancelled' handling, error toasts (they overlay the viewport), drag/drop + paste + click-to-browse on the dropzone.

## Testing

- Pure `computeFit` unit tests (fit-below-1 clamp, centering, tall/wide images).
- The existing 67-test suite must pass unchanged (pipeline untouched).
- Everything else is `npm run check` + build + manual QA: mode toggle preserves zoom/pan, sync works from either pane, panel controls all fire re-runs, empty state round-trips via New image.

## Out of scope

Mobile/responsive layout, collapsible panel, keyboard shortcuts, persisting view mode across sessions. (Fit-on-window-resize was out of scope for v1.3; added in the v1.3.1 addendum above.)
