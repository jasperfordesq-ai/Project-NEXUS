// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// The support-action consent workflow endpoints — Laravel parity for
/// SupportActionController. Registered under /api/v2 only, exactly as
/// Laravel. The two token routes are anonymous: the token IS the credential,
/// and GET is read-only while POST alone flips state, so an email scanner's
/// prefetch can never confirm anything.
/// </summary>
[ApiController]
public class SupportActionsController : ControllerBase
{
    private readonly SupportPendingActionService _actions;

    public SupportActionsController(SupportPendingActionService actions)
    {
        _actions = actions;
    }

    [Authorize]
    [HttpPost("api/v2/users/me/support-actions")]
    public async Task<IActionResult> Prepare([FromBody] JsonElement body)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var supportedUserId = body.ValueKind == JsonValueKind.Object
            && body.TryGetProperty("supported_user_id", out var s)
            && s.ValueKind == JsonValueKind.Number ? s.GetInt32() : 0;
        var actionType = body.ValueKind == JsonValueKind.Object
            && body.TryGetProperty("action_type", out var t)
            && t.ValueKind == JsonValueKind.String ? t.GetString() ?? "" : "";
        var hasPayload = body.ValueKind == JsonValueKind.Object
            && body.TryGetProperty("payload", out var payload)
            && payload.ValueKind == JsonValueKind.Object
            && payload.EnumerateObject().Any();

        if (supportedUserId <= 0)
            return ValidationError("supported_user_id", "The supported user id field is required.");
        if (!Entities.SupportPendingAction.TypeCapabilities.ContainsKey(actionType))
            return ValidationError("action_type", "Unknown support action type");
        if (!hasPayload)
            return ValidationError("payload", "The payload field is required.");

        var result = await _actions.PrepareAsync(
            userId.Value, supportedUserId, actionType,
            body.GetProperty("payload").GetRawText(), HttpContext.RequestAborted);
        if (result is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { errors = _actions.Errors });
        }

        // The raw token is deliberately NOT returned to the supporter — it is
        // the supported member's credential.
        return LaravelData(new { id = result.Id, status = "pending" });
    }

    [Authorize]
    [HttpGet("api/v2/users/me/support-actions")]
    public async Task<IActionResult> Index([FromQuery] string? role)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        if (role == "supporter")
        {
            return LaravelData(new
            {
                actions = await _actions.ListForSupporterAsync(userId.Value, HttpContext.RequestAborted)
            });
        }

        return LaravelData(new
        {
            actions = await _actions.ListForSupportedAsync(userId.Value, HttpContext.RequestAborted),
            pending_count = await _actions.PendingCountForSupportedAsync(userId.Value, HttpContext.RequestAborted)
        });
    }

    [Authorize]
    [HttpPost("api/v2/users/me/support-actions/{id:int}/confirm")]
    public async Task<IActionResult> Confirm(int id)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var result = await _actions.ConfirmInAppAsync(
            userId.Value, id, ClientIp(), ClientUserAgent(), HttpContext.RequestAborted);
        if (result is null)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, new { errors = _actions.Errors });
        }

        return LaravelData(new { status = "confirmed", result_id = result.ResultId });
    }

    [Authorize]
    [HttpPost("api/v2/users/me/support-actions/{id:int}/decline")]
    public async Task<IActionResult> Decline(int id, [FromBody] JsonElement? body)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        string? reason = null;
        if (body is { ValueKind: JsonValueKind.Object } declineBody
            && declineBody.TryGetProperty("reason", out var r)
            && r.ValueKind == JsonValueKind.String)
        {
            reason = r.GetString();
        }

        if (!await _actions.DeclineAsync(userId.Value, id, reason, HttpContext.RequestAborted))
        {
            return NotFound(new { errors = _actions.Errors });
        }

        return LaravelData(new { status = "declined" });
    }

    [Authorize]
    [HttpDelete("api/v2/users/me/support-actions/{id:int}")]
    public async Task<IActionResult> Cancel(int id)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        if (!await _actions.CancelAsync(userId.Value, id, HttpContext.RequestAborted))
        {
            return NotFound(new { errors = _actions.Errors });
        }

        return LaravelData(new { status = "cancelled" });
    }

    /// <summary>Read-only lookup; deliberately never mutates.</summary>
    [AllowAnonymous]
    [HttpGet("api/v2/support-actions/confirm/{token}")]
    public async Task<IActionResult> ShowByToken(string token)
    {
        var view = await _actions.FindByTokenAsync(token, HttpContext.RequestAborted);
        if (view is null)
        {
            return NotFound(new
            {
                errors = new[] { new
                {
                    code = "NOT_FOUND",
                    message = "This request was not found or has already been answered"
                } }
            });
        }

        return LaravelData(view);
    }

    [AllowAnonymous]
    [HttpPost("api/v2/support-actions/confirm/{token}")]
    public async Task<IActionResult> ConfirmByToken(string token)
    {
        var result = await _actions.ConfirmByTokenAsync(
            token, ClientIp(), ClientUserAgent(), HttpContext.RequestAborted);
        if (result is null)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, new { errors = _actions.Errors });
        }

        return LaravelData(new { status = "confirmed", result_id = result.ResultId });
    }

    private IActionResult LaravelData(object data)
    {
        Response.Headers["API-Version"] = "2.0";
        return Ok(new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private IActionResult ValidationError(string field, string message)
    {
        Response.Headers["API-Version"] = "2.0";
        return BadRequest(new
        {
            errors = new[] { new { code = "VALIDATION_ERROR", message, field } }
        });
    }

    private string? ClientIp() => HttpContext.Connection.RemoteIpAddress?.ToString();
    private string? ClientUserAgent() => Request.Headers.UserAgent.ToString();
}
