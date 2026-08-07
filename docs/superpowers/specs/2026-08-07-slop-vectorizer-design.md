# slop-vectorizer — Design

**Date:** 2026-08-07
**Status:** Approved (brainstorming session)

## Summary

A client-side Svelte web app that vectorizes logos and flat art into SVG, inspired by Vector Magic's inverse-rendering approach. The distinguishing feature is sub-pixel edge recovery: anti-aliased boundary pixels are treated as coverage measurements, so recovered curves land where the true edge was rather than wobbling along the pixel grid.

## Decisions

| Question | Decision |
|---|---|
| Form factor | Svelte + Vite web app, all client-side (matches slop-paint / slop-animator) |
| Input scope | Anti-aliased logos / flat art with a small palette. Photos out of scope for v1. |
| Algorithm ambition | Sub-pixel pipeline (palette → segmentation → sub-pixel boundaries → corners → Bézier fit). No global Bayesian optimization loop in v1. |
| UI scope | Compare-focused minimal: drop → auto-vectorize → synced compare view → download. No accounts, no history. |
| Algorithm runtime | Plain TypeScript on typed arrays in a Web Worker. WASM is a later option behind the same interface if profiling demands it. |

## Architecture

```
slop-vectorizer/
├── index.html
├── package.json / svelte.config.js / vite.config.ts
├── src/
│   ├── App.svelte              # layout: dropzone → compare view → controls
│   ├── lib/
│   │   ├── CompareView.svelte  # synced zoom/pan, bitmap vs SVG, overlay slider
│   │   ├── Controls.svelte     # color count, smoothness, despeckle, download
│   │   └── Dropzone.svelte
│   ├── worker/
│   │   ├── vectorize.worker.ts # message handler: ImageData in → SVG + stats out
│   │   └── pipeline/           # pure TS, no DOM — one module per stage
│   │       ├── palette.ts
│   │       ├── segment.ts
│   │       ├── boundaries.ts
│   │       ├── corners.ts
│   │       ├── fitcurves.ts
│   │       └── svg.ts
│   └── types.ts                # PipelineOptions, VectorResult, stage types
└── tests/                      # vitest, runs pipeline modules directly in Node
```

**Key boundary:** the worker pipeline is pure functions over typed arrays — `(ImageData, options) → VectorResult`. No Svelte imports, no DOM access. Every stage is unit-testable in Node; UI and algorithm evolve independently.

**Worker protocol:** `{type: 'vectorize', imageData, options}` in; `{type: 'progress', stage, fraction}` events; `{type: 'result', svg, stats}` or `{type: 'error', stage, message}` out. Cancellation = terminate and respawn the worker.

## Algorithm pipeline

1. **Palette estimation** (`palette.ts`) — k-means in RGB/Lab over a downsampled copy. Auto-pick k by scanning 2–16 and taking the elbow of explained variance; UI color-count control overrides. Cluster only low-gradient (interior) pixels so anti-aliased blends don't invent palette entries.

2. **Segmentation** (`segment.ts`) — nearest-palette-color labeling, then despeckle: merge regions below a size threshold into their dominant neighbor. Output: label map + region adjacency.

3. **Boundary extraction + sub-pixel refinement** (`boundaries.ts`) — marching-squares-style tracing of closed boundary loops along pixel edges. Then refine each boundary point against the *original* pixels: anti-aliased intensity is a coverage measurement, so a pixel blended 30% A / 70% B places the true edge at the 30% position along the local gradient direction. Shared boundaries between adjacent regions are computed once, so regions never gap or overlap. Output: sub-pixel polylines per loop.

4. **Corner detection** (`corners.ts`) — classify each vertex corner vs smooth via turning angle over a multi-scale neighborhood (single-scale reads anti-aliasing noise as corners). Corners become curve-segment breakpoints.

5. **Bézier fitting** (`fitcurves.ts`) — piecewise cubic least-squares (Schneider's algorithm) between corners; G1 continuity at smooth joints; error-driven subdivision. UI smoothness parameter scales the error tolerance.

6. **SVG assembly** (`svg.ts`) — one filled `<path>` per region using its palette color, painted back-to-front by area so shared-boundary rounding never shows seams.

## UI & data flow

Single screen. Dropzone accepts drag/drop or paste of anything `createImageBitmap` decodes (PNG, JPEG, GIF, WebP). Decode to `ImageData` on the main thread → worker → per-stage progress → result in `CompareView`.

`CompareView` renders the original bitmap and the SVG in one shared zoom/pan coordinate space with a draggable vertical divider (overlay slider). Deep zoom is first-class — that's where sub-pixel quality is visible.

Controls: color count (auto or 2–16), smoothness slider, despeckle size, Download SVG. Changes re-run the pipeline debounced, reusing cached upstream stages when their inputs are unchanged (e.g. smoothness change re-runs only fitting → SVG). Stats line: path count, point count, per-stage timing.

## Error handling

- Undecodable file → inline message on the dropzone.
- Image over ~4096px on a side → downscale with a visible notice (bounds worker memory).
- Worker exception → toast naming the failed stage; cancel terminates and respawns the worker.

No other error machinery in v1.

## Testing

Vitest, algorithm-first:

- **Per-stage unit tests** with synthetic inputs of known ground truth: anti-aliased circle / rotated square renders — recovered sub-pixel edge points within 0.1px of the true shape; corner detector finds exactly 4 corners on the square, 0 on the circle; palette estimator recovers k for k-colored synthetic images.
- **Round-trip end-to-end test:** rasterize a known SVG, run the pipeline, compare recovered geometry to the source.
- **Fixtures:** a small `fixtures/` set of real logos for visual regression eyeballing in the compare view.
- UI gets a smoke test at most; correctness lives in the pipeline.

## Out of scope for v1

Photos, gradients/gradient meshes, full Bayesian/MAP optimization loop, WASM, wizard-style multi-step UI, touch-up editing, server-side anything.
