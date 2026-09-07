<script lang="ts">
  import Logo from './Logo.svelte';
  import { billingLine, costDisplay, healthLabel, planDisplay } from '../lifecycle';
  import type { ProviderConnection, ProviderView } from '../types';

  // Centered, viewport-relative detail dialog (rendered at app root, never
  // inside a filtered/blurred panel). Same sections as the showcase detail:
  // quota windows, today, per-provider models, provenance, actions.
  type ModelRow = {
    surface: string; model_provider: string; billing_owner: string; model: string; tokens: number; cost: string;
  };
  let {
    provider, connection = undefined, models = [], onClose, onToggle, onRemove, onConnect, onViewModels,
  } = $props<{
    provider: ProviderView;
    connection?: ProviderConnection;
    models: ModelRow[];
    onClose: () => void;
    onToggle: (id: string, enabled: boolean) => void;
    onRemove: (id: string) => void;
    onConnect: (providerId: string) => void;
    onViewModels: (providerId: string) => void;
  }>();

  const connected = $derived(!!connection);
  const ownModels = $derived(models.filter((m: ModelRow) => m.surface === provider.displayName || m.billing_owner === provider.id));
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onClose(); }} />

<div class="overlay" role="presentation" onclick={onClose}>
  <div class="modal" role="dialog" aria-modal="true" aria-label={`${provider.name} details`} tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}>
    <header>
      <div class="id">
        <Logo monogram={provider.monogram} accent={provider.accent} icon={provider.icon} label={`${provider.name} logo`} />
        <div><strong>{connection?.display_name ?? provider.name}</strong><small>{provider.vendor ?? ''} · {provider.scope}</small></div>
        <span class="health" data-h={provider.collectorHealth ?? 'unknown'}>{connected ? healthLabel(provider.collectorHealth) : provider.stage === 'detected' ? 'Detected locally' : 'Not connected'}</span>
      </div>
      <button class="close" onclick={onClose} aria-label="Close">×</button>
    </header>

    <div class="grid">
      <section>
        <h3>Quota windows</h3>
        {#if provider.primaryPercent != null}
          <div class="kv"><span>{provider.primaryLabel}<small>{provider.primaryReset ? `Resets ${provider.primaryReset}` : 'No reset reported'}</small></span><strong>{provider.primaryPercent}%</strong></div>
        {/if}
        {#if provider.secondaryPercent != null}
          <div class="kv"><span>{provider.secondaryLabel ?? 'Secondary'}<small>{provider.secondaryReset ?? ''}</small></span><strong>{provider.secondaryPercent}%</strong></div>
        {/if}
        {#if provider.primaryPercent == null && provider.secondaryPercent == null}
          <p class="muted">No quota window observed for this provider.</p>
        {/if}
      </section>
      <section>
        <h3>Today</h3>
        <div class="kv"><span>Tokens</span><strong>{provider.tokensToday ?? 'No observations yet'}</strong></div>
        <div class="kv"><span>Cost</span><strong>{costDisplay(provider.costToday, provider.cost_today_value)}</strong></div>
        <div class="kv"><span>Last seen</span><strong>{provider.lastSeenAt ? new Date(provider.lastSeenAt).toLocaleString() : 'never observed'}</strong></div>
      </section>
      <section>
        <h3>Models ({ownModels.length})</h3>
        {#if ownModels.length}
          {#each ownModels as m}<div class="kv"><span><strong>{m.model}</strong><small>billed to {m.billing_owner}{m.model_provider && m.model_provider !== m.billing_owner ? ` · model by ${m.model_provider}` : ''}</small></span><span>{m.tokens.toLocaleString()} · {m.cost}</span></div>{/each}
        {:else}
          <p class="muted">No model observations for this provider yet.</p>
        {/if}
      </section>
      <section>
        <h3>Provenance</h3>
        <div class="kv"><span>Source</span><span>{provider.source}</span></div>
        <div class="kv"><span>Freshness</span><span>{provider.freshness}</span></div>
        {#if connection}
          <div class="kv"><span>Plan</span><span>{planDisplay(connection.plan, connection.plan_source)}</span></div>
          <div class="kv"><span>Method</span><span>{connection.connection_method}</span></div>
        {/if}
        <p class="muted">Prompts and responses are never collected.</p>
      </section>
    </div>

    <footer>
      {#if !connected}
        <button class="primary" onclick={() => { onConnect(provider.id); onClose(); }}>Connect</button>
      {:else}
        <button class="ghost" onclick={() => onToggle(connection!.id, !connection!.enabled)}>{connection!.enabled ? 'Disable collection' : 'Enable collection'}</button>
        <button class="ghost danger" onclick={() => { onRemove(connection!.id); onClose(); }}>Remove</button>
      {/if}
      <button class="ghost" onclick={() => { onViewModels(provider.id); onClose(); }}>View in Models</button>
    </footer>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 100; background: rgba(4,6,8,.62); display: flex; align-items: center; justify-content: center; padding: 20px; }
  .modal { width: min(720px, 100%); max-height: min(88vh, 860px); overflow: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 20px; margin: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .id { display: flex; gap: 10px; align-items: center; }
  strong { font-size: 15px; } small { display: block; font-size: 11px; color: var(--muted); font-weight: 400; }
  .health { font-size: 11px; font-weight: 700; border: 1px solid var(--line); padding: 5px 9px; border-radius: 999px; white-space: nowrap; }
  .health[data-h="healthy"] { color: var(--good); border-color: color-mix(in srgb, var(--good) 40%, transparent); }
  .health[data-h="stale"] { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
  .close { border: 1px solid var(--line); background: transparent; color: inherit; width: 32px; height: 32px; border-radius: 10px; font-size: 18px; cursor: pointer; flex: none; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; margin-top: 8px; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin: 14px 0 4px; }
  .kv { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
  .kv:last-child { border-bottom-color: transparent; }
  footer { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
  .ghost { border: 1px solid var(--line); background: transparent; color: inherit; padding: 8px 12px; border-radius: 10px; cursor: pointer; font-size: 12px; }
  .ghost.danger { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, transparent); }
  .primary { border: 0; background: var(--ink); color: var(--bg); padding: 8px 14px; border-radius: 10px; font-weight: 700; cursor: pointer; font-size: 12px; }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
</style>
