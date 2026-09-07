<script lang="ts">
  import type { ProviderView } from '../types';
  import Logo from './Logo.svelte';
  import { costDisplay, healthLabel } from '../lifecycle';
  let { provider } = $props<{ provider: ProviderView }>();
</script>

<div class="popover">
  <header>
    <div class="title"><Logo monogram={provider.monogram} accent={provider.accent} icon={provider.icon} label={`${provider.name} logo`} /><span>{provider.name}<small>{provider.vendor ?? ''}</small></span></div>
    <span class="freshness" data-f={provider.collectorHealth ?? provider.freshness}>{healthLabel((provider.collectorHealth as never) ?? undefined) === 'Unknown' ? provider.freshness : healthLabel((provider.collectorHealth as never) ?? undefined)}</span>
  </header>

  <section class="quota">
    <div class="quota-line"><span>{provider.primaryLabel}</span><strong>{provider.primaryPercent == null ? 'No observations yet' : `${provider.primaryPercent}%`}</strong></div>
    {#if provider.primaryPercent != null}
      <div class="bar"><span style={`width:${provider.primaryPercent}%;background:${provider.accent}`}></span></div>
    {/if}
    <div class="meta"><span>{provider.live ? 'Live quota window' : 'Current quota window'}</span><span>{provider.primaryReset ? `Resets ${provider.primaryReset}` : 'No reset reported'}</span></div>
  </section>

  <div class="stats">
    <div><span>Tokens</span><strong>{provider.tokensToday ?? 'No observations yet'}</strong></div>
    <div><span>Cost</span><strong>{costDisplay(provider.costToday, provider.cost_today_value)}</strong></div>
    <div><span>Scope</span><strong>{provider.scope}</strong></div>
  </div>
  <footer><i class:live={provider.live}></i>{provider.source} · {provider.scope} · {provider.live ? 'collecting' : 'not collecting'}</footer>
</div>

<style>
  small { display: block; font-size: 10px; color: var(--muted); font-weight: 500; }
</style>
