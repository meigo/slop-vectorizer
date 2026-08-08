export interface RasterImage {
  width: number
  height: number
  data: Uint8ClampedArray // RGBA, length = width*height*4
}

export interface PipelineOptions {
  colorCount: number | 'auto' // 2..16 when numeric
  smoothness: number // 0..1; scales Bézier fit tolerance
  despeckleSize: number // regions smaller than this (px) get merged
  mergePaths: boolean // one <path> per palette color
  transparentBg: boolean // skip background-colored regions
  optimize: boolean // compact path serialization
  blackPoint: number // levels black point, 0..255
  whitePoint: number // levels white point, 0..255
  blurRadius: number // pre-blur box radius, px
  saturation: number // 1 = unchanged
  gapClosing: number // 0–3 px, bridges dashed thin strokes
  colorOverrides: (string | null)[] | null // output recolor by palette index, '#rrggbb'; null = detected
}

export const DEFAULT_OPTIONS: PipelineOptions = {
  colorCount: 'auto',
  smoothness: 0.5,
  despeckleSize: 4,
  mergePaths: true,
  transparentBg: false,
  optimize: true,
  blackPoint: 0,
  whitePoint: 255,
  blurRadius: 0,
  saturation: 1,
  gapClosing: 0,
  colorOverrides: null,
}

export interface Palette {
  k: number
  colors: Uint8ClampedArray // k*3 RGB
}

export interface Segmentation {
  labelMap: Int32Array // width*height, pixel -> region id (0..regionCount-1)
  regionColor: Int32Array // region id -> palette index
  regionSize: Int32Array // region id -> pixel count
  regionCount: number
}

export interface RegionLoops {
  region: number
  loops: Float64Array[] // interleaved x,y; implicitly closed
}

export type StageName = 'pre' | 'palette' | 'segment' | 'boundaries' | 'corners' | 'fit' | 'svg'

export interface PipelineStats {
  pathCount: number
  pointCount: number
  timings: Partial<Record<StageName, number>> // ms
}

export interface VectorResult {
  svg: string
  stats: PipelineStats
}

// what the client resolves vectorize() with
export type ClientResult = VectorResult & { preImage?: RasterImage }

// Worker protocol
export type WorkerRequest = {
  type: 'vectorize'
  image: RasterImage
  options: PipelineOptions
  jobId: number
}

export type WorkerResponse =
  | { type: 'progress'; jobId: number; stage: StageName }
  | { type: 'result'; jobId: number; result: VectorResult; preImage?: RasterImage }
  | { type: 'error'; jobId: number; stage: StageName | 'unknown'; message: string }
