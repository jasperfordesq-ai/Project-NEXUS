// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin blog management endpoints - CRUD for posts and categories.
/// </summary>
[ApiController]
[Route("api/admin/blog")]
[Route("api/v2/admin/blog")]
[Authorize(Policy = "AdminOnly")]
public class AdminBlogController : ControllerBase
{
    private readonly BlogService _blog;
    private readonly NexusDbContext _db;
    private const string BlogSeoNoIndexKeyPrefix = "admin_blog.seo.noindex.";

    public AdminBlogController(BlogService blog, NexusDbContext db)
    {
        _blog = blog;
        _db = db;
    }

    /// <summary>
    /// GET /api/admin/blog - List all blog posts (including drafts) with pagination.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> ListPosts(
        [FromQuery] string? status = null,
        [FromQuery] string? search = null,
        [FromQuery] int? category_id = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var query = _db.Set<Entities.BlogPost>()
            .Include(p => p.Author)
            .Include(p => p.Category)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(status) &&
            (status.Equals("draft", StringComparison.OrdinalIgnoreCase) ||
             status.Equals("published", StringComparison.OrdinalIgnoreCase)))
        {
            status = status.ToLowerInvariant();
            query = query.Where(p => p.Status == status);
        }

        if (category_id.HasValue)
            query = query.Where(p => p.CategoryId == category_id.Value);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLower();
            query = query.Where(p =>
                p.Title.ToLower().Contains(s) ||
                p.Content.ToLower().Contains(s));
        }

        var total = await query.CountAsync();
        var totalPages = total > 0 ? (int)Math.Ceiling(total / (double)limit) : 0;

        var posts = await query
            .AsNoTracking()
            .OrderByDescending(p => p.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(p => new
            {
                id = p.Id,
                title = p.Title,
                slug = p.Slug,
                excerpt = p.Excerpt ?? string.Empty,
                status = p.Status,
                featured_image = p.FeaturedImageUrl,
                author_id = p.AuthorId,
                author_name = p.Author == null
                    ? string.Empty
                    : (p.Author.FirstName + " " + p.Author.LastName).Trim(),
                category_id = p.CategoryId,
                category_name = p.Category == null ? null : p.Category.Name,
                created_at = p.CreatedAt,
                updated_at = p.UpdatedAt
            })
            .ToListAsync();

        return Ok(new
        {
            data = posts,
            meta = new
            {
                base_url = $"{Request.Scheme}://{Request.Host}",
                current_page = page,
                per_page = limit,
                total,
                total_pages = totalPages,
                has_more = page < totalPages
            }
        });
    }

    /// <summary>
    /// GET /api/admin/blog/{id} - Get a single blog post by ID (including drafts).
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetPost(int id)
    {
        var post = await _blog.GetPostByIdAsync(id);
        if (post == null)
        {
            return NotFound(new
            {
                success = false,
                errors = new[] { new { code = "RESOURCE_NOT_FOUND", message = "Blog post not found." } }
            });
        }

        return Ok(new { success = true, data = await FormatAdminBlogPost(post, includeContent: true) });
    }

    /// <summary>
    /// POST /api/admin/blog - Create a blog post.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> CreatePost([FromBody] CreateBlogPostRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (post, error) = await _blog.CreatePostAsync(
            userId.Value, request.Title, request.Content, request.Excerpt,
            request.FeaturedImage ?? request.FeaturedImageUrl,
            request.CategoryId,
            request.Tags,
            request.IsPublished,
            request.MetaTitle,
            request.MetaDescription,
            request.Slug);

        if (error != null)
        {
            return BadRequest(new
            {
                success = false,
                errors = new[] { new { code = "VALIDATION_ERROR", message = error } }
            });
        }

        if (request.NoIndex.HasValue)
        {
            await SaveBlogNoIndex(post!.Id, request.NoIndex.Value);
        }

        var formatted = await FormatAdminBlogPost(post!, includeContent: false);
        return Created($"/api/v2/admin/blog/{post!.Id}", new { success = true, data = formatted });
    }

    /// <summary>
    /// PUT /api/admin/blog/{id} - Update a blog post.
    /// </summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> UpdatePost(int id, [FromBody] UpdateBlogPostRequest request)
    {
        var (post, error) = await _blog.UpdatePostAsync(
            id, request.Title, request.Content, request.Excerpt,
            request.FeaturedImage ?? request.FeaturedImageUrl,
            request.CategoryId,
            request.Tags,
            request.Status,
            request.MetaTitle,
            request.MetaDescription,
            request.Slug);

        if (error != null)
        {
            return NotFound(new
            {
                success = false,
                errors = new[] { new { code = "RESOURCE_NOT_FOUND", message = error } }
            });
        }

        if (request.NoIndex.HasValue)
        {
            await SaveBlogNoIndex(post!.Id, request.NoIndex.Value);
        }

        var formatted = await FormatAdminBlogPost(post!, includeContent: true);
        return Ok(new { success = true, data = formatted });
    }

    /// <summary>
    /// DELETE /api/admin/blog/{id} - Delete a blog post.
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> DeletePost(int id)
    {
        var error = await _blog.DeletePostAsync(id);
        if (error != null)
        {
            return NotFound(new
            {
                success = false,
                errors = new[] { new { code = "RESOURCE_NOT_FOUND", message = error } }
            });
        }

        await DeleteBlogNoIndex(id);
        return Ok(new { success = true, data = new { deleted = true, id } });
    }

    /// <summary>
    /// POST /api/admin/blog/{id}/toggle-status - Toggle draft/published.
    /// </summary>
    [HttpPost("{id:int}/toggle-status")]
    public async Task<IActionResult> ToggleStatus(int id)
    {
        var (post, error) = await _blog.ToggleStatusAsync(id);
        if (error != null)
        {
            return NotFound(new
            {
                success = false,
                errors = new[] { new { code = "RESOURCE_NOT_FOUND", message = error } }
            });
        }

        return Ok(new { success = true, data = new { id = post!.Id, status = post.Status } });
    }

    /// <summary>
    /// POST /api/admin/blog/{id}/toggle-featured - Toggle featured flag.
    /// </summary>
    [HttpPost("{id:int}/toggle-featured")]
    public async Task<IActionResult> ToggleFeatured(int id)
    {
        var (post, error) = await _blog.ToggleFeaturedAsync(id);
        if (error != null) return NotFound(new { error });
        return Ok(new { data = new { post!.Id, is_featured = post.IsFeatured } });
    }

    /// <summary>
    /// GET /api/admin/blog/categories - List blog categories.
    /// </summary>
    [HttpGet("categories")]
    public async Task<IActionResult> ListCategories()
    {
        var categories = await _blog.GetCategoriesAsync();

        return Ok(new
        {
            data = categories.Select(c => new
            {
                c.Id,
                c.Name,
                c.Slug,
                c.Description,
                c.Color,
                sort_order = c.SortOrder,
                created_at = c.CreatedAt
            })
        });
    }

    /// <summary>
    /// POST /api/admin/blog/categories - Create a category.
    /// </summary>
    [HttpPost("categories")]
    public async Task<IActionResult> CreateCategory([FromBody] CreateBlogCategoryRequest request)
    {
        var (cat, error) = await _blog.CreateCategoryAsync(request.Name, request.Description, request.Color);
        if (error != null) return BadRequest(new { error });
        return Created($"/api/blog/categories", new { data = new { cat!.Id, cat.Name, cat.Slug } });
    }

    /// <summary>
    /// PUT /api/admin/blog/categories/{id} - Update a category.
    /// </summary>
    [HttpPut("categories/{id:int}")]
    public async Task<IActionResult> UpdateCategory(int id, [FromBody] UpdateBlogCategoryRequest request)
    {
        var (cat, error) = await _blog.UpdateCategoryAsync(id, request.Name, request.Description, request.Color);
        if (error != null) return NotFound(new { error });
        return Ok(new { data = new { cat!.Id, cat.Name, cat.Slug } });
    }

    /// <summary>
    /// DELETE /api/admin/blog/categories/{id} - Delete a category.
    /// </summary>
    [HttpDelete("categories/{id:int}")]
    public async Task<IActionResult> DeleteCategory(int id)
    {
        var error = await _blog.DeleteCategoryAsync(id);
        if (error != null) return NotFound(new { error });
        return Ok(new { message = "Category deleted" });
    }

    private async Task<object> FormatAdminBlogPost(Entities.BlogPost post, bool includeContent)
    {
        var noIndex = await GetBlogNoIndex(post.Id);
        var authorName = post.Author == null
            ? null
            : string.Join(" ", new[] { post.Author.FirstName, post.Author.LastName }.Where(s => !string.IsNullOrWhiteSpace(s))).Trim();

        return new
        {
            id = post.Id,
            title = post.Title,
            slug = post.Slug,
            content = includeContent ? post.Content : null,
            excerpt = post.Excerpt ?? string.Empty,
            status = post.Status,
            featured_image = string.IsNullOrWhiteSpace(post.FeaturedImageUrl) ? null : post.FeaturedImageUrl,
            author_id = post.AuthorId,
            author_name = string.IsNullOrWhiteSpace(authorName) ? null : authorName,
            category_id = post.CategoryId,
            category_name = post.Category?.Name,
            meta_title = post.MetaTitle,
            meta_description = post.MetaDescription,
            noindex = noIndex,
            created_at = post.CreatedAt,
            updated_at = post.UpdatedAt
        };
    }

    private async Task SaveBlogNoIndex(int postId, bool noIndex)
    {
        var tenantId = User.GetTenantId();
        if (tenantId == null) return;

        var key = BlogSeoNoIndexKey(postId);
        var row = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.TenantId == tenantId.Value && c.Key == key);
        if (row == null)
        {
            _db.TenantConfigs.Add(new Entities.TenantConfig
            {
                TenantId = tenantId.Value,
                Key = key,
                Value = noIndex ? "true" : "false",
                CreatedAt = DateTime.UtcNow
            });
        }
        else
        {
            row.Value = noIndex ? "true" : "false";
            row.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
    }

    private async Task<bool> GetBlogNoIndex(int postId)
    {
        var tenantId = User.GetTenantId();
        if (tenantId == null) return false;

        var key = BlogSeoNoIndexKey(postId);
        var value = await _db.TenantConfigs
            .Where(c => c.TenantId == tenantId.Value && c.Key == key)
            .Select(c => c.Value)
            .FirstOrDefaultAsync();

        return bool.TryParse(value, out var parsed) && parsed;
    }

    private async Task DeleteBlogNoIndex(int postId)
    {
        var tenantId = User.GetTenantId();
        if (tenantId == null) return;

        var key = BlogSeoNoIndexKey(postId);
        var row = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.TenantId == tenantId.Value && c.Key == key);
        if (row == null) return;

        _db.TenantConfigs.Remove(row);
        await _db.SaveChangesAsync();
    }

    private static string BlogSeoNoIndexKey(int postId) => BlogSeoNoIndexKeyPrefix + postId;
}

public class CreateBlogPostRequest
{
    [JsonPropertyName("title"), MaxLength(200)]
    public string Title { get; set; } = string.Empty;
    [JsonPropertyName("slug"), MaxLength(500)]
    public string? Slug { get; set; }
    [JsonPropertyName("content"), MaxLength(50000)]
    public string Content { get; set; } = string.Empty;
    [JsonPropertyName("excerpt"), MaxLength(500)]
    public string? Excerpt { get; set; }
    [JsonPropertyName("featured_image_url"), MaxLength(2000)]
    public string? FeaturedImageUrl { get; set; }
    [JsonPropertyName("featured_image"), MaxLength(2000)]
    public string? FeaturedImage { get; set; }
    [JsonPropertyName("category_id")]
    public int? CategoryId { get; set; }
    [JsonPropertyName("tags"), MaxLength(1000)]
    public string? Tags { get; set; }
    [JsonPropertyName("publish")]
    public bool Publish { get; set; } = false;
    [JsonPropertyName("status"), MaxLength(50)]
    public string? Status { get; set; }
    [JsonPropertyName("meta_title"), MaxLength(200)]
    public string? MetaTitle { get; set; }
    [JsonPropertyName("meta_description"), MaxLength(500)]
    public string? MetaDescription { get; set; }
    [JsonPropertyName("noindex")]
    public bool? NoIndex { get; set; }

    [JsonIgnore]
    public bool IsPublished => Publish || string.Equals(Status, "published", StringComparison.OrdinalIgnoreCase);
}

public class UpdateBlogPostRequest
{
    [JsonPropertyName("title"), MaxLength(200)]
    public string? Title { get; set; }
    [JsonPropertyName("slug"), MaxLength(500)]
    public string? Slug { get; set; }
    [JsonPropertyName("content"), MaxLength(50000)]
    public string? Content { get; set; }
    [JsonPropertyName("excerpt"), MaxLength(500)]
    public string? Excerpt { get; set; }
    [JsonPropertyName("featured_image_url"), MaxLength(2000)]
    public string? FeaturedImageUrl { get; set; }
    [JsonPropertyName("featured_image"), MaxLength(2000)]
    public string? FeaturedImage { get; set; }
    [JsonPropertyName("category_id")]
    public int? CategoryId { get; set; }
    [JsonPropertyName("tags"), MaxLength(1000)]
    public string? Tags { get; set; }
    [JsonPropertyName("status"), MaxLength(50)]
    public string? Status { get; set; }
    [JsonPropertyName("meta_title"), MaxLength(200)]
    public string? MetaTitle { get; set; }
    [JsonPropertyName("meta_description"), MaxLength(500)]
    public string? MetaDescription { get; set; }
    [JsonPropertyName("noindex")]
    public bool? NoIndex { get; set; }
}

public class CreateBlogCategoryRequest
{
    [JsonPropertyName("name"), MaxLength(100)]
    public string Name { get; set; } = string.Empty;
    [JsonPropertyName("description"), MaxLength(500)]
    public string? Description { get; set; }
    [JsonPropertyName("color"), MaxLength(20)]
    public string? Color { get; set; }
}

public class UpdateBlogCategoryRequest
{
    [JsonPropertyName("name"), MaxLength(100)]
    public string? Name { get; set; }
    [JsonPropertyName("description"), MaxLength(500)]
    public string? Description { get; set; }
    [JsonPropertyName("color"), MaxLength(20)]
    public string? Color { get; set; }
}
