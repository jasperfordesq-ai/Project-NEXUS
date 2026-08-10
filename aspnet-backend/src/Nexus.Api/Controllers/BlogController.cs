// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Public blog endpoints for reading published posts and categories.
/// </summary>
[ApiController]
[Route("api/blog")]
[Authorize]
public class BlogController : ControllerBase
{
    private readonly BlogService _blog;

    public BlogController(BlogService blog)
    {
        _blog = blog;
    }

    /// <summary>
    /// GET /api/blog - List published blog posts.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetPosts(
        [FromQuery] int? category_id = null,
        [FromQuery] string? tag = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var posts = await _blog.GetPublishedPostsAsync(category_id, tag, page, limit);
        var total = await _blog.CountPublishedPostsAsync(category_id, tag);

        return Ok(new
        {
            data = posts.Select(p => MapPost(p)),
            meta = new { page, limit, total }
        });
    }

    /// <summary>
    /// GET /api/blog/categories - List blog categories.
    /// </summary>
    [HttpGet("categories")]
    public async Task<IActionResult> GetCategories()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

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
                c.SortOrder
            })
        });
    }

    /// <summary>
    /// GET /api/blog/{slug} - Get a published blog post by slug.
    /// </summary>
    [HttpGet("{slug}")]
    public async Task<IActionResult> GetPost(string slug)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var post = await _blog.GetPostBySlugAsync(slug);
        if (post == null) return NotFound(new { error = "Post not found" });

        return Ok(new { data = MapPost(post) });
    }

    private static object MapPost(Entities.BlogPost p) => new
    {
        p.Id,
        p.Title,
        p.Slug,
        p.Content,
        p.Excerpt,
        featured_image_url = p.FeaturedImageUrl,
        p.Status,
        p.Tags,
        is_featured = p.IsFeatured,
        view_count = p.ViewCount,
        published_at = p.PublishedAt,
        created_at = p.CreatedAt,
        updated_at = p.UpdatedAt,
        category = p.Category != null ? new { p.Category.Id, p.Category.Name, p.Category.Slug, p.Category.Color } : null,
        author = p.Author != null ? new { p.Author.Id, p.Author.FirstName, p.Author.LastName } : null,
        meta_title = p.MetaTitle,
        meta_description = p.MetaDescription
    };
}
