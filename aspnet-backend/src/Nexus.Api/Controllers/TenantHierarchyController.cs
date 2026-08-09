// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Authorization;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Tenant hierarchy (parent-child) management. Super admin only.
/// </summary>
[ApiController]
[Route("api/system/tenant-hierarchy")]
[Authorize(Policy = NexusAuthorizationPolicies.PlatformSuperAdminOnly)]
public class TenantHierarchyController : ControllerBase
{
    private readonly TenantHierarchyService _hierarchy;

    public TenantHierarchyController(TenantHierarchyService hierarchy)
    {
        _hierarchy = hierarchy;
    }

    /// <summary>
    /// GET /api/system/tenant-hierarchy - Get full hierarchy tree.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetHierarchy()
    {
        var items = await _hierarchy.GetHierarchyAsync();
        return Ok(new
        {
            data = items.Select(h => new
            {
                h.Id,
                parent_tenant_id = h.ParentTenantId,
                child_tenant_id = h.ChildTenantId,
                inheritance_mode = h.InheritanceMode,
                is_active = h.IsActive,
                created_at = h.CreatedAt,
                parent = h.ParentTenant != null ? new { h.ParentTenant.Id, h.ParentTenant.Name, h.ParentTenant.Slug } : null,
                child = h.ChildTenant != null ? new { h.ChildTenant.Id, h.ChildTenant.Name, h.ChildTenant.Slug } : null
            })
        });
    }

    /// <summary>
    /// GET /api/system/tenant-hierarchy/{parentId}/children - Get children of a tenant.
    /// </summary>
    [HttpGet("{parentId}/children")]
    public async Task<IActionResult> GetChildren(int parentId)
    {
        var children = await _hierarchy.GetChildrenAsync(parentId);
        return Ok(new
        {
            data = children.Select(h => new
            {
                h.Id, child_tenant_id = h.ChildTenantId, inheritance_mode = h.InheritanceMode,
                child = h.ChildTenant != null ? new { h.ChildTenant.Id, h.ChildTenant.Name, h.ChildTenant.Slug } : null
            })
        });
    }

    /// <summary>
    /// GET /api/system/tenant-hierarchy/{childId}/parent - Get parent of a tenant.
    /// </summary>
    [HttpGet("{childId}/parent")]
    public async Task<IActionResult> GetParent(int childId)
    {
        var parent = await _hierarchy.GetParentAsync(childId);
        if (parent == null) return Ok(new { data = (object?)null, message = "No parent tenant" });

        return Ok(new
        {
            data = new
            {
                parent.Id, parent_tenant_id = parent.ParentTenantId, inheritance_mode = parent.InheritanceMode,
                parent_tenant = parent.ParentTenant != null ? new { parent.ParentTenant.Id, parent.ParentTenant.Name, parent.ParentTenant.Slug } : null
            }
        });
    }

    /// <summary>
    /// POST /api/system/tenant-hierarchy - Create relationship.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateHierarchyRequest request)
    {
        var (h, error) = await _hierarchy.CreateRelationshipAsync(
            request.ParentTenantId, request.ChildTenantId, request.InheritanceMode ?? "config");
        if (error != null) return BadRequest(new { error });
        return Created("/api/system/tenant-hierarchy", new { data = new { h!.Id, h.ParentTenantId, h.ChildTenantId } });
    }

    /// <summary>
    /// PUT /api/system/tenant-hierarchy/{id} - Update relationship.
    /// </summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateHierarchyRequest request)
    {
        var (h, error) = await _hierarchy.UpdateRelationshipAsync(id, request.InheritanceMode, request.IsActive);
        if (error != null) return NotFound(new { error });
        return Ok(new { data = new { h!.Id, inheritance_mode = h.InheritanceMode, is_active = h.IsActive } });
    }

    /// <summary>
    /// DELETE /api/system/tenant-hierarchy/{id} - Delete relationship.
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var error = await _hierarchy.DeleteRelationshipAsync(id);
        if (error != null) return NotFound(new { error });
        return Ok(new { message = "Relationship deleted" });
    }
}

public class CreateHierarchyRequest
{
    [JsonPropertyName("parent_tenant_id")] public int ParentTenantId { get; set; }
    [JsonPropertyName("child_tenant_id")] public int ChildTenantId { get; set; }
    [JsonPropertyName("inheritance_mode")] public string? InheritanceMode { get; set; }
}

public class UpdateHierarchyRequest
{
    [JsonPropertyName("inheritance_mode")] public string? InheritanceMode { get; set; }
    [JsonPropertyName("is_active")] public bool? IsActive { get; set; }
}
