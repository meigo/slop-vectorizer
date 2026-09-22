<!-- src/lib/FileMenu.svelte -->
<!-- The File ▾ menu: the one-shot commands (new, open, project saves), following the family's
     frequency split — Save SVG stays a button because it is pressed repeatedly, these are not
     (SLOP-TIMELINE-UI.md §6b). Every command lives in exactly one place; nothing here is also
     a button elsewhere. Closing is handled by a full-window backdrop BEHIND the dropdown, so a
     click on the trigger is not also "outside" (which would close and instantly reopen). -->
<script lang="ts">
  let {
    canNew,
    canSaveProject,
    projectSavedName,
    canSaveAs,
    mod,
    onnew,
    onopen,
    onsaveproject,
  }: {
    canNew: boolean
    canSaveProject: boolean
    /** The project file Save project overwrites; null = it will ask where. */
    projectSavedName: string | null
    /** Whether a separate "Save as…" means anything: only with a save picker, i.e. not iPad. */
    canSaveAs: boolean
    /** '⌘' or 'Ctrl+', for the shortcut hints. */
    mod: string
    onnew: () => void
    onopen: () => void
    onsaveproject: (asNew: boolean) => void
  } = $props()

  let open = $state(false)

  function run(fn: () => void) {
    open = false
    fn()
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && open) open = false
  }}
/>

<div class="wrap">
  <button aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)}>
    File<span class="caret">▾</span>
  </button>
  {#if open}
    <button class="backdrop" aria-label="Close menu" tabindex="-1" onclick={() => (open = false)}
    ></button>
    <div class="menu" role="menu">
      <button class="item" role="menuitem" disabled={!canNew} onclick={() => run(onnew)}
        >New image</button
      >
      <button class="item" role="menuitem" onclick={() => run(onopen)}>
        Open project… <span class="kbd">{mod}O</span>
      </button>
      <div class="sep"></div>
      <button
        class="item"
        role="menuitem"
        disabled={!canSaveProject}
        title={projectSavedName
          ? `Overwrite ${projectSavedName}`
          : 'Save the image and all settings'}
        onclick={() => run(() => onsaveproject(false))}>Save project</button
      >
      {#if canSaveAs && projectSavedName}
        <button
          class="item"
          role="menuitem"
          disabled={!canSaveProject}
          onclick={() => run(() => onsaveproject(true))}>Save project as…</button
        >
      {/if}
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
  }
  .caret {
    font-size: 10px;
    opacity: 0.7;
  }
  /* Covers the window so any outside click closes; below the dropdown, above everything else. */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    height: auto;
    padding: 0;
    border: none;
    border-radius: 0;
    background: none;
    cursor: default;
  }
  .menu {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 50;
    margin-top: 4px;
    min-width: 200px;
    padding: 4px 0;
    border: 1px solid var(--color-line);
    border-radius: 8px;
    background: var(--color-panel);
    box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.4);
  }
  .item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    width: 100%;
    height: var(--ctl-h);
    padding: 0 12px;
    border: none;
    border-radius: 0;
    background: none;
    text-align: left;
  }
  .item:hover:not(:disabled) {
    background: var(--color-raised);
  }
  .kbd {
    color: var(--color-muted);
    font-size: 11px;
  }
  .sep {
    height: 1px;
    margin: 4px 0;
    background: var(--color-line);
  }
</style>
