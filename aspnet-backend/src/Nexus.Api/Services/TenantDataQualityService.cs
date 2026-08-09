// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class TenantDataQualityService
{
    public const int DefaultRowsLimit = 50;
    public const int MaxRowsLimit = 200;

    public static readonly string[] AllowedDrilldownKeys =
    [
        "duplicate_emails",
        "duplicate_phones",
        "missing_preferred_language",
        "missing_sub_region",
        "missing_coordinator_assignment",
        "unverified_organisations",
        "seed_marker_users",
        "unanswered_help_requests",
        "members_without_role",
        "tenant_setting_completeness"
    ];

    private static readonly string[] RequiredSettingKeys =
    [
        "caring.disclosure_pack",
        "caring.operating_policy"
    ];

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public TenantDataQualityService(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
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

    public async Task<TenantDataQualityReport> RunChecksAsync(int tenantId, CancellationToken ct)
    {
        var checks = new List<TenantDataQualityCheck>
        {
            await CheckDuplicateEmailsAsync(tenantId, ct),
            OkRow("duplicate_phones", "Duplicate phone numbers", "phone column not present", false),
            OkRow("missing_preferred_language", "Members without preferred language", "preferred_language column not present", false),
            await CheckMissingSubRegionAsync(tenantId, ct),
            OkRow("missing_coordinator_assignment", "Caring relationships without coordinator", "caring_support_relationships table not present", false),
            await CheckUnverifiedOrganisationsAsync(tenantId, ct),
            await CheckSeedMarkerUsersAsync(tenantId, ct),
            OkRow("unanswered_help_requests", "Unanswered help requests (>30 days)", "caring_help_requests table not present", false),
            await CheckMembersWithoutRoleAsync(tenantId, ct),
            await CheckTenantSettingCompletenessAsync(tenantId, ct)
        };

        var totals = new Dictionary<string, int>
        {
            ["ok"] = 0,
            ["info"] = 0,
            ["warning"] = 0,
            ["danger"] = 0
        };
        foreach (var check in checks)
        {
            if (totals.ContainsKey(check.Severity))
            {
                totals[check.Severity]++;
            }
        }

        return new TenantDataQualityReport(
            DateTime.UtcNow,
            tenantId,
            totals,
            checks);
    }

    public async Task<TenantDataQualityRows> AffectedRowsAsync(
        int tenantId,
        string checkKey,
        int? limit,
        CancellationToken ct)
    {
        var clampedLimit = ClampLimit(limit);
        var rows = checkKey switch
        {
            "duplicate_emails" => await RowsDuplicateEmailsAsync(tenantId, clampedLimit, ct),
            "seed_marker_users" => await RowsSeedMarkerUsersAsync(tenantId, clampedLimit, ct),
            "unverified_organisations" => await RowsUnverifiedOrganisationsAsync(tenantId, clampedLimit, ct),
            _ => []
        };

        var note = rows.Count == 0 && checkKey is not ("duplicate_emails" or "seed_marker_users" or "unverified_organisations")
            ? "drilldown not available for this check"
            : null;

        return new TenantDataQualityRows(checkKey, clampedLimit, rows, note);
    }

    public static int ClampLimit(int? limit)
    {
        return Math.Max(1, Math.Min(MaxRowsLimit, limit ?? DefaultRowsLimit));
    }

    private async Task<TenantDataQualityCheck> CheckDuplicateEmailsAsync(int tenantId, CancellationToken ct)
    {
        var users = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId && u.Email != "")
            .Select(u => new { u.Email })
            .ToListAsync(ct);

        var duplicateCount = users
            .Where(u => !string.IsNullOrWhiteSpace(u.Email))
            .GroupBy(u => u.Email.Trim().ToLowerInvariant())
            .Where(g => g.Count() > 1)
            .Sum(g => g.Count());

        return new TenantDataQualityCheck(
            "duplicate_emails",
            "Duplicate email addresses",
            duplicateCount > 0 ? "danger" : "ok",
            duplicateCount,
            duplicateCount > 0
                ? "Multiple users share the same email - merge or delete duplicates before launch."
                : "No duplicate emails detected.",
            duplicateCount > 0);
    }

    private async Task<TenantDataQualityCheck> CheckMissingSubRegionAsync(int tenantId, CancellationToken ct)
    {
        var hasAnyRegion = await _db.CaringSubRegions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(r => r.TenantId == tenantId, ct);

        var message = hasAnyRegion
            ? "sub_region_id column not present on users table"
            : "No sub-regions are configured for this tenant.";

        return new TenantDataQualityCheck(
            "missing_sub_region",
            "Members without sub-region",
            "ok",
            0,
            message,
            false);
    }

    private async Task<TenantDataQualityCheck> CheckUnverifiedOrganisationsAsync(int tenantId, CancellationToken ct)
    {
        var count = await _db.Organisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(o => o.TenantId == tenantId)
            .Where(o => o.VerifiedAt == null || (o.Status != "approved" && o.Status != "verified" && o.Status != "active"))
            .CountAsync(ct);

        var severity = count switch
        {
            > 5 => "warning",
            > 0 => "info",
            _ => "ok"
        };

        return new TenantDataQualityCheck(
            "unverified_organisations",
            "Unverified organisations",
            severity,
            count,
            count > 0
                ? "Approve or reject each pending organisation so members trust the listings."
                : "All organisations have been reviewed.",
            count > 0);
    }

    private async Task<TenantDataQualityCheck> CheckSeedMarkerUsersAsync(int tenantId, CancellationToken ct)
    {
        var users = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId)
            .Select(u => new UserListRow(u.Id, u.Email, u.FirstName, u.LastName, u.CreatedAt))
            .ToListAsync(ct);

        var count = users.Count(IsSeedUser);
        return new TenantDataQualityCheck(
            "seed_marker_users",
            "Demo / seed marker accounts",
            count > 0 ? "danger" : "ok",
            count,
            count > 0
                ? "Demo or seed accounts are still present - they must be removed before onboarding real residents."
                : "No demo / seed marker accounts detected.",
            count > 0);
    }

    private async Task<TenantDataQualityCheck> CheckMembersWithoutRoleAsync(int tenantId, CancellationToken ct)
    {
        var count = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId)
            .CountAsync(u => u.Role == null || u.Role == "", ct);

        return new TenantDataQualityCheck(
            "members_without_role",
            "Members without role",
            count > 0 ? "warning" : "ok",
            count,
            count > 0
                ? "Assign every member a role (member / coordinator / admin) so permissions resolve correctly."
                : "Every member has a role assigned.",
            false);
    }

    private async Task<TenantDataQualityCheck> CheckTenantSettingCompletenessAsync(int tenantId, CancellationToken ct)
    {
        var keys = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId)
            .Select(c => c.Key)
            .ToListAsync(ct);

        var missing = RequiredSettingKeys.Count(required =>
            !keys.Any(key => key == required || key.StartsWith(required + ".", StringComparison.Ordinal)));

        return new TenantDataQualityCheck(
            "tenant_setting_completeness",
            "Tenant settings completeness",
            missing > 0 ? "info" : "ok",
            missing,
            missing > 0
                ? "One or more pre-launch settings are missing - review the AG80 disclosure pack and AG81 operating policy admin pages."
                : "All pre-launch tenant settings are configured.",
            false);
    }

    private async Task<IReadOnlyList<TenantDataQualityAffectedRow>> RowsDuplicateEmailsAsync(
        int tenantId,
        int limit,
        CancellationToken ct)
    {
        var users = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId && u.Email != "")
            .Select(u => new UserListRow(u.Id, u.Email, u.FirstName, u.LastName, u.CreatedAt))
            .ToListAsync(ct);

        var duplicateEmails = users
            .Where(u => !string.IsNullOrWhiteSpace(u.Email))
            .GroupBy(u => NormalizedEmail(u.Email))
            .Where(g => g.Count() > 1)
            .Select(g => g.Key)
            .ToHashSet(StringComparer.Ordinal);

        return users
            .Where(u => duplicateEmails.Contains(NormalizedEmail(u.Email)))
            .OrderBy(u => u.Email, StringComparer.OrdinalIgnoreCase)
            .ThenBy(u => u.Id)
            .Take(limit)
            .Select(ToAffectedUserRow)
            .ToArray();
    }

    private async Task<IReadOnlyList<TenantDataQualityAffectedRow>> RowsSeedMarkerUsersAsync(
        int tenantId,
        int limit,
        CancellationToken ct)
    {
        var users = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId)
            .Select(u => new UserListRow(u.Id, u.Email, u.FirstName, u.LastName, u.CreatedAt))
            .ToListAsync(ct);

        return users
            .Where(IsSeedUser)
            .OrderBy(u => u.Id)
            .Take(limit)
            .Select(ToAffectedUserRow)
            .ToArray();
    }

    private async Task<IReadOnlyList<TenantDataQualityAffectedRow>> RowsUnverifiedOrganisationsAsync(
        int tenantId,
        int limit,
        CancellationToken ct)
    {
        var rows = await _db.Organisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(o => o.TenantId == tenantId)
            .Where(o => o.VerifiedAt == null || (o.Status != "approved" && o.Status != "verified" && o.Status != "active"))
            .OrderBy(o => o.Id)
            .Take(limit)
            .Select(o => new TenantDataQualityAffectedRow(
                o.Id,
                o.Name,
                null,
                o.Status,
                o.CreatedAt))
            .ToListAsync(ct);

        return rows;
    }

    private static TenantDataQualityAffectedRow ToAffectedUserRow(UserListRow user)
    {
        return new TenantDataQualityAffectedRow(
            user.Id,
            user.Email ?? string.Empty,
            FullName(user.FirstName, user.LastName),
            null,
            user.CreatedAt);
    }

    private static bool IsSeedUser(UserListRow user)
    {
        return IsSeedUser(user.Email, user.FirstName, user.LastName);
    }

    private static bool IsSeedUser(string? email, string? firstName, string? lastName)
    {
        var normalizedEmail = email?.Trim().ToLowerInvariant() ?? string.Empty;
        var name = FullName(firstName, lastName);

        return normalizedEmail.EndsWith("@example.com", StringComparison.Ordinal)
            || normalizedEmail.EndsWith("@example.org", StringComparison.Ordinal)
            || normalizedEmail.EndsWith("@test.test", StringComparison.Ordinal)
            || name.StartsWith("Test ", StringComparison.Ordinal)
            || name.StartsWith("Demo ", StringComparison.Ordinal);
    }

    private static string NormalizedEmail(string? email)
    {
        return email?.Trim().ToLowerInvariant() ?? string.Empty;
    }

    private static string FullName(string? firstName, string? lastName)
    {
        return string.Join(' ', new[] { firstName, lastName }
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .Select(part => part!.Trim()));
    }

    private static TenantDataQualityCheck OkRow(string key, string label, string message, bool hasDrilldown)
    {
        return new TenantDataQualityCheck(key, label, "ok", 0, message, hasDrilldown);
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

    private sealed record UserListRow(int Id, string? Email, string? FirstName, string? LastName, DateTime CreatedAt);
}

public sealed record TenantDataQualityReport(
    [property: JsonPropertyName("generated_at")] DateTime GeneratedAt,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("totals")] IReadOnlyDictionary<string, int> Totals,
    [property: JsonPropertyName("checks")] IReadOnlyList<TenantDataQualityCheck> Checks);

public sealed record TenantDataQualityCheck(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("severity")] string Severity,
    [property: JsonPropertyName("count")] int Count,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("has_drilldown")] bool HasDrilldown);

public sealed record TenantDataQualityRows(
    [property: JsonPropertyName("check_key")] string CheckKey,
    [property: JsonPropertyName("limit")] int Limit,
    [property: JsonPropertyName("rows")] IReadOnlyList<TenantDataQualityAffectedRow> Rows,
    [property: JsonPropertyName("note")] string? Note);

public sealed record TenantDataQualityAffectedRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("identifier")] string Identifier,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("status")] string? Status,
    [property: JsonPropertyName("created_at")] DateTime? CreatedAt);
