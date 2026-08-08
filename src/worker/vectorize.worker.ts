import type {
  RasterImage, PipelineOptions, StageName, WorkerRequest, WorkerResponse,
  Palette, Segmentation, RegionLoops, PipelineStats,
} from '../types'
import { estimatePalette } from './pipeline/palette'
import { segmentImage } from './pipeline/segment'
import { extractBoundaries } from './pipeline/boundaries'
import { findCorners } from './pipeline/corners'
import { fitLoop, type Cubic } from './pipeline/fitcurves'
import { assembleSvg, polygonArea, type RegionPath } from './pipeline/svg'

const ORDER: StageName[] = ['palette', 'segment', 'boundaries', 'corners', 'fit', 'svg']

export function firstDirtyStage(
  prev: PipelineOptions | null, next: PipelineOptions, sameImage: boolean,
): StageName {
  if (!prev || !sameImage) return 'palette'
  if (prev.colorCount !== next.colorCount) return 'palette'
  if (prev.despeckleSize !== next.despeckleSize) return 'segment'
  return 'fit' // smoothness (or nothing) changed; fit+svg are cheap
}

interface Cache {
  image: RasterImage | null
  options: PipelineOptions | null
  palette?: Palette
  seg?: Segmentation
  bounds?: RegionLoops[]
  corners?: number[][][]
}
const cache: Cache = { image: null, options: null }

function run(image: RasterImage, options: PipelineOptions, post: (m: WorkerResponse) => void, jobId: number) {
  const from = firstDirtyStage(cache.options, options, cache.image === image || sameImageData(cache.image, image))
  const fromIdx = ORDER.indexOf(from)
  const timings: PipelineStats['timings'] = {}
  const stage = <T>(name: StageName, fn: () => T): T => {
    post({ type: 'progress', jobId, stage: name })
    const t0 = performance.now()
    const r = fn()
    timings[name] = performance.now() - t0
    return r
  }
  if (fromIdx <= ORDER.indexOf('palette') || !cache.palette)
    cache.palette = stage('palette', () => estimatePalette(image, options.colorCount))
  if (fromIdx <= ORDER.indexOf('segment') || !cache.seg)
    cache.seg = stage('segment', () => segmentImage(image, cache.palette!, options.despeckleSize))
  if (fromIdx <= ORDER.indexOf('boundaries') || !cache.bounds) {
    cache.bounds = stage('boundaries', () => extractBoundaries(image, cache.seg!, cache.palette!))
    cache.corners = stage('corners', () => cache.bounds!.map(r => r.loops.map(l => findCorners(l))))
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
      const area = Math.max(...r.loops.map(l => Math.abs(polygonArea(l))))
      return { paletteIndex: cache.seg!.regionColor[r.region], area, loops }
    }))
  const svg = stage('svg', () =>
    assembleSvg(paths, cache.palette!, image.width, image.height, {
      mergePaths: options.mergePaths,
      transparentBg: options.transparentBg,
      optimize: options.optimize,
    }))
  const pathCount = (svg.match(/<path/g) ?? []).length
  cache.image = image
  cache.options = options
  post({ type: 'result', jobId, result: { svg, stats: { pathCount, pointCount, timings } } })
}

export function sameImageData(a: RasterImage | null, b: RasterImage): boolean {
  if (!a || a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false
  // full compare with early exit — a sampled probe can miss a small localized edit
  // between sample offsets; ~1ms for a 4MB buffer is negligible vs the pipeline
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false
  return true
}

if (typeof self !== 'undefined' && 'postMessage' in self && typeof document === 'undefined') {
  self.onmessage = (e: MessageEvent<WorkerRequest>) => {
    const { image, options, jobId } = e.data
    let currentStage: StageName | 'unknown' = 'unknown'
    try {
      run(image, options, m => {
        if (m.type === 'progress') currentStage = m.stage
        self.postMessage(m)
      }, jobId)
    } catch (err) {
      cache.image = null; cache.options = null // poisoned cache — drop it
      self.postMessage({
        type: 'error', jobId, stage: currentStage,
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse)
    }
  }
}
