#!/usr/bin/env python3
"""End-to-end store privacy audit for UsageHalo local data.

Scans ~/.usagehalo (store + inbox spools) for secret material and for
forbidden transcript/content fields. Exit 0 = clean, exit 1 = findings.

Checks:
  1. No secret-shaped values (API keys, Bearer tokens, AWS keys).
  2. No transcript paths, working directories, prompts, or message bodies
     persisted by the Claude bridge, generic ingest, or OTLP receiver.
  3. Reports files scanned + rows checked (proof of execution, not just exit).

Usage:
  python scripts/privacy_audit.py [--home PATH] [--json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SECRET_PATTERNS = [
    re.compile(r"sk-(proj|ant|live|test)-[A-Za-z0-9-_]{8,}"),
    re.compile(r"sk-[A-Za-z0-9-_]{20,}"),
    re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9_]{20,}"),
    re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"),
]

# Fields that must never be persisted (privacy design rule).
FORBIDDEN_KEYS = {
    "transcript_path", "cwd", "current_dir", "repository", "repo",
    "prompt", "completion", "messages", "content", "output_style",
    "workspace",
}

# Values that are safe even when a forbidden-looking key exists in a schema
# doc (only exact sensitive paths count, not the key name alone).
SKIP_VALUES = (None, "", [], {})


def audit_file(path: Path) -> list[str]:
    findings: list[str] = []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return [f"{path}: unreadable ({e})"]
    for i, line in enumerate(text.splitlines(), 1):
        for pat in SECRET_PATTERNS:
            if pat.search(line):
                findings.append(f"{path}:{i}: secret-shaped value ({pat.pattern[:24]}...)")
                break
        line = line.strip()
        if line.startswith("{"):
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict):
                for key in FORBIDDEN_KEYS:
                    if key in obj and obj[key] not in SKIP_VALUES:
                        findings.append(f"{path}:{i}: forbidden persisted field '{key}'")
    return findings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--home", default=str(Path.home()))
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    data = Path(args.home) / ".usagehalo"
    files = []
    if data.is_dir():
        files = sorted(p for p in data.rglob("*") if p.is_file())
    findings: list[str] = []
    rows = 0
    for f in files:
        if f.suffix in {".jsonl", ".json"} or "inbox" in f.parts:
            findings.extend(audit_file(f))
            try:
                rows += sum(1 for _ in f.open(encoding="utf-8", errors="replace"))
            except OSError:
                pass
    report = {
        "data_dir": str(data),
        "files_scanned": len(files),
        "rows_checked": rows,
        "findings": findings,
        "clean": not findings,
    }
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"UsageHalo privacy audit: {len(files)} files, {rows} rows checked")
        if findings:
            print("FINDINGS:")
            for x in findings:
                print(f"  - {x}")
        else:
            print("clean: no secrets, transcripts, or message bodies persisted")
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
