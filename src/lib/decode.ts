import type { RasterImage } from '../types'

const MAX_SIDE = 4096

export interface DecodeResult { image: RasterImage; downscaled: boolean }

export async function fileToRasterImage(file: Blob): Promise<DecodeResult> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    throw new Error('undecodable')
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff' // composite transparency onto white
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const data = ctx.getImageData(0, 0, w, h)
  return { image: { width: w, height: h, data: data.data }, downscaled: scale < 1 }
}
