// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for CMS custom page management with version history.
/// </summary>
public class PageService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<PageService> _logger;

    public PageService(NexusDbContext db, TenantContext tenantContext, ILogger<PageService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    public async Task<List<Page>> GetPublishedPagesAsync()
    {
        return await _db.Set<Page>()
            .Where(p => p.IsPublished)
            .Where(p => p.PublishAt == null || p.PublishAt <= DateTime.UtcNow)
            .OrderBy(p => p.SortOrder)
            .ThenBy(p => p.Title)
            .ToListAsync();
    }

    public async Task<List<Page>> GetMenuPagesAsync(string? location = null)
    {
        var query = _db.Set<Page>()
            .Where(p => p.IsPublished && p.ShowInMenu)
            .Where(p => p.PublishAt == null || p.PublishAt <= DateTime.UtcNow);

        if (!string.IsNullOrWhiteSpace(location))
            query = query.Where(p => p.MenuLocation == location);

        return await query
            .OrderBy(p => p.SortOrder)
            .ThenBy(p => p.Title)
            .ToListAsync();
    }

    public async Task<Page?> GetPageBySlugAsync(string slug)
    {
        return await _db.Set<Page>()
            .Include(p => p.CreatedBy)
            .FirstOrDefaultAsync(p => p.Slug == slug && p.IsPublished &&
                (p.PublishAt == null || p.PublishAt <= DateTime.UtcNow));
    }

    public async Task<Page?> GetPageByIdAsync(int id)
    {
        return await _db.Set<Page>()
            .Include(p => p.CreatedBy)
            .Include(p => p.Children)
            .FirstOrDefaultAsync(p => p.Id == id);
    }

    public async Task<List<Page>> GetAllPagesAsync()
    {
        return await _db.Set<Page>()
            .Include(p => p.CreatedBy)
            .OrderBy(p => p.SortOrder)
            .ThenBy(p => p.Title)
            .ToListAsync();
    }

    public async Task<(Page? Page, string? Error)> CreatePageAsync(
        int userId, string title, string content, bool isPublished,
        bool showInMenu, string? menuLocation, int? parentId, DateTime? publishAt,
        string? metaTitle, string? metaDescription, int? sortOrder = null)
    {
        var slug = GenerateSlug(title);
        var existing = await _db.Set<Page>().AnyAsync(p => p.Slug == slug);
        if (existing)
            slug = $"{slug}-{DateTime.UtcNow.Ticks % 10000}";

        var page = new Page
        {
            Title = title,
            Slug = slug,
            Content = content,
            IsPublished = isPublished,
            ShowInMenu = showInMenu,
            MenuLocation = menuLocation,
            ParentId = parentId,
            PublishAt = publishAt,
            MetaTitle = metaTitle,
            MetaDescription = metaDescription,
            SortOrder = sortOrder ?? 0,
            CreatedById = userId,
            CurrentVersion = 1
        };

        _db.Set<Page>().Add(page);
        await _db.SaveChangesAsync();

        // Create initial version
        var version = new PageVersion
        {
            PageId = page.Id,
            VersionNumber = 1,
            Title = title,
            Slug = slug,
            Content = content,
            CreatedById = userId
        };
        _db.Set<PageVersion>().Add(version);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Page {PageId} created by user {UserId}", page.Id, userId);
        return (page, null);
    }

    public async Task<(Page? Page, string? Error)> UpdatePageAsync(
        int pageId, int userId, string? title, string? content, bool? isPublished,
        bool? showInMenu, string? menuLocation, int? parentId, DateTime? publishAt,
        string? metaTitle, string? metaDescription, int? sortOrder = null)
    {
        var page = await _db.Set<Page>().FirstOrDefaultAsync(x => x.Id == pageId);
        if (page == null) return (null, "Page not found");

        if (title != null)
        {
            page.Title = title;
            var newSlug = GenerateSlug(title);
            var slugExists = await _db.Set<Page>().AnyAsync(p => p.Slug == newSlug && p.Id != pageId);
            if (slugExists)
                newSlug = $"{newSlug}-{DateTime.UtcNow.Ticks % 10000}";
            page.Slug = newSlug;
        }
        if (content != null) page.Content = content;
        if (isPublished.HasValue) page.IsPublished = isPublished.Value;
        if (showInMenu.HasValue) page.ShowInMenu = showInMenu.Value;
        if (menuLocation != null) page.MenuLocation = menuLocation;
        if (parentId.HasValue) page.ParentId = parentId;
        if (publishAt.HasValue) page.PublishAt = publishAt;
        if (metaTitle != null) page.MetaTitle = metaTitle;
        if (metaDescription != null) page.MetaDescription = metaDescription;
        if (sortOrder.HasValue) page.SortOrder = sortOrder.Value;

        page.UpdatedAt = DateTime.UtcNow;
        page.CurrentVersion++;

        // Create version snapshot
        var version = new PageVersion
        {
            PageId = page.Id,
            VersionNumber = page.CurrentVersion,
            Title = page.Title,
            Slug = page.Slug,
            Content = page.Content,
            CreatedById = userId
        };
        _db.Set<PageVersion>().Add(version);
        await _db.SaveChangesAsync();

        return (page, null);
    }

    public async Task<string?> DeletePageAsync(int pageId)
    {
        var page = await _db.Set<Page>().FirstOrDefaultAsync(x => x.Id == pageId);
        if (page == null) return "Page not found";

        // Unparent children
        var children = await _db.Set<Page>().Where(p => p.ParentId == pageId).ToListAsync();
        foreach (var c in children) c.ParentId = null;

        // Remove versions
        var versions = await _db.Set<PageVersion>().Where(v => v.PageId == pageId).ToListAsync();
        _db.Set<PageVersion>().RemoveRange(versions);

        _db.Set<Page>().Remove(page);
        await _db.SaveChangesAsync();
        return null;
    }

    public async Task<List<PageVersion>> GetVersionsAsync(int pageId)
    {
        return await _db.Set<PageVersion>()
            .Where(v => v.PageId == pageId)
            .Include(v => v.CreatedBy)
            .OrderByDescending(v => v.VersionNumber)
            .ToListAsync();
    }

    public async Task<(Page? Page, string? Error)> RevertToVersionAsync(int pageId, int versionNumber, int userId)
    {
        var page = await _db.Set<Page>().FirstOrDefaultAsync(x => x.Id == pageId);
        if (page == null) return (null, "Page not found");

        var version = await _db.Set<PageVersion>()
            .FirstOrDefaultAsync(v => v.PageId == pageId && v.VersionNumber == versionNumber);
        if (version == null) return (null, "Version not found");

        page.Title = version.Title;
        page.Slug = version.Slug;
        page.Content = version.Content;
        page.UpdatedAt = DateTime.UtcNow;
        page.CurrentVersion++;

        // Create new version marking the revert
        var revertVersion = new PageVersion
        {
            PageId = page.Id,
            VersionNumber = page.CurrentVersion,
            Title = page.Title,
            Slug = page.Slug,
            Content = page.Content,
            CreatedById = userId
        };
        _db.Set<PageVersion>().Add(revertVersion);
        await _db.SaveChangesAsync();

        return (page, null);
    }

    public async Task<(Page? Page, string? Error)> DuplicatePageAsync(int pageId, int userId)
    {
        var original = await _db.Set<Page>().FirstOrDefaultAsync(x => x.Id == pageId);
        if (original == null) return (null, "Page not found");

        var slug = $"{original.Slug}-copy-{DateTime.UtcNow.Ticks % 10000}";
        var copy = new Page
        {
            Title = $"{original.Title} (Copy)",
            Slug = slug,
            Content = original.Content,
            IsPublished = false,
            ShowInMenu = false,
            MenuLocation = original.MenuLocation,
            ParentId = original.ParentId,
            MetaTitle = original.MetaTitle,
            MetaDescription = original.MetaDescription,
            CreatedById = userId,
            CurrentVersion = 1
        };

        _db.Set<Page>().Add(copy);
        await _db.SaveChangesAsync();

        var version = new PageVersion
        {
            PageId = copy.Id,
            VersionNumber = 1,
            Title = copy.Title,
            Slug = copy.Slug,
            Content = copy.Content,
            CreatedById = userId
        };
        _db.Set<PageVersion>().Add(version);
        await _db.SaveChangesAsync();

        return (copy, null);
    }

    public async Task<string?> ReorderPagesAsync(List<(int PageId, int SortOrder)> ordering)
    {
        foreach (var (pageId, sortOrder) in ordering)
        {
            var page = await _db.Set<Page>().FirstOrDefaultAsync(x => x.Id == pageId);
            if (page != null) page.SortOrder = sortOrder;
        }
        await _db.SaveChangesAsync();
        return null;
    }

    private static string GenerateSlug(string title)
    {
        return System.Text.RegularExpressions.Regex
            .Replace(title.ToLower().Trim(), @"[^a-z0-9\s-]", "")
            .Replace(' ', '-')
            .Trim('-');
    }
}
