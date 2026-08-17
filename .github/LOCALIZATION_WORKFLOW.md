# Localization Workflow

CI's `i18n-drift` job ("Translation Drift Detection" in `.github/workflows/ci.yml`) runs ten
BLOCKING i18n checks plus several WARNING/INFO ones. These are the five you normally run by
hand — the first three cover the React JSON locales, the last two cover the PHP `lang/` files:

1. Structural safety (BLOCKING)
   Run `node scripts/check-i18n-drift.mjs`
   Purpose: every locale file must match English key structure.

2. Content completeness (INFO in CI)
   Run `node scripts/translate-i18n-gaps.mjs --summary` (alias `npm run check:i18n:gaps`)
   Purpose: find strings that are still missing or still identical to English, outside the
   namespaces the script skips (`admin_nav.json`, `admin_dashboard.json`, `super_admin.json`,
   `api_controllers_1/2/3.json` and the `*.php` entries — see its `SKIP_NAMESPACES`).

3. Regression guard (WARNING in CI)
   Run `node scripts/check-i18n-gap-regression.mjs` (alias `npm run check:i18n:baseline`)
   Purpose: fail fast if the non-admin untranslated / English-fallback debt gets worse than the committed baseline.

4. PHP `lang/` key parity (BLOCKING)
   Run `node scripts/check-php-lang-parity.mjs`
   Purpose: every `lang/<locale>/*.php` file must carry the same key set as `lang/en`. It compares
   KEY SETS only — it cannot see a value that is still English.

5. PHP `lang/` untranslated ratchet (BLOCKING)
   Run `node scripts/check-php-lang-untranslated.mjs`
   Purpose: shrink-only ceiling on `lang/` values that are byte-identical to English. The committed
   ceiling lives in `.github/php-lang-untranslated-baseline.json` (currently 249) and may only go
   down; regenerate it with `--write-baseline`, never by hand.

The remaining blocking checks in that job are `check-i18n-literals.mjs`, `scripts/check-i18n.sh`
(hardcoded PHP strings), `check-admin-i18n-token-integrity.mjs`, `check-admin-ui-literals.mjs`,
`check-admin-i18n.mjs`, `check-i18n-stubs.mjs`, and `check-i18n-vars.mjs`.

**`translate-i18n-gaps.mjs` cannot fill `lang/*.php`** — it is scoped to
`react-frontend/public/locales` and reads only `*.json`. The PHP path is the separate
`node scripts/translate-php-lang-gaps.mjs --google --namespace <file>`.

## Ownership

- Locale files under `react-frontend/public/locales/` require CODEOWNERS review.
- Translation workflow scripts and runtime config also require CODEOWNERS review.
- Pull requests that change non-English locale files must declare `Translation Status:` and `Translation Reviewer:` in the PR description.

## Review States

Use these states mentally when reviewing locale work:

- `source-complete`
  English source keys exist and structural drift is zero.
- `machine-filled`
  Missing strings were backfilled automatically but still need language review.
- `reviewed`
  A speaker or product owner has checked the locale content.
- `approved`
  Locale content is reviewed and explicitly cleared for merge.

## Normal Workflow

1. Add or update English source strings first.
2. Run `node scripts/check-i18n-drift.mjs` and confirm structural drift stays at zero.
3. Run `node scripts/translate-i18n-gaps.mjs --summary` to see English fallback debt.
4. Run `node scripts/check-i18n-gap-regression.mjs` and confirm the baseline does not regress.
5. If translation credentials are available, run `node scripts/translate-i18n-gaps.mjs`.
6. If the change touched `lang/en/*.php`, run `node scripts/check-php-lang-parity.mjs` and
   `node scripts/check-php-lang-untranslated.mjs`. The Google-backed PHP helper
   may fill supported non-Irish locales; author and review `lang/ga` directly.
7. Add `Translation Status:` and `Translation Reviewer:` to the PR description before merge.
8. Review the changed locale files before merge.

## Notes

- Admin namespaces are translated content and are drift-gated like every other namespace — there is
  no "admin is English-only" policy (that was voided on 2026-06-06). But policy and tooling differ:
  `translate-i18n-gaps.mjs` deliberately skips `admin_nav.json`, `admin_dashboard.json` and
  `super_admin.json` (plus `api_controllers_1/2/3.json` and the `*.php` entries) via its
  `SKIP_NAMESPACES` set, and `check-i18n-gap-regression.mjs` additionally skips `admin.json`. Only
  `admin.json` is filled by `translate-i18n-gaps.mjs`; new keys in the other three must be filled
  another way rather than by re-running that script.
- **Never use Google Translate for Irish.** `translate-i18n-gaps.mjs` allows
  `ga` only through its OpenAI path, and that output remains a draft until it
  has been context-reviewed and rewritten as natural Irish.
  `translate-php-lang-gaps.mjs` is Google-only, so it always skips `ga`; author
  and review PHP Irish directly. If no reviewer is available, report the gap
  rather than presenting machine Irish as complete.

## Acceptable residual English

When a gap report flags an admin-namespace value that is identical to English, do not treat it as a missing translation if it falls into one of these categories — they are expected, review-safe residues, not blockers:

- **Format placeholders and units** — e.g. `{{value}} ms`, `{{count}}h`, `{{value}}/min`, `#{{id}}`.
- **Sample data** — example emails, phone numbers, postal codes, placeholder domains.
- **Punctuation and symbols** — em dashes, `#`, infinity signs, suffix punctuation.
- **Proper nouns and technical identifiers** — Project NEXUS, OpenAI, Redis, Docker, cPanel, OAuth, GDPR, FADP, JSON/API labels, social-network names, currency labels, protocol names, and civic terms such as Age-Stiftung, Spitex, Vereine, Kanton, Gemeinden.
- **Accepted same-spelling or loanword terms** in the target language (especially German, French, Dutch, Polish) — e.g. Status, Blog, Admin, Partner, Dashboard, Action, Date, Agent, Module, Contact, Plan, Type, Marketing, Webhook, Cache.

Only treat an exact-English match as a blocker when it is user-facing prose or a label not covered above.
