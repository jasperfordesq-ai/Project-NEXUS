// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class CaringNudgeAnalyticsService
{
    private const string FeatureFlagKey = "features.caring_community";
    private const string SettingPrefix = "caring_community.nudges.";
    private const decimal DefaultMinScore = 0.55m;
    private const int DefaultCooldownDays = 14;
    private const int DefaultDailyLimit = 25;
    private const string NudgeNotificationType = "caring_smart_nudges";

    private readonly NexusDbContext _db;
    private readonly CaringTandemMatchingService _tandems;

    public CaringNudgeAnalyticsService(NexusDbContext db, CaringTandemMatchingService tandems)
    {
        _db = db;
        _tandems = tandems;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == FeatureFlagKey)
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public async Task<CaringNudgeAnalytics> AnalyticsAsync(int tenantId, CancellationToken ct)
    {
        await MarkConversionsAsync(tenantId, ct);

        var config = await ConfigAsync(tenantId, ct);
        var cutoff = DateTime.UtcNow.AddDays(-30);

        var nudges = await _db.CaringSmartNudges
            .IgnoreQueryFilters()
            .Where(n => n.TenantId == tenantId)
            .ToListAsync(ct);

        if (nudges.Count == 0)
        {
            return new CaringNudgeAnalytics(
                config,
                CaringNudgeStats.Empty,
                Array.Empty<CaringNudgeRecentRow>(),
                0);
        }

        var recentRows = nudges
            .OrderByDescending(n => n.SentAt)
            .ThenByDescending(n => n.Id)
            .Take(25)
            .ToList();

        var userIds = recentRows
            .SelectMany(n => new[] { n.TargetUserId, n.RelatedUserId ?? 0 })
            .Where(id => id > 0)
            .Distinct()
            .ToArray();

        var names = await _db.Users
            .IgnoreQueryFilters()
            .Where(u => u.TenantId == tenantId && userIds.Contains(u.Id))
            .Select(u => new
            {
                u.Id,
                u.FirstName,
                u.LastName,
                u.Email
            })
            .ToDictionaryAsync(u => u.Id, u => DisplayName(u.FirstName, u.LastName, u.Email), ct);

        var sent30 = nudges.Count(n => n.SentAt >= cutoff);
        var converted30 = nudges.Count(n =>
            n.Status == "converted" &&
            n.ConvertedAt.HasValue &&
            n.ConvertedAt.Value >= cutoff);

        return new CaringNudgeAnalytics(
            config,
            new CaringNudgeStats(
                nudges.Count,
                sent30,
                nudges.Count(n => n.Status == "converted"),
                converted30,
                sent30 > 0 ? RoundRate((decimal)converted30 / sent30) : 0m,
                await OptedOutCountAsync(tenantId, ct)),
            recentRows.Select(n => new CaringNudgeRecentRow(
                n.Id,
                new CaringNudgeUser(n.TargetUserId, names.GetValueOrDefault(n.TargetUserId, string.Empty)),
                new CaringNudgeUser(n.RelatedUserId ?? 0, n.RelatedUserId.HasValue
                    ? names.GetValueOrDefault(n.RelatedUserId.Value, string.Empty)
                    : string.Empty),
                RoundScore(n.Score),
                n.Status,
                FormatTimestamp(n.SentAt),
                n.ConvertedAt.HasValue ? FormatTimestamp(n.ConvertedAt.Value) : null)).ToArray(),
            0);
    }

    public async Task<CaringNudgeDispatchResult> DispatchDueAsync(
        int tenantId,
        int? limit,
        bool dryRun,
        CancellationToken ct)
    {
        var config = await ConfigAsync(tenantId, ct);
        if (!config.Enabled)
        {
            return new CaringNudgeDispatchResult(
                Enabled: false,
                DryRun: dryRun,
                Candidates: 0,
                Sent: 0,
                Skipped: 0,
                Items: Array.Empty<CaringNudgeDispatchItem>());
        }

        var candidates = await PreviewCandidatesAsync(tenantId, config, limit, ct);
        var sent = 0;
        var items = new List<CaringNudgeDispatchItem>();

        foreach (var candidate in candidates)
        {
            if (dryRun)
            {
                items.Add(candidate.ToItem("preview", null, null));
                continue;
            }

            var dispatchKey = DispatchKey(tenantId, candidate, config.CooldownDays);
            var existing = await _db.CaringSmartNudges
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.DispatchKey == dispatchKey, ct);

            if (existing is not null)
            {
                items.Add(candidate.ToItem("skipped_duplicate", existing.Id, existing.NotificationId));
                continue;
            }

            var now = DateTime.UtcNow;
            var nudge = new CaringSmartNudge
            {
                TenantId = tenantId,
                TargetUserId = candidate.TargetUser.Id,
                RelatedUserId = candidate.RelatedUser.Id > 0 ? candidate.RelatedUser.Id : null,
                SourceType = candidate.SourceType,
                DispatchKey = dispatchKey,
                Score = candidate.Score,
                Signals = JsonSerializer.Serialize(candidate.Signals),
                Status = "sent",
                SentAt = now,
                CreatedAt = now,
                UpdatedAt = now
            };

            var notification = new Notification
            {
                TenantId = tenantId,
                UserId = candidate.TargetUser.Id,
                Type = "caring_smart_nudge",
                Title = "Caring community nudge",
                Body = candidate.NotificationMessage,
                Data = JsonSerializer.Serialize(new
                {
                    source_type = candidate.SourceType,
                    related_user_id = candidate.RelatedUser.Id > 0 ? candidate.RelatedUser.Id : (int?)null,
                    url = candidate.NotificationUrl
                }),
                IsRead = false,
                CreatedAt = now
            };

            _db.CaringSmartNudges.Add(nudge);
            _db.Notifications.Add(notification);
            await _db.SaveChangesAsync(ct);

            nudge.NotificationId = notification.Id;
            nudge.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);

            sent++;
            items.Add(candidate.ToItem("sent", nudge.Id, notification.Id));
        }

        return new CaringNudgeDispatchResult(
            Enabled: true,
            DryRun: dryRun,
            Candidates: candidates.Count,
            Sent: sent,
            Skipped: Math.Max(0, candidates.Count - sent),
            Items: items);
    }

    public async Task<CaringNudgeConfig> UpdateConfigAsync(
        int tenantId,
        JsonElement input,
        CancellationToken ct)
    {
        var current = await ConfigAsync(tenantId, ct);
        var updates = new CaringNudgeConfig(
            HasProperty(input, "enabled")
                ? ReadBool(input, "enabled")
                : current.Enabled,
            HasProperty(input, "min_score")
                ? Clamp(ReadDecimal(input, "min_score"), 0.4m, 0.95m)
                : current.MinScore,
            HasProperty(input, "cooldown_days")
                ? Clamp(ReadInt(input, "cooldown_days"), 1, 90)
                : current.CooldownDays,
            HasProperty(input, "daily_limit")
                ? Clamp(ReadInt(input, "daily_limit"), 1, 250)
                : current.DailyLimit);

        await UpsertSettingAsync(tenantId, "enabled", updates.Enabled ? "1" : "0", ct);
        await UpsertSettingAsync(tenantId, "min_score", FormatDecimal(updates.MinScore), ct);
        await UpsertSettingAsync(tenantId, "cooldown_days", updates.CooldownDays.ToString(CultureInfo.InvariantCulture), ct);
        await UpsertSettingAsync(tenantId, "daily_limit", updates.DailyLimit.ToString(CultureInfo.InvariantCulture), ct);
        await _db.SaveChangesAsync(ct);

        return await ConfigAsync(tenantId, ct);
    }

    private async Task<CaringNudgeConfig> ConfigAsync(int tenantId, CancellationToken ct)
    {
        var rows = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith(SettingPrefix))
            .Select(c => new
            {
                c.Key,
                c.Value
            })
            .ToDictionaryAsync(c => c.Key, c => c.Value, ct);

        return new CaringNudgeConfig(
            ParseBool(Setting(rows, "enabled")) ?? false,
            ParseDecimal(Setting(rows, "min_score"), DefaultMinScore, 0.4m, 0.95m),
            ParseInt(Setting(rows, "cooldown_days"), DefaultCooldownDays, 1, 90),
            ParseInt(Setting(rows, "daily_limit"), DefaultDailyLimit, 1, 250));
    }

    private async Task UpsertSettingAsync(int tenantId, string key, string value, CancellationToken ct)
    {
        var fullKey = SettingPrefix + key;
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(config => config.TenantId == tenantId && config.Key == fullKey, ct);

        if (row is null)
        {
            row = new TenantConfig
            {
                TenantId = tenantId,
                Key = fullKey,
                Value = value,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            _db.TenantConfigs.Add(row);
            return;
        }

        row.Value = value;
        row.UpdatedAt = DateTime.UtcNow;
    }

    private async Task<IReadOnlyList<CaringNudgeCandidate>> PreviewCandidatesAsync(
        int tenantId,
        CaringNudgeConfig config,
        int? limit,
        CancellationToken ct)
    {
        var cap = Math.Max(1, Math.Min(250, limit ?? config.DailyLimit));
        var suggestions = await _tandems.SuggestTandemsAsync(tenantId, 100, ct);
        var candidates = new List<CaringNudgeCandidate>();

        foreach (var suggestion in suggestions)
        {
            if (suggestion.Score < config.MinScore)
            {
                continue;
            }

            if (await MemberOptedOutAsync(tenantId, suggestion.Supporter.Id, ct)
                || await MemberOptedOutAsync(tenantId, suggestion.Recipient.Id, ct))
            {
                continue;
            }

            var candidate = new CaringNudgeCandidate(
                TargetUser: new CaringNudgeDispatchUser(suggestion.Supporter.Id, suggestion.Supporter.Name),
                RelatedUser: new CaringNudgeDispatchUser(suggestion.Recipient.Id, suggestion.Recipient.Name),
                Score: suggestion.Score,
                Signals: suggestion.Signals,
                Reason: suggestion.Reason,
                SourceType: "tandem_candidate",
                NotificationUrl: "/caring-community/request-help",
                NotificationMessage: BuildTandemMessage(suggestion.Recipient.Name));

            if (await RecentlyNudgedAsync(tenantId, candidate, config.CooldownDays, ct))
            {
                continue;
            }

            candidates.Add(candidate);
            if (candidates.Count >= cap)
            {
                break;
            }
        }

        return candidates;
    }

    private async Task<bool> MemberOptedOutAsync(int tenantId, int userId, CancellationToken ct)
    {
        return await _db.NotificationPreferences
            .IgnoreQueryFilters()
            .AnyAsync(pref =>
                pref.TenantId == tenantId &&
                pref.UserId == userId &&
                pref.NotificationType == NudgeNotificationType &&
                !pref.EnableInApp &&
                !pref.EnablePush &&
                !pref.EnableEmail,
                ct);
    }

    private async Task<bool> RecentlyNudgedAsync(
        int tenantId,
        CaringNudgeCandidate candidate,
        int cooldownDays,
        CancellationToken ct)
    {
        var cutoff = DateTime.UtcNow.AddDays(-Math.Max(1, cooldownDays));
        return await _db.CaringSmartNudges
            .IgnoreQueryFilters()
            .AnyAsync(row =>
                row.TenantId == tenantId &&
                row.TargetUserId == candidate.TargetUser.Id &&
                row.RelatedUserId == candidate.RelatedUser.Id &&
                row.SourceType == candidate.SourceType &&
                row.SentAt >= cutoff,
                ct);
    }

    private async Task MarkConversionsAsync(int tenantId, CancellationToken ct)
    {
        var pending = await _db.CaringSmartNudges
            .IgnoreQueryFilters()
            .Where(n =>
                n.TenantId == tenantId &&
                n.Status == "sent" &&
                n.SourceType == "tandem_candidate" &&
                n.RelatedUserId.HasValue)
            .Take(500)
            .ToListAsync(ct);

        if (pending.Count == 0)
        {
            return;
        }

        foreach (var nudge in pending)
        {
            var relatedUserId = nudge.RelatedUserId!.Value;
            var exists = await _db.CaringCaregiverLinks
                .IgnoreQueryFilters()
                .AnyAsync(link =>
                    link.TenantId == tenantId &&
                    link.Status == "active" &&
                    ((link.CaregiverId == nudge.TargetUserId && link.CaredForId == relatedUserId) ||
                     (link.CaregiverId == relatedUserId && link.CaredForId == nudge.TargetUserId)), ct);

            if (!exists)
            {
                continue;
            }

            nudge.Status = "converted";
            nudge.ConvertedAt = DateTime.UtcNow;
            nudge.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
    }

    private async Task<int> OptedOutCountAsync(int tenantId, CancellationToken ct)
    {
        return await _db.NotificationPreferences
            .IgnoreQueryFilters()
            .Where(p =>
                p.TenantId == tenantId &&
                p.NotificationType == NudgeNotificationType &&
                !p.EnableInApp &&
                !p.EnablePush &&
                !p.EnableEmail)
            .Select(p => p.UserId)
            .Distinct()
            .CountAsync(ct);
    }

    private static string? Setting(IReadOnlyDictionary<string, string> rows, string key)
    {
        return rows.GetValueOrDefault(SettingPrefix + key);
    }

    private static bool HasProperty(JsonElement input, string name)
    {
        return input.ValueKind == JsonValueKind.Object && input.TryGetProperty(name, out _);
    }

    private static bool ReadBool(JsonElement input, string name)
    {
        if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty(name, out var value))
        {
            return false;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when value.TryGetInt32(out var number) => number != 0,
            JsonValueKind.String => ParseBool(value.GetString()) ?? false,
            _ => false
        };
    }

    private static decimal ReadDecimal(JsonElement input, string name)
    {
        if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty(name, out var value))
        {
            return 0m;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetDecimal(out var parsed) => parsed,
            JsonValueKind.String when decimal.TryParse(value.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => 0m
        };
    }

    private static int ReadInt(JsonElement input, string name)
    {
        if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty(name, out var value))
        {
            return 0;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt32(out var parsed) => parsed,
            JsonValueKind.String when int.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => 0
        };
    }

    private static decimal Clamp(decimal value, decimal min, decimal max)
    {
        return Math.Max(min, Math.Min(max, value));
    }

    private static int Clamp(int value, int min, int max)
    {
        return Math.Max(min, Math.Min(max, value));
    }

    private static string FormatDecimal(decimal value)
    {
        return value.ToString("0.#############################", CultureInfo.InvariantCulture);
    }

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        if (bool.TryParse(raw, out var parsed))
        {
            return parsed;
        }

        return raw.Trim() switch
        {
            "1" => true,
            "0" => false,
            _ => null
        };
    }

    private static decimal ParseDecimal(string? raw, decimal fallback, decimal min, decimal max)
    {
        return decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out var value)
            ? Math.Max(min, Math.Min(max, value))
            : fallback;
    }

    private static int ParseInt(string? raw, int fallback, int min, int max)
    {
        return int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            ? Math.Max(min, Math.Min(max, value))
            : fallback;
    }

    private static string DisplayName(string? firstName, string? lastName, string email)
    {
        var fullName = string.Join(" ", new[] { firstName, lastName }
            .Where(value => !string.IsNullOrWhiteSpace(value)))
            .Trim();

        return string.IsNullOrWhiteSpace(fullName) ? email : fullName;
    }

    private static string BuildTandemMessage(string relatedName)
    {
        return string.IsNullOrWhiteSpace(relatedName)
            ? "A Caring Community member may be a good match for support."
            : $"Could you connect with {relatedName}?";
    }

    private static string DispatchKey(int tenantId, CaringNudgeCandidate candidate, int cooldownDays)
    {
        var bucket = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / (Math.Max(1, cooldownDays) * 86400L);
        var identity = JsonSerializer.Serialize(new
        {
            tenant_id = tenantId,
            source_type = candidate.SourceType,
            target_user_id = candidate.TargetUser.Id,
            related_user_id = candidate.RelatedUser.Id,
            cooldown_bucket = bucket
        });

        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(identity));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string FormatTimestamp(DateTime value)
    {
        return value.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
    }

    private static decimal RoundScore(decimal value)
    {
        return Math.Round(value, 3, MidpointRounding.AwayFromZero);
    }

    private static decimal RoundRate(decimal value)
    {
        return Math.Round(value, 3, MidpointRounding.AwayFromZero);
    }
}

public sealed record CaringNudgeAnalytics(
    [property: JsonPropertyName("config")] CaringNudgeConfig Config,
    [property: JsonPropertyName("stats")] CaringNudgeStats Stats,
    [property: JsonPropertyName("recent")] IReadOnlyList<CaringNudgeRecentRow> Recent,
    [property: JsonPropertyName("eligible_candidates")] int EligibleCandidates);

public sealed record CaringNudgeConfig(
    [property: JsonPropertyName("enabled")] bool Enabled,
    [property: JsonPropertyName("min_score")] decimal MinScore,
    [property: JsonPropertyName("cooldown_days")] int CooldownDays,
    [property: JsonPropertyName("daily_limit")] int DailyLimit);

public sealed record CaringNudgeStats(
    [property: JsonPropertyName("sent_total")] int SentTotal,
    [property: JsonPropertyName("sent_30d")] int Sent30d,
    [property: JsonPropertyName("converted_total")] int ConvertedTotal,
    [property: JsonPropertyName("converted_30d")] int Converted30d,
    [property: JsonPropertyName("conversion_rate_30d")] decimal ConversionRate30d,
    [property: JsonPropertyName("opted_out_members")] int OptedOutMembers)
{
    public static CaringNudgeStats Empty { get; } = new(0, 0, 0, 0, 0m, 0);
}

public sealed record CaringNudgeRecentRow(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("target_user")] CaringNudgeUser TargetUser,
    [property: JsonPropertyName("related_user")] CaringNudgeUser RelatedUser,
    [property: JsonPropertyName("score")] decimal Score,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("sent_at")] string SentAt,
    [property: JsonPropertyName("converted_at")] string? ConvertedAt);

public sealed record CaringNudgeUser(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name);

public sealed record CaringNudgeDispatchResult(
    [property: JsonPropertyName("enabled")] bool Enabled,
    [property: JsonPropertyName("dry_run")] bool DryRun,
    [property: JsonPropertyName("candidates")] int Candidates,
    [property: JsonPropertyName("sent")] int Sent,
    [property: JsonPropertyName("skipped")] int Skipped,
    [property: JsonPropertyName("items")] IReadOnlyList<CaringNudgeDispatchItem> Items);

public sealed record CaringNudgeDispatchItem(
    [property: JsonPropertyName("target_user")] CaringNudgeDispatchUser TargetUser,
    [property: JsonPropertyName("related_user")] CaringNudgeDispatchUser RelatedUser,
    [property: JsonPropertyName("score")] decimal Score,
    [property: JsonPropertyName("signals")] TandemSignals Signals,
    [property: JsonPropertyName("reason")] string Reason,
    [property: JsonPropertyName("source_type")] string SourceType,
    [property: JsonPropertyName("notification_url")] string NotificationUrl,
    [property: JsonPropertyName("notification_message")] string NotificationMessage,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("nudge_id")] long? NudgeId,
    [property: JsonPropertyName("notification_id")] long? NotificationId);

public sealed record CaringNudgeDispatchUser(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name);

internal sealed record CaringNudgeCandidate(
    CaringNudgeDispatchUser TargetUser,
    CaringNudgeDispatchUser RelatedUser,
    decimal Score,
    TandemSignals Signals,
    string Reason,
    string SourceType,
    string NotificationUrl,
    string NotificationMessage)
{
    public CaringNudgeDispatchItem ToItem(string status, long? nudgeId, long? notificationId)
    {
        return new CaringNudgeDispatchItem(
            TargetUser,
            RelatedUser,
            Score,
            Signals,
            Reason,
            SourceType,
            NotificationUrl,
            NotificationMessage,
            status,
            nudgeId,
            notificationId);
    }
}
