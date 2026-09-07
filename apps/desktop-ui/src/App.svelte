<script lang="ts">
  import EdgeRail from './lib/components/EdgeRail.svelte';
  import Heatmap from './lib/components/Heatmap.svelte';
  import RangePicker from './lib/components/RangePicker.svelte';
  import AddProviderWizard from './lib/components/AddProviderWizard.svelte';
  import ProviderCard from './lib/components/ProviderCard.svelte';
  import DetailModal from './lib/components/DetailModal.svelte';
  import Logo from './lib/components/Logo.svelte';
  import WelcomeEmpty from './lib/components/WelcomeEmpty.svelte';
  import TrendChart from './lib/components/TrendChart.svelte';
  import { fetchSnapshot, USE_LIVE } from './lib/api';
  import { PROVIDER_CATALOG, catalogById } from './lib/catalog';
  import { alertStore, billingLine, budgetStore, connectionStore, costDisplay, healthLabel, resolveStage } from './lib/lifecycle';
  import { rangeForPreset } from './lib/range';
  import type { AlertRule, Budget, DateRange, ProviderConnection, ProviderView } from './lib/types';

  let rawProviders = $state<ProviderView[]>([]);
  let models = $state<Array<{ surface: string; model_provider: string; billing_owner: string; model: string; tokens: number; cost: string }>>([]);
  let sampleData = $state(false);
  let dayUtc = $state<string | null>(null);
  let source = $state<'tauri' | 'browser' | 'demo' | 'error' | 'pending'>('pending');
  let lastError = $state<string | null>(null);
  let lastSuccessAt = $state<string | null>(null);
  let generatedAt = $state<string | null>(null);

  let page = $state('overview');
  let theme = $state<'dark' | 'light'>('dark');
  let wizardOpen = $state(false);
  let wizardPreselect = $state<string | null>(null);

  let connections = $state<ProviderConnection[]>(connectionStore.all());
  let budgets = $state<Budget[]>(budgetStore.all());
  let alerts = $state<AlertRule[]>(alertStore.all());

  let range = $state<DateRange>(rangeForPreset('week', Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'));
  let modelQuery = $state('');
  let modelProvider = $state('all');
  let heatMetric = $state('tokens');
  let newBudgetLabel = $state('');
  let newBudgetLimit = $state('');
  let privacyTelemetry = $state(false);
  let pollDefault = $state('automatic');

  function persistConnections() { connectionStore.save(connections); }
  function persistBudgets() { budgetStore.save(budgets); }
  function persistAlerts() { alertStore.save(alerts); }

  // Merge snapshot rows with local connections + full catalog (§2, §5, §6).
  // Catalog entries with no snapshot row become Available integrations.
  // Detection never creates a connection, enables collection, or feeds totals.
  const merged = $derived.by(() => {
    const byId = new Map(rawProviders.map((p) => [p.id, p]));
    return PROVIDER_CATALOG.map((def) => {
      const snap = byId.get(def.id);
      const conn = connections.find((c) => c.provider_id === def.id);
      const detected = !!(snap?.installed || snap?.configured);
      const recent = !!(snap?.live);
      const stage = resolveStage(conn, detected, recent);
      const base: ProviderView = snap ?? {
        id: def.id, name: def.name, vendor: def.vendor, monogram: def.monogram,
        accent: def.accent, icon: def.icon, primaryLabel: 'Usage', primaryPercent: null,
        primaryReset: null, freshness: 'unknown', source: 'not_configured', scope: 'account',
        enabled: false, pinned: false,
      };
      const enabled = conn ? conn.enabled : false;
      const pinned = conn ? conn.pinned : false;
      const collectorHealth = !conn ? undefined
        : !enabled ? 'unknown'
        : snap?.live ? 'healthy'
        : snap?.freshness === 'fresh' ? 'healthy'
        : snap?.freshness === 'stale' || snap?.freshness === 'delayed' || snap?.freshness === 'unknown' ? 'stale'
        : 'stale';
      return {
        ...base, name: conn?.display_name ?? def.name, displayName: def.name,
        vendor: def.vendor, monogram: def.monogram, accent: def.accent, icon: def.icon,
        enabled, pinned, stage, collectorHealth: collectorHealth as ProviderView['collectorHealth'],
        lastSeenAt: snap?.live ? (generatedAt ?? new Date().toISOString()) : null,
        connectionId: conn?.id ?? null,
      } satisfies ProviderView;
    });
  });

  const connected = $derived(merged.filter((p) => p.connectionId));
  const detectedOnly = $derived(merged.filter((p) => !p.connectionId && (p.installed || p.configured || p.stage === 'detected')));
  const available = $derived(merged.filter((p) => !p.connectionId && !(p.installed || p.configured)));
  const healthy = $derived(connected.filter((p) => p.enabled && p.collectorHealth === 'healthy'));
  const stale = $derived(connected.filter((p) => p.enabled && p.collectorHealth === 'stale'));
  const needsAttention = $derived(connected.filter((p) => p.enabled && p.collectorHealth !== 'healthy'));

  // Totals count ONLY connected + enabled providers with real numerics.
  // Stale/unconnected/unknown contribute nothing; unknown renders as — (§13).
  const totals = $derived.by(() => {
    let tokens = 0, tN = 0, cost = 0, cN = 0, req = 0;
    for (const p of connected) {
      if (!p.enabled) continue;
      if (p.collectorHealth === 'stale') continue;
      if (typeof p.tokens_today_value === 'number' && Number.isFinite(p.tokens_today_value)) { tokens += p.tokens_today_value; tN++; }
      if (typeof p.cost_today_value === 'number' && Number.isFinite(p.cost_today_value)) { cost += p.cost_today_value; cN++; }
    }
    void req;
    return { tokens, tN, cost, cN };
  });

  const filteredModels = $derived(
    models
      .filter((m) => (modelProvider === 'all' ? true : m.billing_owner === modelProvider))
      .filter((m) => (m.model + ' ' + m.surface).toLowerCase().includes(modelQuery.toLowerCase())),
  );

  const trendPoints = $derived(
    filteredModels.length ? filteredModels.slice(0, 24).map((m) => m.tokens) : [],
  );

  async function refresh() {
    const snap = await fetchSnapshot();
    if (snap.source === 'error') { lastError = snap.error ?? 'refresh failed'; return; }
    rawProviders = snap.providers;
    models = snap.models ?? [];
    sampleData = snap.sampleData;
    dayUtc = snap.dayUtc;
    source = snap.source;
    lastError = null;
    lastSuccessAt = new Date().toISOString();
    generatedAt = new Date().toISOString();
  }

  refresh();
  setInterval(refresh, 15000);

  function goto(p: string) { page = p; detailId = null; }
  function openWizard(preselect?: string) { wizardPreselect = preselect ?? null; wizardOpen = true; }

  function handleConnect(c: ProviderConnection) {
    connections = [...connections.filter((x) => x.provider_id !== c.provider_id), c];
    persistConnections();
    goto('providers');
  }
  function toggleConnection(id: string, enabled: boolean) {
    connections = connections.map((c) => (c.id === id ? { ...c, enabled } : c));
    persistConnections();
  }
  function removeConnection(id: string) {
    const c = connections.find((x) => x.id === id);
    if (!c) return;
    if (!confirm(`Remove ${c.display_name}? This stops collection and deletes the credential alias. History is preserved unless you clear it in Settings.`)) return;
    connections = connections.filter((x) => x.id !== id);
    persistConnections();
  }
  function viewDetails(providerId: string) {
    modelProvider = providerId;
    modelQuery = '';
    goto('models');
  }

  let detailId = $state<string | null>(null);
  function openDetail(providerId: string) { detailId = providerId; }
  function closeDetail() { detailId = null; }
  const detailProvider = $derived(merged.find((p) => p.id === detailId) ?? null);
  const detailConnection = $derived(connections.find((c) => c.id === detailProvider?.connectionId));

  const groupedModels = $derived.by(() => {
    const groups = new Map<string, typeof filteredModels>();
    for (const m of filteredModels) {
      const key = m.billing_owner || m.surface || 'unknown';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return [...groups.entries()];
  });
  function groupDisplay(key: string): string {
    const p = merged.find((x) => x.id === key || x.displayName === key);
    return p ? (p.connectionId ? p.name : p.displayName) : key;
  }

  function addBudget() {
    const limit = Number(newBudgetLimit);
    if (!newBudgetLabel.trim() || !Number.isFinite(limit) || limit <= 0) return;
    budgets = [...budgets, { id: crypto.randomUUID(), label: newBudgetLabel.trim(), limit, currency: 'USD', period: 'monthly', scope: 'all' }];
    newBudgetLabel = ''; newBudgetLimit = '';
    persistBudgets();
  }

  let updateStatus = $state('Updates are signed and verified before install. The release feed is configured at build time.');
  let checkingUpdate = $state(false);
  async function checkUpdates() {
    checkingUpdate = true;
    updateStatus = 'Checking…';
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const r = (await invoke('check_for_updates')) as { available: boolean; version?: string };
      updateStatus = r.available ? `Version ${r.version} is available.` : 'You are on the latest version.';
    } catch (e) {
      updateStatus = `Could not reach the update feed (${String(e).slice(0, 120)}).`;
    } finally { checkingUpdate = false; }
  }

  const detectedForWelcome = $derived(detectedOnly.map((p) => ({ id: p.id, name: p.name })));
  const providerOptions = $derived(['all', ...Array.from(new Set(models.map((m) => m.billing_owner)))]);
</script>

<svelte:head>
  <title>UsageHaloo — Monitor AI usage. Stay in control.</title>
</svelte:head>

<div class="backdrop" data-theme={theme}></div>
<EdgeRail providers={merged} onMore={() => goto('providers')} />

<div class="shell" data-theme={theme}>
  <aside class="sidebar">
    <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>UsageHaloo</span>
      {#if sampleData}<span class="pill sample">Sample</span>
      {:else if healthy.length > 0}<span class="pill live">Live</span>
      {:else}<span class="pill idle">No data</span>{/if}
    </div>
    <nav class="side-nav" aria-label="Primary">
      {#each ['overview', 'providers', 'models', 'activity', 'budgets', 'alerts', 'settings'] as p}
        <button class:active={page === p} onclick={() => goto(p)} aria-current={page === p ? 'page' : undefined}>{p[0].toUpperCase() + p.slice(1)}</button>
      {/each}
    </nav>
    <div class="sys-live">
      <span class="dot" class:on={healthy.length > 0}></span>
      <div><strong>{connected.length === 0 ? 'Nothing connected' : `${healthy.length}/${connected.length} healthy`}</strong>
      <small>{connected.length} connected · {source}</small></div>
    </div>
    <div class="tray-row">
      <button onclick={() => theme = theme === 'dark' ? 'light' : 'dark'}>Theme: {theme}</button>
      <button onclick={() => openWizard()}>+ Connect</button>
    </div>
  </aside>

  <main class="dashboard">
    <header class="topbar">
      <div>
        <h1>{page[0].toUpperCase() + page.slice(1)}</h1>
        <p>Billing owner ≠ model vendor. Provider cost and estimated cost stay separate. Unknown is never zero.</p>
      </div>
      {#if page === 'overview' || page === 'activity' || page === 'models'}
        <RangePicker {range} onChange={(r) => range = r} />
      {/if}
    </header>

    {#if lastError && rawProviders.length === 0 && !sampleData}
      <div class="banner error" role="alert">UsageHaloo data service is unavailable — {lastError}. No sample values substituted. <button onclick={refresh}>Retry</button></div>
    {:else if lastError && rawProviders.length > 0}
      <div class="banner stale" role="status">Unable to refresh — showing last successful data. {lastError} <button onclick={refresh}>Retry</button></div>
    {/if}
    {#if sampleData}
      <div class="banner sample">Sample data · source: {source} — connect a provider for live numbers.</div>
    {/if}

    {#if page === 'overview'}
      {#if connected.length === 0}
        <WelcomeEmpty detected={detectedForWelcome} onConnect={() => openWizard()} />
      {:else}
        <section class="statusline" aria-label="Connection status">
          <span class="chip"><strong>{connected.length}</strong> connected</span>
          <span class="chip ok"><strong>{healthy.length}</strong> healthy</span>
          {#if stale.length}<span class="chip warn"><strong>{stale.length}</strong> stale</span>{/if}
          <span class="spacer"></span>
          <span class="refreshed">Last refreshed {lastSuccessAt ? new Date(lastSuccessAt).toLocaleTimeString() : 'never'} · {USE_LIVE ? 'live' : 'demo'}</span>
        </section>

        {#if needsAttention.length}
          <section class="attention" aria-label="Needs attention">
            <h2>Needs attention</h2>
            {#each needsAttention.slice(0, 3) as p}
              <div class="attn-row">
                <span>{p.name} — {healthLabel(p.collectorHealth)} · last seen {p.lastSeenAt ? 'recently' : 'never'}</span>
                <button class="ghost" onclick={() => goto('providers')}>Fix</button>
              </div>
            {/each}
          </section>
        {/if}

        <section class="usage" aria-label="Usage">
          <div class="usage-head"><h2>Usage — {range.preset === 'today' ? 'Today' : range.preset === 'week' ? 'This week' : range.preset === 'last7' ? 'Last 7 days' : range.preset === 'last30' ? 'Last 30 days' : range.preset === 'month' ? 'This month' : range.preset}</h2>
          <span class="hist-note">Historical range · quotas below stay current</span></div>
          <div class="stat-grid">
            <div class="stat"><span>Tokens</span><strong>{totals.tN ? (totals.tokens >= 1e6 ? `${(totals.tokens / 1e6).toFixed(2)}M` : `${Math.round(totals.tokens / 1000)}K`) : '—'}</strong><small>{totals.tN ? `sum of ${totals.tN} observed counts` : 'No observations yet'}</small></div>
            <div class="stat"><span>Requests</span><strong>—</strong><small>device-observed only</small></div>
            <div class="stat"><span>Provider cost</span><strong>{totals.cN ? `$${totals.cost.toFixed(2)}` : 'Cost unavailable'}</strong><small>{totals.cN ? `sum of ${totals.cN} provider-reported costs` : 'No provider-reported costs yet'}</small></div>
          </div>
          <TrendChart points={trendPoints} label="Usage trend" />
        </section>

        <section class="two-col">
          <div class="panel">
            <h2>Providers</h2>
            {#each connected.slice(0, 5) as p}
              <div class="prov-row"><Logo monogram={p.monogram} accent={p.accent} icon={p.icon} label={`${p.name} logo`} />
                <span class="prov-name">{p.name}<small>{p.tokensToday ?? 'No usage yet'} · {healthLabel(p.collectorHealth)}</small></span>
                <span class="prov-pct">{p.primaryPercent != null ? `${p.primaryPercent}%` : '—'}</span>
              </div>
            {/each}
            <button class="ghost" onclick={() => goto('providers')}>Manage providers</button>
          </div>
          <div class="panel">
            <h2>Models</h2>
            {#if filteredModels.length}
              {#each filteredModels.slice(0, 6) as m}<p class="model-line"><strong>{m.model}</strong><small>{billingLine(m)} · {m.tokens.toLocaleString()} tokens</small></p>{/each}
            {:else}
              <p class="muted">No observed model activity yet. Post opt-in telemetry to /api/ingest/event.</p>
            {/if}
            <button class="ghost" onclick={() => goto('models')}>View all models</button>
          </div>
        </section>
      {/if}

    {:else if page === 'providers'}
      <div class="page-head"><p>Connected providers collect. Detected entries are suggestions only. Available integrations are supported but not configured.</p><button class="primary" onclick={() => openWizard()}>+ Connect provider</button></div>
      <h2 class="section-title">Connected ({connected.length})</h2>
      {#if connected.length}
        <section class="cards">
          {#each connected as p}
            <ProviderCard provider={p} connection={connections.find((c) => c.id === p.connectionId)} onToggle={toggleConnection} onRemove={removeConnection} onDetails={openDetail} onConnect={(id) => openWizard(id)} />
          {/each}
        </section>
      {:else}
        <p class="muted">No providers connected yet. Connect the AI services you use to begin tracking.</p>
      {/if}
      <h2 class="section-title">Detected locally ({detectedOnly.length})</h2>
      {#if detectedOnly.length}
        <section class="cards">
          {#each detectedOnly as p}
            <ProviderCard provider={p} connection={undefined} onToggle={toggleConnection} onRemove={removeConnection} onDetails={openDetail} onConnect={(id) => openWizard(id)} />
          {/each}
        </section>
      {:else}<p class="muted">No local installations detected. Detection never enables collection.</p>{/if}
      <h2 class="section-title">Available integrations ({available.length})</h2>
      <section class="cards">
        {#each available as p}
          <ProviderCard provider={p} connection={undefined} onToggle={toggleConnection} onRemove={removeConnection} onDetails={openDetail} onConnect={(id) => openWizard(id)} />
        {/each}
      </section>

    {:else if page === 'models'}
      <div class="filters">
        <input placeholder="Filter models…" bind:value={modelQuery} aria-label="Filter models" />
        <select bind:value={modelProvider} aria-label="Filter by billing owner">
          {#each providerOptions as o}<option value={o}>{o === 'all' ? 'All billing owners' : o}</option>{/each}
        </select>
        {#if modelProvider !== 'all'}<button class="pill-filter" onclick={() => (modelProvider = 'all')}>Showing {groupDisplay(modelProvider)} only ×</button>{/if}
      </div>
      <div class="panel">
        <h2>Model activity — real observations only</h2>
        {#if groupedModels.length}
          {#each groupedModels as [owner, list]}
            {@const total = list.reduce((s, m) => s + m.tokens, 0)}
            <h3 class="model-group">{groupDisplay(owner)} · {list.length} model{list.length === 1 ? '' : 's'} · {total.toLocaleString()} tokens</h3>
            {#each list as m}<p class="model-line"><strong>{m.model}</strong><small>{billingLine(m)} · {m.tokens.toLocaleString()} tokens · {m.cost}</small></p>{/each}
          {/each}
        {:else}
          <p class="muted">No observed model activity for this filter. Billing owner ≠ model vendor is preserved.</p>
        {/if}
      </div>

    {:else if page === 'activity'}
      <div class="panel">
        <h2>Activity — {range.preset}</h2>
        <p class="muted">Time series first. Current quota windows and connector health stay current regardless of the historical range.</p>
        <TrendChart points={trendPoints} label="Activity trend" />
        <div class="heatmap-head"><span>Daily breakdown · {heatMetric}</span>
          <select bind:value={heatMetric}><option value="tokens">Tokens</option><option value="cost">Cost</option><option value="requests">Requests</option></select>
        </div>
        <Heatmap metric={heatMetric} sample={sampleData} buckets={null} />
      </div>

    {:else if page === 'budgets'}
      <div class="panel">
        <h2>No provider quotas here</h2>
        <p class="muted">Set optional spending limits without changing your provider's actual quota. Budgets are user-created; provider quotas live on Providers.</p>
        {#if budgets.length === 0}<p class="muted">No budgets yet.</p>{/if}
        {#each budgets as b}<div class="row-line"><span>{b.label} · {b.currency} {b.limit} · {b.period}</span><button class="ghost" onclick={() => { budgets = budgets.filter((x) => x.id !== b.id); persistBudgets(); }}>Remove</button></div>{/each}
        <div class="form-row">
          <input placeholder="Budget label" bind:value={newBudgetLabel} aria-label="Budget label" />
          <input placeholder="Limit (USD)" bind:value={newBudgetLimit} inputmode="decimal" aria-label="Budget limit" />
          <button class="primary" onclick={addBudget}>Create budget</button>
        </div>
      </div>

    {:else if page === 'alerts'}
      <div class="panel">
        <div class="alert-head"><h2>Alert rules</h2><button class="primary" onclick={() => { alerts = [...alerts, { id: crypto.randomUUID(), label: 'New alert rule', kind: 'quota', threshold: 80, target: 'openrouter', enabled: true }]; persistAlerts(); }}>+ Create alert</button></div>
        {#each alerts as a}
          <div class="row-line">
            <label class="check"><input type="checkbox" checked={a.enabled} onchange={() => { a.enabled = !a.enabled; persistAlerts(); }} /> <span>{a.label}</span></label>
            <button class="ghost" onclick={() => { alerts = alerts.filter((x) => x.id !== a.id); persistAlerts(); }}>Delete</button>
          </div>
        {/each}
        <p class="muted">Alerts trigger with cooldown and dedupe. Native notifications when enabled.</p>
      </div>

    {:else}
      <div class="panel">
        <h2>Appearance, privacy, runtime</h2>
        <div class="row-line"><span>Theme</span><button class="ghost" onclick={() => theme = theme === 'dark' ? 'light' : 'dark'}>{theme === 'dark' ? 'Switch to light' : 'Switch to dark'}</button></div>
        <div class="row-line"><span>Opt-in instrumentation only</span><label class="check"><input type="checkbox" bind:checked={privacyTelemetry} /> {privacyTelemetry ? 'On' : 'Off'}</label></div>
        <div class="row-line"><span>Default poll interval</span>
          <select bind:value={pollDefault}><option value="automatic">Automatic</option><option value="5m">5 min</option><option value="15m">15 min</option><option value="1h">Hourly</option></select>
        </div>
        <div class="row-line"><span>Credentials</span><small class="muted">Keychain-backed aliases. Removal deletes the alias.</small></div>
        <p class="muted">Provider management lives on the Providers page. <button class="link" onclick={() => goto('providers')}>Manage providers</button></p>
      </div>
      <div class="panel">
        <h2>Application updates</h2>
        <p class="muted">{updateStatus}</p>
        <button class="ghost" onclick={checkUpdates} disabled={checkingUpdate}>{checkingUpdate ? 'Checking…' : 'Check for updates'}</button>
      </div>
    {/if}
  </main>
</div>

<AddProviderWizard open={wizardOpen} onClose={() => wizardOpen = false} onConnect={handleConnect} />

{#if detailProvider}
  <DetailModal
    provider={detailProvider}
    connection={detailConnection}
    models={models}
    onClose={closeDetail}
    onToggle={toggleConnection}
    onRemove={removeConnection}
    onConnect={(id) => openWizard(id)}
    onViewModels={viewDetails}
  />
{/if}

<nav class="mobile-nav" aria-label="Mobile">
  {#each ['overview', 'providers', 'models', 'activity', 'settings'] as p}
    <button class:active={page === p} onclick={() => goto(p)}>{p[0].toUpperCase() + p.slice(1)}</button>
  {/each}
</nav>

<style>
  .page-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .page-head p { margin: 0; }
  .statusline { display: flex; gap: 8px; align-items: center; margin: 16px 0 12px; flex-wrap: wrap; }
  .chip { border: 1px solid var(--line); border-radius: 999px; padding: 6px 12px; font-size: 12px; color: var(--muted); }
  .chip strong { color: var(--ink); }
  .chip.ok strong { color: var(--good); } .chip.warn strong { color: var(--warn); }
  .spacer { flex: 1; } .refreshed { font-size: 12px; color: var(--muted); }
  .attention { border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); border-radius: 14px; padding: 14px 16px; margin-bottom: 12px; }
  .attention h2, .usage h2, .panel h2, .section-title { font-size: 15px; margin: 0 0 8px; letter-spacing: -0.01em; }
  .attn-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 13px; padding: 6px 0; }
  .usage { border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin-bottom: 12px; background: var(--panel); }
  .usage-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .hist-note { font-size: 11px; color: var(--muted); }
  .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 12px 0; }
  .stat { border: 1px solid var(--line); background: var(--surface); border-radius: 12px; padding: 12px; }
  .stat span { font-size: 11px; color: var(--muted); } .stat strong { display: block; font-size: 24px; margin: 4px 0; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .stat small { font-size: 11px; color: var(--muted); }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .prov-row { display: flex; gap: 10px; align-items: center; padding: 9px 0; border-bottom: 1px solid var(--line); }
  .prov-name { flex: 1; font-size: 13px; } .prov-name small { display: block; font-size: 11px; color: var(--muted); }
  .prov-pct { font-variant-numeric: tabular-nums; font-size: 13px; font-weight: 700; }
  .model-line { font-size: 13px; padding: 8px 0; border-bottom: 1px solid var(--line); margin: 0; }
  .model-line small { display: block; color: var(--muted); font-size: 11px; }
  .model-group { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; margin: 14px 0 2px; }
  .pill-filter { border: 1px solid var(--focus); background: transparent; color: inherit; border-radius: 999px; padding: 7px 12px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  /* Last rows never double the panel edge line */
  .prov-row:last-child, .model-line:last-child, .row-line:last-child { border-bottom-color: transparent; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; margin-bottom: 18px; }
  .filters { display: flex; gap: 8px; margin-bottom: 12px; }
  .filters input, .form-row input { flex: 1; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: inherit; }
  .heatmap-head { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; font-size: 12px; color: var(--muted); }
  .row-line { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
  .form-row { display: flex; gap: 8px; margin-top: 12px; }
  .alert-head { display: flex; justify-content: space-between; align-items: center; }
  .check { display: flex; gap: 8px; align-items: center; }
  .ghost { border: 1px solid var(--line); background: transparent; color: inherit; padding: 8px 12px; border-radius: 10px; cursor: pointer; font-size: 12px; }
  .primary { border: 0; background: var(--ink); color: var(--bg); padding: 9px 15px; border-radius: 10px; font-weight: 700; cursor: pointer; font-size: 12px; }
  .link { background: none; border: 0; color: var(--ink); text-decoration: underline; cursor: pointer; padding: 0; }
  .banner { margin: 14px 0 0; padding: 9px 12px; border-radius: 10px; font-size: 12px; border: 1px solid var(--line); }
  .banner.error { border-color: color-mix(in srgb, var(--bad) 45%, transparent); }
  .banner.stale, .banner.sample { border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
  @media (max-width: 900px) { .two-col { grid-template-columns: 1fr; } .stat-grid { grid-template-columns: 1fr; } }
</style>
