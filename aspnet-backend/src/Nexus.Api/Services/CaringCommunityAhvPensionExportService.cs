// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;

namespace Nexus.Api.Services;

/// <summary>
/// Builds the provisional AHV pension evidence pack used by the Laravel Caring Community API.
/// </summary>
public sealed class CaringCommunityAhvPensionExportService
{
    public const string FormatVersion = "0.1-provisional";

    private readonly NexusDbContext _db;

    public CaringCommunityAhvPensionExportService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<object> BuildAsync(
        int tenantId,
        int userId,
        string? fromDate,
        string? toDate,
        CancellationToken ct)
    {
        var tenant = await _db.Tenants
            .AsNoTracking()
            .Where(row => row.Id == tenantId)
            .Select(row => new
            {
                row.Id,
                row.Slug,
                row.Name
            })
            .FirstOrDefaultAsync(ct);

        var member = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.Id == userId)
            .Select(row => new
            {
                row.Id,
                row.FirstName,
                row.LastName
            })
            .FirstOrDefaultAsync(ct);

        var rows = await ApprovedContributionRowsAsync(tenantId, userId, fromDate, toDate, ct);
        var totalHours = RoundHours(rows.Sum(row => row.Hours));

        return new Dictionary<string, object?>
        {
            ["format_version"] = FormatVersion,
            ["generated_at"] = DateTimeOffset.UtcNow.ToString("O"),
            ["official_interface"] = new Dictionary<string, object?>
            {
                ["status"] = "pending_official_ahv_specification",
                ["official_submission_supported"] = false,
                ["export_type"] = "evidence_pack"
            },
            ["tenant"] = new Dictionary<string, object?>
            {
                ["id"] = tenant?.Id ?? tenantId,
                ["slug"] = tenant?.Slug,
                ["name"] = tenant?.Name
            },
            ["member"] = new Dictionary<string, object?>
            {
                ["id"] = member?.Id ?? userId,
                ["name"] = member is null ? null : MemberName(member.FirstName, member.LastName)
            },
            ["period"] = new Dictionary<string, object?>
            {
                ["from"] = fromDate,
                ["to"] = toDate
            },
            ["summary"] = new Dictionary<string, object?>
            {
                ["approved_hours"] = totalHours,
                ["row_count"] = rows.Count,
                ["years"] = rows
                    .GroupBy(row => row.Year)
                    .OrderBy(group => group.Key)
                    .Select(group => new Dictionary<string, object?>
                    {
                        ["year"] = group.Key,
                        ["approved_hours"] = RoundHours(group.Sum(row => row.Hours)),
                        ["row_count"] = group.Count()
                    })
                    .Cast<object>()
                    .ToArray()
            },
            ["contribution_rows"] = rows
                .Select(row => new Dictionary<string, object?>
                {
                    ["source"] = "vol_log",
                    ["record_id"] = row.Id,
                    ["date"] = row.Date.ToString("yyyy-MM-dd"),
                    ["year"] = row.Year,
                    ["hours"] = row.Hours,
                    ["status"] = "approved",
                    ["organization_id"] = row.OrganizationId,
                    ["opportunity_id"] = row.OpportunityId,
                    ["caring_support_relationship_id"] = row.CaringSupportRelationshipId,
                    ["support_recipient_id"] = row.SupportRecipientId,
                    ["recorded_at"] = row.CreatedAt,
                    ["verified_at"] = row.UpdatedAt
                })
                .Cast<object>()
                .ToArray()
        };
    }

    private async Task<IReadOnlyList<AhvContributionRow>> ApprovedContributionRowsAsync(
        int tenantId,
        int userId,
        string? fromDate,
        string? toDate,
        CancellationToken ct)
    {
        var query = _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.UserId == userId && row.Status == "approved");

        if (!string.IsNullOrWhiteSpace(fromDate))
        {
            var from = DateOnly.Parse(fromDate, System.Globalization.CultureInfo.InvariantCulture);
            query = query.Where(row => row.DateLogged >= from);
        }

        if (!string.IsNullOrWhiteSpace(toDate))
        {
            var to = DateOnly.Parse(toDate, System.Globalization.CultureInfo.InvariantCulture);
            query = query.Where(row => row.DateLogged <= to);
        }

        var rows = await query
            .OrderBy(row => row.DateLogged)
            .ThenBy(row => row.Id)
            .Select(row => new
            {
                row.Id,
                row.DateLogged,
                row.Hours,
                row.OrganizationId,
                row.OpportunityId,
                row.CaringSupportRelationshipId,
                row.SupportRecipientId,
                row.CreatedAt,
                row.UpdatedAt
            })
            .ToListAsync(ct);

        return rows
            .Select(row => new AhvContributionRow(
                row.Id,
                row.DateLogged,
                row.DateLogged.Year,
                RoundHours(row.Hours),
                row.OrganizationId,
                row.OpportunityId,
                row.CaringSupportRelationshipId,
                row.SupportRecipientId,
                row.CreatedAt,
                row.UpdatedAt))
            .ToArray();
    }

    private static decimal RoundHours(decimal hours)
    {
        return Math.Round(hours, 2, MidpointRounding.AwayFromZero);
    }

    private static string? MemberName(string? firstName, string? lastName)
    {
        var name = string.Join(" ", new[] { firstName, lastName }
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .Select(part => part!.Trim()));

        return string.IsNullOrWhiteSpace(name) ? null : name;
    }

    private sealed record AhvContributionRow(
        int Id,
        DateOnly Date,
        int Year,
        decimal Hours,
        int? OrganizationId,
        int? OpportunityId,
        int? CaringSupportRelationshipId,
        int? SupportRecipientId,
        DateTime CreatedAt,
        DateTime? UpdatedAt);
}
