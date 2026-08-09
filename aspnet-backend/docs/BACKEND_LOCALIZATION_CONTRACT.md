# Backend Localization Contract

Last verified: 2026-07-15

Status: **Maintained reference — ASP.NET backend localization ledger, not a score**

This document records what the committed ASP.NET backend actually implements
for localization and what must still be proved before either unchanged client
can switch from Laravel to ASP.NET. It is not a completion score. The canonical
backend score and evidence boundary remain in
[`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md).

## Evidence Boundary

| Evidence | Exact revision |
| --- | --- |
| Laravel behavior baseline | `903d03d3db78bbf87129ad35728be3b72819acaf` |
| ASP.NET committed source inspected | `9ad163c969a935407297eb459a9840798a1a9e78` |
| Inspection date | 2026-07-15 |

The Laravel repository at `C:\platforms\htdocs\staging` was inspected read-only
at the named commit. The ASP.NET findings below were read from blobs at the
named `9ad163c9` revision, not from the working tree. No local database,
production service, or container was used.

The marketplace paid, payout, onboarding-completion, and refund notification
copy described below is committed at this boundary. The inspection uses blobs
at the named `9ad163c9` revision: later local commits, unrelated working-tree
files, and any future uncommitted copy remain excluded from every claim on this
page.

No commit between the earlier `1ded18bd` localization inspection and current
`9ad163c9` changes backend localization catalogs or the localization services
described here. The evidence was therefore revalidated without changing its
deductions; later non-localization contract work remains separately unscored.

Published schema merge `df8c8b96` likewise changes no localization
catalog or localization service. It does not alter this ledger's conclusions or
bank any localization points.

## Laravel Contract To Preserve

Contract correctness means reproducing Laravel's observable result for each
route and workflow, not merely storing a locale code. At the fixed baseline the
shared Laravel API behavior includes:

| Contract area | Laravel baseline behavior |
| --- | --- |
| Supported locale set | `en`, `ga`, `de`, `fr`, `it`, `pt`, `es`, `nl`, `pl`, `ja`, `ar` in `app/Http/Middleware/SetLocale.php` and under `lang/`. |
| API request locale | Resolve in this order: valid `?locale=`, authenticated user's `preferred_language`, best supported `Accept-Language` match, then application default `en`. |
| Response metadata | `Content-Language` is set to the resolved API locale. |
| Catalog lookup | Laravel PHP resources and the JSON `App\I18n\Translator` use the active locale; the JSON translator falls back to English and then the key, and supports both `{{name}}` and `:name` interpolation. |
| Validation and API errors | The v2 framework envelope is `errors: [{ code, message, field? }]`; validation exceptions are normally 422. Exact status, code, field, and message remain endpoint-specific, and translated messages must use the resolved locale where Laravel calls its translation layer. |
| Recipient copy | Email, in-app, push, and background-job copy is rendered inside a temporary recipient locale context where Laravel does so. The prior locale is restored after each recipient. The caller or worker locale must not leak into recipient copy. |
| Accessible session override | Laravel's accessible frontend additionally honors a valid explicit switch, the session locale, and the signed-in member preference through `AlphaSetLocale`. Web UK owns the corresponding frontend contract; see its [current status](../apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md). |

These mechanisms are reference evidence, not permission to generalize. A
backend-switch claim still needs route-by-route comparison at this exact Laravel
SHA because some Laravel messages are intentionally fixed strings and some
statuses differ by endpoint.

## Committed ASP.NET Position

| Area | Committed implementation evidence | Current conclusion |
| --- | --- | --- |
| Tenant-scoped localization storage | [`I18nConfiguration.cs`](../src/Nexus.Api/Data/Configurations/I18nConfiguration.cs), [`SupportedLocale.cs`](../src/Nexus.Api/Entities/SupportedLocale.cs), [`Translation.cs`](../src/Nexus.Api/Entities/Translation.cs), and [`UserLanguagePreference.cs`](../src/Nexus.Api/Entities/UserLanguagePreference.cs) define tenant-filtered tables and unique tenant/locale/key constraints. | **Implemented structurally**, but this is a management store, not proof that runtime API copy uses it. |
| Seeded locale/catalog data | [`I18nSeedData.cs`](../src/Nexus.Api/Data/I18nSeedData.cs) seeds small catalogs for seven locales: `en`, `ga`, `fr`, `es`, `de`, `pl`, and `pt`. | **Partial.** Laravel's `it`, `nl`, `ja`, and `ar` backend catalog coverage is absent from the seed, and key/namespace parity is not established. |
| Translation and locale management APIs | [`TranslationController.cs`](../src/Nexus.Api/Controllers/TranslationController.cs), [`AdminTranslationsController.cs`](../src/Nexus.Api/Controllers/AdminTranslationsController.cs), and the language-config actions in [`AdminCompatibilityController.cs`](../src/Nexus.Api/Controllers/AdminCompatibilityController.cs) expose catalog, locale, preference, stats, and canonical React admin configuration shapes. | **Partial.** The overlapping admin surfaces have not been reconciled into one Laravel-exact lifecycle, validation, approval, and response contract. |
| User preference persistence | [`TranslationService.cs`](../src/Nexus.Api/Services/TranslationService.cs) reads and writes `UserLanguagePreference`, synchronizes `User.PreferredLanguage`, and falls back to tenant default or `en` when reading a user preference. | **Implemented for persistence.** `FallbackLocale` is stored and returned but is not used by translation lookup. Arbitrary non-empty locale values can still reach the preference API. |
| Request locale negotiation | No committed `AddLocalization`, `UseRequestLocalization`, `RequestLocalizationOptions`, `IStringLocalizer`, `Accept-Language`, `Content-Language`, or equivalent request middleware exists in `src/Nexus.Api`. The stored `auto_detect` option is not applied to request processing. | **Missing.** ASP.NET does not implement Laravel's query/user/header/default priority and does not emit the matching response locale. |
| Runtime resource lookup | `TranslationService` returns explicit locale/key rows, but controllers, validation, authorization, and exception middleware do not consume it as a request-scoped localization provider. | **Missing as a platform contract.** Explicit catalog endpoints work; general backend copy remains separate hard-coded strings. |
| Validation/error envelopes | Several focused v2 controllers and middleware emit Laravel-like `errors` arrays, and v2 authorization has a dedicated handler. Other controllers return incompatible `error`, `message`, `code`, `success`, or ASP.NET model-binding shapes. [`ExceptionHandlingMiddleware.cs`](../src/Nexus.Api/Middleware/ExceptionHandlingMiddleware.cs) uses a separate English `error/type/trace_id` envelope. | **Partial and not locale-correct.** Envelope, status, field, and translated-message parity must be certified per consumed endpoint. |
| Email templates | [`EmailTemplateService.cs`](../src/Nexus.Api/Services/EmailTemplateService.cs) provides tenant-scoped, versioned templates and interpolation. [`EmailNotificationService.cs`](../src/Nexus.Api/Services/EmailNotificationService.cs) prefers an active tenant template. | **Partial.** Templates have no locale dimension or recipient-locale resolver. Missing templates fall back to hard-coded English, then to a debug-style key/value email for unsupported keys. |
| In-app and push notifications | [`Notification.cs`](../src/Nexus.Api/Entities/Notification.cs) stores already-rendered `Title` and `Body`; creation sites generally supply fixed strings. Marketplace payment flows are a focused exception described below. | **Uncertified as a platform contract.** There is no shared translation key/parameters/locale record or recipient-locale rendering boundary comparable to Laravel's `LocaleContext`. |
| Marketplace payment notifications | [`MarketplacePaidNotificationCopy.cs`](../src/Nexus.Api/Services/MarketplacePaidNotificationCopy.cs), [`MarketplacePayoutNotificationCopy.cs`](../src/Nexus.Api/Services/MarketplacePayoutNotificationCopy.cs), and the onboarding-completion table in [`MarketplacePaymentService.cs`](../src/Nexus.Api/Services/MarketplacePaymentService.cs) provide recipient-preference lookup with primary-language normalization and English fallback across all 11 Laravel locales. [`MarketplaceRefundNotificationCopy.cs`](../src/Nexus.Api/Services/MarketplaceRefundNotificationCopy.cs) localizes the partial-refund seller path across those locales; full-refund buyer/seller and partial-refund buyer copy remains fixed English. Durable channel evidence suppresses replay for the implemented paid/refund paths. | **Implemented for these named marketplace paths only.** This does not create request locale negotiation, a shared runtime catalog, or a scope-safe recipient locale context for other notification families. |
| Event invitation locale evidence | [`EventRegistrationProductService.Delivery.cs`](../src/Nexus.Api/Services/EventRegistrationProductService.Delivery.cs) carries `recipient_locale`, and [`EventInvitationDeliveryProcessor.cs`](../src/Nexus.Api/Services/EventInvitationDeliveryProcessor.cs) verifies and records that locale across delivery evidence. | **Locale selection/evidence only.** The committed invitation title, message, email CTA, push, in-app, and realtime copy is still rendered in English regardless of the recorded locale. |

## Committed Test Evidence

The following tests prove useful pieces, but they do not certify backend
localization as a whole:

- [`TranslationControllerTests.cs`](../tests/Nexus.Api.Tests/TranslationControllerTests.cs)
  covers basic translation/locale endpoints, preference update, and admin
  authorization, mostly at status-code level.
- [`AdminTranslationsControllerTests.cs`](../tests/Nexus.Api.Tests/AdminTranslationsControllerTests.cs)
  covers authorization plus stats/missing endpoints.
- `AdminCompatibilityControllerTests.LanguageConfig_PersistsSupportedLocalesAndDefault`
  covers persisted language configuration.
- `LaravelReactFrontendContractTests.AdminLanguageConfigV2_AcceptsAndReturnsLaravelReactSupportedLanguagesShape`
  covers the canonical React language-config shape; adjacent tests cover UGC
  translation preferences/configuration and glossary administration.
- `EventRegistrationProductParityTests` proves locale normalization, member
  preference selection over campaign fallback, and persisted recipient-locale
  delivery evidence.
- `MarketplacePaymentServiceTests` proves localized paid buyer/seller email and
  bell delivery, localized Connect-completion notification, English-buyer/
  German-seller partial-refund delivery, durable per-channel evidence, and
  replay suppression for the focused marketplace paths.
- [`VolunteerHoursDecisionEmailTests.cs`](../tests/Nexus.Api.Tests/VolunteerHoursDecisionEmailTests.cs)
  proves tenant-template precedence and the current English fallback behavior.

There is still no committed test containing `Accept-Language` or `Content-Language`,
no request-priority matrix, no multi-locale v2 validation/error comparison, and
no cross-recipient email/in-app/push test proving that two recipients receive
the same event in their respective preferred languages. Those absences are
certification gaps, not presumed behavior.

## Required Certification Queue

Do not award localization or unchanged-client runtime points until all of these
gates are evidenced at one named Laravel/ASP.NET SHA pair:

1. Implement one centralized API locale resolver with Laravel's supported set,
   precedence, normalization, fallback, and `Content-Language` behavior.
2. Define one runtime backend catalog contract covering Laravel's PHP and JSON
   namespaces for all 11 locales. Connect it to controller, validator,
   authorization, exception, job, email, notification, and push copy.
3. Reconcile the overlapping ASP.NET translation/admin APIs and validate locale
   values against the active tenant-supported set without weakening Laravel's
   canonical React response shapes.
4. Normalize every canonical-consumer error path to its exact Laravel status,
   envelope, code, field, and locale-sensitive message. Include malformed JSON,
   model binding, auth, feature/tenant gates, rate limits, not-found, conflict,
   and unhandled exceptions.
5. Add a scope-safe recipient locale context. Render each email, in-app item,
   push, realtime payload, and scheduled fan-out under the recipient preference;
   prove locale restoration between recipients and explicit fallback behavior.
6. Add English, Irish, Arabic/RTL-sentinel, unsupported-locale, tenant-default,
   and two-recipient regression cases. Run the unchanged canonical React and
   unchanged Web UK consumer workflows against ASP.NET by configuration only.
7. Regenerate localization inventories at the same SHAs, record remaining
   endpoint/key deductions, and update
   [`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md)
   without converting catalog counts into a completion percentage.

The old frozen-client catalog comparison remains available only as a historical
appendix in [`LOCALIZATION_PARITY.md`](LOCALIZATION_PARITY.md). Its React JSON
counts cannot certify this backend contract.

## Maintainer Verification

Use committed blobs when refreshing this ledger so dirty work cannot be
accidentally promoted:

```powershell
git rev-parse HEAD
git status --short -- src/Nexus.Api tests/Nexus.Api.Tests
git grep -n -E "AddLocalization|UseRequestLocalization|RequestLocalizationOptions|IStringLocalizer|Accept-Language|Content-Language" HEAD -- src/Nexus.Api tests/Nexus.Api.Tests
```

After implementation, run focused contract tests plus the full backend suite,
then the documentation gates from
[`DOCUMENTATION_GOVERNANCE.md`](DOCUMENTATION_GOVERNANCE.md). Do not run
stateful certification against the ordinary production-derived Laravel database.
