// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record EventReminderPreferenceError(string Code, string Message, int Status, string? Field = null);
public sealed record EventReminderPreferenceResult(object? Data, EventReminderPreferenceError? Error = null) { public bool Succeeded => Error is null; }

public sealed class EventReminderPreferenceService(NexusDbContext db, EventNotificationPreferenceResolver resolver)
{
    private static readonly string[] ChannelFields = ["email_enabled", "in_app_enabled", "web_push_enabled", "fcm_enabled", "realtime_enabled"];
    private static readonly HashSet<string> OverrideFields = new([.. ChannelFields, "cadence", "reminders_enabled"], StringComparer.Ordinal);
    private static readonly HashSet<string> RuleFields = new(["offset_minutes", "enabled", .. ChannelFields], StringComparer.Ordinal);
    private static readonly HashSet<string> Cadences = new(["instant", "daily", "monthly", "off"], StringComparer.Ordinal);

    public async Task<EventReminderPreferenceResult> ReadAsync(int tenant, int eventId, int userId, CancellationToken ct)
    {
        var context = await ContextAsync(tenant, eventId, userId, ct);
        return context is not null ? context : new(await ProjectAsync(tenant, eventId, userId, ct));
    }

    public async Task<EventReminderPreferenceResult> ReplaceAsync(int tenant, int eventId, int userId, JsonElement body, CancellationToken ct)
    {
        if (!TryExpected(body, out var expected)) return Validation("expected_revision");
        if (!body.TryGetProperty("overrides", out var overrideJson) || !TryOverrides(overrideJson, out var overrides)) return Validation("overrides");
        if (!body.TryGetProperty("rules", out var rulesJson) || !TryRules(rulesJson, out var rules)) return Validation("rules");

        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenant}, {HashCode.Combine(eventId, userId)})", ct);
        var context = await ContextAsync(tenant, eventId, userId, ct);
        if (context is not null) return context;
        var preference = await db.EventNotificationPreferencesProduct.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == tenant && x.UserId == userId && x.EventId == eventId && x.CategoryId == null, ct);
        var current = preference?.PreferenceVersion ?? 0;
        if (current != expected) return Conflict();

        var existing = await db.EventReminderRulesProduct.IgnoreQueryFilters()
            .Where(x => x.TenantId == tenant && x.EventId == eventId && x.UserId == userId).ToListAsync(ct);
        var changed = preference is null ? !overrides.IsEmpty || rules.Count > 0 : !overrides.Equals(From(preference));
        var desired = rules.ToDictionary(x => x.OffsetMinutes);
        var now = DateTime.UtcNow;
        foreach (var row in existing)
        {
            if (!desired.Remove(row.OffsetMinutes, out var next))
            {
                if (row.Enabled) { row.Enabled = false; row.RuleVersion++; row.UpdatedAt = now; changed = true; }
                continue;
            }
            if (!next.Equals(From(row)))
            {
                Apply(row, next); row.RuleVersion++; row.UpdatedAt = now; changed = true;
            }
        }
        foreach (var next in desired.Values)
        {
            var row = new EventReminderRuleProduct { TenantId = tenant, EventId = eventId, UserId = userId, OffsetMinutes = next.OffsetMinutes, CreatedAt = now, UpdatedAt = now };
            Apply(row, next); db.EventReminderRulesProduct.Add(row); changed = true;
        }
        if (changed)
        {
            if (preference is null)
            {
                preference = new EventNotificationPreferenceProduct { TenantId = tenant, UserId = userId, EventId = eventId, PreferenceVersion = 1, CreatedAt = now, UpdatedAt = now };
                Apply(preference, overrides); db.EventNotificationPreferencesProduct.Add(preference);
            }
            else { Apply(preference, overrides); preference.PreferenceVersion++; preference.UpdatedAt = now; }
            await db.SaveChangesAsync(ct);
        }
        await tx.CommitAsync(ct);
        return new(await ProjectAsync(tenant, eventId, userId, ct));
    }

    public async Task<EventReminderPreferenceResult> ResetAsync(int tenant, int eventId, int userId, int expected, CancellationToken ct)
    {
        if (expected < 0) return Validation("expected_revision");
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenant}, {HashCode.Combine(eventId, userId)})", ct);
        var context = await ContextAsync(tenant, eventId, userId, ct);
        if (context is not null) return context;
        var preference = await db.EventNotificationPreferencesProduct.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == tenant && x.UserId == userId && x.EventId == eventId && x.CategoryId == null, ct);
        if ((preference?.PreferenceVersion ?? 0) != expected) return Conflict();
        var now = DateTime.UtcNow;
        var rules = await db.EventReminderRulesProduct.IgnoreQueryFilters()
            .Where(x => x.TenantId == tenant && x.EventId == eventId && x.UserId == userId && x.Enabled).ToListAsync(ct);
        foreach (var rule in rules) { rule.Enabled = false; rule.RuleVersion++; rule.UpdatedAt = now; }
        if (preference is not null) db.EventNotificationPreferencesProduct.Remove(preference);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new(await ProjectAsync(tenant, eventId, userId, ct));
    }

    private async Task<object> ProjectAsync(int tenant, int eventId, int userId, CancellationToken ct)
    {
        var preference = await db.EventNotificationPreferencesProduct.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenant && x.UserId == userId && x.EventId == eventId && x.CategoryId == null, ct);
        var rules = await db.EventReminderRulesProduct.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenant && x.EventId == eventId && x.UserId == userId && x.Enabled)
            .OrderByDescending(x => x.OffsetMinutes).ThenBy(x => x.Id).ToListAsync(ct);
        var resolved = await resolver.ResolveAsync(tenant, userId, eventId, ct);
        var sources = ChannelFields.ToDictionary(x => x[..^8], _ => resolved.Reason, StringComparer.Ordinal);
        return new
        {
            revision = preference?.PreferenceVersion ?? 0,
            overrides = View(preference),
            rules = rules.Select(x => new { id = x.Id, offset_minutes = x.OffsetMinutes, enabled = x.Enabled, rule_version = x.RuleVersion, email_enabled = x.EmailEnabled, in_app_enabled = x.InAppEnabled, web_push_enabled = x.WebPushEnabled, fcm_enabled = x.FcmEnabled, realtime_enabled = x.RealtimeEnabled }).ToArray(),
            resolved = new { channels = resolved.Channels, channel_sources = sources, cadence = resolved.Cadence, cadence_source = resolved.Reason, reminders_enabled = resolved.Available && (preference?.RemindersEnabled ?? true), reminders_source = preference?.RemindersEnabled is null ? resolved.Reason : "event" },
            limits = new { minimum_offset_minutes = 5, maximum_offset_minutes = 525600, maximum_rules = 10, default_offsets_minutes = new[] { 1440, 60 } },
            capabilities = new { independent_channels = true, diagnostics_supported = false }
        };
    }

    private async Task<EventReminderPreferenceResult?> ContextAsync(int tenant, int eventId, int userId, CancellationToken ct)
    {
        var user = await db.Users.IgnoreQueryFilters().AsNoTracking().AnyAsync(x => x.TenantId == tenant && x.Id == userId && x.IsActive, ct);
        var evt = await db.Events.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == eventId, ct);
        if (!user || evt is null || evt.IsRecurringTemplate) return new(null, new("NOT_FOUND", "Event not found", 404));
        return null;
    }

    private static bool TryExpected(JsonElement body, out long value)
    {
        value = -1;
        return body.ValueKind == JsonValueKind.Object && body.TryGetProperty("expected_revision", out var p) && p.TryGetInt64(out value) && value >= 0;
    }
    private static bool TryOverrides(JsonElement json, out Overrides value)
    {
        value = default;
        if (json.ValueKind != JsonValueKind.Object || json.EnumerateObject().Any(x => !OverrideFields.Contains(x.Name))) return false;
        if (!NullableBool(json, "email_enabled", out var email) || !NullableBool(json, "in_app_enabled", out var app) || !NullableBool(json, "web_push_enabled", out var web) || !NullableBool(json, "fcm_enabled", out var fcm) || !NullableBool(json, "realtime_enabled", out var realtime) || !NullableBool(json, "reminders_enabled", out var reminders)) return false;
        string? cadence = null; if (json.TryGetProperty("cadence", out var c) && c.ValueKind != JsonValueKind.Null) { if (c.ValueKind != JsonValueKind.String || !Cadences.Contains(c.GetString()!)) return false; cadence = c.GetString(); }
        value = new(email, app, web, fcm, realtime, cadence, reminders); return true;
    }
    private static bool TryRules(JsonElement json, out List<Rule> rules)
    {
        rules = []; if (json.ValueKind != JsonValueKind.Array || json.GetArrayLength() > 10) return false; var seen = new HashSet<int>();
        foreach (var item in json.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object || item.EnumerateObject().Any(x => !RuleFields.Contains(x.Name)) || !item.TryGetProperty("offset_minutes", out var o) || !o.TryGetInt32(out var offset) || offset is < 5 or > 525600 || !seen.Add(offset)) return false;
            var enabled = true; if (item.TryGetProperty("enabled", out var e)) { if (e.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false; enabled = e.GetBoolean(); }
            if (!NullableBool(item, "email_enabled", out var email) || !NullableBool(item, "in_app_enabled", out var app) || !NullableBool(item, "web_push_enabled", out var web) || !NullableBool(item, "fcm_enabled", out var fcm) || !NullableBool(item, "realtime_enabled", out var realtime)) return false;
            rules.Add(new(offset, enabled, email, app, web, fcm, realtime));
        }
        rules.Sort((a, b) => b.OffsetMinutes.CompareTo(a.OffsetMinutes)); return true;
    }
    private static bool NullableBool(JsonElement json, string name, out bool? value) { value = null; if (!json.TryGetProperty(name, out var p) || p.ValueKind == JsonValueKind.Null) return true; if (p.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false; value = p.GetBoolean(); return true; }
    private static void Apply(EventNotificationPreferenceProduct x, Overrides y) { x.EmailEnabled = y.Email; x.InAppEnabled = y.InApp; x.WebPushEnabled = y.WebPush; x.FcmEnabled = y.Fcm; x.RealtimeEnabled = y.Realtime; x.Cadence = y.Cadence; x.RemindersEnabled = y.Reminders; }
    private static void Apply(EventReminderRuleProduct x, Rule y) { x.Enabled = y.Enabled; x.EmailEnabled = y.Email; x.InAppEnabled = y.InApp; x.WebPushEnabled = y.WebPush; x.FcmEnabled = y.Fcm; x.RealtimeEnabled = y.Realtime; }
    private static Overrides From(EventNotificationPreferenceProduct x) => new(x.EmailEnabled, x.InAppEnabled, x.WebPushEnabled, x.FcmEnabled, x.RealtimeEnabled, x.Cadence, x.RemindersEnabled);
    private static Rule From(EventReminderRuleProduct x) => new(x.OffsetMinutes, x.Enabled, x.EmailEnabled, x.InAppEnabled, x.WebPushEnabled, x.FcmEnabled, x.RealtimeEnabled);
    private static object View(EventNotificationPreferenceProduct? x) => new { email_enabled = x?.EmailEnabled, in_app_enabled = x?.InAppEnabled, web_push_enabled = x?.WebPushEnabled, fcm_enabled = x?.FcmEnabled, realtime_enabled = x?.RealtimeEnabled, cadence = x?.Cadence, reminders_enabled = x?.RemindersEnabled };
    private static EventReminderPreferenceResult Validation(string field) => new(null, new("VALIDATION_ERROR", "Event reminder preferences are invalid", 422, field));
    private static EventReminderPreferenceResult Conflict() => new(null, new("VERSION_CONFLICT", "Event reminder preference version conflict", 409, "expected_revision"));
    private readonly record struct Overrides(bool? Email, bool? InApp, bool? WebPush, bool? Fcm, bool? Realtime, string? Cadence, bool? Reminders) { public bool IsEmpty => Email is null && InApp is null && WebPush is null && Fcm is null && Realtime is null && Cadence is null && Reminders is null; }
    private readonly record struct Rule(int OffsetMinutes, bool Enabled, bool? Email, bool? InApp, bool? WebPush, bool? Fcm, bool? Realtime);
}
