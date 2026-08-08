import type {
  RasterImage,
  PipelineOptions,
  StageName,
  WorkerRequest,
  WorkerResponse,
  Palette,
  Segmentation,
  Boundaries,
  PipelineStats,
} from '../types'
import { preprocess, isIdentityPre, type PreOptions } from './pipeline/preprocess'
import { estimatePalette } from './pipeline/palette'
import { segmentImage } from './pipeline/segment'
import { extractBoundaries, loopPointsOf } from './pipeline/boundaries'
import { findCorners, findOpenCorners } from './pipeline/corners'
import { fitArc, reverseCubics, type Cubic } from './pipeline/fitcurves'
import { assembleSvg, polygonArea, type RegionPath } from './pipeline/svg'

const ORDER: StageName[] = ['pre', 'palette', 'segment', 'boundaries', 'corners', 'fit', 'svg']

export function firstDirtyStage(
  prev: PipelineOptions | null,
  next: PipelineOptions,
  sameImage: boolean,
): StageName {
  if (!prev || !sameImage) return 'pre'
  if (
    prev.blackPoint !== next.blackPoint ||
    prev.whitePoint !== next.whitePoint ||
    prev.blurRadius !== next.blurRadius ||
    prev.saturation !== next.saturation
  )
    return 'pre'
  if (prev.colorCount !== next.colorCount) return 'palette'
  if (prev.despeckleSize !== next.despeckleSize || prev.gapClosing !== next.gapClosing)
    return 'segment'
  return 'fit' // smoothness, mergePaths, transparentBg, optimize, colorOverrides, stackedShapes (or nothing) changed; fit+svg are cheap
}

interface Cache {
  image: RasterImage | null
  options: PipelineOptions | null
  pre?: RasterImage
  palImage?: RasterImage // scale-invariant palette source (original ×1 decode)
  palPre?: RasterImage // palette source with current pre-effects applied
  palette?: Palette
  seg?: Segmentation
  bounds?: Boundaries
  areas?: number[] // per region: largest loop area (path ordering + background pick)
  outerLoop?: number[] // per region: index of its largest (outer) loop
  corners?: number[][] // per arc: break indices
}
const cache: Cache = { image: null, options: null }

function run(
  image: RasterImage,
  options: PipelineOptions,
  post: (m: WorkerResponse) => void,
  jobId: number,
  paletteImage?: RasterImage,
) {
  const prev = cache.options
  const sameImg = cache.image === image || sameImageData(cache.image, image)
  const from = firstDirtyStage(prev, options, sameImg)
  const fromIdx = ORDER.indexOf(from)
  const palSrcChanged =
    paletteImage !== undefined && !sameImageData(cache.palImage ?? null, paletteImage)
  if (palSrcChanged) {
    cache.palImage = paletteImage
    cache.palPre = undefined
  }
  const timings: PipelineStats['timings'] = {}
  const stage = <T>(name: StageName, fn: () => T): T => {
    post({ type: 'progress', jobId, stage: name })
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
  }
  const identity = isIdentityPre(preOpts)
  const preFieldsChanged =
    !prev ||
    prev.blackPoint !== options.blackPoint ||
    prev.whitePoint !== options.whitePoint ||
    prev.blurRadius !== options.blurRadius ||
    prev.saturation !== options.saturation
  if (preFieldsChanged) cache.palPre = undefined
  if (fromIdx <= ORDER.indexOf('pre') || !cache.pre)
    cache.pre = identity ? image : stage('pre', () => preprocess(image, preOpts))
  const src = cache.pre
  // The palette comes from the scale-invariant source when one is cached, so a
  // working-image change alone (upscale re-decode) does NOT re-estimate — swatch
  // colors stay constant across scale changes by construction.
  const paletteDirty =
    !cache.palette ||
    palSrcChanged ||
    preFieldsChanged ||
    !prev ||
    prev.colorCount !== options.colorCount ||
    (!cache.palImage && !sameImg)
  if (paletteDirty)
    cache.palette = stage('palette', () => {
      const palBase = cache.palImage
      const palInput = palBase
        ? identity
          ? palBase
          : (cache.palPre ??= preprocess(palBase, preOpts))
        : src
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
    cache.areas = loopAreas.map((la) => Math.max(...la))
    cache.outerLoop = loopAreas.map((la) => la.indexOf(Math.max(...la)))
    cache.corners = stage('corners', () =>
      cache.bounds!.arcs.map((a) => (a.closed ? findCorners(a.points) : findOpenCorners(a.points))),
    )
  }
  const maxErrorPx = 0.25 + 1.75 * options.smoothness
  let pointCount = 0
  const stacked = options.stackedShapes
  const firstPixel = new Int32Array(cache.seg!.regionCount).fill(-1)
  if (stacked) {
    let seen = 0
    for (let i = 0; i < cache.seg!.labelMap.length && seen < cache.seg!.regionCount; i++) {
      if (firstPixel[cache.seg!.labelMap[i]] === -1) {
        firstPixel[cache.seg!.labelMap[i]] = i
        seen++
      }
    }
  }
  const paths = stage('fit', () => {
    // Each arc is fitted once, in its stored direction; the region that traverses it
    // backwards reuses the same cubics reversed exactly, so a shared boundary is the
    // same curve on both sides by construction. Stacked mode keeps only each region's
    // outer loop, so hole-only arcs are never fitted.
    const used = stacked ? new Set<number>() : null
    if (used)
      cache.bounds!.regions.forEach((r, ri) => {
        for (const ref of r.loops[cache.outerLoop![ri]]) used.add(ref.arc)
      })
    const arcCubics = cache.bounds!.arcs.map((a, i) =>
      used && !used.has(i) ? [] : fitArc(a.points, cache.corners![i], a.closed, maxErrorPx),
    )
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
        stackOrder: firstPixel[r.region],
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
  post({
    type: 'result',
    jobId,
    result: { svg, stats: { pathCount, pointCount, timings } },
    ...(identity ? {} : { preImage: src }),
    palette: Array.from(cache.palette!.colors),
  })
}

export function sameImageData(a: RasterImage | null, b: RasterImage): boolean {
  if (!a || a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length)
    return false
  // full compare with early exit — a sampled probe can miss a small localized edit
  // between sample offsets; ~1ms for a 4MB buffer is negligible vs the pipeline
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false
  return true
}

if (typeof self !== 'undefined' && 'postMessage' in self && typeof document === 'undefined') {
  self.onmessage = (e: MessageEvent<WorkerRequest>) => {
    const { image, options, jobId, paletteImage } = e.data
    let currentStage: StageName | 'unknown' = 'unknown'
    try {
      run(
        image,
        options,
        (m) => {
          if (m.type === 'progress') currentStage = m.stage
          self.postMessage(m)
        },
        jobId,
        paletteImage,
      )
    } catch (err) {
      cache.image = null
      cache.options = null // poisoned cache — drop it
      self.postMessage({
        type: 'error',
        jobId,
        stage: currentStage,
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse)
    }
  }
}
