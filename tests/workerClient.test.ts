import { describe, it, expect } from 'vitest'
import { VectorizerClient } from '../src/lib/workerClient'
import { DEFAULT_OPTIONS } from '../src/types'
import type { RasterImage, WorkerRequest, WorkerResponse } from '../src/types'

// Minimal stand-in for the DOM Worker used by VectorizerClient. VectorizerClient
// resolves `Worker` from the global scope at call time (inside spawn()), so
// stubbing globalThis.Worker lets us drive it without touching the client's
// public API or its internals.
class FakeWorker {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null
  onerror: ((e: { message: string }) => void) | null = null
  readonly posted: WorkerRequest[] = []
  postMessage(msg: WorkerRequest): void {
    this.posted.push(msg)
  }
  terminate(): void {}
}

const instances: FakeWorker[] = []
class TrackedFakeWorker extends FakeWorker {
  constructor() {
    super()
    instances.push(this)
  }
}
;(globalThis as unknown as { Worker: typeof TrackedFakeWorker }).Worker = TrackedFakeWorker

const image: RasterImage = { width: 1, height: 1, data: new Uint8ClampedArray(4) }

describe('VectorizerClient concurrent vectorize() calls', () => {
  it('rejects the first pending promise with "cancelled" when a second call starts before it settles, and the second call still resolves', async () => {
    instances.length = 0
    const client = new VectorizerClient()

    const p1 = client.vectorize(image, DEFAULT_OPTIONS)
    const p2 = client.vectorize(image, DEFAULT_OPTIONS)

    // Both promises must eventually settle — p1 is superseded, not orphaned.
    await expect(p1).rejects.toThrow('cancelled')

    expect(instances).toHaveLength(1) // vectorize() must not respawn the worker
    const worker = instances[0]
    expect(worker.posted.map((m) => m.type === 'vectorize' && m.jobId)).toEqual([1, 2])

    const result: WorkerResponse = {
      type: 'result',
      jobId: 2,
      result: { svg: '<svg/>', stats: { pathCount: 0, pointCount: 0, timings: {} } },
    }
    worker.onmessage?.({ data: result } as MessageEvent<WorkerResponse>)

    await expect(p2).resolves.toEqual(result.result)
  })

  it('passes palette through to the resolved result', async () => {
    instances.length = 0
    const client = new VectorizerClient()

    const promise = client.vectorize(image, DEFAULT_OPTIONS)

    expect(instances).toHaveLength(1)
    const worker = instances[0]

    const result: WorkerResponse = {
      type: 'result',
      jobId: 1,
      result: { svg: '<svg/>', stats: { pathCount: 0, pointCount: 0, timings: {} } },
      palette: [10, 20, 30, 240, 240, 240],
    }
    worker.onmessage?.({ data: result } as MessageEvent<WorkerResponse>)

    const res = await promise
    expect(res.palette).toEqual([10, 20, 30, 240, 240, 240])
  })
})
