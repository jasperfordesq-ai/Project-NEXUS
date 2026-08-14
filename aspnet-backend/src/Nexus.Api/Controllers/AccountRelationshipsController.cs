// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;
using Nexus.Api.Support.Safeguarding;

namespace Nexus.Api.Controllers;

/// <summary>
/// The SUPPORTED member's side of the carer relationship — Laravel parity for
/// SubAccountController::updateMemberPermissions and withdrawMessageAccess.
/// These are the only paths that may expand a supporter's authority (messages
/// excepted — that has its own consent workflow), and withdrawal is always
/// available, immediately, without a reason.
/// </summary>
[ApiController]
[Authorize]
public class AccountRelationshipsController : ControllerBase
{
    private readonly AccountRelationshipService _relationships;

    public AccountRelationshipsController(AccountRelationshipService relationships)
    {
        _relationships = relationships;
    }

    /// <summary>
    /// PUT /api/users/me/parent-accounts/{id}/permissions (auto-aliased to
    /// /api/v2/...). Body: {"tiers":{...}} or {"permissions":{"tiers":{...}}}.
    /// 200 returns the member's FULL parent-accounts array, exactly as Laravel.
    /// </summary>
    [HttpPut("api/users/me/parent-accounts/{id:int}/permissions")]
    public async Task<IActionResult> UpdateMemberPermissions(int id, [FromBody] JsonElement body)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var (_, requestedTiers) = CompatibilityAliasController.ParsePermissionsBody(body);
        var sanitized = SupportTiers.SanitizeTiers(requestedTiers);
        // messages stays on its dedicated consent workflow, never this route.
        sanitized.Remove("messages");
        if (sanitized.Count == 0)
        {
            Response.Headers["API-Version"] = "2.0";
            return BadRequest(new
            {
                errors = new[] { new
                {
                    code = "VALIDATION_ERROR",
                    message = "The tiers field is required.",
                    field = "tiers"
                } }
            });
        }

        var updated = await _relationships.UpdatePermissionsByMemberAsync(
            userId.Value, id, sanitized, HttpContext.RequestAborted);
        if (!updated)
        {
            var code = CompatibilityAliasController.FirstErrorCode(_relationships.Errors);
            var status = code == "FORBIDDEN"
                ? StatusCodes.Status403Forbidden
                : StatusCodes.Status404NotFound;
            return StatusCode(status, new { errors = _relationships.Errors });
        }

        Response.Headers["API-Version"] = "2.0";
        return Ok(new
        {
            data = await _relationships.GetParentAccountsAsync(userId.Value, HttpContext.RequestAborted)
        });
    }

    /// <summary>
    /// POST /api/users/me/parent-accounts/{id}/message-access/withdraw.
    /// Shrink-only, always available, no reason required.
    /// 200 {"data":{"message_access":"none"}}.
    /// </summary>
    [HttpPost("api/users/me/parent-accounts/{id:int}/message-access/withdraw")]
    public async Task<IActionResult> WithdrawMessageAccess(int id)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        if (!await _relationships.WithdrawMessageAccessAsync(
                userId.Value, id, HttpContext.RequestAborted))
        {
            return NotFound(new { errors = _relationships.Errors });
        }

        Response.Headers["API-Version"] = "2.0";
        return Ok(new { data = new { message_access = "none" } });
    }
}
