# slop-vectorizer — Pre-effects, Gap Closing, Upscale (v1.2)

**Date:** 2026-08-08
**Status:** Approved (brainstorming session; Feature 2 revised from hysteresis to gap closing after the flood-fill approach was shown to lose thin-stroke gap pixels to the surrounding background — thin structures are minority neighborhoods, so connectivity claiming and neighborhood voting structurally favor background; the dashes' alignment is the real signal, which morphological closing captures)

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

## Feature 2 — Gap closing

`PipelineOptions` gains `gapClosing: number` (integer 0–3 px, default 0). In `segmentImage`, after nearest-color labeling and before connected components:

- Skip entirely when `gapClosing === 0` (byte-identical to current behavior).
- Process palette colors in ascending global pixel-count order (rarest first — detail classes close before dominant ones); the most common color (background) never closes.
- For color c: binary mask M = pixels labeled c. Morphologically close M with a Chebyshev (square) structuring element of radius r = `gapClosing`: dilate then erode, each as two-pass 1-D min/max filters. A gap of length ≤ 2r along a stroke bridges; sides return to original width (no net thickening).
- **Guard:** a pixel newly covered by the closed mask flips to c only if `√d_c ≤ 1.3 × √d_current`, where d_c / d_current are its squared distances to color c and to its currently assigned color. Ambiguous mid-blend gap pixels flip; clear background between genuinely separate strokes resists welding.
- A pixel flips at most once per segmentation pass (first closing color to claim it wins; later colors see the updated labels).
- Connected components + despeckle run unchanged on the resolved color map.
- Cache tier: `gapClosing` change ⇒ from `segment`.

## Feature 3 — Upscale (decode-time)

`fileToRasterImage(file, upscale: 1 | 2 | 3)` — bicubic-quality resampling via canvas `drawImage` with `imageSmoothingQuality: 'high'`, applied **before** the 4096px clamp. Upscale lives in App state (not `PipelineOptions`): changing it re-decodes the stored original `File`/`Blob` and re-runs the full pipeline as a new image (view refits). App must retain the source blob to allow re-decoding.

## UI (src/lib/Controls.svelte)

Second controls row **"Input"**: Upscale select (×1 default / ×2 / ×3), Black point (0–254), White point (1–255), Blur (0–10, step 0.5), Saturation (0–2, step 0.05), and a **Reset** button restoring identity values. **Gap closing** slider (0–3 px, step 1) joins the first row after Despeckle. All controls fire the existing debounced `onchange`; Upscale fires a separate `onupscale` callback handled by App (re-decode path).

## Compare view feed

Worker result gains optional `preImage?: RasterImage`, included only when pre-effects are non-identity (structured-clone copy — the worker's cached preprocessed image must never be transferred/detached). App displays `result.preImage ?? image` on the bitmap side, so the user sees exactly what the vectorizer sees while tuning. CompareView's fit-to-view `$effect` re-keys from image *reference* to image *dimensions* (`width`/`height`), so per-rerun `preImage` objects don't reset zoom/pan; a genuinely new or re-decoded image (different file or upscale) does refit — and if two images share dimensions, the unchanged view is acceptable behavior.

## Stats

`pre` appears in per-stage timings only when non-identity (identity fast path emits no entry).

## Testing

- `preprocess` unit tests: levels endpoint/midpoint exactness; saturation 0 ⇒ R=G=B; blur preserves mean (±1) and reduces variance on a noise fixture; identity ⇒ same object reference.
- Gap-closing regression (the reason this feature exists): synthetic fixture with a thick anchor stroke (so the palette finds true ink) plus a 1px thin stroke whose ink coverage oscillates 40–60% along its length over seeded-noise paper — `gapClosing: 0` yields a fragmented thin stroke (multiple regions), `gapClosing: 2` yields one connected stroke region surviving default despeckle; two genuinely separate parallel strokes 3px apart with clean paper between them must NOT weld at `gapClosing: 2` (guard test); deterministic across runs.
- Worker cache tests: `blackPoint` change ⇒ `'pre'`; `gapClosing` change ⇒ `'segment'`; existing tiers unchanged.
- Decode upscale: unit-testable dimension math only (×2 of 100×80 ⇒ 200×160; 3000px at ×2 clamps to 4096) — canvas resampling itself is browser-verified manually.

## Out of scope

Sharpen/brightness/contrast effects, hysteresis/connectivity-based segmentation (rejected — see status note), per-effect on/off toggles (identity values serve as off), persisting settings across sessions.
