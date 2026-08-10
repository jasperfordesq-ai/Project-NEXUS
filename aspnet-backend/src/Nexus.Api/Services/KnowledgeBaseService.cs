// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for knowledge base / help article management.
/// Provides CRUD operations and search for tenant-scoped articles.
/// </summary>
public class KnowledgeBaseService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<KnowledgeBaseService> _logger;

    public KnowledgeBaseService(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<KnowledgeBaseService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// List published articles, optionally filtered by category and/or text search.
    /// </summary>
    public async Task<List<KnowledgeArticle>> GetArticlesAsync(
        string? category = null,
        string? search = null)
    {
        var query = _db.Set<KnowledgeArticle>()
            .Where(a => a.IsPublished);

        if (!string.IsNullOrWhiteSpace(category))
        {
            query = query.Where(a => a.Category == category);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(a =>
                a.Title.ToLower().Contains(term) ||
                a.Content.ToLower().Contains(term));
        }

        return await query
            .OrderBy(a => a.Category)
            .ThenBy(a => a.SortOrder)
            .ThenBy(a => a.Title)
            .ToListAsync();
    }

    /// <summary>
    /// Get a single article by slug and increment its view count.
    /// </summary>
    public async Task<KnowledgeArticle?> GetArticleBySlugAsync(string slug)
    {
        var article = await _db.Set<KnowledgeArticle>()
            .Include(a => a.CreatedBy)
            .FirstOrDefaultAsync(a => a.Slug == slug && a.IsPublished);

        if (article != null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE \"knowledge_articles\" SET \"ViewCount\" = \"ViewCount\" + 1 WHERE \"Id\" = {article.Id}");
        }

        return article;
    }

    /// <summary>
    /// List distinct categories with article counts (published only).
    /// </summary>
    public async Task<List<CategoryInfo>> GetCategoriesAsync()
    {
        return await _db.Set<KnowledgeArticle>()
            .Where(a => a.IsPublished && a.Category != null)
            .GroupBy(a => a.Category!)
            .Select(g => new CategoryInfo
            {
                Name = g.Key,
                ArticleCount = g.Count()
            })
            .OrderBy(c => c.Name)
            .ToListAsync();
    }

    /// <summary>
    /// Create a new knowledge article.
    /// </summary>
    public async Task<KnowledgeArticle> CreateArticleAsync(
        int userId,
        string title,
        string slug,
        string content,
        string? category = null,
        string? tags = null,
        bool isPublished = false)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        // Check for duplicate slug within tenant
        var slugExists = await _db.Set<KnowledgeArticle>()
            .AnyAsync(a => a.Slug == slug);

        if (slugExists)
        {
            throw new InvalidOperationException($"An article with slug '{slug}' already exists.");
        }

        var article = new KnowledgeArticle
        {
            TenantId = tenantId,
            Title = title.Trim(),
            Slug = slug.Trim().ToLower(),
            Content = content,
            Category = category?.Trim(),
            Tags = tags?.Trim(),
            IsPublished = isPublished,
            CreatedById = userId,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<KnowledgeArticle>().Add(article);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Knowledge article {ArticleId} '{Title}' created by user {UserId} in tenant {TenantId}",
            article.Id, article.Title, userId, tenantId);

        return article;
    }

    /// <summary>
    /// Update an existing knowledge article.
    /// </summary>
    public async Task<KnowledgeArticle?> UpdateArticleAsync(
        int articleId,
        string? title = null,
        string? content = null,
        string? category = null,
        string? tags = null,
        bool? isPublished = null,
        int? sortOrder = null)
    {
        var article = await _db.Set<KnowledgeArticle>()
            .FirstOrDefaultAsync(a => a.Id == articleId);

        if (article == null) return null;

        if (title != null) article.Title = title.Trim();
        if (content != null) article.Content = content;
        if (category != null) article.Category = category.Trim();
        if (tags != null) article.Tags = tags.Trim();
        if (isPublished.HasValue) article.IsPublished = isPublished.Value;
        if (sortOrder.HasValue) article.SortOrder = sortOrder.Value;

        article.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Knowledge article {ArticleId} updated",
            article.Id);

        return article;
    }

    /// <summary>
    /// Delete a knowledge article (hard delete).
    /// </summary>
    public async Task<bool> DeleteArticleAsync(int articleId)
    {
        var article = await _db.Set<KnowledgeArticle>()
            .FirstOrDefaultAsync(a => a.Id == articleId);

        if (article == null) return false;

        _db.Set<KnowledgeArticle>().Remove(article);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Knowledge article {ArticleId} deleted",
            article.Id);

        return true;
    }
}

/// <summary>
/// Category summary with article count.
/// </summary>
public class CategoryInfo
{
    public string Name { get; set; } = string.Empty;
    public int ArticleCount { get; set; }
}
