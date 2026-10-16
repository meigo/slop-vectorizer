import type {
  RasterImage,
  PipelineOptions,
  StageName,
  WorkerRequest,
  WorkerResponse,
} from '../types'
import { newCache, runPipeline } from './pipeline/run'

const cache = newCache()

function run(
  image: RasterImage,
  options: PipelineOptions,
  post: (m: WorkerResponse) => void,
  jobId: number,
  paletteImage?: RasterImage,
) {
  const r = runPipeline(
    cache,
    image,
    options,
    (stage) => post({ type: 'progress', jobId, stage }),
    paletteImage,
  )
  post({ type: 'result', jobId, ...r })
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
