<script lang="ts">
  import { PRESETS, rangeForPreset, rangeLabel } from '../range';
  import type { DateRange } from '../types';
  let { range, onChange } = $props<{ range: DateRange; onChange: (r: DateRange) => void }>();
  function pick(preset: (typeof PRESETS)[number]['id']) {
    onChange(rangeForPreset(preset, range.timezone));
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
