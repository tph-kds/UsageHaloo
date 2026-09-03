"""Cross-language parity: JS collectors vs Rust crates must agree.

- Forecast: shared fixtures/forecast-vectors.json through collectors/forecast.mjs.
- Reconcile: shared fixtures/reconcile-vectors.json through collectors/reconcile.mjs.
- Scheduler: nominal/max cadence table parsed from the Rust source must equal
  the JS CONNECTOR_SCHEDULE (drift guard).
"""
from __future__ import annotations
import json, re, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def _node(script):
    p = subprocess.run(["node", "--input-type=module", "-e", script],
                       cwd=str(ROOT), capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout.strip().splitlines()[-1])

def test_forecast_parity_with_rust_vectors():
    d = _node("""
import { readFileSync } from "node:fs";
import { ewma, forecastQuota, forecastSpend } from "./collectors/forecast.mjs";
const v = JSON.parse(readFileSync("./fixtures/forecast-vectors.json", "utf8"));
const burn = ewma(v.ewma_series, v.ewma_alpha);
const q = forecastQuota({ usedPercent: v.quota.used_percent,
  resetsAtIso: new Date(Date.now() + v.quota.hours_left * 3600e3).toISOString(),
  recentBurnPerHour: v.quota.recent_burn_per_hour, minSamples: v.quota.min_samples });
const qs = forecastQuota({ usedPercent: v.quota_suppressed_few_samples.used_percent,
  resetsAtIso: new Date(Date.now() + 3600e3).toISOString(),
  recentBurnPerHour: v.quota_suppressed_few_samples.recent_burn_per_hour, minSamples: 3 });
const s = forecastSpend(v.spend.daily_costs, v.spend.days_in_month, 15);
console.log(JSON.stringify({ burn, q, qs_sup: qs.suppressed, s }));
""")
    vec = json.loads((ROOT / "fixtures/forecast-vectors.json").read_text())
    assert abs(d["burn"] - vec["ewma_expected"]) < 1e-9
    assert abs(d["q"]["projected_at_reset"] - vec["quota"]["expected_projected_at_reset"]) < 0.05
    assert d["q"]["label"].startswith("Projected")
    assert d["qs_sup"] is True
    assert d["s"]["suppressed"] is False
    assert abs(d["s"]["daily_avg"] - 2.34) < 0.005

def test_reconcile_parity_with_rust_vectors():
    d = _node("""
import { readFileSync } from "node:fs";
import { reconcileEvents } from "./collectors/reconcile.mjs";
const doc = JSON.parse(readFileSync("./fixtures/reconcile-vectors.json", "utf8"));
const out = doc.cases.map(c => {
  const evs = c.events.map(e => ({ provider: 'openrouter', billing_owner: 'openrouter',
    model: 'm', request_id: e.key ? e.key.split(':')[1] : null,
    reconciliation_key: e.key, input_tokens: e.input_tokens, output_tokens: e.output_tokens,
    provider_cost: e.provider_cost, estimated_cost: e.estimated_cost,
    authority: e.authority, observed_at: '2026-09-03T00:00:00Z' }));
  const r = reconcileEvents(evs);
  return { name: c.name, count: r.length, cost: r[0]?.provider_cost ?? null,
           input: r[0]?.input_tokens ?? null };
});
console.log(JSON.stringify(out));
""")
    by_name = {r["name"]: r for r in d}
    assert by_name["billing_wins_without_losing_local_token_detail"]["count"] == 1
    assert by_name["billing_wins_without_losing_local_token_detail"]["cost"] == 0.0198
    assert by_name["billing_wins_without_losing_local_token_detail"]["input"] == 5000
    assert by_name["unkeyed_events_are_never_merged"]["count"] == 2

def _rust_schedule():
    src = (ROOT / "crates/usage-halo-scheduler/src/lib.rs").read_text()
    # Arms look like:  "codex" => (RefreshMode::Event, None, 3600, "..."),
    pat = re.compile(r'"([\w-]+)"\s*=>\s*\(\s*RefreshMode::(\w+),\s*(None|Some\((\d+)\)),\s*([\d\s\*]+),', re.M)
    table = {}
    for m in pat.finditer(src):
        cid, mode, _, nominal, maxexpr = m.groups()
        nominal_s = int(nominal) if nominal else None
        max_s = eval(maxexpr, {"__builtins__": {}})  # ints and * only
        table[cid] = {"mode": mode.lower().replace("pollmix", "poll_mix"), "nominal": nominal_s, "max": max_s}
    return table

def test_scheduler_parity_rust_vs_js():
    rust = _rust_schedule()
    assert len(rust) >= 12, f"parsed only {sorted(rust)}"
    js = _node("""
import { CONNECTOR_SCHEDULE } from "./collectors/scheduler.mjs";
console.log(JSON.stringify(CONNECTOR_SCHEDULE));
""")
    mode_map = {"event": "event", "poll": "poll", "pollmix": "poll_mix", "poll_mix": "poll_mix"}
    for cid, r in rust.items():
        assert cid in js, f"{cid} missing from JS schedule"
        j = js[cid]
        assert mode_map[r["mode"]] == j["mode"], cid
        assert r["nominal"] == j["nominal_seconds"], cid
        assert r["max"] == j["max_healthy_age_seconds"], cid
    # Spot-check the honesty cap both sides document.
    assert "github-copilot" in rust and rust["github-copilot"]["nominal"] == 86400
