// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Knowledge base controller - public-facing article endpoints.
/// Provides read access to published help articles.
/// </summary>
[ApiController]
[Route("api/knowledge")]
[Authorize]
public class KnowledgeBaseController : ControllerBase
{
    private readonly KnowledgeBaseService _knowledgeBase;
    private readonly ILogger<KnowledgeBaseController> _logger;

    public KnowledgeBaseController(
        KnowledgeBaseService knowledgeBase,
        ILogger<KnowledgeBaseController> logger)
    {
        _knowledgeBase = knowledgeBase;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/knowledge/articles - List published articles.
    /// Optional query params: ?category=&amp;search=
    /// </summary>
    [HttpGet("articles")]
    public async Task<IActionResult> GetArticles(
        [FromQuery] string? category = null,
        [FromQuery] string? search = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var articles = await _knowledgeBase.GetArticlesAsync(category, search);

        return Ok(new
        {
            data = articles.Select(a => new
            {
                a.Id,
                a.Title,
                a.Slug,
                a.Category,
                a.Tags,
                a.SortOrder,
                a.ViewCount,
                a.CreatedAt,
                a.UpdatedAt
            })
        });
    }

    /// <summary>
    /// GET /api/knowledge/articles/{slug} - Get article by slug.
    /// Increments the view count.
    /// </summary>
    [HttpGet("articles/{slug}")]
    public async Task<IActionResult> GetArticleBySlug(string slug)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var article = await _knowledgeBase.GetArticleBySlugAsync(slug);
        if (article == null)
        {
            return NotFound(new { error = "Article not found" });
        }

        return Ok(new
        {
            article.Id,
            article.Title,
            article.Slug,
            article.Content,
            article.Category,
            article.Tags,
            article.SortOrder,
            article.ViewCount,
            article.CreatedAt,
            article.UpdatedAt,
            created_by = article.CreatedBy != null
                ? new { article.CreatedBy.Id, article.CreatedBy.FirstName, article.CreatedBy.LastName }
                : null
        });
    }

    /// <summary>
    /// GET /api/knowledge/categories - List categories with article counts.
    /// </summary>
    [HttpGet("categories")]
    public async Task<IActionResult> GetCategories()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var categories = await _knowledgeBase.GetCategoriesAsync();

        return Ok(new
        {
            data = categories.Select(c => new
            {
                name = c.Name,
                article_count = c.ArticleCount
            })
        });
    }
}

/// <summary>
/// Knowledge base admin controller - article management endpoints.
/// Requires admin role for all operations.
/// </summary>
[ApiController]
[Route("api/admin/knowledge")]
[Authorize(Policy = "AdminOnly")]
public class KnowledgeBaseAdminController : ControllerBase
{
    private readonly KnowledgeBaseService _knowledgeBase;
    private readonly ILogger<KnowledgeBaseAdminController> _logger;

    public KnowledgeBaseAdminController(
        KnowledgeBaseService knowledgeBase,
        ILogger<KnowledgeBaseAdminController> logger)
    {
        _knowledgeBase = knowledgeBase;
        _logger = logger;
    }

    /// <summary>
    /// POST /api/admin/knowledge/articles - Create a new article.
    /// </summary>
    [HttpPost("articles")]
    public async Task<IActionResult> CreateArticle([FromBody] CreateKnowledgeArticleRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.Title))
            return BadRequest(new { error = "Title is required" });

        if (string.IsNullOrWhiteSpace(request.Slug))
            return BadRequest(new { error = "Slug is required" });

        if (string.IsNullOrWhiteSpace(request.Content))
            return BadRequest(new { error = "Content is required" });

        if (request.Title.Length > 500)
            return BadRequest(new { error = "Title cannot exceed 500 characters" });

        if (request.Slug.Length > 200)
            return BadRequest(new { error = "Slug cannot exceed 200 characters" });

        try
        {
            var article = await _knowledgeBase.CreateArticleAsync(
                userId.Value,
                request.Title,
                request.Slug,
                request.Content,
                request.Category,
                request.Tags,
                request.IsPublished);

            _logger.LogInformation("Admin {UserId} created knowledge article {ArticleId}", userId, article.Id);

            return CreatedAtAction(
                nameof(KnowledgeBaseController.GetArticleBySlug),
                "KnowledgeBase",
                new { slug = article.Slug },
                new
                {
                    success = true,
                    message = "Article created",
                    article = new
                    {
                        article.Id,
                        article.Title,
                        article.Slug,
                        article.Content,
                        article.Category,
                        article.Tags,
                        article.IsPublished,
                        article.SortOrder,
                        article.ViewCount,
                        article.CreatedAt
                    }
                });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }

    /// <summary>
    /// PUT /api/admin/knowledge/articles/{id} - Update an article.
    /// </summary>
    [HttpPut("articles/{id:int}")]
    public async Task<IActionResult> UpdateArticle(int id, [FromBody] UpdateKnowledgeArticleRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var article = await _knowledgeBase.UpdateArticleAsync(
            id,
            request.Title,
            request.Content,
            request.Category,
            request.Tags,
            request.IsPublished,
            request.SortOrder);

        if (article == null)
        {
            return NotFound(new { error = "Article not found" });
        }

        _logger.LogInformation("Admin {UserId} updated knowledge article {ArticleId}", userId, id);

        return Ok(new
        {
            success = true,
            message = "Article updated",
            article = new
            {
                article.Id,
                article.Title,
                article.Slug,
                article.Content,
                article.Category,
                article.Tags,
                article.IsPublished,
                article.SortOrder,
                article.ViewCount,
                article.CreatedAt,
                article.UpdatedAt
            }
        });
    }

    /// <summary>
    /// DELETE /api/admin/knowledge/articles/{id} - Delete an article.
    /// </summary>
    [HttpDelete("articles/{id:int}")]
    public async Task<IActionResult> DeleteArticle(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var deleted = await _knowledgeBase.DeleteArticleAsync(id);
        if (!deleted)
        {
            return NotFound(new { error = "Article not found" });
        }

        _logger.LogInformation("Admin {UserId} deleted knowledge article {ArticleId}", userId, id);

        return Ok(new
        {
            success = true,
            message = "Article deleted"
        });
    }
}

public class CreateKnowledgeArticleRequest
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("slug")]
    public string Slug { get; set; } = string.Empty;

    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;

    [JsonPropertyName("category")]
    public string? Category { get; set; }

    [JsonPropertyName("tags")]
    public string? Tags { get; set; }

    [JsonPropertyName("is_published")]
    public bool IsPublished { get; set; } = false;
}

public class UpdateKnowledgeArticleRequest
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("content")]
    public string? Content { get; set; }

    [JsonPropertyName("category")]
    public string? Category { get; set; }

    [JsonPropertyName("tags")]
    public string? Tags { get; set; }

    [JsonPropertyName("is_published")]
    public bool? IsPublished { get; set; }

    [JsonPropertyName("sort_order")]
    public int? SortOrder { get; set; }
}
