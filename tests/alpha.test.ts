import { describe, it, expect } from 'vitest'
import { prepareAlpha, unpremultiply } from '../src/worker/pipeline/alpha'
import { firstDirtyStage, newCache, runPipeline } from '../src/worker/pipeline/run'
import { vectorize } from '../src/worker/pipeline'
import { DEFAULT_OPTIONS } from '../src/types'
import type { RasterImage } from '../src/types'

const RED = [200, 30, 30]

/** A red disc whose alpha fades out over `soft` px past radius 12, on a 64² canvas. The
 *  transparent pixels store junk colour (green), as exporters often leave behind. */
function softDisc(soft = 14): RasterImage {
  const w = 64
  const data = new Uint8ClampedArray(w * w * 4)
  for (let p = 0; p < w * w; p++) {
    const d = Math.hypot((p % w) + 0.5 - 32, Math.floor(p / w) + 0.5 - 32)
    const a = Math.round(255 * Math.min(1, Math.max(0, 1 - (d - 12) / soft)))
    data.set(a > 0 ? [...RED, a] : [0, 255, 0, 0], p * 4)
  }
  return { width: w, height: w, data }
}

/** The same image composited onto white by hand, opaque. */
function onWhite(img: RasterImage): RasterImage {
  const data = new Uint8ClampedArray(img.data.length)
  for (let o = 0; o < data.length; o += 4) {
    const f = img.data[o + 3] / 255
    for (let c = 0; c < 3; c++) data[o + c] = img.data[o + c] * f + 255 * (1 - f)
    data[o + 3] = 255
  }
  return { width: img.width, height: img.height, data }
}

const fills = (svg: string) =>
  [...svg.matchAll(/fill="(#[0-9a-f]{6})"(?: fill-opacity="([\d.]+)")?/g)].map((m) => ({
    hex: m[1],
    opacity: m[2] === undefined ? 1 : Number(m[2]),
  }))
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const near = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

const keep = { ...DEFAULT_OPTIONS, keepAlpha: true }

describe('prepareAlpha', () => {
  it('passes an opaque image through untouched in both modes', () => {
    const img = onWhite(softDisc())
    expect(prepareAlpha(img, true)).toBe(img)
    expect(prepareAlpha(img, false)).toBe(img)
  })
  it('premultiplies when kept, so junk colour in transparent pixels is gone', () => {
    const out = prepareAlpha(softDisc(), true).data
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 0]) // the corner stored green at alpha 0
  })
  it('composites onto white when not kept', () => {
    const src = softDisc()
    expect([...prepareAlpha(src, false).data]).toEqual([...onWhite(src).data])
  })
  it('unpremultiply undoes it on the visible pixels', () => {
    const src = softDisc()
    const back = unpremultiply(prepareAlpha(src, true)).data
    const o = (32 * 64 + 50) * 4 // inside the soft ring
    expect(src.data[o + 3]).toBeGreaterThan(64)
    expect(near([...back.slice(o, o + 4)], [...src.data.slice(o, o + 4)], 2)).toBe(true)
  })
})

describe('Keep transparency', () => {
  it('posterizes a soft alpha edge into bands of one colour at falling opacity', () => {
    const out = fills(vectorize(softDisc(), { ...keep, colorCount: 5 }).svg)
    expect(out.length).toBeGreaterThanOrEqual(3)
    // every painted band is the disc's own red: no green bleeding in from the junk pixels
    for (const f of out) expect(near(rgb(f.hex), RED, 12), f.hex).toBe(true)
    const op = out.map((f) => f.opacity).sort()
    expect(op[op.length - 1]).toBe(1) // the solid middle
    expect(op[0]).toBeLessThan(0.5) // a faint outer band
  })
  it('emits no path for the fully transparent background', () => {
    const out = fills(vectorize(softDisc(), { ...keep, colorCount: 3 }).svg)
    expect(out.every((f) => f.opacity > 0)).toBe(true)
    expect(out.some((f) => f.hex === '#000000')).toBe(false)
  })
  it('off, a transparent image vectorizes exactly as if composited onto white', () => {
    const img = softDisc()
    expect(vectorize(img, DEFAULT_OPTIONS).svg).toBe(vectorize(onWhite(img), DEFAULT_OPTIONS).svg)
  })
  it('turns stacked shapes off: translucent bands would paint over each other', () => {
    const svg = vectorize(softDisc(), { ...keep, colorCount: 4, stackedShapes: true }).svg
    expect(svg).toContain('fill-rule="evenodd"')
  })
  it('Transparent bg still finds the background, and does not drop the shape', () => {
    const out = fills(vectorize(softDisc(), { ...keep, colorCount: 3, transparentBg: true }).svg)
    expect(out.some((f) => f.opacity === 1 && near(rgb(f.hex), RED, 12))).toBe(true)
  })
  it('blur does not bleed the transparent pixels’ colour into the edge', () => {
    const out = fills(vectorize(softDisc(4), { ...keep, colorCount: 4, blurRadius: 3 }).svg)
    for (const f of out) expect(near(rgb(f.hex), RED, 12), f.hex).toBe(true)
  })
  it('levels act on the straight colour: a faint band keeps its colour', () => {
    const out = fills(vectorize(softDisc(), { ...keep, colorCount: 5, blackPoint: 20 }).svg)
    const faint = out.filter((f) => f.opacity < 0.5)
    expect(faint.length).toBeGreaterThan(0)
    for (const f of faint) expect(rgb(f.hex)[0], f.hex).toBeGreaterThan(190)
  })
  it('shows the preprocessed image with straight colour', () => {
    const { preImage } = runPipeline(newCache(), softDisc(), { ...keep, blurRadius: 1 })
    const o = (32 * 64 + 50) * 4
    expect(preImage!.data[o + 3]).toBeLessThan(255)
    expect(near([...preImage!.data.slice(o, o + 3)], RED, 6)).toBe(true)
  })
  it('a change re-runs from pre, and cached runs match fresh ones', () => {
    expect(firstDirtyStage(DEFAULT_OPTIONS, keep, true)).toBe('pre')
    const cache = newCache()
    const img = softDisc(),
      src = softDisc()
    const steps = [
      {},
      { keepAlpha: true },
      { keepAlpha: true, blurRadius: 2 },
      { blurRadius: 2 },
      { blurRadius: 2, keepAlpha: true, colorCount: 4 },
      { keepAlpha: true, colorCount: 4, stackedShapes: true },
      { colorCount: 4, stackedShapes: true },
    ]
    for (const step of steps) {
      const o = { ...DEFAULT_OPTIONS, ...step }
      const cached = runPipeline(cache, img, o, undefined, src)
      const fresh = runPipeline(newCache(), img, o, undefined, src)
      expect(cached.result.svg, JSON.stringify(step)).toBe(fresh.result.svg)
      expect(cached.palette).toEqual(fresh.palette)
    }
  })
})
