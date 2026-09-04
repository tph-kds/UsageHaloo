<script lang="ts">
  import EdgeRail from './lib/components/EdgeRail.svelte';
  import Heatmap from './lib/components/Heatmap.svelte';
  import { fetchSnapshot, USE_LIVE } from './lib/api';
  import type { ProviderView, SummaryMetric } from './lib/types';

  let providers = $state<ProviderView[]>([]);
  let summaries = $state<SummaryMetric[]>([]);
  let models = $state<Array<{ surface: string; model_provider: string; billing_owner: string; model: string; tokens: number; cost: string }>>([]);
  let sampleData = $state(false);
  let dayUtc = $state<string | null>(null);
  let source = $state<'tauri' | 'browser' | 'mock' | 'pending'>('pending');
  let heatMetric = $state('tokens');
  let page = $state('overview');
  let theme = $state<'dark' | 'light'>('dark');
  let settingsOpen = $state(false);

  const liveCount = $derived(providers.filter((p) => p.live).length);
  const liveTop = $derived([...providers].filter((p) => p.live && p.primaryPercent != null).sort((a, b) => (b.primaryPercent ?? -1) - (a.primaryPercent ?? -1))[0]);
  const topProvider = $derived([...providers].sort((a, b) => (b.primaryPercent ?? -1) - (a.primaryPercent ?? -1))[0]);
  const hotAlerts = $derived(providers.filter((p) => p.primaryPercent != null && p.primaryPercent >= 80));

  async function refresh() {
    const snap = await fetchSnapshot();
    providers = snap.providers;
    summaries = snap.summaries;
    models = snap.models ?? [];
    sampleData = snap.sampleData;
    dayUtc = snap.dayUtc;
    source = snap.source;
  }

  refresh();
  setInterval(refresh, 15000);

  function goto(p: string) { page = p; settingsOpen = false; }

  let updateStatus = $state('Updates are signed and verified before install. The release feed is configured at build time.');
  let checkingUpdate = $state(false);

  async function checkUpdates() {
    checkingUpdate = true;
    updateStatus = 'Checking…';
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const r = (await invoke('check_for_updates')) as { available: boolean; version?: string };
      updateStatus = r.available
        ? `Version ${r.version} is available. Download it from the release feed to update.`
        : 'You are on the latest version.';
    } catch (e) {
      updateStatus = `Could not reach the update feed (${String(e).slice(0, 120)}). The feed URL is set at build time.`;
    } finally {
      checkingUpdate = false;
    }
  }
</script>

<svelte:head>
  <title>UsageHalo — Monitor AI usage. Stay in control.</title>
</svelte:head>

<div class="backdrop" data-theme={theme}></div>
<EdgeRail {providers} onMore={() => goto('providers')} />

<div class="shell" data-theme={theme}>
  <aside class="sidebar glass">
    <div class="brand"><span class="brand-mark"></span><span>UsageHalo</span><span class="live-pill"><i></i>Live</span></div>
    <nav class="side-nav">
      {#each ['overview', 'providers', 'models', 'activity', 'budgets', 'alerts', 'settings'] as p}
        <button class:active={page === p} onclick={() => goto(p)}>{p[0].toUpperCase() + p.slice(1)}</button>
      {/each}
    </nav>
    <div class="sys-live"><i class="dot live"></i><div><strong>{liveCount > 0 ? `${liveCount} live` : sampleData ? 'Sample data' : 'No live data yet'}</strong><small>{providers.length} providers · {source}</small></div></div>
    <div class="tray-row">
      <button onclick={() => theme = theme === 'dark' ? 'light' : 'dark'}>Theme: {theme}</button>
      <button onclick={() => settingsOpen = !settingsOpen}>Rail</button>
    </div>
  </aside>

  <main class="dashboard glass">
    <header class="topbar">
      <div>
        <div class="eyebrow">LOCAL-FIRST AI OBSERVABILITY · {USE_LIVE ? 'LIVE' : 'MOCK'}</div>
        <h1>{page[0].toUpperCase() + page.slice(1)}</h1>
        <p>Quotas, tokens, costs, model activity and freshness — one ambient view. Billing owner ≠ model vendor; provider cost and estimated cost stay separate.</p>
      </div>
      <nav>
        <button class:active={page === 'overview'} onclick={() => goto('overview')}>Overview</button>
        <button class:active={page === 'activity'} onclick={() => goto('activity')}>Activity</button>
        <button class:active={page === 'models'} onclick={() => goto('models')}>Models</button>
        <button onclick={() => goto('providers')}>Providers</button>
      </nav>
    </header>

    {#if sampleData}
      <div class="sample-banner">Sample data · as of {dayUtc ?? 'today'} · source: {source} — connect a provider for live numbers. Every metric shows its provenance.</div>
    {:else if liveCount > 0}
      <div class="live-banner">{liveCount} live provider{liveCount === 1 ? '' : 's'} · as of {dayUtc ?? 'today'} · source: {source}</div>
    {/if}

    {#if page === 'overview'}
      <section class="summary-grid">
        {#each summaries as item}<article><span>{item.label}</span><strong>{item.value}</strong><small>{item.meta}</small></article>{/each}
      </section>
      <section class="grid">
        <article class="panel wide">
          <header><div><div class="eyebrow">ACTIVITY</div><h2>Activity Heatmap — {heatMetric}</h2></div><select bind:value={heatMetric}><option value="tokens">Tokens</option><option value="cost">Cost</option><option value="requests">Requests</option></select></header>
          <Heatmap metric={heatMetric} live={liveCount > 0} sample={sampleData} />
          <p class="muted">One measure at a time. Never encode multiple measures simultaneously.</p>
        </article>
        <article class="panel risk">
          <div class="eyebrow">NEXT LIMIT</div>
          <h2>{liveTop ? `${liveTop.name} ${liveTop.primaryLabel}` : 'No observed usage'}</h2>
          <strong class="risk-value">{liveTop && liveTop.primaryPercent != null && liveTop.primaryPercent > 90 ? '~now' : liveTop && liveTop.primaryPercent != null && liveTop.primaryPercent > 70 ? `~${Math.max(1, Math.round((100 - liveTop.primaryPercent) * 1.2))} min*` : '—'}</strong>
          <p>{liveTop ? '*Rough pace estimate from the live quota — not a provider forecast.' : 'Connect a provider to project the next limit.'}</p>
          <div class="bar"><span style={`width:${liveTop?.primaryPercent ?? 0}%;background:${liveTop?.accent ?? '#fff'}`}></span></div>
          <footer>{liveTop?.primaryPercent ?? '—'}% used · {liveTop?.primaryReset ? `Resets ${liveTop.primaryReset}` : 'No reset'} · {liveTop ? 'Live' : 'No live data'}</footer>
        </article>
        <article class="panel wide">
          <div class="eyebrow">PROVIDERS</div><h2>Usage by Provider</h2>
          {#each providers.slice(0, 6) as p}
            <div class="pbar-row"><span>{p.name}</span><div class="bar"><span style={`width:${p.primaryPercent ?? 0}%;background:${p.accent}`}></span></div><span>{p.primaryPercent ?? '—'}%</span></div>
          {/each}
        </article>
        <article class="panel">
          <div class="eyebrow">HEALTH</div><h2>Connector health</h2>
          {#each providers.slice(0, 6) as p}<div class="health"><div><strong>{p.name}</strong><small>{p.source} · {p.freshness}</small></div><span>● {p.live ? 'live' : (p.health ?? p.freshness)}</span></div>{/each}
        </article>
      </section>
    {:else if page === 'providers'}
      <section class="grid">
        {#each providers as p}
          <article class="panel"><div class="eyebrow">{p.vendor ?? p.scope}</div><h2>{p.name}</h2>
          <div class="bar"><span style={`width:${p.primaryPercent ?? 0}%;background:${p.accent}`}></span></div>
          <p><strong>{p.primaryPercent ?? '—'}%</strong> {p.primaryLabel} · {p.primaryReset ? `Resets ${p.primaryReset}` : 'No reset'}</p>
          <p class="muted">{p.source} · {p.scope} · {p.freshness}{p.live ? ' · Live' : ' · Sample'}</p></article>
        {/each}
      </section>
    {:else if page === 'models'}
      <article class="panel wide"><div class="eyebrow">MODELS</div><h2>Today's model activity</h2>
        {#if models.length}
          {#each models as m}<p><strong>{m.model}</strong> · {m.surface} · billing owner {m.billing_owner} · {m.tokens} tokens · {m.cost}</p>{/each}
        {:else}
          <p class="muted">No observed model activity yet. {sampleData ? 'Sample mode — connect a provider or post opt-in telemetry to /api/ingest/event.' : 'Post opt-in telemetry to /api/ingest/event to see rows here.'} Billing owner ≠ model vendor is preserved.</p>
        {/if}
      </article>
    {:else if page === 'activity'}
      <article class="panel wide">
        <header><div><div class="eyebrow">ACTIVITY</div><h2>Daily AI activity</h2></div><select bind:value={heatMetric}><option value="tokens">Tokens</option><option value="cost">Cost</option><option value="requests">Requests</option></select></header>
        <Heatmap metric={heatMetric} live={liveCount > 0} sample={sampleData} />
      </article>
    {:else if page === 'budgets'}
      <article class="panel wide"><div class="eyebrow">BUDGETS</div><h2>No budgets configured</h2><p>User-defined budgets stay separate from provider quotas. Add a monthly budget to track spend here — no hardcoded demo budget is shown in live mode.</p></article>
    {:else if page === 'alerts'}
      <article class="panel wide"><div class="eyebrow">ALERTS</div><h2>Recent Alerts</h2>
        {#if hotAlerts.length}
          {#each hotAlerts as p}<p>{p.name} usage at {p.primaryPercent}% · {p.freshness}{p.live ? ' · Live' : ''}</p>{/each}
        {:else}
          <p class="muted">No alerts firing. Alerts trigger at 80%+ observed quota with cooldown and dedupe. Native notifications when enabled.</p>
        {/if}
      </article>
    {:else}
      <article class="panel wide"><div class="eyebrow">SETTINGS</div><h2>Providers, Appearance, Placement, Privacy</h2><p>Mirror of the web Settings page: per-provider primary metric, Glass/Solid/Minimal/Monochrome, Light/Dark/System, Left/Right/Top/Bottom edge, keychain-backed credentials, opt-in instrumentation only.</p></article>
      <article class="panel wide">
        <div class="eyebrow">UPDATES</div><h2>Application updates</h2>
        <p>{updateStatus}</p>
        <button onclick={checkUpdates} disabled={checkingUpdate}>{checkingUpdate ? 'Checking…' : 'Check for updates'}</button>
      </article>
    {/if}
  </main>
</div>

<style>
  .sample-banner { margin: 16px 0 0; padding: 8px 12px; border-radius: 10px; background: rgba(255, 196, 84, 0.10); border: 1px solid rgba(255, 196, 84, 0.30); color: #ffd28a; font-size: 12px; display: inline-block; }
  .live-banner { margin: 16px 0 0; padding: 8px 12px; border-radius: 10px; background: rgba(72, 213, 151, 0.10); border: 1px solid rgba(72, 213, 151, 0.30); color: #b6f5d4; font-size: 12px; display: inline-block; }
  .pbar-row { display: grid; grid-template-columns: 130px 1fr 48px; gap: 10px; align-items: center; font-size: 12px; padding: 6px 0; }
</style>
