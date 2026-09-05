<script lang="ts">
  // P0-01 truth rule: production heat cells render ONLY from real history
  // buckets supplied by the backend (get_activity_buckets in Phase 4).
  // - sample=true  → deterministic sample pattern, always labeled SAMPLE.
  // - buckets>0    → real cells, one per input bucket.
  // - otherwise    → honest empty state, zero cells.
  // No hash/sine/random generator exists in the production path.
  type Bucket = { value: number };
  let { metric = 'tokens', sample = false, buckets = null }: { metric?: string; sample?: boolean; buckets?: Bucket[] | null } = $props();

  const realLevels = $derived.by(() => {
    const list: number[] = [];
    for (const b of buckets ?? []) list.push(Math.max(0, Math.min(4, Math.floor(b.value))));
    return list;
  });
  const sampleLevels = $derived(Array.from({ length: 7 * 46 }, (_, i) => {
    const base = ((i * 17 + 13) % 29) / 29;
    const wave = (Math.sin(i / 5) + 1) / 2;
    const factor = metric === 'cost' ? .75 : metric === 'requests' ? .55 : 1;
    return Math.min(4, Math.floor((base * .55 + wave * .45) * 5 * factor));
  }));
</script>
{#if sample}
  <div class="heatmap" aria-label={`${metric} daily activity heatmap (sample pattern)`}>
    {#each sampleLevels as level, i}<i data-level={level} title={`Day ${i + 1} (sample)`}></i>{/each}
  </div>
  <p class="muted">Sample pattern — connect a provider for real history.</p>
{:else if realLevels.length > 0}
  <div class="heatmap" aria-label={`${metric} daily activity heatmap`}>
    {#each realLevels as level, i}<i data-level={level} title={`Bucket ${i + 1}`}></i>{/each}
  </div>
{:else}
  <p class="muted">No historical activity collected yet.</p>
{/if}
