import type { RasterImage } from '../types'

const MAX_SIDE = 4096

export interface DecodeResult {
  image: RasterImage
  downscaled: boolean
}

export function scaledDims(
  w: number,
  h: number,
  upscale: number,
): { w: number; h: number; downscaled: boolean } {
  const tw = w * upscale,
    th = h * upscale
  const clamp = Math.min(1, MAX_SIDE / Math.max(tw, th))
  return {
    w: Math.max(1, Math.round(tw * clamp)),
    h: Math.max(1, Math.round(th * clamp)),
    downscaled: clamp < 1,
  }
}

export async function fileToRasterImage(file: Blob, upscale: 1 | 2 | 3 = 1): Promise<DecodeResult> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    throw new Error('undecodable')
  }
  const { w, h, downscaled } = scaledDims(bmp.width, bmp.height, upscale)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#ffffff' // composite transparency onto white
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const data = ctx.getImageData(0, 0, w, h)
  return { image: { width: w, height: h, data: data.data }, downscaled }
}
