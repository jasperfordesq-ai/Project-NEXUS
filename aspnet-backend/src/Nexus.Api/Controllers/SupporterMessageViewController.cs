// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Supervised message viewing — Laravel parity for SubAccountController's
/// listChildMessages / showChildThread. GET only: there deliberately exists
/// NO write route under this prefix. The purpose travels in the
/// X-Message-View-Purpose header first, then ?purpose= — a GET body is
/// deliberately not read.
/// </summary>
[ApiController]
[Authorize]
public class SupporterMessageViewController : ControllerBase
{
    private readonly SupporterMessageViewService _views;

    public SupporterMessageViewController(SupporterMessageViewService views)
    {
        _views = views;
    }

    [HttpGet("api/v2/users/me/sub-accounts/{childId:int}/messages")]
    public async Task<IActionResult> ListChildMessages(
        int childId, [FromQuery] int? limit)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var result = await _views.ListConversationsAsync(
            userId.Value, childId, ResolvePurpose(), limit ?? 20, HttpContext.RequestAborted);
        if (result is null) return ErrorsResponse();

        return LaravelData(result);
    }

    [HttpGet("api/v2/users/me/sub-accounts/{childId:int}/messages/{partnerId:int}")]
    public async Task<IActionResult> ShowChildThread(
        int childId, int partnerId, [FromQuery] int? limit)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var result = await _views.ShowThreadAsync(
            userId.Value, childId, partnerId, ResolvePurpose(), limit ?? 50,
            HttpContext.RequestAborted);
        if (result is null) return ErrorsResponse();

        return LaravelData(result);
    }

    /// <summary>Header first (non-blank after trim), then the query string.</summary>
    private string? ResolvePurpose()
    {
        var header = Request.Headers["X-Message-View-Purpose"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(header)) return header;
        return Request.Query["purpose"].FirstOrDefault();
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

    /// <summary>Laravel status mapping: FORBIDDEN 403, NOT_FOUND 404, default 422.</summary>
    private IActionResult ErrorsResponse()
    {
        Response.Headers["API-Version"] = "2.0";
        var code = CompatibilityAliasController.FirstErrorCode(_views.Errors);
        var status = code switch
        {
            "FORBIDDEN" => StatusCodes.Status403Forbidden,
            "NOT_FOUND" => StatusCodes.Status404NotFound,
            _ => StatusCodes.Status422UnprocessableEntity,
        };
        return StatusCode(status, new { errors = _views.Errors });
    }
}
