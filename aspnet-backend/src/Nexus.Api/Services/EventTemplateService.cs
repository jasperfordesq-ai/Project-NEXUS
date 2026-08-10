// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record EventTemplateError(string Code, string Message, int Status, string? Field = null);
public sealed record EventTemplateResult(object? Data, EventTemplateError? Error = null, int Status = 200)
{
    public bool Succeeded => Error is null;
}
public sealed record EventTemplateCollection(object Items, object Meta);

public sealed class EventTemplateService
{
    public const short SchemaVersion = 2;
    public static readonly string[] CopiedFields = ["title", "description", "category_id", "group_id", "location", "latitude", "longitude", "max_attendees", "is_online", "allow_remote_attendance", "timezone", "all_day", "federated_visibility"];
    public static readonly string[] SkippedFields = ["online_link", "video_url", "image_url", "cover_image", "start_time", "end_time", "id", "tenant_id", "user_id", "created_at", "updated_at", "status", "publication_status", "operational_status", "lifecycle_version", "calendar_sequence", "participants", "rsvps", "registrations", "waitlist", "invitations", "private_answers", "guests", "staff", "attendance", "tickets", "wallet_transactions", "reminders", "notification_outbox", "audit_history"];
    private static readonly HashSet<string> SafeOverrides = ["title", "description", "category_id", "group_id", "location", "latitude", "longitude", "max_attendees", "is_online", "allow_remote_attendance", "timezone", "all_day"];
    private readonly NexusDbContext _db;
    public EventTemplateService(NexusDbContext db) => _db = db;

    public async Task<EventTemplateResult> PreviewCaptureAsync(int tenantId, int sourceEventId, int actorId, CancellationToken ct)
    {
        var access = await SourceAccessAsync(tenantId, sourceEventId, actorId, ct); if (access.Error is not null) return access;
        var source = (Event)access.Data!; var payload = Capture(source); var hash = HashJson(payload);
        return new(new { kind = "capture", schema_version = SchemaVersion, source_event_id = source.Id, source_lifecycle_version = source.LifecycleVersion, source_calendar_sequence = source.CalendarSequence, configuration = payload, snapshot_hash = hash, copied_fields = CopiedFields, skipped_fields = SkippedFields, checklist = Checklist() });
    }

    public async Task<EventTemplateResult> CaptureAsync(int tenantId, int sourceEventId, int actorId, string key, CancellationToken ct)
    {
        var keyError = ValidateKey(key); if (keyError is not null) return keyError;
        await using var tx = await _db.Database.BeginTransactionAsync(ct); await LockAsync(tenantId, sourceEventId, ct);
        var access = await SourceAccessAsync(tenantId, sourceEventId, actorId, ct); if (access.Error is not null) return access;
        var source = (Event)access.Data!; var keyHash = Hash(key); var requestHash = HashJson(new { action = "captured", source_event_id = sourceEventId, actor_user_id = actorId });
        var replay = await ReplayAsync(tenantId, keyHash, "captured", requestHash, ct);
        if (replay.Error is not null) return replay; if (replay.Data is EventTemplateAudit audit) { await tx.CommitAsync(ct); return new(new { template = await ResourceAsync(audit.TemplateId, actorId, ct), changed = false, idempotent_replay = true }); }
        var payload = Capture(source); var now = DateTime.UtcNow;
        var template = new EventTemplate { TenantId = tenantId, PublicId = Guid.NewGuid(), SourceEventId = sourceEventId, CreatedByUserId = actorId, CreatedAt = now, UpdatedAt = now };
        _db.EventTemplates.Add(template); await _db.SaveChangesAsync(ct);
        var version = Version(template, source, 1, actorId, keyHash, requestHash, payload, now); _db.EventTemplateVersions.Add(version); await _db.SaveChangesAsync(ct);
        _db.EventTemplateAudits.Add(Audit(template, version, "captured", actorId, keyHash, requestHash, new { schema_version = SchemaVersion, payload_hash = version.PayloadHash, copied_fields = CopiedFields, skipped_fields = SkippedFields }, now));
        await _db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new(new { template = await ResourceAsync(template.Id, actorId, ct), changed = true, idempotent_replay = false }, Status: 201);
    }

    public async Task<EventTemplateResult> ReviseAsync(int tenantId, long templateId, int actorId, int expectedVersion, string key, CancellationToken ct)
    {
        var keyError = ValidateKey(key); if (keyError is not null) return keyError;
        await using var tx = await _db.Database.BeginTransactionAsync(ct); await LockAsync(tenantId, checked((int)templateId), ct);
        var access = await TemplateAccessAsync(tenantId, templateId, actorId, true, ct); if (access.Error is not null) return access;
        var template = (EventTemplate)access.Data!; var source = await _db.Events.IgnoreQueryFilters().SingleAsync(x => x.TenantId == tenantId && x.Id == template.SourceEventId, ct);
        var keyHash = Hash(key); var requestHash = HashJson(new { action = "revised", template_id = templateId, expected_version = expectedVersion, source_lifecycle_version = source.LifecycleVersion });
        var replay = await ReplayAsync(tenantId, keyHash, "revised", requestHash, ct); if (replay.Error is not null) return replay;
        if (replay.Data is not null) { await tx.CommitAsync(ct); return new(new { template = await ResourceAsync(templateId, actorId, ct), changed = false, idempotent_replay = true }); }
        if (template.Status == "archived" || template.CurrentVersion != expectedVersion) return Conflict();
        var now = DateTime.UtcNow; var payload = Capture(source); var version = Version(template, source, expectedVersion + 1, actorId, keyHash, requestHash, payload, now);
        _db.EventTemplateVersions.Add(version); template.CurrentVersion++; template.UpdatedAt = now; await _db.SaveChangesAsync(ct);
        _db.EventTemplateAudits.Add(Audit(template, version, "revised", actorId, keyHash, requestHash, new { schema_version = SchemaVersion, payload_hash = version.PayloadHash, copied_fields = CopiedFields, skipped_fields = SkippedFields }, now));
        await _db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new(new { template = await ResourceAsync(templateId, actorId, ct), changed = true, idempotent_replay = false });
    }

    public async Task<EventTemplateResult> ArchiveAsync(int tenantId, long templateId, int actorId, int expectedVersion, string reason, string key, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(reason) || reason.Trim().Length > 500) return Validation("reason");
        var keyError = ValidateKey(key); if (keyError is not null) return keyError;
        await using var tx = await _db.Database.BeginTransactionAsync(ct); await LockAsync(tenantId, checked((int)templateId), ct);
        var access = await TemplateAccessAsync(tenantId, templateId, actorId, true, ct); if (access.Error is not null) return access;
        var template = (EventTemplate)access.Data!; var keyHash = Hash(key); var requestHash = HashJson(new { action = "archived", template_id = templateId, expected_version = expectedVersion, reason = reason.Trim() });
        var replay = await ReplayAsync(tenantId, keyHash, "archived", requestHash, ct); if (replay.Error is not null) return replay;
        if (replay.Data is not null) { await tx.CommitAsync(ct); return new(new { template = await ResourceAsync(templateId, actorId, ct), changed = false, idempotent_replay = true }); }
        if (template.Status == "archived" || template.CurrentVersion != expectedVersion) return Conflict();
        var version = await CurrentVersionAsync(template, ct); var now = DateTime.UtcNow; template.Status = "archived"; template.ArchivedByUserId = actorId; template.ArchivedAt = now; template.ArchiveReason = reason.Trim(); template.UpdatedAt = now;
        _db.EventTemplateAudits.Add(Audit(template, version, "archived", actorId, keyHash, requestHash, new { archive_reason_recorded = true }, now)); await _db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new(new { template = await ResourceAsync(templateId, actorId, ct), changed = true, idempotent_replay = false });
    }

    public async Task<EventTemplateResult> PreviewMaterializationAsync(int tenantId, long templateId, int actorId, JsonElement body, CancellationToken ct)
    {
        var input = await MaterializationInputAsync(tenantId, templateId, actorId, body, ct); if (input.Error is not null) return input;
        var data = ((EventTemplate Template, EventTemplateVersion Version, Dictionary<string, object?> Effective, string[] Overrides, DateTime Start, DateTime? End))input.Data!;
        return new(MaterializationPreview(data.Template, data.Version, data.Effective, data.Overrides, data.Start, data.End));
    }

    public async Task<EventTemplateResult> MaterializeAsync(int tenantId, long templateId, int actorId, JsonElement body, string key, CancellationToken ct)
    {
        var keyError = ValidateKey(key); if (keyError is not null) return keyError;
        await using var tx = await _db.Database.BeginTransactionAsync(ct); await LockAsync(tenantId, checked((int)templateId), ct);
        var input = await MaterializationInputAsync(tenantId, templateId, actorId, body, ct); if (input.Error is not null) return input;
        var data = ((EventTemplate Template, EventTemplateVersion Version, Dictionary<string, object?> Effective, string[] Overrides, DateTime Start, DateTime? End))input.Data!;
        var keyHash = Hash(key); var requestHash = HashJson(new { action = "materialized", template_id = templateId, template_version = data.Version.VersionNumber, start_time = data.Start, end_time = data.End, overrides = data.Effective });
        var replay = await ReplayAsync(tenantId, keyHash, "materialized", requestHash, ct); if (replay.Error is not null) return replay;
        if (replay.Data is EventTemplateAudit oldAudit)
        {
            var old = await _db.EventTemplateMaterializations.IgnoreQueryFilters().SingleAsync(x => x.TenantId == tenantId && x.CreatedEventId == oldAudit.MaterializedEventId, ct); var oldEvent = await _db.Events.IgnoreQueryFilters().SingleAsync(x => x.Id == old.CreatedEventId, ct); await tx.CommitAsync(ct);
            return new(MaterializationResource(oldEvent, old, false));
        }
        var now = DateTime.UtcNow; var created = EventFromPayload(tenantId, actorId, data.Effective, data.Start, data.End, now); _db.Events.Add(created); await _db.SaveChangesAsync(ct);
        var material = new EventTemplateMaterialization { TenantId = tenantId, TemplateId = templateId, TemplateVersionId = data.Version.Id, TemplateVersionNumber = data.Version.VersionNumber, SourceEventId = data.Template.SourceEventId, CreatedEventId = created.Id, MaterializedByUserId = actorId, TemplatePayloadHash = data.Version.PayloadHash, EffectivePayloadHash = HashJson(data.Effective), IdempotencyHash = keyHash, RequestHash = requestHash, ScheduleStartUtc = data.Start, ScheduleEndUtc = data.End, ScheduleTimezone = GetString(data.Effective, "timezone") ?? "UTC", ScheduleAllDay = GetBool(data.Effective, "all_day"), OverrideFields = JsonSerializer.Serialize(data.Overrides), CreatedAt = now };
        _db.EventTemplateMaterializations.Add(material); await _db.SaveChangesAsync(ct);
        _db.EventTemplateAudits.Add(Audit(data.Template, data.Version, "materialized", actorId, keyHash, requestHash, new { materialization_id = material.Id, effective_payload_hash = material.EffectivePayloadHash, override_fields = data.Overrides, federation_normalized = true, publication_workflow = "fresh_draft" }, now, created.Id)); await _db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new(MaterializationResource(created, material, true), Status: 201);
    }

    public async Task<EventTemplateResult> ListAsync(int tenantId, int actorId, string status, int? sourceEventId, string? search, long? cursor, int perPage, CancellationToken ct)
    {
        if (status is not ("active" or "archived" or "all")) return Validation("status"); perPage = Math.Clamp(perPage, 1, 100);
        var actor = await ActorAsync(tenantId, actorId, ct); if (actor is null) return Forbidden();
        var query = _db.EventTemplates.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId);
        if (!IsAdmin(actor)) query = query.Where(x => x.CreatedByUserId == actorId);
        if (status != "all") query = query.Where(x => x.Status == status); if (sourceEventId is not null) query = query.Where(x => x.SourceEventId == sourceEventId); if (cursor is not null) query = query.Where(x => x.Id < cursor);
        if (!string.IsNullOrWhiteSpace(search)) { var q = search.Trim(); var sourceIds = _db.Events.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && EF.Functions.ILike(x.Title, $"%{q}%")).Select(x => x.Id); query = query.Where(x => sourceIds.Contains(x.SourceEventId)); }
        var rows = await query.OrderByDescending(x => x.Id).Take(perPage + 1).ToListAsync(ct); var hasMore = rows.Count > perPage; if (hasMore) rows.RemoveAt(rows.Count - 1);
        var data = new List<object>(); foreach (var row in rows) data.Add(await ResourceAsync(row.Id, actorId, ct));
        return new(new EventTemplateCollection(data, new { per_page = perPage, next_cursor = hasMore ? rows.Last().Id.ToString() : null, has_more = hasMore }));
    }

    public async Task<EventTemplateResult> ShowAsync(int tenantId, long id, int actorId, CancellationToken ct)
    { var access = await TemplateAccessAsync(tenantId, id, actorId, false, ct); return access.Error is not null ? access : new(await ResourceAsync(id, actorId, ct)); }

    public async Task<EventTemplateResult> HistoryAsync(int tenantId, long id, int actorId, long? cursor, int perPage, CancellationToken ct)
    {
        var access = await TemplateAccessAsync(tenantId, id, actorId, false, ct); if (access.Error is not null) return access; perPage = Math.Clamp(perPage, 1, 100);
        var query = _db.EventTemplateAudits.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && x.TemplateId == id); if (cursor is not null) query = query.Where(x => x.Id < cursor);
        var rows = await query.OrderByDescending(x => x.Id).Take(perPage + 1).ToListAsync(ct); var more = rows.Count > perPage; if (more) rows.RemoveAt(rows.Count - 1);
        var data = rows.Select(AuditResource).ToList(); return new(new EventTemplateCollection(data, new { per_page = perPage, next_cursor = more ? rows.Last().Id.ToString() : null, has_more = more }));
    }

    private async Task<EventTemplateResult> MaterializationInputAsync(int tenantId, long templateId, int actorId, JsonElement body, CancellationToken ct)
    {
        var access = await TemplateAccessAsync(tenantId, templateId, actorId, true, ct); if (access.Error is not null) return access; var template = (EventTemplate)access.Data!; if (template.Status != "active") return Conflict();
        if (!TryInt(body, "template_version", out var number) || !TryDate(body, "start_time", out var start) || start <= DateTime.UtcNow) return Validation("start_time");
        DateTime? end = null;
        if (body.TryGetProperty("end_time", out var ep) && ep.ValueKind != JsonValueKind.Null)
        {
            if (ep.ValueKind != JsonValueKind.String || !DateTime.TryParse(ep.GetString(), out var parsedEnd) || parsedEnd.ToUniversalTime() <= start) return Validation("end_time");
            end = parsedEnd.ToUniversalTime();
        }
        var version = await _db.EventTemplateVersions.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.TemplateId == templateId && x.VersionNumber == number, ct); if (version is null) return Missing();
        var effective = JsonSerializer.Deserialize<Dictionary<string, object?>>(version.Payload)!; var changed = new List<string>();
        if (body.TryGetProperty("overrides", out var overrides) && overrides.ValueKind == JsonValueKind.Object) foreach (var property in overrides.EnumerateObject()) { if (!SafeOverrides.Contains(property.Name)) return Validation("overrides"); effective[property.Name] = JsonValue(property.Value); changed.Add(property.Name); }
        effective["federated_visibility"] = "none"; if (!ValidatePayload(effective)) return Validation("overrides");
        return new((template, version, effective, changed.ToArray(), start, end));
    }

    private async Task<object> ResourceAsync(long id, int actorId, CancellationToken ct)
    {
        var template = await _db.EventTemplates.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.Id == id, ct); var source = await _db.Events.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.Id == template.SourceEventId, ct); var version = await CurrentVersionAsync(template, ct);
        var materials = await _db.EventTemplateMaterializations.IgnoreQueryFilters().CountAsync(x => x.TemplateId == id, ct); var audits = await _db.EventTemplateAudits.IgnoreQueryFilters().CountAsync(x => x.TemplateId == id, ct);
        var payload = JsonSerializer.Deserialize<Dictionary<string, object?>>(version.Payload)!; return new { id = template.Id, public_id = template.PublicId, status = template.Status, current_version = template.CurrentVersion, source_event = new { id = source.Id, title = source.Title, updated_at = source.UpdatedAt }, version = VersionResource(version, payload), usage = new { materialization_count = materials, audit_entry_count = audits }, archive = new { reason = template.Status == "archived" ? template.ArchiveReason : null, archived_at = template.Status == "archived" ? template.ArchivedAt : null }, capabilities = new { view = true, revise = template.Status == "active", archive = template.Status == "active", materialize = template.Status == "active", view_audit = true }, created_at = template.CreatedAt, updated_at = template.UpdatedAt };
    }

    private static object VersionResource(EventTemplateVersion version, Dictionary<string, object?> payload) => new { id = version.Id, number = version.VersionNumber, schema_version = version.SchemaVersion, configuration = payload, snapshot = new { hash = version.PayloadHash, source_lifecycle_version = version.SourceLifecycleVersion, source_calendar_sequence = version.SourceCalendarSequence, source_updated_at = version.SourceUpdatedAt, immutable = true }, copied_fields = JsonSerializer.Deserialize<string[]>(version.CopiedFields), skipped_fields = JsonSerializer.Deserialize<string[]>(version.SkippedFields), captured_at = version.CreatedAt };
    private static object MaterializationPreview(EventTemplate template, EventTemplateVersion version, Dictionary<string, object?> effective, string[] overrides, DateTime start, DateTime? end) => new { kind = "materialization", template_id = template.Id, template_version_id = version.Id, template_version = version.VersionNumber, source_event_id = template.SourceEventId, schema_version = SchemaVersion, template_snapshot_hash = version.PayloadHash, effective_snapshot_hash = HashJson(effective), configuration = effective, schedule = new { start_at = start, end_at = end, timezone = GetString(effective, "timezone") ?? "UTC", all_day = GetBool(effective, "all_day") }, copied_fields = CopiedFields, skipped_fields = SkippedFields, override_fields = overrides, checklist = Checklist(), will_create = new { publication_status = "draft", operational_status = "scheduled", recurring = false, publish = false, register = false, notify = false, federate = false } };
    private static object MaterializationResource(Event evt, EventTemplateMaterialization row, bool changed) => new { created_event = new { id = evt.Id, title = evt.Title, publication_status = "draft", operational_status = "scheduled", edit_path = $"/events/{evt.Id}/edit" }, provenance = new { id = row.Id, template_id = row.TemplateId, template_version = row.TemplateVersionNumber, source_event_id = row.SourceEventId, schema_version = row.SchemaVersion, schedule = new { start_at = row.ScheduleStartUtc, end_at = row.ScheduleEndUtc, timezone = row.ScheduleTimezone, all_day = row.ScheduleAllDay }, override_fields = JsonSerializer.Deserialize<string[]>(row.OverrideFields), federation_normalized = true, created_at = row.CreatedAt, immutable = true }, changed, idempotent_replay = !changed, workflow = new { fresh_draft = true, published = false, registrations_copied = false, notifications_sent = false, federated = false } };
    private static object AuditResource(EventTemplateAudit row) => new { id = row.Id, action = row.Action, template_version = row.TemplateVersionNumber, source_event_id = row.SourceEventId, materialized_event_id = row.MaterializedEventId, evidence = JsonSerializer.Deserialize<Dictionary<string, object?>>(row.Metadata), created_at = row.CreatedAt, immutable = true };

    private static EventTemplateVersion Version(EventTemplate template, Event source, int number, int actor, string keyHash, string requestHash, Dictionary<string, object?> payload, DateTime now) => new() { TenantId = template.TenantId, TemplateId = template.Id, SourceEventId = source.Id, VersionNumber = number, Payload = JsonSerializer.Serialize(payload), PayloadHash = HashJson(payload), CopiedFields = JsonSerializer.Serialize(CopiedFields), SkippedFields = JsonSerializer.Serialize(SkippedFields), SourceLifecycleVersion = source.LifecycleVersion, SourceCalendarSequence = source.CalendarSequence, SourceUpdatedAt = source.UpdatedAt, CapturedByUserId = actor, CaptureIdempotencyHash = keyHash, CaptureRequestHash = requestHash, CreatedAt = now };
    private static EventTemplateAudit Audit(EventTemplate template, EventTemplateVersion version, string action, int actor, string keyHash, string requestHash, object metadata, DateTime now, int? materialized = null) => new() { TenantId = template.TenantId, TemplateId = template.Id, TemplateVersionId = version.Id, TemplateVersionNumber = version.VersionNumber, SourceEventId = template.SourceEventId, MaterializedEventId = materialized, Action = action, ActorUserId = actor, IdempotencyHash = keyHash, RequestHash = requestHash, Metadata = JsonSerializer.Serialize(metadata), CreatedAt = now };
    private static Dictionary<string, object?> Capture(Event e) => new() { ["title"] = e.Title.Trim(), ["description"] = e.Description?.Trim() ?? "", ["category_id"] = e.CategoryId, ["group_id"] = e.GroupId, ["location"] = e.Location?.Trim(), ["latitude"] = e.Latitude, ["longitude"] = e.Longitude, ["max_attendees"] = e.MaxAttendees, ["is_online"] = e.IsOnline, ["allow_remote_attendance"] = e.AllowRemoteAttendance, ["timezone"] = string.IsNullOrWhiteSpace(e.Timezone) ? "UTC" : e.Timezone, ["all_day"] = e.AllDay, ["federated_visibility"] = e.FederatedVisibility is "listed" or "joinable" ? e.FederatedVisibility : "none" };
    private static Event EventFromPayload(int tenant, int actor, Dictionary<string, object?> p, DateTime start, DateTime? end, DateTime now) => new() { TenantId = tenant, CreatedById = actor, Title = GetString(p, "title")!, Description = GetString(p, "description"), CategoryId = GetInt(p, "category_id"), GroupId = GetInt(p, "group_id"), Location = GetString(p, "location"), Latitude = GetDouble(p, "latitude"), Longitude = GetDouble(p, "longitude"), MaxAttendees = GetInt(p, "max_attendees"), IsOnline = GetBool(p, "is_online"), AllowRemoteAttendance = GetBool(p, "allow_remote_attendance"), Timezone = GetString(p, "timezone") ?? "UTC", AllDay = GetBool(p, "all_day"), FederatedVisibility = "none", StartsAt = start, EndsAt = end, Status = "draft", PublicationStatus = "draft", OperationalStatus = "scheduled", CreatedAt = now, UpdatedAt = now };
    private async Task<EventTemplateResult> SourceAccessAsync(int tenant, int source, int actorId, CancellationToken ct) { var actor = await ActorAsync(tenant, actorId, ct); if (actor is null) return Forbidden(); var evt = await _db.Events.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == source, ct); if (evt is null) return Missing(); return IsAdmin(actor) || evt.CreatedById == actorId ? new(evt) : Forbidden(); }
    private async Task<EventTemplateResult> TemplateAccessAsync(int tenant, long id, int actorId, bool mutate, CancellationToken ct) { var actor = await ActorAsync(tenant, actorId, ct); if (actor is null) return Forbidden(); var template = await _db.EventTemplates.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == id, ct); if (template is null) return Missing(); return IsAdmin(actor) || template.CreatedByUserId == actorId ? new(template) : Forbidden(); }
    private Task<User?> ActorAsync(int tenant, int actor, CancellationToken ct) => _db.Users.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == actor && x.IsActive, ct);
    private static bool IsAdmin(User u) => u.IsAdmin || u.IsSuperAdmin || u.IsTenantSuperAdmin || u.IsGod || u.Role is "admin" or "super_admin" or "god";
    private Task<EventTemplateVersion> CurrentVersionAsync(EventTemplate t, CancellationToken ct) => _db.EventTemplateVersions.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.TenantId == t.TenantId && x.TemplateId == t.Id && x.VersionNumber == t.CurrentVersion, ct);
    private async Task<EventTemplateResult> ReplayAsync(int tenant, string keyHash, string action, string requestHash, CancellationToken ct) { var row = await _db.EventTemplateAudits.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.IdempotencyHash == keyHash, ct); return row is null ? new(null) : row.Action == action && row.RequestHash == requestHash ? new(row) : Conflict(); }
    private async Task LockAsync(int tenant, int id, CancellationToken ct) => await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenant}, {id})", ct);
    private static EventTemplateResult? ValidateKey(string key) => string.IsNullOrWhiteSpace(key) || key.Length is < 8 or > 191 ? Validation("idempotency_key") : null;
    private static bool ValidatePayload(Dictionary<string, object?> p) => !string.IsNullOrWhiteSpace(GetString(p, "title")) && !string.IsNullOrWhiteSpace(GetString(p, "timezone")) && GetInt(p, "max_attendees") is null or > 0 && GetDouble(p, "latitude") is null or >= -90 and <= 90 && GetDouble(p, "longitude") is null or >= -180 and <= 180;
    private static object[] Checklist() => [new { code = "safe_fields_only", passed = true }, new { code = "private_state_excluded", passed = true }, new { code = "draft_materialization", passed = true }];
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    private static string HashJson(object value) => Hash(JsonSerializer.Serialize(value));
    private static object? JsonValue(JsonElement e) => e.ValueKind switch { JsonValueKind.String => e.GetString(), JsonValueKind.Number when e.TryGetInt32(out var i) => i, JsonValueKind.Number => e.GetDouble(), JsonValueKind.True => true, JsonValueKind.False => false, JsonValueKind.Null => null, _ => null };
    private static bool TryInt(JsonElement body, string name, out int value) { value = 0; return body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var p) && p.TryGetInt32(out value) && value > 0; }
    private static bool TryDate(JsonElement body, string name, out DateTime value) { value = default; return body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String && DateTime.TryParse(p.GetString(), out value) && (value = value.ToUniversalTime()) != default; }
    private static string? GetString(Dictionary<string, object?> p, string k) => p.TryGetValue(k, out var v) ? v switch { string s => s, JsonElement { ValueKind: JsonValueKind.String } e => e.GetString(), _ => null } : null;
    private static int? GetInt(Dictionary<string, object?> p, string k) => p.TryGetValue(k, out var v) ? v switch { int i => i, long l => (int)l, JsonElement { ValueKind: JsonValueKind.Number } e when e.TryGetInt32(out var i) => i, _ => null } : null;
    private static double? GetDouble(Dictionary<string, object?> p, string k) => p.TryGetValue(k, out var v) ? v switch { double d => d, float f => f, decimal d => (double)d, JsonElement { ValueKind: JsonValueKind.Number } e => e.GetDouble(), _ => null } : null;
    private static bool GetBool(Dictionary<string, object?> p, string k) => p.TryGetValue(k, out var v) && v switch { bool b => b, JsonElement { ValueKind: JsonValueKind.True } => true, _ => false };
    private static EventTemplateResult Missing() => new(null, new("EVENT_TEMPLATE_NOT_FOUND", "Event template not found", 404));
    private static EventTemplateResult Forbidden() => new(null, new("EVENT_TEMPLATE_FORBIDDEN", "Forbidden", 403));
    private static EventTemplateResult Conflict() => new(null, new("EVENT_TEMPLATE_CONFLICT", "Event template conflict", 409));
    private static EventTemplateResult Validation(string field) => new(null, new("EVENT_TEMPLATE_VALIDATION_FAILED", "Validation failed", 422, field));
}
