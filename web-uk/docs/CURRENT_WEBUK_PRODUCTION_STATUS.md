# Current Web UK Production Status (Goal W2)

Last reviewed: 2026-08-11

Status: **Canonical current — sole Web UK scoring source**

<!-- doc-consistency: WEBUK_W2_CURRENT_SCORE=592/1000 -->
<!-- doc-consistency: WEBUK_W2_RUBRIC=WEBUK-W2-PROD-R1 -->
<!-- doc-consistency: WEBUK_W2_ARTEFACT_TREE=dirty-disclosed -->

This is the current scoring document for `web-uk`. It replaced
[`CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`](CURRENT_LARAVEL_FIRST_PARITY_STATUS.md)
on 2026-08-11, which is retired and kept as the W1 audit trail.

The question this rubric answers is **"is `web-uk` safe to serve as the
production accessible frontend, and can Blade be retired?"** — not W1's question,
which was "how closely does this candidate clone Blade?".

`scripts/check-doc-scores.mjs` enforces the structure of this page in CI. The
generated artefacts are the truth and this document follows them; if a count here
disagrees with `docs/generated/`, regenerate and correct **this page**, never the
artefact.

## 🔴 The percentage went DOWN and nothing got worse

W1 banked `663/1000` (66.3%). W2 stands at `592/1000` (59.2%).

**No implementation regressed.** 150 points of production
deployment/cutover/rollback and 50 points of Blade retirement enter the
denominator for the first time and start near zero, because that work has not
been built yet. Three previously-audited rows actually improved. Read the mapping
table below before quoting either number; do not convert one into the other, and
do not describe either as "about finished".

## Rubric `WEBUK-W2-PROD-R1`

| Row | Earned | Maximum | Exact deduction |
|---|---:|---:|---|
| Route and URL-shape parity | 90 | 100 | -10: the slug-less custom-domain shape is proven only against mocked tests. Node's `fetch` has not been shown to transmit a custom `Host` header to Laravel on a real server, and every custom-domain tenant resolution depends on it; no routing-drift check exists yet to catch a vhost that keeps serving Blade at HTTP 200. |
| Observable Blade behaviour | 235 | 250 | -8: Event moderation queue membership/order and `is_online` remain upstream Laravel contract boundaries. -7: `web-uk` deliberately withholds Blade's public keyboard/screen-reader assurance copy, because the manual package below has not established it — a knowing observable deviation pending the copy-parity decision. |
| Localisation | 45 | 50 | -5: 1,443 of 90,700 values across the ten non-English locales are byte-identical to English (1.6%). Structure and usage are clean. |
| API contract and static/mock verification | 142 | 150 | -8: exhaustive field-shape, publication, auth/role, status/error and side-effect assertions are still not complete for every significant contract. Ownership and direct-assertion coverage are complete. |
| Live Laravel runtime certification | 0 | 150 | -150: no separately provisioned disposable Laravel application/database/storage environment exists, so live mutation, upload, download and destructive certification is entirely open. Deliberately out of scope until authorised; it is scored because production readiness cannot honestly exclude it. |
| Manual WCAG 2.2 AA certification | 60 | 150 | -30: no screen-reader speech-output sign-off; this needs a human running NVDA, JAWS or VoiceOver. -25: no representative screenshot comparison set. -20: keyboard activation of submit buttons is unproven — the harness delivers `Enter` with `keyCode: 0`, so Chromium runs no implicit form submission. -15: operating-system forced-colours/high-contrast not manually exercised. |
| Production deployment, cutover and rollback | 20 | 100 | -80: no service in `compose.bluegreen.yml`, no vhost include, absent from the deploy watchdog's `DEPLOY_PATHS`, no `/version` endpoint to prove a colour switch, and no rehearsed cutover or rollback. Four owner prerequisites are open (VM spare memory, free ports, a Sentry project, and the missing `.claude/production-containers.md`). Credit given only for image-level hardening that genuinely exists and was audited under W1. |
| Blade retirement without regression | 0 | 50 | -50: not started. It was unblockable until 2026-08-11, when the 707th route landed. Must be a separate change with its own review. |
| **W2 current score** | **592** | **1000** | 59.2%. Implementation-only subtotal (rows 1–4) is 512/550 (93.1%); it must never be reported as production readiness. |

## Mandatory W1 → W2 mapping

Every W1 row is accounted for. Nothing was quietly dropped or renamed.

| W1 row (`WEBUK-W1-FIXED-R1`) | W1 result | Maps to W2 row (`WEBUK-W2-PROD-R1`) | W2 result | What changed |
|---|---:|---|---:|---|
| Route/inventory representation | 99/100 | Route and URL-shape parity | 90/100 | **Improved then rescoped.** W1's single deduction — no safe HTTP contract for the offline signed Event check-in-code POST — was closed on 2026-08-11 and parity is 707/707. W2 then adds URL-shape parity as new scope, which is where the new -10 sits. |
| Observable Blade/workflow implementation | 292/300 | Observable Blade behaviour | 235/250 | Rescaled denominator, same two open findings, same proportion (97.3% → 94.0% after the copy-parity deviation is scored explicitly rather than folded in). |
| — (no W1 row; localisation sat inside observable behaviour) | — | Localisation | 45/50 | **New row.** Split out so a localisation regression cannot hide inside a large behaviour row. |
| API contract/state coverage plus static/mock verification | 190/200 | API contract and static/mock verification | 142/150 | Rescaled denominator, same finding. Direct-assertion coverage stayed at zero outstanding through the 2026-08 work. |
| Disposable Laravel runtime certification | 0/200 | Live Laravel runtime certification | 0/150 | Denominator reduced; still entirely open. |
| Screenshot/manual accessibility/WCAG certification | 35/150 | Manual WCAG 2.2 AA certification | 60/150 | **Improved.** Real dispatched `Tab`/`Enter` evidence now exists — a 34-stop traversal with a visible focus indicator at every stop, keyboard skip-link relocation, keyboard error-summary recovery, and no horizontal overflow at 640 and 320 CSS pixels. Recorded in `MANUAL_ACCESSIBILITY_EVIDENCE.md` (2026-08-10). W2 also names WCAG **2.2** AA explicitly. |
| Production hardening and reproducible docs | 47/50 | Production deployment, cutover and rollback | 20/100 | **Deliberately harsher.** W1 scored the *image*; W2 scores the *deployment path*. The hardening is real and still credited, but 47/50 on hardening was never evidence that anything could be deployed. |
| — (no W1 row) | — | Blade retirement without regression | 0/50 | **New row.** W1 could not score this: it treated Blade as the permanent source of truth. |

## Current evidence

All counts below come from `docs/generated/`, regenerated at commit
`704f0a1b5224b3267ccf36825cd47ba007695f1a`, which both artefacts name.

| Measure | Current result | What it does and does not prove |
|---|---|---|
| Route matrix | Laravel 707, `web-uk` 721, **matched 707, missing 0**, extra 12, ignored infrastructure 3 | Declaration coverage. Not workflow, auth, tenant or visual parity. |
| API consumer ledger | 695 contracts; 466 OpenAPI matches; 229 route-declared OpenAPI omissions; **0** without a Laravel route declaration; **0** dynamic unresolved; 381 state-changing; **0** without tests; **0** without direct helper assertions | Static and mocked ownership evidence. No live Laravel was contacted. |
| Jest | 70 suites, 2,063 tests passing, `--runInBand` | Mocked contract and page behaviour. |
| Locale catalogs | 11 locales, 38 namespaces, 9,070 string keys, 0 missing, 0 extra | Structural shape only. |
| Static locale usage | 7,878 references, 5,984 unique keys, **0 unresolved** | Every key referenced in source exists. |
| Template localisation | 335 templates, **0** conservative hard-coded matches | No detectable hard-coded user-facing copy. |
| Automated accessibility | 24/24 on the isolated fixture | Automated subset only. It is **not** manual sign-off and must never be reported as one. |
| Brand check, lint, CSS build | Passing | Branding prohibitions and code style. |

🔴 **Artefact working-tree disclosure.** Both artefacts record
`workingTreeDirty: true`. A concurrent session had unrelated sub-community
authentication work in progress at generation time. The counts above are
unaffected — they derive from Laravel route files and `web-uk` source, neither of
which that work touches — but the flag is disclosed rather than hidden, and
`check-doc-scores.mjs` requires this disclosure whenever an artefact records a
dirty tree.

## Finish line

Four gates. Two are owner decisions, not implementation.

1. **Deployment path built** (Phase 5) — compose service on both colours, deploy
   script support, vhost include, `/version` endpoint, watchdog `DEPLOY_PATHS`,
   allowlist guard, routing-drift check. Blocked on four owner prerequisites.
2. **Manual accessibility completed** — screen-reader speech sign-off (needs a
   human), representative screenshots, a real-`Enter` harness for submit-button
   activation, manual forced-colours.
3. **Accessibility-copy parity decision** — either evidence supports restoring
   Blade's public keyboard/screen-reader claims, or the Laravel accessible-content
   owner corrects the source copy. `web-uk` must not publish an unsupported
   assurance to close a parity gap.
4. **Blade retirement** — a separate change with its own review, after a soak
   period with both frontends live.

Live Laravel runtime certification remains a separate optional workstream and is
not a prerequisite for gates 1–4, though it caps the achievable score at 850.
