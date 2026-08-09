// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/deliverables")]
[Authorize(Policy = "AdminOnly")]
public class DeliverablesController : ControllerBase
{
    private readonly DeliverableService _svc;
    private readonly TenantContext _tenantContext;

    public DeliverablesController(DeliverableService svc, TenantContext tenantContext)
    {
        _svc = svc;
        _tenantContext = tenantContext;
    }

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? status, [FromQuery] string? priority,
        [FromQuery] int? assigned_to, [FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        page = Math.Max(1, page); limit = Math.Clamp(limit, 1, 100);
        var (items, total) = await _svc.ListDeliverablesAsync(_tenantContext.TenantId.Value, status, priority, assigned_to, page, limit);
        var data = items.Select(d => new {
            id = d.Id, title = d.Title, status = d.Status.ToString(), priority = d.Priority.ToString(),
            due_date = d.DueDate, completed_at = d.CompletedAt, tags = d.Tags,
            assigned_to = d.AssignedTo == null ? null : new { id = d.AssignedTo.Id, first_name = d.AssignedTo.FirstName, last_name = d.AssignedTo.LastName },
            created_by = d.CreatedBy == null ? null : new { id = d.CreatedBy.Id, first_name = d.CreatedBy.FirstName, last_name = d.CreatedBy.LastName },
            created_at = d.CreatedAt
        });
        return Ok(new { data, pagination = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) } });
    }

    [HttpGet("dashboard")]
    public async Task<IActionResult> Dashboard()
    {
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var result = await _svc.GetDashboardAsync(_tenantContext.TenantId.Value);
        return Ok(result);
    }

    [HttpGet("analytics")]
    public async Task<IActionResult> Analytics()
    {
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var result = await _svc.GetAnalyticsAsync(_tenantContext.TenantId.Value);
        return Ok(result);
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var d = await _svc.GetDeliverableAsync(_tenantContext.TenantId.Value, id);
        if (d == null) return NotFound(new { error = "Deliverable not found" });
        return Ok(new {
            id = d.Id, title = d.Title, description = d.Description, status = d.Status.ToString(),
            priority = d.Priority.ToString(), due_date = d.DueDate, completed_at = d.CompletedAt, tags = d.Tags,
            assigned_to = d.AssignedTo == null ? null : new { id = d.AssignedTo.Id, first_name = d.AssignedTo.FirstName, last_name = d.AssignedTo.LastName },
            comments = d.Comments.Select(c => new { id = c.Id, content = c.Content, created_at = c.CreatedAt, user = c.User == null ? null : new { id = c.User.Id, first_name = c.User.FirstName } }),
            created_at = d.CreatedAt
        });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateDeliverableRequest req)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized();
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var (d, error) = await _svc.CreateDeliverableAsync(_tenantContext.TenantId.Value, userId.Value, req.Title, req.Description, req.AssignedToUserId, req.Priority, req.DueDate, req.Tags);
        if (error != null) return BadRequest(new { error });
        return CreatedAtAction(nameof(Get), new { id = d!.Id }, new { id = d.Id, title = d.Title });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateDeliverableRequest req)
    {
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var (d, error) = await _svc.UpdateDeliverableAsync(_tenantContext.TenantId.Value, id, req.Title, req.Description, req.AssignedToUserId, req.Status, req.Priority, req.DueDate, req.Tags);
        if (error != null) return BadRequest(new { error });
        return Ok(new { id = d!.Id, title = d.Title, status = d.Status.ToString() });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var (ok, error) = await _svc.DeleteDeliverableAsync(_tenantContext.TenantId.Value, id);
        if (!ok) return BadRequest(new { error });
        return Ok(new { message = "Deleted" });
    }

    [HttpPost("{id:int}/comments")]
    public async Task<IActionResult> AddComment(int id, [FromBody] AddDeliverableCommentRequest req)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized();
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var (comment, error) = await _svc.AddCommentAsync(_tenantContext.TenantId.Value, id, userId.Value, req.Content);
        if (error != null) return BadRequest(new { error });
        return StatusCode(201, new { id = comment!.Id, content = comment.Content, created_at = comment.CreatedAt });
    }
}

public record CreateDeliverableRequest([property: Required] string Title, string? Description, int? AssignedToUserId, string? Priority, DateTime? DueDate, string? Tags);
public record UpdateDeliverableRequest(string? Title, string? Description, int? AssignedToUserId, string? Status, string? Priority, DateTime? DueDate, string? Tags);
public record AddDeliverableCommentRequest([property: Required] string Content);
