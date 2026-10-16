import type { RasterImage, PipelineOptions, StageName, VectorResult } from '../../types'
import { newCache, runPipeline } from './run'

/** The whole pipeline, uncached: the worker's cached run over an empty cache. */
export function vectorize(
  image: RasterImage,
  options: PipelineOptions,
  onProgress?: (stage: StageName) => void,
  // Scale-invariant palette source (e.g. the original ×1 decode of a rescaled
  // working image); when given, palette estimation reads it — with the same
  // pre-effects applied — instead of the working image.
  paletteImage?: RasterImage,
): VectorResult {
  return runPipeline(newCache(), image, options, onProgress, paletteImage).result
}
