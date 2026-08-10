# Documentation Governance

Last reviewed: 2026-07-15

Status: **Maintained reference - documentation authority and scoring policy**

This policy keeps product intent, scores, safety rules, and historical evidence
from drifting across Project NEXUS documentation. It governs maintained Markdown
in this repository. `AGENTS.md` and `CLAUDE.md` remain the mandatory first-read
agent instructions.

## Canonical Current Sources

| Decision or status | Canonical document | What other documents may do |
| --- | --- | --- |
| Agent scope and non-negotiable guardrails | [`AGENTS.md`](../AGENTS.md), then [`CLAUDE.md`](../../CLAUDE.md) | Link or summarize without weakening a rule |
| Paused-development boundary, cold-start order, and repository freeze | [`PROJECT_PAUSE_HANDOFF_2026-07-15.md`](PROJECT_PAUSE_HANDOFF_2026-07-15.md) | Link to it while paused; do not treat a historical handoff or runbook loop as standing authorization |
| Backend product objective and meaning of contract identity | [`ADR-0001`](decisions/ADR-0001-contract-identical-backends.md) | Historical "parity" or "compatibility" wording is shorthand only; never permit observable divergence or frontend forks |
| ASP.NET banked score, score provenance, and certification gaps | [`CURRENT_ASPNET_CONTRACT_STATUS.md`](CURRENT_ASPNET_CONTRACT_STATUS.md) | Link to it; do not publish a competing current overall score |
| ASP.NET schema pause/restart verdict and current migration-chain boundary | [`CURRENT_SCHEMA_READINESS.md`](CURRENT_SCHEMA_READINESS.md) | Link to it; keep the schema category score in the ASP.NET status and detailed dated evidence in `SCHEMA_PARITY.md` |
| Accessible Web UK banked score, ownership, blockers, and queue | [`CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`](../../web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md) | Link to it; do not treat the old handoff log as current |
| Fixed 1000-point rubric, 2x2 end state, shared evidence gates, and execution loop | [`FULL_PARITY_REMEDIATION_RUNBOOK.md`](FULL_PARITY_REMEDIATION_RUNBOOK.md) | Reuse its denominator and category definitions exactly; follow each canonical status document for its live queue |
| Runtime boundaries and two-frontends-by-two-backends shape | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Link to it; do not draw a competing current architecture |
| React retirement and unchanged-client policy | [`REACT_FRONTEND_RETIREMENT.md`](REACT_FRONTEND_RETIREMENT.md) | Retirement is complete: the copy was deleted 2026-08-09. Preserve the do-not-recreate and Laravel-consumer rules |
| Web UK backend-switch contract | [`BACKEND_SWITCHING_CONTRACT.md`](../../web-uk/docs/BACKEND_SWITCHING_CONTRACT.md) | Preserve Laravel-first certification and configuration-only switching |
| Member/end-user documentation | [`user/README.md`](user/README.md) | Keep backend-neutral, tenant-aware, and honest about experimental/certification limits |
| Tenant/community administrator documentation | [`admin/README.md`](admin/README.md) | Separate tenant governance from platform/production operations |
| API consumer documentation | [`api/README.md`](api/README.md) | Require exact endpoint contracts rather than a universal invented envelope |
| Developer/operator/security/configuration documentation | [`system/README.md`](system/README.md) | Index supported local, test, configuration, security, operations, and incident-response methods |
| Support and vulnerability reporting | [`SUPPORT.md`](../../SUPPORT.md) and [`SECURITY.md`](../../SECURITY.md) | Keep secrets, personal data, incidents, and vulnerabilities out of public defect reports |
| Contributor participation and conduct reporting | [`CONTRIBUTING.md`](../../CONTRIBUTING.md), [`CONTRIBUTOR_TERMS.md`](../../CONTRIBUTOR_TERMS.md), and [`CODE_OF_CONDUCT.md`](../../CODE_OF_CONDUCT.md) | Preserve licensing, disclosure, safety, private reporting, and non-retaliation boundaries |
| Curated project-direction history | [`CHANGELOG.md`](../../CHANGELOG.md) | Link to canonical current sources; never publish a competing live score, queue, or certification claim |
| Surface-specific generated or curated inventories | `API_PARITY.md`, `SCHEMA_PARITY.md`, `FRONTEND_PARITY.md`, `LOCALIZATION_PARITY.md`, and their generated artifacts | State the capture date and exact source SHAs, or label unverifiable legacy tables historical and provenance-incomplete; do not turn representation counts into completion claims |

When two maintained documents disagree, the source named in this table wins.
Correct the dependent document in the same documentation repair. A newer edit
date does not override this hierarchy.

## Operational Inventory Is Not Product Authority

Deployment inventory and product authority are separate documentation planes:

| Operational source | Authority it has | Authority it does not have |
| --- | --- | --- |
| `.claude/production-containers.md` † | Current production domains, containers, ports, proxy ownership, and component-specific operator procedures | Product source-of-truth status, contract correctness, parity score, or permission to deploy |
| `.claude/production-server.md` † | Connection pointer and concise operational warnings | An independent deployment recipe or product architecture |
| [`compose.prod.yml`](../compose.prod.yml) | A versioned description of legacy/experimental Compose topology | A blanket production release path; its Web UK ASP.NET override remains under an explicit deployment hold |
| `compose.production.yml` † | A zero-service historical stub whose former topology remains in Git history | Any local or production startup command |
| `compose.fullstack.yml` † | A zero-service historical stub for the obsolete duplicate local topology | A supported local-development or production command |
| `.github/workflows/deploy.yml` † | A manual-only exact-SHA validation scaffold with its legacy deploy job hard-disabled | A usable deployment entry point, standing authorization, or proof that the retained backup/migration/rollback body is safe |

† Not imported by the 2026-08-09 move into the platform monorepo, so these are
named here without a link. They remain in the history of the former
`api.project-nexus.net` repository. The rows are kept because they still record
what each surface was and was not authority for; do not re-link them until the
file itself is imported.

The fact that a legacy or experimental surface is deployed does not make it a
product, UI, or API-contract source of truth. Laravel remains the current
production behavior baseline; the two canonical workstream status documents
state product readiness. Operational files may report what runs, but they must
not convert deployment presence into certification or authorize changes.

## Status And Scoring Rules

Every score must identify:

- the rubric and fixed denominator;
- the Laravel source SHA and ASP.NET evidence SHA;
- whether work is banked, published but unscored, or dirty/in flight;
- category movements and remaining deductions;
- certification evidence still missing.

Only `CURRENT_ASPNET_CONTRACT_STATUS.md` states the current ASP.NET overall
score. Only `CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` states the current Web UK
overall score. Never blend the two totals. Never lower or raise a prior score
because scope was silently rediscovered; create a named drift baseline and show
the delta.

When a goal's scope changes, preserve the old score under its named baseline.
Do not reuse it as the new goal's percentage or silently change its denominator.
Until a complete new audit defines the corrected rubric, report a finite gate
or package count and say that no percentage has been assigned.

Implementation is not certification. Static route representation, generated
matrices, a successful focused test, or a clean build cannot independently
prove unchanged-client runtime behavior or production readiness.

## Documentation State Labels

Every long-lived status-like document must make its state unambiguous near the
title:

- **Canonical current** - the sole current source for its named decision.
- **Maintained reference** - current policy or method, but not an overall score.
- **Generated snapshot** - reproducible dated output with source SHAs.
- **Historical checkpoint** - append-only evidence retained for audit, not a
  current status or resume point.

A historical filename may contain words such as `CURRENT` for compatibility,
but its opening block must say **Historical checkpoint**, identify its canonical
replacement, and prohibit using its scores or queues as current. Entry-point
documents must label it historical rather than instructing readers to resume
there.

Within a maintained runbook, put retired material below a
`## Historical Checkpoints` heading. Historical scores must name their old
rubric or denominator and must not use unqualified phrases such as “current
score,” “latest score,” or “remaining overall.”

## Safe Historical Preservation

Preserve useful evidence without allowing it to drive current work:

1. Add a historical-state banner and a link to the canonical replacement.
2. Keep the original date, SHAs, commands, and outcomes intact where they remain
   safe and auditable.
3. Mark obsolete counts, invalidated evidence, and superseded assumptions in
   the checkpoint that contains them.
4. Remove historical documents from “start here” and resume instructions.
5. Never copy a historical numeric snapshot into an entry point. Link to the
   current generated artifact or canonical status instead.

Historical commands are not standing authorization. In particular, the
ordinary local Laravel database is a confidential production-derived snapshot
and is read-only. Stateful mutation, upload, download, or destructive
certification requires a separately provisioned disposable Laravel environment.

## Update Transaction

An implementation commit that is intended to change a banked score is not
documented as banked until the documentation update records:

1. the exact published implementation SHA;
2. tests and runtime or migration evidence appropriate to the category;
3. the category-level point movement;
4. the new total and exact remaining deductions;
5. published-but-unscored and dirty-worktree boundaries;
6. any regenerated parity artifacts affected by the implementation.

If those items cannot ship together, list the implementation under “Published
but not rescored” and keep the previous banked total. A dirty worktree always
contributes zero points.

When a generated count changes, update its one canonical inventory and link to
that source elsewhere. Do not manually propagate the number into architecture,
agent guides, and historical handoffs.

Tool-owned directories such as `.snapshots/`, ignored parity artifacts, test
results, and scratch output are not maintained product documentation unless a
curated document explicitly imports their exact-SHA evidence. Do not count or
link arbitrary tool output merely to make documentation coverage appear full.

## Required Review Before Merge

Documentation-changing work must run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-documentation-consistency.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-markdown-links.ps1
git diff --check
```

The consistency check is read-only. It protects canonical links, the 2x2
architecture markers, current-score language, Web UK resume authority, and the
ordinary-database safety boundary. It also protects the Apache production
pointer and the Web UK Compose deployment hold. A passing script does not
certify factual product parity; reviewers must still verify new SHAs, counts,
tests, and evidence against the repository.

Documentation health is 1000/1000 under pause-readiness Baseline D3 only when:

- member, accessibility/language, support, administrator, API-consumer, and
  system/operator audiences each have a discoverable maintained entry point;
- local-development commands, ports, seed credentials, startup effects, and
  database boundaries match the current source/configuration;
- configuration keys match current option binders and obsolete deployment
  recipes are corrected or explicitly quarantined;
- production actions are manual and explicit-authority only, incident guidance
  is read-only by default, and restart/migration/backup/restore hazards are
  stated accurately;
- one current score exists per workstream with named baselines, published-
  unscored and dirty/isolated work separated, and corrected goals do not reuse
  stale percentages;
- architecture shows both unchanged frontends against both backends, generated
  counts are dated, and representation is not called semantic certification;
- active safety rules contain no ordinary-database testing exception and old
  handoffs/checkpoints are explicitly historical; and
- the consistency script, Markdown link checker, relevant focused tests,
  configuration/YAML/Compose validation, and `git diff --check` all pass;
- the pause handoff states an exact read order, evidence boundary, schema
  verdict, restart prompts, and resume-authorization fence; and
- the pause-readiness guard proves one clean `main` worktree, no local topic
  branches or stashes, `HEAD=origin/main`, preserved archive tags, only
  intentional open-PR remote heads, a final pause tag, and no known ignored
  debris.
