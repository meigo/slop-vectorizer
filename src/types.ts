export interface RasterImage {
  width: number
  height: number
  data: Uint8ClampedArray // RGBA, length = width*height*4
}

export interface PipelineOptions {
  colorCount: number | 'auto' // 2..16 when numeric
  smoothness: number          // 0..1; scales Bézier fit tolerance
  despeckleSize: number       // regions smaller than this (px) get merged
}

export const DEFAULT_OPTIONS: PipelineOptions = {
  colorCount: 'auto',
  smoothness: 0.5,
  despeckleSize: 4,
}

export interface Palette {
  k: number
  colors: Uint8ClampedArray // k*3 RGB
}

export interface Segmentation {
  labelMap: Int32Array    // width*height, pixel -> region id (0..regionCount-1)
  regionColor: Int32Array // region id -> palette index
  regionSize: Int32Array  // region id -> pixel count
  regionCount: number
}

export interface RegionLoops {
  region: number
  loops: Float64Array[] // interleaved x,y; implicitly closed
}

export type StageName = 'palette' | 'segment' | 'boundaries' | 'corners' | 'fit' | 'svg'

export interface PipelineStats {
  pathCount: number
  pointCount: number
  timings: Partial<Record<StageName, number>> // ms
}

export interface VectorResult {
  svg: string
  stats: PipelineStats
}

// Worker protocol
export type WorkerRequest =
  | { type: 'vectorize'; image: RasterImage; options: PipelineOptions; jobId: number }

export type WorkerResponse =
  | { type: 'progress'; jobId: number; stage: StageName }
  | { type: 'result'; jobId: number; result: VectorResult }
  | { type: 'error'; jobId: number; stage: StageName | 'unknown'; message: string }
