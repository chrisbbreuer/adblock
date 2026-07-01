---
title: Blocking Model
description: How Very Good AdBlock combines performant DNR rules, dynamic rules, and content scripts.
---

# Blocking Model

Very Good AdBlock uses a balanced, performance-conscious Manifest V3 architecture:

- Static `declarativeNetRequest` rules for known network ad domains and URL patterns.
- Dynamic `declarativeNetRequest` rules for user site overrides.
- Content scripts for cosmetic filtering, YouTube skip automation, and Twitch video-ad marker detection.
- Chrome storage for settings, stats, and cross-install sync.

## Static Rules

Static rules are generated at build time from pinned filter sources and curated seeds. They are shipped with the extension and loaded by Chrome through the MV3 ruleset manifest.

## Dynamic Rules

Dynamic rules are derived from settings:

- Allowed sites receive allow rules.
- Manually blocked sites receive block rules.
- Rules are bounded to the configured dynamic ID range.

## Content Scripts

Content scripts handle the placements network rules cannot reach:

- Cosmetic filtering hides first-party ad placements (YouTube feed/masthead/display ads, Twitch display banners, X promoted entries) via an injected stylesheet.
- YouTube skip buttons that are visible and actionable.
- Twitch video-ad markers used to estimate saved time.
- Throttled mutation scans that tag hidden placements and catch late-loading video controls and markers.

The goal is to remove interruptions immediately without brittle page-breaking media hacks. Cosmetic hiding is site-specific, ships with global and per-site kill switches, and never touches the player region or real content. See [Cosmetic Filtering](/architecture/cosmetic-filtering).
