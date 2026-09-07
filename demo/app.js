// UsageHalo showcase — real-data only, zero-dependency.
// Every number renders from a live source (/api/snapshot, /api/detected,
// /api/activity-buckets, /api/alerts, /api/quotas) or explicit user data
// (localStorage connections, budgets, alert rules, settings). No hash
// patterns, no hardcoded model/alert/budget rows, no sparklines. Empty
// store → honest empty states, never generated curves.
const STATE = {
  providers: [], models: [], detected: [], buckets: [],
  generated_at: null, dayUtc: null, sampleData: false, demoMode: false,
  source: 'pending', page: 'overview', metric: 'tokens',
  range: 'week', budgets: loadJSON('usagehalo.showcase.budgets', []),
  connections: loadJSON('usagehalo.showcase.connections', {}),
  modelProvider: 'all',
  rules: loadJSON('usagehalo.showcase.rules', []),
  settings: Object.assign({ theme: 'dark', style: 'glass', placement: 'left', telemetry: true, analytics: true, retention: '30', ringAgg: 0, ringMetric: 0, showEstimated: true }, loadJSON('usagehalo.showcase.settings', {})),
  modelFilter: '', serverAlerts: [],
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ---- custom dropdowns: one menu style for every listing ----
// Native popups ignore the page theme (dark text on dark, light on light),
// so every <select> is enhanced into the same button + menu used by the
// date filter. The native select stays in the DOM (hidden) as the single
// source of truth; choosing a menu item sets its value and dispatches
// change, so all existing listeners keep working.
function closeAllMenus() {
  $$('.menu').forEach((m) => { m.hidden = true; });
  $('#range-btn')?.setAttribute('aria-expanded', 'false');
}
function enhanceSelect(sel) {
  if (!sel || sel.dataset.enhanced) return;
  sel.dataset.enhanced = '1';
  const wrap = document.createElement('div');
  wrap.className = 'menu-wrap';
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  sel.style.display = 'none';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'select custom-select';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', sel.getAttribute('aria-label') || 'Choose');
  const menu = document.createElement('div');
  menu.className = 'menu glass'; menu.setAttribute('role', 'listbox'); menu.hidden = true;
  wrap.appendChild(btn); wrap.appendChild(menu);
  const build = () => {
    const opts = [...sel.options];
    menu.innerHTML = opts.length ? opts.map((o) => `<button role="option" data-v="${esc(o.value)}" aria-selected="${o.selected}" class="${o.selected ? 'active' : ''}"><span>${esc(o.text)}</span><span class="tick">${o.selected ? '✓' : ''}</span></button>`).join('')
      : '<div class="menu-note">No options</div>';
    btn.innerHTML = `${esc(sel.selectedOptions[0]?.text || 'Select')} ▾`;
    $$('[data-v]', menu).forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      sel.value = b.dataset.v;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      build(); closeAllMenus();
    }));
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasHidden = menu.hidden;
    closeAllMenus();
    if (wasHidden) { build(); menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
  });
  sel._sync = build;
  build();
}

// ---- provider status: detection is a suggestion, never collection ----
function statusOf(p) {
  const conn = STATE.connections[p.id];
  const enabled = !conn || conn.enabled !== false;
  if (p.live && enabled) return 'collecting';
  if (p.live && !enabled) return 'disabled';
  if (conn && conn.connected && enabled) return 'waiting';
  if (conn && conn.connected && !enabled) return 'paused';
  if (p.installed || p.configured) return 'detected';
  return 'available';
}
const STATUS_LABEL = {
  collecting: '● Collecting', disabled: 'Disabled — history preserved',
  waiting: 'Connected — waiting for first observation', paused: 'Paused',
  detected: 'Detected locally', available: 'Not connected',
};
const collecting = () => STATE.providers.filter((p) => statusOf(p) === 'collecting');
const detectedOnly = () => STATE.providers.filter((p) => ['detected', 'waiting', 'paused'].includes(statusOf(p)) && !p.live);
const availableOnly = () => STATE.providers.filter((p) => statusOf(p) === 'available');
const attentionList = () => STATE.providers.filter((p) => ['disabled', 'paused'].includes(statusOf(p)) || (!p.live && p.primaryPercent != null));

function setEnabled(id, on) {
  const c = STATE.connections[id] || {};
  c.enabled = on;
  STATE.connections[id] = c;
  saveJSON('usagehalo.showcase.connections', STATE.connections);
  renderAll();
}
function ageLine(p) {
  if (p.live) return 'just now';
  if (p.age_seconds != null) {
    const a = p.age_seconds;
    if (a < 60) return `${a}s ago`;
    if (a < 3600) return `${Math.floor(a / 60)}m ago`;
    if (a < 86400) return `${Math.floor(a / 3600)}h ago`;
    return `${Math.floor(a / 86400)}d ago`;
  }
  if (p.observed_at) { const s = Math.max(0, Math.round((Date.now() - new Date(p.observed_at).getTime()) / 1000)); return ageLine({ age_seconds: s }); }
  return 'never observed';
}

// ---- rail: collecting providers only ----
function buildBubble(p) {
  const b = document.createElement('button');
  b.className = 'provider-bubble'; b.dataset.provider = p.id;
  b.setAttribute('aria-label', p.primaryPercent == null ? `${p.displayName}, collecting, no quota window` : `${p.displayName} ${p.primaryPercent}% — open details`);
  const pct = p.primaryPercent == null ? '—' : `${p.primaryPercent}%`;
  const icon = p.icon ? `<img class="ring-icon" src="${esc(p.icon)}" alt="" loading="lazy" />` : `<span class="ring-fallback">${esc(p.monogram)}</span>`;
  b.innerHTML = `<span class="ring" style="--p:${p.primaryPercent ?? 0};--accent:${esc(p.accent)}">${icon}</span><span class="bubble-pct">${pct}</span>`;
  b.querySelector('img')?.addEventListener('error', (e) => { const s = document.createElement('span'); s.className = 'ring-fallback'; s.textContent = p.monogram; e.target.replaceWith(s); });
  return b;
}
function renderRail() {
  const stack = $('#provider-stack'); const more = $('#more-btn');
  stack.innerHTML = '';
  const live = collecting();
  live.slice(0, 6).forEach((p) => {
    const btn = buildBubble(p); stack.appendChild(btn);
    btn.addEventListener('mouseenter', () => showHover(p, btn));
    btn.addEventListener('focus', () => showHover(p, btn));
    btn.addEventListener('mouseleave', scheduleHide); btn.addEventListener('blur', scheduleHide);
    btn.addEventListener('click', () => openDetail(p.id));
  });
  const overflow = Math.max(0, live.length - 6);
  // No overflow and something collecting: hide the placeholder glyph
  // entirely — a lone "•••" is decoration, not navigation.
  more.style.display = overflow > 0 || live.length === 0 ? '' : 'none';
  more.textContent = overflow > 0 ? `+${overflow}` : '+';
  more.onclick = () => goto('providers');
  more.setAttribute('aria-label', live.length ? 'Show all providers' : 'Nothing collecting yet — open providers');
}
const hover = $('#hover-card'); let hideTimer;
hover.addEventListener('mouseenter', () => clearTimeout(hideTimer));
hover.addEventListener('mouseleave', scheduleHide);
function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(() => { hover.hidden = true; }, 160); }
function badgeFor(p) {
  const st = statusOf(p);
  if (st === 'collecting') return '<span class="live-badge">● Collecting</span>';
  if (st === 'disabled') return '<span class="live-badge stale">Disabled</span>';
  if (st === 'waiting') return '<span class="live-badge fresh">Connected — no data yet</span>';
  if (st === 'paused') return '<span class="live-badge stale">Paused</span>';
  if (st === 'detected') return '<span class="live-badge fresh">Detected locally</span>';
  if (p.primaryPercent != null) return `<span class="live-badge stale">${esc(p.freshness || 'stale')}</span>`;
  return '<span class="live-badge">Not connected</span>';
}
function showHover(p, anchor) {
  clearTimeout(hideTimer);
  const top = STATE.models.find((m) => m.surface === p.displayName);
  const pctLine = p.primaryPercent == null ? 'No observations yet' : `${p.primaryPercent}%`;
  hover.innerHTML = `
    <div class="hover-title"><div><div class="provider-name">${logoHTML(p)}${esc(p.displayName)}</div><div class="provider-sub">${esc(p.vendor || '')}</div></div>${badgeFor(p)}</div>
    <div class="quota"><div class="quota-top"><span>${esc(p.primaryLabel)}</span><strong>${pctLine}</strong></div>${p.primaryPercent != null ? `<div class="progress"><span style="width:${Math.min(p.primaryPercent, 100)}%;background:${esc(p.accent)}"></span></div>` : ''}</div>
    <div class="quota"><div class="quota-top"><span>Resets</span><span>${esc(p.primaryReset || 'No reset reported')}</span></div>
    <div class="quota-top"><span>Today's total</span><span>${esc(p.tokensToday || 'No observations yet')}</span></div>
    <div class="quota-top"><span>Cost</span><span>${esc(p.costToday || 'Cost unavailable')}</span></div>
    <div class="quota-top"><span>Top model</span><span>${esc(top?.model || '—')}</span></div></div>
    <div class="source-line"><span class="dot ${p.live ? 'live' : ''}"></span>Last seen ${ageLine(p)} · ${esc(p.source || '')} · ${esc(p.scope || '')}</div>
    <div class="source-line">Click for per-provider details</div>`;
  hover.style.top = `${Math.max(14, Math.min(window.innerHeight - 340, anchor.getBoundingClientRect().top - 10))}px`;
  hover.hidden = false;
  const placeRight = document.body.dataset.placement === 'right';
  if (!placeRight) hover.style.left = '114px'; else { hover.style.left = 'auto'; hover.style.right = '114px'; }
}

// ---- tray ----
function renderTray() {
  const el = $('#tray-card');
  const live = collecting();
  const rows = live.slice(0, 6).map((p) => `
    <div class="tray-row-item"><span class="mini-logo tray-logo">${esc(p.monogram)}${p.icon ? `<img src="${esc(p.icon)}" alt="" loading="lazy" onerror="this.remove()" />` : ''}</span>
    <div><strong>${esc(p.displayName)}</strong><div style="color:var(--muted);font-size:10px">${esc(p.vendor || '')}</div>${p.primaryPercent != null ? `<div class="pbar"><span style="width:${p.primaryPercent}%;background:${esc(p.accent)}"></span></div>` : ''}</div>
    <span>${p.primaryPercent ?? '—'}${p.primaryPercent == null ? '' : '%'}</span></div>`).join('')
    || '<p class="muted small">Nothing collecting yet. Connect a provider to begin tracking.</p>';
  el.innerHTML = `<div class="tray-head"><span class="brand-mark"></span><div><strong>UsageHalo</strong><div style="color:var(--muted);font-size:11px">${live.length ? `${live.length} collecting` : 'No live data yet'}</div></div><span class="live-pill" style="margin-left:auto"><i></i>${live.length ? 'Live' : 'Idle'}</span></div>${rows}<div class="tray-foot"><span>◈ Open Dashboard</span><span>⏻ Quit</span></div>`;
}

// ---- tray rows use the provider's real logo, monogram only as fallback ----

// ---- overview ----
function totals() {
  let tokens = 0, cost = 0, tokenSources = 0, costSources = 0;
  for (const p of collecting()) {
    if (typeof p.tokens_today_value === 'number' && Number.isFinite(p.tokens_today_value)) { tokens += p.tokens_today_value; tokenSources++; }
    if (typeof p.cost_today_value === 'number' && Number.isFinite(p.cost_today_value)) { cost += p.cost_today_value; costSources++; }
  }
  return { tokens, cost, tokenSources, costSources };
}
function renderSummaries() {
  const { tokens, cost, tokenSources, costSources } = totals();
  const live = collecting();
  const cards = [
    { label: 'Observed tokens', value: tokenSources ? `${(tokens / 1e6).toFixed(2)}M` : '—', meta: tokenSources ? `sum of ${tokenSources} observed token counts` : 'no observed token counts yet' },
    { label: 'Provider cost', value: costSources ? `$${cost.toFixed(2)}` : 'Cost unavailable', meta: costSources ? 'sum of provider-reported costs' : 'no provider-reported costs yet' },
    { label: 'Requests', value: '—', meta: 'device-observed only' },
    { label: 'Live providers', value: `${live.length} / ${STATE.providers.length}`, meta: live.length ? 'collecting now' : 'nothing collecting yet' },
  ];
  $('#summary-grid').innerHTML = cards.map((c) => `<article class="summary-card"><div class="summary-label">${c.label}</div><div class="summary-value">${c.value}</div><div class="summary-meta">${c.meta}</div></article>`).join('');
  const sub = $('#sys-live-sub'); if (sub) sub.textContent = `${STATE.providers.length} providers · ${live.length ? 'Live' : 'No live data yet'}`;
  const staleN = STATE.providers.filter((p) => !p.live && p.primaryPercent != null).length;
  const title = $('#sys-live-title');
  if (title) title.textContent = live.length ? `${live.length} live${staleN ? ` · ${staleN} stale` : ''}` : staleN ? `${staleN} stale` : 'No live data yet';
  const dot = $('#sys-live-dot');
  if (dot) dot.className = `dot ${live.length ? 'live' : 'idle'}`;
  const pill = $('#brand-pill');
  if (pill) pill.innerHTML = `<i></i>${live.length ? 'Live' : 'No data'}`;
  const banner = $('#sample-banner');
  if (STATE.demoMode) { banner.hidden = false; banner.textContent = `Sample data · as of ${STATE.dayUtc || 'today'} — every number on this page is synthetic.`; }
  else banner.hidden = true;
  const att = $('#attention');
  if (att) {
    const items = attentionList();
    if (STATE.page === 'overview' && items.length) {
      att.hidden = false;
      att.innerHTML = `<div class="attention-box"><strong>Needs attention</strong>${items.slice(0, 4).map((p) => `<div class="attn-row"><span>${esc(p.displayName)} — ${esc(STATUS_LABEL[statusOf(p)])} · last seen ${ageLine(p)}</span><button class="link" data-attn="${esc(p.id)}">Details</button></div>`).join('')}</div>`;
      $$('#attention [data-attn]').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.attn)));
    } else { att.innerHTML = ''; att.hidden = true; }
  }
}

// ---- heatmap + trend: real buckets only ----
function renderHeatmap(id, buckets) {
  const el = $(id); if (!el) return; el.innerHTML = '';
  if (!buckets || !buckets.length || buckets.every((b) => b.value <= 0)) {
    el.innerHTML = '<p class="muted small">No historical activity collected yet.</p>';
    return;
  }
  for (const b of buckets) {
    const d = document.createElement('i'); d.className = 'heat-cell';
    d.dataset.l = String(b.level ?? 0);
    d.title = `${b.day} · ${b.value.toLocaleString()}`;
    el.appendChild(d);
  }
}
function renderTrend() {
  const el = $('#trend-chart'); if (!el) return;
  const pts = (STATE.buckets || []).filter((b) => b.value > 0).map((b) => b.value);
  if (pts.length < 2) { el.innerHTML = '<p class="muted small">No trend yet — connect a provider to begin tracking.</p>'; return; }
  const W = 560, H = 96, P = 8, max = Math.max(...pts);
  const path = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(P + (i * (W - 2 * P)) / (pts.length - 1)).toFixed(1)},${(H - P - (v / max) * (H - 2 * P)).toFixed(1)}`).join(' ');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:96px;display:block" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;
}
function renderProviderBars() {
  const el = $('#provider-bars'); if (!el) return;
  const live = collecting().filter((p) => p.primaryPercent != null).slice(0, 6);
  el.innerHTML = live.length ? live.map((p) => `
    <div class="pbar-row"><span>${esc(p.displayName)}</span><div class="pbar"><span style="width:${p.primaryPercent}%;background:${esc(p.accent)}"></span></div><span style="text-align:right">${p.primaryPercent}%</span></div>`).join('')
    : '<p class="muted small">No quota windows observed yet.</p>';
}
function renderBudgetBars() {
  const el = $('#budget-bars'); if (!el) return;
  el.innerHTML = '<p class="muted small">No budgets configured. Budgets stay separate from provider quotas.</p>';
}
function providerDisplay(id) {
  const p = STATE.providers.find((x) => x.id === id || x.displayName === id);
  return p ? p.displayName : id;
}
// Real provider logo with the monogram stacked behind as fallback: if the
// image loads it covers the letter; if it fails it removes itself and the
// letter shows. Never a broken-image glyph.
function logoHTML(p) {
  return `<span class="mini-logo logo-stack">${esc(p.monogram)}${p.icon ? `<img src="${esc(p.icon)}" alt="" loading="lazy" onerror="this.remove()" />` : ''}</span>`;
}
function renderModels() {
  const mp = $('#model-provider');
  if (mp) {
    const opts = `<option value="all">All providers</option>` + STATE.providers
      .filter((p) => (STATE.models || []).some((m) => m && (m.billing_owner === p.id || m.surface === p.displayName)))
      .map((p) => `<option value="${esc(p.id)}">${esc(p.displayName)}</option>`).join('');
    if (mp.dataset.built !== opts) { mp.innerHTML = opts; mp.dataset.built = opts; }
    mp.value = STATE.modelProvider || 'all';
    enhanceSelect(mp);
    mp._sync?.();
  }
  const pill = $('#model-active');
  if (pill) {
    pill.innerHTML = (STATE.modelProvider && STATE.modelProvider !== 'all')
      ? `<button class="pill-filter" id="model-clear">Showing ${esc(providerDisplay(STATE.modelProvider))} only ×</button>` : '';
    $('#model-clear')?.addEventListener('click', () => { STATE.modelProvider = 'all'; renderModels(); });
  }
  const q = STATE.modelFilter.toLowerCase();
  const rows = (STATE.models || [])
    .filter((m) => m && m.model)
    .filter((m) => !STATE.modelProvider || STATE.modelProvider === 'all' || m.billing_owner === STATE.modelProvider || m.surface === providerDisplay(STATE.modelProvider))
    .filter((m) => (m.model + ' ' + (m.surface || '') + ' ' + (m.billing_owner || '')).toLowerCase().includes(q));
  const groups = new Map();
  for (const m of rows) {
    const key = m.billing_owner || m.surface || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const head = `<div class="model-row header"><span>Model</span><span>Surface</span><span>Tokens</span><span>Cost</span><span>Billing</span></div>`;
  const body = groups.size ? [...groups.entries()].map(([owner, list]) => {
    const p = STATE.providers.find((x) => x.id === owner || x.displayName === owner);
    const name = p ? p.displayName : owner;
    const dot = p ? `<i class="model-provider-dot" style="background:${esc(p.accent)}"></i>` : '';
    const total = list.reduce((s, m) => s + (typeof m.tokens === 'number' ? m.tokens : 0), 0);
    return `<div class="model-group">${dot}${esc(name)} · ${list.length} model${list.length === 1 ? '' : 's'} · ${total.toLocaleString()} tokens</div>`
      + list.map((m) => `<div class="model-row"><span class="model-name">${esc(m.model)}</span><span>${esc(m.surface || m.billing_owner)}</span><span>${typeof m.tokens === 'number' ? m.tokens.toLocaleString() : esc(m.tokens ?? '—')}</span><span>${esc(m.cost || 'Cost unavailable')}</span><span style="color:var(--muted);font-size:11px">${esc(m.billing_owner)}${m.model_provider && m.model_provider !== m.billing_owner ? ` · by ${esc(m.model_provider)}` : ''}</span></div>`).join('');
  }).join('')
    : '<p class="muted small">No observed model activity yet. Live instrumented rows appear here when opt-in request instrumentation posts to <code>/api/ingest/event</code>. Billing owner ≠ model vendor is preserved.</p>';
  const html = head + body;
  const a = $('#model-table'); if (a) a.innerHTML = html;
  const b = $('#model-table-full'); if (b) b.innerHTML = html;
}

// ---- alerts: hot quotas + server rules + local rules ----
function evaluateLocalRules() {
  const byId = Object.fromEntries(STATE.providers.map((p) => [p.id, p]));
  return STATE.rules.map((r) => {
    const p = byId[r.target];
    const pct = p?.primaryPercent;
    const firing = typeof pct === 'number' && pct >= r.threshold;
    return { ...r, firing, detail: p ? (typeof pct === 'number' ? `${p.displayName} at ${pct}%` : `${p.displayName} has no observed quota`) : 'provider not in snapshot' };
  });
}
async function renderAlerts() {
  const hot = STATE.providers.filter((p) => p.primaryPercent != null && p.primaryPercent >= 80).map((p) => ({ label: `${p.displayName} usage at ${p.primaryPercent}%`, when: p.live ? 'live' : `last seen ${ageLine(p)}` }));
  let server = [];
  try {
    const r = await fetch('/api/alerts', { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); server = (j.fired || []).map((f) => ({ label: String(f.rule_id || f.id || 'alert'), when: String(f.evaluated_at || 'recent') })); }
  } catch {}
  const local = evaluateLocalRules();
  const rows = [
    ...hot,
    ...server,
    ...local.filter((r) => r.firing).map((r) => ({ label: r.label, when: r.detail })),
  ];
  const html = rows.length ? rows.map((a) => `<div class="alert-item"><span>${esc(a.label)}</span><time>${esc(a.when)}</time></div>`).join('')
    : '<p class="muted small">No alerts firing. Quota rules trigger at your threshold on observed percentages.</p>';
  const a = $('#alert-list'); if (a) a.innerHTML = html;
  const localHtml = local.length
    ? local.map((r) => `<div class="kv"><span>${esc(r.label)} — ${r.firing ? 'FIRING' : 'ok'} <small>(${esc(r.detail)})</small></span><button class="link" data-del-rule="${esc(r.id)}">Delete</button></div>`).join('')
    : '<p class="muted small">No custom rules yet.</p>';
  const b = $('#alert-list-full'); if (b) b.innerHTML = html + `<h3 class="section-title">My rules (${local.length})</h3>` + localHtml;
  $$('#alert-list-full [data-del-rule]').forEach((btn) => btn.addEventListener('click', () => {
    STATE.rules = STATE.rules.filter((x) => x.id !== btn.dataset.delRule);
    saveJSON('usagehalo.showcase.rules', STATE.rules); renderAlerts();
  }));
  const c = $('#settings-alerts'); if (c) c.innerHTML = html;
  const d = $('#settings-budgets'); if (d) d.innerHTML = STATE.budgets.length
    ? STATE.budgets.map((x) => `<div class="kv"><span>${esc(x.label)} · $${esc(x.limit)}</span><button class="link" data-del-budget="${esc(x.id)}">Remove</button></div>`).join('')
    : '<p class="muted small">No budgets configured. Budgets stay separate from provider quotas.</p>';
  $$('[data-del-budget]').forEach((btn) => btn.addEventListener('click', () => {
    STATE.budgets = STATE.budgets.filter((x) => x.id !== btn.dataset.delBudget);
    saveJSON('usagehalo.showcase.budgets', STATE.budgets); renderAlerts(); renderProviderPages();
  }));
  const e = $('#settings-sources');
  if (e) {
    const live = collecting().length;
    e.innerHTML = `<div class="kv"><span>Local store</span><span>${STATE.models.length} instrumented rows</span></div><div class="kv"><span>Provider APIs</span><span>${live} / ${STATE.providers.length} live</span></div><div class="kv"><span>Detection</span><span>${STATE.detected.length} signals</span></div>`;
  }
  const sel = $('#alert-provider');
  if (sel && !sel.options.length) {
    sel.innerHTML = STATE.providers.map((p) => `<option value="${esc(p.id)}">${esc(p.displayName)}</option>`).join('');
  }
  if (sel) { enhanceSelect(sel); sel._sync?.(); }
}

// ---- provider cards + detail ----
function providerCard(p) {
  const st = statusOf(p);
  const quota = p.primaryPercent == null ? 'No observations yet' : `${p.primaryPercent}% ${esc(p.primaryLabel)}`;
  return `
    <article class="provider-card" data-card="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.displayName)} — ${esc(STATUS_LABEL[st])} — open details"><div class="top">${logoHTML(p)}<div><strong>${esc(p.displayName)}</strong><small>${esc(p.vendor || '')}</small></div><span class="conn ${st === 'collecting' ? '' : 'off'}" style="margin-left:auto">${esc(STATUS_LABEL[st])}</span></div>
    <div class="ringline">${p.primaryPercent != null ? `<div class="mini-ring" style="--p:${p.primaryPercent};--accent:${esc(p.accent)}"><b>${p.primaryPercent}%</b></div>` : ''}<div><div style="font-size:11px;color:var(--muted)">${quota}</div><div style="font-size:12px">${esc(p.tokensToday || 'No observations yet')} · ${esc(p.costToday || 'Cost unavailable')}</div><div style="font-size:10px;color:var(--muted)">${esc(p.source || '')} · ${esc(p.scope || '')} · last seen ${ageLine(p)}</div></div></div>
    <div class="kv"><span>Collection</span><button class="toggle ${['collecting', 'waiting'].includes(st) ? 'on' : ''}" data-toggle="${esc(p.id)}" aria-label="toggle collection for ${esc(p.displayName)}" title="${['collecting', 'disabled', 'waiting', 'paused'].includes(st) ? 'Toggle collection' : 'Open details to connect first'}"></button></div></article>`;
}
function bindCards(root) {
  $$('[data-card]', root).forEach((card) => {
    card.addEventListener('click', (e) => { if (e.target.closest('[data-toggle]')) return; openDetail(card.dataset.card); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.target.closest('[data-toggle]')) openDetail(card.dataset.card); });
  });
  $$('[data-toggle]', root).forEach((btn) => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = btn.dataset.toggle;
    const p = STATE.providers.find((x) => x.id === id);
    if (!p) return;
    const st = statusOf(p);
    if (['collecting', 'disabled', 'waiting', 'paused'].includes(st)) {
      const c = STATE.connections[id] || {};
      c.enabled = !(c.enabled !== false);
      STATE.connections[id] = c;
      saveJSON('usagehalo.showcase.connections', STATE.connections);
      renderAll();
    } else {
      openDetail(id); // not connected: toggle opens details instead of sticking
    }
  }));
}
function renderProviderPages() {
  const grid = $('#provider-grid');
  if (grid) {
    const sec = (title, list, empty) => `<h3 class="section-title">${title} (${list.length})</h3>` + (list.length ? `<div class="provider-grid">${list.map(providerCard).join('')}</div>` : `<p class="muted small">${empty}</p>`);
    const live = collecting();
    const waiting = STATE.providers.filter((p) => ['waiting', 'paused', 'disabled'].includes(statusOf(p)));
    grid.innerHTML =
      sec('Connected', [...live, ...waiting], 'No providers connected yet.') +
      sec('Detected locally', detectedOnly(), 'No local installations detected. Detection never enables collection.') +
      sec('Available integrations', availableOnly(), 'Every supported provider is connected or detected.');
    bindCards(grid);
  }
  const sp = $('#settings-provider-grid');
  if (sp) {
    sp.innerHTML = STATE.providers.slice(0, 10).map(providerCard).join('')
      + `<article class="provider-card" data-add-provider tabindex="0" role="button" style="display:grid;place-items:center;text-align:center;color:var(--muted)"><div><div style="font-size:24px">+</div><strong>Add Provider</strong><div style="font-size:11px">API key, OAuth, CLI bridge, or OTLP</div></div></article>`;
    bindCards(sp);
    sp.querySelector('[data-add-provider]')?.addEventListener('click', () => goto('providers'));
  }
  const hl = $('#health-list');
  if (hl) hl.innerHTML = collecting().slice(0, 6).map((p) => `<div class="health-item"><div><strong>${esc(p.displayName)}</strong><span>${esc(p.source || '')} · last seen ${ageLine(p)}</span></div><span>● collecting</span></div>`).join('')
    || '<p class="muted small">No connectors collecting.</p>';
  const bc = $('#budget-cards');
  if (bc) bc.innerHTML = STATE.budgets.length ? STATE.budgets.map((r) => `<article class="panel"><div class="eyebrow">User budget · ${esc(r.period || 'monthly')}</div><h2>${esc(r.label)}</h2><div class="budget-top"><strong>$${esc(r.limit)}</strong></div><p class="muted small">Separate from provider quotas.</p></article>`).join('')
    : '<article class="panel"><div class="eyebrow">Budgets</div><h2>No budgets yet</h2><p class="muted small">Set optional spending limits without changing your provider\'s actual quota.</p><div class="budget-form"><input id="budget-label" placeholder="Budget label" /><input id="budget-limit" placeholder="Limit (USD)" inputmode="decimal" /><button class="primary" id="budget-add">Create budget</button></div></article>';
  $('#budget-add')?.addEventListener('click', () => {
    const label = $('#budget-label')?.value.trim();
    const limit = Number($('#budget-limit')?.value);
    if (!label || !Number.isFinite(limit) || limit <= 0) return;
    STATE.budgets = [...STATE.budgets, { id: String(Date.now()), label, limit: limit.toFixed(2), period: 'monthly' }];
    saveJSON('usagehalo.showcase.budgets', STATE.budgets); renderProviderPages();
  });
}

// ---- provider detail modal ----
async function openDetail(id) {
  const p = STATE.providers.find((x) => x.id === id);
  if (!p) return;
  const modal = $('#detail-modal'), body = $('#detail-body');
  const det = (STATE.detected || []).find((d) => d.id === id);
  const conn = STATE.connections[id];
  const st = statusOf(p);
  const models = (STATE.models || []).filter((m) => m.surface === p.displayName || m.billing_owner === id);
  let windows = [];
  try {
    const r = await fetch(`/api/quotas?provider=${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (r.ok) windows = (await r.json()).windows || [];
  } catch {}
  body.innerHTML = `
    <div class="modal-head"><div class="title">${logoHTML(p)}<div><strong style="font-size:16px">${esc(p.displayName)}</strong><div class="muted small">${esc(p.vendor || '')} · ${esc(p.scope || '')}</div></div><span class="conn ${st === 'collecting' ? '' : 'off'}" style="margin-left:auto">${esc(STATUS_LABEL[st])}</span></div>
    <button class="icon-btn" id="detail-close" aria-label="Close details">×</button></div>
    <div class="detail-grid">
      <div><h3 class="section-title">Quota windows (${windows.length || (p.primaryPercent != null ? 1 : 0)})</h3>
      ${windows.length ? windows.map((w) => `<div class="kv"><span>${esc(w.label)}<br /><small>observed ${esc(w.observed_at || 'unknown')} · ${esc(w.source || '')}</small></span><strong>${w.used_percent != null ? `${Math.round(w.used_percent)}%` : (w.provider_cost != null ? `$${Number(w.provider_cost).toFixed(2)}` : '—')}</strong></div>`).join('')
        : (p.primaryPercent != null ? `<div class="kv"><span>${esc(p.primaryLabel)}<br /><small>${esc(p.primaryReset || 'No reset reported')}</small></span><strong>${p.primaryPercent}%</strong></div>` : '<p class="muted small">No quota window observed for this provider.</p>')}</div>
      <div><h3 class="section-title">Today</h3>
      <div class="kv"><span>Tokens</span><strong>${esc(p.tokensToday || 'No observations yet')}</strong></div>
      <div class="kv"><span>Cost</span><strong>${esc(p.costToday || 'Cost unavailable')}</strong></div>
      <div class="kv"><span>Requests</span><strong>${p.requestsToday != null ? p.requestsToday : '—'}</strong></div>
      <div class="kv"><span>Last seen</span><strong>${ageLine(p)}${p.observed_at ? ` <small>(${esc(p.observed_at)})</small>` : ''}</strong></div></div>
      <div><h3 class="section-title">Models (${models.length})</h3>
      ${models.length ? models.map((m) => `<div class="kv"><span><strong>${esc(m.model)}</strong><br /><small>billed to ${esc(m.billing_owner)}${m.model_provider && m.model_provider !== m.billing_owner ? ` · model by ${esc(m.model_provider)}` : ''}</small></span><span>${typeof m.tokens === 'number' ? m.tokens.toLocaleString() : esc(m.tokens ?? '—')} · ${esc(m.cost || 'Cost unavailable')}</span></div>`).join('')
        : '<p class="muted small">No model observations for this provider yet.</p>'}</div>
      <div><h3 class="section-title">Provenance</h3>
      <div class="kv"><span>Source</span><span>${esc(p.source || '—')}</span></div>
      <div class="kv"><span>Freshness</span><span>${esc(p.freshness || 'unknown')}</span></div>
      ${det ? `<div class="kv"><span>Detection evidence</span><span>${esc(det.evidence || '—')}</span></div><p class="muted small">${esc(det.hint || '')}</p>` : '<p class="muted small">No local detection signal.</p>'}
      <p class="muted small">Prompts and responses are never collected.</p></div>
    </div>
    <div class="modal-foot">
      ${!p.live && !(conn && conn.connected) ? `<label>Connection name <input id="conn-name" value="Personal ${esc(p.displayName)}" /></label><select id="conn-method" aria-label="Connection method"><option>CLI bridge</option><option>OTLP telemetry</option><option>API key</option><option>OAuth account</option><option>Local protocol</option></select><button class="primary" id="detail-connect">Connect</button>` : ''}
      ${['collecting', 'disabled', 'waiting', 'paused'].includes(st) ? `<button class="select" id="detail-toggle">${['collecting', 'waiting'].includes(st) ? 'Disable collection' : 'Enable collection'}</button>` : ''}
      <button class="select ghost" id="detail-models">View in Models</button>
    </div>`;
  modal.hidden = false;
  enhanceSelect($('#conn-method'));
  $('#detail-close').addEventListener('click', closeDetail);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeDetail(); }, { once: true });
  $('#detail-connect')?.addEventListener('click', () => {
    STATE.connections[id] = {
      connected: true, enabled: true,
      name: $('#conn-name')?.value || p.displayName,
      method: $('#conn-method')?.value || 'API key',
      created_at: new Date().toISOString(),
    };
    saveJSON('usagehalo.showcase.connections', STATE.connections);
    renderAll(); openDetail(id);
  });
  $('#detail-toggle')?.addEventListener('click', () => {
    const c = STATE.connections[id] || {};
    c.enabled = !(c.enabled !== false);
    STATE.connections[id] = c;
    saveJSON('usagehalo.showcase.connections', STATE.connections);
    renderAll(); openDetail(id);
  });
  $('#detail-models')?.addEventListener('click', () => {
    closeDetail();
    STATE.modelProvider = id; STATE.modelFilter = '';
    const f = $('#model-filter'); if (f) f.value = '';
    goto('models'); renderModels();
  });
}
function closeDetail() { $('#detail-modal').hidden = true; }

// ---- range ----
const RANGES = { today: 1, week: 7, last7: 7, last30: 30, month: 31 };
const RANGE_LABEL = { today: 'Today', week: 'This week', last7: 'Last 7 days', last30: 'Last 30 days', month: 'This month' };
async function fetchBuckets() {
  const days = RANGES[STATE.range] || 7;
  const to = new Date().toISOString();
  const from = new Date(Date.now() - days * 86400_000).toISOString();
  try {
    const r = await fetch(`/api/activity-buckets?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&metric=${STATE.metric}`, { cache: 'no-store' });
    if (!r.ok) throw 0;
    const j = await r.json();
    STATE.buckets = j.buckets || [];
  } catch { STATE.buckets = []; }
}

// ---- navigation ----
const TITLES = { overview: ['Overview', 'Live usage across connected providers. Billing owner ≠ model vendor.'], providers: ['Providers', 'Connected, detected, and available integrations.'], models: ['Models', 'Real model observations only — vendor ≠ billing owner.'], activity: ['Activity', 'Real time-series first. Quotas stay current.'], budgets: ['Budgets', 'User-created limits, separate from provider quotas.'], alerts: ['Alerts', 'Quota risks and budget warnings.'], settings: ['Settings', 'Configure UsageHalo to monitor and manage your AI usage.'] };
const EYEBROW = { overview: 'LIVE USAGE ACROSS CONNECTED PROVIDERS', providers: 'PROVIDER LIFECYCLE — CONNECTED · DETECTED · AVAILABLE', models: 'REAL MODEL OBSERVATIONS ONLY', activity: 'HISTORICAL RANGE — QUOTAS STAY CURRENT', budgets: 'USER BUDGETS — SEPARATE FROM PROVIDER QUOTAS', alerts: 'ALERT RULES — QUOTA RISKS AND WARNINGS', settings: 'LOCAL SETTINGS — THIS BROWSER' };
function goto(page) {
  STATE.page = page;
  $$('#side-nav button, .mobile-nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== page; });
  $('#page-title').textContent = TITLES[page][0];
  $('#page-sub').textContent = TITLES[page][1];
  const eb = $('#page-eyebrow'); if (eb) eb.textContent = EYEBROW[page];
  $('#hover-card').hidden = true;
  closeDetail();
  const attClear = $('#attention'); if (attClear) { attClear.innerHTML = ''; attClear.hidden = true; }
}
const RANGE_ORDER = ['today', 'week', 'last7', 'last30', 'month'];
function renderRangeMenu() {
  const menu = $('#range-menu'); if (!menu) return;
  menu.innerHTML = RANGE_ORDER.map((id) => `<button role="option" aria-selected="${STATE.range === id}" data-range="${id}" class="${STATE.range === id ? 'active' : ''}"><span>${RANGE_LABEL[id]}</span><span class="tick">${STATE.range === id ? '✓' : ''}</span></button>`).join('')
    + `<div class="menu-note">Quotas + connector health stay current</div>`;
  $$('#range-menu [data-range]').forEach((b) => b.addEventListener('click', async () => {
    STATE.range = b.dataset.range;
    closeRangeMenu(); await fetchBuckets(); renderAll();
  }));
}
function openRangeMenu() {
  const menu = $('#range-menu'), btn = $('#range-btn');
  if (!menu || !btn) return;
  renderRangeMenu();
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  menu.querySelector('[data-range].active')?.focus();
}
function closeRangeMenu() {
  const menu = $('#range-menu'), btn = $('#range-btn');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  btn?.setAttribute('aria-expanded', 'false');
}
function renderAll() {
  renderRail(); renderTray(); renderSummaries();
  renderHeatmap('#heatmap', STATE.buckets); renderHeatmap('#heatmap-2', STATE.buckets);
  renderTrend(); renderProviderBars(); renderBudgetBars(); renderModels(); renderAlerts(); renderProviderPages();
  const rb = $('#range-btn'); if (rb) rb.textContent = `${RANGE_LABEL[STATE.range] || STATE.range} ▾`;
  if (!$('#range-menu')?.hidden) renderRangeMenu();
}

// ---- settings ----
function applySettings() {
  const s = STATE.settings;
  document.documentElement.dataset.theme = s.theme;
  document.documentElement.dataset.style = s.style === 'mono' ? 'mono' : s.style;
  document.body.dataset.placement = s.placement;
  $$('#theme-seg button').forEach((b) => b.classList.toggle('active', b.dataset.theme === s.theme || (s.theme === 'dark' && b.dataset.theme === 'dark')));
  $$('#style-seg button').forEach((b) => b.classList.toggle('active', b.dataset.style === s.style));
  $$('#placement-seg button').forEach((b) => b.classList.toggle('active', b.dataset.placement === s.placement));
  const pt = $('#privacy-telemetry'); if (pt) pt.classList.toggle('on', !!s.telemetry);
  const pa = $('#privacy-analytics'); if (pa) pa.classList.toggle('on', !!s.analytics);
  const dr = $('#data-retention'); if (dr) { dr.value = s.retention; dr._sync?.(); }
  const se = $('#show-estimated'); if (se) se.checked = !!s.showEstimated;
}
function persistSettings(msg) {
  saveJSON('usagehalo.showcase.settings', STATE.settings);
  const st = $('#save-status'); if (st) { st.textContent = msg || `Saved ✓ ${new Date().toLocaleTimeString()}`; setTimeout(() => { st.textContent = ''; }, 2500); }
}
function switchSettingsTab(name) {
  $$('#settings-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('[data-panel]').forEach((el) => {
    const show = el.dataset.panel === name || (name === 'providers' && el.dataset.panel === 'providers');
    el.style.display = show ? '' : 'none';
  });
  if (name === 'providers') $$('[data-panel="providers"]').forEach((el) => { el.style.display = ''; });
}

async function fetchSnapshot() {
  try { const r = await fetch('/api/snapshot', { cache: 'no-store' }); if (!r.ok) throw 0; return await r.json(); }
  catch { return null; }
}
async function bootstrap() {
  applySettings();
  enhanceSelect($('#heatmap-metric')); enhanceSelect($('#heatmap-metric-2'));
  enhanceSelect($('#data-retention')); enhanceSelect($('#ring-agg'));
  enhanceSelect($('#model-provider'));
  const [data] = await Promise.all([fetchSnapshot()]);
  if (data?.providers?.length) {
    STATE.providers = data.providers; STATE.models = data.models || []; STATE.detected = data.detected || [];
    STATE.generated_at = data.generated_at; STATE.dayUtc = data.day_utc;
    STATE.demoMode = data.demo_mode === true; STATE.sampleData = !!data.sample_data; STATE.source = 'prototype';
    try {
      const r = await fetch('/api/alerts', { cache: 'no-store' });
      if (r.ok) STATE.serverAlerts = (await r.json()).fired || [];
    } catch {}
  }
  await fetchBuckets();
  renderAll();
}
$$('#side-nav button, .mobile-nav button').forEach((b) => b.addEventListener('click', () => goto(b.dataset.page)));
$$('[data-goto]').forEach((b) => b.addEventListener('click', () => goto(b.dataset.goto)));
$('#heatmap-metric')?.addEventListener('change', async (e) => { STATE.metric = e.target.value; const o = $('#heatmap-metric-2'); if (o) o.value = STATE.metric; await fetchBuckets(); renderHeatmap('#heatmap', STATE.buckets); renderHeatmap('#heatmap-2', STATE.buckets); renderTrend(); });
$('#heatmap-metric-2')?.addEventListener('change', async (e) => { STATE.metric = e.target.value; const o = $('#heatmap-metric'); if (o) o.value = STATE.metric; await fetchBuckets(); renderHeatmap('#heatmap', STATE.buckets); renderHeatmap('#heatmap-2', STATE.buckets); renderTrend(); });
$('#theme-toggle')?.addEventListener('click', () => { STATE.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applySettings(); persistSettings(); });
$('#tray-toggle')?.addEventListener('click', () => { const t = $('#tray-card'); t.hidden = !t.hidden; });
$('#tray-btn')?.addEventListener('click', () => { const t = $('#tray-card'); t.hidden = !t.hidden; });
$('#more-btn')?.addEventListener('click', () => goto('providers'));
$('#share-btn')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.href); $('#share-btn').textContent = 'Copied'; setTimeout(() => $('#share-btn').textContent = 'Share', 1200); } catch {} });
$('#range-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('#range-menu');
  if (!menu) return;
  const wasHidden = menu.hidden;
  closeAllMenus();
  if (wasHidden) openRangeMenu();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-wrap')) closeAllMenus();
});
$('#model-filter')?.addEventListener('input', (e) => { STATE.modelFilter = e.target.value; renderModels(); });
$('#model-provider')?.addEventListener('change', (e) => { STATE.modelProvider = e.target.value; renderModels(); });
$('#alert-add')?.addEventListener('click', () => {
  const label = $('#alert-label')?.value.trim() || 'Untitled rule';
  const target = $('#alert-provider')?.value || STATE.providers[0]?.id;
  const threshold = Number($('#alert-threshold')?.value);
  if (!target || !Number.isFinite(threshold) || threshold <= 0 || threshold > 100) return;
  STATE.rules = [...STATE.rules, { id: String(Date.now()), label, target, threshold }];
  saveJSON('usagehalo.showcase.rules', STATE.rules);
  $('#alert-label').value = ''; $('#alert-threshold').value = '';
  renderAlerts();
});
$('#goto-alerts')?.addEventListener('click', () => goto('alerts'));
$('#goto-budgets')?.addEventListener('click', () => goto('budgets'));
$('#save-settings')?.addEventListener('click', () => persistSettings());
$$('#settings-tabs button').forEach((b) => b.addEventListener('click', () => switchSettingsTab(b.dataset.tab)));
$$('#style-seg button').forEach((b) => b.addEventListener('click', () => { STATE.settings.style = b.dataset.style; applySettings(); }));
$$('#theme-seg button').forEach((b) => b.addEventListener('click', () => { let t = b.dataset.theme; if (t === 'system') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; STATE.settings.theme = t; applySettings(); }));
$$('#placement-seg button').forEach((b) => b.addEventListener('click', () => { STATE.settings.placement = b.dataset.placement; applySettings(); }));
$$('#ring-metric .chip').forEach((b) => b.addEventListener('click', () => { $$('#ring-metric .chip').forEach((x) => x.classList.toggle('active', x === b)); }));
$('#privacy-telemetry')?.addEventListener('click', () => { STATE.settings.telemetry = !STATE.settings.telemetry; applySettings(); });
$('#privacy-analytics')?.addEventListener('click', () => { STATE.settings.analytics = !STATE.settings.analytics; applySettings(); });
$('#data-retention')?.addEventListener('change', (e) => { STATE.settings.retention = e.target.value; });
$('#show-estimated')?.addEventListener('change', (e) => { STATE.settings.showEstimated = e.target.checked; });
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); goto('settings'); $('#settings-search')?.focus(); }
  if (e.key === 'Escape') { hover.hidden = true; $('#tray-card').hidden = true; closeDetail(); closeRangeMenu(); closeAllMenus(); }
});
$('#settings-search')?.addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); $$('#settings-provider-grid .provider-card').forEach((c) => { c.style.display = c.textContent.toLowerCase().includes(q) ? '' : 'none'; }); });

bootstrap();
setInterval(async () => {
  const d = await fetchSnapshot();
  if (d?.providers?.length) {
    STATE.providers = d.providers; STATE.models = d.models || [];
    STATE.dayUtc = d.day_utc; STATE.demoMode = d.demo_mode === true; STATE.sampleData = !!d.sample_data;
    await fetchBuckets(); renderAll();
  }
}, 15000);
