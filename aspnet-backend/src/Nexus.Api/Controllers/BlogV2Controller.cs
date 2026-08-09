// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;

namespace Nexus.Api.Controllers;

/// <summary>
/// Laravel React public blog API contract.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/v2/blog")]
public class BlogV2Controller : ControllerBase
{
    private readonly NexusDbContext _db;

    public BlogV2Controller(NexusDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<IActionResult> GetPosts(
        [FromQuery] int? category_id = null,
        [FromQuery] string? search = null,
        [FromQuery] string? cursor = null,
        [FromQuery(Name = "per_page")] int perPage = 12)
    {
        perPage = Math.Clamp(perPage, 1, 50);

        var query = _db.Set<Entities.BlogPost>()
            .AsNoTracking()
            .Include(p => p.Author)
            .Include(p => p.Category)
            .Where(p => p.Status == "published");

        if (category_id.HasValue)
        {
            query = query.Where(p => p.CategoryId == category_id.Value);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(p =>
                p.Title.ToLower().Contains(term) ||
                (p.Excerpt != null && p.Excerpt.ToLower().Contains(term)));
        }

        if (!string.IsNullOrWhiteSpace(cursor) && TryDecodeCursor(cursor, out var cursorId))
        {
            query = query.Where(p => p.Id < cursorId);
        }

        var rows = await query
            .OrderByDescending(p => p.CreatedAt)
            .Take(perPage + 1)
            .ToListAsync();

        var hasMore = rows.Count > perPage;
        if (hasMore)
        {
            rows.RemoveAt(rows.Count - 1);
        }

        var nextCursor = hasMore && rows.Count > 0 ? EncodeCursor(rows[^1].Id) : null;

        return Ok(new
        {
            success = true,
            data = rows.Select(p => MapPost(p, includeContent: false)),
            meta = new
            {
                base_url = BaseUrl(),
                per_page = perPage,
                has_more = hasMore,
                cursor = nextCursor
            }
        });
    }

    [HttpGet("categories")]
    public async Task<IActionResult> GetCategories()
    {
        var categories = await _db.Set<Entities.BlogCategory>()
            .AsNoTracking()
            .OrderBy(c => c.Name)
            .Select(c => new
            {
                id = c.Id,
                name = c.Name,
                slug = c.Slug,
                color = string.IsNullOrWhiteSpace(c.Color) ? "blue" : c.Color,
                post_count = c.Posts.Count(p => p.Status == "published")
            })
            .ToListAsync();

        return Ok(new { success = true, data = categories, meta = new { base_url = BaseUrl() } });
    }

    [HttpGet("{slug}")]
    public async Task<IActionResult> GetPost(string slug)
    {
        var post = await _db.Set<Entities.BlogPost>()
            .AsNoTracking()
            .Include(p => p.Author)
            .Include(p => p.Category)
            .FirstOrDefaultAsync(p => p.Slug == slug && p.Status == "published");

        if (post == null)
        {
            return NotFound(new
            {
                success = false,
                errors = new[] { new { code = "NOT_FOUND", message = "Blog post not found." } }
            });
        }

        return Ok(new { success = true, data = MapPost(post, includeContent: true), meta = new { base_url = BaseUrl() } });
    }

    private string BaseUrl() => $"{Request.Scheme}://{Request.Host}";

    private static string EncodeCursor(int id) =>
        Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(id.ToString()));

    private static bool TryDecodeCursor(string cursor, out int id)
    {
        id = 0;
        try
        {
            var decoded = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
            return int.TryParse(decoded, out id);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static object MapPost(Entities.BlogPost post, bool includeContent)
    {
        var content = post.Content ?? string.Empty;
        var wordCount = content
            .Split(new[] { ' ', '\r', '\n', '\t' }, StringSplitOptions.RemoveEmptyEntries)
            .Length;

        return new
        {
            id = post.Id,
            title = post.Title,
            slug = post.Slug,
            excerpt = post.Excerpt ?? string.Empty,
            content = includeContent ? content : null,
            featured_image = post.FeaturedImageUrl,
            published_at = post.CreatedAt,
            created_at = post.CreatedAt,
            updated_at = post.UpdatedAt,
            views = 0,
            reading_time = Math.Max(1, (int)Math.Ceiling(wordCount / 200.0)),
            meta_title = post.MetaTitle,
            meta_description = post.MetaDescription,
            meta_keywords = (string?)null,
            canonical_url = post.CanonicalUrl,
            og_image_url = post.OgImageUrl,
            noindex = false,
            author = post.Author == null
                ? new { id = 0, name = "Unknown", avatar = (string?)null }
                : new
                {
                    id = post.Author.Id,
                    name = $"{post.Author.FirstName} {post.Author.LastName}".Trim(),
                    avatar = post.Author.AvatarUrl
                },
            category = post.Category == null
                ? null
                : new
                {
                    id = post.Category.Id,
                    name = post.Category.Name,
                    color = string.IsNullOrWhiteSpace(post.Category.Color) ? "blue" : post.Category.Color
                }
        };
    }
}
