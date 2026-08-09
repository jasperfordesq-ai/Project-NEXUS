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

[ApiController]
[Route("api/resources")]
[Authorize]
public class ResourcesController : ControllerBase
{
    private readonly ResourceService _resourceService;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<ResourcesController> _logger;

    public ResourcesController(ResourceService resourceService, TenantContext tenantContext, ILogger<ResourcesController> logger)
    {
        _resourceService = resourceService;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int? category_id, [FromQuery] string? type,
        [FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });
        var (resources, total) = await _resourceService.GetResourcesAsync(
            _tenantContext.TenantId.Value, category_id, type, page, limit);
        return Ok(new { data = resources.Select(MapResource), pagination = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) } });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var resource = await _resourceService.GetResourceAsync(id);
        if (resource == null) return NotFound(new { error = "Resource not found" });
        return Ok(MapResource(resource));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateResourceRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });
        var (resource, error) = await _resourceService.CreateResourceAsync(
            _tenantContext.TenantId.Value, userId.Value, request.Title, request.Description,
            request.Url, request.ResourceType, request.CategoryId);
        if (error != null) return BadRequest(new { error });
        return CreatedAtAction(nameof(Get), new { id = resource!.Id }, MapResource(resource));
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateResourceRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var existing = await _resourceService.GetResourceAsync(id);
        if (existing == null) return NotFound(new { error = "Resource not found" });
        var isAdmin = User.IsAdmin();
        if (existing.CreatedById != userId.Value && !isAdmin)
            return StatusCode(403, new { error = "You can only update your own resources" });
        var (resource, error) = await _resourceService.UpdateResourceAsync(
            id, request.Title, request.Description, request.Url, request.ResourceType, request.CategoryId);
        if (error != null) return BadRequest(new { error });
        return Ok(MapResource(resource!));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var existing = await _resourceService.GetResourceAsync(id);
        if (existing == null) return NotFound(new { error = "Resource not found" });
        var isAdmin = User.IsAdmin();
        if (existing.CreatedById != userId.Value && !isAdmin)
            return StatusCode(403, new { error = "You can only delete your own resources" });
        var (success, error) = await _resourceService.DeleteResourceAsync(id);
        if (!success) return BadRequest(new { error });
        return Ok(new { message = "Resource deleted" });
    }

    [HttpPut("reorder")]
    public async Task<IActionResult> Reorder([FromBody] ReorderRequest request)
    {
        if (!User.IsAdmin())
            return StatusCode(403, new { error = "Admin access required" });
        var (success, error) = await _resourceService.ReorderResourcesAsync(request.ResourceIds);
        if (!success) return BadRequest(new { error });
        return Ok(new { message = "Resources reordered" });
    }

    [HttpGet("categories")]
    public async Task<IActionResult> ListCategories()
    {
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });
        var categories = await _resourceService.GetCategoriesAsync(_tenantContext.TenantId.Value);
        return Ok(new { data = categories.Select(MapCategory) });
    }

    [HttpGet("categories/tree")]
    public async Task<IActionResult> CategoryTree()
    {
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });
        var tree = await _resourceService.GetCategoryTreeAsync(_tenantContext.TenantId.Value);
        return Ok(new { data = tree.Select(MapCategoryTree) });
    }

    [HttpPost("categories")]
    public async Task<IActionResult> CreateCategory([FromBody] CreateCategoryRequest request)
    {
        if (!User.IsAdmin())
            return StatusCode(403, new { error = "Admin access required" });
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });
        var (category, error) = await _resourceService.CreateCategoryAsync(
            _tenantContext.TenantId.Value, request.Name, request.Description, request.ParentId);
        if (error != null) return BadRequest(new { error });
        return CreatedAtAction(nameof(ListCategories), null, MapCategory(category!));
    }

    [HttpPut("categories/{id:int}")]
    public async Task<IActionResult> UpdateCategory(int id, [FromBody] UpdateCategoryRequest request)
    {
        if (!User.IsAdmin())
            return StatusCode(403, new { error = "Admin access required" });
        var (category, error) = await _resourceService.UpdateCategoryAsync(id, request.Name, request.Description);
        if (error != null)
        {
            if (error == "Category not found") return NotFound(new { error });
            return BadRequest(new { error });
        }
        return Ok(MapCategory(category!));
    }

    [HttpDelete("categories/{id:int}")]
    public async Task<IActionResult> DeleteCategory(int id)
    {
        if (!User.IsAdmin())
            return StatusCode(403, new { error = "Admin access required" });
        var (success, error) = await _resourceService.DeleteCategoryAsync(id);
        if (!success)
        {
            if (error == "Category not found") return NotFound(new { error });
            return BadRequest(new { error });
        }
        return Ok(new { message = "Category deleted" });
    }

    // --- Mapping ---

    private static object MapResource(Nexus.Api.Entities.Resource r) => new
    {
        id = r.Id, title = r.Title, description = r.Description, url = r.Url,
        resource_type = r.ResourceType, sort_order = r.SortOrder, is_published = r.IsPublished,
        category_id = r.CategoryId,
        category = r.Category != null ? new { id = r.Category.Id, name = r.Category.Name } : null,
        created_by = r.CreatedBy != null ? new { id = r.CreatedBy.Id, first_name = r.CreatedBy.FirstName, last_name = r.CreatedBy.LastName } : null,
        created_at = r.CreatedAt, updated_at = r.UpdatedAt
    };

    private static object MapCategory(Nexus.Api.Entities.ResourceCategory c) => new
    {
        id = c.Id, name = c.Name, description = c.Description,
        parent_id = c.ParentId, sort_order = c.SortOrder, created_at = c.CreatedAt
    };

    private static object MapCategoryTree(Nexus.Api.Entities.ResourceCategory c) => new
    {
        id = c.Id, name = c.Name, description = c.Description,
        parent_id = c.ParentId, sort_order = c.SortOrder,
        resource_count = c.Resources.Count,
        children = c.Children.Select(MapCategoryTree)
    };

    // --- DTOs ---

    public class CreateResourceRequest
    {
        [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;
        [JsonPropertyName("description")] public string? Description { get; set; }
        [JsonPropertyName("url")] public string? Url { get; set; }
        [JsonPropertyName("resource_type")] public string ResourceType { get; set; } = "link";
        [JsonPropertyName("category_id")] public int? CategoryId { get; set; }
    }

    public class UpdateResourceRequest
    {
        [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;
        [JsonPropertyName("description")] public string? Description { get; set; }
        [JsonPropertyName("url")] public string? Url { get; set; }
        [JsonPropertyName("resource_type")] public string ResourceType { get; set; } = "link";
        [JsonPropertyName("category_id")] public int? CategoryId { get; set; }
    }

    public class ReorderRequest
    {
        [JsonPropertyName("resource_ids")] public int[] ResourceIds { get; set; } = Array.Empty<int>();
    }

    public class CreateCategoryRequest
    {
        [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
        [JsonPropertyName("description")] public string? Description { get; set; }
        [JsonPropertyName("parent_id")] public int? ParentId { get; set; }
    }

    public class UpdateCategoryRequest
    {
        [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
        [JsonPropertyName("description")] public string? Description { get; set; }
    }
}
