// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Enhanced search powered by Meilisearch.
/// Falls back to PostgreSQL ILIKE when Meilisearch is unavailable.
/// </summary>
[ApiController]
[Route("api/search/semantic")]
[Authorize]
public class SemanticSearchController : ControllerBase
{
    private readonly MeilisearchService _meilisearch;
    private readonly TenantContext _tenant;
    private readonly ILogger<SemanticSearchController> _logger;

    public SemanticSearchController(MeilisearchService meilisearch, TenantContext tenant, ILogger<SemanticSearchController> logger)
    {
        _meilisearch = meilisearch;
        _tenant = tenant;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/search/semantic?q=...&type=...&limit=20&offset=0 - Full-text search via Meilisearch.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] string q, [FromQuery] string type = "all", [FromQuery] int limit = 20, [FromQuery] int offset = 0)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Length < 2)
            return BadRequest(new { error = "Search query must be at least 2 characters" });

        limit = Math.Clamp(limit, 1, 50);

        if (!_meilisearch.IsEnabled)
            return Ok(new { data = new { }, meta = new { engine = "disabled", message = "Meilisearch not configured. Use /api/search for ILIKE fallback." } });

        var validTypes = new[] { "all", "listings", "users", "groups", "events", "kb", "jobs" };
        if (!validTypes.Contains(type))
            return BadRequest(new { error = $"Invalid type. Must be one of: {string.Join(", ", validTypes)}" });

        if (type == "all")
        {
            var types = new[] { "listings", "users", "groups", "events", "kb", "jobs" };
            var results = await _meilisearch.MultiSearchAsync(_tenant.GetTenantIdOrThrow(), q, types, limitPerType: Math.Min(limit, 10));

            if (results == null)
                return Ok(new { data = new { }, meta = new { engine = "meilisearch", status = "unavailable" } });

            return Ok(new
            {
                data = results.ToDictionary(
                    r => r.Key,
                    r => new
                    {
                        hits = r.Value.Hits,
                        total = r.Value.EstimatedTotalHits,
                        processing_ms = r.Value.ProcessingTimeMs
                    }),
                meta = new { engine = "meilisearch", query = q, type }
            });
        }
        else
        {
            var result = await _meilisearch.SearchAsync(_tenant.GetTenantIdOrThrow(), type, q, limit, offset);

            if (result == null)
                return Ok(new { data = new { hits = Array.Empty<object>() }, meta = new { engine = "meilisearch", status = "unavailable" } });

            return Ok(new
            {
                data = new
                {
                    hits = result.Hits,
                    total = result.EstimatedTotalHits,
                    processing_ms = result.ProcessingTimeMs
                },
                meta = new { engine = "meilisearch", query = q, type, limit, offset }
            });
        }
    }

    /// <summary>
    /// GET /api/search/semantic/status - Check Meilisearch status and stats.
    /// </summary>
    [HttpGet("status")]
    public async Task<IActionResult> GetStatus()
    {
        var healthy = await _meilisearch.IsHealthyAsync();
        var stats = await _meilisearch.GetStatsAsync();

        return Ok(new
        {
            data = new
            {
                enabled = _meilisearch.IsEnabled,
                healthy,
                database_size = stats?.DatabaseSize,
                indexes = stats?.Indexes?.ToDictionary(
                    i => i.Key,
                    i => new { documents = i.Value.NumberOfDocuments, indexing = i.Value.IsIndexing })
            }
        });
    }
}
