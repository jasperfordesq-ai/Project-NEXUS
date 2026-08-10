// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/caring-community/loyalty")]
[Authorize]
public sealed class CaringCommunityLoyaltyController : ControllerBase
{
    private readonly CaringLoyaltyService _loyalty;
    private readonly TenantContext _tenant;

    public CaringCommunityLoyaltyController(
        CaringLoyaltyService loyalty,
        TenantContext tenant)
    {
        _loyalty = loyalty;
        _tenant = tenant;
    }

    [HttpGet("quote")]
    public async Task<IActionResult> Quote(
        [FromQuery(Name = "seller_id")] int sellerId = 0,
        [FromQuery(Name = "listing_id")] int listingId = 0,
        [FromQuery(Name = "order_total_chf")] decimal orderTotalChf = 0m,
        CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        if (sellerId <= 0)
        {
            return Validation("seller_id");
        }

        if (listingId <= 0)
        {
            return Validation("listing_id");
        }

        if (orderTotalChf <= 0)
        {
            return Validation("order_total_chf");
        }

        var data = await _loyalty.CalculateAvailableDiscountAsync(
            _tenant.GetTenantIdOrThrow(),
            RequireUserId(),
            sellerId,
            orderTotalChf,
            listingId,
            ct);

        return Ok(new { data });
    }

    [HttpPost("redeem")]
    public async Task<IActionResult> Redeem(
        [FromBody] CaringLoyaltyRedeemRequest? request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        if (request is null)
        {
            return Validation("seller_id");
        }

        if (request.SellerId <= 0)
        {
            return Validation("seller_id");
        }

        var result = await _loyalty.RedeemAsync(
            _tenant.GetTenantIdOrThrow(),
            RequireUserId(),
            request,
            ct);

        return MutationResponse(result);
    }

    [HttpGet("my-history")]
    public async Task<IActionResult> MyHistory(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var items = await _loyalty.ListMemberHistoryAsync(
            _tenant.GetTenantIdOrThrow(),
            RequireUserId(),
            limit: 50,
            ct);

        return Ok(new { data = new { items } });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _loyalty.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private int RequireUserId()
    {
        return User.GetUserId() ?? throw new UnauthorizedAccessException("Invalid token");
    }

    private IActionResult MutationResponse(CaringLoyaltyMutationResult result)
    {
        if (result.Errors is { Count: > 0 })
        {
            return StatusCode(result.StatusCode, new { errors = result.Errors });
        }

        return Ok(new { data = result.Data });
    }

    private static IActionResult Validation(string field)
    {
        return new ObjectResult(LaravelError("VALIDATION_ERROR", "Field is required.", field))
        {
            StatusCode = StatusCodes.Status422UnprocessableEntity
        };
    }

    private static object LaravelError(string code, string message, string? field = null)
    {
        var error = new Dictionary<string, object?>
        {
            ["code"] = code,
            ["message"] = message
        };
        if (field is not null)
        {
            error["field"] = field;
        }

        return new { errors = new[] { error } };
    }
}

[ApiController]
[Route("api/admin/caring-community/loyalty")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityLoyaltyController : ControllerBase
{
    private readonly CaringLoyaltyService _loyalty;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityLoyaltyController(
        CaringLoyaltyService loyalty,
        TenantContext tenant)
    {
        _loyalty = loyalty;
        _tenant = tenant;
    }

    [HttpGet("redemptions")]
    public async Task<IActionResult> Redemptions(
        [FromQuery] int limit = 50,
        CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _loyalty.ListTenantRedemptionsAsync(
            _tenant.GetTenantIdOrThrow(),
            limit,
            ct);

        return Ok(new { data });
    }

    [HttpGet("seller-settings/{userId:int}")]
    public async Task<IActionResult> GetSellerSettings(int userId, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _loyalty.GetSellerSettingsAsync(
            _tenant.GetTenantIdOrThrow(),
            userId,
            ct);

        return Ok(new { data });
    }

    [HttpPut("seller-settings")]
    public async Task<IActionResult> UpdateSellerSettings(
        [FromBody] CaringLoyaltySellerSettingsRequest? request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        if (request is null)
        {
            return Validation("seller_user_id");
        }

        var result = await _loyalty.UpdateSellerSettingsAsync(
            _tenant.GetTenantIdOrThrow(),
            request,
            ct);

        return MutationResponse(result);
    }

    [HttpPost("redemptions/{id:int}/reverse")]
    public async Task<IActionResult> ReverseRedemption(
        int id,
        [FromBody] CaringLoyaltyReverseRequest? request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _loyalty.ReverseAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            request?.Reason,
            User.GetUserId() ?? 0,
            ct);

        return MutationResponse(result);
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _loyalty.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private IActionResult MutationResponse(CaringLoyaltyMutationResult result)
    {
        if (result.Errors is { Count: > 0 })
        {
            return StatusCode(result.StatusCode, new { errors = result.Errors });
        }

        return Ok(new { data = result.Data });
    }

    private static IActionResult Validation(string field)
    {
        return new ObjectResult(LaravelError("VALIDATION_ERROR", "Field is required.", field))
        {
            StatusCode = StatusCodes.Status422UnprocessableEntity
        };
    }

    private static object LaravelError(string code, string message, string? field = null)
    {
        var error = new Dictionary<string, object?>
        {
            ["code"] = code,
            ["message"] = message
        };
        if (field is not null)
        {
            error["field"] = field;
        }

        return new { errors = new[] { error } };
    }
}
