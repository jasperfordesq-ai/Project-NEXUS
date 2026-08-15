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
/// Platform super-admin operations — Laravel parity for
/// PlatformCapabilityController and AdminSuperController::
/// federationGetExternalStatus. Gate is PLATFORM super admin: tenant
/// super-admins are explicitly refused, exactly as requirePlatformSuperAdmin.
/// </summary>
[ApiController]
[Authorize]
public class AdminSuperOpsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly PlatformCapabilityService _capabilities;

    public AdminSuperOpsController(NexusDbContext db, PlatformCapabilityService capabilities)
    {
        _db = db;
        _capabilities = capabilities;
    }

    [HttpGet("api/v2/admin/super/platform-capabilities")]
    public async Task<IActionResult> ListCapabilities()
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        return LaravelData(new
        {
            capabilities = await _capabilities.InspectAsync(HttpContext.RequestAborted)
        });
    }

    [HttpPut("api/v2/admin/super/platform-capabilities")]
    public async Task<IActionResult> UpdateCapability([FromBody] JsonElement body)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        var capability = ReadString(body, "capability")?.Trim();
        if (string.IsNullOrEmpty(capability))
        {
            return LaravelError(422, "VALIDATION_ERROR", "Invalid input", "capability");
        }

        var clear = body.ValueKind == JsonValueKind.Object
            && body.TryGetProperty("clear", out var clearValue)
            && clearValue.ValueKind == JsonValueKind.True;
        if (clear)
        {
            if (!await _capabilities.ClearAsync(capability, HttpContext.RequestAborted))
            {
                return LaravelError(422, "VALIDATION_ERROR", "Invalid input", "capability");
            }
        }
        else
        {
            // A real JSON boolean becomes '1'/'0' so the UI switch need not
            // know the storage encoding.
            string? value = null;
            if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("value", out var rawValue))
            {
                value = rawValue.ValueKind switch
                {
                    JsonValueKind.String => rawValue.GetString(),
                    JsonValueKind.True => "1",
                    JsonValueKind.False => "0",
                    _ => null
                };
            }

            if (string.IsNullOrEmpty(value))
            {
                return LaravelError(422, "VALIDATION_ERROR", "Invalid input", "value");
            }

            if (!await _capabilities.SetAsync(capability, value, User.GetUserId()!.Value,
                    ReadString(body, "reason"), HttpContext.RequestAborted))
            {
                return LaravelError(422, "VALIDATION_ERROR", "Invalid input", "value");
            }
        }

        return LaravelData(new
        {
            capabilities = await _capabilities.InspectAsync(HttpContext.RequestAborted)
        });
    }

    /// <summary>
    /// External federation is not implemented on this backend: every switch
    /// honestly reads OFF in the exact Laravel shape, so the super panel
    /// renders truthfully rather than erroring.
    /// </summary>
    [HttpGet("api/v2/admin/super/federation/external-status")]
    public async Task<IActionResult> FederationExternalStatus()
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        return LaravelData(new
        {
            platform_enabled = false,
            master_enabled = false,
            effective = false,
            emergency_lockdown_active = false,
            reason = (string?)null,
            protocols = new Dictionary<string, bool>
            {
                ["nexus"] = false,
                ["komunitin"] = false,
                ["credit_commons"] = false,
                ["legacy_v1"] = false,
                ["webhooks"] = false,
                ["hour_transfer"] = false,
                ["aggregates"] = false,
            },
            blocked_last_24h = new Dictionary<string, int>(),
            partner_api = new
            {
                enabled = false,
                reason = (string?)null,
                emergency_lockdown_active = false
            }
        });
    }

    /// <summary>
    /// Platform super admin only: role super_admin/god or the platform flags.
    /// Tenant super-admins are explicitly rejected, as
    /// requirePlatformSuperAdmin does.
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

        var user = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(u => u.Id == userId.Value && u.TenantId == tenantId.Value,
                HttpContext.RequestAborted);
        var allowed = user is not null
            && (user.Role is "super_admin" or "god" || user.IsSuperAdmin || user.IsGod);
        if (!allowed)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                success = false,
                error = "Super admin access required",
                code = "AUTH_INSUFFICIENT_PERMISSIONS"
            });
        }

        return null;
    }

    private static string? ReadString(JsonElement body, string name) =>
        body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

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

    private IActionResult LaravelError(int status, string code, string message, string field)
    {
        Response.Headers["API-Version"] = "2.0";
        return StatusCode(status, new { errors = new[] { new { code, message, field } } });
    }
}
