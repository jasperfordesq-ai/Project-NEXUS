// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Laravel-compatible neutral-fallback tandem matcher for Caring Community coordinators.
/// </summary>
public sealed class CaringTandemMatchingService
{
    private const decimal MinScore = 0.4m;
    private const int MaxPerUser = 3;
    private const int SuppressionDays = 90;
    private const decimal WeightDistance = 0.30m;
    private const decimal WeightLanguage = 0.25m;
    private const decimal WeightSkill = 0.20m;
    private const decimal WeightAvailability = 0.15m;
    private const decimal WeightInterest = 0.10m;

    private readonly NexusDbContext _db;

    public CaringTandemMatchingService(NexusDbContext db)
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

    public async Task<IReadOnlyList<TandemSuggestion>> SuggestTandemsAsync(
        int tenantId,
        int? limit,
        CancellationToken ct)
    {
        var candidates = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.TenantId == tenantId && user.IsActive)
            .OrderBy(user => user.Id)
            .Take(2000)
            .Select(user => new TandemCandidate(
                user.Id,
                DisplayName(user),
                user.AvatarUrl ?? string.Empty))
            .ToListAsync(ct);

        if (candidates.Count < 2)
        {
            return Array.Empty<TandemSuggestion>();
        }

        var busyUserIds = await BusyUserIdsAsync(tenantId, ct);
        var suppressedPairs = await SuppressedPairsAsync(tenantId, ct);
        var available = candidates
            .Where(candidate => !busyUserIds.Contains(candidate.Id))
            .ToArray();
        if (available.Length < 2)
        {
            return Array.Empty<TandemSuggestion>();
        }

        var scored = new List<TandemSuggestion>();
        for (var i = 0; i < available.Length; i++)
        {
            for (var j = i + 1; j < available.Length; j++)
            {
                if (suppressedPairs.Contains(PairKey(available[i].Id, available[j].Id)))
                {
                    continue;
                }

                var (signals, score) = ScoreNeutralPair();
                if (score < MinScore)
                {
                    continue;
                }

                scored.Add(new TandemSuggestion(
                    PresentUser(available[i]),
                    PresentUser(available[j]),
                    decimal.Round(score, 3),
                    signals,
                    BuildReason(signals)));
            }
        }

        var cap = Math.Max(1, Math.Min(100, limit ?? 20));
        var perUserCount = new Dictionary<int, int>();
        var output = new List<TandemSuggestion>();
        foreach (var suggestion in scored
                     .OrderByDescending(item => item.Score)
                     .ThenBy(item => item.Supporter.Id)
                     .ThenBy(item => item.Recipient.Id))
        {
            var supporterUsage = perUserCount.GetValueOrDefault(suggestion.Supporter.Id);
            var recipientUsage = perUserCount.GetValueOrDefault(suggestion.Recipient.Id);
            if (supporterUsage >= MaxPerUser || recipientUsage >= MaxPerUser)
            {
                continue;
            }

            output.Add(suggestion);
            perUserCount[suggestion.Supporter.Id] = supporterUsage + 1;
            perUserCount[suggestion.Recipient.Id] = recipientUsage + 1;
            if (output.Count >= cap)
            {
                break;
            }
        }

        return output;
    }

    public async Task MarkSuggestionAsConsideredAsync(
        int tenantId,
        int supporterId,
        int recipientId,
        string action,
        int? createdByUserId,
        CancellationToken ct)
    {
        if (supporterId <= 0 || recipientId <= 0 || supporterId == recipientId)
        {
            return;
        }

        if (action is not ("created_relationship" or "dismissed"))
        {
            return;
        }

        var low = Math.Min(supporterId, recipientId);
        var high = Math.Max(supporterId, recipientId);
        var now = DateTime.UtcNow;

        var existing = await _db.CaringTandemSuggestionLogs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row =>
                row.TenantId == tenantId
                && row.SupporterUserId == low
                && row.RecipientUserId == high,
                ct);

        if (existing is null)
        {
            _db.CaringTandemSuggestionLogs.Add(new CaringTandemSuggestionLog
            {
                TenantId = tenantId,
                SupporterUserId = low,
                RecipientUserId = high,
                Action = action,
                CreatedByUserId = createdByUserId,
                CreatedAt = now
            });
        }
        else
        {
            existing.Action = action;
            existing.CreatedByUserId = createdByUserId;
            existing.CreatedAt = now;
        }

        await _db.SaveChangesAsync(ct);
    }

    private async Task<HashSet<int>> BusyUserIdsAsync(int tenantId, CancellationToken ct)
    {
        var rows = await _db.CaringSupportRelationships
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(relationship => relationship.TenantId == tenantId && relationship.Status == "active")
            .Select(relationship => new { relationship.SupporterId, relationship.RecipientId })
            .ToListAsync(ct);

        return rows
            .SelectMany(row => new[] { row.SupporterId, row.RecipientId })
            .ToHashSet();
    }

    private async Task<HashSet<string>> SuppressedPairsAsync(int tenantId, CancellationToken ct)
    {
        var cutoff = DateTime.UtcNow.AddDays(-SuppressionDays);
        var rows = await _db.CaringTandemSuggestionLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.CreatedAt >= cutoff)
            .Select(row => new { row.SupporterUserId, row.RecipientUserId })
            .ToListAsync(ct);

        return rows
            .Select(row => PairKey(row.SupporterUserId, row.RecipientUserId))
            .ToHashSet(StringComparer.Ordinal);
    }

    private static string PairKey(int a, int b)
    {
        var low = Math.Min(a, b);
        var high = Math.Max(a, b);
        return $"{low}:{high}";
    }

    private static (TandemSignals Signals, decimal Score) ScoreNeutralPair()
    {
        const decimal distanceScore = 0.5m;
        const decimal languageOverlap = 0.5m;
        const decimal skillComplement = 0.5m;
        const decimal availabilityOverlap = 0.4m;
        const decimal interestOverlap = 0.3m;
        const decimal intergenerationalSignal = 0.5m;

        var score =
            (WeightDistance * distanceScore)
            + (WeightLanguage * languageOverlap)
            + (WeightSkill * skillComplement)
            + (WeightAvailability * availabilityOverlap)
            + (WeightInterest * interestOverlap);

        return (new TandemSignals(
            languageOverlap,
            skillComplement,
            availabilityOverlap,
            interestOverlap,
            false,
            intergenerationalSignal), score);
    }

    private static string BuildReason(TandemSignals signals)
    {
        var parts = new List<string>();
        if (signals.LanguageOverlap >= 0.6m)
        {
            parts.Add("Shares a language");
        }

        if (signals.SkillComplement >= 0.6m)
        {
            parts.Add("Complementary skills");
        }

        if (signals.AvailabilityOverlap >= 0.6m)
        {
            parts.Add("Availability lines up");
        }

        if (signals.InterestOverlap >= 0.5m)
        {
            parts.Add("Shared interests");
        }

        if (signals.Intergenerational)
        {
            parts.Add("Intergenerational pairing");
        }

        return parts.Count == 0 ? "Reasonable overall fit" : string.Join(", ", parts);
    }

    private static TandemUser PresentUser(TandemCandidate user)
    {
        return new TandemUser(user.Id, user.Name, user.AvatarUrl, Array.Empty<string>(), Array.Empty<string>());
    }

    private static string DisplayName(User user)
    {
        var name = string.Join(' ', new[] { user.FirstName, user.LastName }
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .Select(part => part.Trim()));

        return string.IsNullOrWhiteSpace(name) ? user.Email : name;
    }

    private static bool IsTruthy(string? raw)
    {
        return raw is not null
            && (raw.Equals("true", StringComparison.OrdinalIgnoreCase)
                || raw == "1"
                || raw.Equals("yes", StringComparison.OrdinalIgnoreCase)
                || raw.Equals("on", StringComparison.OrdinalIgnoreCase));
    }

    private sealed record TandemCandidate(int Id, string Name, string AvatarUrl);
}

public sealed record TandemSuggestion(
    [property: JsonPropertyName("supporter")] TandemUser Supporter,
    [property: JsonPropertyName("recipient")] TandemUser Recipient,
    [property: JsonPropertyName("score")] decimal Score,
    [property: JsonPropertyName("signals")] TandemSignals Signals,
    [property: JsonPropertyName("reason")] string Reason);

public sealed record TandemUser(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("avatar_url")] string AvatarUrl,
    [property: JsonPropertyName("languages")] IReadOnlyList<string> Languages,
    [property: JsonPropertyName("skills")] IReadOnlyList<string> Skills);

public sealed record TandemSignals(
    [property: JsonPropertyName("language_overlap")] decimal LanguageOverlap,
    [property: JsonPropertyName("skill_complement")] decimal SkillComplement,
    [property: JsonPropertyName("availability_overlap")] decimal AvailabilityOverlap,
    [property: JsonPropertyName("interest_overlap")] decimal InterestOverlap,
    [property: JsonPropertyName("intergenerational")] bool Intergenerational,
    [property: JsonPropertyName("intergenerational_signal")] decimal IntergenerationalSignal);
