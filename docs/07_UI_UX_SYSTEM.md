# UI/UX system

## Design direction

The original side-notch reference is the correct interaction primitive: a small vertical collection of circular provider marks with progress rings, expanding on hover.

The product should feel ambient, calm and professional rather than dashboard-heavy.

## Edge rail

Collapsed state:

```text
╭────────╮
│   ◉    │ Claude
│  73%   │
│        │
│   ◉    │ Codex
│  21%   │
│        │
│   ◉    │ Gemini
│  52%   │
│        │
│   ◉    │ Cursor
│  38%   │
│        │
│   +4   │
╰────────╯
```

### Ring semantics

The ring must always represent one configured primary metric for that provider, for example:

- Claude: 5-hour quota used;
- Codex: primary quota window;
- Z.ai: 5-hour credits used;
- OpenRouter: monthly budget used;
- OpenAI API: monthly user budget used.

If no percentage-like quota exists, use a configured budget or a neutral activity indicator. Never convert raw tokens into an arbitrary percentage.

## Hover card

Example:

```text
╭──────────────────────────────────╮
│ Claude                      ● Live│
│                                  │
│ Current window              73%  │
│ ███████████████░░░░              │
│ Resets in 51 min                 │
│                                  │
│ Weekly                       21%  │
│ ████░░░░░░░░░░░░░░              │
│ Reset Thu 00:00                  │
│                                  │
│ Context                      64%  │
│ 128K / 200K                      │
│                                  │
│ Today  1.84M tokens   ~$8.31     │
│                                  │
│ Provider reported · account      │
╰──────────────────────────────────╯
```

Hover card priorities:

1. primary quota and reset;
2. secondary quota;
3. current model/context if live tool;
4. today's tokens/cost;
5. freshness/source/scope.

## Main dashboard

### Overview

- total observed tokens today;
- provider-reported cost and estimated cost kept separate;
- requests;
- active AI time;
- closest upcoming quota risk;
- provider cards.

### Activity

GitHub-style daily heatmap with one selectable measure at a time:

- tokens;
- cost;
- requests;
- active time;
- tool calls.

Do not encode multiple measures simultaneously.

### Models

Table/cards by billing surface and model:

- input;
- output;
- cache read/write;
- reasoning;
- requests;
- cost;
- average tokens/request;
- trend.

### Budgets

- daily/weekly/monthly user-defined budget;
- provider quotas;
- forecast at reset/billing date;
- alerts.

### Providers

- connector health;
- account scopes;
- freshness;
- last successful sync;
- settings.

## Themes

Appearance modes:

- Glass;
- Solid;
- Minimal;
- Monochrome.

Color themes:

- System;
- Light;
- Dark;
- OLED;
- High Contrast.

Recommended semantic palette for dark mode:

```text
--bg:            #090A0C
--surface:       #121418
--surface-2:     #191C22
--text:          #F4F6F8
--muted:         #939AA5
--line:          rgba(255,255,255,.09)
--good:          #48D597
--warning:       #F2B84B
--danger:        #FF5D6C
--info:          #65A8FF
```

Brand logo color and alert state should be separate layers. Do not recolor trademarks to communicate danger.

## Motion

Suggested timings:

- hover feedback: 100–140 ms;
- popover: 140–180 ms;
- rail expand/collapse: 180–240 ms;
- page transition: ~200 ms.

Animate only on state change. No perpetual glowing rings or continuous GPU effects while idle.

Respect:

- reduced motion;
- reduced transparency;
- high contrast;
- screen readers;
- keyboard focus.

## Window behavior

Settings:

- left/right edge;
- top offset;
- auto-hide;
- hover reveal;
- always on top;
- click-through when collapsed (platform permitting);
- scale/compact density;
- monitor selection.

## Empty/error states

Never show `0%` when data is unavailable.

Use:

- `Connect account`;
- `Waiting for first Claude session`;
- `Daily data not published yet`;
- `Auth expired`;
- `Collector stale`.
