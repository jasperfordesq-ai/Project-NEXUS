// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;

namespace Nexus.Api.Services;

/// <summary>
/// Re-reads the current tenant and user before applying Laravel's local
/// safeguarding-vetting authority checks. The outer controller policy remains
/// responsible for authentication and the broad broker/admin route gate; these
/// narrower checks deliberately do not trust JWT role or privilege claims.
/// </summary>
public sealed class SafeguardingVettingAccessService
{
    private static readonly string[] DecisionAdminRoles =
    [
        "admin",
        "tenant_admin",
        "super_admin",
        "god"
    ];

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<SafeguardingVettingAccessService> _logger;

    public SafeguardingVettingAccessService(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<SafeguardingVettingAccessService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// Returns the current user ID when the caller may read or make a vetting
    /// decision, otherwise null. Brokers are decision-makers. Coordinators are
    /// categorically denied even if stale administrator flags remain set.
    /// </summary>
    public Task<int?> ResolveDecisionMakerUserIdAsync(
        ClaimsPrincipal principal,
        CancellationToken cancellationToken = default)
        => ResolveAsync(principal, IsDecisionMaker, cancellationToken);

    /// <summary>
    /// Returns the current user ID when the caller may configure or rotate the
    /// vetting policy, otherwise null. This intentionally mirrors Laravel's
    /// local requireAdmin helper rather than ASP.NET's broader AdminOnly policy:
    /// named admin roles qualify, as do the super/tenant-super flags, while the
    /// is_admin and is_god flags alone do not.
    /// </summary>
    public Task<int?> ResolveVettingAdminUserIdAsync(
        ClaimsPrincipal principal,
        CancellationToken cancellationToken = default)
        => ResolveAsync(principal, IsVettingAdmin, cancellationToken);

    private async Task<int?> ResolveAsync(
        ClaimsPrincipal principal,
        Func<CurrentAccessState, bool> predicate,
        CancellationToken cancellationToken)
    {
        if (principal.Identity?.IsAuthenticated != true
            || _tenantContext.TenantId is not int resolvedTenantId
            || !TryReadIntClaim(principal, "sub", ClaimTypes.NameIdentifier, out var userId)
            || !TryReadIntClaim(principal, "tenant_id", null, out var tokenTenantId)
            || tokenTenantId != resolvedTenantId)
        {
            return null;
        }

        try
        {
            var current = await (
                    from user in _db.Users.IgnoreQueryFilters().AsNoTracking()
                    join tenant in _db.Tenants.AsNoTracking()
                        on user.TenantId equals tenant.Id
                    where user.Id == userId
                        && user.TenantId == resolvedTenantId
                        && user.IsActive
                        && tenant.IsActive
                    select new CurrentAccessState(
                        user.Id,
                        user.Role,
                        user.IsAdmin,
                        user.IsSuperAdmin,
                        user.IsTenantSuperAdmin,
                        user.IsGod))
                .SingleOrDefaultAsync(cancellationToken);

            return current is not null && predicate(current)
                ? current.UserId
                : null;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Safeguarding vetting access lookup failed closed for user {UserId} in tenant {TenantId}",
                userId,
                resolvedTenantId);
            return null;
        }
    }

    private static bool IsDecisionMaker(CurrentAccessState current)
    {
        if (RoleIs(current.Role, "coordinator"))
        {
            return false;
        }

        return RoleIs(current.Role, "broker")
            || DecisionAdminRoles.Any(role => RoleIs(current.Role, role))
            || current.IsAdmin
            || current.IsSuperAdmin
            || current.IsTenantSuperAdmin
            || current.IsGod;
    }

    private static bool IsVettingAdmin(CurrentAccessState current)
        => DecisionAdminRoles.Any(role => RoleIs(current.Role, role))
            || current.IsSuperAdmin
            || current.IsTenantSuperAdmin;

    private static bool RoleIs(string? role, string expected)
        => string.Equals(role, expected, StringComparison.Ordinal);

    private static bool TryReadIntClaim(
        ClaimsPrincipal principal,
        string primaryType,
        string? fallbackType,
        out int value)
    {
        var raw = principal.FindFirst(primaryType)?.Value;
        if (raw is null && fallbackType is not null)
        {
            raw = principal.FindFirst(fallbackType)?.Value;
        }

        return int.TryParse(raw, out value);
    }

    private sealed record CurrentAccessState(
        int UserId,
        string Role,
        bool IsAdmin,
        bool IsSuperAdmin,
        bool IsTenantSuperAdmin,
        bool IsGod);
}
