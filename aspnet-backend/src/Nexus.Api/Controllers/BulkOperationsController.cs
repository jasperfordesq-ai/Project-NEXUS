// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Authorization;
using Nexus.Api.Data;
using System.Text.Json.Serialization;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/super-admin/bulk")]
[Authorize(Policy = NexusAuthorizationPolicies.PlatformSuperAdminOnly)]
public class BulkOperationsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<BulkOperationsController> _logger;

    public BulkOperationsController(NexusDbContext db, TenantContext tenantContext, ILogger<BulkOperationsController> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>POST /api/super-admin/bulk/activate - Bulk activate users by IDs.</summary>
    [HttpPost("activate")]
    public async Task<IActionResult> BulkActivate([FromBody] BulkUserRequest request)
    {
        if (request.UserIds == null || request.UserIds.Length == 0)
            return BadRequest(new { error = "UserIds required" });
        if (request.UserIds.Length > 500)
            return BadRequest(new { error = "Maximum 500 users per bulk operation" });

        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        // ExecuteUpdateAsync bypasses EF global query filters, so we must
        // explicitly enforce tenant isolation in the WHERE clause.
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var count = await _db.Users
            .Where(u => u.TenantId == tenantId && request.UserIds.Contains(u.Id) && !u.IsActive)
            .ExecuteUpdateAsync(u => u
                .SetProperty(x => x.IsActive, true)
                .SetProperty(x => x.UpdatedAt, DateTime.UtcNow));

        _logger.LogInformation("Super admin {AdminId} bulk activated {Count} users in tenant {TenantId}", adminId, count, tenantId);
        return Ok(new { success = true, affected = count });
    }

    /// <summary>POST /api/super-admin/bulk/suspend - Bulk suspend users by IDs.</summary>
    [HttpPost("suspend")]
    public async Task<IActionResult> BulkSuspend([FromBody] BulkUserRequest request)
    {
        if (request.UserIds == null || request.UserIds.Length == 0)
            return BadRequest(new { error = "UserIds required" });
        if (request.UserIds.Length > 500)
            return BadRequest(new { error = "Maximum 500 users per bulk operation" });

        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var count = await _db.Users
            .Where(u => u.TenantId == tenantId && request.UserIds.Contains(u.Id) && u.IsActive)
            .ExecuteUpdateAsync(u => u
                .SetProperty(x => x.IsActive, false)
                .SetProperty(x => x.UpdatedAt, DateTime.UtcNow));

        _logger.LogWarning("Super admin {AdminId} bulk suspended {Count} users in tenant {TenantId}", adminId, count, tenantId);
        return Ok(new { success = true, affected = count });
    }

    /// <summary>POST /api/super-admin/bulk/delete-listings - Bulk delete listings by IDs.</summary>
    [HttpPost("delete-listings")]
    public async Task<IActionResult> BulkDeleteListings([FromBody] BulkListingRequest request)
    {
        if (request.ListingIds == null || request.ListingIds.Length == 0)
            return BadRequest(new { error = "ListingIds required" });
        if (request.ListingIds.Length > 200)
            return BadRequest(new { error = "Maximum 200 listings per bulk operation" });

        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var count = await _db.Listings
            .Where(l => l.TenantId == tenantId && request.ListingIds.Contains(l.Id))
            .ExecuteDeleteAsync();

        _logger.LogWarning("Super admin {AdminId} bulk deleted {Count} listings in tenant {TenantId}", adminId, count, tenantId);
        return Ok(new { success = true, affected = count });
    }

    /// <summary>POST /api/super-admin/bulk/assign-role - Bulk assign role to users.</summary>
    [HttpPost("assign-role")]
    public async Task<IActionResult> BulkAssignRole([FromBody] BulkAssignRoleRequest request)
    {
        if (request.UserIds == null || request.UserIds.Length == 0)
            return BadRequest(new { error = "UserIds required" });
        if (string.IsNullOrWhiteSpace(request.Role))
            return BadRequest(new { error = "Role required" });

        var validRoles = new[] { "member", "admin", "broker" };
        if (!validRoles.Contains(request.Role.ToLower()))
            return BadRequest(new { error = $"Valid roles: {string.Join(", ", validRoles)}" });

        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var count = await _db.Users
            .Where(u => u.TenantId == tenantId && request.UserIds.Contains(u.Id))
            .ExecuteUpdateAsync(u => u
                .SetProperty(x => x.Role, request.Role.ToLower())
                .SetProperty(x => x.IsAdmin, false)
                .SetProperty(x => x.IsSuperAdmin, false)
                .SetProperty(x => x.IsTenantSuperAdmin, false)
                .SetProperty(x => x.IsGod, false)
                .SetProperty(x => x.UpdatedAt, DateTime.UtcNow));

        _logger.LogWarning("Super admin {AdminId} bulk assigned role '{Role}' to {Count} users in tenant {TenantId}", adminId, request.Role, count, tenantId);
        return Ok(new { success = true, affected = count });
    }
}

public class BulkUserRequest
{
    [JsonPropertyName("user_ids")]
    public int[] UserIds { get; set; } = Array.Empty<int>();
}

public class BulkListingRequest
{
    [JsonPropertyName("listing_ids")]
    public int[] ListingIds { get; set; } = Array.Empty<int>();
}

public class BulkAssignRoleRequest
{
    [JsonPropertyName("user_ids")]
    public int[] UserIds { get; set; } = Array.Empty<int>();
    [JsonPropertyName("role")]
    public string Role { get; set; } = string.Empty;
}
