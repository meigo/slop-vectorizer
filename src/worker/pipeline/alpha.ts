import type { Palette, RasterImage } from '../../types'

/** Whether every pixel is fully opaque. */
export function isOpaque(image: RasterImage): boolean {
  const { data } = image
  for (let o = 3; o < data.length; o += 4) if (data[o] !== 255) return false
  return true
}

/**
 * The pixels the pipeline measures: decoded (straight) RGBA turned into premultiplied RGBA when
 * transparency is kept, or composited onto white (alpha 255) when it is not. Premultiplied, every
 * fully transparent pixel is (0,0,0,0) whatever junk colour it stored, a faint pixel sits near
 * "nothing" rather than near its colour, and an anti-aliased edge over transparency is a straight
 * line between the two colours, which the sub-pixel refinement in boundaries.ts relies on.
 * An opaque image is returned as is: both conversions leave it unchanged.
 */
export function prepareAlpha(image: RasterImage, keepAlpha: boolean): RasterImage {
  if (isOpaque(image)) return image
  const src = image.data
  const out = new Uint8ClampedArray(src.length)
  for (let o = 0; o < src.length; o += 4) {
    const a = src[o + 3]
    const f = a / 255
    const bg = keepAlpha ? 0 : 255 - a
    out[o] = src[o] * f + bg
    out[o + 1] = src[o + 1] * f + bg
    out[o + 2] = src[o + 2] * f + bg
    out[o + 3] = keepAlpha ? a : 255
  }
  return { width: image.width, height: image.height, data: out }
}

/** Premultiplied RGBA back to straight RGBA, for showing the preprocessed image. */
export function unpremultiply(image: RasterImage): RasterImage {
  if (isOpaque(image)) return image
  const src = image.data
  const out = new Uint8ClampedArray(src.length)
  for (let o = 0; o < src.length; o += 4) {
    const a = src[o + 3]
    if (a === 0) continue
    const f = 255 / a
    out[o] = src[o] * f
    out[o + 1] = src[o + 1] * f
    out[o + 2] = src[o + 2] * f
    out[o + 3] = a
  }
  return { width: image.width, height: image.height, data: out }
}

/** The palette's colours premultiplied (k×4 floats), the space pixel distances are measured in. */
export function premultipliedPalette(palette: Palette): Float64Array {
  const out = new Float64Array(palette.k * 4)
  for (let i = 0; i < palette.k; i++) {
    const f = palette.colors[4 * i + 3] / 255
    out[4 * i] = palette.colors[4 * i] * f
    out[4 * i + 1] = palette.colors[4 * i + 1] * f
    out[4 * i + 2] = palette.colors[4 * i + 2] * f
    out[4 * i + 3] = palette.colors[4 * i + 3]
  }
  return out
}
