// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for blog/CMS post and category management.
/// </summary>
public class BlogService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<BlogService> _logger;

    public BlogService(NexusDbContext db, TenantContext tenantContext, ILogger<BlogService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    // ── Posts ────────────────────────────────────────────────

    public async Task<List<BlogPost>> GetPublishedPostsAsync(
        int? categoryId = null, string? tag = null, int page = 1, int limit = 20)
    {
        var query = _db.Set<BlogPost>()
            .Where(p => p.Status == "published")
            .Include(p => p.Author)
            .Include(p => p.Category)
            .AsQueryable();

        if (categoryId.HasValue)
            query = query.Where(p => p.CategoryId == categoryId.Value);

        if (!string.IsNullOrWhiteSpace(tag))
        {
            var t = tag.Trim().ToLower();
            query = query.Where(p => p.Tags != null && p.Tags.ToLower().Contains(t));
        }

        return await query
            .OrderByDescending(p => p.PublishedAt ?? p.CreatedAt)
            .Skip((Math.Max(1, page) - 1) * Math.Clamp(limit, 1, 100))
            .Take(Math.Clamp(limit, 1, 100))
            .ToListAsync();
    }

    public async Task<int> CountPublishedPostsAsync(int? categoryId = null, string? tag = null)
    {
        var query = _db.Set<BlogPost>().Where(p => p.Status == "published");
        if (categoryId.HasValue)
            query = query.Where(p => p.CategoryId == categoryId.Value);
        if (!string.IsNullOrWhiteSpace(tag))
        {
            var t = tag.Trim().ToLower();
            query = query.Where(p => p.Tags != null && p.Tags.ToLower().Contains(t));
        }
        return await query.CountAsync();
    }

    public async Task<BlogPost?> GetPostBySlugAsync(string slug)
    {
        var post = await _db.Set<BlogPost>()
            .Include(p => p.Author)
            .Include(p => p.Category)
            .FirstOrDefaultAsync(p => p.Slug == slug && p.Status == "published");

        if (post != null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE \"blog_posts\" SET \"ViewCount\" = \"ViewCount\" + 1 WHERE \"Id\" = {post.Id}");
        }

        return post;
    }

    public async Task<BlogPost?> GetPostByIdAsync(int id)
    {
        return await _db.Set<BlogPost>()
            .Include(p => p.Author)
            .Include(p => p.Category)
            .FirstOrDefaultAsync(p => p.Id == id);
    }

    public async Task<(BlogPost? Post, string? Error)> CreatePostAsync(
        int authorId, string title, string content, string? excerpt,
        string? featuredImageUrl, int? categoryId, string? tags, bool publish,
        string? metaTitle = null, string? metaDescription = null, string? slug = null)
    {
        var generatedSlug = GenerateSlug(string.IsNullOrWhiteSpace(slug) ? title : slug);

        // Ensure unique slug
        var existing = await _db.Set<BlogPost>().AnyAsync(p => p.Slug == generatedSlug);
        if (existing)
            generatedSlug = $"{generatedSlug}-{DateTime.UtcNow.Ticks % 10000}";

        var post = new BlogPost
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            AuthorId = authorId,
            Title = title,
            Slug = generatedSlug,
            Content = content,
            Excerpt = excerpt,
            FeaturedImageUrl = featuredImageUrl,
            CategoryId = categoryId,
            Tags = tags,
            MetaTitle = metaTitle,
            MetaDescription = metaDescription,
            Status = publish ? "published" : "draft",
            PublishedAt = publish ? DateTime.UtcNow : null
        };

        _db.Set<BlogPost>().Add(post);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Blog post {PostId} created by user {UserId}", post.Id, authorId);
        return (post, null);
    }

    public async Task<(BlogPost? Post, string? Error)> UpdatePostAsync(
        int postId, string? title, string? content, string? excerpt,
        string? featuredImageUrl, int? categoryId, string? tags, string? status,
        string? metaTitle = null, string? metaDescription = null, string? slug = null)
    {
        var post = await _db.Set<BlogPost>().FirstOrDefaultAsync(x => x.Id == postId);
        if (post == null) return (null, "Post not found");

        if (title != null)
        {
            post.Title = title;
        }

        if (!string.IsNullOrWhiteSpace(slug))
        {
            var newSlug = GenerateSlug(slug);
            var slugExists = await _db.Set<BlogPost>().AnyAsync(p => p.Slug == newSlug && p.Id != postId);
            if (slugExists)
                newSlug = $"{newSlug}-{DateTime.UtcNow.Ticks % 10000}";
            post.Slug = newSlug;
        }
        else if (title != null)
        {
            var newSlug = GenerateSlug(title);
            var slugExists = await _db.Set<BlogPost>().AnyAsync(p => p.Slug == newSlug && p.Id != postId);
            if (slugExists)
                newSlug = $"{newSlug}-{DateTime.UtcNow.Ticks % 10000}";
            post.Slug = newSlug;
        }
        if (content != null) post.Content = content;
        if (excerpt != null) post.Excerpt = excerpt;
        if (featuredImageUrl != null) post.FeaturedImageUrl = featuredImageUrl;
        if (categoryId.HasValue) post.CategoryId = categoryId;
        if (tags != null) post.Tags = tags;
        if (metaTitle != null) post.MetaTitle = metaTitle;
        if (metaDescription != null) post.MetaDescription = metaDescription;

        if (status != null && status != post.Status)
        {
            post.Status = status;
            if (status == "published" && post.PublishedAt == null)
                post.PublishedAt = DateTime.UtcNow;
        }

        post.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (post, null);
    }

    public async Task<string?> DeletePostAsync(int postId)
    {
        var post = await _db.Set<BlogPost>().FirstOrDefaultAsync(x => x.Id == postId);
        if (post == null) return "Post not found";

        _db.Set<BlogPost>().Remove(post);
        await _db.SaveChangesAsync();
        return null;
    }

    public async Task<(BlogPost? Post, string? Error)> ToggleStatusAsync(int postId)
    {
        var post = await _db.Set<BlogPost>().FirstOrDefaultAsync(x => x.Id == postId);
        if (post == null) return (null, "Post not found");

        post.Status = post.Status == "published" ? "draft" : "published";
        if (post.Status == "published" && post.PublishedAt == null)
            post.PublishedAt = DateTime.UtcNow;

        post.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (post, null);
    }

    public async Task<(BlogPost? Post, string? Error)> ToggleFeaturedAsync(int postId)
    {
        var post = await _db.Set<BlogPost>().FirstOrDefaultAsync(x => x.Id == postId);
        if (post == null) return (null, "Post not found");

        post.IsFeatured = !post.IsFeatured;
        post.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (post, null);
    }

    // ── Categories ──────────────────────────────────────────

    public async Task<List<BlogCategory>> GetCategoriesAsync()
    {
        return await _db.Set<BlogCategory>()
            .OrderBy(c => c.SortOrder)
            .ThenBy(c => c.Name)
            .ToListAsync();
    }

    public async Task<(BlogCategory? Category, string? Error)> CreateCategoryAsync(
        string name, string? description, string? color)
    {
        var slug = GenerateSlug(name);
        var existing = await _db.Set<BlogCategory>().AnyAsync(c => c.Slug == slug);
        if (existing) return (null, "Category with this name already exists");

        var cat = new BlogCategory
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            Name = name,
            Slug = slug,
            Description = description,
            Color = color
        };

        _db.Set<BlogCategory>().Add(cat);
        await _db.SaveChangesAsync();
        return (cat, null);
    }

    public async Task<(BlogCategory? Category, string? Error)> UpdateCategoryAsync(
        int id, string? name, string? description, string? color)
    {
        var cat = await _db.Set<BlogCategory>().FirstOrDefaultAsync(x => x.Id == id);
        if (cat == null) return (null, "Category not found");

        if (name != null)
        {
            cat.Name = name;
            var newSlug = GenerateSlug(name);
            var slugExists = await _db.Set<BlogCategory>().AnyAsync(c => c.Slug == newSlug && c.Id != id);
            if (slugExists)
                return (null, "A category with this name already exists");
            cat.Slug = newSlug;
        }
        if (description != null) cat.Description = description;
        if (color != null) cat.Color = color;

        await _db.SaveChangesAsync();
        return (cat, null);
    }

    public async Task<string?> DeleteCategoryAsync(int id)
    {
        var cat = await _db.Set<BlogCategory>().FirstOrDefaultAsync(x => x.Id == id);
        if (cat == null) return "Category not found";

        // Unlink posts
        var posts = await _db.Set<BlogPost>().Where(p => p.CategoryId == id).ToListAsync();
        foreach (var p in posts) p.CategoryId = null;

        _db.Set<BlogCategory>().Remove(cat);
        await _db.SaveChangesAsync();
        return null;
    }

    // ── Helpers ──────────────────────────────────────────────

    private static string GenerateSlug(string title)
    {
        return System.Text.RegularExpressions.Regex
            .Replace(title.ToLower().Trim(), @"[^a-z0-9\s-]", "")
            .Replace(' ', '-')
            .Trim('-');
    }
}
