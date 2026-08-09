// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record EventPeopleError(string Code, string Message, int Status, string? Field = null);
public sealed record EventPeopleResult(object? Data, object? Meta = null, EventPeopleError? Error = null, int Status = 200) { public bool Succeeded => Error is null; }

public sealed class EventPeopleWorkflowService
{
    private static readonly string[] RegistrationStates = ["invited", "pending", "confirmed", "declined", "cancelled"];
    private static readonly string[] WaitlistStates = ["waiting", "offered", "accepted", "expired", "cancelled"];
    private static readonly string[] AttendanceStates = ["not_checked_in", "checked_in", "checked_out", "attended", "no_show"];
    private readonly NexusDbContext _db;
    public EventPeopleWorkflowService(NexusDbContext db) => _db = db;

    public async Task<EventPeopleResult> RelationshipAsync(int tenant, int eventId, int actorId, CancellationToken ct)
    {
        var actor = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == actorId && x.IsActive, ct);
        var evt = await _db.Events.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == eventId, ct);
        if (actor is null || evt is null) return Missing();

        var facts = await FactsAsync(evt, actor, ct);
        var legacy = await _db.EventRsvps.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenant && x.EventId == eventId && x.UserId == actorId, ct);
        var registrationState = facts.Registration?.RegistrationState ?? legacy?.Status switch
        {
            "going" or "attending" or "yes" => "confirmed",
            "declined" or "not_going" or "no" => "declined",
            _ => null
        };
        var confirmed = await _db.EventRegistrations.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenant && x.EventId == eventId && x.CapacityPoolKey == "event" && x.RegistrationState == "confirmed")
            .SumAsync(x => x.PartySize, ct);
        var limit = evt.MaxAttendees;
        var remaining = limit is null ? (int?)null : Math.Max(0, limit.Value - confirmed);
        var full = limit is not null && remaining == 0;
        var offerActive = facts.Waitlist?.QueueState == "offered" && facts.Waitlist.OfferExpiresAt > DateTime.UtcNow;
        var registrable = evt.StartsAt > DateTime.UtcNow
            && evt.PublicationStatus == "published"
            && evt.OperationalStatus is not ("cancelled" or "archived" or "completed");

        return new(new
        {
            contract_version = 1,
            event_id = eventId,
            member_id = actorId,
            engagement = new { state = legacy?.Status is "interested" or "maybe" ? "interested" : "none", consumes_capacity = false },
            registration = new
            {
                id = facts.Registration?.Id,
                state = registrationState,
                version = facts.Registration?.RegistrationVersion,
                capacity_pool_key = facts.Registration?.CapacityPoolKey ?? "event",
                allocation_key = facts.Registration?.AllocationKey,
                changed_at = facts.Registration?.StateChangedAt,
                invited_at = facts.Registration?.InvitedAt,
                pending_at = facts.Registration?.PendingAt,
                confirmed_at = facts.Registration?.ConfirmedAt,
                declined_at = facts.Registration?.DeclinedAt,
                cancelled_at = facts.Registration?.CancelledAt
            },
            waitlist = new
            {
                id = facts.Waitlist?.Id,
                state = facts.Waitlist?.QueueState,
                version = facts.Waitlist?.QueueVersion,
                position = facts.Waitlist?.QueueState is "waiting" or "offered" ? facts.Waitlist.QueueSequence : (long?)null,
                offered_at = facts.Waitlist?.OfferedAt,
                offer_expires_at = facts.Waitlist?.OfferExpiresAt,
                offer_active = offerActive,
                accepted_at = facts.Waitlist?.AcceptedAt,
                expired_at = facts.Waitlist?.ExpiredAt,
                cancelled_at = facts.Waitlist?.CancelledAt
            },
            attendance = new { state = facts.Attendance?.AttendanceStatus, checked_in_at = facts.Attendance?.CheckedInAt, checked_out_at = facts.Attendance?.CheckedOutAt },
            capacity = new { limit, confirmed, remaining, is_full = full },
            actions = new
            {
                registrable,
                confirm = registrable && registrationState != "confirmed" && !offerActive && (remaining is null || remaining > 0),
                withdraw = registrationState is "invited" or "pending" or "confirmed",
                join_waitlist = registrable && registrationState != "confirmed" && facts.Waitlist?.QueueState is not ("waiting" or "offered") && full,
                leave_waitlist = facts.Waitlist?.QueueState is "waiting" or "offered",
                accept_offer = registrable && offerActive,
                idempotency_key_required = true
            },
            privacy = new { sensitive_fields_redacted = true }
        });
    }

    public async Task<EventPeopleResult> ListAsync(int tenant, int eventId, int actorId, IReadOnlyDictionary<string, string?> input, CancellationToken ct)
    {
        var access = await ManageAsync(tenant, eventId, actorId, ct); if (access.Error is not null) return access; var evt = (Event)access.Data!; var parsed = Parse(input); if (parsed.Error is not null) return parsed; var q = ((int Page, int PerPage, string? Search, string? Registration, string? Waitlist, string? Attendance, string? Engagement, string Sort, string Direction))parsed.Data!;
        var ids = _db.EventRegistrations.IgnoreQueryFilters().Where(x => x.TenantId == tenant && x.EventId == eventId).Select(x => x.UserId)
            .Union(_db.EventWaitlistEntries.IgnoreQueryFilters().Where(x => x.TenantId == tenant && x.EventId == eventId).Select(x => x.UserId))
            .Union(_db.EventAttendance.IgnoreQueryFilters().Where(x => x.TenantId == tenant && x.EventId == eventId).Select(x => x.UserId));
        var users = _db.Users.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenant && x.IsActive && ids.Contains(x.Id)); if (!string.IsNullOrWhiteSpace(q.Search)) { var s = q.Search.Trim(); users = users.Where(x => EF.Functions.ILike(x.FirstName + " " + x.LastName, $"%{s}%")); }
        var all = await users.OrderBy(x => x.LastName).ThenBy(x => x.FirstName).ThenBy(x => x.Id).ToListAsync(ct); var rows = new List<PersonFacts>(); foreach (var user in all) { var facts = await FactsAsync(evt, user, ct); if (q.Registration is not null && facts.Registration?.RegistrationState != q.Registration || q.Waitlist is not null && facts.Waitlist?.QueueState != q.Waitlist || q.Attendance is not null && (facts.Attendance?.AttendanceStatus ?? "not_checked_in") != q.Attendance || q.Engagement is not null && q.Engagement != "none") continue; rows.Add(facts); }
        rows = q.Sort switch { "registration_changed" => rows.OrderByDescending(x => x.Registration?.StateChangedAt).ToList(), "queue_rank" => rows.OrderBy(x => x.Waitlist?.QueueSequence ?? long.MaxValue).ToList(), "attendance_changed" => rows.OrderByDescending(x => x.Attendance?.StatusChangedAt).ToList(), _ => rows.OrderBy(x => x.User.LastName).ThenBy(x => x.User.FirstName).ToList() }; if (q.Direction == "desc") rows.Reverse(); var total = rows.Count; var pageRows = rows.Skip((q.Page - 1) * q.PerPage).Take(q.PerPage).Select(PersonResource).ToList(); var pages = total == 0 ? 0 : (int)Math.Ceiling(total / (double)q.PerPage); var metrics = await MetricsAsync(tenant, eventId, ct);
        return new(pageRows, new { base_url = $"/api/v2/events/{eventId}/people", current_page = q.Page, per_page = q.PerPage, total, total_pages = pages, has_more = q.Page < pages, search = q.Search, registration_state = q.Registration, waitlist_state = q.Waitlist, attendance_state = q.Attendance, engagement_state = q.Engagement, sort = q.Sort, direction = q.Direction, metrics, projection = "full", sensitive_fields_redacted = true, capabilities = Capabilities() });
    }

    public async Task<EventPeopleResult> HistoryAsync(int tenant, int eventId, int userId, int actorId, int page, int perPage, CancellationToken ct)
    {
        var access = await ManageAsync(tenant, eventId, actorId, ct); if (access.Error is not null) return access; if (page < 1 || perPage is < 1 or > 100) return Validation("page"); if (!await _db.Users.IgnoreQueryFilters().AnyAsync(x => x.TenantId == tenant && x.Id == userId, ct)) return Missing();
        var registrations = await _db.EventRegistrationHistory.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenant && x.EventId == eventId && x.UserId == userId).ToListAsync(ct); var waits = await _db.EventWaitlistEntryHistory.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenant && x.EventId == eventId && x.UserId == userId).ToListAsync(ct); var attendance = await _db.EventAttendanceActivity.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenant && x.EventId == eventId && x.UserId == userId).ToListAsync(ct); var actorIds = registrations.Select(x => x.ActorUserId).Where(x => x.HasValue).Select(x => x!.Value).Concat(waits.Select(x => x.ActorUserId).Where(x => x.HasValue).Select(x => x!.Value)).Concat(attendance.Select(x => (int?)x.ActorUserId).Where(x => x.HasValue).Select(x => x!.Value)).Distinct().ToArray(); var actors = await _db.Users.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenant && actorIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
        object Entry(string axis, long id, long version, long? sequence, string action, string? from, string to, int? actor, string? reason, DateTime created) => new { axis, entry_id = id, version, sequence, action, from_state = from, to_state = to, actor = new { id = actor, display_name = actor is int aid && actors.TryGetValue(aid, out var u) ? Name(u) : null }, reason, created_at = created };
        var entries = registrations.Select(x => (x.CreatedAt, Value: Entry("registration", x.Id, x.RegistrationVersion, null, x.Action, x.FromState, x.ToState, x.ActorUserId, x.Reason, x.CreatedAt))).Concat(waits.Select(x => (x.CreatedAt, Value: Entry("waitlist", x.Id, x.QueueVersion, x.QueueSequence, x.Action, x.FromState, x.ToState, x.ActorUserId, x.Reason, x.CreatedAt)))).Concat(attendance.Select(x => (x.CreatedAt, Value: Entry("attendance", x.Id, x.AttendanceVersion, null, x.Action, x.FromStatus, x.ToStatus, x.ActorUserId, x.Reason, x.CreatedAt)))).OrderByDescending(x => x.CreatedAt).ToList(); var total = entries.Count; var pages = total == 0 ? 0 : (int)Math.Ceiling(total / (double)perPage); return new(entries.Skip((page - 1) * perPage).Take(perPage).Select(x => x.Value).ToList(), new { base_url = $"/api/v2/events/{eventId}/people/{userId}/history", current_page = page, per_page = perPage, total, total_pages = pages, has_more = page < pages, projection = "full", sensitive_fields_redacted = true });
    }

    public async Task<EventPeopleResult> RegistrationAsync(int tenant, int eventId, int userId, int actorId, string action, long expected, string key, string? reason, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(key) || key.Length > 191) return Validation("idempotency_key"); if (action is "reject" or "cancel" && string.IsNullOrWhiteSpace(reason)) return Validation("reason"); await using var tx = await _db.Database.BeginTransactionAsync(ct); await LockAsync(tenant, eventId, ct); var access = await ManageAsync(tenant, eventId, actorId, ct); if (access.Error is not null) return access; if (!await _db.Users.IgnoreQueryFilters().AnyAsync(x => x.TenantId == tenant && x.Id == userId && x.IsActive, ct)) return Missing(); var row = await _db.EventRegistrations.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenant && x.EventId == eventId && x.UserId == userId && x.CapacityPoolKey == "event", ct); if (row is null) return Missing(); var target = action == "approve" ? "confirmed" : action == "reject" ? "declined" : "cancelled"; var identity = Identity("people." + action, tenant, eventId, userId, key); var replay = await _db.EventRegistrationHistory.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.IdempotencyKey == identity, ct); if (replay is not null) { await tx.CommitAsync(ct); return new(RegistrationMutation(row, false, true, replay.Id)); } if (row.RegistrationVersion != expected || action == "approve" && row.RegistrationState is not ("invited" or "pending") || action is "reject" or "cancel" && row.RegistrationState is "declined" or "cancelled") return Conflict();
        var from = row.RegistrationState; var now = DateTime.UtcNow; row.RegistrationState = target; row.RegistrationVersion++; row.StateChangedAt = now; row.StateChangedBy = actorId; row.ConfirmedAt = target == "confirmed" ? now : row.ConfirmedAt; row.DeclinedAt = target == "declined" ? now : row.DeclinedAt; row.CancelledAt = target == "cancelled" ? now : row.CancelledAt; row.UpdatedAt = now; var history = new EventRegistrationHistory { TenantId = tenant, EventId = eventId, RegistrationId = row.Id, UserId = userId, ActorUserId = actorId, CapacityPoolKey = row.CapacityPoolKey, AllocationKey = row.AllocationKey, RegistrationVersion = row.RegistrationVersion, Action = action, FromState = from, ToState = target, IdempotencyKey = identity, Reason = reason, Metadata = "{\"contract_version\":2}", CreatedAt = now }; _db.EventRegistrationHistory.Add(history); await _db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return new(RegistrationMutation(row, true, false, history.Id));
    }

    public async Task<EventPeopleResult> AttendanceAsync(int tenant, int eventId, int userId, int actorId, string action, long expected, string key, string? reason, CancellationToken ct)
    {
        if (action is not ("check_in" or "check_out" or "no_show" or "undo")) return Validation("action"); if (expected < 0) return Validation("expected_version"); if (string.IsNullOrWhiteSpace(key) || key.Length > 191) return Validation("idempotency_key"); if (action == "undo" && string.IsNullOrWhiteSpace(reason)) return Validation("reason"); await using var tx = await _db.Database.BeginTransactionAsync(ct); await LockAsync(tenant, eventId, ct); var access = await ManageAsync(tenant, eventId, actorId, ct); if (access.Error is not null) return access; var user = await _db.Users.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == userId && x.IsActive, ct); if (user is null) return Missing(); var visible = await _db.EventRegistrations.IgnoreQueryFilters().AnyAsync(x => x.TenantId == tenant && x.EventId == eventId && x.UserId == userId && x.RegistrationState == "confirmed", ct) || await _db.EventAttendance.IgnoreQueryFilters().AnyAsync(x => x.TenantId == tenant && x.EventId == eventId && x.UserId == userId, ct); if (!visible) return Missing(); var identity = Identity("attendance." + action, tenant, eventId, userId, key); var replay = await _db.EventAttendanceActivity.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.IdempotencyKey == identity, ct); var row = await _db.EventAttendance.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenant && x.EventId == eventId && x.UserId == userId, ct); if (replay is not null && row is not null) { await tx.CommitAsync(ct); return new(new { member = Member(user), mutation = AttendanceMutation(row, replay.Action, replay.FromStatus ?? "not_checked_in", false, true, replay.Id) }); }
        var from = row?.AttendanceStatus ?? "not_checked_in"; if ((row?.AttendanceVersion ?? 0) != expected || action == "check_out" && from != "checked_in") return Conflict(); var to = action switch { "check_in" => "checked_in", "check_out" => "checked_out", "no_show" => "no_show", _ => "not_checked_in" }; var now = DateTime.UtcNow; if (row is null) { row = new EventAttendance { TenantId = tenant, EventId = eventId, UserId = userId, AttendanceStatus = to, AttendanceVersion = 1, StatusChangedAt = now, StatusChangedBy = actorId, CreatedAt = now, UpdatedAt = now }; _db.EventAttendance.Add(row); await _db.SaveChangesAsync(ct); } else { row.AttendanceStatus = to; row.AttendanceVersion++; row.StatusChangedAt = now; row.StatusChangedBy = actorId; row.UpdatedAt = now; } if (action == "check_in") { row.CheckedInAt = now; row.CheckedInBy = actorId; row.CheckedOutAt = null; } else if (action == "check_out") row.CheckedOutAt = now; else if (action == "undo") { row.CheckedInAt = null; row.CheckedInBy = null; row.CheckedOutAt = null; }
        var history = new EventAttendanceActivity { TenantId = tenant, EventId = eventId, AttendanceId = row.Id, UserId = userId, ActorUserId = actorId, AttendanceVersion = row.AttendanceVersion, Action = action, FromStatus = from, ToStatus = to, IdempotencyKey = identity, Reason = reason, Metadata = "{\"contract_version\":2}", CreatedAt = now }; _db.EventAttendanceActivity.Add(history); await _db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return new(new { member = Member(user), mutation = AttendanceMutation(row, action, from, true, false, history.Id) });
    }

    public async Task<EventPeopleResult> BulkAsync(int tenant, int eventId, int actorId, JsonElement body, CancellationToken ct) { if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty("operations", out var ops) || ops.ValueKind != JsonValueKind.Array || ops.GetArrayLength() is < 1 or > 100) return Validation("operations"); var results = new List<object>(); var index = 0; var succeeded = 0; foreach (var op in ops.EnumerateArray()) { var userId = Int(op, "user_id"); var action = Text(op, "action") ?? ""; var expected = Long(op, "expected_version"); var key = Text(op, "idempotency_key") ?? ""; var reason = Text(op, "reason"); EventPeopleResult result = action is "check_in" or "check_out" or "no_show" or "undo_attendance" ? await AttendanceAsync(tenant, eventId, userId, actorId, action == "undo_attendance" ? "undo" : action, expected, key, reason, ct) : await RegistrationAsync(tenant, eventId, userId, actorId, action, expected, key, reason, ct); if (result.Succeeded) { succeeded++; var mutation = result.Data!.GetType().GetProperty("mutation")?.GetValue(result.Data) ?? result.Data; results.Add(new { index, user_id = userId, action, expected_version = expected, success = true, mutation }); } else results.Add(new { index, user_id = userId, action, expected_version = expected, success = false, error = new { code = result.Error!.Code, message = result.Error.Message, field = result.Error.Field } }); index++; } return new(new { requested = index, succeeded, failed = index - succeeded, results }); }

    public async Task<EventPeopleResult> CsvAsync(int tenant, int eventId, int actorId, IReadOnlyDictionary<string, string?> input, CancellationToken ct) { var listed = await ListAsync(tenant, eventId, actorId, input.Concat(new[] { new KeyValuePair<string, string?>("page", "1"), new KeyValuePair<string, string?>("per_page", "100") }).GroupBy(x => x.Key).ToDictionary(x => x.Key, x => x.Last().Value), ct); if (!listed.Succeeded) return listed; var rows = (IEnumerable<object>)listed.Data!; var sb = new StringBuilder(); sb.AppendLine("Member ID,Member name,Engagement,Registration,Registration changed,Waitlist,Queue position,Queue sequence,Attendance,Attendance changed,Checked in,Checked out"); foreach (var item in rows) { dynamic x = item; var values = new object?[] { x.member.id, x.member.display_name, x.engagement.state, x.registration.state, x.registration.changed_at, x.waitlist.state, x.waitlist.position, x.waitlist.sequence, x.attendance.state, x.attendance.changed_at, x.attendance.checked_in_at, x.attendance.checked_out_at }; sb.AppendLine(string.Join(',', values.Select(Csv))); } return new(sb.ToString()); }

    private sealed record PersonFacts(User User, EventRegistration? Registration, EventWaitlistEntry? Waitlist, EventAttendance? Attendance);
    private async Task<PersonFacts> FactsAsync(Event evt, User user, CancellationToken ct) => new(user, await _db.EventRegistrations.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == evt.TenantId && x.EventId == evt.Id && x.UserId == user.Id && x.CapacityPoolKey == "event", ct), await _db.EventWaitlistEntries.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == evt.TenantId && x.EventId == evt.Id && x.UserId == user.Id && x.CapacityPoolKey == "event", ct), await _db.EventAttendance.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == evt.TenantId && x.EventId == evt.Id && x.UserId == user.Id, ct));
    private static object PersonResource(PersonFacts x) { var r = x.Registration; var w = x.Waitlist; var a = x.Attendance; return new { member = Member(x.User), engagement = new { state = "none", consumes_capacity = false }, registration = new { id = r?.Id, state = r?.RegistrationState, version = r?.RegistrationVersion, capacity_pool_key = r?.CapacityPoolKey ?? "event", allocation_key = r?.AllocationKey, changed_at = r?.StateChangedAt, confirmed_at = r?.ConfirmedAt }, waitlist = new { id = w?.Id, state = w?.QueueState, version = w?.QueueVersion, position = w?.QueueState is "waiting" or "offered" ? w.QueueSequence : (long?)null, sequence = w?.QueueSequence, offered_at = w?.OfferedAt, offer_expires_at = w?.OfferExpiresAt, accepted_at = w?.AcceptedAt }, attendance = AttendanceFact(a), management_actions = new { approve = r?.RegistrationState is "invited" or "pending", reject = r?.RegistrationState is "invited" or "pending", cancel = r?.RegistrationState == "confirmed", check_in = a?.AttendanceStatus is null or "not_checked_in" or "no_show", check_out = a?.AttendanceStatus == "checked_in", no_show = a?.AttendanceStatus is null or "not_checked_in", undo_attendance = a is not null && a.AttendanceStatus != "not_checked_in", idempotency_key_required = true }, privacy = new { sensitive_fields_redacted = true } }; }
    private static object AttendanceFact(EventAttendance? a) => new { id = a?.Id, state = a?.AttendanceStatus ?? "not_checked_in", version = a?.AttendanceVersion, changed_at = a?.StatusChangedAt, checked_in_at = a?.CheckedInAt, checked_out_at = a?.CheckedOutAt };
    private static object RegistrationMutation(EventRegistration x, bool changed, bool replay, long? history) => new { registration_id = x.Id, state = x.RegistrationState, version = x.RegistrationVersion, changed, idempotent_replay = replay, history_entry_id = history };
    private static object AttendanceMutation(EventAttendance x, string action, string from, bool changed, bool replay, long? history) => new { attendance_id = x.Id, event_id = x.EventId, user_id = x.UserId, action, from_state = from, to_state = x.AttendanceStatus, changed, idempotent_replay = replay, attendance_version = x.AttendanceVersion, changed_at = x.StatusChangedAt, checked_in_at = x.CheckedInAt, checked_out_at = x.CheckedOutAt, history_entry_id = history };
    private async Task<EventPeopleResult> ManageAsync(int tenant, int eventId, int actorId, CancellationToken ct) { var actor = await _db.Users.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == actorId && x.IsActive, ct); if (actor is null) return Forbidden(); var evt = await _db.Events.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == eventId, ct); if (evt is null) return Missing(); var allowed = IsAdmin(actor) || evt.CreatedById == actorId || evt.GroupId is int group && await _db.GroupMembers.IgnoreQueryFilters().AnyAsync(x => x.TenantId == tenant && x.GroupId == group && x.UserId == actorId && x.Status == "active" && (x.Role == "owner" || x.Role == "admin"), ct); return allowed ? new(evt) : Forbidden(); }
    private static EventPeopleResult Parse(IReadOnlyDictionary<string, string?> q) { var allowed = new HashSet<string>(["page", "per_page", "search", "registration_state", "waitlist_state", "attendance_state", "engagement_state", "sort", "direction"]); if (q.Keys.Any(x => !allowed.Contains(x))) return Validation("query"); var page = Number(q, "page", 1); var per = Number(q, "per_page", 20); var reg = Value(q, "registration_state"); var wait = Value(q, "waitlist_state"); var attendance = Value(q, "attendance_state"); var engagement = Value(q, "engagement_state"); var sort = Value(q, "sort") ?? "name"; var direction = Value(q, "direction") ?? "asc"; if (page < 1 || per is < 1 or > 100 || reg is not null && !RegistrationStates.Contains(reg) || wait is not null && !WaitlistStates.Contains(wait) || attendance is not null && !AttendanceStates.Contains(attendance) || engagement is not null && engagement is not ("none" or "interested") || sort is not ("name" or "registration_changed" or "queue_rank" or "attendance_changed") || direction is not ("asc" or "desc")) return Validation("query"); return new((page, per, Value(q, "search"), reg, wait, attendance, engagement, sort, direction)); }
    private async Task<object> MetricsAsync(int tenant, int eventId, CancellationToken ct) => new { confirmed = await _db.EventRegistrations.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenant && x.EventId == eventId && x.RegistrationState == "confirmed", ct), waitlisted = await _db.EventWaitlistEntries.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenant && x.EventId == eventId && (x.QueueState == "waiting" || x.QueueState == "offered"), ct), checked_in = await _db.EventAttendance.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenant && x.EventId == eventId && x.AttendanceStatus == "checked_in", ct), checked_out = await _db.EventAttendance.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenant && x.EventId == eventId && x.AttendanceStatus == "checked_out", ct), no_show = await _db.EventAttendance.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenant && x.EventId == eventId && x.AttendanceStatus == "no_show", ct), attended = await _db.EventAttendance.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenant && x.EventId == eventId && x.AttendanceStatus == "attended", ct) };
    private static object Capabilities() => new { view_roster = true, view_waitlist = true, manage_registration = true, manage_attendance = true, export_people = true, view_history = true }; private static object Member(User x) => new { id = x.Id, display_name = Name(x), avatar_url = x.AvatarUrl }; private static string Name(User x) => string.Join(' ', new[] { x.FirstName, x.LastName }.Where(s => !string.IsNullOrWhiteSpace(s)));
    private static string Csv(object? value) { var s = value?.ToString() ?? ""; if (s.Length > 0 && "=+-@\t\r".Contains(s[0])) s = "'" + s; return '"' + s.Replace("\"", "\"\"") + '"'; }
    private Task LockAsync(int tenant, int eventId, CancellationToken ct) => _db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenant}, {eventId})", ct); private static string Identity(string action, int tenant, int evt, int user, string key) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"event-people:v1:{action}:{tenant}:{evt}:{user}:{key.Trim()}"))).ToLowerInvariant(); private static bool IsAdmin(User x) => x.IsAdmin || x.IsSuperAdmin || x.IsTenantSuperAdmin || x.IsGod || x.Role is "admin" or "super_admin" or "god";
    private static int Number(IReadOnlyDictionary<string, string?> q, string key, int fallback) => q.TryGetValue(key, out var v) && int.TryParse(v, out var parsed) ? parsed : fallback; private static string? Value(IReadOnlyDictionary<string, string?> q, string key) => q.TryGetValue(key, out var v) && !string.IsNullOrWhiteSpace(v) ? v : null; private static int Int(JsonElement x, string name) => x.TryGetProperty(name, out var p) && p.TryGetInt32(out var v) ? v : 0; private static long Long(JsonElement x, string name) => x.TryGetProperty(name, out var p) && p.TryGetInt64(out var v) ? v : -1; private static string? Text(JsonElement x, string name) => x.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
    private static EventPeopleResult Missing() => new(null, Error: new("EVENT_REGISTRATION_MEMBER_NOT_FOUND", "Not found", 404)); private static EventPeopleResult Forbidden() => new(null, Error: new("EVENT_REGISTRATION_FORBIDDEN", "Forbidden", 403)); private static EventPeopleResult Conflict() => new(null, Error: new("EVENT_REGISTRATION_CONFLICT", "Version or transition conflict", 409)); private static EventPeopleResult Validation(string field) => new(null, Error: new("EVENT_REGISTRATION_VALIDATION_FAILED", "Validation failed", 422, field));
}
