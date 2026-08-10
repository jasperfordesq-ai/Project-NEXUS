# Operations And Production Boundaries

Last reviewed: 2026-07-15

Status: **Maintained operator index - no standing authorization**

This page describes where current operational authority lives and records known
automation hazards. It does not authorize deployment, restart, migration,
backup, restore, failover, or production investigation.

## Authority

Before any production action:

1. obtain explicit user authorization for the named component, exact source or
   image SHA, target, and operation;
2. read `.claude/production-containers.md` immediately before acting;
3. verify current live inventory rather than trusting a dated statement; and
4. define health, abort, write-fencing, backup, and rollback/forward-remediation
   evidence appropriate to that component.

Never touch the Laravel blue/green containers from this repository.

## Current Documentation Hierarchy

- `.claude/production-containers.md` is the component/container inventory and
  component-specific reference after explicit authorization.
- `.claude/production-server.md` is only a connection pointer.
- `web-uk/docs/PRODUCTION_RELEASE_RUNBOOK.md` is fail-closed and retains a
  Web UK deployment hold.
- `docs/database-migrations.md` owns migration method and safety explanation.
- Historical `PHASE63_73_DEPLOY_NOTES.md` is quarantined and must not be used.

## Automatic Migration Warning

`Program.cs` calls `Database.MigrateAsync()` on every non-Testing startup,
including Production. Restarting or replacing the API can therefore change the
database before health verification. Any authorized API release plan must
review the pending migration chain, irreversible `Down()` methods, preflight
conditions, backup/restore evidence, and write fencing before starting the new
container. A container-image rollback cannot undo a forward-only schema change.

## Known Unsafe Or Legacy Automation

The following files exist but are not approved production authorities:

| File | Current problem |
| --- | --- |
| `compose.production.yml` | Obsolete whole-stack recipe with stale paths/settings. Its executable service definitions were removed; the file is now a zero-service historical stub and is not a production procedure. |
| `compose.prod.yml` | Legacy topology whose Web UK override selects uncertified ASP.NET; deployment hold applies. |
| `compose.fullstack.yml` | Duplicate local topology with stale ports. Its executable service definitions were removed; the file is now a zero-service historical stub. |
| `.github/workflows/deploy.yml` | The published workflow removes automatic `main` deployment, accepts only manual dispatch, validates an exact 40-character SHA before checkout, and verifies the resolved checkout. Its deploy job is hard-disabled because the retained legacy backup/migration/rollback body is not approved. The named `production` environment has no protection rules and allows administrator bypass, so it is not an independent approval gate. |
| `scripts/deploy.sh` | **Deleted 2026-08-10.** Besides the pre-existing concerns (it could continue after a skipped or failed backup, and restarted an auto-migrating API), its upload step ran `rsync --delete ./` against the current working directory. Under the monorepo layout that resolved to the repository root, so running it from anywhere but `aspnet-backend/` would have mirrored the Laravel, React and Web UK trees into `/opt/nexus-backend` and deleted whatever was already there. Its non-interactive path also skipped the typed `YES` confirmation. There is deliberately no replacement: `aspnet-backend/` is development-only and has no production deploy path. |
| `Makefile` migration/production targets | Assume container EF tooling/database names that are not established by the runtime image/current topology. They now fail closed unconditionally; retained recipe text is not an executable production runbook. |
| `scripts/check-container-health.sh` | Contains stale container matching and recovery advice; do not use it as the current production inventory. |
| backup/restore scripts and workflow | Competing retention/ownership models and an unverified restore drill exist. No backup is accepted until its exact artifact, checksum, completion, retention owner, and isolated restore evidence are recorded. |
| `.github/workflows/health-check.yml` | Alert text now points to read-only incident triage and explicitly withholds restart authority. The public probes remain availability signals, not product certification. |

These are system risks, not documentation-score deductions once accurately
recorded. They remain implementation/operations work until explicitly repaired
and verified.

### Pre-publication release hazard and published hold

At 2026-07-15 17:50 +01:00, `origin/main` was still `9ad163c9` and therefore
still carried the old deploy-on-success `workflow_run` trigger. CI run
`29428797285` for that SHA remained `in_progress`, but its Integration Tests job
had already failed, so that particular run cannot conclude successfully and
cannot satisfy the old deploy job condition. The next successful CI run can
still start the old deploy workflow until the manual-only correction was
published. That dated exposure is now closed by the publication transaction:
the default-branch workflow is manual-only and its deploy job is hard-disabled.
No production deployment or production-container action was performed.

The GitHub `production` environment was also verified with
`protection_rules=[]` and `can_admins_bypass=true`. Naming that environment in a
workflow does not supply independent human approval. Repository-wide default
workflow permissions are read-only; workflows that create issues must request
`issues: write` explicitly.

## Backup And Restore Evidence

Do not claim that a backup exists because a cron file, workflow, or deploy
script intends to create one. Record the source database, consistent-snapshot
method, path/object identifier, UTC time, size, checksum, encryption/access
boundary, retention owner, completion marker, and isolated restore result.
Restoring, dropping, or recreating a database requires fresh explicit
authorization; migration or backup authorization does not imply restore
authorization.

## Post-Operation Evidence

Record the deployed source/image digest, database migration boundary, container
identity, health result, public endpoint result, relevant logs/metrics, and any
rollback or forward-remediation decision. Operational presence does not change
which codebase defines the product contract or its parity score.
