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
/// Admin endpoints for managing Meilisearch indexes.
/// </summary>
[ApiController]
[Route("api/admin/search")]
[Authorize(Policy = "AdminOnly")]
public class AdminSearchController : ControllerBase
{
    private readonly MeilisearchService _meilisearch;
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;

    public AdminSearchController(MeilisearchService meilisearch, NexusDbContext db, TenantContext tenant)
    {
        _meilisearch = meilisearch;
        _db = db;
        _tenant = tenant;
    }

    /// <summary>
    /// GET /api/admin/search/stats - Meilisearch stats and index info.
    /// </summary>
    [HttpGet("stats")]
    public async Task<IActionResult> GetStats()
    {
        var healthy = await _meilisearch.IsHealthyAsync();
        var stats = await _meilisearch.GetStatsAsync();

        return Ok(new
        {
            data = new
            {
                enabled = _meilisearch.IsEnabled,
                healthy,
                database_size_bytes = stats?.DatabaseSize,
                indexes = stats?.Indexes?.ToDictionary(
                    i => i.Key,
                    i => new { document_count = i.Value.NumberOfDocuments, is_indexing = i.Value.IsIndexing })
            }
        });
    }

    /// <summary>
    /// POST /api/admin/search/reindex - Trigger full reindex for current tenant.
    /// </summary>
    [HttpPost("reindex")]
    public async Task<IActionResult> Reindex()
    {
        if (!_meilisearch.IsEnabled)
            return BadRequest(new { error = "Meilisearch is not enabled" });

        await _meilisearch.ReindexTenantAsync(_db, _tenant.GetTenantIdOrThrow());
        return Ok(new { message = $"Reindex triggered for tenant {_tenant.GetTenantIdOrThrow()}" });
    }

    /// <summary>
    /// POST /api/admin/search/reindex/{type} - Reindex a specific type.
    /// </summary>
    [HttpPost("reindex/{type}")]
    public async Task<IActionResult> ReindexType(string type)
    {
        if (!_meilisearch.IsEnabled)
            return BadRequest(new { error = "Meilisearch is not enabled" });

        var validTypes = new[] { "listings", "users", "groups", "events", "kb", "jobs" };
        if (!validTypes.Contains(type))
            return BadRequest(new { error = $"Invalid type. Must be one of: {string.Join(", ", validTypes)}" });

        // Reindex just the specified type by calling the full reindex
        // (individual type reindex would be more efficient but this keeps it simple)
        await _meilisearch.ReindexTenantAsync(_db, _tenant.GetTenantIdOrThrow());
        return Ok(new { message = $"Reindex of '{type}' triggered for tenant {_tenant.GetTenantIdOrThrow()}" });
    }
}
