// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Mints a one-time impersonation PROOF — Laravel parity for
/// AdminSuperController::userImpersonate. The proof authenticates nothing on
/// its own (the JWT pipeline rejects type=impersonation); it must be exchanged
/// for a short session token. A super admin cannot impersonate a super
/// admin/god, cannot impersonate themselves, and cannot impersonate an
/// inactive account. Both audit trails are written, exactly as Laravel.
/// </summary>
[ApiController]
[Authorize]
public class AdminSuperImpersonationController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TokenService _tokens;
    private readonly AuditLogService _audit;
    private readonly ILogger<AdminSuperImpersonationController> _logger;
    private readonly Support.Authorization.SuperPanelAccess _superPanel;

    public AdminSuperImpersonationController(
        NexusDbContext db, TokenService tokens, AuditLogService audit,
        ILogger<AdminSuperImpersonationController> logger,
        Support.Authorization.SuperPanelAccess superPanel)
    {
        _db = db;
        _tokens = tokens;
        _audit = audit;
        _logger = logger;
        _superPanel = superPanel;
    }

    [HttpPost("api/v2/admin/super/users/{id:int}/impersonate")]
    public async Task<IActionResult> Impersonate(int id)
    {
        var actorId = User.GetUserId();
        var actorTenantId = User.GetTenantId();
        if (actorId is null || actorTenantId is null)
        {
            return StatusCode(StatusCodes.Status401Unauthorized,
                new { success = false, error = "Authentication required", code = "AUTH_REQUIRED" });
        }

        var actor = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(u => u.Id == actorId.Value && u.TenantId == actorTenantId.Value,
                HttpContext.RequestAborted);

        // 🔴 The gate is now SuperPanelAccess, matching Laravel's `super-panel`
        // middleware. It admits `master` (platform super/god, or a super-admin of
        // the master tenant) and `regional` (a super-admin of a hub tenant that
        // may have children AND has a materialised path). It therefore REFUSES a
        // super-admin of a leaf tenant, whom the previous flags-only check
        // admitted — Laravel refuses them too.
        var access = await _superPanel.ResolveAsync(actorId.Value, HttpContext.RequestAborted);
        if (!access.Granted)
        {
            return Forbidden("SUPER_PANEL_ACCESS_DENIED", "Super admin access is required");
        }

        var target = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(u => u.Id == id, HttpContext.RequestAborted);
        if (target is null)
        {
            return LaravelError(404, "RESOURCE_NOT_FOUND", "User not found");
        }

        // SCOPE: a regional super admin may only impersonate inside their own
        // subtree. Laravel returns 403 SUPER_PANEL_ACCESS_DENIED for an
        // out-of-subtree target (AdminSuperController.php:1044-1051); this used
        // to be missing entirely, so a hub admin could sign in as a member of
        // any community on the platform.
        if (!await _superPanel.CanAccessTenantAsync(actorId.Value, target.TenantId, HttpContext.RequestAborted))
        {
            return Forbidden("SUPER_PANEL_ACCESS_DENIED", "Super admin access is required");
        }

        if (id == actorId.Value)
        {
            return LaravelError(422, "VALIDATION_ERROR", "You cannot impersonate yourself");
        }

        if (target.Role is "super_admin" or "god" || target.IsSuperAdmin || target.IsGod)
        {
            return Forbidden("AUTH_INSUFFICIENT_PERMISSIONS", "Cannot impersonate a super admin");
        }

        if (!target.IsActive)
        {
            return LaravelError(422, "VALIDATION_ERROR", "This member's account is not available");
        }

        var (proof, _) = _tokens.GenerateImpersonationProof(target.Id, target.TenantId, actorId.Value);
        var tenantSlug = await _db.Tenants.AsNoTracking()
            .Where(t => t.Id == target.TenantId)
            .Select(t => t.Slug)
            .SingleOrDefaultAsync(HttpContext.RequestAborted);
        var name = $"{target.FirstName} {target.LastName}".Trim();

        try
        {
            await _audit.LogAsync(actorId.Value, "admin_impersonate", "user", target.Id,
                null, null, null, null,
                System.Text.Json.JsonSerializer.Serialize(new
                {
                    target_user_id = target.Id,
                    target_email = target.Email,
                    target_tenant_id = target.TenantId
                }));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[Impersonation] audit write failed");
        }

        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = actorTenantId.Value.ToString();
        return Ok(new
        {
            data = new
            {
                token = proof,
                user_id = target.Id,
                user_name = string.IsNullOrEmpty(name) ? target.Email : name,
                tenant_id = target.TenantId,
                tenant_slug = tenantSlug
            },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private IActionResult Forbidden(string code, string message)
    {
        Response.Headers["API-Version"] = "2.0";
        return StatusCode(StatusCodes.Status403Forbidden, new { errors = new[] { new { code, message } } });
    }

    private IActionResult LaravelError(int status, string code, string message)
    {
        Response.Headers["API-Version"] = "2.0";
        return StatusCode(status, new { errors = new[] { new { code, message } } });
    }
}
