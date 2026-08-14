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
/// Represent-tier proxy endpoints — Laravel parity for SubAccountController's
/// createListingForChild / uploadListingImageForChild / transferForChild /
/// getChildWallet. Registered under /api/v2 only, exactly as Laravel; the
/// three POST routes are covered by the legal-acceptance gate middleware.
/// </summary>
[ApiController]
[Authorize]
public class SubAccountProxyController : ControllerBase
{
    private readonly SubAccountProxyService _proxy;

    public SubAccountProxyController(SubAccountProxyService proxy)
    {
        _proxy = proxy;
    }

    [HttpPost("api/v2/users/me/sub-accounts/{childId:int}/listings")]
    public async Task<IActionResult> CreateListingForChild(int childId, [FromBody] JsonElement body)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var listingId = await _proxy.CreateListingForChildAsync(
            userId.Value, childId, body, HttpContext.RequestAborted);
        if (listingId is null) return ErrorsResponse(defaultStatus: 422);

        return LaravelData(new { id = listingId }, StatusCodes.Status201Created);
    }

    [HttpPost("api/v2/users/me/sub-accounts/{childId:int}/listings/{listingId:int}/image")]
    public async Task<IActionResult> UploadListingImageForChild(
        int childId, int listingId, IFormFile? image = null, IFormFile? file = null)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var imageUrl = await _proxy.AttachListingImageForChildAsync(
            userId.Value, childId, listingId, image ?? file, HttpContext.RequestAborted);
        if (imageUrl is null) return ErrorsResponse(defaultStatus: 422);

        return LaravelData(new { image_url = imageUrl });
    }

    [HttpPost("api/v2/users/me/sub-accounts/{childId:int}/transfer")]
    public async Task<IActionResult> TransferForChild(int childId, [FromBody] JsonElement body)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var transaction = await _proxy.TransferForChildAsync(
            userId.Value, childId, body, HttpContext.RequestAborted);
        if (transaction is null) return ErrorsResponse(defaultStatus: 422);

        return LaravelData(transaction);
    }

    [HttpGet("api/v2/users/me/sub-accounts/{childId:int}/wallet")]
    public async Task<IActionResult> GetChildWallet(int childId)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var summary = await _proxy.GetChildWalletSummaryAsync(
            userId.Value, childId, HttpContext.RequestAborted);
        if (summary is null) return ErrorsResponse(defaultStatus: 404);

        return LaravelData(summary);
    }

    private IActionResult LaravelData(object data, int status = StatusCodes.Status200OK)
    {
        Response.Headers["API-Version"] = "2.0";
        return StatusCode(status, new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    /// <summary>Laravel status mapping: FORBIDDEN 403, NOT_FOUND 404, UPLOAD_FAILED 500, else the default.</summary>
    private IActionResult ErrorsResponse(int defaultStatus)
    {
        Response.Headers["API-Version"] = "2.0";
        var code = CompatibilityAliasController.FirstErrorCode(_proxy.Errors);
        var status = code switch
        {
            "FORBIDDEN" => StatusCodes.Status403Forbidden,
            "NOT_FOUND" => StatusCodes.Status404NotFound,
            "UPLOAD_FAILED" => StatusCodes.Status500InternalServerError,
            _ => defaultStatus,
        };
        return StatusCode(status, new { errors = _proxy.Errors });
    }
}
