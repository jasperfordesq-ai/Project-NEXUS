// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;

namespace Nexus.Api.Services;

/// <summary>
/// Laravel-contract-compatible persistence for coordinator wellbeing alerts.
/// The alerts are tenant-scoped independently of volunteer pulse responses.
/// </summary>
public sealed class VolunteerWellbeingAlertService
{
    public const string FeatureConfigKey = "feature.volunteering";

    private readonly NexusDbContext _db;
    private readonly ILogger<VolunteerWellbeingAlertService> _logger;

    public VolunteerWellbeingAlertService(
        NexusDbContext db,
        ILogger<VolunteerWellbeingAlertService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// Volunteering is enabled by default in Laravel. Only an explicit false-like
    /// tenant override disables the module.
    /// </summary>
    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(config => config.TenantId == tenantId && config.Key == FeatureConfigKey)
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return !IsExplicitlyDisabled(raw);
    }

    public async Task<IReadOnlyList<VolunteerWellbeingAlertItem>> ListAsync(
        int tenantId,
        string status,
        CancellationToken ct)
    {
        try
        {
            var rows = await (
                from alert in _db.VolunteerWellbeingAlerts.IgnoreQueryFilters().AsNoTracking()
                join user in _db.Users.IgnoreQueryFilters().AsNoTracking()
                    on new { alert.UserId, alert.TenantId } equals new { UserId = user.Id, user.TenantId }
                where alert.TenantId == tenantId && alert.Status == status
                orderby alert.RiskScore descending
                select new
                {
                    alert.Id,
                    alert.UserId,
                    user.FirstName,
                    user.LastName,
                    user.AvatarUrl,
                    alert.RiskLevel,
                    alert.RiskScore,
                    alert.Indicators,
                    alert.CoordinatorNotified,
                    alert.CoordinatorNotes,
                    alert.Status,
                    alert.CreatedAt,
                    alert.UpdatedAt
                }).ToListAsync(ct);

            return rows.Select(row => new VolunteerWellbeingAlertItem(
                row.Id,
                row.UserId,
                $"{row.FirstName} {row.LastName}".Trim(),
                row.AvatarUrl,
                row.RiskLevel,
                decimal.Round(row.RiskScore, 2),
                ParseIndicators(row.Indicators),
                row.CoordinatorNotified,
                row.CoordinatorNotes,
                row.Status,
                row.CreatedAt,
                row.UpdatedAt)).ToArray();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Preserve Laravel's defensive read behavior: a broken/corrupt alert
            // query is logged but the coordinator dashboard still receives an
            // empty 200 collection rather than a server error.
            _logger.LogWarning(ex, "Failed to list wellbeing alerts for tenant {TenantId}", tenantId);
            return [];
        }
    }

    public async Task<bool> UpdateAsync(
        int tenantId,
        int alertId,
        string status,
        string? coordinatorNote,
        CancellationToken ct)
    {
        var alert = await _db.VolunteerWellbeingAlerts
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == alertId && item.TenantId == tenantId, ct);

        if (alert is null)
        {
            return false;
        }

        alert.Status = status;
        alert.CoordinatorNotified = true;
        alert.UpdatedAt = DateTime.UtcNow;

        if (coordinatorNote is not null)
        {
            alert.CoordinatorNotes = TruncateUnicodeScalars(coordinatorNote, 2000);
        }

        if (status == "resolved")
        {
            alert.ResolvedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
        return true;
    }

    private static bool IsExplicitlyDisabled(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }

        return raw.Trim().ToLowerInvariant() is "false" or "0" or "no" or "off" or "disabled";
    }

    private static JsonNode ParseIndicators(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new JsonArray();
        }

        try
        {
            return JsonNode.Parse(raw) ?? new JsonArray();
        }
        catch
        {
            return new JsonArray();
        }
    }

    private static string TruncateUnicodeScalars(string value, int maximumLength)
    {
        if (value.EnumerateRunes().Take(maximumLength + 1).Count() <= maximumLength)
        {
            return value;
        }

        var builder = new StringBuilder();
        foreach (var rune in value.EnumerateRunes().Take(maximumLength))
        {
            builder.Append(rune);
        }

        return builder.ToString();
    }
}

public sealed record VolunteerWellbeingAlertItem(
    int Id,
    int UserId,
    string UserName,
    string? AvatarUrl,
    string RiskLevel,
    decimal RiskScore,
    JsonNode Indicators,
    bool CoordinatorNotified,
    string? CoordinatorNotes,
    string Status,
    DateTime CreatedAt,
    DateTime UpdatedAt);
