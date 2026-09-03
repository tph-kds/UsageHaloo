"""End-to-end store privacy: sanitization at rest + audit behavior."""
from __future__ import annotations
import json, os, socket, subprocess, tempfile, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def _http(url, method="GET", body=None, ctype=None, timeout=5.0):
    req = urllib.request.Request(url, data=body, method=method)
    if ctype: req.add_header("content-type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.getcode(), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def _boot_server(home, extra_env=None):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    env = {**os.environ, "USERPROFILE": home, "VIUSAGEVER_PORT": str(port), **(extra_env or {})}
    proc = subprocess.Popen(["node", str(ROOT / "prototype" / "server.mjs")], cwd=str(ROOT),
                             env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 6
    while time.time() < deadline:
        try:
            code, _ = _http(f"{base}/api/health", timeout=1.0)
            if code == 200: break
        except Exception: pass
        time.sleep(0.1)
    return proc, base

def test_claude_ingest_persists_no_transcript_or_cwd():
    with tempfile.TemporaryDirectory() as home:
        proc, base = _boot_server(home)
        try:
            raw = json.loads((ROOT / "fixtures" / "claude-statusline.json").read_text())
            assert "transcript_path" in raw  # fixture really contains secrets-adjacent fields
            code, _ = _http(f"{base}/api/ingest/claude", method="POST",
                            body=json.dumps(raw).encode(), ctype="application/json")
            assert code == 202
            spool = Path(home) / ".usagehalo" / "inbox" / "claude-code.jsonl"
            assert spool.exists()
            stored = json.loads(spool.read_text().strip().splitlines()[-1])
            for forbidden in ("transcript_path", "cwd", "workspace"):
                assert forbidden not in stored, f"persisted {forbidden}"
            assert stored["rate_limits"]["five_hour"]["used_percentage"] == 73
        finally:
            proc.terminate()
            try: proc.wait(timeout=3)
            except Exception: proc.kill()

def test_audit_clean_on_telemetry_and_flags_seeded_secret():
    with tempfile.TemporaryDirectory() as home:
        data = Path(home) / ".usagehalo" / "inbox"
        data.mkdir(parents=True)
        (data / "generic.jsonl").write_text(json.dumps({
            "observed_at": "2026-09-03T00:00:00Z", "provider": "deepseek",
            "model": "m", "input_tokens": 10, "output_tokens": 5}) + "\n")
        r = subprocess.run(["python", str(ROOT / "scripts" / "privacy_audit.py"),
                            "--home", home, "--json"], capture_output=True, text=True)
        assert r.returncode == 0, r.stdout
        assert json.loads(r.stdout)["clean"] is True
        # Seed a leaked key: audit must flag it.
        with (data / "generic.jsonl").open("a") as f:
            f.write(json.dumps({"provider": "x", "key": "sk-ant-oat1234567890abcdef"}) + "\n")
        r = subprocess.run(["python", str(ROOT / "scripts" / "privacy_audit.py"),
                            "--home", home, "--json"], capture_output=True, text=True)
        assert r.returncode == 1
        report = json.loads(r.stdout)
        assert report["clean"] is False and len(report["findings"]) == 1
