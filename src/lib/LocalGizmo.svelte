<!-- src/lib/LocalGizmo.svelte -->
<!-- Draws the local-levels circle in pane (screen) coordinates, outside the zoom transform, so
     strokes and the dot keep their size at any zoom. Pointer handling lives in the panes.

     ACCENT over a dark halo, not white: a white ring disappears into dense black-and-white line
     art, which is most of what this app traces. The artwork is effectively greyscale, so a
     saturated hue reads against paper, ink and everything between — and blue already means "this
     is the selected thing" everywhere else in the app. A blend mode was considered and rejected:
     `difference` turns white into the SAME mid-grey it sits on, so it fails on exactly the
     mid-tones (pencil, the SVG pane's checkerboard) where visibility is already hardest.
     Hidden circles stay muted grey — they are not part of the output, so they must not read as
     active. -->
<script lang="ts">
  import { DOT_R, type GizmoState, type ScreenCircle } from './localGizmo'

  let { c, state }: { c: ScreenCircle; state: GizmoState } = $props()
</script>

<svg class="gizmo" aria-hidden="true">
  {#if state === 'selected'}
    <g fill="none">
      <circle cx={c.x} cy={c.y} r={c.outer} class="halo" />
      <circle cx={c.x} cy={c.y} r={c.outer} class="ring dashed" />
      <circle cx={c.x} cy={c.y} r={c.inner} class="halo" />
      <circle cx={c.x} cy={c.y} r={c.inner} class="ring" />
    </g>
    <circle cx={c.x} cy={c.y} r={DOT_R} class="dot" />
  {:else}
    <g fill="none">
      <circle cx={c.x} cy={c.y} r={c.inner} class="halo" />
      <circle
        cx={c.x}
        cy={c.y}
        r={c.inner}
        class={['ring', 'quiet', state === 'hidden' && 'dashed hidden-ring']}
      />
    </g>
  {/if}
</svg>

<style>
  .gizmo {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .halo {
    stroke: rgb(0 0 0 / 0.55);
    stroke-width: 3;
  }
  .ring {
    stroke: var(--color-accent);
    stroke-width: 1.75;
  }
  .dashed {
    stroke-dasharray: 6 4;
  }
  .dot {
    fill: var(--color-accent);
    stroke: rgb(0 0 0 / 0.55);
    stroke-width: 1.5;
  }
  .quiet {
    stroke-width: 1.25;
    opacity: 0.8;
  }
  /* Hidden: grey rather than accent, so "in the list but not in the output" is visible at a
     glance without reading the eye icon. */
  .hidden-ring {
    stroke: var(--color-muted);
    opacity: 0.65;
  }
</style>
