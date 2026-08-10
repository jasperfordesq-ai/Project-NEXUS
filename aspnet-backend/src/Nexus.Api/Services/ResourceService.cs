// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing resources and resource categories.
/// All operations are tenant-scoped via global query filters.
/// </summary>
public class ResourceService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<ResourceService> _logger;

    private static readonly HashSet<string> ValidResourceTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "link", "document", "video", "image", "file", "guide", "template"
    };

    public ResourceService(NexusDbContext db, ILogger<ResourceService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<(List<Resource> Resources, int Total)> GetResourcesAsync(
        int tenantId, int? categoryId, string? type, int page, int limit)
    {
        var query = _db.Set<Resource>().AsQueryable();
        if (categoryId.HasValue)
            query = query.Where(r => r.CategoryId == categoryId.Value);
        if (!string.IsNullOrWhiteSpace(type))
            query = query.Where(r => r.ResourceType == type.Trim().ToLower());
        var total = await query.CountAsync();
        var resources = await query.AsNoTracking().Include(r => r.CreatedBy).Include(r => r.Category)
            .OrderBy(r => r.SortOrder).ThenByDescending(r => r.CreatedAt)
            .Skip((page - 1) * limit).Take(limit).ToListAsync();
        return (resources, total);
    }

    public async Task<Resource?> GetResourceAsync(int id)
    {
        return await _db.Set<Resource>().AsNoTracking()
            .Include(r => r.CreatedBy).Include(r => r.Category)
            .FirstOrDefaultAsync(r => r.Id == id);
    }

    public async Task<(Resource? Resource, string? Error)> CreateResourceAsync(
        int tenantId, int userId, string title, string? description,
        string? url, string resourceType, int? categoryId)
    {
        if (string.IsNullOrWhiteSpace(title))
            return (null, "Title is required");
        var normalizedType = resourceType?.Trim().ToLower() ?? "link";
        if (!ValidResourceTypes.Contains(normalizedType))
            return (null, "Invalid resource type");
        if (categoryId.HasValue)
        {
            if (!await _db.Set<ResourceCategory>().AnyAsync(c => c.Id == categoryId.Value))
                return (null, "Category not found");
        }
        var maxSort = await _db.Set<Resource>().Where(r => r.CategoryId == categoryId)
            .Select(r => (int?)r.SortOrder).MaxAsync() ?? 0;
        var resource = new Resource
        {
            TenantId = tenantId, Title = title.Trim(), Description = description?.Trim(),
            Url = url?.Trim(), ResourceType = normalizedType, CategoryId = categoryId,
            CreatedById = userId, SortOrder = maxSort + 1, CreatedAt = DateTime.UtcNow
        };
        _db.Set<Resource>().Add(resource);
        await _db.SaveChangesAsync();
        _logger.LogInformation("Resource {ResourceId} created by user {UserId}", resource.Id, userId);
        return (await GetResourceAsync(resource.Id), null);
    }

    public async Task<(Resource? Resource, string? Error)> UpdateResourceAsync(
        int id, string title, string? description, string? url,
        string resourceType, int? categoryId)
    {
        var resource = await _db.Set<Resource>().FirstOrDefaultAsync(x => x.Id == id);
        if (resource == null) return (null, "Resource not found");
        if (string.IsNullOrWhiteSpace(title)) return (null, "Title is required");
        var normalizedType = resourceType?.Trim().ToLower() ?? "link";
        if (!ValidResourceTypes.Contains(normalizedType)) return (null, "Invalid resource type");
        if (categoryId.HasValue)
        {
            if (!await _db.Set<ResourceCategory>().AnyAsync(c => c.Id == categoryId.Value))
                return (null, "Category not found");
        }
        resource.Title = title.Trim(); resource.Description = description?.Trim();
        resource.Url = url?.Trim(); resource.ResourceType = normalizedType;
        resource.CategoryId = categoryId; resource.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        _logger.LogInformation("Resource {ResourceId} updated", id);
        return (await GetResourceAsync(resource.Id), null);
    }

    public async Task<(bool Success, string? Error)> DeleteResourceAsync(int id)
    {
        var resource = await _db.Set<Resource>().FirstOrDefaultAsync(x => x.Id == id);
        if (resource == null) return (false, "Resource not found");
        _db.Set<Resource>().Remove(resource);
        await _db.SaveChangesAsync();
        _logger.LogInformation("Resource {ResourceId} deleted", id);
        return (true, null);
    }

    public async Task<(bool Success, string? Error)> ReorderResourcesAsync(int[] resourceIds)
    {
        if (resourceIds == null || resourceIds.Length == 0) return (false, "Resource IDs are required");
        var resources = await _db.Set<Resource>().Where(r => resourceIds.Contains(r.Id)).ToListAsync();
        if (resources.Count != resourceIds.Length) return (false, "One or more resources not found");
        for (int i = 0; i < resourceIds.Length; i++)
        {
            var resource = resources.First(r => r.Id == resourceIds[i]);
            resource.SortOrder = i + 1; resource.UpdatedAt = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync();
        _logger.LogInformation("Reordered {Count} resources", resourceIds.Length);
        return (true, null);
    }

    public async Task<List<ResourceCategory>> GetCategoriesAsync(int tenantId)
    {
        return await _db.Set<ResourceCategory>().AsNoTracking()
            .OrderBy(c => c.SortOrder).ThenBy(c => c.Name).ToListAsync();
    }

    public async Task<List<ResourceCategory>> GetCategoryTreeAsync(int tenantId)
    {
        var all = await _db.Set<ResourceCategory>().AsNoTracking()
            .Include(c => c.Resources).OrderBy(c => c.SortOrder).ThenBy(c => c.Name).ToListAsync();
        var lookup = all.ToDictionary(c => c.Id);
        var roots = new List<ResourceCategory>();
        foreach (var cat in all)
        {
            if (cat.ParentId.HasValue && lookup.TryGetValue(cat.ParentId.Value, out var p))
                p.Children.Add(cat);
            else roots.Add(cat);
        }
        return roots;
    }

    public async Task<(ResourceCategory? Category, string? Error)> CreateCategoryAsync(
        int tenantId, string name, string? description, int? parentId)
    {
        if (string.IsNullOrWhiteSpace(name)) return (null, "Name is required");
        if (parentId.HasValue && !await _db.Set<ResourceCategory>().AnyAsync(c => c.Id == parentId.Value))
            return (null, "Parent category not found");
        if (await _db.Set<ResourceCategory>().AnyAsync(c => c.Name.ToLower() == name.Trim().ToLower() && c.ParentId == parentId))
            return (null, "A category with this name already exists at this level");
        var maxSort = await _db.Set<ResourceCategory>().Where(c => c.ParentId == parentId)
            .Select(c => (int?)c.SortOrder).MaxAsync() ?? 0;
        var category = new ResourceCategory
        {
            TenantId = tenantId, Name = name.Trim(), Description = description?.Trim(),
            ParentId = parentId, SortOrder = maxSort + 1, CreatedAt = DateTime.UtcNow
        };
        _db.Set<ResourceCategory>().Add(category);
        await _db.SaveChangesAsync();
        _logger.LogInformation("Resource category {CategoryId} created", category.Id);
        return (category, null);
    }

    public async Task<(ResourceCategory? Category, string? Error)> UpdateCategoryAsync(int id, string name, string? description)
    {
        var category = await _db.Set<ResourceCategory>().FirstOrDefaultAsync(x => x.Id == id);
        if (category == null) return (null, "Category not found");
        if (string.IsNullOrWhiteSpace(name)) return (null, "Name is required");
        if (await _db.Set<ResourceCategory>().AnyAsync(c => c.Id != id && c.Name.ToLower() == name.Trim().ToLower() && c.ParentId == category.ParentId))
            return (null, "A category with this name already exists at this level");
        category.Name = name.Trim(); category.Description = description?.Trim();
        await _db.SaveChangesAsync();
        _logger.LogInformation("Resource category {CategoryId} updated", id);
        return (category, null);
    }

    public async Task<(bool Success, string? Error)> DeleteCategoryAsync(int id)
    {
        var category = await _db.Set<ResourceCategory>().Include(c => c.Children)
            .Include(c => c.Resources).FirstOrDefaultAsync(c => c.Id == id);
        if (category == null) return (false, "Category not found");
        if (category.Children.Any()) return (false, "Cannot delete category with child categories");
        if (category.Resources.Any()) return (false, "Cannot delete category that contains resources");
        _db.Set<ResourceCategory>().Remove(category);
        await _db.SaveChangesAsync();
        _logger.LogInformation("Resource category {CategoryId} deleted", id);
        return (true, null);
    }
}
