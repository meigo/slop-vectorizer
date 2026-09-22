/** The filled portion of a range input, as the two CSS custom properties app.css's gradient reads
 *  (SLOP-TIMELINE-UI.md §6). Ported from slop-animator/src/lib/slider-fill.ts. A plain function
 *  in a `style` attribute rather than an action, so the fill also follows values changed from
 *  code (Reset, scale-driven gap clamping), not just drags. */
export function sliderFill(value: number, min: number, max: number): string {
  const span = max - min
  const t = span > 0 ? (value - min) / span : 0
  const pct = Math.max(0, Math.min(1, t)) * 100
  return `--fill-from:0%;--fill-to:${pct.toFixed(2)}%`
}
