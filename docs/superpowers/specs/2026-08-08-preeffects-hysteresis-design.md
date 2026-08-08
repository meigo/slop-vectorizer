# slop-vectorizer — Pre-effects, Hysteresis, Upscale (v1.2)

**Date:** 2026-08-08
**Status:** Approved (brainstorming session)

## Problem

Thin faint strokes over textured paper classify intermittently at the 50% nearest-color boundary, producing dashed vectorization; despeckle can't fix it (dash fragments are legitimately small — size is the wrong signal, connectivity is the right one). Separately, scanned input benefits from cleanup (levels/blur/saturation) and upscaling before vectorization.

## Feature 1 — Pre-effects stage

New first pipeline stage `pre` in `src/worker/pipeline/preprocess.ts`:

```ts
export interface PreOptions {
  blackPoint: number  // 0–254, default 0
  whitePoint: number  // 1–255, default 255
  blurRadius: number  // 0–10 px, default 0
  saturation: number  // 0–2, default 1
}
export function preprocess(image: RasterImage, opts: PreOptions): RasterImage
```

- Application order: **blur → saturation → levels**.
- Blur: separable 3-pass box blur approximating a Gaussian (radius in px; 0 = skip).
- Saturation: per pixel `v' = lum + (v − lum) × saturation` with `lum = 0.2126R + 0.7152G + 0.0722B`; 0 = grayscale, 1 = identity.
- Levels, per channel: `v' = clamp((v − blackPoint) / (whitePoint − blackPoint), 0, 1) × 255`. If `whitePoint ≤ blackPoint`, treat as `blackPoint + 1`.
- **Identity fast path:** all defaults ⇒ return the input object unchanged (same reference, no timing entry).
- All downstream stages (palette, segmentation, sub-pixel boundary refinement) consume the preprocessed image — one consistent pipeline input.
- `PipelineOptions` embeds these four fields (flat, alongside existing fields). `StageName` gains `'pre'`.
- Worker cache: new top tier — any pre-field or image change ⇒ re-run from `pre`. Tier order: `pre → palette → segment → fit`. The worker caches the preprocessed image.

## Feature 2 — Hysteresis segmentation ("Faint detail")

`PipelineOptions` gains `faintDetail: number` (0–1, default 0). In `segmentImage`:

- Per pixel: d₁ = squared distance to nearest palette color c₁, d₂ = second nearest c₂. Margin `m = (√d₂ − √d₁) / (√d₂ + √d₁ + ε)`.
- **Strong** pixels (`m ≥ faintDetail × 0.5`) label c₁ immediately. `faintDetail = 0` ⇒ every pixel strong ⇒ byte-identical to current behavior.
- **Weak** pixels resolve by deterministic multi-source flood fill: FIFO queue seeded with all strong pixels in row-major order; a weak pixel adopts a claiming neighbor's color only if that color ∈ {c₁, c₂} for that pixel; orphans (never claimed) fall back to c₁.
- Connected components + despeckle run unchanged on the resolved color map.
- Cache tier: `faintDetail` change ⇒ from `segment`.

## Feature 3 — Upscale (decode-time)

`fileToRasterImage(file, upscale: 1 | 2 | 3)` — bicubic-quality resampling via canvas `drawImage` with `imageSmoothingQuality: 'high'`, applied **before** the 4096px clamp. Upscale lives in App state (not `PipelineOptions`): changing it re-decodes the stored original `File`/`Blob` and re-runs the full pipeline as a new image (view refits). App must retain the source blob to allow re-decoding.

## UI (src/lib/Controls.svelte)

Second controls row **"Input"**: Upscale select (×1 default / ×2 / ×3), Black point (0–254), White point (1–255), Blur (0–10, step 0.5), Saturation (0–2, step 0.05), and a **Reset** button restoring identity values. **Faint detail** slider (0–1, step 0.05) joins the first row after Despeckle. All controls fire the existing debounced `onchange`; Upscale fires a separate `onupscale` callback handled by App (re-decode path).

## Compare view feed

Worker result gains optional `preImage?: RasterImage`, included only when pre-effects are non-identity (structured-clone copy — the worker's cached preprocessed image must never be transferred/detached). App displays `result.preImage ?? image` on the bitmap side, so the user sees exactly what the vectorizer sees while tuning. CompareView's fit-to-view `$effect` re-keys from image *reference* to image *dimensions* (`width`/`height`), so per-rerun `preImage` objects don't reset zoom/pan; a genuinely new or re-decoded image (different file or upscale) does refit — and if two images share dimensions, the unchanged view is acceptable behavior.

## Stats

`pre` appears in per-stage timings only when non-identity (identity fast path emits no entry).

## Testing

- `preprocess` unit tests: levels endpoint/midpoint exactness; saturation 0 ⇒ R=G=B; blur preserves mean (±1) and reduces variance on a noise fixture; identity ⇒ same object reference.
- Hysteresis regression (the reason this feature exists): synthetic 1px ~55%-blend stroke over seeded-noise paper — `faintDetail: 0` yields a fragmented stroke (>1 region or missing), `faintDetail: 0.5` yields one connected stroke region surviving default despeckle; deterministic across runs.
- Worker cache tests: `blackPoint` change ⇒ `'pre'`; `faintDetail` change ⇒ `'segment'`; existing tiers unchanged.
- Decode upscale: unit-testable dimension math only (×2 of 100×80 ⇒ 200×160; 3000px at ×2 clamps to 4096) — canvas resampling itself is browser-verified manually.

## Out of scope

Sharpen/brightness/contrast effects, morphological gap closing, per-effect on/off toggles (identity values serve as off), persisting settings across sessions.
