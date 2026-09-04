<script lang="ts">
  let { percent = null, accent = '#fff', monogram = '?', icon = undefined } = $props<{
    percent: number | null;
    accent: string;
    monogram: string;
    icon?: string;
  }>();
  const safe = $derived(percent == null ? 0 : Math.max(0, Math.min(percent, 100)));
  let imgOk = $state(true);
</script>

<div class="ring" style={`--p:${safe};--accent:${accent}`} aria-label={percent == null ? 'No percentage metric' : `${percent}% used`}>
  {#if icon && imgOk}
    <img class="ring-icon" src={icon} alt="" onerror={() => imgOk = false} />
  {:else}
    <div class="ring-inner">{monogram}</div>
  {/if}
</div>

<style>
  .ring-icon { position: relative; z-index: 1; width: 30px; height: 30px; border-radius: 50%; object-fit: contain; background: rgba(255,255,255,.05); }
</style>
