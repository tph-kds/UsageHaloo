# Cross-platform behavior

## Principle

Use one telemetry model and design language, but **native platform surfaces**. Do not force identical window behavior across desktop and mobile.

## macOS

Recommended surfaces:

- menu-bar item;
- floating side rail;
- optional notch-aligned placement;
- Notification Center;
- optional launch at login.

Visual style can use vibrancy/transparency more aggressively.

## Windows

Recommended surfaces:

- system tray;
- borderless always-on-top edge rail;
- left/right/top snapping;
- Windows toast notifications;
- startup task.

Do not imitate a hardware notch if none exists; preserve the same rail geometry instead.

## Linux

Recommended surfaces:

- StatusNotifier/tray where desktop environment supports it;
- floating rail;
- notifications through portal/desktop APIs.

### Wayland caveat

Arbitrary global window positioning, input pass-through and always-on-top semantics vary by compositor. Provide graceful fallback:

- regular compact window;
- tray-only mode;
- layer-shell integration only where supported and safe.

## Android

Recommended surfaces:

- home-screen widget;
- persistent/ongoing notification;
- Quick Settings tile;
- optional overlay bubble/rail with explicit overlay permission;
- full dashboard app.

Overlay is opt-in because it is a sensitive permission.

## iPhone / iPad

iOS does not support an arbitrary permanent global overlay over other apps.

Recommended surfaces:

- Home Screen widget;
- Lock Screen widget;
- Live Activity;
- Dynamic Island where the live-activity model makes sense;
- full app.

Do not market a permanent cross-app “notch” overlay on iOS.

## Mobile data source model

Local desktop tool telemetry should synchronize from desktop rather than be re-collected by mobile.

```text
Desktop local usage
       │
       ▼
optional encrypted sync
       │
       ├─ Android
       └─ iOS
```

Account API connectors may operate on either platform if credentials and provider policies permit it.

## Tauri 2 split

Share:

- domain logic;
- provider model;
- HTTP connector code;
- storage abstractions where practical;
- Svelte UI.

Use native Swift/Kotlin modules for:

- iOS widgets/Live Activities;
- Android widget/notification/overlay service;
- platform-specific keychain/keystore details.
