// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

/// <summary>
/// Performance summary — Laravel parity for AdminPerformanceController.
/// The Laravel shape is pinned from both ends (PerformanceSummaryContractTest
/// / PerformanceDashboard.tsx). This backend has NO performance recorder yet,
/// and the contract has a first-class way to say so: meta.recording_enabled
/// is false, the arrays are empty, and the dashboard renders its honest
/// "recording off" state instead of fabricated numbers.
/// </summary>
[ApiController]
[Authorize]
public class AdminPerformanceSummaryController : ControllerBase
{
    private static readonly string[] AdminRoles = ["admin", "tenant_admin", "super_admin", "god"];
    private static readonly string[] OperationalRoles = ["broker", "coordinator"];

    private readonly NexusDbContext _db;

    public AdminPerformanceSummaryController(NexusDbContext db)
    {
        _db = db;
    }

    [HttpGet("api/v2/admin/performance/summary")]
    public async Task<IActionResult> Summary([FromQuery] int hours = 24)
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId is null || tenantId is null)
        {
            return StatusCode(StatusCodes.Status401Unauthorized,
                new { success = false, error = "Authentication required", code = "AUTH_REQUIRED" });
        }

        var user = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(u => u.Id == userId.Value && u.TenantId == tenantId.Value,
                HttpContext.RequestAborted);
        var allowed = user is not null
            && !OperationalRoles.Contains(user.Role)
            && (AdminRoles.Contains(user.Role)
                || user.IsAdmin || user.IsSuperAdmin || user.IsTenantSuperAdmin || user.IsGod);
        if (!allowed)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                success = false,
                error = "Admin access required",
                code = "AUTH_INSUFFICIENT_PERMISSIONS"
            });
        }

        // Clamped 1..720, never a 422 — exactly the Laravel behaviour.
        hours = Math.Min(Math.Max(hours, 1), 720);

        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = tenantId.Value.ToString();
        return Ok(new
        {
            data = new
            {
                slowest_requests = Array.Empty<object>(),
                slowest_queries = Array.Empty<object>(),
                memory_spikes = Array.Empty<object>(),
                request_volume = new Dictionary<string, int>(),
                n_plus_one_warnings = 0,
                total_requests = 0,
                total_slow_queries = 0,
                window_hours = hours
            },
            meta = new
            {
                base_url = $"{Request.Scheme}://{Request.Host}",
                recording_enabled = false,
                retention_days = 14
            }
        });
    }
}
