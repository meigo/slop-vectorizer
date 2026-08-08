import type {
  RasterImage,
  PipelineOptions,
  StageName,
  VectorResult,
  PipelineStats,
} from '../../types'
import { preprocess, isIdentityPre, type PreOptions } from './preprocess'
import { estimatePalette } from './palette'
import { segmentImage } from './segment'
import { extractBoundaries, loopPointsOf } from './boundaries'
import { findCorners } from './corners'
import { fitLoop, type Cubic } from './fitcurves'
import { assembleSvg, polygonArea, type RegionPath } from './svg'

export function vectorize(
  image: RasterImage,
  options: PipelineOptions,
  onProgress?: (stage: StageName) => void,
  // Scale-invariant palette source (e.g. the original ×1 decode of an upscaled
  // working image); when given, palette estimation reads it — with the same
  // pre-effects applied — instead of the working image.
  paletteImage?: RasterImage,
): VectorResult {
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
  }
  const identity = isIdentityPre(preOpts)
  const src = identity ? image : stage('pre', () => preprocess(image, preOpts))
  const palette = stage('palette', () => {
    const palInput = paletteImage
      ? identity
        ? paletteImage
        : preprocess(paletteImage, preOpts)
      : src
    return estimatePalette(palInput, options.colorCount)
  })
  const seg = stage('segment', () =>
    segmentImage(src, palette, options.despeckleSize, options.gapClosing),
  )
  const bounds = stage('boundaries', () => extractBoundaries(src, seg, palette))
  const loopPts = bounds.regions.map((r) => r.loops.map((refs) => loopPointsOf(bounds.arcs, refs)))
  const cornersPerLoop = stage('corners', () => loopPts.map((ls) => ls.map((l) => findCorners(l))))
  const maxErrorPx = 0.25 + 1.75 * options.smoothness
  let pointCount = 0
  const paths = stage('fit', () =>
    bounds.regions.map((r, ri): RegionPath => {
      const loops: Cubic[][] = loopPts[ri].map((l, li) => {
        const cubics = fitLoop(l, cornersPerLoop[ri][li], maxErrorPx)
        pointCount += cubics.length * 3 + 1
        return cubics
      })
      const area = Math.max(...loopPts[ri].map((l) => Math.abs(polygonArea(l))))
      return { paletteIndex: seg.regionColor[r.region], area, loops }
    }),
  )
  const svg = stage('svg', () =>
    assembleSvg(paths, palette, image.width, image.height, {
      mergePaths: options.mergePaths,
      transparentBg: options.transparentBg,
      optimize: options.optimize,
      colorOverrides: options.colorOverrides,
    }),
  )
  const pathCount = (svg.match(/<path/g) ?? []).length
  return { svg, stats: { pathCount, pointCount, timings } }
}
