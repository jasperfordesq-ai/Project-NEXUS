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

public sealed class CivicDigestService
{
    public const string TenantDefaultCadenceKey = "caring.civic_digest.tenant_default_cadence";
    public const string UserPrefsKeyPrefix = "caring.civic_digest.user_prefs.";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static readonly IReadOnlyDictionary<string, int> SourceWeights = new Dictionary<string, int>
    {
        ["safety_alert"] = 10,
        ["project"] = 3,
        ["announcement"] = 2,
        ["event"] = 1,
        ["vol_org"] = 1,
        ["care_provider"] = 1,
        ["marketplace"] = 1,
        ["help_request"] = 1,
        ["feed_post"] = 1
    };

    private static readonly string[] AllowedSources =
    [
        "announcement",
        "project",
        "event",
        "vol_org",
        "care_provider",
        "marketplace",
        "safety_alert",
        "help_request",
        "feed_post"
    ];

    private readonly NexusDbContext _db;

    public CivicDigestService(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == "features.caring_community")
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public async Task<CivicDigestMemberResult> GetDigestForMemberAsync(
        int tenantId,
        int userId,
        int? limit,
        CancellationToken ct)
    {
        if (tenantId <= 0 || userId <= 0)
        {
            return new CivicDigestMemberResult([], await DefaultPrefsAsync(tenantId, ct), await GetTenantCadenceAsync(tenantId, ct));
        }

        var prefs = await GetUserPrefsAsync(tenantId, userId, ct);
        var tenantCadence = await GetTenantCadenceAsync(tenantId, ct);
        var itemLimit = Math.Clamp(limit ?? 50, 1, 100);
        var optOutSources = prefs.OptOutSources.ToHashSet(StringComparer.Ordinal);
        var userSubRegionId = prefs.PreferredSubRegionId is > 0 ? prefs.PreferredSubRegionId : null;

        var candidates = await FetchCandidatesAsync(tenantId, ct);
        var scored = candidates
            .Where(candidate => !optOutSources.Contains(candidate.Source))
            .Select(candidate => Score(candidate, userSubRegionId))
            .Where(item => item.AudienceMatchScore >= 1)
            .OrderByDescending(item => item.AudienceMatchScore)
            .ThenByDescending(item => item.SortOccurredAt)
            .Take(itemLimit)
            .Select(item => item.Dto)
            .ToList();

        return new CivicDigestMemberResult(scored, prefs, tenantCadence);
    }

    public async Task<CivicDigestPrefsEnvelope> GetPrefsEnvelopeAsync(
        int tenantId,
        int userId,
        CancellationToken ct)
    {
        return new CivicDigestPrefsEnvelope(
            await GetUserPrefsAsync(tenantId, userId, ct),
            await GetTenantCadenceAsync(tenantId, ct));
    }

    public async Task<CivicDigestPrefsUpdateResult> SetUserPrefsAsync(
        int tenantId,
        int userId,
        CivicDigestPrefsRequest request,
        CancellationToken ct)
    {
        var errors = new List<CivicDigestValidationError>();
        var current = await GetUserPrefsAsync(tenantId, userId, ct);

        var cadence = current.Cadence;
        var enabled = current.Enabled;
        if (request.Cadence is not null)
        {
            var normalized = NormalizeCadence(request.Cadence);
            if (normalized is null)
            {
                errors.Add(new CivicDigestValidationError(
                    "cadence",
                    "Cadence must be one of off, daily, or monthly."));
            }
            else
            {
                cadence = normalized;
                enabled = normalized != "off";
            }
        }

        var preferredSubRegionId = current.PreferredSubRegionId;
        if (request.PreferredSubRegionId.HasValue)
        {
            preferredSubRegionId = request.PreferredSubRegionId.Value > 0
                ? request.PreferredSubRegionId.Value
                : null;
        }

        var optOutSources = current.OptOutSources.ToList();
        if (request.OptOutSources is not null)
        {
            optOutSources = NormalizeOptOutSources(request.OptOutSources);
        }

        if (errors.Count > 0)
        {
            return new CivicDigestPrefsUpdateResult(null, errors);
        }

        var updatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var prefs = new CivicDigestPrefsDto
        {
            Enabled = enabled,
            Cadence = cadence,
            PreferredSubRegionId = preferredSubRegionId,
            OptOutSources = optOutSources,
            UpdatedAt = updatedAt
        };

        var now = DateTime.UtcNow;
        var key = UserPrefsKeyPrefix + userId.ToString();
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key, ct);

        var value = JsonSerializer.Serialize(new
        {
            enabled = prefs.Enabled,
            cadence = prefs.Cadence,
            preferred_sub_region_id = prefs.PreferredSubRegionId,
            opt_out_sources = prefs.OptOutSources,
            updated_at = prefs.UpdatedAt
        }, JsonOptions);

        if (row is null)
        {
            row = new TenantConfig
            {
                TenantId = tenantId,
                Key = key,
                Value = value,
                CreatedAt = now,
                UpdatedAt = now
            };
            _db.TenantConfigs.Add(row);
        }
        else
        {
            row.Value = value;
            row.UpdatedAt = now;
        }

        await _db.SaveChangesAsync(ct);
        return new CivicDigestPrefsUpdateResult(prefs, []);
    }

    public async Task<string> GetTenantCadenceAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key == TenantDefaultCadenceKey)
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        if (string.IsNullOrWhiteSpace(raw))
        {
            return "monthly";
        }

        return NormalizeCadence(raw.Trim().Trim('"')) ?? "monthly";
    }

    public async Task<CivicDigestCadenceResult> SetTenantCadenceAsync(
        int tenantId,
        string? cadence,
        CancellationToken ct)
    {
        var normalized = NormalizeCadence(cadence);
        if (normalized is null)
        {
            return new CivicDigestCadenceResult(
                ErrorField: "cadence",
                ErrorMessage: "Cadence must be one of off, daily, or monthly.");
        }

        var now = DateTime.UtcNow;
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == TenantDefaultCadenceKey, ct);

        if (row is null)
        {
            row = new TenantConfig
            {
                TenantId = tenantId,
                Key = TenantDefaultCadenceKey,
                Value = normalized,
                CreatedAt = now,
                UpdatedAt = now
            };
            _db.TenantConfigs.Add(row);
        }
        else
        {
            row.Value = normalized;
            row.UpdatedAt = now;
        }

        await _db.SaveChangesAsync(ct);
        return new CivicDigestCadenceResult(Cadence: normalized);
    }

    private async Task<CivicDigestPrefsDto> GetUserPrefsAsync(int tenantId, int userId, CancellationToken ct)
    {
        var defaults = await DefaultPrefsAsync(tenantId, ct);
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key == UserPrefsKeyPrefix + userId.ToString())
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        if (string.IsNullOrWhiteSpace(raw))
        {
            return defaults;
        }

        try
        {
            using var document = JsonDocument.Parse(raw);
            var root = document.RootElement;
            var cadence = TryGetString(root, "cadence") is { } rawCadence
                ? NormalizeCadence(rawCadence) ?? defaults.Cadence
                : defaults.Cadence;

            return new CivicDigestPrefsDto
            {
                Enabled = TryGetBool(root, "enabled") ?? true,
                Cadence = cadence,
                PreferredSubRegionId = TryGetInt(root, "preferred_sub_region_id"),
                OptOutSources = NormalizeOptOutSources(TryGetStringArray(root, "opt_out_sources")),
                UpdatedAt = TryGetLong(root, "updated_at")
            };
        }
        catch (JsonException)
        {
            return defaults;
        }
    }

    private async Task<CivicDigestPrefsDto> DefaultPrefsAsync(int tenantId, CancellationToken ct)
    {
        return new CivicDigestPrefsDto
        {
            Enabled = true,
            Cadence = await GetTenantCadenceAsync(tenantId, ct),
            PreferredSubRegionId = null,
            OptOutSources = [],
            UpdatedAt = null
        };
    }

    private async Task<List<DigestCandidate>> FetchCandidatesAsync(int tenantId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var cutoff = now.AddDays(-30);
        var candidates = new List<DigestCandidate>();

        var announcements = await _db.CaringProjectAnnouncements
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(p => p.TenantId == tenantId
                && (p.Status == "active" || p.Status == "paused" || p.Status == "completed")
                && ((p.PublishedAt != null && p.PublishedAt >= cutoff) || (p.LastUpdateAt != null && p.LastUpdateAt >= cutoff))
                && (p.CurrentStage == null || p.ProgressPercent >= 100))
            .OrderByDescending(p => p.LastUpdateAt ?? p.PublishedAt ?? p.CreatedAt)
            .Take(20)
            .ToListAsync(ct);
        candidates.AddRange(announcements.Select(row => new DigestCandidate(
            Id: $"announcement:{row.Id}",
            Source: "announcement",
            Title: row.Title,
            Summary: row.Summary ?? string.Empty,
            OccurredAt: row.LastUpdateAt ?? row.PublishedAt,
            SubRegionId: null,
            LinkPath: $"/caring-community/projects/{row.Id}",
            Categories: [])));

        var projects = await _db.CaringProjectAnnouncements
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(p => p.TenantId == tenantId
                && (p.Status == "active" || p.Status == "paused")
                && p.ProgressPercent < 100
                && ((p.PublishedAt != null && p.PublishedAt >= cutoff) || (p.LastUpdateAt != null && p.LastUpdateAt >= cutoff)))
            .OrderByDescending(p => p.LastUpdateAt ?? p.PublishedAt ?? p.CreatedAt)
            .Take(20)
            .ToListAsync(ct);
        candidates.AddRange(projects.Select(row => new DigestCandidate(
            Id: $"project:{row.Id}",
            Source: "project",
            Title: row.Title,
            Summary: row.Summary ?? string.Empty,
            OccurredAt: row.LastUpdateAt ?? row.PublishedAt,
            SubRegionId: null,
            LinkPath: $"/caring-community/projects/{row.Id}",
            Categories: [])));

        var events = await _db.Events
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(e => e.TenantId == tenantId
                && !e.IsCancelled
                && e.StartsAt >= now
                && e.StartsAt <= now.AddDays(45)
                && (e.CreatedAt >= cutoff || (e.UpdatedAt != null && e.UpdatedAt >= cutoff)))
            .OrderBy(e => e.StartsAt)
            .Take(20)
            .ToListAsync(ct);
        candidates.AddRange(events.Select(row => new DigestCandidate(
            Id: $"event:{row.Id}",
            Source: "event",
            Title: row.Title,
            Summary: Shorten(row.Description ?? string.Empty),
            OccurredAt: row.StartsAt,
            SubRegionId: null,
            LinkPath: $"/events/{row.Id}",
            Categories: [])));

        var providers = await _db.CaringCareProviders
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(p => p.TenantId == tenantId
                && p.Status == "active"
                && (p.CreatedAt >= cutoff || (p.UpdatedAt != null && p.UpdatedAt >= cutoff)))
            .OrderByDescending(p => p.UpdatedAt ?? p.CreatedAt)
            .Take(15)
            .ToListAsync(ct);
        candidates.AddRange(providers.Select(row => new DigestCandidate(
            Id: $"care_provider:{row.Id}",
            Source: "care_provider",
            Title: row.Name,
            Summary: Shorten(row.Description ?? string.Empty),
            OccurredAt: row.UpdatedAt ?? row.CreatedAt,
            SubRegionId: row.SubRegionId,
            LinkPath: $"/caring-community/care-providers/{row.Id}",
            Categories: ParseStringArray(row.Categories))));

        var marketplace = await _db.MarketplaceListings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(l => l.TenantId == tenantId
                && l.Status == "active"
                && l.ModerationStatus == "approved"
                && (l.CreatedAt >= cutoff || (l.UpdatedAt != null && l.UpdatedAt >= cutoff)))
            .OrderByDescending(l => l.CreatedAt)
            .Take(15)
            .ToListAsync(ct);
        candidates.AddRange(marketplace.Select(row => new DigestCandidate(
            Id: $"marketplace:{row.Id}",
            Source: "marketplace",
            Title: row.Title,
            Summary: Shorten(row.Description),
            OccurredAt: row.CreatedAt,
            SubRegionId: null,
            LinkPath: $"/marketplace/{row.Id}",
            Categories: [])));

        var safetyAlerts = await _db.CaringEmergencyAlerts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId
                && a.IsActive
                && (a.ExpiresAt == null || a.ExpiresAt >= now)
                && ((a.SentAt != null && a.SentAt >= cutoff) || a.CreatedAt >= cutoff))
            .OrderByDescending(a => a.SentAt ?? a.CreatedAt)
            .Take(10)
            .ToListAsync(ct);
        candidates.AddRange(safetyAlerts.Select(row => new DigestCandidate(
            Id: $"safety_alert:{row.Id}",
            Source: "safety_alert",
            Title: row.Title,
            Summary: Shorten(row.Body),
            OccurredAt: row.SentAt ?? row.CreatedAt,
            SubRegionId: null,
            LinkPath: $"/caring-community/alerts/{row.Id}",
            Categories: [])));

        var feedPosts = await _db.FeedPosts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(p => p.TenantId == tenantId
                && !p.IsHidden
                && (p.CreatedAt >= cutoff || (p.UpdatedAt != null && p.UpdatedAt >= cutoff)))
            .OrderByDescending(p => p.CreatedAt)
            .Take(15)
            .ToListAsync(ct);
        candidates.AddRange(feedPosts.Select(row => new DigestCandidate(
            Id: $"feed_post:{row.Id}",
            Source: "feed_post",
            Title: Shorten(row.Content, 80),
            Summary: Shorten(row.Content),
            OccurredAt: row.CreatedAt,
            SubRegionId: null,
            LinkPath: $"/feed/{row.Id}",
            Categories: [])));

        return candidates;
    }

    private static ScoredDigestItem Score(DigestCandidate candidate, int? userSubRegionId)
    {
        var score = 0;
        var reasons = new List<CivicDigestScoreReasonDto>();

        if (SourceWeights.TryGetValue(candidate.Source, out var sourceWeight) && sourceWeight > 0)
        {
            score += sourceWeight;
            if (candidate.Source == "safety_alert")
            {
                reasons.Add(new CivicDigestScoreReasonDto("safety", "civic_digest.transparency.reason_safety", sourceWeight));
            }
            else if (candidate.Source == "announcement")
            {
                reasons.Add(new CivicDigestScoreReasonDto("announcement", "civic_digest.transparency.reason_announcement", sourceWeight));
            }
            else if (candidate.Source == "project")
            {
                reasons.Add(new CivicDigestScoreReasonDto("priority", "civic_digest.transparency.reason_priority", sourceWeight));
            }
        }

        if (candidate.OccurredAt is { } occurredAt)
        {
            var ageDays = Math.Max(0, (DateTime.UtcNow - occurredAt).TotalDays);
            if (ageDays <= 30)
            {
                var recencyBoost = (int)Math.Round(5 * (1 - (ageDays / 30)), MidpointRounding.AwayFromZero);
                if (recencyBoost > 0)
                {
                    score += recencyBoost;
                    reasons.Add(new CivicDigestScoreReasonDto(
                        "recency",
                        "civic_digest.transparency.reason_recency",
                        recencyBoost));
                }
            }
        }

        if (userSubRegionId is not null && candidate.SubRegionId == userSubRegionId)
        {
            score += 5;
            reasons.Add(new CivicDigestScoreReasonDto(
                "sub_region_match",
                "civic_digest.transparency.reason_sub_region",
                5));
        }

        var orderedReasons = reasons
            .OrderByDescending(reason => reason.Weight)
            .Take(3)
            .ToList();

        var dto = new CivicDigestItemDto
        {
            Id = candidate.Id,
            Source = candidate.Source,
            Title = candidate.Title,
            Summary = candidate.Summary,
            OccurredAt = FormatDateTime(candidate.OccurredAt),
            SubRegionId = candidate.SubRegionId,
            AudienceMatchScore = score,
            LinkPath = candidate.LinkPath,
            ScoreReasons = orderedReasons
        };

        return new ScoredDigestItem(dto, candidate.OccurredAt ?? DateTime.MinValue, score);
    }

    private static string? NormalizeCadence(string? cadence)
    {
        var normalized = cadence?.Trim().ToLowerInvariant();
        return normalized switch
        {
            "weekly" => "monthly",
            "off" or "daily" or "monthly" => normalized,
            _ => null
        };
    }

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" or "enabled" => true,
            "false" or "0" or "no" or "off" or "disabled" => false,
            _ => null
        };
    }

    private static List<string> NormalizeOptOutSources(IEnumerable<string?> sources)
    {
        var allowed = AllowedSources.ToHashSet(StringComparer.Ordinal);
        return sources
            .Where(source => !string.IsNullOrWhiteSpace(source))
            .Select(source => source!.Trim())
            .Where(source => allowed.Contains(source))
            .Distinct(StringComparer.Ordinal)
            .ToList();
    }

    private static IReadOnlyList<string> TryGetStringArray(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var values = new List<string>();
        foreach (var item in property.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && item.GetString() is { } value)
            {
                values.Add(value);
            }
        }

        return values;
    }

    private static string? TryGetString(JsonElement root, string propertyName)
    {
        return root.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
    }

    private static bool? TryGetBool(JsonElement root, string propertyName)
    {
        return root.TryGetProperty(propertyName, out var property) && property.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? property.GetBoolean()
            : null;
    }

    private static int? TryGetInt(JsonElement root, string propertyName)
    {
        return root.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var value)
            ? value
            : null;
    }

    private static long? TryGetLong(JsonElement root, string propertyName)
    {
        return root.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.Number && property.TryGetInt64(out var value)
            ? value
            : null;
    }

    private static IReadOnlyList<string> ParseStringArray(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<string[]>(raw, JsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static string Shorten(string text, int max = 240)
    {
        var normalized = text.Trim();
        if (normalized.Length <= max)
        {
            return normalized;
        }

        return normalized[..Math.Max(0, max - 3)] + "...";
    }

    private static string? FormatDateTime(DateTime? value)
    {
        return value?.ToUniversalTime().ToString("O");
    }

    private sealed record DigestCandidate(
        string Id,
        string Source,
        string Title,
        string Summary,
        DateTime? OccurredAt,
        int? SubRegionId,
        string? LinkPath,
        IReadOnlyList<string> Categories);

    private sealed record ScoredDigestItem(
        CivicDigestItemDto Dto,
        DateTime SortOccurredAt,
        int AudienceMatchScore);
}

public sealed class CivicDigestPrefsRequest
{
    [JsonPropertyName("cadence")]
    public string? Cadence { get; set; }

    [JsonPropertyName("preferred_sub_region_id")]
    public int? PreferredSubRegionId { get; set; }

    [JsonPropertyName("opt_out_sources")]
    public List<string>? OptOutSources { get; set; }
}

public sealed class CivicDigestPrefsDto
{
    [JsonPropertyName("enabled")]
    public bool Enabled { get; init; }

    [JsonPropertyName("cadence")]
    public string Cadence { get; init; } = "monthly";

    [JsonPropertyName("preferred_sub_region_id")]
    public int? PreferredSubRegionId { get; init; }

    [JsonPropertyName("opt_out_sources")]
    public IReadOnlyList<string> OptOutSources { get; init; } = [];

    [JsonPropertyName("updated_at")]
    public long? UpdatedAt { get; init; }
}

public sealed class CivicDigestItemDto
{
    [JsonPropertyName("id")]
    public string Id { get; init; } = string.Empty;

    [JsonPropertyName("source")]
    public string Source { get; init; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; init; } = string.Empty;

    [JsonPropertyName("summary")]
    public string Summary { get; init; } = string.Empty;

    [JsonPropertyName("occurred_at")]
    public string? OccurredAt { get; init; }

    [JsonPropertyName("sub_region_id")]
    public int? SubRegionId { get; init; }

    [JsonPropertyName("audience_match_score")]
    public int AudienceMatchScore { get; init; }

    [JsonPropertyName("link_path")]
    public string? LinkPath { get; init; }

    [JsonPropertyName("score_reasons")]
    public IReadOnlyList<CivicDigestScoreReasonDto> ScoreReasons { get; init; } = [];
}

public sealed record CivicDigestScoreReasonDto(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("label_key")] string LabelKey,
    [property: JsonPropertyName("weight")] int Weight);

public sealed record CivicDigestMemberResult(
    IReadOnlyList<CivicDigestItemDto> Items,
    CivicDigestPrefsDto Prefs,
    string TenantDefaultCadence);

public sealed record CivicDigestPrefsEnvelope(
    CivicDigestPrefsDto Prefs,
    string TenantDefaultCadence);

public sealed record CivicDigestValidationError(
    string Field,
    string Message);

public sealed record CivicDigestPrefsUpdateResult(
    CivicDigestPrefsDto? Prefs,
    IReadOnlyList<CivicDigestValidationError> Errors);

public sealed class CivicDigestCadenceRequest
{
    [JsonPropertyName("cadence")] public string? Cadence { get; set; }
}

public sealed record CivicDigestCadenceResult(
    string? Cadence = null,
    string? ErrorField = null,
    string? ErrorMessage = null);
