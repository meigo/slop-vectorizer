import type {
  RasterImage,
  PipelineOptions,
  StageName,
  WorkerRequest,
  WorkerResponse,
  Palette,
  Segmentation,
  RegionLoops,
  PipelineStats,
} from '../types'
import { preprocess, isIdentityPre, type PreOptions } from './pipeline/preprocess'
import { estimatePalette } from './pipeline/palette'
import { segmentImage } from './pipeline/segment'
import { extractBoundaries } from './pipeline/boundaries'
import { findCorners } from './pipeline/corners'
import { fitLoop, type Cubic } from './pipeline/fitcurves'
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
  return 'fit' // smoothness, mergePaths, transparentBg, optimize, colorOverrides (or nothing) changed; fit+svg are cheap
}

interface Cache {
  image: RasterImage | null
  options: PipelineOptions | null
  pre?: RasterImage
  palImage?: RasterImage // scale-invariant palette source (original ×1 decode)
  palPre?: RasterImage // palette source with current pre-effects applied
  palette?: Palette
  seg?: Segmentation
  bounds?: RegionLoops[]
  corners?: number[][][]
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
    cache.corners = stage('corners', () =>
      cache.bounds!.map((r) => r.loops.map((l) => findCorners(l))),
    )
  }
  const maxErrorPx = 0.25 + 1.75 * options.smoothness
  let pointCount = 0
  const paths = stage('fit', () =>
    cache.bounds!.map((r, ri): RegionPath => {
      const loops: Cubic[][] = r.loops.map((l, li) => {
        const cubics = fitLoop(l, cache.corners![ri][li], maxErrorPx)
        pointCount += cubics.length * 3 + 1
        return cubics
      })
      const area = Math.max(...r.loops.map((l) => Math.abs(polygonArea(l))))
      return { paletteIndex: cache.seg!.regionColor[r.region], area, loops }
    }),
  )
  const svg = stage('svg', () =>
    assembleSvg(paths, cache.palette!, image.width, image.height, {
      mergePaths: options.mergePaths,
      transparentBg: options.transparentBg,
      optimize: options.optimize,
      colorOverrides: options.colorOverrides,
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
