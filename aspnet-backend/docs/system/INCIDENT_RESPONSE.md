# Incident Response

Last reviewed: 2026-07-15

Status: **Maintained operator reference - read-only triage, no standing authorization**

This guide defines the first response to a service alert. It does not authorize
SSH access, restart, failover, deployment, migration, database work, secret
rotation, or user-data inspection.

## First Response

1. Record the alert time in UTC and Irish time, affected URL/component, HTTP
   status, correlation ID, and the exact source/image version if known.
2. Confirm the symptom from a read-only health request. Do not broaden a public
   probe into authenticated or state-changing requests.
3. Check whether the failure is isolated to the API, canonical React client,
   Web UK, DNS/TLS, or an external provider.
4. Open or update one incident record; preserve logs and observations without
   passwords, tokens, personal data, safeguarding evidence, or provider secrets.
5. Escalate for explicit authorization before any production access or change.

## Authorized Investigation Boundary

After authorization, read `.claude/production-containers.md` immediately and
verify the live component map. Start with read-only inventory and logs. Define
the permitted target, time window, data scope, abort condition, and named
decision-maker before taking action.

A restart is a production change. Because API startup automatically applies EF
migrations, “just restart it” can also be a database change. Do not restart an
API container until the pending migration chain, backup/restore position,
write-fencing need, and rollback or forward-remediation plan are understood.

## Evidence And Closure

Record the incident cause, exact actions and approvals, versions before/after,
health and workflow evidence, data-impact assessment, recovery time, remaining
risk, and follow-up owner. A returned HTTP 200 is necessary but does not prove
that authentication, tenancy, jobs, providers, sessions, or background effects
recovered correctly.

Use [operations guidance](OPERATIONS.md) for the current automation hazards and
[SUPPORT.md](../../SUPPORT.md) for sanitized defect-reporting content.
