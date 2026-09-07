<script lang="ts">
  // Shared logo stack: monogram letter behind, real provider logo covering
  // it. A failed image removes itself so the letter shows — never a
  // broken-image glyph. Same method on every surface (demo + desktop).
  let { monogram, accent, icon = undefined, label = '' } = $props<{
    monogram: string;
    accent: string;
    icon?: string;
    label?: string;
  }>();
  let imgOk = $state(true);
</script>

<span class="logo-stack" style={`--a:${accent}`} role={label ? 'img' : undefined} aria-label={label || undefined}>
  {monogram}
  {#if icon && imgOk}<img src={icon} alt="" loading="lazy" onerror={() => (imgOk = false)} />{/if}
</span>

<style>
  .logo-stack {
    position: relative; overflow: hidden; display: grid; place-items: center;
    font-weight: 800; font-size: 13px; flex: none;
    width: 36px; height: 36px; border-radius: 11px;
    background: color-mix(in srgb, var(--a) 16%, transparent);
    border: 1px solid color-mix(in srgb, var(--a) 40%, transparent);
  }
  .logo-stack img {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: contain; background: var(--surface); border-radius: inherit; padding: 4px;
  }
</style>
