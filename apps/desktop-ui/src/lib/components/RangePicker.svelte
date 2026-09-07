<script lang="ts">
  import { PRESETS, rangeLabel } from '../range';
  import type { DateRange } from '../types';
  let { range, onChange } = $props<{ range: DateRange; onChange: (r: DateRange) => void }>();
  function pick(preset: (typeof PRESETS)[number]['id']) {
    const now = new Date();
    const start = new Date(now);
    if (preset === 'today') start.setHours(0, 0, 0, 0);
    else if (preset === 'last7' || preset === 'custom') start.setDate(start.getDate() - 7);
    else if (preset === 'week') { const dow = (start.getDay() + 6) % 7; start.setDate(start.getDate() - dow); start.setHours(0, 0, 0, 0); }
    else if (preset === 'last30') start.setDate(start.getDate() - 30);
    else if (preset === 'month' || preset === 'billing') { start.setDate(1); start.setHours(0, 0, 0, 0); }
    onChange({ start: start.toISOString(), end: now.toISOString(), timezone: range.timezone, preset });
  }
</script>

<div class="rangebar" role="toolbar" aria-label="Historical range">
  <div class="presets">
    {#each PRESETS as p}
      <button class:active={range.preset === p.id} onclick={() => pick(p.id)} aria-pressed={range.preset === p.id}>{p.label}</button>
    {/each}
  </div>
  <div class="range-meta">
    <span class="range-label">{rangeLabel(range)}</span>
    <span class="tz">{range.timezone}</span>
  </div>
</div>

<style>
  .rangebar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
  .presets { display: flex; gap: 6px; flex-wrap: wrap; }
  .presets button { border: 1px solid var(--line); background: var(--panel); color: var(--muted); padding: 7px 12px; border-radius: 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
  .presets button.active { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  .presets button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .range-meta { display: flex; gap: 8px; align-items: baseline; font-size: 12px; color: var(--muted); }
  .range-label { font-weight: 700; color: var(--ink); }
  .tz { font-variant-numeric: tabular-nums; }
</style>
