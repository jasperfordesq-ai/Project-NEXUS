// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Authorization;

/// <summary>
/// Stable policy names used by controllers and endpoint conventions.
/// </summary>
public static class NexusAuthorizationPolicies
{
    public const string AdminOnly = "AdminOnly";
    public const string BrokerOrAdmin = "BrokerOrAdmin";
    public const string TenantSuperAdminOrHigher = "TenantSuperAdminOrHigher";
    public const string PlatformSuperAdminOnly = "PlatformSuperAdminOnly";
    public const string GodOnly = "GodOnly";
    public const string RouteAwareAdmin = "RouteAwareAdmin";
}

/// <summary>
/// JWT claim names for the four database-backed privilege flags.
/// </summary>
public static class NexusPrivilegeClaimTypes
{
    public const string IsAdmin = "is_admin";
    public const string IsSuperAdmin = "is_super_admin";
    public const string IsTenantSuperAdmin = "is_tenant_super_admin";
    public const string IsGod = "is_god";
}

/// <summary>
/// Minimal, tenant-independent projection used for privileged authorization.
/// </summary>
public sealed class NexusUserAccessSnapshot
{
    public int Id { get; init; }
    public int TenantId { get; init; }
    public string Role { get; init; } = "member";
    public bool IsActive { get; init; }
    public RegistrationStatus RegistrationStatus { get; init; }
    public bool IsAdmin { get; init; }
    public bool IsSuperAdmin { get; init; }
    public bool IsTenantSuperAdmin { get; init; }
    public bool IsGod { get; init; }
}

public interface INexusUserAccessReader
{
    Task<NexusUserAccessSnapshot?> FindAsync(int userId, CancellationToken cancellationToken = default);
}

/// <summary>
/// Loads the current privilege state without relying on the request tenant filter.
/// The caller must separately prove the token tenant matches the returned row.
/// </summary>
public sealed class NexusUserAccessReader : INexusUserAccessReader
{
    private readonly NexusDbContext _db;

    public NexusUserAccessReader(NexusDbContext db)
    {
        _db = db;
    }

    public Task<NexusUserAccessSnapshot?> FindAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        return _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.Id == userId)
            .Select(user => new NexusUserAccessSnapshot
            {
                Id = user.Id,
                TenantId = user.TenantId,
                Role = user.Role,
                IsActive = user.IsActive,
                RegistrationStatus = user.RegistrationStatus,
                IsAdmin = user.IsAdmin,
                IsSuperAdmin = user.IsSuperAdmin,
                IsTenantSuperAdmin = user.IsTenantSuperAdmin,
                IsGod = user.IsGod
            })
            .SingleOrDefaultAsync(cancellationToken);
    }
}

public enum NexusAccessLevel
{
    Admin,
    BrokerOrAdmin,
    TenantSuperAdminOrHigher,
    PlatformSuperAdmin,
    God,
    RouteAwareAdmin
}

public sealed record NexusUserAccessRequirement(NexusAccessLevel AccessLevel) : IAuthorizationRequirement;

/// <summary>
/// One DB-backed handler for every privileged policy. It rejects deleted or
/// inactive users, stale role claims, and token/database tenant mismatches
/// before evaluating the current role and privilege flags from the database.
/// </summary>
public sealed class NexusUserAccessAuthorizationHandler
    : AuthorizationHandler<NexusUserAccessRequirement>
{
    private readonly INexusUserAccessReader _accessReader;

    public NexusUserAccessAuthorizationHandler(INexusUserAccessReader accessReader)
    {
        _accessReader = accessReader;
    }

    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        NexusUserAccessRequirement requirement)
    {
        if (context.User.Identity?.IsAuthenticated != true
            || !TryReadIntClaim(context.User, "sub", ClaimTypes.NameIdentifier, out var userId)
            || !TryReadIntClaim(context.User, "tenant_id", null, out var tokenTenantId))
        {
            context.Fail();
            return;
        }

        var tokenRole = context.User.FindFirst("role")?.Value
            ?? context.User.FindFirst(ClaimTypes.Role)?.Value;
        if (string.IsNullOrWhiteSpace(tokenRole))
        {
            context.Fail();
            return;
        }

        var current = await _accessReader.FindAsync(userId);
        if (current is null
            || !current.IsActive
            || current.TenantId != tokenTenantId
            || !string.Equals(current.Role, tokenRole, StringComparison.Ordinal))
        {
            context.Fail();
            return;
        }

        NexusUserAccessEvaluator.ApplyDatabaseSnapshot(context.User, current);

        var accessLevel = requirement.AccessLevel;
        if (accessLevel == NexusAccessLevel.RouteAwareAdmin)
        {
            if (!NexusRouteAccessResolver.TryResolve(context.Resource, out accessLevel))
            {
                context.Fail();
                return;
            }
        }

        if (NexusUserAccessEvaluator.HasAccess(current, accessLevel))
        {
            context.Succeed(requirement);
            return;
        }

        context.Fail();
    }

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
}

/// <summary>
/// Resolves the required tier for controllers that own both tenant-admin and
/// platform routes. This avoids stacking AdminOnly with a stronger policy:
/// stacked policies are ANDed and would incorrectly reject Laravel's
/// role-only god alias from platform routes.
/// </summary>
public static class NexusRouteAccessResolver
{
    public static bool TryResolve(object? authorizationResource, out NexusAccessLevel accessLevel)
    {
        var httpContext = authorizationResource switch
        {
            HttpContext direct => direct,
            AuthorizationFilterContext filter => filter.HttpContext,
            _ => null
        };

        if (httpContext is null)
        {
            accessLevel = default;
            return false;
        }

        accessLevel = Resolve(httpContext.Request.Path.Value);
        return true;
    }

    public static NexusAccessLevel Resolve(string? rawPath)
    {
        var path = (rawPath ?? string.Empty).TrimEnd('/').ToLowerInvariant();

        if (path is "/api/admin/timebanking/adjust-balance"
            or "/api/v2/admin/timebanking/adjust-balance")
        {
            return NexusAccessLevel.BrokerOrAdmin;
        }

        if (IsGodOnlyPath(path))
        {
            return NexusAccessLevel.God;
        }

        if (path.StartsWith("/api/admin/super/", StringComparison.Ordinal)
            || path.StartsWith("/api/v2/admin/super/", StringComparison.Ordinal)
            || path.StartsWith("/api/super-admin/", StringComparison.Ordinal)
            || path.StartsWith("/api/v2/super-admin/", StringComparison.Ordinal)
            || path.StartsWith("/api/system/tenant-hierarchy", StringComparison.Ordinal)
            || IsPlatformUserAction(path)
            || path.StartsWith("/api/admin/system/users/", StringComparison.Ordinal)
            || path == "/api/admin/system/users/admins"
            || path == "/api/admin/system/bulk/deactivate-users")
        {
            return NexusAccessLevel.PlatformSuperAdmin;
        }

        return NexusAccessLevel.Admin;
    }

    private static bool IsGodOnlyPath(string path)
    {
        if (path.StartsWith("/api/v2/admin/super/billing/", StringComparison.Ordinal)
            || path.StartsWith("/api/admin/super/billing/", StringComparison.Ordinal)
            || path is "/api/admin/settings/powered-by-image-light"
                or "/api/v2/admin/settings/powered-by-image-light"
                or "/api/admin/settings/powered-by-image-dark"
                or "/api/v2/admin/settings/powered-by-image-dark")
        {
            return true;
        }

        var globalToggle = path.Contains("/admin/users/", StringComparison.Ordinal)
            && path.EndsWith("/global-super-admin", StringComparison.Ordinal);
        var globalSuperPanelToggle = path.Contains("/admin/super/users/", StringComparison.Ordinal)
            && (path.EndsWith("/grant-global-super-admin", StringComparison.Ordinal)
                || path.EndsWith("/revoke-global-super-admin", StringComparison.Ordinal));
        var tenantPurge = path.Contains("/admin/super/tenants/", StringComparison.Ordinal)
            && (path.EndsWith("/purge", StringComparison.Ordinal)
                || path.EndsWith("/purge-preview", StringComparison.Ordinal));

        return globalToggle || globalSuperPanelToggle || tenantPurge;
    }

    private static bool IsPlatformUserAction(string path)
    {
        return path.Contains("/admin/users/", StringComparison.Ordinal)
            && (path.EndsWith("/impersonate", StringComparison.Ordinal)
                || path.EndsWith("/super-admin", StringComparison.Ordinal));
    }
}

/// <summary>
/// Canonical Laravel-compatible role and flag semantics. Legacy role aliases
/// remain accepted for authorization, but new assignments should use the four
/// explicit flags plus the member/admin/broker role vocabulary.
/// </summary>
public static class NexusUserAccessEvaluator
{
    public static bool HasAccess(NexusUserAccessSnapshot user, NexusAccessLevel accessLevel)
    {
        return accessLevel switch
        {
            NexusAccessLevel.Admin => HasAdminAccess(user),
            NexusAccessLevel.BrokerOrAdmin => HasBrokerOrAdminAccess(user),
            NexusAccessLevel.TenantSuperAdminOrHigher => HasTenantSuperAdminOrHigherAccess(user),
            NexusAccessLevel.PlatformSuperAdmin => HasPlatformSuperAdminAccess(user),
            NexusAccessLevel.God => HasGodAccess(user),
            _ => false
        };
    }

    public static bool HasAdminAccess(User user)
    {
        return HasAdminAccess(
            user.Role,
            user.IsAdmin,
            user.IsSuperAdmin,
            user.IsTenantSuperAdmin,
            user.IsGod);
    }

    public static bool HasAdminAccess(NexusUserAccessSnapshot user)
    {
        return HasAdminAccess(
            user.Role,
            user.IsAdmin,
            user.IsSuperAdmin,
            user.IsTenantSuperAdmin,
            user.IsGod);
    }

    /// <summary>
    /// Matches the narrower derived <c>is_admin</c> field emitted by Laravel
    /// login and own-profile payloads. This is intentionally not the same as
    /// EnsureIsAdmin: the raw is_admin/is_god flags are exposed separately and
    /// are not folded into this compatibility indicator.
    /// </summary>
    public static bool HasProfileAdminIndicator(User user)
    {
        return user.IsSuperAdmin
            || user.IsTenantSuperAdmin
            || RoleIs(user.Role, "admin")
            || RoleIs(user.Role, "tenant_admin")
            || RoleIs(user.Role, "super_admin");
    }

    public static bool HasAdminAccess(
        string? role,
        bool isAdmin,
        bool isSuperAdmin,
        bool isTenantSuperAdmin,
        bool isGod)
    {
        // Laravel's admin middleware explicitly denies brokers even when a
        // stale privilege flag remains on their row.
        if (RoleIs(role, "broker"))
        {
            return false;
        }

        return isAdmin
            || isSuperAdmin
            || isTenantSuperAdmin
            || isGod
            || RoleIs(role, "admin")
            || RoleIs(role, "tenant_admin")
            || RoleIs(role, "super_admin");
    }

    public static void ApplyDatabaseSnapshot(
        ClaimsPrincipal principal,
        NexusUserAccessSnapshot current)
    {
        if (principal.Identity is not ClaimsIdentity identity)
        {
            return;
        }

        ReplaceClaim(identity, "tenant_id", current.TenantId.ToString());
        ReplaceClaim(identity, "role", current.Role);
        RemoveClaims(identity, ClaimTypes.Role);
        ReplaceClaim(identity, NexusPrivilegeClaimTypes.IsAdmin, BooleanClaimValue(current.IsAdmin), ClaimValueTypes.Boolean);
        ReplaceClaim(identity, NexusPrivilegeClaimTypes.IsSuperAdmin, BooleanClaimValue(current.IsSuperAdmin), ClaimValueTypes.Boolean);
        ReplaceClaim(identity, NexusPrivilegeClaimTypes.IsTenantSuperAdmin, BooleanClaimValue(current.IsTenantSuperAdmin), ClaimValueTypes.Boolean);
        ReplaceClaim(identity, NexusPrivilegeClaimTypes.IsGod, BooleanClaimValue(current.IsGod), ClaimValueTypes.Boolean);
    }

    private static bool HasBrokerOrAdminAccess(NexusUserAccessSnapshot user)
    {
        return RoleIs(user.Role, "broker")
            || RoleIs(user.Role, "coordinator")
            || RoleIs(user.Role, "god")
            || HasAdminAccess(user);
    }

    private static bool HasTenantSuperAdminOrHigherAccess(NexusUserAccessSnapshot user)
    {
        return user.IsTenantSuperAdmin
            || user.IsSuperAdmin
            || user.IsGod
            || RoleIs(user.Role, "super_admin")
            || RoleIs(user.Role, "god");
    }

    private static bool HasPlatformSuperAdminAccess(NexusUserAccessSnapshot user)
    {
        return user.IsSuperAdmin
            || user.IsGod
            || RoleIs(user.Role, "super_admin")
            || RoleIs(user.Role, "god");
    }

    private static bool HasGodAccess(NexusUserAccessSnapshot user)
    {
        // Laravel's break-glass User::isGod() helper consults only the
        // database flag. A stale role alias must never satisfy GodOnly.
        return user.IsGod;
    }

    private static bool RoleIs(string? actual, string expected)
    {
        return string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase);
    }

    private static string BooleanClaimValue(bool value) => value ? "true" : "false";

    private static void ReplaceClaim(
        ClaimsIdentity identity,
        string claimType,
        string value,
        string valueType = ClaimValueTypes.String)
    {
        RemoveClaims(identity, claimType);
        identity.AddClaim(new Claim(claimType, value, valueType));
    }

    private static void RemoveClaims(ClaimsIdentity identity, string claimType)
    {
        foreach (var claim in identity.FindAll(claimType).ToArray())
        {
            identity.RemoveClaim(claim);
        }
    }
}
