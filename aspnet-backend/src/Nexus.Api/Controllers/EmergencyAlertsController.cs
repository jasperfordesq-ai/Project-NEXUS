// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/volunteer/emergency-alerts")]
[Authorize]
public class EmergencyAlertsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;
    private readonly ILogger<EmergencyAlertsController> _logger;

    public EmergencyAlertsController(NexusDbContext db, TenantContext tenant, ILogger<EmergencyAlertsController> logger)
    {
        _db = db;
        _tenant = tenant;
        _logger = logger;
    }

    /// <summary>GET /api/volunteer/emergency-alerts - List active emergency alerts.</summary>
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] bool active_only = true)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var query = _db.EmergencyAlerts.AsNoTracking()
            .Include(a => a.CreatedBy)
            .Where(a => a.TenantId == tenantId);

        if (active_only) query = query.Where(a => a.IsActive);

        var items = await query
            .OrderByDescending(a => a.CreatedAt)
            .Select(a => new
            {
                a.Id, a.Title, a.Description, a.Urgency, a.ContactInfo,
                a.IsActive, a.CreatedAt, a.ResolvedAt,
                created_by = a.CreatedBy != null
                    ? new { id = a.CreatedBy.Id, first_name = a.CreatedBy.FirstName, last_name = a.CreatedBy.LastName }
                    : null
            })
            .ToListAsync();

        return Ok(new { data = items, count = items.Count });
    }

    /// <summary>GET /api/volunteer/emergency-alerts/{id} - Get alert details.</summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var alert = await _db.EmergencyAlerts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenantId);
        if (alert == null) return NotFound(new { error = "Alert not found" });
        return Ok(alert);
    }

    /// <summary>POST /api/volunteer/emergency-alerts - Create emergency alert (admin/coordinator).</summary>
    [HttpPost]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> Create([FromBody] CreateEmergencyAlertRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || string.IsNullOrWhiteSpace(request.Description))
            return BadRequest(new { error = "Title and description are required" });

        var validUrgencies = new[] { "low", "medium", "high", "critical" };
        if (!validUrgencies.Contains(request.Urgency?.ToLower() ?? "medium"))
            return BadRequest(new { error = "Urgency must be: low, medium, high, critical" });

        var userId = User.GetUserId();
        if (userId == null) return Unauthorized();
        var tenantId = _tenant.GetTenantIdOrThrow();

        var alert = new EmergencyAlert
        {
            TenantId = tenantId,
            Title = request.Title.Trim(),
            Description = request.Description.Trim(),
            Urgency = request.Urgency?.ToLower() ?? "medium",
            ContactInfo = request.ContactInfo,
            CreatedById = userId.Value
        };

        _db.EmergencyAlerts.Add(alert);
        await _db.SaveChangesAsync();

        _logger.LogWarning("Emergency alert created: {Title} [{Urgency}] by user {UserId}", alert.Title, alert.Urgency, userId);
        return StatusCode(201, new { success = true, id = alert.Id, message = "Emergency alert created and broadcast" });
    }

    /// <summary>PUT /api/volunteer/emergency-alerts/{id}/resolve - Resolve an alert (admin).</summary>
    [HttpPut("{id:int}/resolve")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> Resolve(int id)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var alert = await _db.EmergencyAlerts.FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenantId);
        if (alert == null) return NotFound(new { error = "Alert not found" });
        if (!alert.IsActive) return BadRequest(new { error = "Alert is already resolved" });

        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        alert.IsActive = false;
        alert.ResolvedAt = DateTime.UtcNow;
        alert.ResolvedById = adminId.Value;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Emergency alert resolved" });
    }

    /// <summary>DELETE /api/volunteer/emergency-alerts/{id} - Delete alert (admin).</summary>
    [HttpDelete("{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> Delete(int id)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var alert = await _db.EmergencyAlerts.FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenantId);
        if (alert == null) return NotFound(new { error = "Alert not found" });

        _db.EmergencyAlerts.Remove(alert);
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }
}

public class CreateEmergencyAlertRequest
{
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? Urgency { get; set; }
    public string? ContactInfo { get; set; }
}
