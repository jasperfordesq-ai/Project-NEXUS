// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Laravel-compatible Caring Community trust-tier service.
/// </summary>
public sealed class TrustTierService
{
    public const int TierNewcomer = 0;
    public const int TierMember = 1;
    public const int TierTrusted = 2;
    public const int TierVerified = 3;
    public const int TierCoordinator = 4;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static readonly IReadOnlyDictionary<int, string> TierLabels = new Dictionary<int, string>
    {
        [TierNewcomer] = "newcomer",
        [TierMember] = "member",
        [TierTrusted] = "trusted",
        [TierVerified] = "verified",
        [TierCoordinator] = "coordinator"
    };

    private static readonly IReadOnlyDictionary<string, TrustTierCriteria> DefaultCriteria =
        new Dictionary<string, TrustTierCriteria>
        {
            ["member"] = new(1, 0, false),
            ["trusted"] = new(10, 3, false),
            ["verified"] = new(10, 3, true),
            ["coordinator"] = new(50, 5, true)
        };

    private readonly NexusDbContext _db;

    public TrustTierService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(config => config.TenantId == tenantId && config.Key == "features.caring_community")
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return IsTruthy(raw);
    }

    public bool IsAvailable()
    {
        return _db.Model.FindEntityType(typeof(CaringTrustTierConfig)) is not null
            && typeof(User).GetProperty(nameof(User.TrustTier)) is not null;
    }

    public async Task<IReadOnlyDictionary<string, TrustTierCriteria>> GetConfigAsync(
        int tenantId,
        CancellationToken ct)
    {
        var row = await _db.CaringTrustTierConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(config => config.TenantId == tenantId, ct);

        if (row is null || string.IsNullOrWhiteSpace(row.Criteria))
        {
            return CloneDefaults();
        }

        try
        {
            var decoded = JsonSerializer.Deserialize<Dictionary<string, TrustTierCriteria>>(row.Criteria, JsonOptions);
            if (decoded is null || decoded.Count == 0)
            {
                return CloneDefaults();
            }

            return MergeWithDefaults(decoded);
        }
        catch (JsonException)
        {
            return CloneDefaults();
        }
    }

    public async Task<IReadOnlyDictionary<string, TrustTierCriteria>> UpdateConfigAsync(
        int tenantId,
        IReadOnlyDictionary<string, object?> criteria,
        CancellationToken ct)
    {
        var sanitized = SanitizeCriteria(criteria);
        if (sanitized.Count == 0)
        {
            throw new TrustTierValidationException("criteria is required", "criteria");
        }

        var now = DateTime.UtcNow;
        var row = await _db.CaringTrustTierConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(config => config.TenantId == tenantId, ct);

        if (row is null)
        {
            row = new CaringTrustTierConfig
            {
                TenantId = tenantId,
                CreatedAt = now
            };
            _db.CaringTrustTierConfigs.Add(row);
        }

        row.Criteria = JsonSerializer.Serialize(sanitized, JsonOptions);
        row.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);

        return await GetConfigAsync(tenantId, ct);
    }

    public async Task<int> RecomputeForUserAsync(int userId, int tenantId, CancellationToken ct)
    {
        var tier = await ComputeTierAsync(userId, tenantId, ct);
        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.Id == userId && row.TenantId == tenantId, ct);

        if (user is not null)
        {
            user.TrustTier = tier;
            user.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }

        return tier;
    }

    public async Task<int> RecomputeAllAsync(int tenantId, CancellationToken ct)
    {
        if (!IsAvailable())
        {
            return 0;
        }

        var users = await _db.Users
            .IgnoreQueryFilters()
            .Where(user => user.TenantId == tenantId && user.IsActive)
            .OrderBy(user => user.Id)
            .ToListAsync(ct);

        foreach (var user in users)
        {
            user.TrustTier = await ComputeTierAsync(user.Id, tenantId, ct);
            user.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
        return users.Count;
    }

    public async Task<TrustTierBreakdown> ComputeBreakdownForUserAsync(
        int userId,
        int tenantId,
        CancellationToken ct)
    {
        var tier = await ComputeTierAsync(userId, tenantId, ct);
        var tierLabel = GetTierLabel(tier);
        var nextTier = tier < TierCoordinator ? tier + 1 : (int?)null;
        var nextTierLabel = nextTier is null ? null : GetTierLabel(nextTier.Value);
        var stats = await GatherStatsAsync(userId, tenantId, ct);
        var config = await GetConfigAsync(tenantId, ct);
        var targetTierName = nextTierLabel ?? "coordinator";
        var target = config.TryGetValue(targetTierName, out var criteria)
            ? criteria
            : DefaultCriteria["member"];

        var signals = new[]
        {
            new TrustTierSignal(
                "hours_logged",
                "trust_tier.signals.hours_logged",
                stats.HoursLogged,
                target.HoursLogged,
                target.HoursLogged == 0 || stats.HoursLogged >= target.HoursLogged,
                "hours"),
            new TrustTierSignal(
                "reviews_received",
                "trust_tier.signals.reviews_received",
                stats.ReviewsReceived,
                target.ReviewsReceived,
                target.ReviewsReceived == 0 || stats.ReviewsReceived >= target.ReviewsReceived,
                "reviews"),
            new TrustTierSignal(
                "identity_verified",
                "trust_tier.signals.identity_verified",
                stats.IdentityVerified ? 1 : 0,
                target.IdentityVerified ? 1 : 0,
                !target.IdentityVerified || stats.IdentityVerified,
                "boolean")
        };

        var progress = Math.Round(signals.Count(signal => signal.Achieved) / (decimal)signals.Length * 100m, 1);
        return new TrustTierBreakdown(tier, tierLabel, nextTierLabel, progress, signals);
    }

    public async Task<int> ComputeTierAsync(int userId, int tenantId, CancellationToken ct)
    {
        var config = await GetConfigAsync(tenantId, ct);
        var stats = await GatherStatsAsync(userId, tenantId, ct);

        foreach (var (tier, name) in new[]
                 {
                     (TierCoordinator, "coordinator"),
                     (TierVerified, "verified"),
                     (TierTrusted, "trusted"),
                     (TierMember, "member")
                 })
        {
            var criteria = config.TryGetValue(name, out var threshold)
                ? threshold
                : DefaultCriteria[name];

            var hoursOk = stats.HoursLogged >= criteria.HoursLogged;
            var reviewsOk = stats.ReviewsReceived >= criteria.ReviewsReceived;
            var identityOk = !criteria.IdentityVerified || stats.IdentityVerified;

            if (hoursOk && reviewsOk && identityOk)
            {
                return tier;
            }
        }

        return TierNewcomer;
    }

    public string GetTierLabel(int tier)
    {
        return TierLabels.TryGetValue(tier, out var label)
            ? label
            : TierLabels[TierNewcomer];
    }

    public IReadOnlyDictionary<string, TrustTierCriteria> SanitizeCriteria(
        IReadOnlyDictionary<string, object?> raw)
    {
        var sanitized = new Dictionary<string, TrustTierCriteria>(StringComparer.Ordinal);
        foreach (var tier in DefaultCriteria.Keys)
        {
            if (!raw.TryGetValue(tier, out var value))
            {
                continue;
            }

            if (!TryReadCriteria(value, out var provided))
            {
                continue;
            }

            var fallback = DefaultCriteria[tier];
            sanitized[tier] = new TrustTierCriteria(
                Math.Max(0, provided.HoursLogged ?? fallback.HoursLogged),
                Math.Max(0, provided.ReviewsReceived ?? fallback.ReviewsReceived),
                provided.IdentityVerified ?? fallback.IdentityVerified);
        }

        return sanitized;
    }

    private async Task<TrustTierStats> GatherStatsAsync(int userId, int tenantId, CancellationToken ct)
    {
        var hours = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .Where(log => log.UserId == userId && log.TenantId == tenantId && log.Status == "approved")
            .SumAsync(log => (decimal?)log.Hours, ct) ?? 0m;

        var reviews = await _db.Reviews
            .IgnoreQueryFilters()
            .CountAsync(review => review.TenantId == tenantId && review.TargetUserId == userId, ct);

        var identityVerified = await IsIdentityVerifiedAsync(userId, tenantId, ct);
        return new TrustTierStats((int)hours, reviews, identityVerified);
    }

    private async Task<bool> IsIdentityVerifiedAsync(int userId, int tenantId, CancellationToken ct)
    {
        var userVerified = await _db.Users
            .IgnoreQueryFilters()
            .Where(user => user.Id == userId && user.TenantId == tenantId)
            .Select(user => user.EmailVerified)
            .FirstOrDefaultAsync(ct);

        if (userVerified)
        {
            return true;
        }

        return await _db.IdentityVerificationSessions
            .IgnoreQueryFilters()
            .AnyAsync(session =>
                session.UserId == userId
                && session.TenantId == tenantId
                && session.Status == VerificationSessionStatus.Completed
                && session.CompletedAt != null
                && (session.ProviderDecision == null
                    || session.ProviderDecision == "approved"
                    || session.ProviderDecision == "passed"
                    || session.ProviderDecision == "verified"), ct);
    }

    private static IReadOnlyDictionary<string, TrustTierCriteria> CloneDefaults()
    {
        return DefaultCriteria.ToDictionary(
            entry => entry.Key,
            entry => entry.Value,
            StringComparer.Ordinal);
    }

    private static IReadOnlyDictionary<string, TrustTierCriteria> MergeWithDefaults(
        IReadOnlyDictionary<string, TrustTierCriteria> decoded)
    {
        var merged = CloneDefaults().ToDictionary(entry => entry.Key, entry => entry.Value, StringComparer.Ordinal);
        foreach (var tier in DefaultCriteria.Keys)
        {
            if (!decoded.TryGetValue(tier, out var provided))
            {
                continue;
            }

            var fallback = DefaultCriteria[tier];
            merged[tier] = new TrustTierCriteria(
                Math.Max(0, provided.HoursLogged),
                Math.Max(0, provided.ReviewsReceived),
                provided.IdentityVerified);
        }

        return merged;
    }

    private static bool TryReadCriteria(object? raw, out PartialTrustTierCriteria criteria)
    {
        criteria = new PartialTrustTierCriteria(null, null, null);
        if (raw is null)
        {
            return false;
        }

        if (raw is JsonElement element)
        {
            criteria = new PartialTrustTierCriteria(
                TryGetInt(element, "hours_logged"),
                TryGetInt(element, "reviews_received"),
                TryGetBool(element, "identity_verified"));
            return true;
        }

        if (raw is IReadOnlyDictionary<string, object?> dictionary)
        {
            criteria = new PartialTrustTierCriteria(
                TryConvertInt(GetDictionaryValue(dictionary, "hours_logged", "HoursLogged")),
                TryConvertInt(GetDictionaryValue(dictionary, "reviews_received", "ReviewsReceived")),
                TryConvertBool(GetDictionaryValue(dictionary, "identity_verified", "IdentityVerified")));
            return true;
        }

        var type = raw.GetType();
        criteria = new PartialTrustTierCriteria(
            TryConvertInt(type.GetProperty("HoursLogged")?.GetValue(raw)),
            TryConvertInt(type.GetProperty("ReviewsReceived")?.GetValue(raw)),
            TryConvertBool(type.GetProperty("IdentityVerified")?.GetValue(raw)));
        return criteria.HoursLogged is not null
            || criteria.ReviewsReceived is not null
            || criteria.IdentityVerified is not null;
    }

    private static object? GetDictionaryValue(
        IReadOnlyDictionary<string, object?> dictionary,
        string snake,
        string pascal)
    {
        if (dictionary.TryGetValue(snake, out var snakeValue))
        {
            return snakeValue;
        }

        return dictionary.TryGetValue(pascal, out var pascalValue) ? pascalValue : null;
    }

    private static int? TryGetInt(JsonElement element, string property)
    {
        return element.TryGetProperty(property, out var value) && value.TryGetInt32(out var parsed)
            ? parsed
            : null;
    }

    private static bool? TryGetBool(JsonElement element, string property)
    {
        return element.TryGetProperty(property, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? value.GetBoolean()
            : null;
    }

    private static int? TryConvertInt(object? value)
    {
        return value is null ? null : Convert.ToInt32(value);
    }

    private static bool? TryConvertBool(object? value)
    {
        return value switch
        {
            null => null,
            bool boolean => boolean,
            string text => text.Trim().ToLowerInvariant() is "1" or "true" or "yes" or "on",
            _ => Convert.ToBoolean(value)
        };
    }

    private static bool IsTruthy(string? value)
    {
        return value?.Trim().ToLowerInvariant() is "1" or "true" or "yes" or "on";
    }

    private sealed record PartialTrustTierCriteria(int? HoursLogged, int? ReviewsReceived, bool? IdentityVerified);

    private sealed record TrustTierStats(int HoursLogged, int ReviewsReceived, bool IdentityVerified);
}

public sealed class TrustTierValidationException : Exception
{
    public TrustTierValidationException(string message, string? field = null) : base(message)
    {
        Field = field;
    }

    public string? Field { get; }
}

public sealed record TrustTierCriteria(
    [property: JsonPropertyName("hours_logged")] int HoursLogged,
    [property: JsonPropertyName("reviews_received")] int ReviewsReceived,
    [property: JsonPropertyName("identity_verified")] bool IdentityVerified);

public sealed record TrustTierBreakdown(
    [property: JsonPropertyName("tier")] int Tier,
    [property: JsonPropertyName("tier_label")] string TierLabel,
    [property: JsonPropertyName("next_tier_label")] string? NextTierLabel,
    [property: JsonPropertyName("progress_pct")] decimal ProgressPct,
    [property: JsonPropertyName("signals")] IReadOnlyList<TrustTierSignal> Signals);

public sealed record TrustTierSignal(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("label_key")] string LabelKey,
    [property: JsonPropertyName("current")] int Current,
    [property: JsonPropertyName("required")] int Required,
    [property: JsonPropertyName("achieved")] bool Achieved,
    [property: JsonPropertyName("unit")] string Unit);

public sealed class TrustTierConfigRequest
{
    [JsonPropertyName("criteria")]
    public Dictionary<string, object?>? Criteria { get; set; }
}
