<script lang="ts">
  // Honest trend: renders ONLY supplied real points. Empty input renders
  // an explicit empty state, never a fabricated curve (§7, §10).
  let { points = [], label = 'Usage trend' }: { points?: number[]; label?: string } = $props();
  const W = 560; const H = 120; const P = 10;
  const max = $derived(Math.max(1, ...points));
  const path = $derived(
    points.length > 1
      ? points.map((v, i) => `${i === 0 ? 'M' : 'L'}${(P + (i * (W - 2 * P)) / (points.length - 1)).toFixed(1)},${(H - P - (v / max) * (H - 2 * P)).toFixed(1)}`).join(' ')
      : '',
  );
</script>

<div class="trend" role="img" aria-label={label}>
  {#if points.length > 1}
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  {:else}
    <p class="empty">No trend yet — connect a provider to begin tracking.</p>
  {/if}
</div>

<style>
  .trend { color: var(--ink); border: 1px solid var(--line); border-radius: 12px; padding: 12px; background: var(--surface); min-height: 88px; display: grid; place-items: stretch; }
  svg { width: 100%; height: 96px; display: block; }
  .empty { font-size: 12px; color: var(--muted); margin: 0; place-self: center; }
</style>
