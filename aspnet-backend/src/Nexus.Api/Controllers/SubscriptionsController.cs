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
public class SubscriptionsController : ControllerBase
{
    private readonly SubscriptionService _svc;
    private readonly TenantContext _tenantContext;

    public SubscriptionsController(SubscriptionService svc, TenantContext tenantContext)
    {
        _svc = svc;
        _tenantContext = tenantContext;
    }

    [HttpGet("api/subscriptions/plans")]
    [AllowAnonymous]
    public async Task<IActionResult> ListPublicPlans()
    {
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var plans = await _svc.ListPlansAsync(_tenantContext.TenantId.Value);
        return Ok(new { data = plans.Select(p => new { id = p.Id, name = p.Name, description = p.Description, price = p.Price, currency = p.Currency, features = p.Features }) });
    }

    [HttpGet("api/subscriptions/plans/{id:int}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetPlan(int id)
    {
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var plan = await _svc.GetPlanAsync(_tenantContext.TenantId.Value, id);
        if (plan == null) return NotFound(new { error = "Plan not found" });
        return Ok(new { id = plan.Id, name = plan.Name, description = plan.Description, price = plan.Price, currency = plan.Currency, is_active = plan.IsActive, features = plan.Features });
    }

    [HttpGet("api/subscriptions/my")]
    [Authorize]
    public async Task<IActionResult> GetMySubscription()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized();
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var sub = await _svc.GetUserSubscriptionAsync(_tenantContext.TenantId.Value, userId.Value);
        if (sub == null) return Ok(new { subscription = (object?)null });
        return Ok(new { subscription = new { id = sub.Id, status = sub.Status.ToString(), started_at = sub.StartedAt, expires_at = sub.ExpiresAt } });
    }

    [HttpPost("api/subscriptions/subscribe")]
    [Authorize]
    public async Task<IActionResult> Subscribe([FromBody] PlanSubscribeRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized();
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var (sub, error) = await _svc.AssignPlanAsync(_tenantContext.TenantId.Value, userId.Value, request.PlanId);
        if (error != null) return BadRequest(new { error });
        return Ok(new { message = "Subscribed", subscription_id = sub!.Id });
    }

    [HttpDelete("api/subscriptions/cancel")]
    [Authorize]
    public async Task<IActionResult> Cancel()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized();
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var (ok, error) = await _svc.CancelSubscriptionAsync(_tenantContext.TenantId.Value, userId.Value);
        if (!ok) return BadRequest(new { error });
        return Ok(new { message = "Subscription cancelled" });
    }

    [HttpGet("api/admin/subscriptions/plans")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminListPlans()
    {
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var plans = await _svc.ListPlansAsync(_tenantContext.TenantId.Value, adminView: true);
        return Ok(new { data = plans.Select(p => new { id = p.Id, name = p.Name, price = p.Price, is_active = p.IsActive, is_public = p.IsPublic }) });
    }

    [HttpPost("api/admin/subscriptions/plans")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminCreatePlan([FromBody] CreatePlanRequest req)
    {
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var (plan, error) = await _svc.CreatePlanAsync(_tenantContext.TenantId.Value, req.Name, req.Description, req.Price, req.Currency ?? "EUR", req.MaxMembers, req.MaxListings, req.MaxExchangesPerMonth, req.Features ?? Array.Empty<string>());
        if (error != null) return BadRequest(new { error });
        return CreatedAtAction(nameof(GetPlan), new { id = plan!.Id }, new { id = plan.Id, name = plan.Name });
    }

    [HttpPut("api/admin/subscriptions/plans/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminUpdatePlan(int id, [FromBody] UpdatePlanRequest req)
    {
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var (plan, error) = await _svc.UpdatePlanAsync(_tenantContext.TenantId.Value, id, req.Name, req.Description, req.Price, req.IsActive, req.IsPublic);
        if (error != null) return BadRequest(new { error });
        return Ok(new { id = plan!.Id, name = plan.Name });
    }

    [HttpDelete("api/admin/subscriptions/plans/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminDeletePlan(int id)
    {
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var (ok, error) = await _svc.DeletePlanAsync(_tenantContext.TenantId.Value, id);
        if (!ok) return BadRequest(new { error });
        return Ok(new { message = "Plan deleted" });
    }

    [HttpGet("api/admin/subscriptions")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminListSubscriptions([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });
        var (subs, total) = await _svc.ListSubscriptionsAsync(_tenantContext.TenantId.Value, page, limit);
        var data = subs.Select(s => new { id = s.Id, status = s.Status.ToString(), started_at = s.StartedAt });
        return Ok(new { data, pagination = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) } });
    }
}

public record PlanSubscribeRequest([property: Required] int PlanId);
public record CreatePlanRequest([property: Required] string Name, string? Description, decimal Price, string? Currency, int MaxMembers, int MaxListings, int MaxExchangesPerMonth, string[]? Features);
public record UpdatePlanRequest(string? Name, string? Description, decimal? Price, bool? IsActive, bool? IsPublic);
