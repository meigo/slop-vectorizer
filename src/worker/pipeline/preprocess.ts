import type { RasterImage } from '../../types'

export interface PreOptions {
  blackPoint: number
  whitePoint: number
  blurRadius: number
  saturation: number
}

export const IDENTITY_PRE: PreOptions = { blackPoint: 0, whitePoint: 255, blurRadius: 0, saturation: 1 }

export function isIdentityPre(o: PreOptions): boolean {
  return o.blackPoint === 0 && o.whitePoint === 255 && o.blurRadius === 0 && o.saturation === 1
}

const clampi = (i: number, n: number) => (i < 0 ? 0 : i >= n ? n - 1 : i)

/** One 2-D box pass (horizontal then vertical sliding window), RGB channels, edge-clamped. */
function boxBlurPass(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(new ArrayBuffer(src.length * 4))
  const out = new Float32Array(new ArrayBuffer(src.length * 4))
  const norm = 1 / (2 * r + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let c = 0; c < 3; c++) {
      let sum = 0
      for (let x = -r; x <= r; x++) sum += src[(row + clampi(x, w)) * 4 + c]
      for (let x = 0; x < w; x++) {
        tmp[(row + x) * 4 + c] = sum * norm
        sum += src[(row + clampi(x + r + 1, w)) * 4 + c] - src[(row + clampi(x - r, w)) * 4 + c]
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0
      for (let y = -r; y <= r; y++) sum += tmp[(clampi(y, h) * w + x) * 4 + c]
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 4 + c] = sum * norm
        sum += tmp[(clampi(y + r + 1, h) * w + x) * 4 + c] - tmp[(clampi(y - r, h) * w + x) * 4 + c]
      }
    }
  }
  return out
}

/**
 * Apply levels, blur, and saturation adjustments. Aggressive blackPoint/whitePoint levels clip anti-aliased
 * edge gradients toward binary coverage, which degrades downstream sub-pixel boundary refinement toward pixel-grid accuracy.
 */
export function preprocess(image: RasterImage, opts: PreOptions): RasterImage {
  if (isIdentityPre(opts)) return image
  const { width: w, height: h } = image
  const data = new Float32Array(w * h * 4)
  for (let i = 0; i < image.data.length; i++) data[i] = image.data[i]
  let working: Float32Array = data
  if (opts.blurRadius > 0) {
    const r = Math.max(1, Math.round(opts.blurRadius))
    for (let i = 0; i < 3; i++) working = boxBlurPass(working, w, h, r)
  }
  const black = opts.blackPoint
  const white = Math.max(opts.whitePoint, black + 1)
  const scale = 255 / (white - black)
  const sat = opts.saturation
  const out = new Uint8ClampedArray(working.length)
  for (let p = 0; p < working.length; p += 4) {
    let r = working[p], g = working[p + 1], b = working[p + 2]
    if (sat !== 1) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      r = lum + (r - lum) * sat
      g = lum + (g - lum) * sat
      b = lum + (b - lum) * sat
    }
    out[p] = (r - black) * scale       // Uint8ClampedArray clamps + rounds
    out[p + 1] = (g - black) * scale
    out[p + 2] = (b - black) * scale
    out[p + 3] = 255
  }
  return { width: w, height: h, data: out }
}
