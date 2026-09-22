<!-- src/lib/LocalGizmo.svelte -->
<!-- Draws the local-levels circle in pane (screen) coordinates, outside the zoom transform, so
     strokes and the dot keep their size at any zoom. Pointer handling lives in the panes. White
     over a dark halo rather than theme tokens: it sits on ARTWORK, which may be light or dark. -->
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
        class={['ring', 'quiet', state === 'hidden' && 'dashed']}
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
    stroke: #fff;
    stroke-width: 1.5;
  }
  .dashed {
    stroke-dasharray: 6 4;
  }
  .dot {
    fill: #fff;
    stroke: rgb(0 0 0 / 0.55);
    stroke-width: 1.5;
  }
  .quiet {
    stroke-width: 1;
    opacity: 0.7;
  }
</style>
