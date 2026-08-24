import type { RasterImage } from '../types'

const MAX_SIDE = 4096

/** Working-image scale factors offered by the UI, smallest first. */
export const SCALES = [1 / 3, 0.5, 1, 2, 3]

/**
 * Gap-closing cap in working-image pixels: 3 px at native scale, scaled with the
 * image so the physical bridge limit stays ~6 px at any scale. Floored at 1 so
 * downscaled runs keep a usable range.
 */
export function maxGapClosing(scale: number): number {
  return Math.max(1, Math.round(3 * scale))
}

export interface DecodeResult {
  image: RasterImage
  clamped: boolean // hit the MAX_SIDE cap (not the same as a deliberate downscale)
}

export function scaledDims(
  w: number,
  h: number,
  scale: number,
): { w: number; h: number; clamped: boolean } {
  const tw = w * scale,
    th = h * scale
  const clamp = Math.min(1, MAX_SIDE / Math.max(tw, th))
  return {
    w: Math.max(1, Math.round(tw * clamp)),
    h: Math.max(1, Math.round(th * clamp)),
    clamped: clamp < 1,
  }
}

/**
 * Successive drawImage sizes to get from (w,h) to (tw,th), each step at most a 2×
 * reduction, ending exactly on the target. Always at least one step.
 *
 * Chrome point-samples a single drawImage past ~2× minification even at
 * imageSmoothingQuality 'high' — measured on binary noise, a one-shot ×⅓ keeps the
 * source's full standard deviation (127.5, i.e. nearest-neighbour) while stepping
 * down lands at 38.6, near the 42.5 of an ideal 3×3 box. Aliasing instead of
 * averaging would defeat the point of downscaling, so anything stronger than 2×
 * walks down in halves. ×½ and up are a single draw, exactly as before.
 */
export function resampleSteps(
  w: number,
  h: number,
  tw: number,
  th: number,
): { w: number; h: number }[] {
  const steps: { w: number; h: number }[] = []
  while (w > tw * 2 || h > th * 2) {
    w = Math.max(tw, Math.ceil(w / 2))
    h = Math.max(th, Math.ceil(h / 2))
    steps.push({ w, h })
  }
  if (steps.length === 0 || steps[steps.length - 1].w !== tw || steps[steps.length - 1].h !== th)
    steps.push({ w: tw, h: th })
  return steps
}

export async function fileToRasterImage(file: Blob, scale: number = 1): Promise<DecodeResult> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    throw new Error('undecodable')
  }
  const { w, h, clamped } = scaledDims(bmp.width, bmp.height, scale)
  let src: ImageBitmap | OffscreenCanvas = bmp
  let canvas!: OffscreenCanvas
  let ctx!: OffscreenCanvasRenderingContext2D
  for (const [i, step] of resampleSteps(bmp.width, bmp.height, w, h).entries()) {
    canvas = new OffscreenCanvas(step.w, step.h)
    ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    // Composite transparency onto white on the first draw, so every later step
    // resamples opaque pixels and the result matches a one-shot draw's semantics.
    if (i === 0) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, step.w, step.h)
    }
    ctx.drawImage(src, 0, 0, step.w, step.h)
    src = canvas
  }
  bmp.close()
  const data = ctx.getImageData(0, 0, w, h)
  return { image: { width: w, height: h, data: data.data }, clamped }
}
