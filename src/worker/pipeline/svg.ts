import type { Palette } from '../../types'
import type { Cubic } from './fitcurves'

export interface RegionPath {
  paletteIndex: number
  area: number
  loops: Cubic[][]
}

export function polygonArea(loop: Float64Array): number {
  let a = 0
  const n = loop.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += loop[2 * i] * loop[2 * j + 1] - loop[2 * j] * loop[2 * i + 1]
  }
  return a / 2
}

const f = (v: number) => {
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

const hex = (c: Uint8ClampedArray, i: number) =>
  '#' + [c[3 * i], c[3 * i + 1], c[3 * i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')

function loopToPath(loop: Cubic[]): string {
  if (loop.length === 0) return ''
  let d = `M${f(loop[0][0])} ${f(loop[0][1])}`
  for (const c of loop) d += `C${f(c[2])} ${f(c[3])} ${f(c[4])} ${f(c[5])} ${f(c[6])} ${f(c[7])}`
  return d + 'Z'
}

const centi = (v: number) => Math.round(v * 100)

/** Format centi-units: 1234 -> "12.34", 50 -> ".5", -50 -> "-.5", 1200 -> "12", 0 -> "0". */
const fmtCenti = (c: number): string => {
  if (c === 0) return '0'
  const neg = c < 0,
    a = Math.abs(c)
  const int = Math.floor(a / 100),
    frac = a % 100
  let s: string
  if (frac === 0) s = String(int)
  else {
    let fs = String(frac).padStart(2, '0')
    if (fs.endsWith('0')) fs = fs.slice(0, 1)
    s = (int === 0 ? '' : String(int)) + '.' + fs
  }
  return (neg ? '-' : '') + s
}

/** Join with single spaces, omitting the space before a negative number. */
const joinNums = (parts: string[]): string =>
  parts.reduce((acc, p) => acc + (acc === '' || p.startsWith('-') ? '' : ' ') + p, '')

function loopToPathCompact(loop: Cubic[]): string {
  if (loop.length === 0) return ''
  let cx = centi(loop[0][0]),
    cy = centi(loop[0][1])
  let d = 'M' + joinNums([fmtCenti(cx), fmtCenti(cy)])
  for (const c of loop) {
    const n = [
      centi(c[2]) - cx,
      centi(c[3]) - cy,
      centi(c[4]) - cx,
      centi(c[5]) - cy,
      centi(c[6]) - cx,
      centi(c[7]) - cy,
    ]
    d += 'c' + joinNums(n.map(fmtCenti))
    cx = centi(c[6])
    cy = centi(c[7])
  }
  return d + 'z'
}

export interface SvgOptions {
  mergePaths: boolean
  transparentBg: boolean
  optimize: boolean
  colorOverrides: (string | null)[] | null
}

export function assembleSvg(
  paths: RegionPath[],
  palette: Palette,
  width: number,
  height: number,
  opts: SvgOptions,
): string {
  let items: RegionPath[]
  if (opts.mergePaths) {
    const byColor = new Map<number, RegionPath>()
    for (const p of paths) {
      const g = byColor.get(p.paletteIndex)
      if (g) {
        g.area += p.area
        g.loops.push(...p.loops)
      } else
        byColor.set(p.paletteIndex, {
          paletteIndex: p.paletteIndex,
          area: p.area,
          loops: [...p.loops],
        })
    }
    items = [...byColor.values()]
  } else {
    items = [...paths]
  }
  if (opts.transparentBg && paths.length > 0) {
    const bg = paths.reduce((a, b) => (b.area > a.area ? b : a)).paletteIndex
    items = items.filter((i) => i.paletteIndex !== bg)
  }
  const toPath = opts.optimize ? loopToPathCompact : loopToPath
  const body = items
    .sort((a, b) => b.area - a.area)
    .map((p) => {
      const fill = opts.colorOverrides?.[p.paletteIndex] ?? hex(palette.colors, p.paletteIndex)
      return `<path fill="${fill}" fill-rule="evenodd" d="${p.loops.map(toPath).join('')}"/>`
    })
    .join('\n  ')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n  ${body}\n</svg>\n`
}
