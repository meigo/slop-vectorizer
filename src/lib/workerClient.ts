import type {
  RasterImage,
  PipelineOptions,
  StageName,
  ClientResult,
  WorkerResponse,
} from '../types'

export class VectorizerClient {
  private worker: Worker
  private jobId = 0
  private pending: { reject: (e: Error) => void } | null = null
  // Set when the worker reports an error. Watched from the start: a worker whose script fails to
  // load (a 404 after a redeploy, a flaky network) fires its one error before any job is posted,
  // and every later job would wait forever.
  private failed: Error | null = null
  // The last preprocessed bitmap the worker sent; a result with preKept reuses it.
  private lastPre: RasterImage | undefined

  constructor() {
    this.worker = this.spawn()
  }

  private spawn(): Worker {
    const w = new Worker(new URL('../worker/vectorize.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.failed = null
    this.lastPre = undefined
    // A load failure is a plain Event with no message.
    w.onerror = (e) => {
      this.failed = new Error(e.message || 'The vectorizer stopped working — reload the page.')
      this.pending?.reject(this.failed)
      this.pending = null
    }
    return w
  }

  vectorize(
    image: RasterImage,
    options: PipelineOptions,
    onProgress?: (stage: StageName) => void,
    // Send only when the source file changes — the worker caches it (it's large).
    paletteImage?: RasterImage,
  ): Promise<ClientResult> {
    this.pending?.reject(new Error('cancelled')) // a new call supersedes any unsettled job
    if (this.failed) return Promise.reject(this.failed)
    const jobId = ++this.jobId
    return new Promise<ClientResult>((resolve, reject) => {
      this.pending = { reject }
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data
        if (m.jobId !== jobId) return // stale
        if (m.type === 'progress') onProgress?.(m.stage)
        else if (m.type === 'result') {
          this.pending = null
          this.lastPre = m.preKept ? this.lastPre : m.preImage
          resolve({ ...m.result, preImage: this.lastPre, palette: m.palette })
        } else {
          this.pending = null
          reject(new Error(`${m.stage}: ${m.message}`))
        }
      }
      this.worker.postMessage({
        type: 'vectorize',
        image,
        options,
        jobId,
        ...(paletteImage ? { paletteImage } : {}),
      })
    })
  }

  cancel(): void {
    this.worker.terminate()
    this.pending?.reject(new Error('cancelled'))
    this.pending = null
    this.worker = this.spawn()
  }
}
