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
/// Saved searches controller - persist, manage, and re-run search queries with optional notifications.
/// </summary>
[ApiController]
[Route("api/saved-searches")]
[Authorize]
public class SavedSearchesController : ControllerBase
{
    private readonly SavedSearchService _savedSearchService;
    private readonly TenantContext _tenant;
    private readonly ILogger<SavedSearchesController> _logger;

    public SavedSearchesController(
        SavedSearchService savedSearchService,
        TenantContext tenant,
        ILogger<SavedSearchesController> logger)
    {
        _savedSearchService = savedSearchService;
        _tenant = tenant;
        _logger = logger;
    }

    // --- DTOs ---

    public class CreateSavedSearchRequest
    {
        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("search_type")]
        public string SearchType { get; set; } = string.Empty;

        [JsonPropertyName("query_json")]
        public string QueryJson { get; set; } = string.Empty;

        [JsonPropertyName("notify_on_new_results")]
        public bool NotifyOnNewResults { get; set; }
    }

    public class UpdateSavedSearchRequest
    {
        [JsonPropertyName("name")]
        public string? Name { get; set; }

        [JsonPropertyName("query_json")]
        public string? QueryJson { get; set; }

        [JsonPropertyName("notify_on_new_results")]
        public bool? NotifyOnNewResults { get; set; }
    }

    public class RunSearchRequest
    {
        [JsonPropertyName("result_count")]
        public int ResultCount { get; set; }
    }

    // --- Endpoints ---

    /// <summary>
    /// GET /api/saved-searches - List saved searches.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenant.GetTenantIdOrThrow();

        var searches = await _savedSearchService.ListAsync(tenantId, userId.Value);

        var data = searches.Select(s => new
        {
            id = s.Id,
            name = s.Name,
            search_type = s.SearchType,
            query_json = s.QueryJson,
            notify_on_new_results = s.NotifyOnNewResults,
            last_run_at = s.LastRunAt,
            last_result_count = s.LastResultCount,
            created_at = s.CreatedAt,
            updated_at = s.UpdatedAt
        });

        return Ok(new { data });
    }

    /// <summary>
    /// GET /api/saved-searches/{id} - Get single saved search.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenant.GetTenantIdOrThrow();

        var (search, error) = await _savedSearchService.GetByIdAsync(tenantId, userId.Value, id);

        if (error != null)
            return NotFound(new { error });

        return Ok(new
        {
            id = search!.Id,
            name = search.Name,
            search_type = search.SearchType,
            query_json = search.QueryJson,
            notify_on_new_results = search.NotifyOnNewResults,
            last_run_at = search.LastRunAt,
            last_result_count = search.LastResultCount,
            created_at = search.CreatedAt,
            updated_at = search.UpdatedAt
        });
    }

    /// <summary>
    /// POST /api/saved-searches - Create saved search.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateSavedSearchRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenant.GetTenantIdOrThrow();

        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "name is required" });
        if (string.IsNullOrWhiteSpace(request.SearchType))
            return BadRequest(new { error = "search_type is required" });
        if (string.IsNullOrWhiteSpace(request.QueryJson))
            return BadRequest(new { error = "query_json is required" });

        var (search, error) = await _savedSearchService.CreateAsync(
            tenantId, userId.Value, request.Name, request.SearchType,
            request.QueryJson, request.NotifyOnNewResults);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            id = search!.Id,
            name = search.Name,
            search_type = search.SearchType,
            query_json = search.QueryJson,
            notify_on_new_results = search.NotifyOnNewResults,
            created_at = search.CreatedAt
        });
    }

    /// <summary>
    /// PUT /api/saved-searches/{id} - Update saved search.
    /// </summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateSavedSearchRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenant.GetTenantIdOrThrow();

        var (search, error) = await _savedSearchService.UpdateAsync(
            tenantId, userId.Value, id, request.Name, request.QueryJson, request.NotifyOnNewResults);

        if (error != null)
            return NotFound(new { error });

        return Ok(new
        {
            id = search!.Id,
            name = search.Name,
            search_type = search.SearchType,
            query_json = search.QueryJson,
            notify_on_new_results = search.NotifyOnNewResults,
            updated_at = search.UpdatedAt
        });
    }

    /// <summary>
    /// DELETE /api/saved-searches/{id} - Delete saved search.
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenant.GetTenantIdOrThrow();

        var error = await _savedSearchService.DeleteAsync(tenantId, userId.Value, id);

        if (error != null)
            return NotFound(new { error });

        return Ok(new { message = "Saved search deleted" });
    }

    /// <summary>
    /// POST /api/saved-searches/{id}/run - Mark search as run.
    /// </summary>
    [HttpPost("{id:int}/run")]
    public async Task<IActionResult> MarkAsRun(int id, [FromBody] RunSearchRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenant.GetTenantIdOrThrow();

        var (search, error) = await _savedSearchService.MarkAsRunAsync(
            tenantId, userId.Value, id, request.ResultCount);

        if (error != null)
            return NotFound(new { error });

        return Ok(new
        {
            id = search!.Id,
            last_run_at = search.LastRunAt,
            last_result_count = search.LastResultCount
        });
    }
}
