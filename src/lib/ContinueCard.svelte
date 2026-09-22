<!-- src/lib/ContinueCard.svelte -->
<!-- The start screen's offer to resume the autosaved session. Never restores by itself: an
     accidental reload must not skip the start screen, and New image must not destroy work. -->
<script lang="ts">
  import { savedAtLabel, type AutosaveRecord } from './autosave'

  let { rec, onopen }: { rec: AutosaveRecord; onopen: () => void } = $props()

  const thumbUrl = $derived(rec.thumb ? URL.createObjectURL(rec.thumb) : null)
  $effect(() => {
    const url = thumbUrl
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  })
</script>

<button class="card" onclick={onopen}>
  {#if thumbUrl}<img src={thumbUrl} alt="" />{/if}
  <span class="text">
    <span class="name">Continue {rec.sourceName || 'last session'}</span>
    <span class="when">{savedAtLabel(rec.savedAt)}</span>
  </span>
</button>

<style>
  .card {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: auto;
    padding: 8px;
    margin-bottom: 12px;
    text-align: left;
    background: var(--color-panel);
  }
  img {
    width: 44px;
    height: 44px;
    object-fit: contain;
    border-radius: 4px;
    background: var(--color-raised);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .when {
    color: var(--color-muted);
    font-size: 11px;
  }
</style>
