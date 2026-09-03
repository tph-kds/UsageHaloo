#!/usr/bin/env python3
"""Generate the UsageHalo desktop icon set from the brand halo motif.

Concentric ring (indigo -> violet -> mint) on a near-black rounded square,
matching the `.brand-mark` CSS in demo/styles.css. Output targets the files
referenced by apps/desktop-ui/src-tauri/tauri.conf.json `bundle.icon` and
`trayIcon.iconPath`.

Usage: python scripts/generate_icons.py
Requires: Pillow
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps" / "desktop-ui" / "src-tauri" / "icons"

# Brand stops sampled around the ring (CSS: #8ab4ff -> #c49aff -> #7be3c3).
STOPS = ((138, 180, 255), (196, 154, 255), (123, 227, 195), (138, 180, 255))


def lerp(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def ring_color(theta: float) -> tuple[int, int, int]:
    pos = (theta / (2 * math.pi)) % 1.0 * (len(STOPS) - 1)
    i = int(pos)
    return lerp(STOPS[i], STOPS[i + 1], pos - i)


def render(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (9, 10, 12, 255))
    d = ImageDraw.Draw(img)
    radius = size * 0.375
    cx = cy = size / 2
    width = max(1, int(size * 0.075))
    # Draw the ring as small arc segments so the conic gradient shows.
    steps = max(64, size)
    for i in range(steps):
        a0 = 360 * i / steps
        a1 = 360 * (i + 1) / steps + 0.5
        d.arc(
            [cx - radius, cy - radius, cx + radius, cy + radius],
            start=a0 - 90,
            end=a1 - 90,
            fill=ring_color(2 * math.pi * i / steps) + (255,),
            width=width,
        )
    # Inner dot echoes the rail's live indicator.
    r = size * 0.075
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(244, 246, 248, 255))
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    render(32).save(OUT / "32x32.png")
    render(128).save(OUT / "128x128.png")
    render(256).save(OUT / "128x128@2x.png")
    base = render(256)
    base.save(OUT / "icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
    base.save(OUT / "icon.icns")
    print("icons written:", sorted(p.name for p in OUT.iterdir()))


if __name__ == "__main__":
    main()
