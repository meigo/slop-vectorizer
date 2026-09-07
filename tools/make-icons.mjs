#!/usr/bin/env node
// Generates the favicon + PWA / home-screen icons into public/.
//
// Source of truth is public/favicon.svg — this reads its path data and rasterizes it, so a change
// to the artwork only needs a re-run. Dependency-free on purpose: no SVG rasterizer is installed
// and the project adds none, so the path is flattened and scanline-filled here, then encoded as
// PNG with Node's zlib. Not wired into the build — outputs are committed. Regenerate with:
//   node tools/make-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BG = [0xff, 0xff, 0xff] // white plate — the mark is black, and a white square reads on any tab bar
const INK = [0x00, 0x00, 0x00]
/** Supersampling factor per axis. 4 → 16 coverage samples per output pixel. */
const SS = 4

const lerp = (a, b, t) => a + (b - a) * t

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** Encode a square RGBA8 buffer (length = size*size*4) as a PNG. */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // bytes 10-12 (compression, filter, interlace) stay 0
  const stride = size * 4
  const raw = Buffer.alloc(size * (stride + 1))
  for (let y = 0; y < size; y++) {
    const o = y * (stride + 1)
    raw[o] = 0 // filter: none
    rgba.copy(raw, o + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Flatten an SVG path into closed polygons (arrays of points).
 *
 * Deliberately supports only the commands the artwork uses — M (absolute moveto), c (relative
 * cubic) and z. Anything else throws rather than silently dropping part of the mark; widen this
 * if the art ever needs it.
 */
function flattenPath(d, curveSteps = 24) {
  const tokens = d.match(/[MmCcLlZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []
  const polys = []
  let poly = null
  let x = 0,
    y = 0,
    i = 0
  const num = () => {
    const v = Number(tokens[i++])
    if (Number.isNaN(v)) throw new Error(`bad number at token ${i - 1}: ${tokens[i - 1]}`)
    return v
  }
  let cmd = null
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++]
    // else: repeated parameter set for the previous command (SVG implicit repetition)
    if (cmd === 'M') {
      x = num()
      y = num()
      poly = [{ x, y }]
      polys.push(poly)
      cmd = 'L' // per spec, extra pairs after M are implicit linetos
    } else if (cmd === 'L') {
      x = num()
      y = num()
      poly.push({ x, y })
    } else if (cmd === 'c') {
      const x1 = x + num(),
        y1 = y + num()
      const x2 = x + num(),
        y2 = y + num()
      const x3 = x + num(),
        y3 = y + num()
      for (let s = 1; s <= curveSteps; s++) {
        const t = s / curveSteps,
          u = 1 - t
        poly.push({
          x: u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          y: u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        })
      }
      x = x3
      y = y3
    } else if (cmd === 'C') {
      // Absolute cubic. Same flattening as `c`, but the control points ARE the coordinates rather
      // than deltas from the current point — added when the favicon became the shared slop mark,
      // which Illustrator exported absolute. Keep both branches: converting art to one convention
      // by hand is how a coordinate gets mistyped.
      const x1 = num(),
        y1 = num()
      const x2 = num(),
        y2 = num()
      const x3 = num(),
        y3 = num()
      for (let s = 1; s <= curveSteps; s++) {
        const t = s / curveSteps,
          u = 1 - t
        poly.push({
          x: u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          y: u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        })
      }
      x = x3
      y = y3
    } else if (cmd === 'z' || cmd === 'Z') {
      poly = null
      cmd = null
    } else {
      throw new Error(`unsupported path command: ${cmd}`)
    }
  }
  return polys.filter((p) => p.length > 2)
}

/** Ink extent of the flattened path, so the fit below never depends on the viewBox. */
function bounds(polys) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const p of polys)
    for (const { x, y } of p) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

/**
 * Rasterize the polygons into a size×size RGBA icon: black ink on a full-bleed white plate.
 * `fill` (0..1) is the fraction of the square the MARK occupies — the plate is always full-bleed,
 * so a smaller value only insets the art (0.55 keeps it inside Android's maskable safe zone).
 *
 * Scanline even-odd fill at SS× resolution, box-filtered down — matching the path's fill-rule,
 * and giving the thin strokes of this mark enough antialiasing to survive 32px.
 */
function render(polys, size, fill) {
  const b = bounds(polys)
  const scale = (size * fill) / Math.max(b.w, b.h)
  const ox = (size - b.w * scale) / 2 - b.minX * scale
  const oy = (size - b.h * scale) / 2 - b.minY * scale
  // Device-space edges, y ascending.
  const edges = []
  for (const p of polys)
    for (let k = 0; k < p.length; k++) {
      const a = p[k],
        c = p[(k + 1) % p.length] // implicit close
      const ax = a.x * scale + ox,
        ay = a.y * scale + oy
      const cx = c.x * scale + ox,
        cy = c.y * scale + oy
      if (ay !== cy) edges.push({ x0: ax, y0: ay, x1: cx, y1: cy })
    }

  const cov = new Float32Array(size * size)
  const xs = []
  const step = 1 / SS
  for (let sy = 0; sy < size * SS; sy++) {
    const py = (sy + 0.5) * step
    xs.length = 0
    for (const e of edges) {
      const lo = Math.min(e.y0, e.y1),
        hi = Math.max(e.y0, e.y1)
      if (py < lo || py >= hi) continue
      xs.push(e.x0 + ((py - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0))
    }
    if (xs.length < 2) continue
    xs.sort((a, c) => a - c)
    const row = Math.floor(sy / SS) * size
    // Even-odd: fill between alternating crossing pairs.
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = xs[k],
        to = xs[k + 1]
      for (let sx = Math.max(0, Math.floor(from * SS)); sx < Math.min(size * SS, to * SS); sx++) {
        const px = (sx + 0.5) * step
        if (px >= from && px < to) cov[row + Math.floor(px)] += 1
      }
    }
  }

  const rgba = Buffer.alloc(size * size * 4)
  const samples = SS * SS
  for (let i = 0; i < size * size; i++) {
    const a = Math.min(1, cov[i] / samples)
    rgba[i * 4] = Math.round(lerp(BG[0], INK[0], a))
    rgba[i * 4 + 1] = Math.round(lerp(BG[1], INK[1], a))
    rgba[i * 4 + 2] = Math.round(lerp(BG[2], INK[2], a))
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
mkdirSync(outDir, { recursive: true })

/** Read one SVG's path data and flatten it. `dir` picks live art (`public/`) or dormant (`tools/`). */
function load(file, dir = outDir) {
  const svg = readFileSync(join(dir, file), 'utf8')
  const d = svg.match(/\sd="([^"]+)"/)?.[1]
  if (!d) throw new Error(`no path data found in ${join(dir, file)}`)
  return flattenPath(d)
}

// Two marks on purpose. The full "slop" logotype is four letters of hand lettering: it reads at
// 180px and up, and turns to mush at 32. The tab icon therefore gets the star alone — the same
// glyph, simplified — so favicon.svg (which modern browsers render at ANY size) and its PNG
// fallback agree. Keep them in sync if the art changes.
const favicon = load('favicon.svg') // the shared slop mark
// EVERY output is the mark for now, tab and Home Screen alike, so the slop-* apps look like one
// family at every size. `tools/icon.svg` still holds the hand-lettered "slop" logotype and is the
// way back: `load('icon.svg', dirname(fileURLToPath(import.meta.url)))` restores it for the PWA /
// apple-touch sizes,
// where it reads well (it only blurs around 32px, which is why the tab never used it). It lives in
// `tools/` rather than `public/` precisely because it is dormant — art nothing generates from should
// not be deployed, and a file sitting in `public/` looks like a live source.
const logotype = favicon

for (const [name, size, fill, polys] of [
  ['favicon-32.png', 32, 0.86, favicon], // tab fallback for browsers without SVG favicon support
  ['icon-180.png', 180, 0.86, logotype], // apple-touch-icon (iOS rounds the corners itself)
  ['icon-192.png', 192, 0.86, logotype],
  ['icon-512.png', 512, 0.86, logotype],
  ['icon-512-maskable.png', 512, 0.55, logotype], // inside Android's safe-zone crop
]) {
  writeFileSync(join(outDir, name), encodePng(size, render(polys, size, fill)))
  console.log(`wrote public/${name} (${size}x${size})`)
}
