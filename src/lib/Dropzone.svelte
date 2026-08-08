<!-- src/lib/Dropzone.svelte -->
<script lang="ts">
  let { onfile, error = null }: { onfile: (file: File) => void; error?: string | null } = $props()
  let dragging = $state(false)
  let fileInput: HTMLInputElement

  function browse() {
    fileInput.click()
  }
  function picked() {
    const f = fileInput.files?.[0]
    if (f) onfile(f)
    fileInput.value = ''
  }
  function drop(e: DragEvent) {
    e.preventDefault()
    dragging = false
    const f = e.dataTransfer?.files?.[0]
    if (f) onfile(f)
  }
  function paste(e: ClipboardEvent) {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
    const f = item?.getAsFile()
    if (f) onfile(f)
  }
</script>

<svelte:window onpaste={paste} />
<input type="file" accept="image/*" hidden bind:this={fileInput} onchange={picked} />
<div
  class="dropzone"
  class:dragging
  ondragover={(e) => {
    e.preventDefault()
    dragging = true
  }}
  ondragleave={() => (dragging = false)}
  ondrop={drop}
  onclick={browse}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      browse()
    }
  }}
  role="button"
  tabindex="0"
>
  <p>Drop an image here, click to browse, or paste from clipboard</p>
  {#if error}<p class="error">{error}</p>{/if}
</div>

<style>
  .dropzone {
    border: 2px dashed #888;
    border-radius: 8px;
    padding: 3rem;
    text-align: center;
    color: #666;
    cursor: pointer;
  }
  .dropzone.dragging {
    border-color: #4a90d9;
    background: #4a90d910;
  }
  .error {
    color: #c0392b;
  }
</style>
