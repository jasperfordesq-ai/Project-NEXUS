// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Support.Authorization;

/// <summary>
/// Which tenants a super-admin caller may see and act on.
///
/// Port of Laravel's <c>app/Core/SuperPanelAccess.php</c>. There are two tiers:
///   • <b>master</b>   — a platform super-admin or god, or a super-admin OF the
///                       master tenant (id 1): the whole installation;
///   • <b>regional</b> — a super-admin of a hub tenant that may have children:
///                       its own tenant and its descendants, and nothing else.
///
/// 🔴 Why this class exists. Until 2026-08-15 this backend had no equivalent at
/// all, and no tenant hierarchy to build one on. A regional super-admin — a
/// partner network running its own group of communities — was therefore
/// unconfined: every /v2/admin/super/* surface, including impersonation, treated
/// them the same as a platform administrator. That is the single most serious
/// finding of the audit (R-4).
///
/// It fails closed everywhere: no hierarchy, no path, no capability ⇒ no access.
/// </summary>
public sealed class SuperPanelAccess(NexusDbContext db)
{
    public const string LevelMaster = "master";
    public const string LevelRegional = "regional";

    /// <summary>The master tenant, which is global by design.</summary>
    public const int MasterTenantId = 1;

    public sealed record Decision(
        bool Granted,
        string? Level,
        int? TenantId,
        string? TenantPath,
        string Reason)
    {
        public bool IsMaster => Granted && Level == LevelMaster;
        public bool IsRegional => Granted && Level == LevelRegional;
    }

    private static readonly Decision Denied = new(false, null, null, null, "Not a Super Admin for any tenant");

    /// <summary>
    /// Resolve the caller's tier. Mirrors Laravel's three rules in order:
    /// hold a super-admin capacity; a regional grant needs sub-tenant
    /// capability; a regional grant needs a usable materialised path.
    /// </summary>
    public async Task<Decision> ResolveAsync(int userId, CancellationToken ct = default)
    {
        var user = await db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null) return Denied;

        // Deliberately identical to the platform-super predicate used elsewhere.
        // If you change one, change both.
        var isPlatformSuperAdmin = user.IsGod
            || user.IsSuperAdmin
            || user.Role is "super_admin" or "god";
        var isTenantSuperAdmin = user.IsTenantSuperAdmin;

        // RULE 1 — must hold one of the two super-admin capacities.
        if (!isPlatformSuperAdmin && !isTenantSuperAdmin) return Denied;

        var tenant = await db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(t => t.Id == user.TenantId, ct);

        // A tenant super-admin ON the master tenant is global by design.
        var hasGlobalAccess = isPlatformSuperAdmin || user.TenantId == MasterTenantId;

        if (hasGlobalAccess)
        {
            return new Decision(true, LevelMaster, user.TenantId, tenant?.Path, "Access granted");
        }

        // RULE 2 — a REGIONAL grant needs a tenant that may actually have children.
        if (tenant is null || !tenant.AllowsSubtenants)
        {
            return new Decision(false, null, user.TenantId, tenant?.Path,
                "Tenant does not have sub-tenant capability");
        }

        // 🔴 RULE 3 — a regional grant REQUIRES a usable materialised path.
        // The boundary is a string-prefix match, and an EMPTY prefix does not
        // mean "nothing", it means "everything": every tenant starts with "".
        // A hub tenant with an unpopulated path would therefore hand its
        // super-admin the entire installation. Deny loudly instead.
        if (string.IsNullOrWhiteSpace(tenant.Path))
        {
            return new Decision(false, null, user.TenantId, null,
                "Tenant has no materialised path; refusing subtree access");
        }

        return new Decision(true, LevelRegional, user.TenantId, tenant.Path, "Access granted");
    }

    /// <summary>
    /// May this caller view or manage the target tenant? Master sees all; a
    /// regional caller sees its own tenant and anything whose materialised path
    /// begins with its own.
    /// </summary>
    public async Task<bool> CanAccessTenantAsync(int userId, int targetTenantId, CancellationToken ct = default)
    {
        var access = await ResolveAsync(userId, ct);
        if (!access.Granted) return false;
        if (access.IsMaster) return true;
        if (targetTenantId == access.TenantId) return true;

        // Defence in depth: ResolveAsync already refuses an empty path, but this
        // method is public and a caller could construct a Decision by other means.
        var prefix = (access.TenantPath ?? string.Empty).Trim();
        if (prefix.Length == 0) return false;

        var target = await db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.Id == targetTenantId)
            .Select(t => t.Path)
            .SingleOrDefaultAsync(ct);

        return target is not null && target.StartsWith(prefix, StringComparison.Ordinal);
    }
}
