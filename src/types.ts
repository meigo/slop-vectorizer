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

/**
 * A maximal run of boundary edges shared by the same pair of regions. Stored once,
 * so both sides fit identical geometry. Open arcs run junction-to-junction; a closed
 * arc is a whole loop whose neighbor never changes.
 */
export interface BoundaryArc {
  points: Float64Array // interleaved x,y in canonical (first-traversal) direction
  closed: boolean // true: full loop (blob/border loop), no junction endpoints
}

export interface ArcRef {
  arc: number // index into Boundaries.arcs
  reversed: boolean // this region traverses the arc against stored direction
}

export interface RegionArcs {
  region: number
  loops: ArcRef[][] // one ArcRef list per boundary loop, in traversal order
}

export interface Boundaries {
  arcs: BoundaryArc[]
  regions: RegionArcs[]
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
export type ClientResult = VectorResult & { preImage?: RasterImage; palette?: number[] }

// Worker protocol
export type WorkerRequest = {
  type: 'vectorize'
  image: RasterImage
  options: PipelineOptions
  jobId: number
  // Scale-invariant palette source (the original ×1 decode). Sent only when the
  // source file changes — the worker caches it; palette estimation reads it so
  // swatch colors stay constant across upscale changes.
  paletteImage?: RasterImage
}

export type WorkerResponse =
  | { type: 'progress'; jobId: number; stage: StageName }
  | {
      type: 'result'
      jobId: number
      result: VectorResult
      preImage?: RasterImage
      palette: number[]
    }
  | { type: 'error'; jobId: number; stage: StageName | 'unknown'; message: string }
