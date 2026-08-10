// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record EventBroadcastError(string Code, string Message, int Status, string? Field = null);
public sealed record EventBroadcastResult(object? Data, EventBroadcastError? Error = null, int Status = 200)
{
    public bool Succeeded => Error is null;
}
public sealed record EventBroadcastCollection(object Items, object Meta);
public sealed record EventBroadcastDetail(object broadcast, object history, object history_meta);

public sealed class EventBroadcastService
{
    private static readonly string[] Variants = ["announcement", "follow_up", "review_request"];
    private static readonly string[] Segments = ["registration_confirmed", "waitlist_active", "attendance_attended", "attendance_no_show"];
    private static readonly string[] Channels = ["email", "in_app", "push"];
    private readonly NexusDbContext _db;
    private readonly SafeguardingInteractionPolicy _safeguarding;
    public EventBroadcastService(NexusDbContext db, SafeguardingInteractionPolicy safeguarding) { _db = db; _safeguarding = safeguarding; }

    public async Task<EventBroadcastResult> PreviewAsync(int tenantId, int eventId, int actorId, JsonElement body, CancellationToken ct)
    {
        var parsed = ParseContent(body, false); if (parsed.Error is not null) return parsed;
        var input = ((string Variant, string[] Segments, string[] Channels, string? Body))parsed.Data!;
        var access = await EventAccessAsync(tenantId, eventId, actorId, ct); if (access.Error is not null) return access;
        var audience = await AudienceAsync((Event)access.Data!, actorId, input.Segments, true, ct); if (audience.Error is not null) return audience;
        var a = ((int[] Ids, Dictionary<string, int> Counts))audience.Data!;
        return new(new { contract_version = 1, event_id = eventId, variant = input.Variant, segments = input.Segments, channels = input.Channels, recipient_count = a.Ids.Length, delivery_count = a.Ids.Length * input.Channels.Length, segment_counts = a.Counts, generated_at = DateTime.UtcNow });
    }

    public async Task<EventBroadcastResult> CreateAsync(int tenantId, int eventId, int actorId, JsonElement body, string key, CancellationToken ct)
    {
        var keyError = KeyError(key); if (keyError is not null) return keyError; var parsed = ParseContent(body, true); if (parsed.Error is not null) return parsed;
        var input = ((string Variant, string[] Segments, string[] Channels, string? Body))parsed.Data!; var keyHash = KeyHash(key); var contentHash = Hash(input.Body!);
        var requestHash = HashJson(new { action = "created", event_id = eventId, actor_user_id = actorId, variant = input.Variant, segments = input.Segments, channels = input.Channels, content_hash = contentHash });
        await using var tx = await _db.Database.BeginTransactionAsync(ct); await LockAsync(tenantId, eventId, ct);
        var replay = await ReplayAsync(tenantId, keyHash, "created", requestHash, ct); if (replay.Error is not null) return replay;
        if (replay.Data is EventBroadcastHistory old) { await tx.CommitAsync(ct); return await MutationAsync(tenantId, old.BroadcastId, actorId, false, ct); }
        var access = await EventAccessAsync(tenantId, eventId, actorId, ct); if (access.Error is not null) return access;
        var now = DateTime.UtcNow; var row = new EventBroadcast { TenantId = tenantId, EventId = eventId, Variant = input.Variant, AudienceSegments = JsonSerializer.Serialize(input.Segments), Channels = JsonSerializer.Serialize(input.Channels), Body = input.Body!, ContentHash = contentHash, CreatedByUserId = actorId, UpdatedByUserId = actorId, CreatedAt = now, UpdatedAt = now };
        _db.EventBroadcasts.Add(row); await _db.SaveChangesAsync(ct); _db.EventBroadcastHistory.Add(History(row, 1, "created", null, "draft", actorId, keyHash, requestHash, new { contract_version = 1, variant = input.Variant, segments = input.Segments, channels = input.Channels }, now)); await _db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return await MutationAsync(tenantId, row.Id, actorId, true, ct, 201);
    }

    public async Task<EventBroadcastResult> ReviseAsync(int tenantId, long id, int actorId, int expected, JsonElement body, string key, CancellationToken ct)
    {
        if (expected < 1) return Validation("expected_version");
        var keyError = KeyError(key); if (keyError is not null) return keyError; var parsed = ParseContent(body, true); if (parsed.Error is not null) return parsed;
        var input = ((string Variant, string[] Segments, string[] Channels, string? Body))parsed.Data!; var contentHash = Hash(input.Body!); var keyHash = KeyHash(key);
        var requestHash = HashJson(new { action = "revised", broadcast_id = id, actor_user_id = actorId, expected_version = expected, variant = input.Variant, segments = input.Segments, channels = input.Channels, content_hash = contentHash });
        await using var tx = await _db.Database.BeginTransactionAsync(ct); await LockAsync(tenantId, checked((int)id), ct); var access = await BroadcastAccessAsync(tenantId, id, actorId, ct); if (access.Error is not null) return access; var row = (EventBroadcast)access.Data!;
        var replay = await ReplayAsync(tenantId, keyHash, "revised", requestHash, ct); if (replay.Error is not null) return replay; if (replay.Data is not null) { await tx.CommitAsync(ct); return await MutationAsync(tenantId, id, actorId, false, ct); }
        if (row.Status != "draft" || row.BroadcastVersion != expected) return Conflict(); var now = DateTime.UtcNow; row.Variant = input.Variant; row.AudienceSegments = JsonSerializer.Serialize(input.Segments); row.Channels = JsonSerializer.Serialize(input.Channels); row.Body = input.Body!; row.ContentHash = contentHash; row.BroadcastVersion++; row.UpdatedByUserId = actorId; row.UpdatedAt = now;
        _db.EventBroadcastHistory.Add(History(row, row.BroadcastVersion, "revised", "draft", "draft", actorId, keyHash, requestHash, new { contract_version = 1, variant = input.Variant, segments = input.Segments, channels = input.Channels }, now)); await _db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return await MutationAsync(tenantId, id, actorId, true, ct);
    }

    public async Task<EventBroadcastResult> ScheduleAsync(int tenantId, long id, int actorId, int expected, DateTime? requestedAt, string key, CancellationToken ct)
    {
        if (expected < 1) return Validation("expected_version");
        var keyError = KeyError(key); if (keyError is not null) return keyError; var now = DateTime.UtcNow; var at = requestedAt?.ToUniversalTime() ?? now; if (at < now.AddMinutes(-1)) return Validation("scheduled_at"); var keyHash = KeyHash(key); var requestHash = HashJson(new { action = "scheduled", broadcast_id = id, actor_user_id = actorId, expected_version = expected, scheduled_at = requestedAt?.ToUniversalTime().ToString("O") ?? "immediate" });
        await using var tx = await _db.Database.BeginTransactionAsync(ct); await LockAsync(tenantId, checked((int)id), ct); var access = await BroadcastAccessAsync(tenantId, id, actorId, ct); if (access.Error is not null) return access; var row = (EventBroadcast)access.Data!;
        var replay = await ReplayAsync(tenantId, keyHash, "scheduled", requestHash, ct); if (replay.Error is not null) return replay; if (replay.Data is not null) { await tx.CommitAsync(ct); return await MutationAsync(tenantId, id, actorId, false, ct); } if (row.Status != "draft" || row.BroadcastVersion != expected) return Conflict();
        var evt = await _db.Events.IgnoreQueryFilters().SingleAsync(x => x.TenantId == tenantId && x.Id == row.EventId, ct); if (row.Variant != "announcement" && at < (evt.EndsAt ?? evt.StartsAt)) return Validation("scheduled_at");
        var segments = JsonSerializer.Deserialize<string[]>(row.AudienceSegments)!; var channels = JsonSerializer.Deserialize<string[]>(row.Channels)!; var audience = await AudienceAsync(evt, actorId, segments, true, ct); if (audience.Error is not null) return audience; var a = ((int[] Ids, Dictionary<string, int> Counts))audience.Data!; if (a.Ids.Length == 0) return Validation("segments");
        row.Status = "scheduled"; row.BroadcastVersion++; row.ScheduledAt = at; row.RecipientCount = a.Ids.Length; row.DeliveryCount = a.Ids.Length * channels.Length; row.ScheduledByUserId = actorId; row.UpdatedByUserId = actorId; row.UpdatedAt = now;
        foreach (var recipient in a.Ids) foreach (var channel in channels) _db.EventBroadcastDeliveries.Add(new EventBroadcastDelivery { TenantId = tenantId, EventId = row.EventId, BroadcastId = row.Id, FrozenBroadcastVersion = row.BroadcastVersion, RecipientUserId = recipient, Channel = channel, DeliveryKey = Hash($"event-broadcast-delivery-v1|{tenantId}|{row.EventId}|{row.Id}|{row.BroadcastVersion}|{recipient}|{channel}"), AvailableAt = at, CreatedAt = now, UpdatedAt = now });
        _db.EventBroadcastHistory.Add(History(row, row.BroadcastVersion, "scheduled", "draft", "scheduled", actorId, keyHash, requestHash, new { contract_version = 1, recipient_count = row.RecipientCount, delivery_count = row.DeliveryCount, segment_counts = a.Counts, segments, channels, scheduled_at = at }, now)); await _db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return await MutationAsync(tenantId, id, actorId, true, ct);
    }

    public async Task<EventBroadcastResult> CancelAsync(int tenantId, long id, int actorId, int expected, string reason, string key, CancellationToken ct)
    {
        if (expected < 1) return Validation("expected_version");
        if (string.IsNullOrWhiteSpace(reason) || reason.Trim().Length > 500) return Validation("reason"); var keyError = KeyError(key); if (keyError is not null) return keyError; var keyHash = KeyHash(key); var requestHash = HashJson(new { action = "cancelled", broadcast_id = id, actor_user_id = actorId, expected_version = expected, reason = reason.Trim() });
        await using var tx = await _db.Database.BeginTransactionAsync(ct); await LockAsync(tenantId, checked((int)id), ct); var access = await BroadcastAccessAsync(tenantId, id, actorId, ct); if (access.Error is not null) return access; var row = (EventBroadcast)access.Data!; var replay = await ReplayAsync(tenantId, keyHash, "cancelled", requestHash, ct); if (replay.Error is not null) return replay; if (replay.Data is not null) { await tx.CommitAsync(ct); return await MutationAsync(tenantId, id, actorId, false, ct); }
        if (row.BroadcastVersion != expected || row.Status is not ("draft" or "scheduled")) return Conflict(); if (await _db.EventBroadcastDeliveries.IgnoreQueryFilters().AnyAsync(x => x.TenantId == tenantId && x.BroadcastId == id && (x.Status == "processing" || x.Status == "delivered"), ct)) return Conflict(); var from = row.Status; var now = DateTime.UtcNow; var deliveries = await _db.EventBroadcastDeliveries.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.BroadcastId == id && (x.Status == "pending" || x.Status == "retry")).ToListAsync(ct); foreach (var d in deliveries) { d.Status = "cancelled"; d.CancelledAt = now; d.ClaimToken = null; d.ClaimedAt = null; d.NextAttemptAt = null; d.UpdatedAt = now; }
        row.Status = "cancelled"; row.BroadcastVersion++; row.CancelledByUserId = actorId; row.CancelledAt = now; row.UpdatedByUserId = actorId; row.UpdatedAt = now; _db.EventBroadcastHistory.Add(History(row, row.BroadcastVersion, "cancelled", from, "cancelled", actorId, keyHash, requestHash, new { contract_version = 1, reason_recorded = true, cancelled_delivery_count = deliveries.Count }, now)); await _db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return await MutationAsync(tenantId, id, actorId, true, ct);
    }

    public async Task<EventBroadcastResult> RetryAsync(int tenantId, long id, int actorId, int expected, string key, CancellationToken ct)
    {
        if (expected < 1) return Validation("expected_version");
        var keyError = KeyError(key); if (keyError is not null) return keyError; var keyHash = KeyHash(key); var requestHash = HashJson(new { action = "retried", broadcast_id = id, actor_user_id = actorId, expected_version = expected }); await using var tx = await _db.Database.BeginTransactionAsync(ct); await LockAsync(tenantId, checked((int)id), ct); var access = await BroadcastAccessAsync(tenantId, id, actorId, ct); if (access.Error is not null) return access; var row = (EventBroadcast)access.Data!; var replay = await ReplayAsync(tenantId, keyHash, "retried", requestHash, ct); if (replay.Error is not null) return replay; if (replay.Data is not null) { await tx.CommitAsync(ct); return await MutationAsync(tenantId, id, actorId, false, ct); } if (row.Status != "failed" || row.BroadcastVersion != expected) return Conflict();
        var dead = await _db.EventBroadcastDeliveries.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.BroadcastId == id && x.Status == "dead_letter").ToListAsync(ct); if (dead.Count == 0) return Conflict(); var now = DateTime.UtcNow; foreach (var d in dead) { d.Status = "retry"; d.Attempts = 0; d.AvailableAt = now; d.NextAttemptAt = now; d.ClaimToken = null; d.ClaimedAt = null; d.DeadLetteredAt = null; d.LastErrorCode = null; d.UpdatedAt = now; } row.Status = "scheduled"; row.BroadcastVersion++; row.ScheduledAt = now; row.DeadLetterCount = 0; row.FailureCode = null; row.FailedAt = null; row.UpdatedByUserId = actorId; row.UpdatedAt = now; _db.EventBroadcastHistory.Add(History(row, row.BroadcastVersion, "retried", "failed", "scheduled", actorId, keyHash, requestHash, new { contract_version = 1, reset_delivery_count = dead.Count }, now)); await _db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return await MutationAsync(tenantId, id, actorId, true, ct);
    }

    public async Task<EventBroadcastResult> ListAsync(int tenantId, int eventId, int actorId, int page, int perPage, CancellationToken ct)
    {
        if (page < 1 || perPage < 1) return Validation(page < 1 ? "page" : "per_page"); perPage = Math.Min(100, perPage); var access = await EventAccessAsync(tenantId, eventId, actorId, ct); if (access.Error is not null) return access; var query = _db.EventBroadcasts.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.EventId == eventId); var total = await query.CountAsync(ct); var rows = await query.OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).Skip((page - 1) * perPage).Take(perPage).ToListAsync(ct); return new(new EventBroadcastCollection(rows.Select(x => Resource(x, false)).ToList(), Meta(page, perPage, total)));
    }

    public async Task<EventBroadcastResult> ShowAsync(int tenantId, long id, int actorId, int historyPage, int historyPerPage, CancellationToken ct)
    {
        if (historyPage < 1 || historyPerPage < 1) return Validation(historyPage < 1 ? "history_page" : "history_per_page"); historyPerPage = Math.Min(100, historyPerPage); var access = await BroadcastAccessAsync(tenantId, id, actorId, ct); if (access.Error is not null) return access; return new(await DetailAsync((EventBroadcast)access.Data!, historyPage, historyPerPage, ct));
    }

    private async Task<EventBroadcastResult> MutationAsync(int tenant, long id, int actor, bool changed, CancellationToken ct, int status = 200) { var access = await BroadcastAccessAsync(tenant, id, actor, ct); if (access.Error is not null) return access; var detail = await DetailAsync((EventBroadcast)access.Data!, 1, 50, ct); return new(new { detail.broadcast, detail.history, detail.history_meta, changed, idempotent_replay = !changed }, Status: status); }
    private async Task<EventBroadcastDetail> DetailAsync(EventBroadcast row, int page, int perPage, CancellationToken ct) { var q = _db.EventBroadcastHistory.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == row.TenantId && x.BroadcastId == row.Id); var total = await q.CountAsync(ct); var pages = total == 0 ? 0 : (int)Math.Ceiling(total / (double)perPage); page = pages == 0 ? 1 : Math.Min(page, pages); var history = await q.OrderBy(x => x.BroadcastVersion).ThenBy(x => x.Id).Skip((page - 1) * perPage).Take(perPage).ToListAsync(ct); return new(Resource(row, true), history.Select(HistoryResource).ToList(), Meta(page, perPage, total)); }

    private async Task<EventBroadcastResult> AudienceAsync(Event evt, int actor, string[] segments, bool policy, CancellationToken ct)
    {
        var counts = new Dictionary<string, int>(); var ids = new HashSet<int>(); foreach (var segment in segments) { IQueryable<int> query = segment switch { "registration_confirmed" => _db.EventRegistrations.IgnoreQueryFilters().Where(x => x.TenantId == evt.TenantId && x.EventId == evt.Id && x.RegistrationState == "confirmed").Select(x => x.UserId), "waitlist_active" => _db.EventWaitlistEntries.IgnoreQueryFilters().Where(x => x.TenantId == evt.TenantId && x.EventId == evt.Id && (x.QueueState == "waiting" || (x.QueueState == "offered" && x.OfferExpiresAt > DateTime.UtcNow))).Select(x => x.UserId), "attendance_attended" => _db.EventAttendance.IgnoreQueryFilters().Where(x => x.TenantId == evt.TenantId && x.EventId == evt.Id && (x.AttendanceStatus == "checked_in" || x.AttendanceStatus == "checked_out" || x.AttendanceStatus == "attended")).Select(x => x.UserId), _ => _db.EventAttendance.IgnoreQueryFilters().Where(x => x.TenantId == evt.TenantId && x.EventId == evt.Id && x.AttendanceStatus == "no_show").Select(x => x.UserId) }; var segmentIds = await query.Join(_db.Users.IgnoreQueryFilters().Where(x => x.TenantId == evt.TenantId && x.IsActive), id => id, user => user.Id, (id, _) => id).Where(x => x != evt.CreatedById).Distinct().ToListAsync(ct); counts[segment] = segmentIds.Count; foreach (var id in segmentIds) ids.Add(id); }
        var sorted = ids.Order().ToArray(); if (policy && sorted.Length > 0) try { await _safeguarding.AssertManyLocalContactsAllowedAsync(actor, sorted, evt.TenantId, "event_broadcast", ct); } catch (SafeguardingPolicyException) { return new(null, new("SAFEGUARDING_POLICY_DENIED", "Safeguarding policy denied contact", 403)); } return new((sorted, counts));
    }

    private async Task<EventBroadcastResult> EventAccessAsync(int tenant, int eventId, int actor, CancellationToken ct) { var user = await _db.Users.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == actor && x.IsActive, ct); if (user is null) return Forbidden(); var evt = await _db.Events.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == eventId, ct); if (evt is null) return Missing(); var allowed = IsAdmin(user) || evt.CreatedById == actor || evt.GroupId is int groupId && await _db.GroupMembers.IgnoreQueryFilters().AnyAsync(x => x.TenantId == tenant && x.GroupId == groupId && x.UserId == actor && x.Status == "active" && (x.Role == "owner" || x.Role == "admin"), ct); return allowed ? new(evt) : Forbidden(); }
    private async Task<EventBroadcastResult> BroadcastAccessAsync(int tenant, long id, int actor, CancellationToken ct) { var row = await _db.EventBroadcasts.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == id, ct); if (row is null) return Missing(); var access = await EventAccessAsync(tenant, row.EventId, actor, ct); return access.Error is null ? new(row) : access; }
    private async Task<EventBroadcastResult> ReplayAsync(int tenant, string key, string action, string request, CancellationToken ct) { var old = await _db.EventBroadcastHistory.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.IdempotencyHash == key, ct); return old is null ? new(null) : old.Action == action && old.RequestHash == request ? new(old) : Conflict(); }
    private static EventBroadcastResult ParseContent(JsonElement body, bool requireBody) { if (body.ValueKind != JsonValueKind.Object || !Text(body, "variant", out var variant) || !Variants.Contains(variant) || !Array(body, "segments", Segments, 4, out var segments) || !Array(body, "channels", Channels, 3, out var channels)) return Validation(!Text(body, "variant", out _) ? "variant" : !body.TryGetProperty("segments", out _) ? "segments" : "channels"); if ((variant is "follow_up" or "review_request") && segments.Any(x => x is "registration_confirmed" or "waitlist_active")) return Validation("segments"); string? prose = null; if (requireBody && (!Text(body, "body", out prose) || string.IsNullOrWhiteSpace(prose) || prose.Length > 20_000)) return Validation("body"); return new((variant, segments, channels, prose)); }
    private static bool Array(JsonElement body, string name, string[] allowed, int max, out string[] values) { values = []; if (!body.TryGetProperty(name, out var node) || node.ValueKind != JsonValueKind.Array) return false; values = node.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToArray(); return values.Length is > 0 && values.Length <= max && values.Distinct().Count() == values.Length && values.All(allowed.Contains); }
    private static bool Text(JsonElement body, string name, out string value) { value = ""; return body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var node) && node.ValueKind == JsonValueKind.String && (value = node.GetString() ?? "") is not null; }
    private static EventBroadcastHistory History(EventBroadcast row, int version, string action, string? from, string to, int? actor, string key, string request, object metadata, DateTime now) => new() { TenantId = row.TenantId, EventId = row.EventId, BroadcastId = row.Id, BroadcastVersion = version, Action = action, FromStatus = from, ToStatus = to, ActorUserId = actor, IdempotencyHash = key, RequestHash = request, ContentHash = row.ContentHash, Metadata = JsonSerializer.Serialize(metadata), CreatedAt = now };
    private static object Resource(EventBroadcast x, bool body) => new { contract_version = 1, id = x.Id, event_id = x.EventId, variant = x.Variant, status = x.Status, version = x.BroadcastVersion, audience = new { segments = JsonSerializer.Deserialize<string[]>(x.AudienceSegments), recipient_count = x.RecipientCount }, channels = JsonSerializer.Deserialize<string[]>(x.Channels), body = body ? x.Body : null, delivery = new { total = x.DeliveryCount, delivered = x.DeliveredCount, suppressed = x.SuppressedCount, dead_lettered = x.DeadLetterCount, failure_code = x.FailureCode }, capabilities = new { edit = x.Status == "draft", schedule = x.Status == "draft", cancel = x.Status is "draft" or "scheduled", retry = x.Status == "failed" }, scheduled_at = x.ScheduledAt, cancelled_at = x.CancelledAt, sent_at = x.SentAt, failed_at = x.FailedAt, created_at = x.CreatedAt, updated_at = x.UpdatedAt };
    private static object HistoryResource(EventBroadcastHistory x) => new { id = x.Id, version = x.BroadcastVersion, action = x.Action, from_status = x.FromStatus, to_status = x.ToStatus, metadata = JsonSerializer.Deserialize<Dictionary<string, object?>>(x.Metadata), created_at = x.CreatedAt };
    private static object Meta(int page, int perPage, int total) { var pages = total == 0 ? 0 : (int)Math.Ceiling(total / (double)perPage); return new { current_page = page, per_page = perPage, total, total_pages = pages, has_more = page < pages }; }
    private Task LockAsync(int tenant, int id, CancellationToken ct) => _db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenant}, {id})", ct);
    private static bool IsAdmin(User x) => x.IsAdmin || x.IsSuperAdmin || x.IsTenantSuperAdmin || x.IsGod || x.Role is "admin" or "super_admin" or "god";
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant(); private static string HashJson(object value) => Hash(JsonSerializer.Serialize(value)); private static string KeyHash(string key) => Hash("event-broadcast:v1:" + key.Trim());
    private static EventBroadcastResult? KeyError(string key) => string.IsNullOrWhiteSpace(key) || key.Trim().Length > 191 ? Validation("idempotency_key") : null;
    private static EventBroadcastResult Missing() => new(null, new("EVENT_BROADCAST_NOT_FOUND", "Event broadcast not found", 404)); private static EventBroadcastResult Forbidden() => new(null, new("EVENT_BROADCAST_FORBIDDEN", "Forbidden", 403)); private static EventBroadcastResult Conflict() => new(null, new("EVENT_BROADCAST_CONFLICT", "Invalid broadcast state or idempotency conflict", 409)); private static EventBroadcastResult Validation(string field) => new(null, new("EVENT_BROADCAST_VALIDATION_FAILED", "Validation failed", 422, field));
}
