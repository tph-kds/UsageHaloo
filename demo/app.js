// UsageHalo demo/webapp — registry-driven, zero-dependency.
// Matches assets/example-ui 01-06: rail + hover cards, tray, overview,
// providers, models, activity, budgets, alerts, settings (light/dark).
const STATE = { providers: [], models: [], detected: [], generated_at: null, dayUtc: null, sampleData: false, source: 'pending', page: 'overview' };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function hash32(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
function sparkline(seed, w = 90, h = 22, color = '#7c8aff') {
  let pts = []; let v = (seed % 50) + 10;
  for (let i = 0; i < 12; i++) { v += ((seed >> (i % 8)) % 7) - 3; v = Math.max(4, Math.min(96, v)); pts.push(`${(i / 11 * w).toFixed(1)},${(h - (v / 100) * h).toFixed(1)}`); }
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
}
function labelize(m) { return (m || 'usage').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
function healthClass(h) { return h === 'healthy' ? 'live' : (h || 'fresh'); }

// ---- rail ----
function buildBubble(p) {
  const b = document.createElement('button');
  b.className = 'provider-bubble'; b.dataset.provider = p.id;
  b.setAttribute('aria-label', `${p.displayName} ${p.primaryPercent ?? 0}%`);
  const pct = p.primaryPercent == null ? '—' : `${p.primaryPercent}%`;
  const icon = p.icon ? `<img class="ring-icon" src="${esc(p.icon)}" alt="" loading="lazy" />` : `<span class="ring-fallback">${esc(p.monogram)}</span>`;
  b.innerHTML = `<span class="ring" style="--p:${p.primaryPercent ?? 0};--accent:${esc(p.accent)}">${icon}</span><span class="bubble-pct">${pct}</span>`;
  b.querySelector('img')?.addEventListener('error', (e) => { const s = document.createElement('span'); s.className = 'ring-fallback'; s.textContent = p.monogram; e.target.replaceWith(s); });
  return b;
}
function renderRail() {
  const stack = $('#provider-stack'); const more = $('#more-btn');
  stack.innerHTML = '';
  const visible = STATE.providers.slice(0, 6);
  const overflow = Math.max(0, STATE.providers.length - visible.length);
  visible.forEach((p) => {
    const btn = buildBubble(p); stack.appendChild(btn);
    btn.addEventListener('mouseenter', () => showHover(p, btn));
    btn.addEventListener('focus', () => showHover(p, btn));
    btn.addEventListener('mouseleave', scheduleHide); btn.addEventListener('blur', scheduleHide);
    btn.addEventListener('click', () => showHover(p, btn));
  });
  more.textContent = overflow > 0 ? `+${overflow}` : '•••';
  more.onclick = () => goto('providers');
}
const hover = $('#hover-card'); let hideTimer;
hover.addEventListener('mouseenter', () => clearTimeout(hideTimer));
hover.addEventListener('mouseleave', scheduleHide);
function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(() => { hover.hidden = true; }, 160); }
function showHover(p, anchor) {
  clearTimeout(hideTimer);
  const top = STATE.models.find((m) => m.surface === p.displayName);
  const pctLine = p.primaryPercent == null ? 'No observed usage' : `${p.primaryPercent}%${p.live ? '' : ' (sample)'}`;
  hover.innerHTML = `
    <div class="hover-title"><div><div class="provider-name"><img class="mini-logo" src="${esc(p.icon || '')}" alt="" onerror="this.style.display='none'"/>${esc(p.displayName)}</div><div class="provider-sub">${esc(p.vendor || '')}</div></div><span class="live-badge ${esc(p.health || 'fresh')}">${p.live ? '● Live' : esc(p.freshness || '')}</span></div>
    <div class="quota"><div class="quota-top"><span>〜 ${esc(p.primaryLabel)}</span><strong>${pctLine}</strong></div><div class="progress"><span style="width:${Math.min(p.primaryPercent ?? 0, 100)}%;background:${esc(p.accent)}"></span></div></div>
    <div class="quota"><div class="quota-top"><span>◷ Resets in</span><span>${esc(p.primaryReset || 'No reset')}</span></div>
    <div class="quota-top"><span>‹› Today's total</span><span>${esc(p.tokensToday || '—')}</span></div>
    <div class="quota-top"><span>$ Estimated cost</span><span>${esc(p.costToday || '—')}</span></div>
    <div class="quota-top"><span>⬢ Top model</span><span>${esc(top?.model || p.vendor || '—')}</span></div></div>
    <div class="source-line"><span class="dot ${healthClass(p.health)}"></span>Last updated · ${p.live ? 'Just now' : 'Sample'} · ${esc(p.source || '')} · ${esc(p.scope || '')}</div>
    ${STATE.sampleData && !p.live ? '<div class="source-line">Sample data · connect provider for live numbers</div>' : ''}
    ${!STATE.sampleData && !p.live ? '<div class="source-line">No observed usage yet</div>' : ''}`;
  const rect = anchor.getBoundingClientRect();
  const placeRight = document.body.dataset.placement === 'right';
  hover.style.top = `${Math.max(14, Math.min(window.innerHeight - 320, rect.top - 10))}px`;
  hover.hidden = false;
  if (!placeRight) hover.style.left = '114px'; else { hover.style.left = 'auto'; hover.style.right = '114px'; }
}

// ---- tray ----
function renderTray() {
  const el = $('#tray-card');
  const liveCount = STATE.providers.filter((p) => p.live).length;
  const rows = STATE.providers.slice(0, 6).map((p) => `
    <div class="tray-row-item"><span class="mini-logo" style="display:grid;place-items:center;font-weight:800">${esc(p.monogram)}</span>
    <div><strong>${esc(p.displayName)}</strong><div style="color:var(--muted);font-size:10px">${esc(p.vendor || '')}</div><div class="pbar"><span style="width:${p.primaryPercent ?? 0}%;background:${esc(p.accent)}"></span></div></div>
    <span>${p.primaryPercent ?? '—'}${p.primaryPercent == null ? '' : '%'}</span></div>`).join('');
  el.innerHTML = `<div class="tray-head"><span class="brand-mark"></span><div><strong>UsageHalo</strong><div style="color:var(--muted);font-size:11px">${liveCount > 0 ? `${liveCount} live` : (STATE.sampleData ? 'Sample data' : 'No live data yet')}</div></div><span class="live-pill" style="margin-left:auto"><i></i>${liveCount > 0 ? 'Live' : 'Idle'}</span></div>${rows}<div class="tray-foot"><span>◈ Open Dashboard</span><span>⏻ Quit</span></div>`;
}

// ---- overview ----
function totals() {
  let tokens = 0, cost = 0;
  for (const p of STATE.providers) {
    const m = String(p.tokensToday || '').match(/([\d.]+)\s*([KM])/i);
    if (m) tokens += parseFloat(m[1]) * (m[2].toUpperCase() === 'M' ? 1e6 : 1e3);
    const c = String(p.costToday || '').match(/\$([\d.]+)/);
    if (c) cost += parseFloat(c[1]);
  }
  return { tokens, cost };
}
function renderSummaries() {
  const { tokens, cost } = totals();
  const liveCount = STATE.providers.filter((p) => p.live).length;
  const observed = STATE.providers.filter((p) => p.primaryPercent != null).length;
  const cards = [
    { label: 'Observed usage', value: observed ? `${tokens ? (tokens / 1e6).toFixed(2) + 'M' : '—'}` : '—', meta: observed ? `${observed} providers with observed usage` : 'no observed usage yet', color: '#7c8aff' },
    { label: 'Provider cost', value: cost ? `$${cost.toFixed(2)}` : '—', meta: cost ? 'sum of provider-reported costs' : 'no provider-reported costs yet', color: '#b48aff' },
    { label: 'Requests', value: '—', meta: 'device-observed only', color: '#5ec8d8' },
    { label: 'Live providers', value: `${liveCount} / ${STATE.providers.length}`, meta: liveCount ? 'reporting live' : (STATE.sampleData ? 'sample data' : 'no live providers yet'), color: '#48d597' },
  ];
  $('#summary-grid').innerHTML = cards.map((c, i) => `<article class="summary-card"><div class="summary-label">${c.label}</div><div class="summary-value">${c.value}</div><div class="summary-meta">${c.meta}</div>${sparkline(hash32(c.label + STATE.dayUtc), 110, 24, c.color)}</article>`).join('');
  const sub = $('#sys-live-sub'); if (sub) sub.textContent = `${STATE.providers.length} providers · ${STATE.sampleData ? 'Sample' : 'Live'}`;
  const banner = $('#sample-banner');
  if (STATE.sampleData) { banner.hidden = false; banner.textContent = `Sample data · as of ${STATE.dayUtc || 'today'} · source: ${STATE.source} — connect providers for live numbers. Provenance is shown on every card.`; }
  else { banner.hidden = true; }
}
function renderHeatmap(id, metric) {
  const el = $(id); if (!el) return; el.innerHTML = '';
  const liveCount = STATE.providers.filter((p) => p.live).length;
  if (!STATE.sampleData && liveCount === 0) {
    el.innerHTML = '<p class="muted small">No observed activity yet — heatmap appears after live telemetry arrives.</p>';
    return;
  }
  const base = hash32(metric + STATE.dayUtc);
  for (let c = 0; c < 28; c++) for (let r = 0; r < 7; r++) {
    const d = document.createElement('i'); d.className = 'heat-cell';
    const v = (base + c * 31 + r * 17 + (c > 6 && c < 18 ? 40 : 0)) % 100;
    d.dataset.l = v > 78 ? '4' : v > 58 ? '3' : v > 38 ? '2' : v > 20 ? '1' : '0';
    d.title = `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][r]} · level ${d.dataset.l}${STATE.sampleData ? ' (sample pattern)' : ''}`;
    el.appendChild(d);
  }
}
function renderProviderBars() {
  const el = $('#provider-bars'); if (!el) return;
  el.innerHTML = STATE.providers.slice(0, 6).map((p) => `
    <div class="pbar-row"><span>◉ ${esc(p.displayName)}</span><div class="pbar"><span style="width:${p.primaryPercent ?? 0}%;background:${esc(p.accent)}"></span></div><span style="text-align:right">${p.primaryPercent ?? '—'}%</span></div>`).join('');
}
function renderBudgetBars() {
  const el = $('#budget-bars'); if (!el) return;
  if (!STATE.sampleData) { el.innerHTML = '<p class="muted small">No budgets configured.</p>'; return; }
  const vals = [42, 78, 38, 88, 52, 96, 44, 90, 58, 84, 48, 66, 40, 88];
  el.innerHTML = vals.map((v) => `<i style="height:${v}%"></i>`).join('');
}
const DEMO_MODEL_ROWS = [
  ['Claude 3.5 Sonnet', 'Claude', '532,198', '$6.92', '42.9%', '#E37D57'],
  ['GPT-4o', 'OpenRouter', '312,556', '$3.21', '25.6%', '#B998FF'],
  ['Gemini 1.5 Pro', 'Gemini', '241,731', '$1.78', '19.5%', '#5b8cff'],
  ['Code Interpreter', 'Codex', '98,342', '$0.56', '8.7%', '#9aa0aa'],
  ['Sonar Large', 'Perplexity', '45,118', '$0.28', '3.3%', '#47C7C4'],
];
function renderModels() {
  const liveRows = (STATE.models || []).filter((m) => m && m.model);
  const rows = liveRows.length ? liveRows.map((m) => [m.model, m.surface || m.billing_owner, typeof m.tokens === 'number' ? m.tokens.toLocaleString() : String(m.tokens ?? '—'), m.cost || '—', '', '#7c8aff']) : (STATE.sampleData ? DEMO_MODEL_ROWS : []);
  const body = rows.length ? rows.map((r) => `<div class="model-row"><span class="model-name"><i class="model-provider-dot" style="background:${r[5]}"></i>${esc(r[0])}</span><span>${esc(r[1])}</span><span>${esc(r[2])}</span><span>${esc(r[3])}</span><span>${esc(r[4])}${r[4] ? ` <span class="pbar" style="display:inline-block;width:70px;height:5px;border-radius:99px;background:rgba(128,132,144,.2);vertical-align:middle"><span style="display:block;height:100%;width:${r[4]};background:${r[5]};border-radius:inherit"></span></span>` : ''}</span></div>`).join('') : '<p class="muted small">No observed model activity yet. Live instrumented rows appear here when opt-in request instrumentation posts to <code>/api/ingest/event</code>. Billing owner ≠ model vendor is preserved.</p>';
  const html = `<div class="model-row header"><span>Model</span><span>Provider</span><span>Usage</span><span>Cost</span><span>% of Total</span></div>` + body;
  const a = $('#model-table'); if (a) a.innerHTML = html;
  const b = $('#model-table-full'); if (b) b.innerHTML = html + (liveRows.length ? '' : `<p class="muted small">Live instrumented rows appear here when opt-in request instrumentation posts to <code>/api/ingest/event</code>. Billing owner ≠ model vendor is preserved.</p>`);
}
const DEMO_ALERTS = [
  ['✳', 'Claude usage at 73%', '5m ago'], ['✦', 'Gemini usage at 68%', '27m ago'],
  ['⚠', 'Weekly budget at 62%', '1h ago'], ['⬢', 'Codex usage reset in 2d 1h', '3h ago'],
];
function renderAlerts() {
  const hot = STATE.providers.filter((p) => p.primaryPercent != null && p.primaryPercent >= 80).map((p) => ['✳', `${p.displayName} usage at ${p.primaryPercent}%`, p.live ? 'live' : 'sample']);
  const rows = hot.length ? hot : (STATE.sampleData ? DEMO_ALERTS : []);
  const html = rows.length ? rows.map((a) => `<div class="alert-item"><span>${esc(a[0])}</span><span>${esc(a[1])}</span><time>${esc(a[2])}</time></div>`).join('') : '<p class="muted small">No alerts firing. Alerts trigger at 80%+ observed quota.</p>';
  const a = $('#alert-list'); if (a) a.innerHTML = html;
  const b = $('#alert-list-full'); if (b) b.innerHTML = html;
  const c = $('#settings-alerts'); if (c) c.innerHTML = rows.length ? rows.map((a) => `<div class="kv"><span>${esc(a[1])}</span><span style="display:flex;gap:8px;align-items:center"><select><option>Notify me</option><option>Silent</option></select><button class="toggle on"></button></span></div>`).join('') : '<p class="muted small">No alerts firing.</p>';
  const d = $('#settings-budgets'); if (d) d.innerHTML = '<p class="muted small">No budgets configured. Budgets stay separate from provider quotas.</p>';
  const e = $('#settings-sources'); if (e) e.innerHTML = [['Local Cache', 'Active'], [`Provider APIs`, `${STATE.providers.filter((p) => p.live).length} / ${STATE.providers.length} Live`]].map((r) => `<div class="kv"><span>◉ ${r[0]}</span><span>${r[1]} ●</span></div>`).join('') + `<div class="kv"><span>View data source status</span><span>›</span></div>`;
}
function renderProviderPages() {
  const grid = $('#provider-grid');
  if (grid) grid.innerHTML = STATE.providers.slice(0, 8).map((p) => `
    <article class="provider-card"><div class="top"><span class="mini-logo" style="display:grid;place-items:center;font-weight:800">${esc(p.monogram)}</span><div><strong>${esc(p.displayName)}</strong><small>${esc(p.vendor || '')}</small></div><span class="conn" style="margin-left:auto">${p.live ? '● Live' : (p.installed ? 'Detected' : 'Sample')}</span></div>
    <div class="ringline"><div class="mini-ring" style="--p:${p.primaryPercent ?? 0};--accent:${esc(p.accent)}"><b>${p.primaryPercent ?? '–'}%</b></div><div><div style="font-size:11px;color:var(--muted)">${esc(p.primaryLabel)}</div><div style="font-size:12px">${esc(p.tokensToday || '')} · ${esc(p.costToday || '')}</div><div style="font-size:10px;color:var(--muted)">${esc(p.source || '')} · ${esc(p.scope || '')}${p.live ? '' : ' · sample'}</div></div></div></article>`).join('');
  const sp = $('#settings-provider-grid');
  if (sp) sp.innerHTML = STATE.providers.slice(0, 10).map((p) => `
    <article class="provider-card"><div class="top"><span class="mini-logo" style="display:grid;place-items:center;font-weight:800">${esc(p.monogram)}</span><div><strong>${esc(p.displayName)}</strong><br /><span class="conn ${p.live || p.installed ? '' : 'off'}">${p.live ? '● Connected' : (p.installed ? '● Detected' : '○ Sample')}</span></div><button class="toggle ${p.live || p.installed ? 'on' : ''}" style="margin-left:auto" aria-label="enable"></button></div>
    <div class="kv"><span>Primary metric</span><select><option>${esc(p.primaryLabel)}</option><option>Token usage</option><option>Cost (USD)</option></select></div>
    <div class="ringline"><div class="mini-ring" style="--p:${p.primaryPercent ?? 0};--accent:${esc(p.accent)}"><b>${p.primaryPercent ?? '–'}%</b></div><div><div style="font-size:11px;color:var(--muted)">Updated · ${p.live ? 'Just now ●' : 'Sample'}</div><div style="font-size:12px">${esc(p.tokensToday || '—')} · ${esc(p.costToday || '—')}</div></div></div></article>`).join('')
    + `<article class="provider-card" style="display:grid;place-items:center;text-align:center;color:var(--muted)"><div><div style="font-size:24px">+</div><strong>Add Provider</strong><div style="font-size:11px">Connect a new AI provider</div></div></article>`;
  const hl = $('#health-list');
  if (hl) hl.innerHTML = STATE.providers.slice(0, 6).map((p) => `<div class="health-item"><div><strong>${esc(p.displayName)}</strong><span>${esc(p.source || '')} · ${esc(p.freshness || '')}</span></div><span>● ${esc(p.health || 'fresh')}</span></div>`).join('');
  const bc = $('#budget-cards');
  if (bc) bc.innerHTML = STATE.sampleData ? [['Total budget', '$12.47 / $20.00', 62, 'Monthly (sample)'], ['Claude', '$6.92 / $10.00', 69, 'Subscription quota (sample)'], ['OpenRouter', '$3.21 / $5.00', 64, 'Credits (sample)']].map((r) => `<article class="panel"><div class="eyebrow">${r[3]}</div><h2>${r[0]}</h2><div class="budget-top"><strong>${r[1]}</strong><span>${r[2]}%</span></div><div class="progress xl"><span style="width:${r[2]}%"></span></div></article>`).join('') : '<article class="panel"><div class="eyebrow">Budgets</div><h2>No budgets configured</h2><p class="muted small">Budgets stay separate from provider quotas.</p></article>';
}

// ---- navigation / theme ----
const TITLES = { overview: ['Overview', 'Real-time usage across all your AI providers.'], providers: ['Providers', 'Connector health, account scopes, freshness and settings.'], models: ['Models', 'Usage by billing surface and model — vendor ≠ billing owner.'], activity: ['Activity', 'One measure at a time: tokens, cost, requests.'], budgets: ['Budgets', 'Daily, weekly and monthly limits with forecasts.'], alerts: ['Alerts', 'Quota risks and budget warnings.'], settings: ['Settings', 'Configure UsageHalo to monitor and manage your AI usage.'] };
function goto(page) {
  STATE.page = page;
  $$('#side-nav button, .mobile-nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== page; });
  $('#page-title').textContent = TITLES[page][0];
  $('#page-sub').textContent = TITLES[page][1];
  $('#hover-card').hidden = true;
}
function renderAll() { renderRail(); renderTray(); renderSummaries(); renderHeatmap('#heatmap', $('#heatmap-metric')?.value || 'tokens'); renderHeatmap('#heatmap-2', $('#heatmap-metric-2')?.value || 'tokens'); renderProviderBars(); renderBudgetBars(); renderModels(); renderAlerts(); renderProviderPages(); }

async function fetchSnapshot() {
  try { const r = await fetch('/api/snapshot', { cache: 'no-store' }); if (!r.ok) throw 0; return await r.json(); }
  catch { return null; }
}
async function bootstrap() {
  const data = await fetchSnapshot();
  if (data?.providers?.length) {
    STATE.providers = data.providers; STATE.models = data.models || []; STATE.detected = data.detected || [];
    STATE.generated_at = data.generated_at; STATE.dayUtc = data.day_utc; STATE.sampleData = !!data.sample_data; STATE.source = 'prototype';
  }
  renderAll();
}
$$('#side-nav button, .mobile-nav button').forEach((b) => b.addEventListener('click', () => goto(b.dataset.page)));
$$('[data-goto]').forEach((b) => b.addEventListener('click', () => goto(b.dataset.goto)));
$('#heatmap-metric')?.addEventListener('change', (e) => renderHeatmap('#heatmap', e.target.value));
$('#heatmap-metric-2')?.addEventListener('change', (e) => renderHeatmap('#heatmap-2', e.target.value));
$('#theme-toggle')?.addEventListener('click', () => { const h = document.documentElement; h.dataset.theme = h.dataset.theme === 'dark' ? 'light' : 'dark'; $$('#theme-seg button').forEach((b) => b.classList.toggle('active', b.dataset.theme === h.dataset.theme)); });
$('#tray-toggle')?.addEventListener('click', () => { const t = $('#tray-card'); t.hidden = !t.hidden; });
$('#tray-btn')?.addEventListener('click', () => { const t = $('#tray-card'); t.hidden = !t.hidden; });
$('#more-btn')?.addEventListener('click', () => goto('providers'));
$('#share-btn')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.href); $('#share-btn').textContent = 'Copied'; setTimeout(() => $('#share-btn').textContent = 'Share', 1200); } catch {} });
$$('#style-seg button').forEach((b) => b.addEventListener('click', () => { document.documentElement.dataset.style = b.dataset.style === 'mono' ? 'mono' : b.dataset.style; $$('#style-seg button').forEach((x) => x.classList.toggle('active', x === b)); }));
$$('#theme-seg button').forEach((b) => b.addEventListener('click', () => { let t = b.dataset.theme; if (t === 'system') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; document.documentElement.dataset.theme = t; $$('#theme-seg button').forEach((x) => x.classList.toggle('active', x === b)); }));
$$('#placement-seg button').forEach((b) => b.addEventListener('click', () => { document.body.dataset.placement = b.dataset.placement; $$('#placement-seg button').forEach((x) => x.classList.toggle('active', x === b)); }));
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); goto('settings'); $('#settings-search')?.focus(); } if (e.key === 'Escape') { hover.hidden = true; $('#tray-card').hidden = true; } });
$('#settings-search')?.addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); $$('#settings-provider-grid .provider-card').forEach((c) => { c.style.display = c.textContent.toLowerCase().includes(q) ? '' : 'none'; }); });

bootstrap();
setInterval(async () => { const d = await fetchSnapshot(); if (d?.providers?.length) { STATE.providers = d.providers; STATE.models = d.models || []; STATE.dayUtc = d.day_utc; STATE.sampleData = !!d.sample_data; renderAll(); } }, 15000);
