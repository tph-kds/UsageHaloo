<script lang="ts">
  let { metric = 'tokens', live = false, sample = false } = $props<{ metric?: string; live?: boolean; sample?: boolean }>();
  const levels = $derived(Array.from({ length: 7 * 46 }, (_, i) => {
    const base = ((i * 17 + 13) % 29) / 29;
    const wave = (Math.sin(i / 5) + 1) / 2;
    const factor = metric === 'cost' ? .75 : metric === 'requests' ? .55 : 1;
    return Math.min(4, Math.floor((base * .55 + wave * .45) * 5 * factor));
  }));
</script>
{#if !live && !sample}
  <p class="muted">No observed activity yet — heatmap appears after live telemetry arrives.</p>
{:else}
  <div class="heatmap" aria-label={`${metric} daily activity heatmap${sample && !live ? ' (sample pattern)' : ''}`}>
    {#each levels as level, i}<i data-level={level} title={`Day ${i + 1}`}></i>{/each}
  </div>
{/if}
