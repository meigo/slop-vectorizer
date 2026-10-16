import type {
  RasterImage,
  PipelineOptions,
  StageName,
  VectorResult,
  Palette,
  Segmentation,
  Boundaries,
  PipelineStats,
} from '../../types'
import {
  preprocess,
  isIdentityPre,
  globalPre,
  palettePre,
  preBase,
  sameCircleList,
  sameGlobalPre,
  effectiveCircles,
  type PreOptions,
} from './preprocess'
import { estimatePalette } from './palette'
import { segmentImage } from './segment'
import { extractBoundaries, loopPointsOf } from './boundaries'
import { findCorners, findOpenCorners } from './corners'
import { fitArc, reverseCubics, type Cubic } from './fitcurves'
import { assembleSvg, maxIndex, polygonArea, type RegionPath } from './svg'

const ORDER: StageName[] = ['pre', 'palette', 'segment', 'boundaries', 'corners', 'fit', 'svg']

export function firstDirtyStage(
  prev: PipelineOptions | null,
  next: PipelineOptions,
  sameImage: boolean,
): StageName {
  if (!prev || !sameImage) return 'pre'
  if (!sameGlobalPre(prev, next) || !sameCircleList(effectiveCircles(prev), effectiveCircles(next)))
    return 'pre'
  if (prev.colorCount !== next.colorCount) return 'palette'
  if (prev.despeckleSize !== next.despeckleSize || prev.gapClosing !== next.gapClosing)
    return 'segment'
  return 'fit' // smoothness, mergePaths, transparentBg, optimize, colorOverrides, stackedShapes (or nothing) changed; fit+svg are cheap
}

export interface PipelineCache {
  image: RasterImage | null
  options: PipelineOptions | null
  pre?: RasterImage
  palImage?: RasterImage // scale-invariant palette source (original ×1 decode)
  palPre?: RasterImage // palette source with current pre-effects applied
  palBlur?: number // the blur radius palPre was made with, in the source's pixels
  palIsWorking?: boolean // the palette source has the working image's pixels (×1)
  workTones?: Tones // the working image's flattened + blurred tones
  palTones?: Tones // the palette source's
  palette?: Palette
  seg?: Segmentation
  bounds?: Boundaries
  areas?: number[] // per region: largest loop area (path ordering + background pick)
  outerLoop?: number[] // per region: index of its largest (outer) loop
  corners?: number[][] // per arc: break indices
  arcCubics?: Cubic[][] // per arc: its fitted curve, for fitError
  fitError?: number
}
/** preBase's output and the settings it was made with. */
interface Tones {
  flatten: number
  blur: number
  tones: Float32Array
}

/** The tones for these settings: the kept ones while flatten and blur are unchanged. Kept only
 *  while one of them is on; without either they are a plain copy, not worth the memory. */
function tonesFor(kept: Tones | undefined, image: RasterImage, flatten: number, blur: number) {
  if (flatten === 0 && blur === 0) return undefined
  if (kept && kept.flatten === flatten && kept.blur === blur) return kept
  return { flatten, blur, tones: preBase(image, flatten, blur) }
}

/** An empty cache: a run over it is the whole, uncached pipeline. */
export const newCache = (): PipelineCache => ({ image: null, options: null })

/** What a run produces; the worker posts it as a 'result'. */
export interface RunResult {
  result: VectorResult
  preImage?: RasterImage // the preprocessed bitmap, when any pre-effect is active
  palette: number[]
}

/**
 * The pipeline, resuming from the first stage the change since the cached run made dirty: a
 * colour-count change starts at palette, despeckle at segment, smoothness and the output
 * toggles at fit. `vectorize()` runs it over a fresh cache; the worker keeps one across jobs.
 */
export function runPipeline(
  cache: PipelineCache,
  image: RasterImage,
  options: PipelineOptions,
  onProgress?: (stage: StageName) => void,
  // Scale-invariant palette source (the original ×1 decode). When given it is cached, and
  // palette estimation reads it — with the same pre-effects — instead of the working image.
  paletteImage?: RasterImage,
): RunResult {
  const prev = cache.options
  const sameImg = cache.image === image || sameImageData(cache.image, image)
  const from = firstDirtyStage(prev, options, sameImg)
  const palSrcChanged =
    paletteImage !== undefined && !sameImageData(cache.palImage ?? null, paletteImage)
  if (palSrcChanged) {
    cache.palImage = paletteImage
    cache.palPre = undefined
    cache.palTones = undefined
  }
  if (!sameImg) cache.workTones = undefined
  // At ×1 the palette source is the working image's own decode: its pre-effects are the
  // working image's, already computed (without circles), so they aren't made twice.
  if (palSrcChanged || !sameImg)
    cache.palIsWorking = !!cache.palImage && sameImageData(cache.palImage, image)
  const timings: PipelineStats['timings'] = {}
  const stage = <T>(name: StageName, fn: () => T): T => {
    onProgress?.(name)
    const t0 = performance.now()
    const r = fn()
    timings[name] = performance.now() - t0
    return r
  }
  const preOpts: PreOptions = {
    blackPoint: options.blackPoint,
    whitePoint: options.whitePoint,
    blurRadius: options.blurRadius,
    saturation: options.saturation,
    flatten: options.flatten,
    localCircles: options.localCircles,
  }
  const identity = isIdentityPre(preOpts)
  // The palette never sees local circles (spec: palette ignores local levels).
  const palOpts = globalPre(preOpts)
  const palIdentity = isIdentityPre(palOpts)
  const palBase = cache.palImage
  // The ×1 source's blur, converted from working-image pixels: it changes with the scale too.
  const srcOpts = palBase && palettePre(preOpts, palBase.width, image.width)
  const srcBlurChanged = !!srcOpts && cache.palBlur !== srcOpts.blurRadius
  const preFieldsChanged = !prev || !sameGlobalPre(prev, options)
  if (preFieldsChanged || srcBlurChanged) cache.palPre = undefined
  // The palette comes from the scale-invariant source when one is cached, so a
  // working-image change alone (scale re-decode) does NOT re-estimate — swatch
  // colors stay constant across scale changes by construction (unless a blur is
  // set: its radius is in working-image pixels).
  const paletteDirty =
    !cache.palette ||
    palSrcChanged ||
    srcBlurChanged ||
    preFieldsChanged ||
    !prev ||
    prev.colorCount !== options.colorCount ||
    (!cache.palImage && !sameImg)
  // A new palette always re-segments, even of the same working image.
  const fromIdx = Math.min(ORDER.indexOf(from), paletteDirty ? ORDER.indexOf('palette') : Infinity)
  if (fromIdx <= ORDER.indexOf('pre') || !cache.pre)
    cache.pre = identity
      ? image
      : stage('pre', () => {
          cache.workTones = tonesFor(cache.workTones, image, options.flatten, options.blurRadius)
          return preprocess(image, preOpts, cache.workTones?.tones)
        })
  const src = cache.pre
  const noCircles = effectiveCircles(options).length === 0
  if (paletteDirty)
    cache.palette = stage('palette', () => {
      if (srcOpts) cache.palBlur = srcOpts.blurRadius
      const fromSource = () => {
        cache.palTones = tonesFor(cache.palTones, palBase!, srcOpts!.flatten, srcOpts!.blurRadius)
        return preprocess(palBase!, srcOpts!, cache.palTones?.tones)
      }
      const palInput =
        palBase && !(cache.palIsWorking && noCircles)
          ? isIdentityPre(srcOpts!)
            ? palBase
            : (cache.palPre ??= fromSource())
          : // No distinct palette source (or it is the working image): use the working image,
            // but still strip the circles when any are set — the palette never sees local levels.
            noCircles
            ? src
            : palIdentity
              ? image
              : preprocess(image, palOpts, cache.workTones?.tones)
      return estimatePalette(palInput, options.colorCount)
    })
  if (fromIdx <= ORDER.indexOf('segment') || !cache.seg)
    cache.seg = stage('segment', () =>
      segmentImage(src, cache.palette!, options.despeckleSize, options.gapClosing),
    )
  if (fromIdx <= ORDER.indexOf('boundaries') || !cache.bounds) {
    cache.bounds = stage('boundaries', () => extractBoundaries(src, cache.seg!, cache.palette!))
    // Areas rank the paths and pick the background; they only depend on the raw
    // polylines, so they are computed once here rather than on every re-fit.
    const loopAreas = cache.bounds.regions.map((r) =>
      r.loops.map((refs) => Math.abs(polygonArea(loopPointsOf(cache.bounds!.arcs, refs)))),
    )
    const areas: number[] = []
    const outerLoop: number[] = []
    for (const la of loopAreas) {
      const i = maxIndex(la)
      // every emitted region has at least one boundary edge, hence at least one loop
      if (i < 0) throw new Error('boundaries: region with no loops (bug)')
      outerLoop.push(i)
      areas.push(la[i])
    }
    cache.areas = areas
    cache.outerLoop = outerLoop
    cache.arcCubics = undefined
    cache.corners = stage('corners', () =>
      cache.bounds!.arcs.map((a) => (a.closed ? findCorners(a.points) : findOpenCorners(a.points))),
    )
  }
  const maxErrorPx = 0.25 + 1.75 * options.smoothness
  let pointCount = 0
  const stacked = options.stackedShapes
  const paths = stage('fit', () => {
    // Each arc is fitted once, in its stored direction; the region that traverses it
    // backwards reuses the same cubics reversed exactly, so a shared boundary is the
    // same curve on both sides by construction.
    // Kept across colour picks and output toggles, which change only the assembly.
    if (!cache.arcCubics || cache.fitError !== maxErrorPx) {
      cache.arcCubics = cache.bounds!.arcs.map((a, i) =>
        fitArc(a.points, cache.corners![i], a.closed, maxErrorPx),
      )
      cache.fitError = maxErrorPx
    }
    const arcCubics = cache.arcCubics
    // Stacked mode keeps only each region's outer loop and relies on the emission
    // order: extractBoundaries yields regions by ascending first pixel, which is a
    // valid containment (painter's) order — if A encloses B, A owns a pixel in a row
    // above B's first. See the guarantee at the top of boundaries.ts.
    return cache.bounds!.regions.map((r, ri): RegionPath => {
      const keptLoops = stacked ? [r.loops[cache.outerLoop![ri]]] : r.loops
      const loops: Cubic[][] = keptLoops.map((refs) => {
        const cubics = refs.flatMap((ref) =>
          ref.reversed ? reverseCubics(arcCubics[ref.arc]) : arcCubics[ref.arc],
        )
        pointCount += cubics.length * 3 + 1
        return cubics
      })
      return {
        paletteIndex: cache.seg!.regionColor[r.region],
        area: cache.areas![ri],
        loops,
      }
    })
  })
  const svg = stage('svg', () =>
    assembleSvg(paths, cache.palette!, image.width, image.height, {
      mergePaths: options.mergePaths,
      transparentBg: options.transparentBg,
      optimize: options.optimize,
      colorOverrides: options.colorOverrides,
      stackedShapes: options.stackedShapes,
    }),
  )
  const pathCount = (svg.match(/<path/g) ?? []).length
  cache.image = image
  cache.options = options
  return {
    result: { svg, stats: { pathCount, pointCount, timings } },
    ...(identity ? {} : { preImage: src }),
    palette: Array.from(cache.palette!.colors),
  }
}

export function sameImageData(a: RasterImage | null, b: RasterImage): boolean {
  if (!a || a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length)
    return false
  // full compare with early exit — a sampled probe can miss a small localized edit
  // between sample offsets; ~1ms for a 4MB buffer is negligible vs the pipeline
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false
  return true
}
