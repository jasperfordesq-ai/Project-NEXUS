// Copyright Â© 2024â€“2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record EventConfigurationPolicyError(string Code, string Message, int Status, string? Field = null);
public sealed record EventConfigurationPolicyResult(object? Data, EventConfigurationPolicyError? Error = null)
{
    public bool Succeeded => Error is null;
}

public sealed class EventConfigurationPolicyService(NexusDbContext db)
{
    private const string StoreKey = "events.configuration";
    private static readonly IReadOnlyDictionary<string, object?> BaseDefaults = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
        ["creation_role"] = "members", ["moderation_required"] = false,
        ["registration_enabled"] = true, ["default_capacity"] = 0,
        ["guest_registration_enabled"] = true, ["waitlist_enabled"] = true,
        ["timed_waitlist_offers_enabled"] = false, ["recurrence_enabled"] = true,
        ["reminders_enabled"] = true, ["organizer_broadcasts_enabled"] = true,
        ["offline_checkin_enabled"] = true, ["calendar_feeds_enabled"] = true,
        ["federation_sharing_enabled"] = true, ["safety_enforcement_mode"] = null,
        ["notification_delivery_mode"] = null
    };
    private static readonly HashSet<string> SafetyModes = ["off", "shadow", "enforce"];
    private static readonly HashSet<string> NotificationModes = ["direct", "shadow_outbox", "outbox_authoritative"];
    private static readonly HashSet<string> CreationRoles = ["members", "staff", "admins"];

    public async Task<EventConfigurationPolicyResult> InspectAsync(int tenantId, CancellationToken ct)
    {
        if (!await db.Tenants.IgnoreQueryFilters().AsNoTracking().AnyAsync(x => x.Id == tenantId, ct)) return MissingTenant();
        var state = await LoadAsync(tenantId, false, ct);
        return new(await SnapshotAsync(tenantId, state, ct));
    }

    public async Task<EventConfigurationPolicyResult> AuditAsync(int tenantId, CancellationToken ct)
    {
        var rows = await db.AuditLogs.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && (x.Action == "events_configuration_updated" || x.Action == "events_configuration_defaults_restored"))
            .OrderByDescending(x => x.Id).Take(50).ToListAsync(ct);
        var actorIds = rows.Where(x => x.UserId != null).Select(x => x.UserId!.Value).Distinct().ToArray();
        var users = await db.Users.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenantId && actorIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
        var data = rows.Select(row =>
        {
            users.TryGetValue(row.UserId ?? 0, out var actor);
            var details = ParseObject(row.Metadata);
            return new
            {
                id = row.Id, action = row.Action, actor_id = row.UserId,
                actor_name = actor is null ? null : Name(actor),
                reason = Text(details, "reason"), version = Integer(details, "version"),
                changes = Property(details, "changes") ?? EmptyObject(), created_at = Iso(row.CreatedAt)
            };
        }).ToArray();
        return new(data);
    }

    public async Task<EventConfigurationPolicyResult> UpdateAsync(int tenantId, int actorId, int expectedVersion,
        IReadOnlyDictionary<string, JsonElement>? settings, string? reason, bool confirmDisruptive, CancellationToken ct)
    {
        reason = reason?.Trim();
        if (settings is null || settings.Count == 0) return Validation("settings");
        if (expectedVersion < 0) return Validation("version");
        if (string.IsNullOrWhiteSpace(reason) || reason.Length > 2000) return Validation("reason");

        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await LockAsync(tenantId, ct);
        if (!await db.Tenants.IgnoreQueryFilters().AnyAsync(x => x.Id == tenantId, ct)) return MissingTenant();
        var row = await db.TenantConfigs.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Key == StoreKey, ct);
        var state = Decode(row?.Value);
        if (state.Version != expectedVersion) return Validation("version", "Event configuration is stale");
        var defaults = await DefaultsAsync(tenantId, ct);
        var current = Effective(defaults, state.Overrides);
        var parsed = Validate(settings);
        if (parsed.Error is not null) return parsed.Error;
        var next = new Dictionary<string, object?>(current, StringComparer.Ordinal);
        foreach (var (key, value) in parsed.Values!) next[key] = value;
        if ((bool)next["timed_waitlist_offers_enabled"]! && !(bool)next["waitlist_enabled"]!) return Validation("timed_waitlist_offers_enabled");
        if ((bool)next["timed_waitlist_offers_enabled"]!) return Validation("timed_waitlist_offers_enabled", "Timed waitlist offers are unavailable");
        if (Equals(next["notification_delivery_mode"], "outbox_authoritative")) return Validation("notification_delivery_mode", "Notification consumer is unavailable");

        var changes = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var (key, value) in parsed.Values!)
            if (!Same(current[key], value)) changes[key] = new { from = current[key], to = value };
        if (changes.Count == 0) return Validation("settings", "Event configuration has no changes");
        var impact = await ImpactAsync(tenantId, ct);
        if (!confirmDisruptive && Disruptive(current, parsed.Values!, impact)) return Validation("confirm_disruptive", "Live event impact requires confirmation");

        foreach (var (key, element) in settings)
        {
            if (element.ValueKind == JsonValueKind.Null) state.Overrides.Remove(key);
            else state.Overrides[key] = element.Clone();
        }
        state.Version++;
        Save(row, tenantId, state);
        await ApplyDisableEffectsAsync(tenantId, current, next, ct);
        AddAudit(tenantId, actorId, "events_configuration_updated", reason, state.Version, changes, null);
        await db.SaveChangesAsync(ct);
        var snapshot = await SnapshotAsync(tenantId, state, ct);
        await tx.CommitAsync(ct);
        return new(Merge(snapshot, new { changes }));
    }

    public async Task<EventConfigurationPolicyResult> RestoreAsync(int tenantId, int actorId, int expectedVersion,
        string? reason, IReadOnlyCollection<string>? keys, CancellationToken ct)
    {
        reason = reason?.Trim();
        if (expectedVersion < 0) return Validation("version");
        if (string.IsNullOrWhiteSpace(reason) || reason.Length > 2000) return Validation("reason");
        var selected = keys is null ? BaseDefaults.Keys.ToArray() : keys.Distinct(StringComparer.Ordinal).ToArray();
        if (selected.Length == 0 || selected.Any(x => !BaseDefaults.ContainsKey(x))) return Validation("keys");

        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await LockAsync(tenantId, ct);
        if (!await db.Tenants.IgnoreQueryFilters().AnyAsync(x => x.Id == tenantId, ct)) return MissingTenant();
        var row = await db.TenantConfigs.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Key == StoreKey, ct);
        var state = Decode(row?.Value);
        if (state.Version != expectedVersion) return Validation("version", "Event configuration is stale");
        var defaults = await DefaultsAsync(tenantId, ct);
        var current = Effective(defaults, state.Overrides);
        var removed = selected.Where(state.Overrides.ContainsKey).ToArray();
        if (removed.Length == 0)
        {
            var unchanged = await SnapshotAsync(tenantId, state, ct);
            await tx.CommitAsync(ct);
            return new(Merge(unchanged, new { changes = new Dictionary<string, object?>(), restored = false }));
        }
        var changes = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var key in removed)
        {
            if (!Same(current[key], defaults[key])) changes[key] = new { from = current[key], to = defaults[key] };
            state.Overrides.Remove(key);
        }
        state.Version++;
        Save(row, tenantId, state);
        AddAudit(tenantId, actorId, "events_configuration_defaults_restored", reason, state.Version, changes, removed);
        await db.SaveChangesAsync(ct);
        var snapshot = await SnapshotAsync(tenantId, state, ct);
        await tx.CommitAsync(ct);
        return new(Merge(snapshot, new { changes, restored = true }));
    }

    private async Task<object> SnapshotAsync(int tenantId, StoredState state, CancellationToken ct)
    {
        var defaults = await DefaultsAsync(tenantId, ct);
        return new { config = Effective(defaults, state.Overrides), defaults, version = state.Version, capabilities = Capabilities(state), impact = await ImpactAsync(tenantId, ct) };
    }

    private static object Capabilities(StoredState state)
    {
        var notificationOverride = StringOverride(state, "notification_delivery_mode");
        var safetyOverride = StringOverride(state, "safety_enforcement_mode");
        return new
        {
            recurrence_v2 = true, rolling_recurrence = true, recurrence_definition_blueprints = true,
            timed_waitlist_offers = false, attendance_credits = false, optional_analytics_capture = true,
            registration_forms = true, invitation_campaigns = true, ticketing = true, agenda = true,
            offline_sync = true, broadcast_delivery = true, safety_evidence = true, federation_delivery = true,
            notification_consumer = false,
            notification_delivery = new { resolved_mode = notificationOverride ?? "direct", source = notificationOverride is null ? "safe_default" : "tenant_override", global_configuration_valid = false, tenant_override_present = notificationOverride is not null, tenant_configuration_valid = notificationOverride is null ? (bool?)null : true, tenant_override_lookup_failed = false },
            safety = new { resolved_mode = safetyOverride ?? "off", source = safetyOverride is null ? "global" : "tenant_override", configuration_valid = true, global_configuration_valid = true, tenant_override_present = safetyOverride is not null, tenant_configuration_valid = safetyOverride is null ? (bool?)null : true, tenant_override_lookup_failed = false }
        };
    }

    private async Task<Dictionary<string, int>> ImpactAsync(int tenantId, CancellationToken ct) => new(StringComparer.Ordinal)
    {
        ["active_registrations"] = await db.EventRegistrations.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenantId && new[] { "invited", "pending", "confirmed" }.Contains(x.RegistrationState), ct),
        ["active_waitlist_entries"] = await db.EventWaitlistEntries.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenantId && new[] { "waiting", "offered" }.Contains(x.QueueState), ct),
        ["pending_reminders"] = await db.EventReminders.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenantId && x.Status == "pending" && !x.IsSent, ct),
        ["active_calendar_tokens"] = await db.EventCalendarFeedTokens.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenantId && x.RevokedAt == null, ct),
        ["shared_events"] = await db.Events.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenantId && x.FederatedVisibility != "none", ct),
        ["scheduled_broadcasts"] = await db.EventBroadcasts.IgnoreQueryFilters().CountAsync(x => x.TenantId == tenantId && (x.Status == "scheduled" || x.Status == "sending"), ct)
    };

    private async Task ApplyDisableEffectsAsync(int tenantId, IReadOnlyDictionary<string, object?> current, IReadOnlyDictionary<string, object?> next, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        if (TurnedOff("reminders_enabled", current, next))
        {
            var reminders = await db.EventReminders.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.Status == "pending" && !x.IsSent).ToListAsync(ct);
            foreach (var reminder in reminders) { reminder.Status = "cancelled"; reminder.UpdatedAt = now; }
        }
        if (TurnedOff("federation_sharing_enabled", current, next))
        {
            var events = await db.Events.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && x.FederatedVisibility != "none").OrderBy(x => x.Id).ToListAsync(ct);
            var federation = new EventFederationStatusService(db);
            foreach (var evt in events) { evt.FederatedVisibility = "none"; evt.UpdatedAt = now; await federation.EnqueueLifecycleAsync(evt, ct); }
        }
    }

    private async Task<Dictionary<string, object?>> DefaultsAsync(int tenantId, CancellationToken ct)
    {
        var result = new Dictionary<string, object?>(BaseDefaults, StringComparer.Ordinal);
        var moderation = await db.TenantConfigs.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && (x.Key == "moderation.enabled" || x.Key == "moderation.require_event"))
            .ToDictionaryAsync(x => x.Key, x => x.Value, ct);
        result["moderation_required"] = moderation.TryGetValue("moderation.enabled", out var enabled) && StoredBoolean(enabled)
            && moderation.TryGetValue("moderation.require_event", out var required) && StoredBoolean(required);
        return result;
    }

    private static (Dictionary<string, object?>? Values, EventConfigurationPolicyResult? Error) Validate(IReadOnlyDictionary<string, JsonElement> settings)
    {
        var values = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var (key, value) in settings)
        {
            if (!BaseDefaults.ContainsKey(key)) return (null, Validation("settings"));
            if (BaseDefaults[key] is bool)
            {
                if (value.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return (null, Validation(key));
                values[key] = value.GetBoolean();
            }
            else if (BaseDefaults[key] is int)
            {
                if (!value.TryGetInt32(out var number) || number is < 0 or > 100000) return (null, Validation(key));
                values[key] = number;
            }
            else if (BaseDefaults[key] is string)
            {
                if (value.ValueKind != JsonValueKind.String) return (null, Validation(key));
                values[key] = value.GetString();
            }
            else
            {
                if (value.ValueKind == JsonValueKind.Null) values[key] = null;
                else if (value.ValueKind == JsonValueKind.String) values[key] = value.GetString();
                else return (null, Validation(key));
            }
        }
        if (values.TryGetValue("creation_role", out var role) && (role is not string roleValue || !CreationRoles.Contains(roleValue))) return (null, Validation("creation_role"));
        if (values.TryGetValue("safety_enforcement_mode", out var safety) && safety is not null && (safety is not string safetyValue || !SafetyModes.Contains(safetyValue))) return (null, Validation("safety_enforcement_mode"));
        if (values.TryGetValue("notification_delivery_mode", out var mode) && mode is not null && (mode is not string modeValue || !NotificationModes.Contains(modeValue))) return (null, Validation("notification_delivery_mode"));
        return (values, null);
    }

    private static bool Disruptive(IReadOnlyDictionary<string, object?> current, IReadOnlyDictionary<string, object?> updates, IReadOnlyDictionary<string, int> impact)
    {
        var map = new Dictionary<string, string> { ["registration_enabled"] = "active_registrations", ["waitlist_enabled"] = "active_waitlist_entries", ["reminders_enabled"] = "pending_reminders", ["calendar_feeds_enabled"] = "active_calendar_tokens", ["federation_sharing_enabled"] = "shared_events", ["organizer_broadcasts_enabled"] = "scheduled_broadcasts" };
        return map.Any(x => Equals(current[x.Key], true) && updates.TryGetValue(x.Key, out var next) && Equals(next, false) && impact[x.Value] > 0);
    }

    private async Task<StoredState> LoadAsync(int tenantId, bool tracked, CancellationToken ct)
    {
        var query = db.TenantConfigs.IgnoreQueryFilters();
        if (!tracked) query = query.AsNoTracking();
        var value = await query.Where(x => x.TenantId == tenantId && x.Key == StoreKey).Select(x => x.Value).SingleOrDefaultAsync(ct);
        return Decode(value);
    }
    private static StoredState Decode(string? value) { try { return string.IsNullOrWhiteSpace(value) ? new() : JsonSerializer.Deserialize<StoredState>(value) ?? new(); } catch (JsonException) { return new(); } }
    private void Save(TenantConfig? row, int tenantId, StoredState state)
    {
        var now = DateTime.UtcNow; var value = JsonSerializer.Serialize(state);
        if (row is null) db.TenantConfigs.Add(new TenantConfig { TenantId = tenantId, Key = StoreKey, Value = value, CreatedAt = now });
        else { row.Value = value; row.UpdatedAt = now; }
    }
    private void AddAudit(int tenantId, int actorId, string action, string reason, int version, object changes, string[]? removed) => db.AuditLogs.Add(new AuditLog { TenantId = tenantId, UserId = actorId, Action = action, EntityType = "events_configuration", Metadata = JsonSerializer.Serialize(new { reason, version, changes, removed_overrides = removed }), Severity = AuditSeverity.Info, CreatedAt = DateTime.UtcNow });
    private Task LockAsync(int tenantId, CancellationToken ct) => db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenantId}, {193701781})", ct);
    private static Dictionary<string, object?> Effective(IReadOnlyDictionary<string, object?> defaults, IReadOnlyDictionary<string, JsonElement> overrides)
    {
        var result = new Dictionary<string, object?>(defaults, StringComparer.Ordinal);
        foreach (var (key, value) in overrides) if (result.ContainsKey(key)) result[key] = Scalar(value);
        return result;
    }
    private static object? Scalar(JsonElement value) => value.ValueKind switch { JsonValueKind.True => true, JsonValueKind.False => false, JsonValueKind.Number when value.TryGetInt32(out var number) => number, JsonValueKind.String => value.GetString(), JsonValueKind.Null => null, _ => null };
    private static bool Same(object? left, object? right) => JsonSerializer.Serialize(left) == JsonSerializer.Serialize(right);
    private static bool TurnedOff(string key, IReadOnlyDictionary<string, object?> current, IReadOnlyDictionary<string, object?> next) => Equals(current[key], true) && Equals(next[key], false);
    private static bool StoredBoolean(string? value) => value?.Trim().ToLowerInvariant() is "1" or "true" or "yes" or "on";
    private static string? StringOverride(StoredState state, string key) => state.Overrides.TryGetValue(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static object Merge(object snapshot, object extra)
    {
        var values = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(snapshot))!;
        foreach (var item in JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(extra))!) values[item.Key] = item.Value;
        return values;
    }
    private static JsonElement? ParseObject(string? json) { try { var value = JsonSerializer.Deserialize<JsonElement>(json ?? "{}"); return value.ValueKind == JsonValueKind.Object ? value : null; } catch { return null; } }
    private static JsonElement? Property(JsonElement? root, string name) => root is { ValueKind: JsonValueKind.Object } value && value.TryGetProperty(name, out var property) ? property : null;
    private static string? Text(JsonElement? root, string name) => Property(root, name) is { ValueKind: JsonValueKind.String } value ? value.GetString() : null;
    private static int Integer(JsonElement? root, string name) => Property(root, name) is { } value && value.TryGetInt32(out var number) ? number : 0;
    private static JsonElement EmptyObject() => JsonSerializer.Deserialize<JsonElement>("{}");
    private static string Name(User user) => string.Join(' ', new[] { user.FirstName, user.LastName }.Where(x => !string.IsNullOrWhiteSpace(x)));
    private static string Iso(DateTime value) => value.ToUniversalTime().ToString("O");
    private static EventConfigurationPolicyResult Validation(string field, string message = "Event configuration is invalid") => new(null, new("VALIDATION_ERROR", message, 422, field));
    private static EventConfigurationPolicyResult MissingTenant() => new(null, new("VALIDATION_ERROR", "Tenant not found", 422, "tenant"));
    private sealed class StoredState { public int Version { get; set; } public Dictionary<string, JsonElement> Overrides { get; set; } = new(StringComparer.Ordinal); }
}
