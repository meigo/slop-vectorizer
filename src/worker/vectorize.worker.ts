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
import { assembleSvg, maxIndex, polygonArea, type RegionPath } from './pipeline/svg'

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
    const arcCubics = cache.bounds!.arcs.map((a, i) =>
      fitArc(a.points, cache.corners![i], a.closed, maxErrorPx),
    )
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
