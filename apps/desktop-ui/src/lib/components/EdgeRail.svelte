<script lang="ts">
  import type { ProviderView } from '../types';
  import UsageRing from './UsageRing.svelte';
  import ProviderPopover from './ProviderPopover.svelte';

  let { providers, visibleCount = 6, onMore = () => {} } = $props<{
    providers: ProviderView[];
    visibleCount?: number;
    onMore?: () => void;
  }>();
  let active: string | null = $state(null);
  const visible = $derived(providers.filter((p: ProviderView) => p.enabled !== false).slice(0, visibleCount));
  const overflow = $derived(Math.max(0, providers.filter((p: ProviderView) => p.enabled !== false).length - visible.length));
</script>

<aside class="edge-rail glass" aria-label="Provider usage rail">
  <div class="grip"></div>
  {#each visible as provider (provider.id)}
    <div class="bubble-wrap">
      <button class="bubble" aria-label={`${provider.name} ${provider.primaryPercent ?? 'no data'}%`} onmouseenter={() => active = provider.id} onmouseleave={() => active = null} onfocus={() => active = provider.id} onblur={() => active = null}>
        <UsageRing percent={provider.primaryPercent} accent={provider.accent} monogram={provider.monogram} icon={provider.icon} />
        <span>{provider.primaryPercent == null ? '—' : `${provider.primaryPercent}%`}{provider.live ? '' : ''}</span>
      </button>
      {#if active === provider.id}<ProviderPopover {provider} />{/if}
    </div>
  {/each}
  {#if overflow > 0}<button class="more" onclick={onMore}>+{overflow}</button>{/if}
</aside>
