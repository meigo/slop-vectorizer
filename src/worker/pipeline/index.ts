import type { RasterImage, PipelineOptions, StageName, VectorResult, PipelineStats } from '../../types'
import { estimatePalette } from './palette'
import { segmentImage } from './segment'
import { extractBoundaries } from './boundaries'
import { findCorners } from './corners'
import { fitLoop, type Cubic } from './fitcurves'
import { assembleSvg, polygonArea, type RegionPath } from './svg'

export function vectorize(
  image: RasterImage,
  options: PipelineOptions,
  onProgress?: (stage: StageName) => void,
): VectorResult {
  const timings: PipelineStats['timings'] = {}
  const stage = <T>(name: StageName, fn: () => T): T => {
    onProgress?.(name)
    const t0 = performance.now()
    const r = fn()
    timings[name] = performance.now() - t0
    return r
  }
  const palette = stage('palette', () => estimatePalette(image, options.colorCount))
  const seg = stage('segment', () => segmentImage(image, palette, options.despeckleSize))
  const bounds = stage('boundaries', () => extractBoundaries(image, seg, palette))
  const cornersPerLoop = stage('corners', () =>
    bounds.map(r => r.loops.map(l => findCorners(l))))
  const maxErrorPx = 0.25 + 1.75 * options.smoothness
  let pointCount = 0
  const paths = stage('fit', () =>
    bounds.map((r, ri): RegionPath => {
      const loops: Cubic[][] = r.loops.map((l, li) => {
        const cubics = fitLoop(l, cornersPerLoop[ri][li], maxErrorPx)
        pointCount += cubics.length * 3 + 1
        return cubics
      })
      const area = Math.max(...r.loops.map(l => Math.abs(polygonArea(l))))
      return { paletteIndex: seg.regionColor[r.region], area, loops }
    }))
  const svg = stage('svg', () =>
    assembleSvg(paths, palette, image.width, image.height, {
      mergePaths: options.mergePaths,
      transparentBg: options.transparentBg,
    }))
  const pathCount = (svg.match(/<path/g) ?? []).length
  return { svg, stats: { pathCount, pointCount, timings } }
}
