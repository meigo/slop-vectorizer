# slop-vectorizer — Output Options (v1.1)

**Date:** 2026-08-08
**Status:** Approved (brainstorming session)

## Summary

Three user-facing output options, all confined to the SVG serialization stage: merge same-color shapes into one path, transparent background, and a built-in compact writer (no SVGO dependency — decided against bundling it because our generator already emits cruft-free SVG; merging + relative/trimmed serialization captures nearly all of svgomg's win on this output).

## Options model

`PipelineOptions` gains:

| Field | Type | Default | Effect |
|---|---|---|---|
| `mergePaths` | boolean | **true** | One `<path>` per palette color instead of one per region |
| `transparentBg` | boolean | **false** | Regions of the background color are not emitted |
| `optimize` | boolean | **true** | Compact path serialization (relative commands, trimmed numbers) |

Worker cache: changing only these re-runs from `'fit'` (cheap tier, same as smoothness). `firstDirtyStage` returns `'fit'` when image, colorCount, and despeckleSize are unchanged — the existing fallthrough already does this, so only the tests need to assert it.

## Serialization changes (src/worker/pipeline/svg.ts)

**Merge (`mergePaths: true`):** group `RegionPath[]` by `paletteIndex`; emit one `<path>` per color whose `d` concatenates every member region's subpaths (outer + hole loops). Correctness: regions tile the plane exactly (shared boundaries are byte-identical between neighbors) and each region's `d` already carries its hole loops, so `fill-rule="evenodd"` renders any nesting correctly independent of paint order. Groups sort by summed area, descending (biggest painted first). With `mergePaths: false`, per-region output is unchanged from v1.

**Transparent background (`transparentBg: true`):** background palette index = `paletteIndex` of the largest-area region. Every region (or merged group) with that index is skipped — including enclosed pockets (counters of letters, gaps between strokes), so output composites over anything. With all regions one color and transparentBg on, output is an empty-bodied `<svg>` (valid, fully transparent).

**Compact writer (`optimize: true`):**
- Path data uses relative `c` commands after each subpath's initial absolute `M`.
- Numbers: round to 2 decimals (unchanged), then strip trailing zeros and the leading zero of |v| < 1 (`0.50` → `.5`), `-0` → `0`.
- Separators: single space between numbers, omitted before a negative sign (`10-3.5` not `10 -3.5`). No space around command letters.
- `optimize: false` keeps the current readable absolute output byte-for-byte.

Determinism holds in all modes (same input + options ⇒ identical bytes).

## UI (src/lib/Controls.svelte)

Three checkboxes after Despeckle: **Optimize**, **Merge colors**, **Transparent bg**, bound to the options object, firing the existing debounced `onchange`. Stats line gains an output size figure formatted as kB with one decimal (e.g. `12.4 kB`), computed from the SVG string's UTF-8 byte length, so toggles show their effect immediately.

## Testing

- `tests/svg.test.ts`: merged output for a 2-color, 3-region fixture has exactly 2 `<path>` elements and preserves total subpath count (count `M`/`m` occurrences); transparent-bg drops exactly the background-colored paths; compact `d` round-trips through a tiny number parser to the same values as the absolute output; compact output is strictly smaller than non-optimized for the same input.
- `tests/e2e.test.ts`: circle fixture with `transparentBg: true` yields 1 path; ring fixture with `mergePaths: true` yields 2 paths (ink + paper) with holes intact.
- Existing tests keep passing with explicit `mergePaths: false, optimize: false` where they assert v1 output shape, or updated expectations where testing the new defaults is more natural.

## Error handling

None new — all three transforms are total functions over generator-owned data.

## Out of scope

SVGO integration, path-level curve re-simplification, per-color visibility toggles, export presets.
