# API Reference

Last reviewed: 2026-07-30

This page renders the published Project NEXUS API contract as an interactive, browsable reference (powered by [Redoc](https://github.com/Redocly/redoc)) directly from the canonical [`openapi.json`](../openapi.json) contract.

> **Scope:** this is the *published contract*, not the complete route surface. `openapi.json` documents 843 paths / 1,065 operations, against roughly 2,600 route registrations in `routes/api.php`. Notably absent are the external federation protocol families — Komunitin (`/api/v2/federation/komunitin/*`), Credit Commons (`/api/v2/federation/cc/*`), legacy v1 federation (`/api/v1/federation/*`) and the Partner API (`/api/partner/v1/*`) — all of which are built but switched off by default and answer `503` until an operator enables the relevant kill switch. `routes/api.php` and the controllers under `app/Http/Controllers/Api/` remain authoritative for runtime behaviour; see [FEDERATION_API_MANUAL.md](FEDERATION_API_MANUAL.md) for federation semantics.

> The interactive reference below renders on the **documentation site**. On GitHub, see [API.md](API.md) for the getting-started guide and the raw [`openapi.json`](../openapi.json) contract, or render it locally with `npx @redocly/cli preview-docs openapi.json`.

<div id="redoc-container">
  <redoc spec-url="../openapi.json" hide-download-button="false"></redoc>
</div>
<script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
