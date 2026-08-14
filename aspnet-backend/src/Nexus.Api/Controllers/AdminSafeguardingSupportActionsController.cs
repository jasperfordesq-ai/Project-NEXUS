// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Safeguarding staff surface for the support-action queue — Laravel parity
/// for AdminSafeguardingController::supportActions / attestSupportAction.
/// Gated broker-or-admin: unlike generic admin routes, an authorised BROKER
/// may work this queue — recording offline approvals is operational
/// safeguarding work, not administration.
/// </summary>
[ApiController]
[Authorize]
public class AdminSafeguardingSupportActionsController : ControllerBase
{
    private static readonly string[] AllowedRoles =
        ["broker", "coordinator", "admin", "tenant_admin", "super_admin", "god"];

    private readonly NexusDbContext _db;
    private readonly SupportPendingActionService _actions;

    public AdminSafeguardingSupportActionsController(
        NexusDbContext db, SupportPendingActionService actions)
    {
        _db = db;
        _actions = actions;
    }

    [HttpGet("api/v2/admin/safeguarding/support-actions")]
    public async Task<IActionResult> PendingQueue()
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        return LaravelData(new
        {
            actions = await _actions.ListPendingForTenantAsync(HttpContext.RequestAborted)
        });
    }

    [HttpPost("api/v2/admin/safeguarding/support-actions/{id:int}/attest")]
    public async Task<IActionResult> Attest(int id, [FromBody] JsonElement? body)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        string? channel = null;
        string? witness = null;
        if (body is { ValueKind: JsonValueKind.Object } payload)
        {
            if (payload.TryGetProperty("channel", out var c) && c.ValueKind == JsonValueKind.String)
                channel = c.GetString();
            if (payload.TryGetProperty("witness", out var w) && w.ValueKind == JsonValueKind.String)
                witness = w.GetString();
        }

        var result = await _actions.ConfirmAttestedAsync(
            User.GetUserId()!.Value, id, channel, witness,
            HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(),
            HttpContext.RequestAborted);
        if (result is null)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                new { errors = _actions.Errors });
        }

        return LaravelData(new { status = "confirmed", result_id = result.ResultId });
    }

    /// <summary>
    /// broker-or-admin: role strings broker/coordinator qualify alongside the
    /// admin tiers and flags — deliberately wider than AdminTier, which
    /// refuses brokers on generic admin routes.
    /// </summary>
    private async Task<IActionResult?> GateAsync()
    {
        var userId = User.GetUserId();
        var tenantId = User.GetTenantId();
        if (userId is null || tenantId is null)
        {
            return StatusCode(StatusCodes.Status401Unauthorized,
                new { success = false, error = "Authentication required", code = "AUTH_REQUIRED" });
        }

        var user = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(u => u.Id == userId.Value && u.TenantId == tenantId.Value,
                HttpContext.RequestAborted);
        var allowed = user is not null
            && (AllowedRoles.Contains(user.Role)
                || user.IsAdmin || user.IsSuperAdmin || user.IsTenantSuperAdmin || user.IsGod);
        if (!allowed)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                success = false,
                error = "Only an authorised broker or administrator can record attestations",
                code = "AUTH_INSUFFICIENT_PERMISSIONS"
            });
        }

        return null;
    }

    private IActionResult LaravelData(object data)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = (User.GetTenantId() ?? 0).ToString();
        return Ok(new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }
}
