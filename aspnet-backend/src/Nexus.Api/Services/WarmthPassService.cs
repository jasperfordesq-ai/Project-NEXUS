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
/// Laravel-compatible Caring Community warmth pass read model.
/// </summary>
public sealed class WarmthPassService
{
    private static readonly IReadOnlyDictionary<int, string> TierLabels = new Dictionary<int, string>
    {
        [0] = "newcomer",
        [1] = "member",
        [2] = "trusted",
        [3] = "verified",
        [4] = "coordinator"
    };

    private readonly NexusDbContext _db;

    public WarmthPassService(NexusDbContext db)
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

    public async Task<WarmthPassDto> BuildPassAsync(int userId, int tenantId, CancellationToken ct)
    {
        var user = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(row => row.Id == userId && row.TenantId == tenantId, ct);

        var tier = Math.Max(0, user?.TrustTier ?? 0);
        var eligible = tier >= 2;
        var hoursLogged = await ApprovedHoursAsync(userId, tenantId, ct);
        var reviewsReceived = await ReviewsReceivedAsync(userId, tenantId, ct);
        var identityVerified = await IsIdentityVerifiedAsync(user, userId, tenantId, ct);
        var tenantName = await TenantNameAsync(tenantId, ct);
        var categories = await MatchedCategoriesAsync(userId, tenantId, ct);

        return new WarmthPassDto(
            eligible,
            tier,
            TierLabel(tier),
            hoursLogged,
            reviewsReceived,
            identityVerified,
            ToDateString(user?.CreatedAt),
            eligible ? ToDateString(user?.UpdatedAt) : null,
            tenantName,
            MemberName(user),
            categories);
    }

    private async Task<decimal> ApprovedHoursAsync(int userId, int tenantId, CancellationToken ct)
    {
        return await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .Where(log => log.UserId == userId && log.TenantId == tenantId && log.Status == "approved")
            .SumAsync(log => (decimal?)log.Hours, ct) ?? 0m;
    }

    private async Task<int> ReviewsReceivedAsync(int userId, int tenantId, CancellationToken ct)
    {
        return await _db.Reviews
            .IgnoreQueryFilters()
            .CountAsync(review => review.TenantId == tenantId && review.TargetUserId == userId, ct);
    }

    private async Task<bool> IsIdentityVerifiedAsync(
        User? user,
        int userId,
        int tenantId,
        CancellationToken ct)
    {
        if (user?.EmailVerified == true)
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

    private async Task<string> TenantNameAsync(int tenantId, CancellationToken ct)
    {
        var name = await _db.Tenants
            .AsNoTracking()
            .Where(tenant => tenant.Id == tenantId)
            .Select(tenant => tenant.Name)
            .FirstOrDefaultAsync(ct);

        return string.IsNullOrWhiteSpace(name) ? "Community" : name;
    }

    private async Task<IReadOnlyList<string>> MatchedCategoriesAsync(
        int userId,
        int tenantId,
        CancellationToken ct)
    {
        var helpRequestType = _db.Model.FindEntityType(typeof(CaringHelpRequest));
        if (helpRequestType?.FindProperty("CategoryId") is null)
        {
            return Array.Empty<string>();
        }

        var categoryIds = await _db.CaringHelpRequests
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(request =>
                request.UserId == userId
                && request.TenantId == tenantId
                && request.Status == "matched")
            .Select(request => EF.Property<int?>(request, "CategoryId"))
            .Where(categoryId => categoryId != null)
            .Distinct()
            .ToListAsync(ct);

        if (categoryIds.Count == 0)
        {
            return Array.Empty<string>();
        }

        return await _db.Categories
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(category =>
                category.TenantId == tenantId
                && categoryIds.Contains(category.Id))
            .Select(category => category.Name)
            .Where(name => name != "")
            .Distinct()
            .OrderBy(name => name)
            .ToListAsync(ct);
    }

    private static string MemberName(User? user)
    {
        if (user is null)
        {
            return string.Empty;
        }

        return string.Join(' ', new[] { user.FirstName, user.LastName }
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .Select(part => part.Trim()));
    }

    private static string? ToDateString(DateTime? value)
    {
        return value?.ToString("yyyy-MM-dd");
    }

    private static string TierLabel(int tier)
    {
        return TierLabels.TryGetValue(tier, out var label) ? label : TierLabels[0];
    }

    private static bool IsTruthy(string? raw)
    {
        return raw is not null
            && (raw.Equals("true", StringComparison.OrdinalIgnoreCase)
                || raw == "1"
                || raw.Equals("yes", StringComparison.OrdinalIgnoreCase)
                || raw.Equals("on", StringComparison.OrdinalIgnoreCase));
    }
}

public sealed record WarmthPassDto(
    [property: JsonPropertyName("eligible")] bool Eligible,
    [property: JsonPropertyName("tier")] int Tier,
    [property: JsonPropertyName("tier_label")] string TierLabel,
    [property: JsonPropertyName("hours_logged")] decimal HoursLogged,
    [property: JsonPropertyName("reviews_received")] int ReviewsReceived,
    [property: JsonPropertyName("identity_verified")] bool IdentityVerified,
    [property: JsonPropertyName("member_since")] string? MemberSince,
    [property: JsonPropertyName("pass_active_since")] string? PassActiveSince,
    [property: JsonPropertyName("tenant_name")] string TenantName,
    [property: JsonPropertyName("member_name")] string MemberName,
    [property: JsonPropertyName("categories")] IReadOnlyList<string> Categories);
