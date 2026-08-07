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
  '#' + [c[3 * i], c[3 * i + 1], c[3 * i + 2]].map(v => v.toString(16).padStart(2, '0')).join('')

function loopToPath(loop: Cubic[]): string {
  if (loop.length === 0) return ''
  let d = `M${f(loop[0][0])} ${f(loop[0][1])}`
  for (const c of loop) d += `C${f(c[2])} ${f(c[3])} ${f(c[4])} ${f(c[5])} ${f(c[6])} ${f(c[7])}`
  return d + 'Z'
}

export interface SvgOptions { mergePaths: boolean; transparentBg: boolean }

export function assembleSvg(
  paths: RegionPath[], palette: Palette, width: number, height: number, opts: SvgOptions,
): string {
  let items: RegionPath[]
  if (opts.mergePaths) {
    const byColor = new Map<number, RegionPath>()
    for (const p of paths) {
      const g = byColor.get(p.paletteIndex)
      if (g) { g.area += p.area; g.loops.push(...p.loops) }
      else byColor.set(p.paletteIndex, { paletteIndex: p.paletteIndex, area: p.area, loops: [...p.loops] })
    }
    items = [...byColor.values()]
  } else {
    items = [...paths]
  }
  if (opts.transparentBg && paths.length > 0) {
    const bg = paths.reduce((a, b) => (b.area > a.area ? b : a)).paletteIndex
    items = items.filter(i => i.paletteIndex !== bg)
  }
  const body = items
    .sort((a, b) => b.area - a.area)
    .map(p => `<path fill="${hex(palette.colors, p.paletteIndex)}" fill-rule="evenodd" d="${p.loops.map(loopToPath).join('')}"/>`)
    .join('\n  ')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">\n  ${body}\n</svg>\n`
}
