// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for tenant hierarchy (parent-child) management.
/// System-level operations, requires super admin.
/// </summary>
public class TenantHierarchyService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<TenantHierarchyService> _logger;

    public TenantHierarchyService(NexusDbContext db, ILogger<TenantHierarchyService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<List<TenantHierarchy>> GetHierarchyAsync()
    {
        return await _db.Set<TenantHierarchy>()
            .Include(h => h.ParentTenant)
            .Include(h => h.ChildTenant)
            .Where(h => h.IsActive)
            .OrderBy(h => h.ParentTenantId)
            .ToListAsync();
    }

    public async Task<List<TenantHierarchy>> GetChildrenAsync(int parentTenantId)
    {
        return await _db.Set<TenantHierarchy>()
            .Include(h => h.ChildTenant)
            .Where(h => h.ParentTenantId == parentTenantId && h.IsActive)
            .ToListAsync();
    }

    public async Task<TenantHierarchy?> GetParentAsync(int childTenantId)
    {
        return await _db.Set<TenantHierarchy>()
            .Include(h => h.ParentTenant)
            .FirstOrDefaultAsync(h => h.ChildTenantId == childTenantId && h.IsActive);
    }

    public async Task<(TenantHierarchy? Hierarchy, string? Error)> CreateRelationshipAsync(
        int parentTenantId, int childTenantId, string inheritanceMode)
    {
        // Validate tenants exist
        var parent = await _db.Tenants.FirstOrDefaultAsync(x => x.Id == parentTenantId);
        if (parent == null) return (null, "Parent tenant not found");

        var child = await _db.Tenants.FirstOrDefaultAsync(x => x.Id == childTenantId);
        if (child == null) return (null, "Child tenant not found");

        if (parentTenantId == childTenantId)
            return (null, "A tenant cannot be its own parent");

        // Check no existing active relationship
        var existing = await _db.Set<TenantHierarchy>()
            .AnyAsync(h => h.ChildTenantId == childTenantId && h.IsActive);
        if (existing) return (null, "Child tenant already has a parent");

        // Prevent cycles
        var isAncestor = await IsAncestorAsync(childTenantId, parentTenantId);
        if (isAncestor) return (null, "Would create a circular hierarchy");

        var hierarchy = new TenantHierarchy
        {
            ParentTenantId = parentTenantId,
            ChildTenantId = childTenantId,
            InheritanceMode = inheritanceMode
        };

        _db.Set<TenantHierarchy>().Add(hierarchy);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Tenant hierarchy created: {Parent} -> {Child}", parentTenantId, childTenantId);
        return (hierarchy, null);
    }

    public async Task<(TenantHierarchy? Hierarchy, string? Error)> UpdateRelationshipAsync(
        int id, string? inheritanceMode, bool? isActive)
    {
        var hierarchy = await _db.Set<TenantHierarchy>().FirstOrDefaultAsync(x => x.Id == id);
        if (hierarchy == null) return (null, "Relationship not found");

        if (inheritanceMode != null) hierarchy.InheritanceMode = inheritanceMode;
        if (isActive.HasValue) hierarchy.IsActive = isActive.Value;

        await _db.SaveChangesAsync();
        return (hierarchy, null);
    }

    public async Task<string?> DeleteRelationshipAsync(int id)
    {
        var hierarchy = await _db.Set<TenantHierarchy>().FirstOrDefaultAsync(x => x.Id == id);
        if (hierarchy == null) return "Relationship not found";

        _db.Set<TenantHierarchy>().Remove(hierarchy);
        await _db.SaveChangesAsync();
        return null;
    }

    private async Task<bool> IsAncestorAsync(int potentialAncestorId, int tenantId)
    {
        var visited = new HashSet<int>();
        var current = tenantId;

        while (true)
        {
            if (visited.Contains(current)) break;
            visited.Add(current);

            var parent = await _db.Set<TenantHierarchy>()
                .FirstOrDefaultAsync(h => h.ChildTenantId == current && h.IsActive);
            if (parent == null) break;
            if (parent.ParentTenantId == potentialAncestorId) return true;
            current = parent.ParentTenantId;
        }

        return false;
    }
}
