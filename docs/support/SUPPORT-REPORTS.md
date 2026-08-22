# In-Product Support Reports

Last reviewed: 2026-08-22

Reference for the `support_reports` subsystem — the in-product route by which a member reports a problem, and the queue in which staff triage it. Written by reading `SupportReportController`, `AdminSupportReportController`, `SupportReportNotificationService`, the routes file and the table definition. The source remains authoritative.

Tenant-scoped throughout.

This subsystem previously had no page in `docs/`, which meant anyone working from the documentation concluded the platform had no support intake. It has one, and it is more capable than it looks.

---

## Member submission

`POST /v2/support/reports` — authenticated, throttled 10/min.

Member-facing pages on the accessible frontend: `/contact` and `/report-a-problem`.

| Field | Rules |
| --- | --- |
| `summary` | required, 3–180 chars |
| `description` | required, 10–5000 chars |
| `impact` | required, one of `blocked`, `major`, `minor`, `cosmetic` |
| `module`, `route`, `page_url` | optional context |
| `sentry_event_id`, `sentry_issue_url` | optional, if the client already has them |
| `include_diagnostics` | boolean opt-in |
| `diagnostics` | optional array, only stored when `include_diagnostics` is true |

The server additionally records `user_agent` and a **hashed** IP (`ip_hash`), never the address itself. `source` defaults to `in_app` and is a 40-char column, so other intake sources can be distinguished.

Response returns the id, reference, status, impact, summary and creation time.

### Reference format

`NXR-YYMMDD-XXXXXX` — six random uppercase characters, regenerated on collision against a global-scope-free uniqueness check, backed by a unique index.

### Diagnostics are redacted before storage

When diagnostics are included they pass through `redactDiagnosticValue()` before the row is written:

- Keys matching `/(authorization|password|passcode|token|secret|cookie|csrf|session|email|phone|address|credit|card|cvv|iban|sort_code)/i` are replaced with `[filtered]`.
- Depth capped at 6, then `[truncated]`.
- 80 items per level, then `__truncated: true`.
- Strings capped at 2000 characters.

Stored as `{captured_at, payload}` in a `json_valid`-checked column.

---

## Sentry linkage

On creation, `SupportReportSentryService::captureCreated()` captures an event and the returned id is written back to `sentry_event_id`. `sentry_issue_url` is stored alongside. There is an index on `(tenant_id, sentry_event_id)`.

This means a member's report usually arrives already joined to the server-side error, and matching a symptom to a Sentry issue by hand is often unnecessary.

> **The capture is best-effort.** It is wrapped in `try/catch` and only logs a warning on failure. An empty `sentry_event_id` therefore means *either* no error was captured *or* the capture itself failed — it is not evidence that nothing went wrong.

---

## Notification

`SupportReportNotificationService::notifyCreated()` emails active tenant admins — `admin`, `tenant_admin`, `super_admin`, `god`, or `is_admin` — with a deep link to `/admin/support-reports?report={id}`. Also best-effort: failure logs a warning and does not block submission.

---

## Staff triage

Admin panel: `/admin/support-reports`.

| Endpoint | Purpose |
| --- | --- |
| `GET /v2/admin/support-reports` | Paginated list, newest first, 20/page default, 100 max |
| `GET /v2/admin/support-reports/stats` | Counts by status, plus unassigned |
| `GET /v2/admin/support-reports/assignees` | Assignable active admins |
| `GET /v2/admin/support-reports/{id}` | Single report |
| `PUT` / `PATCH /v2/admin/support-reports/{id}` | Update status, assignee, triage notes |

Statuses: **`open` → `triaged` → `resolved` → `closed`**, with `triaged_at`, `resolved_at` and `closed_at` timestamps. `triage_notes` is text, max 10,000. An assignee must be an assignable admin of the report's own tenant, validated on write.

The stats endpoint counts unassigned as `assigned_user_id IS NULL AND status IN ('open','triaged')` — so resolved and closed reports never appear as a backlog.

### Triage is admin-only

Every method calls `requireAdmin()`.

> This is a deliberate contrast with `safeguarding_reports`, where triage is **open to brokers and coordinators** as well as admins (see `../SAFEGUARDING-AND-CONSENT.md`). A broker who can act on a safeguarding concern in their own community cannot see the support queue. If a tenant's day-to-day operator is a broker rather than an admin, support reports will queue unattended.

---

## Known gaps

Documented so they are not rediscovered as bugs.

1. **A member cannot look up their own report.** There is one member-facing route — the `POST`. There is no `GET` equivalent, and no member-facing status view. A member receives an `NXR-` reference they can quote but can never resolve themselves. Compare `safeguarding_reports`, which has `GET /v2/caring-community/safeguarding/my-reports`.

2. **No append-only action trail.** `triage_notes` is a single overwritable text column, and status changes leave only their timestamps. There is no per-action log with actor attribution, so "who reassigned this and why" is not answerable from the record. Both `safeguarding_reports` (`safeguarding_report_actions`) and `member_vetting_attestations` have the closed-vocabulary append-only pattern worth copying here.

3. **Only creation is notified.** A verified notification exists for report creation, to admins. No status-change notification to the reporting member was found — so a member who reports something and hears nothing has no in-product signal that it was triaged or resolved.

4. **`impact` is member-declared and is not a severity.** It records how the problem feels to the reporter, not how the organisation has ranked it. There is no staff-assigned severity or priority column and no due-by field — contrast the severity-driven `review_due_at` on `safeguarding_reports`. Any response-time commitment therefore lives outside this table.

5. **No exchange linkage.** Consistent with the wider caveat in `../SAFEGUARDING-AND-CONSENT.md`: no reporting system in the platform can reference a time exchange. A member disputing a completed exchange cannot raise it here in a way that points at the record.

---

## If you are extending this area

- **Add the member read path before adding fields.** A reference the member cannot look up is the defect most visible to them.
- **Copy the append-only action-log pattern** from `safeguarding_report_actions` before adding more mutable staff fields.
- **Do not widen `requireAdmin()` casually** — but do decide deliberately whether brokers should see this queue, because the safeguarding subsystem already answered that question the other way.
- **Keep the redaction list in step** with any new client-supplied field. The filter is keyed on names, so a new key that carries personal data passes through unless its name matches.

## Related

- `../SAFEGUARDING-AND-CONSENT.md` — the safeguarding reporting workflow, its severity SLA, and its append-only trail
- `../SENTRY.md` — Sentry configuration
- `INTAKE-AND-TRIAGE.md` — how a report is worked once it arrives
