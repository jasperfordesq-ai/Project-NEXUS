# Project NEXUS Documentation

Last reviewed: 2026-07-30

This directory contains the public, maintained documentation for Project NEXUS.

Historical prompts, one-off audits, dated handoff notes, generated reports, PDF exports, and stale planning documents do not belong in `docs/`. Keep any locally useful copies under `.local-docs-archive/`, which is intentionally ignored by git.

## How the documentation is organised

This documentation follows the [Diátaxis](https://diataxis.fr/) framework — four kinds of documentation, each with a different job:

| Kind | What it's for | Where it lives |
| --- | --- | --- |
| **Tutorial** (learning) | A guided, hands-on first experience. | [TUTORIAL.md](TUTORIAL.md) |
| **How-to guides** (tasks) | Step-by-step recipes for a specific job. | Operations docs below; task sections inside each module guide. |
| **Reference** (information) | Precise, look-it-up facts. | The [module guides](#module-guides), the [API](API.md) + `openapi.json`, and the architecture/platform docs. |
| **Explanation** (understanding) | The "why" behind the design. | [ARCHITECTURE.md](ARCHITECTURE.md), [I18N.md](I18N.md), [DATABASE.md](DATABASE.md), [CI.md](CI.md), [GOVERNANCE.md](../GOVERNANCE.md), [DOCUMENTATION.md](DOCUMENTATION.md). |

New to the project? Start with the [tutorial](TUTORIAL.md), then skim [ARCHITECTURE.md](ARCHITECTURE.md), then dive into the [module guide](#module-guides) for whatever you're changing.

## Getting Started

| Document | Purpose |
| --- | --- |
| [TUTORIAL.md](TUTORIAL.md) | Hands-on tutorial: clone, run, make a visible change, verify, and open a pull request. |

## Architecture & Platform

| Document | Purpose |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Maintained platform architecture map, runtime boundaries, and the tenant/feature model. |
| [API.md](API.md) | API getting-started + the `openapi.json` contract as source of truth. |
| [api-reference.md](api-reference.md) | Interactive, browsable API reference (Redoc) — rendered on the documentation site. |
| [I18N.md](I18N.md) | Internationalisation: 11 languages, the recipient-locale rule, and the i18n quality gates. |
| [DATABASE.md](DATABASE.md) | Database, the two migration systems, the schema dump, and tenant scoping. |
| [ROLES-AND-PERMISSIONS.md](ROLES-AND-PERMISSIONS.md) | The five authorisation tiers, why a broker is not a junior admin, hierarchy scoping in the super-admin panel, and the caveats to know before writing a permission check. |
| [SAFEGUARDING-AND-CONSENT.md](SAFEGUARDING-AND-CONSENT.md) | Guardian relationships, versioned consent records, the safeguarding case workflow, vetting attestations, and the current state of acting on behalf of a member. |
| [CI.md](CI.md) | The CI pipeline, which checks are blocking, PR gates, and how to run them locally. |
| [TESTING.md](TESTING.md) | Test-layer meanings, E2E status, and generated-report policy. |
| [REAL-SAFARI-TESTING.md](REAL-SAFARI-TESTING.md) | Safari coverage: the engine layer that runs on every push, the real-macOS layer and how to enable it, and what each one can and cannot prove. |
| [LOAD-TESTING.md](LOAD-TESTING.md) | The dependency-free load harness, why it refuses to run against production, first results, and why local figures are not capacity figures. |
| [LOCAL-PERFORMANCE.md](LOCAL-PERFORMANCE.md) | Getting full speed from a development machine, which concurrency knobs are machine-aware, and the container file-I/O bottleneck that CPU tuning cannot fix. |
| [CUSTOM-DOMAINS.md](CUSTOM-DOMAINS.md) | Tenant custom-domain setup for the React and accessible frontends. |
| [REACT-DUAL-BACKEND.md](REACT-DUAL-BACKEND.md) | Guardrails and decision gates for keeping Laravel authoritative while preserving ASP.NET as an optional, contract-identical future alternative. |
| [PLATFORM-MONOREPO.md](PLATFORM-MONOREPO.md) | Repository boundaries and safe workflow for Laravel, ASP.NET, React, and Web UK contract work. |
| [ACCESSIBLE-FRONTEND-TAKEOVER.md](ACCESSIBLE-FRONTEND-TAKEOVER.md) | The completed changeover in which Web UK replaced the deleted Blade accessible frontend: current URL shapes, deployment boundary, surviving translation sources, and historical provenance. Read this before any other accessible-frontend status claim. |
| [FEDERATION_API_MANUAL.md](FEDERATION_API_MANUAL.md) | Plain-English and technical federation API guide. |
| [MODULES.md](MODULES.md) | The module map: each module → its code paths and guide, including the modules that have no guide yet. |

## Module Guides

24 curated, code-verified reference guides (`docs/modules/`). Coverage is not yet complete — **Caring Community** is a live tenant-gated module with no guide; see [MODULES.md](MODULES.md) for its code paths.

| Guide | Module |
| --- | --- |
| [admin](modules/admin.md) | Admin permissions, tenant vs platform super-admin, audit surfaces. |
| [ai-chat](modules/ai-chat.md) | AI assistant: provider abstraction, tools, privacy boundary with external providers. |
| [blog-and-resources](modules/blog-and-resources.md) | Blog (posts, comments, RSS/SEO) and the resource library. |
| [connections-and-reviews](modules/connections-and-reviews.md) | Member connections, member reviews, and skill endorsements. |
| [courses](modules/courses.md) | Course catalogue, free + time-credit-paid enrolment, lessons, quizzes, certificates. |
| [events](modules/events.md) | Events, RSVP/waitlists, recurring series, polls, organiser actions. |
| [gamification](modules/gamification.md) | XP/levels, badges, leaderboards, challenges, NEXUS score, anti-abuse. |
| [goals-and-impact](modules/goals-and-impact.md) | Goals, check-ins, milestones, community impact metrics, and SROI. |
| [groups](modules/groups.md) | Public/private groups, roles/permissions, discussions, files, moderation. |
| [identity-verification](modules/identity-verification.md) | Document/selfie ID verification, the "ID Verified" badge, fee, and privacy. |
| [ideation-challenges](modules/ideation-challenges.md) | Community challenges, idea submission, voting, and outcomes. |
| [jobs](modules/jobs.md) | Vacancies, hiring pipeline, alerts, the bias/fairness audit, applicant GDPR. |
| [listings](modules/listings.md) | Timebanking offers/requests, lifecycle, categories, search indexing. |
| [marketplace](modules/marketplace.md) | Standalone marketplace with Stripe Connect payments, escrow, and click-and-collect. |
| [members-and-gdpr](modules/members-and-gdpr.md) | Member directory + GDPR (Article 17 deletion, DSAR export, consent, overdue alarm). |
| [messaging](modules/messaging.md) | Conversations, attachments/voice, Pusher real-time, broker safeguarding, federation. |
| [monetization](modules/monetization.md) | Premium subscriptions, merchant coupons, and local advertising. |
| [notifications](modules/notifications.md) | In-app/email/push channels, the recipient-locale rule, dispatcher flow. |
| [organisations](modules/organisations.md) | Organisation directory, registration/approval, opportunities, reviews, stats. |
| [podcasts](modules/podcasts.md) | Shows/episodes, audio hosting, RSS/iTunes feed, scheduled publishing. |
| [search](modules/search.md) | Meilisearch architecture, indexes, tenant scoping, sync script, fallback. |
| [social-feed](modules/social-feed.md) | Activity stream, posts, polls (hidden-totals), stories, reactions, ranking. |
| [volunteering](modules/volunteering.md) | Hour logging, auto-mint approval, certificates, organisation roles, safeguarding. |
| [wallet-exchanges](modules/wallet-exchanges.md) | Time-credit ledger, transfers, the exchange lifecycle, and money invariants. |

## Operations

| Document | Purpose |
| --- | --- |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production deployment workflow and blue/green commands. |
| [RUNBOOK-INCIDENTS.md](RUNBOOK-INCIDENTS.md) | First-response runbook for production incidents, with a post-mortem template. |
| [MONITORING.md](MONITORING.md) | External uptime checks, alert channels, and response notes. |
| [SLO.md](SLO.md) | Service-level objectives and wired alerting commands. |
| [SENTRY.md](SENTRY.md) | Backend and frontend Sentry configuration. |
| [SECURITY-SCANNING.md](SECURITY-SCANNING.md) | Public-safe scanner interpretation and suppression policy. |

## Support

| Document | Purpose |
| --- | --- |
| [support](support/README.md) | How support works: the in-product report, triage, and writing to members. |
| [SUPPORT-REPORTS.md](support/SUPPORT-REPORTS.md) | Reference for the in-product `support_reports` subsystem, its Sentry linkage, and its known gaps. |
| [INTAKE-AND-TRIAGE.md](support/INTAKE-AND-TRIAGE.md) | Working a support report: identifying the application, checking in cost order, and the admin actions that look routine and are not. |
| [MEMBER-LANGUAGE.md](support/MEMBER-LANGUAGE.md) | Writing to members — vocabulary to avoid, and the scoped exception to the technical register. |

## Accessible Frontend

**There is one accessible frontend: `web-uk/`.** It is the production Node 22 /
Express / Nunjucks application consuming the Laravel API and serves the platform
accessible host, both community accessible domains, and every
`/{tenantSlug}/accessible/...` path. The Blade accessible frontend was deleted
on 2026-08-14; its old code paths must not be restored. The Laravel
`lang/*/govuk_alpha*.php` files survive because they are live translation
sources, not because a second frontend survives. Read
[ACCESSIBLE-FRONTEND-TAKEOVER.md](ACCESSIBLE-FRONTEND-TAKEOVER.md) for the exact
boundary.

| Document | Purpose |
| --- | --- |
| [ACCESSIBLE-FRONTEND-TAKEOVER.md](ACCESSIBLE-FRONTEND-TAKEOVER.md) | **The status source.** Current accessible addresses and URL shapes, the completed retirement boundary, and which document answers each remaining question. |
| [govuk-alpha/RESEARCH.md](govuk-alpha/RESEARCH.md) | The original architecture decision for the retired Blade track, plus GOV.UK Frontend constraints—branding prohibitions, approved packages, and HTML-first progressive enhancement—that still bind Web UK. |
| [govuk-alpha/ATTRIBUTION.md](govuk-alpha/ATTRIBUTION.md) | GOV.UK-related attribution notes for the maintained accessible frontend. |

## Governance

| Document | Purpose |
| --- | --- |
| [DOCUMENTATION.md](DOCUMENTATION.md) | Documentation architecture, standards, inventory classes, and maintenance workflow. |
| [CONTRIBUTOR_TERMS_ENFORCEMENT.md](CONTRIBUTOR_TERMS_ENFORCEMENT.md) | How PR gates enforce contributor terms and ownership acknowledgements. |

> Project-level governance, release, and community-health documents live at the repository root: [GOVERNANCE.md](../GOVERNANCE.md), [RELEASES.md](../RELEASES.md), [CONTRIBUTING.md](../CONTRIBUTING.md), [SUPPORT.md](../SUPPORT.md), [SECURITY.md](../SECURITY.md), [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).

## Related Public Collateral

| Location | Purpose |
| --- | --- |
| [../docs-public/README.md](../docs-public/README.md) | Public collateral and the prerender observability runbook. |

## Publication Standards

Before adding a document here:

- keep it useful to a future maintainer, not just useful to one finished task;
- remove secrets, live credentials, private contact details, machine-local paths, and personal notes;
- avoid publishing raw prompts, handoffs, scratch plans, generated audit dumps, and exported PDFs;
- mark dated verification records clearly with the date and command used;
- prefer current code paths such as `app/`, `database/migrations/`, `routes/api.php`, and `react-frontend/`;
- list every public document in this index;
- move local-only material to `.local-docs-archive/` instead of committing it;
- run `npm run check:docs` before committing documentation changes.
- run `npm run check:version` after changing release/version labels or public collateral. It asserts the `Platform version:` line in [ARCHITECTURE.md](ARCHITECTURE.md) and rejects stale platform-version tokens in the root `README.md` and public collateral (`scripts/check-version-consistency.mjs`).

The docs hygiene check (`scripts/check-docs-hygiene.mjs`) fails on task-output filenames, oversized docs, non-Markdown files, missing index links, broken local links, stale retired-doc references, old namespace/path references, superseded stack claims (the previous major React version, the previous major HeroUI version, the removed animation dependency, and the wrong web server — production is Apache), generated artifacts in public doc paths, and obvious secret patterns. It does **not** check the platform version; that is `npm run check:version` above.
