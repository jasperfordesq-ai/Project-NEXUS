// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services.Tenants;

/// <summary>Outcome of a hierarchy write. <c>Code</c> mirrors Laravel's error codes.</summary>
public sealed record TenantHierarchyResult(
    bool Success,
    string? Error = null,
    string? Code = null,
    int? TenantId = null)
{
    public static TenantHierarchyResult Ok(int? tenantId = null) => new(true, TenantId: tenantId);
    public static TenantHierarchyResult Fail(string error, string? code = null) => new(false, error, code);
}

/// <summary>
/// Creates, updates, deactivates, moves and re-parents communities.
///
/// Laravel: <c>app/Services/TenantHierarchyService.php</c> — <c>createTenant:378</c>,
/// <c>updateTenant:559</c>, <c>deleteTenant:823</c>, <c>moveTenant:886</c>,
/// <c>toggleSubtenantCapability:1022</c>.
///
/// 🔴 Why this exists (R-26). R-3 added the hierarchy columns and backfilled
/// them, so the tree existed but nothing could change it: all six super-admin
/// tenant write endpoints were no-op stubs. One of them answered
/// <c>{"success":true,"message":"Tenant deleted"}</c> while the community
/// remained fully live — a destructive-sounding confirmation for an action that
/// never happened, which a platform admin could reasonably believe.
///
/// The rules that are easy to get wrong, and are therefore tested individually:
///
/// <list type="bullet">
/// <item><description><b>Delete is a deactivation.</b> Hard delete is refused
/// outright; purging a community is a separate, god-only, queued operation.
/// A community with ACTIVE children is refused — the children would otherwise
/// keep a path through a parent that is gone.</description></item>
/// <item><description><b>The master community (id 1) can never be deleted or
/// moved.</b></description></item>
/// <item><description><b>Move fails CLOSED when a path is missing.</b> The cycle
/// check is a string prefix and every string starts with <c>""</c>, so an empty
/// path would make any destination look valid. The same trap R-4 pins for
/// subtree access.</description></item>
/// <item><description><b>Move rewrites path and depth for every descendant</b>,
/// not just the moved row. Updating only the moved row leaves its whole subtree
/// pointing through a parent it no longer has.</description></item>
/// </list>
///
/// 🔴 <b>Deliberately NOT ported: the passkey block.</b> Laravel's move can
/// refuse with <c>PASSKEY_RP_CHANGE_BLOCKED</c> (409) because moving a community
/// changes the WebAuthn relying-party domain its members' passkeys were
/// registered against, silently invalidating them. That has nothing to protect
/// here yet: this backend has one static relying-party domain and no
/// per-credential <c>rp_id</c> (R-20). Omitting it is correct today and
/// <b>wrong the moment R-20 lands</b> — whoever implements R-20 must add the
/// block here in the same change.
///
/// Divergences from Laravel, all because the column does not exist here:
/// no accessible-domain validation, no features/configuration JSON, and no
/// prerender-cache invalidation (there is no prerenderer in this backend).
/// </summary>
public sealed class TenantHierarchyService
{
    private const int MasterTenantId = 1;
    private const int DefaultMaxDepth = 2;

    /// <summary>
    /// Slugs that would collide with a platform route. A community slugged
    /// "admin" or "api" is unreachable, so this is a correctness rule, not a
    /// style preference. Mirrors Laravel's <c>TenantContext::getReservedPaths()</c>.
    /// </summary>
    private static readonly HashSet<string> ReservedSlugs = new(StringComparer.OrdinalIgnoreCase)
    {
        "login", "register", "logout", "password", "verify-email", "verify-identity",
        "verify-identity-optional", "auth", "consent-required", "consent",
        "dashboard", "feed", "listings", "messages", "compose", "notifications",
        "wallet", "profile", "settings", "members", "connections", "saved",
        "users", "premium", "donations",
        "events", "groups", "community-groups", "volunteering", "organisations",
        "federation", "blog", "resources", "polls", "goals", "reviews",
        "exchanges", "group-exchanges", "matches", "search", "explore",
        "achievements", "leaderboard", "nexus-score", "activity", "skills",
        "ideation", "jobs", "kb", "marketplace", "chat",
        "courses", "podcasts", "coupons", "clubs", "me", "municipality-calendar",
        "advertise", "join",
        "caring", "caring-community", "proposals", "newsletter", "onboarding",
        "support-actions", "linked-accounts",
        "home", "about", "contact", "faq", "help", "legal", "terms", "privacy",
        "platform", "accessibility", "cookies", "community-guidelines", "acceptable-use",
        "timebanking-guide", "partner", "partner-with-us", "social-prescribing",
        "strategic-plan", "impact-summary", "impact-report", "our-story",
        "how-it-works", "guide", "news", "post",
        "features", "changelog", "development-status",
        "communities", "local-groups", "services",
        "trust-and-safety", "pilot-inquiry", "pilot-apply", "developers",
        "regional-analytics", "partner-analytics", "pricing",
        "admin", "admin-legacy", "super-admin", "broker", "partner-timebanks", "dev",
        "api", "v2", "assets", "downloads", "uploads",
        "cron", "test-email", "mobile", "mobile-download", "install-app", "share-target",
        "migrate-messages",
        "sitemap.xml", "robots.txt", "manifest.json", "service-worker.js",
        "favicon.ico", "health", "classic", ".well-known", "page",
    };

    private static readonly Regex SlugPattern = new(
        "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", RegexOptions.Compiled);

    private readonly NexusDbContext _db;
    private readonly ILogger<TenantHierarchyService> _logger;

    public TenantHierarchyService(NexusDbContext db, ILogger<TenantHierarchyService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// Tenants are not tenant-scoped data — the query filter must be off for
    /// every read here, or a super admin managing another community sees nothing
    /// and the operation "succeeds" against a row it never found.
    /// </summary>
    private IQueryable<Tenant> AllTenants() => _db.Tenants.IgnoreQueryFilters();

    public async Task<TenantHierarchyResult> CreateAsync(
        string? name,
        string? slug,
        int parentId,
        string? tagline,
        string? domain,
        bool allowsSubtenants,
        int? maxDepth,
        CancellationToken ct)
    {
        name = name?.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            return TenantHierarchyResult.Fail("Tenant name is required");
        }

        var parent = await AllTenants().FirstOrDefaultAsync(t => t.Id == parentId, ct);
        if (parent is null)
        {
            return TenantHierarchyResult.Fail("Parent tenant not found");
        }

        // The master community may always parent; anyone else must be a hub.
        if (!parent.AllowsSubtenants && parentId != MasterTenantId)
        {
            return TenantHierarchyResult.Fail("Parent tenant does not allow sub-tenants");
        }

        var newDepth = parent.Depth + 1;
        if (parent.MaxDepth > 0 && newDepth > parent.MaxDepth)
        {
            return TenantHierarchyResult.Fail("Maximum hierarchy depth exceeded");
        }

        var effectiveSlug = string.IsNullOrWhiteSpace(slug) ? GenerateSlug(name) : slug.Trim().ToLowerInvariant();
        var slugProblem = ValidateSlug(effectiveSlug);
        if (slugProblem is not null)
        {
            return TenantHierarchyResult.Fail(slugProblem);
        }

        if (await AllTenants().AnyAsync(t => t.Slug == effectiveSlug, ct))
        {
            return TenantHierarchyResult.Fail($"Slug '{effectiveSlug}' is already in use");
        }

        var tenant = new Tenant
        {
            Name = name,
            Slug = effectiveSlug,
            Tagline = string.IsNullOrWhiteSpace(tagline) ? null : tagline.Trim(),
            Domain = string.IsNullOrWhiteSpace(domain) ? null : domain.Trim().ToLowerInvariant(),
            IsActive = true,
            ParentId = parentId,
            Depth = newDepth,
            AllowsSubtenants = allowsSubtenants,
            MaxDepth = maxDepth ?? DefaultMaxDepth,
            CreatedAt = DateTime.UtcNow,
        };

        _db.Tenants.Add(tenant);
        await _db.SaveChangesAsync(ct);

        // The path contains the new row's own id, so it can only be written
        // after the insert. A tenant with a null path is treated as corrupt by
        // move and by subtree access, so this must not be left undone.
        var parentPath = string.IsNullOrWhiteSpace(parent.Path) ? $"/{parentId}/" : parent.Path;
        tenant.Path = $"{parentPath}{tenant.Id}/";
        await _db.SaveChangesAsync(ct);

        _logger.LogInformation(
            "TenantHierarchy created tenant={TenantId} slug={Slug} parent={ParentId} depth={Depth}",
            tenant.Id, tenant.Slug, parentId, newDepth);

        return TenantHierarchyResult.Ok(tenant.Id);
    }

    public async Task<TenantHierarchyResult> UpdateAsync(
        int tenantId,
        string? name,
        string? slug,
        string? tagline,
        string? domain,
        bool? isActive,
        bool? allowsSubtenants,
        int? maxDepth,
        CancellationToken ct)
    {
        var tenant = await AllTenants().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null)
        {
            return TenantHierarchyResult.Fail("Tenant not found");
        }

        if (slug is not null)
        {
            var candidate = slug.Trim().ToLowerInvariant();
            var slugProblem = ValidateSlug(candidate);
            if (slugProblem is not null)
            {
                return TenantHierarchyResult.Fail(slugProblem);
            }

            if (!string.Equals(candidate, tenant.Slug, StringComparison.Ordinal)
                && await AllTenants().AnyAsync(t => t.Slug == candidate && t.Id != tenantId, ct))
            {
                return TenantHierarchyResult.Fail($"Slug '{candidate}' is already in use");
            }

            tenant.Slug = candidate;
        }

        if (name is not null)
        {
            if (string.IsNullOrWhiteSpace(name))
            {
                return TenantHierarchyResult.Fail("Tenant name is required");
            }
            tenant.Name = name.Trim();
        }

        if (tagline is not null) tenant.Tagline = string.IsNullOrWhiteSpace(tagline) ? null : tagline.Trim();
        if (domain is not null) tenant.Domain = string.IsNullOrWhiteSpace(domain) ? null : domain.Trim().ToLowerInvariant();
        if (isActive.HasValue) tenant.IsActive = isActive.Value;
        if (maxDepth.HasValue) tenant.MaxDepth = maxDepth.Value;

        // Routed through the same guard as the dedicated endpoint, so an update
        // cannot quietly strip hub capability from a community that has children.
        if (allowsSubtenants.HasValue && allowsSubtenants.Value != tenant.AllowsSubtenants)
        {
            var toggled = await ApplySubtenantCapabilityAsync(tenant, allowsSubtenants.Value, ct);
            if (!toggled.Success) return toggled;
        }

        tenant.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return TenantHierarchyResult.Ok(tenantId);
    }

    /// <summary>Soft delete: deactivation. Hard delete is refused outright.</summary>
    public async Task<TenantHierarchyResult> DeleteAsync(int tenantId, bool hardDelete, CancellationToken ct)
    {
        if (tenantId == MasterTenantId)
        {
            return TenantHierarchyResult.Fail("Cannot delete the Master tenant");
        }

        var tenant = await AllTenants().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null)
        {
            return TenantHierarchyResult.Fail("Tenant not found");
        }

        if (hardDelete)
        {
            return TenantHierarchyResult.Fail("Hard delete is disabled; deactivate the tenant instead");
        }

        var activeChildren = await AllTenants()
            .CountAsync(t => t.ParentId == tenantId && t.IsActive, ct);
        if (activeChildren > 0)
        {
            return TenantHierarchyResult.Fail(
                "Cannot delete a tenant with active sub-tenants. Deactivate or move them first.");
        }

        tenant.IsActive = false;
        tenant.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        _logger.LogInformation("TenantHierarchy deactivated tenant={TenantId} name={Name}", tenantId, tenant.Name);
        return TenantHierarchyResult.Ok(tenantId);
    }

    public async Task<TenantHierarchyResult> ReactivateAsync(int tenantId, CancellationToken ct)
    {
        var tenant = await AllTenants().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null)
        {
            return TenantHierarchyResult.Fail("Tenant not found");
        }

        tenant.IsActive = true;
        tenant.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return TenantHierarchyResult.Ok(tenantId);
    }

    public async Task<TenantHierarchyResult> ToggleSubtenantCapabilityAsync(
        int tenantId, bool enable, CancellationToken ct)
    {
        var tenant = await AllTenants().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null)
        {
            return TenantHierarchyResult.Fail("Tenant not found");
        }

        var result = await ApplySubtenantCapabilityAsync(tenant, enable, ct);
        if (!result.Success) return result;

        tenant.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return TenantHierarchyResult.Ok(tenantId);
    }

    /// <summary>
    /// Shared by the dedicated toggle endpoint and by update, so both enforce
    /// the same rule. Note the privilege side effect: turning hub capability OFF
    /// also removes network-admin status from that community's users, because
    /// network admin is only meaningful for a community that has sub-tenants.
    /// Leaving it set would leave people holding a cross-community power whose
    /// justification has been withdrawn.
    /// </summary>
    private async Task<TenantHierarchyResult> ApplySubtenantCapabilityAsync(
        Tenant tenant, bool enable, CancellationToken ct)
    {
        if (!enable && await AllTenants().AnyAsync(t => t.ParentId == tenant.Id, ct))
        {
            return TenantHierarchyResult.Fail(
                "Cannot disable sub-tenant capability while this tenant has sub-tenants");
        }

        tenant.AllowsSubtenants = enable;

        if (!enable)
        {
            var demoted = await _db.Users.IgnoreQueryFilters()
                .Where(u => u.TenantId == tenant.Id && u.IsTenantSuperAdmin)
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.IsTenantSuperAdmin, false), ct);

            if (demoted > 0)
            {
                _logger.LogInformation(
                    "TenantHierarchy removed network-admin status from {Count} user(s) in tenant={TenantId} "
                    + "because sub-tenant capability was disabled",
                    demoted, tenant.Id);
            }
        }

        return TenantHierarchyResult.Ok(tenant.Id);
    }

    public async Task<TenantHierarchyResult> MoveAsync(int tenantId, int newParentId, CancellationToken ct)
    {
        if (tenantId == MasterTenantId)
        {
            return TenantHierarchyResult.Fail("Cannot move the Master tenant");
        }

        if (tenantId == newParentId)
        {
            return TenantHierarchyResult.Fail("Cannot move a tenant to be its own parent");
        }

        var tenant = await AllTenants().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (tenant is null)
        {
            return TenantHierarchyResult.Fail("Tenant not found");
        }

        var newParent = await AllTenants().FirstOrDefaultAsync(t => t.Id == newParentId, ct);
        if (newParent is null)
        {
            return TenantHierarchyResult.Fail("New parent tenant not found");
        }

        // 🔴 Fail closed. The cycle check below is a string prefix match, and
        // every string starts with "", so a missing path would make ANY
        // destination look acceptable — including one inside this tenant's own
        // subtree, which would detach that subtree from the tree entirely.
        if (string.IsNullOrWhiteSpace(tenant.Path) || string.IsNullOrWhiteSpace(newParent.Path))
        {
            return TenantHierarchyResult.Fail(
                "Cannot move tenant: hierarchy path data is missing. "
                + "Re-save the affected tenants to rebuild paths.");
        }

        if (newParent.Path!.StartsWith(tenant.Path!, StringComparison.Ordinal))
        {
            return TenantHierarchyResult.Fail("Cannot move a tenant under one of its own descendants");
        }

        if (!newParent.AllowsSubtenants && newParentId != MasterTenantId)
        {
            return TenantHierarchyResult.Fail("Parent tenant does not allow sub-tenants");
        }

        var oldPath = tenant.Path!;
        var newPath = $"{newParent.Path}{tenant.Id}/";
        var depthShift = (newParent.Depth + 1) - tenant.Depth;

        // Every descendant carries the moved tenant's path as a prefix. Rewrite
        // that prefix and shift depth by the same amount; updating only the
        // moved row would leave the subtree routed through a parent it no
        // longer has.
        var descendants = await AllTenants()
            .Where(t => t.Id != tenantId && t.Path != null && t.Path.StartsWith(oldPath))
            .ToListAsync(ct);

        await using var transaction = await _db.Database.BeginTransactionAsync(ct);

        tenant.ParentId = newParentId;
        tenant.Path = newPath;
        tenant.Depth = newParent.Depth + 1;
        tenant.UpdatedAt = DateTime.UtcNow;

        foreach (var descendant in descendants)
        {
            descendant.Path = string.Concat(newPath, descendant.Path![oldPath.Length..]);
            descendant.Depth += depthShift;
            descendant.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        _logger.LogInformation(
            "TenantHierarchy moved tenant={TenantId} to parent={ParentId} descendants_rewritten={Count}",
            tenantId, newParentId, descendants.Count);

        return TenantHierarchyResult.Ok(tenantId);
    }

    private static string? ValidateSlug(string slug)
    {
        if (!SlugPattern.IsMatch(slug))
        {
            return "Slug format is invalid";
        }

        return ReservedSlugs.Contains(slug)
            ? $"Slug '{slug}' is reserved by the platform"
            : null;
    }

    private static string GenerateSlug(string name)
    {
        var lowered = name.Trim().ToLowerInvariant();
        var cleaned = Regex.Replace(lowered, "[^a-z0-9]+", "-").Trim('-');
        if (cleaned.Length > 63) cleaned = cleaned[..63].Trim('-');
        return cleaned.Length == 0 ? $"community-{Guid.NewGuid():N}"[..20] : cleaned;
    }
}
