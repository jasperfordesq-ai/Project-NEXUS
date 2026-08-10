# Accessible Dual-Backend Preparation Design

Status: **Historical checkpoint — superseded design, not current switching evidence**

> This specification records the 2026-07-05 preparation slice. Do not use its
> “candidate” or ASP.NET-path wording to choose current architecture or work.
> Read `../../../apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` and
> `../../CURRENT_ASPNET_CONTRACT_STATUS.md` for the two current workstream
> boundaries.

Last reviewed: 2026-07-05

## Goal

Prepare `apps/web-uk` to become the future shared accessible frontend candidate
while preserving the Express/Nunjucks/GOV.UK Frontend stack and using the
Laravel Blade accessible frontend as the source of truth.

## Source Of Truth

Laravel source paths:

- `C:\platforms\htdocs\staging\accessible-frontend\views\layout.blade.php`
- `C:\platforms\htdocs\staging\accessible-frontend\views\explore.blade.php`
- `C:\platforms\htdocs\staging\accessible-frontend\src\app.scss`
- `C:\platforms\htdocs\staging\routes\govuk-alpha.php`
- `C:\platforms\htdocs\staging\routes\govuk-alpha-parity`
- `C:\platforms\htdocs\staging\lang\en\govuk_alpha.php`

ASP.NET candidate path:

- `C:\platforms\htdocs\asp.net-backend\apps\web-uk`

## Scope

This pass mirrors the Blade accessible shell contract as far as is safe before
ASP.NET backend parity is complete:

- Header labels and utility links.
- Service navigation labels and local route equivalents.
- Footer columns, labels, utility links, sign-out POST form, AGPL attribution,
  and source link.
- Explore page card list and live-content placeholder structure.
- Route matrix documentation for Laravel `govuk-alpha*` routes versus
  `apps/web-uk`.
- Component audit documentation for Blade patterns that can be ported to
  Nunjucks.
- Backend contract notes for future Laravel/ASP.NET switching.
- Smoke-test scaffolding for shell links, documentation, and route matrix
  presence.

## Non-Goals

This pass does not certify `apps/web-uk` for production shared use, change the
React utility-bar accessible link, connect it to the Laravel backend, implement
real dual-backend adapters, or claim ASP.NET accessible route/workflow parity.

## Architecture

The shell contract stays centralized in `apps/web-uk/src/lib/accessible-shell.js`
so Nunjucks views can consume one Blade-derived navigation model. Links use
local Express route equivalents today, with route-contract documentation showing
the Laravel source method/path and the ASP.NET candidate status. Backend
switching remains a documented environment/contract concern until ASP.NET
implements the Laravel-compatible accessible API and workflow behavior.

## Safety Rules

- Do not modify Laravel source files.
- Do not modify the frozen React frontend unless explicitly approved.
- Do not stage unrelated ASP.NET backend parity files.
- Do not use GOV.UK identity, crown, OGL, or Crown copyright wording.
- Do not claim production readiness from skeleton or route-matrix work.
