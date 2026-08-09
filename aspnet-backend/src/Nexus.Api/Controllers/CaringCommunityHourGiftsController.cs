// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/caring-community/hour-gifts")]
[Authorize]
public sealed class CaringCommunityHourGiftsController : ControllerBase
{
    private readonly CaringHourGiftService _gifts;
    private readonly TenantContext _tenant;

    public CaringCommunityHourGiftsController(
        CaringHourGiftService gifts,
        TenantContext tenant)
    {
        _gifts = gifts;
        _tenant = tenant;
    }

    [HttpGet("inbox")]
    public async Task<IActionResult> Inbox(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var items = await _gifts.InboxAsync(_tenant.GetTenantIdOrThrow(), userId.Value, ct);
        return Ok(new { data = new { items } });
    }

    [HttpGet("sent")]
    public async Task<IActionResult> Sent(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var items = await _gifts.SentAsync(_tenant.GetTenantIdOrThrow(), userId.Value, ct);
        return Ok(new { data = new { items } });
    }

    [HttpPost("send")]
    public async Task<IActionResult> Send(
        [FromBody] CaringHourGiftSendRequest? request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        if (request?.RecipientUserId is null or <= 0)
        {
            return UnprocessableEntity(LaravelError("VALIDATION_ERROR", "Field is required."));
        }

        if (request.Hours <= 0)
        {
            return UnprocessableEntity(LaravelError("VALIDATION_ERROR", "Field is required."));
        }

        try
        {
            var result = await _gifts.SendAsync(
                _tenant.GetTenantIdOrThrow(),
                userId.Value,
                request.RecipientUserId.Value,
                request.Hours,
                request.Message,
                ct);
            return StatusCode(StatusCodes.Status201Created, new { data = result });
        }
        catch (ArgumentException ex)
        {
            return UnprocessableEntity(LaravelError("VALIDATION_ERROR", ex.Message));
        }
        catch (InvalidOperationException ex)
        {
            var code = ex.Message.Contains("Insufficient", StringComparison.OrdinalIgnoreCase)
                ? "INSUFFICIENT_HOURS"
                : "GIFT_FAILED";
            return UnprocessableEntity(LaravelError(code, ex.Message));
        }
    }

    [HttpPost("{id}/accept")]
    public async Task<IActionResult> Accept(long id, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        try
        {
            await _gifts.AcceptAsync(_tenant.GetTenantIdOrThrow(), id, userId.Value, ct);
        }
        catch (InvalidOperationException ex)
        {
            return UnprocessableEntity(LaravelError("GIFT_ACCEPT_FAILED", ex.Message));
        }

        return Ok(new { data = new { success = true } });
    }

    [HttpPost("{id}/decline")]
    public async Task<IActionResult> Decline(
        long id,
        [FromBody] CaringHourGiftDeclineRequest? request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        try
        {
            await _gifts.DeclineAsync(_tenant.GetTenantIdOrThrow(), id, userId.Value, request?.Reason, ct);
        }
        catch (InvalidOperationException ex)
        {
            return UnprocessableEntity(LaravelError("GIFT_DECLINE_FAILED", ex.Message));
        }

        return Ok(new { data = new { success = true } });
    }

    [HttpPost("{id}/revert")]
    public async Task<IActionResult> Revert(long id, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        try
        {
            await _gifts.RevertAsync(_tenant.GetTenantIdOrThrow(), id, userId.Value, ct);
        }
        catch (InvalidOperationException ex)
        {
            return UnprocessableEntity(LaravelError("GIFT_REVERT_FAILED", ex.Message));
        }

        return Ok(new { data = new { success = true } });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _gifts.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private static object LaravelError(string code, string message)
    {
        return new
        {
            errors = new[]
            {
                new
                {
                    code,
                    message
                }
            }
        };
    }
}

public sealed class CaringHourGiftDeclineRequest
{
    [JsonPropertyName("reason")]
    public string? Reason { get; set; }
}

public sealed class CaringHourGiftSendRequest
{
    [JsonPropertyName("recipient_user_id")]
    public int? RecipientUserId { get; set; }

    [JsonPropertyName("hours")]
    public decimal Hours { get; set; }

    [JsonPropertyName("message")]
    public string? Message { get; set; }
}
