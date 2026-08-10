// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record EventNotificationPreferenceResolution(
    bool Available,
    IReadOnlyDictionary<string, bool> Channels,
    string Cadence,
    string Reason)
{
    public bool Allows(string channel) => Available && Channels.GetValueOrDefault(channel);
}

public sealed class EventNotificationPreferenceResolver(NexusDbContext db, IConfiguration configuration)
{
    private static readonly string[] Channels = ["email", "in_app", "web_push", "fcm", "realtime"];

    public async Task<EventNotificationPreferenceResolution> ResolveAsync(int tenantId, int userId, int eventId, CancellationToken ct)
    {
        try
        {
            var user = await db.Users.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == userId && x.IsActive, ct);
            var evt = await db.Events.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == eventId, ct);
            if (user is null || evt is null) return FailClosed("subject_unavailable");

            var global = ParseGlobal(user.NotificationPreferences);
            if (global is null) return FailClosed("global_preferences_invalid");

            EventNotificationPreferenceProduct? eventPreference = await db.EventNotificationPreferencesProduct.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.UserId == userId && x.EventId == eventId && x.CategoryId == null, ct);
            EventNotificationPreferenceProduct? categoryPreference = null;
            if (evt.CategoryId is int categoryId)
            {
                var categoryExists = await db.Categories.IgnoreQueryFilters().AsNoTracking()
                    .AnyAsync(x => x.TenantId == tenantId && x.Id == categoryId && x.IsActive, ct);
                if (!categoryExists) return FailClosed("category_scope_invalid");
                categoryPreference = await db.EventNotificationPreferencesProduct.IgnoreQueryFilters().AsNoTracking()
                    .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.UserId == userId && x.EventId == null && x.CategoryId == categoryId, ct);
            }

            var tenantDefaults = await TenantChannelDefaultsAsync(tenantId, ct);
            var globalEmail = GlobalBoolean(global, "email_events");
            var globalPush = GlobalBoolean(global, "push_enabled");
            if (globalEmail.Invalid || globalPush.Invalid) return FailClosed("global_channel_invalid");

            var channels = new Dictionary<string, bool>(StringComparer.Ordinal);
            foreach (var channel in Channels)
            {
                var globalValue = channel switch
                {
                    "email" => globalEmail.Value,
                    "web_push" or "fcm" => globalPush.Value,
                    _ => null
                };
                channels[channel] = ResolveBoolean(
                    PreferenceValue(eventPreference, channel),
                    PreferenceValue(categoryPreference, channel),
                    globalValue,
                    tenantDefaults.GetValueOrDefault(channel, true));
            }

            var globalCadence = await db.TenantConfigs.IgnoreQueryFilters().AsNoTracking()
                .Where(x => x.TenantId == tenantId && x.Key == $"notification_settings.{userId}.global.0")
                .Select(x => x.Value).SingleOrDefaultAsync(ct);
            var tenantCadence = await db.TenantConfigs.IgnoreQueryFilters().AsNoTracking()
                .Where(x => x.TenantId == tenantId && (x.Key == "events.notifications.default_cadence" || x.Key == "notifications.default_frequency"))
                .OrderBy(x => x.Key == "events.notifications.default_cadence" ? 0 : 1)
                .Select(x => x.Value).FirstOrDefaultAsync(ct)
                ?? configuration["Events:Reminders:DefaultCadence"]
                ?? "off";
            var cadence = ResolveCadence(eventPreference?.Cadence, categoryPreference?.Cadence, globalCadence, tenantCadence);
            return new(true, channels, cadence, "resolved");
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return FailClosed($"lookup_failed:{exception.GetType().Name}");
        }
    }

    private async Task<Dictionary<string, bool>> TenantChannelDefaultsAsync(int tenantId, CancellationToken ct)
    {
        var result = Channels.ToDictionary(
            x => x,
            x => configuration.GetValue<bool?>($"Events:Reminders:DefaultChannels:{x}") ?? true,
            StringComparer.Ordinal);
        var raw = await db.TenantConfigs.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.Key == "events.notifications.default_channels")
            .Select(x => x.Value).SingleOrDefaultAsync(ct);
        if (string.IsNullOrWhiteSpace(raw)) return result;
        using var document = JsonDocument.Parse(raw);
        if (document.RootElement.ValueKind != JsonValueKind.Object) throw new JsonException("tenant_channel_defaults_invalid");
        foreach (var channel in Channels)
        {
            if (!document.RootElement.TryGetProperty(channel, out var value)) continue;
            result[channel] = ReadBoolean(value) ?? throw new JsonException("tenant_channel_default_invalid");
        }
        return result;
    }

    private static Dictionary<string, JsonElement>? ParseGlobal(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return [];
        try
        {
            using var document = JsonDocument.Parse(raw);
            if (document.RootElement.ValueKind != JsonValueKind.Object) return null;
            return document.RootElement.EnumerateObject().ToDictionary(x => x.Name, x => x.Value.Clone(), StringComparer.Ordinal);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static (bool? Value, bool Invalid) GlobalBoolean(IReadOnlyDictionary<string, JsonElement> values, string key)
    {
        if (!values.TryGetValue(key, out var raw)) return (null, false);
        var value = ReadBoolean(raw);
        return (value, value is null);
    }

    private static bool? ReadBoolean(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Number when value.TryGetInt32(out var number) && number is 0 or 1 => number == 1,
        JsonValueKind.String when bool.TryParse(value.GetString(), out var parsed) => parsed,
        JsonValueKind.String when value.GetString() is "1" or "yes" or "on" => true,
        JsonValueKind.String when value.GetString() is "0" or "no" or "off" => false,
        _ => null
    };

    private static bool? PreferenceValue(EventNotificationPreferenceProduct? preference, string channel) => channel switch
    {
        "email" => preference?.EmailEnabled,
        "in_app" => preference?.InAppEnabled,
        "web_push" => preference?.WebPushEnabled,
        "fcm" => preference?.FcmEnabled,
        "realtime" => preference?.RealtimeEnabled,
        _ => null
    };

    private static bool ResolveBoolean(bool? eventValue, bool? categoryValue, bool? globalValue, bool tenantValue)
    {
        if (eventValue == false || categoryValue == false || globalValue == false) return false;
        return eventValue ?? categoryValue ?? globalValue ?? tenantValue;
    }

    private static string ResolveCadence(params string?[] values)
    {
        var normalized = values.Select(NormalizeCadence).ToArray();
        if (normalized.Contains("off", StringComparer.Ordinal)) return "off";
        return normalized.FirstOrDefault(x => x is not null) ?? "off";
    }

    private static string? NormalizeCadence(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        "instant" => "instant",
        "daily" => "daily",
        "weekly" or "monthly" => "monthly",
        "off" => "off",
        null or "" => null,
        _ => "off"
    };

    private static EventNotificationPreferenceResolution FailClosed(string reason)
        => new(false, Channels.ToDictionary(x => x, _ => false, StringComparer.Ordinal), "off", reason);
}
