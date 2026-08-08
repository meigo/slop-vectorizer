import type { RasterImage, PipelineOptions, StageName, ClientResult, WorkerResponse } from '../types'

export class VectorizerClient {
  private worker: Worker
  private jobId = 0
  private pending: { reject: (e: Error) => void } | null = null

  constructor() { this.worker = this.spawn() }

  private spawn(): Worker {
    return new Worker(new URL('../worker/vectorize.worker.ts', import.meta.url), { type: 'module' })
  }

  vectorize(image: RasterImage, options: PipelineOptions,
            onProgress?: (stage: StageName) => void): Promise<ClientResult> {
    this.pending?.reject(new Error('cancelled')) // a new call supersedes any unsettled job
    const jobId = ++this.jobId
    return new Promise<ClientResult>((resolve, reject) => {
      this.pending = { reject }
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data
        if (m.jobId !== jobId) return // stale
        if (m.type === 'progress') onProgress?.(m.stage)
        else if (m.type === 'result') { this.pending = null; resolve({ ...m.result, preImage: m.preImage }) }
        else { this.pending = null; reject(new Error(`${m.stage}: ${m.message}`)) }
      }
      this.worker.onerror = (e) => { this.pending = null; reject(new Error(e.message)) }
      this.worker.postMessage({ type: 'vectorize', image, options, jobId })
    })
  }

  cancel(): void {
    this.worker.terminate()
    this.pending?.reject(new Error('cancelled'))
    this.pending = null
    this.worker = this.spawn()
  }
}
