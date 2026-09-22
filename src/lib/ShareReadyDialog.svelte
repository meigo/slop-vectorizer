<!-- src/lib/ShareReadyDialog.svelte -->
<!-- Shown on iPad when the share sheet could not open straight from the Save tap (the tap had
     expired, or sharing failed). Its Save to Files button IS the fresh tap Safari wants, so
     shareFile is called before anything awaits. Ported from slop-vector-editor/slop-animator. -->
<script lang="ts">
  import { shareFile } from './share'
  import { downloadBlob, errorMessage } from './saveFile'

  let {
    file,
    error,
    onclose,
  }: {
    file: File
    /** The browser's message when a direct share failed outright; '' for an expired tap. */
    error: string
    /** Called with the status line to show, or null when nothing happened. */
    onclose: (status: string | null) => void
  } = $props()

  // Held while the sheet is up: a second tap throws InvalidStateError ("already open").
  let sharing = $state(false)
  // Seeded once from the direct attempt, then owned here.
  // svelte-ignore state_referenced_locally
  let message = $state(error ? `Couldn't share: ${error}` : '')

  async function share() {
    if (sharing) return
    sharing = true
    const r = await shareFile(file)
    sharing = false
    if (r.outcome === 'shared') onclose(`Sent ${file.name} to the share sheet`)
    else if (r.outcome === 'dismissed') message = 'Not saved — the share sheet was closed.'
    else
      message = `Couldn't share: ${
        r.outcome === 'needs-tap'
          ? 'the browser refused to open the share sheet.'
          : errorMessage(r.error)
      }`
  }

  function download() {
    downloadBlob(file, file.name)
    onclose(`Downloaded ${file.name}`)
  }

  function cancel() {
    if (!sharing) onclose(null)
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') cancel()
  }}
/>

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && cancel()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="share-ready-title">
    <h2 id="share-ready-title">{file.name} is ready</h2>
    <p>In the share sheet, choose “Save to Files” and pick a folder.</p>
    {#if message}<p class="message">{message}</p>{/if}
    <div class="actions">
      <button disabled={sharing} onclick={cancel}>Cancel</button>
      <button
        disabled={sharing}
        title="Download to the browser's Downloads, as before"
        onclick={download}>Download instead</button
      >
      <button class="btn-primary" disabled={sharing} onclick={share}>Save to Files…</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgb(0 0 0 / 0.5);
  }
  .dialog {
    width: 100%;
    max-width: 384px;
    padding: 16px;
    border: 1px solid var(--color-line);
    border-radius: 8px;
    background: var(--color-panel);
    box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.4);
  }
  h2 {
    margin: 0 0 12px;
    font-size: 14px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0 0 4px;
    font-size: 12px;
    color: var(--color-muted);
  }
  .message {
    margin-top: 8px;
    color: var(--color-danger);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
</style>
