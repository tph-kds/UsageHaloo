<script lang="ts">
  import type { ProviderConnection, ProviderView } from '../types';
  import Logo from './Logo.svelte';
  import { costDisplay, healthLabel, planDisplay } from '../lifecycle';
  import { catalogById } from '../catalog';

  let { provider, connection, onToggle, onRemove, onDetails, onConnect } = $props<{
    provider: ProviderView;
    connection?: ProviderConnection;
    onToggle: (id: string, enabled: boolean) => void;
    onRemove: (id: string) => void;
    onDetails: (id: string) => void;
    onConnect: (providerId: string) => void;
  }>();

  const def = $derived(catalogById(provider.id));
  const connected = $derived(!!connection);
</script>

<article class="card" aria-label={`${provider.name} provider card`}>
  <header>
    <div class="id">
      <Logo monogram={provider.monogram} accent={provider.accent} icon={provider.icon} label={`${provider.name} logo`} />
      <div>
        <strong>{connection?.display_name ?? provider.name}</strong>
        <small>{provider.vendor ?? ''}{def ? ` · ${def.group}` : ''}</small>
      </div>
    </div>
    {#if connected}
      <span class="health" data-h={provider.collectorHealth ?? 'unknown'}>● {healthLabel(provider.collectorHealth)}</span>
    {:else}
      <span class="health" data-h="unknown">{provider.stage === 'detected' ? 'Detected locally' : 'Not connected'}</span>
    {/if}
  </header>

  {#if connected}
    <div class="today">
      <div><span>Tokens</span><strong>{provider.tokensToday ?? 'No observations yet'}</strong></div>
      <div><span>Cost</span><strong>{costDisplay(provider.costToday, provider.cost_today_value)}</strong></div>
      <div><span>Quota</span><strong>{provider.primaryPercent != null ? `${provider.primaryPercent}% ${provider.primaryLabel}` : 'No observations yet'}</strong></div>
    </div>
    <p class="meta">Last sync: {provider.lastSeenAt ? new Date(provider.lastSeenAt).toLocaleString() : 'never'} · Source: {provider.source} · {connection ? planDisplay(connection.plan, connection.plan_source) : ''}</p>
    <footer>
      <button class="ghost" onclick={() => onDetails(provider.id)}>View details</button>
      <label class="switch">
        <input type="checkbox" checked={connection?.enabled} onchange={(e) => connection && onToggle(connection.id, (e.target as HTMLInputElement).checked)} />
        <span>{connection?.enabled ? 'Enabled' : 'Disabled'}</span>
      </label>
    </footer>
  {:else}
    <p class="desc">{def?.docs ?? 'API integration'}</p>
    <div class="caps-row">
      <span>{provider.stage === 'detected' ? 'Previously detected · no recent activity' : 'Supported but not configured'}</span>
    </div>
    <footer>
      <span class="notconn">{provider.stage === 'detected' ? 'Detected locally' : 'Not connected'}</span>
      <button class="primary" onclick={() => onConnect(provider.id)}>Connect</button>
    </footer>
  {/if}
</article>

<style>
  .card { border: 1px solid var(--line); background: var(--panel); border-radius: 14px; padding: 16px; display: grid; gap: 12px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
  .id { display: flex; gap: 10px; align-items: center; }
  strong { font-size: 14px; } small { display: block; font-size: 11px; color: var(--muted); }
  .health { font-size: 11px; font-weight: 700; border: 1px solid var(--line); padding: 5px 9px; border-radius: 999px; white-space: nowrap; }
  .health[data-h="healthy"] { color: var(--good); border-color: color-mix(in srgb, var(--good) 40%, transparent); }
  .health[data-h="stale"] { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
  .health[data-h="auth_required"] { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, transparent); }
  .today { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .today div { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 9px 10px; }
  .today span { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
  .today strong { display: block; font-size: 13px; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .meta, .desc { font-size: 12px; color: var(--muted); margin: 0; }
  .caps-row { font-size: 12px; color: var(--muted); }
  footer { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .ghost { border: 1px solid var(--line); background: transparent; color: inherit; padding: 8px 12px; border-radius: 10px; cursor: pointer; font-size: 12px; }
  .primary { border: 0; background: var(--ink); color: var(--bg); padding: 8px 14px; border-radius: 10px; font-weight: 700; cursor: pointer; font-size: 12px; }
  .notconn { font-size: 12px; color: var(--muted); }
  .switch { display: flex; gap: 8px; align-items: center; font-size: 12px; font-weight: 600; cursor: pointer; }
</style>
