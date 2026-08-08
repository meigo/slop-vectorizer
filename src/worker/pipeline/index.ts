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
import { findCorners, findOpenCorners } from './corners'
import { fitArc, reverseCubics, type Cubic } from './fitcurves'
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
  // Areas rank the paths and pick the background; they only depend on the raw
  // polylines, so they are computed once from the arcs rather than per fit.
  const loopAreas = bounds.regions.map((r) =>
    r.loops.map((refs) => Math.abs(polygonArea(loopPointsOf(bounds.arcs, refs)))),
  )
  const areas = loopAreas.map((la) => Math.max(...la))
  const outerLoop = loopAreas.map((la) => la.indexOf(Math.max(...la)))
  const cornersPerArc = stage('corners', () =>
    bounds.arcs.map((a) => (a.closed ? findCorners(a.points) : findOpenCorners(a.points))),
  )
  const maxErrorPx = 0.25 + 1.75 * options.smoothness
  let pointCount = 0
  const stacked = options.stackedShapes
  const firstPixel = new Int32Array(seg.regionCount).fill(-1)
  if (stacked) {
    let seen = 0
    for (let i = 0; i < seg.labelMap.length && seen < seg.regionCount; i++) {
      if (firstPixel[seg.labelMap[i]] === -1) {
        firstPixel[seg.labelMap[i]] = i
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
      bounds.regions.forEach((r, ri) => {
        for (const ref of r.loops[outerLoop[ri]]) used.add(ref.arc)
      })
    const arcCubics = bounds.arcs.map((a, i) =>
      used && !used.has(i) ? [] : fitArc(a.points, cornersPerArc[i], a.closed, maxErrorPx),
    )
    return bounds.regions.map((r, ri): RegionPath => {
      const keptLoops = stacked ? [r.loops[outerLoop[ri]]] : r.loops
      const loops: Cubic[][] = keptLoops.map((refs) => {
        const cubics = refs.flatMap((ref) =>
          ref.reversed ? reverseCubics(arcCubics[ref.arc]) : arcCubics[ref.arc],
        )
        pointCount += cubics.length * 3 + 1
        return cubics
      })
      return {
        paletteIndex: seg.regionColor[r.region],
        area: areas[ri],
        stackOrder: firstPixel[r.region],
        loops,
      }
    })
  })
  const svg = stage('svg', () =>
    assembleSvg(paths, palette, image.width, image.height, {
      mergePaths: options.mergePaths,
      transparentBg: options.transparentBg,
      optimize: options.optimize,
      colorOverrides: options.colorOverrides,
      stackedShapes: options.stackedShapes,
    }),
  )
  const pathCount = (svg.match(/<path/g) ?? []).length
  return { svg, stats: { pathCount, pointCount, timings } }
}
