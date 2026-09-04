<script lang="ts">
  import type { ProviderView } from '../types';
  let { provider } = $props<{ provider: ProviderView }>();
</script>

<div class="popover glass">
  <header>
    <div class="title"><span class="mini" style={`border-color:${provider.accent}66`}>{provider.monogram}</span><span>{provider.name}<small>{provider.vendor ?? ''}</small></span></div>
    <span class:live={provider.live || provider.freshness === 'live'} class="freshness">{provider.live ? '● Live' : provider.freshness}</span>
  </header>

  <section class="quota">
    <div class="quota-line"><span>{provider.primaryLabel}</span><strong>{provider.primaryPercent == null ? '—' : `${provider.primaryPercent}%`}</strong></div>
    <div class="bar"><span style={`width:${provider.primaryPercent ?? 0}%;background:${provider.accent}`}></span></div>
    <div class="meta"><span>Primary</span><span>{provider.primaryReset ? `Resets ${provider.primaryReset}` : 'No reset'}</span></div>
  </section>

  {#if provider.secondaryLabel}
    <section class="quota">
      <div class="quota-line"><span>{provider.secondaryLabel}</span><strong>{provider.secondaryPercent == null ? '—' : `${provider.secondaryPercent}%`}</strong></div>
      <div class="bar"><span style={`width:${provider.secondaryPercent ?? 0}%;background:${provider.accent};opacity:.72`}></span></div>
      <div class="meta"><span>Secondary</span><span>{provider.secondaryReset ?? ''}</span></div>
    </section>
  {/if}

  <div class="stats">
    <div><span>Tokens</span><strong>{provider.tokensToday ?? '—'}</strong></div>
    <div><span>Cost</span><strong>{provider.costToday ?? '—'}</strong></div>
    <div><span>Scope</span><strong>{provider.scope}</strong></div>
  </div>
  <footer><i class:live={provider.live}></i>{provider.source} · {provider.scope} · {provider.live ? 'live' : 'sample'}</footer>
</div>

<style>
  small { display: block; font-size: 10px; color: var(--muted); font-weight: 500; }
</style>
