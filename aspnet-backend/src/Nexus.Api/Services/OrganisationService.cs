// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Authorization;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for organisation / employer profile management.
/// </summary>
public class OrganisationService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<OrganisationService> _logger;

    public OrganisationService(NexusDbContext db, TenantContext tenantContext, ILogger<OrganisationService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    // ── List / Search ───────────────────────────────────────

    public async Task<List<Organisation>> GetOrganisationsAsync(
        string? type = null, string? search = null, int page = 1, int limit = 20)
    {
        var query = _db.Set<Organisation>()
            .Where(o => o.IsPublic && o.Status == "verified")
            .Include(o => o.Owner)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(type))
            query = query.Where(o => o.Type == type);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(o =>
                o.Name.ToLower().Contains(term) ||
                (o.Description != null && o.Description.ToLower().Contains(term)) ||
                (o.Industry != null && o.Industry.ToLower().Contains(term)));
        }

        return await query
            .OrderBy(o => o.Name)
            .Skip((Math.Max(1, page) - 1) * Math.Clamp(limit, 1, 100))
            .Take(Math.Clamp(limit, 1, 100))
            .ToListAsync();
    }

    public async Task<int> CountOrganisationsAsync(string? type = null, string? search = null)
    {
        var query = _db.Set<Organisation>().Where(o => o.IsPublic && o.Status == "verified");
        if (!string.IsNullOrWhiteSpace(type))
            query = query.Where(o => o.Type == type);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(o => o.Name.ToLower().Contains(term));
        }
        return await query.CountAsync();
    }

    public async Task<Organisation?> GetByIdAsync(int id, int viewerId)
    {
        var viewer = await FindActiveTenantUserAsync(viewerId);
        if (viewer == null) return null;

        var organisation = await _db.Set<Organisation>()
            .Include(o => o.Owner)
            .Include(o => o.Members).ThenInclude(m => m.User)
            .FirstOrDefaultAsync(o => o.Id == id);
        if (organisation == null) return null;

        var mayView = organisation.IsPublic
            && string.Equals(organisation.Status, "verified", StringComparison.Ordinal);
        mayView = mayView
            || organisation.OwnerId == viewerId
            || NexusUserAccessEvaluator.HasAdminAccess(viewer)
            || organisation.Members.Any(member => member.UserId == viewerId);

        return mayView ? organisation : null;
    }

    public async Task<Organisation?> GetBySlugAsync(string slug)
    {
        return await _db.Set<Organisation>()
            .Include(o => o.Owner)
            .FirstOrDefaultAsync(o => o.Slug == slug && o.IsPublic && o.Status == "verified");
    }

    public async Task<List<Organisation>> GetMyOrganisationsAsync(int userId)
    {
        var orgIds = await _db.Set<OrganisationMember>()
            .Where(m => m.UserId == userId)
            .Select(m => m.OrganisationId)
            .ToListAsync();

        return await _db.Set<Organisation>()
            .Where(o => orgIds.Contains(o.Id))
            .OrderBy(o => o.Name)
            .ToListAsync();
    }

    // ── CRUD ────────────────────────────────────────────────

    public async Task<(Organisation? Org, string? Error)> CreateAsync(
        int ownerId, string name, string? description, string? logoUrl,
        string? websiteUrl, string? email, string? phone, string? address,
        double? latitude, double? longitude, string type, string? industry)
    {
        var slug = GenerateSlug(name);
        var existing = await _db.Set<Organisation>().AnyAsync(o => o.Slug == slug);
        if (existing)
            slug = $"{slug}-{DateTime.UtcNow.Ticks % 10000}";

        var org = new Organisation
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            Name = name,
            Slug = slug,
            Description = description,
            LogoUrl = logoUrl,
            WebsiteUrl = websiteUrl,
            Email = email,
            Phone = phone,
            Address = address,
            Latitude = latitude,
            Longitude = longitude,
            Type = type,
            Industry = industry,
            OwnerId = ownerId,
            Status = "pending"
        };

        _db.Set<Organisation>().Add(org);
        await _db.SaveChangesAsync();

        // Auto-add owner as member
        _db.Set<OrganisationMember>().Add(new OrganisationMember
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            OrganisationId = org.Id,
            UserId = ownerId,
            Role = "owner"
        });
        await _db.SaveChangesAsync();

        _logger.LogInformation("Organisation {OrgId} created by user {UserId}", org.Id, ownerId);
        return (org, null);
    }

    public async Task<(Organisation? Org, string? Error)> UpdateAsync(
        int orgId, int userId, string? name, string? description, string? logoUrl,
        string? websiteUrl, string? email, string? phone, string? address,
        double? latitude, double? longitude, string? type, string? industry, bool? isPublic)
    {
        var org = await _db.Set<Organisation>().FirstOrDefaultAsync(x => x.Id == orgId);
        if (org == null) return (null, "Organisation not found");

        // Only the canonical owner or an organisation admin can update. A
        // historical membership row labelled "owner" must not confer ownership.
        var member = await _db.Set<OrganisationMember>()
            .FirstOrDefaultAsync(m => m.OrganisationId == orgId && m.UserId == userId);
        var isCanonicalOwner = org.OwnerId == userId;
        var isOrganisationAdmin = string.Equals(
            member?.Role,
            "admin",
            StringComparison.OrdinalIgnoreCase);
        if (!isCanonicalOwner && !isOrganisationAdmin)
            return (null, "Not authorized to update this organisation");

        if (name != null)
        {
            org.Name = name;
            var newSlug = GenerateSlug(name);
            var slugExists = await _db.Set<Organisation>().AnyAsync(o => o.Slug == newSlug && o.Id != orgId);
            if (slugExists)
                newSlug = $"{newSlug}-{DateTime.UtcNow.Ticks % 10000}";
            org.Slug = newSlug;
        }
        if (description != null) org.Description = description;
        if (logoUrl != null) org.LogoUrl = logoUrl;
        if (websiteUrl != null) org.WebsiteUrl = websiteUrl;
        if (email != null) org.Email = email;
        if (phone != null) org.Phone = phone;
        if (address != null) org.Address = address;
        if (latitude.HasValue) org.Latitude = latitude;
        if (longitude.HasValue) org.Longitude = longitude;
        if (type != null) org.Type = type;
        if (industry != null) org.Industry = industry;
        if (isPublic.HasValue) org.IsPublic = isPublic.Value;

        org.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (org, null);
    }

    public async Task<string?> DeleteAsync(int orgId, int userId)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.ReadCommitted);
        await OrganisationLifecycleLock.AcquireAsync(_db, orgId);

        var org = await _db.Set<Organisation>().FirstOrDefaultAsync(x => x.Id == orgId);
        if (org == null)
        {
            await transaction.RollbackAsync();
            return "Organisation not found";
        }
        if (org.OwnerId != userId)
        {
            await transaction.RollbackAsync();
            return "Only the owner can delete this organisation";
        }

        // Organisation wallets are durable financial evidence. Deleting a
        // funded wallet (or one with history) would erase the receiving side
        // while personal-wallet debits remain. Require an explicit, audited
        // close-out workflow instead of cascading that evidence away.
        var wallet = await _db.Set<OrgWallet>()
            .AsNoTracking()
            .FirstOrDefaultAsync(candidate => candidate.OrganisationId == orgId);
        if (wallet != null)
        {
            var hasTransactionHistory = await _db.Set<OrgWalletTransaction>()
                .AsNoTracking()
                .AnyAsync(entry => entry.OrgWalletId == wallet.Id);
            if (wallet.Balance != 0m
                || wallet.TotalReceived != 0m
                || wallet.TotalSpent != 0m
                || hasTransactionHistory)
            {
                await transaction.RollbackAsync();
                return "Organisation wallet must be empty and have no transaction history before deletion";
            }
        }

        var members = await _db.Set<OrganisationMember>()
            .Where(m => m.OrganisationId == orgId).ToListAsync();
        _db.Set<OrganisationMember>().RemoveRange(members);
        _db.Set<Organisation>().Remove(org);
        await _db.SaveChangesAsync();
        await transaction.CommitAsync();
        return null;
    }

    // ── Members ─────────────────────────────────────────────

    public async Task<List<OrganisationMember>?> GetMembersAsync(int orgId, int viewerId)
    {
        var organisation = await GetByIdAsync(orgId, viewerId);
        if (organisation == null) return null;

        return organisation.Members
            .Where(member => member.User is { IsActive: true, SuspendedAt: null })
            .OrderBy(m => m.Role)
            .ThenBy(m => m.JoinedAt)
            .ToList();
    }

    /// <summary>
    /// Wallets are private to an organisation's owner/members and current,
    /// database-backed tenant administrators. The existence bit lets callers
    /// preserve the canonical 404-versus-403 contract.
    /// </summary>
    public async Task<(bool Exists, bool Allowed)> GetWalletAccessAsync(int orgId, int viewerId)
    {
        var organisation = await _db.Set<Organisation>()
            .AsNoTracking()
            .FirstOrDefaultAsync(candidate => candidate.Id == orgId);
        if (organisation == null) return (false, false);

        var viewer = await FindActiveTenantUserAsync(viewerId);
        if (viewer == null) return (true, false);

        if (organisation.OwnerId == viewerId || NexusUserAccessEvaluator.HasAdminAccess(viewer))
            return (true, true);

        var isMember = await _db.Set<OrganisationMember>()
            .AsNoTracking()
            .AnyAsync(member => member.OrganisationId == orgId
                && member.UserId == viewerId);
        return (true, isMember);
    }

    public async Task<(OrganisationMember? Member, string? Error)> AddMemberAsync(
        int orgId, int userId, int requesterId, string role = "member", string? jobTitle = null)
    {
        var normalizedRole = NormalizeAssignableRole(role);
        if (normalizedRole == null || normalizedRole == "owner")
            return (null, "Role must be admin, member, or volunteer");

        await using var transaction = await _db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.ReadCommitted);
        await OrganisationLifecycleLock.AcquireAsync(_db, orgId);

        var org = await _db.Set<Organisation>().FirstOrDefaultAsync(candidate => candidate.Id == orgId);
        if (org == null)
        {
            await transaction.RollbackAsync();
            return (null, "Organisation not found");
        }

        var requesterIsOwner = org.OwnerId == requesterId;
        var requester = await _db.Set<OrganisationMember>()
            .AsNoTracking()
            .FirstOrDefaultAsync(m => m.OrganisationId == orgId && m.UserId == requesterId);
        var requesterIsAdmin = string.Equals(requester?.Role, "admin", StringComparison.OrdinalIgnoreCase);
        if (!requesterIsOwner && !requesterIsAdmin)
        {
            await transaction.RollbackAsync();
            return (null, "Not authorized to add members");
        }
        if (!requesterIsOwner && normalizedRole == "admin")
        {
            await transaction.RollbackAsync();
            return (null, "Only the owner can grant an elevated role");
        }

        var target = await FindActiveTenantUserAsync(userId);
        if (target == null)
        {
            await transaction.RollbackAsync();
            return (null, "User not found");
        }

        var existing = await _db.Set<OrganisationMember>()
            .AnyAsync(m => m.OrganisationId == orgId && m.UserId == userId);
        if (existing)
        {
            await transaction.RollbackAsync();
            return (null, "User is already a member");
        }

        var member = new OrganisationMember
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            OrganisationId = orgId,
            UserId = userId,
            Role = normalizedRole,
            JobTitle = jobTitle
        };

        _db.Set<OrganisationMember>().Add(member);
        await _db.SaveChangesAsync();
        await transaction.CommitAsync();
        return (member, null);
    }

    public async Task<string?> RemoveMemberAsync(int orgId, int userId, int requesterId)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.ReadCommitted);
        await OrganisationLifecycleLock.AcquireAsync(_db, orgId);

        var org = await _db.Set<Organisation>().FirstOrDefaultAsync(candidate => candidate.Id == orgId);
        if (org == null)
        {
            await transaction.RollbackAsync();
            return "Organisation not found";
        }

        var requesterIsOwner = org.OwnerId == requesterId;
        var requester = await _db.Set<OrganisationMember>()
            .AsNoTracking()
            .FirstOrDefaultAsync(m => m.OrganisationId == orgId && m.UserId == requesterId);
        var requesterIsAdmin = string.Equals(requester?.Role, "admin", StringComparison.OrdinalIgnoreCase);
        if (!requesterIsOwner && !requesterIsAdmin)
        {
            await transaction.RollbackAsync();
            return "Not authorized to remove members";
        }

        var member = await _db.Set<OrganisationMember>()
            .FirstOrDefaultAsync(m => m.OrganisationId == orgId && m.UserId == userId);
        if (member == null)
        {
            await transaction.RollbackAsync();
            return "Member not found";
        }
        if (org.OwnerId == userId || string.Equals(member.Role, "owner", StringComparison.OrdinalIgnoreCase))
        {
            await transaction.RollbackAsync();
            return "Cannot remove the owner";
        }
        if (!requesterIsOwner && string.Equals(member.Role, "admin", StringComparison.OrdinalIgnoreCase))
        {
            await transaction.RollbackAsync();
            return "Only the owner can revoke an elevated role";
        }

        _db.Set<OrganisationMember>().Remove(member);
        await _db.SaveChangesAsync();
        await transaction.CommitAsync();
        return null;
    }

    public async Task<(OrganisationMember? Member, string? Error)> UpdateMemberRoleAsync(
        int orgId, int userId, int requesterId, string newRole, string? jobTitle = null)
    {
        var normalizedRole = NormalizeAssignableRole(newRole);
        if (normalizedRole == null || normalizedRole == "owner")
            return (null, "Role must be admin, member, or volunteer");

        await using var transaction = await _db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.ReadCommitted);
        await OrganisationLifecycleLock.AcquireAsync(_db, orgId);

        var org = await _db.Set<Organisation>().FirstOrDefaultAsync(candidate => candidate.Id == orgId);
        if (org == null)
        {
            await transaction.RollbackAsync();
            return (null, "Organisation not found");
        }
        if (org.OwnerId != requesterId)
        {
            await transaction.RollbackAsync();
            return (null, "Only the owner can change roles");
        }
        if (org.OwnerId == userId)
        {
            await transaction.RollbackAsync();
            return (null, "Cannot change the owner's role");
        }

        var member = await _db.Set<OrganisationMember>()
            .FirstOrDefaultAsync(m => m.OrganisationId == orgId && m.UserId == userId);
        if (member == null)
        {
            await transaction.RollbackAsync();
            return (null, "Member not found");
        }
        if (await FindActiveTenantUserAsync(member.UserId) == null)
        {
            await transaction.RollbackAsync();
            return (null, "User not found");
        }

        member.Role = normalizedRole;
        if (jobTitle != null) member.JobTitle = jobTitle;
        await _db.SaveChangesAsync();
        await transaction.CommitAsync();
        return (member, null);
    }

    // ── Admin ───────────────────────────────────────────────

    public async Task<(List<Organisation> Items, int Total)> AdminListAsync(
        string? status = null,
        string? search = null,
        int page = 1,
        int limit = 20)
    {
        var query = _db.Set<Organisation>()
            .Include(o => o.Owner)
            .Include(o => o.Members)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(status))
            query = query.Where(o => o.Status == status);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(o =>
                o.Name.ToLower().Contains(term) ||
                (o.Slug != null && o.Slug.ToLower().Contains(term)) ||
                (o.Industry != null && o.Industry.ToLower().Contains(term)));
        }

        var total = await query.CountAsync();
        var items = await query
            .OrderByDescending(o => o.CreatedAt)
            .Skip((Math.Max(1, page) - 1) * Math.Clamp(limit, 1, 100))
            .Take(Math.Clamp(limit, 1, 100))
            .ToListAsync();

        return (items, total);
    }

    public async Task<(Organisation? Org, string? Error)> AdminVerifyAsync(int orgId)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.ReadCommitted);
        await OrganisationLifecycleLock.AcquireAsync(_db, orgId);

        var org = await _db.Set<Organisation>().FirstOrDefaultAsync(x => x.Id == orgId);
        if (org == null)
        {
            await transaction.RollbackAsync();
            return (null, "Organisation not found");
        }

        org.Status = "verified";
        org.VerifiedAt = DateTime.UtcNow;
        org.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await transaction.CommitAsync();
        return (org, null);
    }

    public async Task<(Organisation? Org, string? Error)> AdminSuspendAsync(int orgId)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.ReadCommitted);
        await OrganisationLifecycleLock.AcquireAsync(_db, orgId);

        var org = await _db.Set<Organisation>().FirstOrDefaultAsync(x => x.Id == orgId);
        if (org == null)
        {
            await transaction.RollbackAsync();
            return (null, "Organisation not found");
        }

        org.Status = "suspended";
        org.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await transaction.CommitAsync();
        return (org, null);
    }

    private async Task<User?> FindActiveTenantUserAsync(int userId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        return await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(user => user.Id == userId
                && user.TenantId == tenantId
                && user.IsActive
                && user.SuspendedAt == null);
    }

    private static string? NormalizeAssignableRole(string? role)
    {
        if (string.IsNullOrWhiteSpace(role)) return null;

        var normalized = role.Trim().ToLowerInvariant();
        return normalized is "owner" or "admin" or "member" or "volunteer"
            ? normalized
            : null;
    }

    private static string GenerateSlug(string name)
    {
        return System.Text.RegularExpressions.Regex
            .Replace(name.ToLower().Trim(), @"[^a-z0-9\s-]", "")
            .Replace(' ', '-')
            .Trim('-');
    }
}
