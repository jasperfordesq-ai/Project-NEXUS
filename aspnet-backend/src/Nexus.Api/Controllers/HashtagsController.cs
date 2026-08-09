// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Hashtags controller - trending hashtags, search, and content discovery by tag.
/// </summary>
[ApiController]
[Route("api/hashtags")]
[Authorize]
public class HashtagsController : ControllerBase
{
    private readonly HashtagService _hashtagService;
    private readonly TenantContext _tenant;
    private readonly ILogger<HashtagsController> _logger;

    public HashtagsController(
        HashtagService hashtagService,
        TenantContext tenant,
        ILogger<HashtagsController> logger)
    {
        _hashtagService = hashtagService;
        _tenant = tenant;
        _logger = logger;
    }

    // --- Endpoints ---

    /// <summary>
    /// GET /api/hashtags/trending - Get trending hashtags.
    /// </summary>
    [HttpGet("trending")]
    public async Task<IActionResult> GetTrending(
        [FromQuery] int limit = 20,
        [FromQuery] int days = 7)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        limit = Math.Clamp(limit, 1, 100);
        days = Math.Clamp(days, 1, 365);

        var hashtags = await _hashtagService.GetTrendingAsync(tenantId, limit, days);

        var data = hashtags.Select(h => new
        {
            tag = h.Tag,
            usage_count = h.UsageCount,
            trend_score = h.TrendScore
        });

        return Ok(new { data });
    }

    /// <summary>
    /// GET /api/hashtags/search - Search hashtags.
    /// </summary>
    [HttpGet("search")]
    public async Task<IActionResult> Search(
        [FromQuery] string? q = null,
        [FromQuery] int limit = 20)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        limit = Math.Clamp(limit, 1, 100);

        if (string.IsNullOrWhiteSpace(q))
            return BadRequest(new { error = "q parameter is required" });

        var hashtags = await _hashtagService.SearchAsync(tenantId, q, limit);

        var data = hashtags.Select(h => new
        {
            tag = h.Tag,
            usage_count = h.UsageCount
        });

        return Ok(new { data });
    }

    /// <summary>
    /// GET /api/hashtags/{tag} - Get single hashtag details.
    /// </summary>
    [HttpGet("{tag}")]
    public async Task<IActionResult> GetByTag(string tag)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();

        var (hashtag, error) = await _hashtagService.GetByTagAsync(tenantId, tag);

        if (error != null)
            return NotFound(new { error });

        return Ok(new
        {
            tag = hashtag!.Tag,
            usage_count = hashtag.UsageCount,
            created_at = hashtag.CreatedAt,
            last_used_at = hashtag.LastUsedAt
        });
    }

    /// <summary>
    /// GET /api/hashtags/{tag}/content - Get content by hashtag.
    /// </summary>
    [HttpGet("{tag}/content")]
    public async Task<IActionResult> GetContentByTag(
        string tag,
        [FromQuery] string? target_type = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);

        var (items, total, error) = await _hashtagService.GetContentByTagAsync(
            tenantId, tag, target_type, page, limit);

        if (error != null)
            return NotFound(new { error });

        var data = items!.Select(i => new
        {
            id = i.Id,
            target_type = i.TargetType,
            target_id = i.TargetId,
            title = i.Title,
            created_at = i.CreatedAt
        });

        return Ok(new
        {
            data,
            pagination = new
            {
                page,
                limit,
                total,
                pages = (int)Math.Ceiling((double)total / limit)
            }
        });
    }
}
