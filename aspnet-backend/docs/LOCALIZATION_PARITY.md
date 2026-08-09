# Historical Frozen-Client Localization Comparator

Last reviewed: 2026-07-14

Status: **Historical archive - frozen React client appendix only**

> This file is not the current ASP.NET backend localization ledger. Use
> [`BACKEND_LOCALIZATION_CONTRACT.md`](BACKEND_LOCALIZATION_CONTRACT.md) for
> request locale negotiation, backend resources, error envelopes, and
> recipient email/notification copy. Use
> [`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md) only
> for the banked backend score.

Evidence provenance: this frozen-client appendix was reviewed on 2026-07-14
against Laravel `903d03d3db78bbf87129ad35728be3b72819acaf` and repository
commit `9c5fb1a46c40e4986c8f973075164b1d74bd101d`. The 2026-07-04 comparator did
not record both input SHAs, so all of its counts are historical and
provenance-incomplete. They cannot support the current backend or Web UK score.

Laravel source of truth: `C:\platforms\htdocs\staging\lang`.

.NET historical React target: `apps/react-frontend/public/locales` — **deleted
2026-08-09**.

That React locale target no longer exists. `compare-laravel-localization-parity.ps1`
still runs but its .NET side now always resolves empty; read that as "no
.NET-side React frontend exists", not as a localization gap. The forward React localization contract is the production Laravel React
frontend at `C:\platforms\htdocs\staging\react-frontend`. Backend localization,
email, validation, and API error-message parity should be implemented in ASP.NET
backend resources or services, not by continuing development in the legacy React
copy unless explicitly approved.

This appendix records a historical comparator between Laravel catalogs and the
frozen React copy. It is not the Web UK localization status, the current
backend ledger, or an overall parity score. Use
[`BACKEND_LOCALIZATION_CONTRACT.md`](BACKEND_LOCALIZATION_CONTRACT.md) for the
backend evidence and
[`../apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`](../apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md)
for Web UK.

## Historical Static Source Counts (2026-07-04)

Generated with `scripts/compare-laravel-localization-parity.ps1` on
2026-07-04. The default key-level pass scans English (`en`) only so the report
stays fast enough to run locally; locale and namespace presence are scanned for
all languages.

| Surface | Laravel | .NET | Matched | Missing from .NET | Extra in .NET |
| --- | ---: | ---: | ---: | ---: | ---: |
| Locales | 11 | 7 | 7 | 4 | 0 |
| Locale namespaces | 605 | 280 | 49 | 556 | 231 |
| English keys in matched namespaces | 17,280 | 5,575 | 157 | 4,942 | 436 |

Missing locale directories: `ar`, `ja`, `nl`, `pl`.

These counts are not a localization parity score. Laravel includes backend,
admin, email, API, and accessible GOV.UK namespaces. The .NET target currently
tracks React i18next JSON namespaces, so namespace aliases and backend/email
translation targets still need explicit product and architecture decisions.

## Generated Artifacts

The repeatable static comparison script writes these ignored artifacts by
default:

```text
artifacts/parity/localization/localization-parity.json
artifacts/parity/localization/localization-parity.md
artifacts/parity/localization/localization-locales.csv
artifacts/parity/localization/localization-namespaces.csv
artifacts/parity/localization/localization-keys.csv
```

Run the fixture test before relying on a regenerated report:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-compare-laravel-localization-parity.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\compare-laravel-localization-parity.ps1
```

To scan additional key locales, pass `-KeyLocales en,de,fr` or another explicit
set. The all-locale key matrix is intentionally not the default because the
Laravel language catalog is large.

## Historical Comparator Gap Families

The following Laravel namespaces are absent for all 11 source locales in the
current static comparison:

| Namespace family | Missing locale namespaces | Parity implication |
| --- | ---: | --- |
| `govuk_alpha_*` accessible namespaces | many gaps in this frozen-React comparison | This 2026-07-04 result is not a current Web UK claim; use the Web UK status and generated locale audits. |
| `super_admin` | 11 | Platform-level administration lacks translated copy coverage. |
| `safeguarding` | 11 | Safeguarding workflows need backend/frontend translation targets. |
| `verein_dues` | 11 | Verein/Clubs membership and dues remain localization gaps. |
| `verein_federation` | 11 | Verein federation workflows remain localization gaps. |
| `svc_notifications*` | 22 combined | Service notification copy needs a .NET target. |
| `caring_community` | broad gap outside React namespace aliases | Caring Community copy is not represented by an equivalent .NET namespace. |

## High-Risk English Key Gaps

Within matched English namespaces, the largest missing key families are:

| Namespace | Missing English keys | Notes |
| --- | ---: | --- |
| `admin` | 3,955 | Admin copy in Laravel greatly exceeds current .NET React admin namespace coverage. |
| `emails` | 515 | Email translation strategy needs a .NET target beyond React public locales. |
| `notifications` | 322 | Notification copy parity is incomplete. |
| `admin_nav` | 115 | Admin navigation labels remain incomplete. |
| `errors` | 17 | User/API error copy should be reconciled carefully. |
| `admin_dashboard` | 15 | Dashboard copy has smaller but concrete gaps. |
| `federation` | 3 | Small matched-namespace key gap; still needs closure. |

## Historical Comparator Closure Criteria

These conditions would close only this frozen-client comparison. They do not
certify ASP.NET request localization, localized API errors, recipient copy, or
unchanged-client backend switching.

- Every Laravel locale is represented in the .NET target or explicitly approved
  as unsupported for product reasons.
- Every Laravel namespace has a .NET target namespace, documented alias, or
  documented non-React destination such as backend email/API resources.
- Matched namespaces have no missing keys for every supported locale.
- Accessible frontend translations are mapped separately from React SPA/admin
  translations.
- Translation checks are rerun after each module batch and before any claim of
  complete parity.
