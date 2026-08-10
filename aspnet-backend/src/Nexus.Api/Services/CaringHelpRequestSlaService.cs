// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Tenant-scoped help-request SLA dashboard matching the Laravel admin read model.
/// </summary>
public sealed class CaringHelpRequestSlaService
{
    private const double AtRiskRatio = 0.75;

    private readonly NexusDbContext _db;
    private readonly OperatingPolicyService _operatingPolicy;

    public CaringHelpRequestSlaService(NexusDbContext db, OperatingPolicyService operatingPolicy)
    {
        _db = db;
        _operatingPolicy = operatingPolicy;
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

    public async Task<object> DashboardAsync(int tenantId, CancellationToken ct)
    {
        var policy = await ResolvePolicyAsync(tenantId, ct);
        var now = DateTime.UtcNow;
        var rows = await _db.CaringHelpRequests
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(request => request.TenantId == tenantId)
            .OrderByDescending(request => request.CreatedAt)
            .Take(500)
            .ToListAsync(ct);

        var summary = EmptySummary();
        var openRequests = new List<Dictionary<string, object?>>();
        var recentlyResolved = new List<Dictionary<string, object?>>();
        var firstResponseSeconds = Math.Max(1, policy.FirstResponseHours * 3600);
        var resolutionSeconds = Math.Max(1, policy.ResolutionHours * 3600);
        var resolvedWindow = now.AddHours(-72);

        foreach (var row in rows)
        {
            var status = row.Status ?? string.Empty;
            var ageSeconds = Math.Max(0, (now - row.CreatedAt).TotalSeconds);
            var view = BaseRow(row, ageSeconds);

            if (status == "pending")
            {
                summary["pending"]++;
                var bucket = Bucket(ageSeconds, firstResponseSeconds);
                view["sla_dimension"] = "first_response";
                view["sla_target_hours"] = policy.FirstResponseHours;
                view["sla_remaining_hours"] = RoundHours(Math.Max(0, firstResponseSeconds - ageSeconds));
                view["sla_overage_hours"] = RoundHours(Math.Max(0, ageSeconds - firstResponseSeconds));
                view["bucket"] = bucket;

                if (bucket == "breached")
                {
                    summary["first_response_breached"]++;
                }
                else if (bucket == "at_risk")
                {
                    summary["first_response_at_risk"]++;
                }

                openRequests.Add(view);
                continue;
            }

            if (status == "closed")
            {
                if (row.UpdatedAt is not null && row.UpdatedAt.Value >= resolvedWindow)
                {
                    var turnaroundSeconds = Math.Max(0, (row.UpdatedAt.Value - row.CreatedAt).TotalSeconds);
                    view["turnaround_hours"] = RoundHours(turnaroundSeconds);
                    view["within_resolution_sla"] = turnaroundSeconds <= resolutionSeconds;
                    recentlyResolved.Add(view);

                    if (turnaroundSeconds <= 24 * 3600)
                    {
                        summary["resolved_within_window_24h"]++;
                    }
                }

                continue;
            }

            summary["in_progress"]++;
            var resolutionBucket = Bucket(ageSeconds, resolutionSeconds);
            view["sla_dimension"] = "resolution";
            view["sla_target_hours"] = policy.ResolutionHours;
            view["sla_remaining_hours"] = RoundHours(Math.Max(0, resolutionSeconds - ageSeconds));
            view["sla_overage_hours"] = RoundHours(Math.Max(0, ageSeconds - resolutionSeconds));
            view["bucket"] = resolutionBucket;

            if (resolutionBucket == "breached")
            {
                summary["resolution_breached"]++;
            }
            else if (resolutionBucket == "at_risk")
            {
                summary["resolution_at_risk"]++;
            }

            openRequests.Add(view);
        }

        var orderedOpen = openRequests
            .OrderBy(row => BucketRank((string?)row["bucket"]))
            .ThenByDescending(row => ToDecimal(row.GetValueOrDefault("sla_overage_hours")))
            .ThenByDescending(row => ToDecimal(row.GetValueOrDefault("age_hours")))
            .Take(500)
            .Cast<object>()
            .ToArray();

        return new
        {
            policy = new
            {
                first_response_hours = policy.FirstResponseHours,
                resolution_hours = policy.ResolutionHours,
                source = policy.Source
            },
            summary,
            open_requests = orderedOpen,
            recently_resolved = recentlyResolved.Cast<object>().ToArray(),
            generated_at = Iso8601(now)
        };
    }

    private async Task<SlaPolicy> ResolvePolicyAsync(int tenantId, CancellationToken ct)
    {
        var view = await _operatingPolicy.GetAsync(tenantId, ct);
        return new SlaPolicy(
            FirstResponseHours: Convert.ToInt32(view.Policy["sla_first_response_hours"], CultureInfo.InvariantCulture),
            ResolutionHours: Convert.ToInt32(view.Policy["sla_help_request_hours"], CultureInfo.InvariantCulture),
            Source: view.LastUpdatedAt is null ? "platform_defaults" : "tenant_policy");
    }

    private static Dictionary<string, int> EmptySummary()
    {
        return new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["pending"] = 0,
            ["in_progress"] = 0,
            ["first_response_breached"] = 0,
            ["first_response_at_risk"] = 0,
            ["resolution_breached"] = 0,
            ["resolution_at_risk"] = 0,
            ["resolved_within_window_24h"] = 0
        };
    }

    private static Dictionary<string, object?> BaseRow(CaringHelpRequest row, double ageSeconds)
    {
        return new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["id"] = row.Id,
            ["user_id"] = row.UserId,
            ["what"] = row.What,
            ["when_needed"] = row.WhenNeeded,
            ["status"] = row.Status,
            ["created_at"] = Iso8601(row.CreatedAt),
            ["updated_at"] = Iso8601OrNull(row.UpdatedAt),
            ["age_hours"] = RoundHours(ageSeconds)
        };
    }

    private static string Bucket(double ageSeconds, int targetSeconds)
    {
        if (ageSeconds >= targetSeconds)
        {
            return "breached";
        }

        return ageSeconds >= Math.Round(targetSeconds * AtRiskRatio)
            ? "at_risk"
            : "on_track";
    }

    private static int BucketRank(string? bucket)
    {
        return bucket switch
        {
            "breached" => 0,
            "at_risk" => 1,
            "on_track" => 2,
            _ => 3
        };
    }

    private static decimal RoundHours(double seconds)
    {
        return Math.Round((decimal)seconds / 3600m, 1, MidpointRounding.AwayFromZero);
    }

    private static decimal ToDecimal(object? value)
    {
        return value switch
        {
            decimal decimalValue => decimalValue,
            double doubleValue => (decimal)doubleValue,
            int intValue => intValue,
            _ => 0m
        };
    }

    private static string Iso8601(DateTime value)
    {
        var utc = value.Kind == DateTimeKind.Utc
            ? value
            : DateTime.SpecifyKind(value, DateTimeKind.Utc).ToUniversalTime();

        return utc.ToString("yyyy-MM-dd'T'HH:mm:ss+00:00", CultureInfo.InvariantCulture);
    }

    private static string? Iso8601OrNull(DateTime? value)
    {
        return value is null ? null : Iso8601(value.Value);
    }

    private static bool IsTruthy(string? value)
    {
        return value?.Trim().ToLowerInvariant() is "1" or "true" or "yes" or "on" or "enabled";
    }

    private sealed record SlaPolicy(int FirstResponseHours, int ResolutionHours, string Source);
}
