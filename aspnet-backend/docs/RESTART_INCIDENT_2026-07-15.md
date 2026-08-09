# Windows Update Restart Incident - 2026-07-15

Status: **Maintained incident record - Irish local time (UTC+01:00)**

This record separates the host restart from the longer unattended-work
interruption and preserves the exact pre-restart evidence boundary for the three
open Codex tasks. It is an audit record, not a product score source.

## Exact Timeline And Cause

| Irish time | Windows evidence | Meaning |
| --- | --- | --- |
| 02:44:42.746 | `User32` event 1074; `MoUsoCoreWorker.exe` acting as `NT AUTHORITY\SYSTEM`; reason `Operating System: Service pack (Planned)` | Windows Update initiated the first restart. |
| 02:46:34.500 | Kernel-General event 12 | First intermediate operating-system start. |
| 02:47:52.535 | `User32` event 1074; `TrustedInstaller.exe`; reason `Operating System: Upgrade (Planned)` | Servicing initiated a second restart. |
| 02:48:17.500 | Kernel-General event 12 | Second intermediate operating-system start. |
| 02:48:47.887 | `User32` event 1074; `TrustedInstaller.exe`; reason `Operating System: Upgrade (Planned)` | Servicing initiated a third restart. |
| 02:49:14.500 | Kernel-General event 12 | Final operating-system start. |
| 02:49:29.444 | EventLog event 6005 | Windows Event Log was available after the final boot. |
| about 05:20 | Codex execution host activity resumed | The unattended tasks did not automatically resume for about 2 hours 35 minutes after the first restart. |

Installed-update evidence identifies security update `KB5101650` and .NET
Framework update `KB5100998`. The same interval contains no Kernel-Power event
41 and no EventLog event 6008. This was therefore a planned Windows servicing
sequence, not an unexpected crash.

The machine's restart sequence lasted about five minutes. The materially larger
lost-work window was the failure of the Codex tasks to resume until about 05:20.

## Exact Pre-Restart Task Boundary

### ASP.NET backend contract task

Before the restart, the backend task had moved the fixed-rubric bank from
`684/1000` to `712/1000` through these published slices:

- secure SSO/OIDC authentication (`c20d064e`) and its evidence;
- tenant-bootstrap precedence and fail-closed proof (`5fbcf36d`);
- social-comment mentions, recipient effects, and username behavior
  (`1ff64470`);
- legacy social-comment sanitization (`293796e0`);
- V2 generic-comment sanitization (`5fa15e0e`);
- migrated-schema integration-fixture correction (`fefbb5ce`) and evidence
  (`7ef75d1c`), which improved proof but added zero points.

The last backend evidence commit before the restart was `7ef75d1c` at 02:41:31.
An untracked deterministic shard runner had been created immediately before the
restart. Its first run produced no terminal aggregate, so it contributes no
banked test/CI evidence. The recovered re-audit keeps the backend at
`712/1000`.

### Accessible Web UK task

The last product commit before the restart was `e2918257` at 02:44:08, 34
seconds before Windows initiated the first restart. By that point the task had
published substantial default-English state and workflow closure across
Listings, Feed, Messages, Groups, Events, Jobs, organisations, media, accounts,
search, and related component families. The Feed slice's complete non-mutating
inventory was 52/52 suites and 1,701/1,701 assertions across its recorded split,
with route, API, localization, and marker gates green.

The evidence commit for that Feed slice had not landed when Windows restarted;
it was recovered and published as `7bfbf42e` at 05:21:21. Messages, Groups, and
the Event-detail status family were post-recovery work and must not be described
as pre-restart achievement. The clean post-recovery re-audit at `1ded18bd`
supersedes the old 622-point checkpoint with the current fixed-rubric score in
`apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md`.

### Isolated schema task

Before the restart, the schema task had inventoried 458 Laravel source tables
against 421 tables on its older ASP.NET base: 225 exact names, 233 apparent
gaps, and 196 ASP.NET-only names. It had explicitly classified 20 aliases, eight
podcast compatibility-storage gaps, five genuine Verein gaps, and left 200
names unclassified. It had modelled the five Verein tables in source, but had
not produced a verified migration, tests, documentation, or commit.

The schema task's previous clean build had already timed out around 22:00 on
14 July, and no schema build was recorded as running at 02:44. The restart did
not kill an active schema compilation; it interrupted the unattended session
before it could recover and complete verification. Post-recovery build, focused
tests, and disposable PostgreSQL checks on the older base are useful evidence,
but the current-lineage migration designer still requires regeneration and
re-verification. The slice is uncommitted and contributes zero banked points.

## Recovery And Scoring Rule

The canonical current scores and queues are:

- `CURRENT_ASPNET_CONTRACT_STATUS.md` for ASP.NET;
- `apps/web-uk/docs/CURRENT_LARAVEL_FIRST_PARITY_STATUS.md` for Web UK.

No interrupted process, recovered dirty file, elapsed effort, or projected
schema improvement changes either bank. A score moves only at a named committed
snapshot after the appropriate complete fixed-rubric audit.
