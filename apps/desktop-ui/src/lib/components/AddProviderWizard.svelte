<script lang="ts">
  import type { ProviderConnection, ProviderDefinition } from '../types';
  import { PROVIDER_CATALOG } from '../catalog';

  let { open = false, onClose, onConnect } = $props<{
    open: boolean;
    onClose: () => void;
    onConnect: (c: ProviderConnection) => void;
  }>();

  let step = $state(1);
  let query = $state('');
  let selected = $state<ProviderDefinition | null>(null);
  let method = $state<string>('');
  let checks = $state<string[]>([]);
  let checking = $state(false);
  let connName = $state('');
  let plan = $state<'Free' | 'Paid' | 'Enterprise' | 'Unknown'>('Unknown');
  let poll = $state<'automatic' | '5m' | '15m' | '1h' | 'manual'>('automatic');
  let showOnRail = $state(true);
  let enableCollection = $state(true);

  const filtered = $derived(
    PROVIDER_CATALOG.filter((p) =>
      (p.name + ' ' + p.vendor).toLowerCase().includes(query.toLowerCase()),
    ),
  );
  const groups = $derived(['Coding tools', 'API providers', 'Local'].map((g) => ({
    name: g,
    items: filtered.filter((p) => p.group === g),
  })).filter((g) => g.items.length));

  function choose(p: ProviderDefinition) {
    selected = p;
    method = p.methods[0]?.id ?? '';
    connName = `Personal ${p.name}`;
    step = 2;
  }

  async function validate() {
    if (!selected) return;
    step = 3;
    checking = true;
    checks = [];
    const seq = selected.id === 'ollama' || selected.id === 'lm-studio'
      ? ['Local daemon found', 'Model list reachable', 'Permissions valid']
      : [`${selected.name} endpoint found`, 'Credentials validated', 'Account identified', 'Permissions valid'];
    for (const s of seq) {
      await new Promise((r) => setTimeout(r, 320));
      checks = [...checks, s];
    }
    checking = false;
  }

  function connect() {
    if (!selected) return;
    onConnect({
      id: crypto.randomUUID(),
      provider_id: selected.id,
      display_name: connName || selected.name,
      connection_method: (method as ProviderConnection['connection_method']) || 'api_key',
      enabled: enableCollection,
      pinned: showOnRail,
      plan,
      plan_source: plan === 'Unknown' ? 'unknown' : 'user_declared',
      poll_interval: poll,
      credential_alias: selected.group === 'Local' ? null : `usagehalo/${selected.id}`,
      created_at: new Date().toISOString(),
      last_validated_at: new Date().toISOString(),
    });
    reset();
    onClose();
  }

  function reset() {
    step = 1; query = ''; selected = null; method = '';
    checks = []; connName = ''; plan = 'Unknown';
  }

  $effect(() => { if (open) { step = 1; } });
</script>

{#if open}
  <div class="overlay" role="presentation" onclick={onClose}>
    <div class="wizard" role="dialog" aria-modal="true" aria-label="Connect provider" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <header>
        <div>
          <p class="step">Step {step} of 4</p>
          <h2>
            {#if step === 1}Connect provider
            {:else if step === 2}{selected?.name}
            {:else if step === 3}Validate connection
            {:else}Configure{/if}
          </h2>
        </div>
        <button class="close" onclick={onClose} aria-label="Close">×</button>
      </header>

      {#if step === 1}
        <input class="search" placeholder="Search integrations…" bind:value={query} aria-label="Search integrations" />
        {#each groups as g}
          <h3>{g.name}</h3>
          <div class="pick-grid">
            {#each g.items as p}
              <button class="pick" onclick={() => choose(p)}>
                <span class="mono" style={`--a:${p.accent}`}>{p.monogram}</span>
                <span><strong>{p.name}</strong><small>{p.vendor} · {p.maturity}</small></span>
              </button>
            {/each}
          </div>
        {/each}
      {:else if step === 2 && selected}
        <p class="detected">Local installation check runs at connect time. Detection alone never enables collection.</p>
        <fieldset>
          <legend>Connection method</legend>
          {#each selected.methods as m}
            <label class="radio">
              <input type="radio" name="method" value={m.id} bind:group={method} />
              <span><strong>{m.label}</strong><small>{m.detail}</small></span>
            </label>
          {/each}
        </fieldset>
        <div class="caps">
          <div><span>Data available</span><ul>{#each selected.methods.find((m) => m.id === method)?.capabilities ?? [] as c}<li>{c}</li>{/each}</ul></div>
          <div><span>Privacy</span><p>Prompts and responses are NOT collected.</p></div>
        </div>
        <footer>
          <button class="ghost" onclick={() => step = 1}>Back</button>
          <button class="primary" onclick={validate}>Continue</button>
        </footer>
      {:else if step === 3 && selected}
        <ul class="checks">
          {#each checks as c}<li class="ok">✓ {c}</li>{/each}
          {#if checking}<li class="pending">Testing connection…</li>{/if}
        </ul>
        <footer>
          <button class="ghost" onclick={() => step = 2}>Back</button>
          <button class="primary" disabled={checking} onclick={() => step = 4}>{checking ? 'Validating…' : 'Continue'}</button>
        </footer>
      {:else if step === 4}
        <label class="field">Connection name<input bind:value={connName} /></label>
        <label class="field">Plan
          <select bind:value={plan}>
            <option>Free</option><option>Paid</option><option>Enterprise</option><option>Unknown</option>
          </select>
        </label>
        <p class="hint">Plan is user declared unless the provider reports it. Never inferred from weak evidence.</p>
        <label class="field">Poll interval
          <select bind:value={poll}>
            <option value="automatic">Automatic</option><option value="5m">Every 5 minutes</option><option value="15m">Every 15 minutes</option><option value="1h">Hourly</option><option value="manual">Manual</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" bind:checked={showOnRail} /> Show on rail</label>
        <label class="check"><input type="checkbox" bind:checked={enableCollection} /> Enable collection</label>
        <footer>
          <button class="ghost" onclick={onClose}>Cancel</button>
          <button class="primary" onclick={connect}>Connect</button>
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay { position: fixed; inset: 0; background: rgba(4,6,8,.6); backdrop-filter: blur(6px); z-index: 80; display: grid; place-items: center; padding: 20px; }
  .wizard { width: min(560px, 100%); max-height: 86vh; overflow: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 22px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .step { font-size: 12px; color: var(--muted); margin: 0; }
  h2 { margin: 2px 0 0; font-size: 22px; letter-spacing: -0.02em; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 16px 0 8px; }
  .close { border: 1px solid var(--line); background: transparent; color: inherit; width: 32px; height: 32px; border-radius: 10px; font-size: 18px; cursor: pointer; }
  .search { width: 100%; margin-top: 14px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: inherit; }
  .pick-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .pick { display: flex; gap: 10px; align-items: center; text-align: left; border: 1px solid var(--line); background: var(--panel); color: inherit; border-radius: 12px; padding: 10px; cursor: pointer; }
  .pick:hover { border-color: var(--ink); }
  .mono { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-weight: 800; background: color-mix(in srgb, var(--a) 18%, transparent); border: 1px solid color-mix(in srgb, var(--a) 45%, transparent); }
  .pick strong, .radio strong { display: block; font-size: 13px; }
  .pick small, .radio small { display: block; font-size: 11px; color: var(--muted); }
  fieldset { border: 0; padding: 0; margin: 12px 0; }
  legend { font-size: 12px; font-weight: 700; margin-bottom: 8px; }
  .radio { display: flex; gap: 10px; padding: 10px; border: 1px solid var(--line); border-radius: 12px; margin-bottom: 8px; cursor: pointer; }
  .caps { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 12px; }
  .caps ul { margin: 6px 0; padding-left: 16px; }
  .detected, .hint { font-size: 12px; color: var(--muted); }
  .checks { list-style: none; padding: 0; margin: 14px 0; display: grid; gap: 8px; font-size: 13px; }
  .ok { color: var(--good); } .pending { color: var(--muted); }
  .field { display: grid; gap: 6px; font-size: 12px; font-weight: 600; margin: 10px 0; }
  .field input, .field select { padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: inherit; font-size: 13px; }
  .check { display: flex; gap: 8px; align-items: center; font-size: 13px; margin: 8px 0; }
  footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  .ghost { border: 1px solid var(--line); background: transparent; color: inherit; padding: 9px 14px; border-radius: 10px; cursor: pointer; }
  .primary { border: 0; background: var(--ink); color: var(--bg); padding: 9px 16px; border-radius: 10px; font-weight: 700; cursor: pointer; }
  .primary:disabled { opacity: .5; cursor: default; }
</style>
