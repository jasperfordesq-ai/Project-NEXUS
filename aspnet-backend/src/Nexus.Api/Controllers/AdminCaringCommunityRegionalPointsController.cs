// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Services;
using System.Security.Claims;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/caring-community/regional-points")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityRegionalPointsController : ControllerBase
{
    private readonly CaringRegionalPointService _regionalPoints;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityRegionalPointsController(
        CaringRegionalPointService regionalPoints,
        TenantContext tenant)
    {
        _regionalPoints = regionalPoints;
        _tenant = tenant;
    }

    [HttpGet("config")]
    public async Task<IActionResult> Config(CancellationToken ct)
    {
        var guard = await GuardCaringCommunityAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _regionalPoints.GetConfigAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpPut("config")]
    public async Task<IActionResult> UpdateConfig([FromBody] JsonElement payload, CancellationToken ct)
    {
        var guard = await GuardCaringCommunityAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _regionalPoints.UpdateConfigAsync(_tenant.GetTenantIdOrThrow(), payload, ct);
        return Ok(new { data });
    }

    [HttpGet("ledger")]
    public async Task<IActionResult> Ledger([FromQuery] int? limit, CancellationToken ct)
    {
        var guard = await GuardRegionalPointsAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        try
        {
            var data = await _regionalPoints.TenantLedgerAsync(_tenant.GetTenantIdOrThrow(), limit, ct);
            return Ok(new { data });
        }
        catch (RegionalPointFeatureDisabledException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, LaravelError("FEATURE_DISABLED", ex.Message));
        }
    }

    [HttpPost("issue")]
    public async Task<IActionResult> Issue([FromBody] JsonElement payload, CancellationToken ct)
    {
        var guard = await GuardRegionalPointsAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = ReadInt(payload, "user_id");
        if (userId <= 0)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "This field is required.", "user_id"));
        }

        try
        {
            var data = await _regionalPoints.IssueAsync(
                _tenant.GetTenantIdOrThrow(),
                userId,
                ReadDecimal(payload, "points"),
                ReadString(payload, "description") ?? string.Empty,
                CurrentUserId(),
                ct);

            return StatusCode(StatusCodes.Status201Created, new { data });
        }
        catch (RegionalPointValidationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", ex.Message));
        }
        catch (RegionalPointFeatureDisabledException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", ex.Message));
        }
    }

    [HttpPost("adjust")]
    public async Task<IActionResult> Adjust([FromBody] JsonElement payload, CancellationToken ct)
    {
        var guard = await GuardRegionalPointsAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = ReadInt(payload, "user_id");
        if (userId <= 0)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "This field is required.", "user_id"));
        }

        try
        {
            var data = await _regionalPoints.AdjustAsync(
                _tenant.GetTenantIdOrThrow(),
                userId,
                ReadDecimal(payload, "points_delta"),
                ReadString(payload, "description") ?? string.Empty,
                CurrentUserId(),
                ct);

            return Ok(new { data });
        }
        catch (RegionalPointValidationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", ex.Message));
        }
        catch (RegionalPointOperationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("REGIONAL_POINTS_FAILED", ex.Message));
        }
    }

    [HttpGet("seller-settings/{userId:int}")]
    public async Task<IActionResult> GetSellerSettings(int userId, CancellationToken ct)
    {
        var guard = await GuardRegionalPointsAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        try
        {
            var data = await _regionalPoints.GetMarketplaceSellerSettingsAsync(_tenant.GetTenantIdOrThrow(), userId, ct);
            return Ok(new { data });
        }
        catch (RegionalPointFeatureDisabledException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, LaravelError("FEATURE_DISABLED", ex.Message));
        }
    }

    [HttpPut("seller-settings")]
    public async Task<IActionResult> UpdateSellerSettings([FromBody] JsonElement payload, CancellationToken ct)
    {
        var guard = await GuardRegionalPointsAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var sellerId = ReadInt(payload, "seller_user_id");
        if (sellerId <= 0)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "This field is required.", "seller_user_id"));
        }

        try
        {
            var data = await _regionalPoints.UpdateMarketplaceSellerSettingsAsync(
                _tenant.GetTenantIdOrThrow(),
                sellerId,
                ReadBool(payload, "accepts_regional_points"),
                ReadDecimal(payload, "regional_points_per_chf", 10m),
                ReadInt(payload, "regional_points_max_discount_pct", 25),
                ct);

            return Ok(new { data });
        }
        catch (RegionalPointValidationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", ex.Message));
        }
        catch (RegionalPointOperationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("REGIONAL_POINTS_SELLER_SETTINGS_FAILED", ex.Message));
        }
    }

    private async Task<IActionResult?> GuardCaringCommunityAsync(CancellationToken ct)
    {
        if (!await _regionalPoints.IsCaringCommunityEnabledAsync(_tenant.GetTenantIdOrThrow(), ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private async Task<IActionResult?> GuardRegionalPointsAsync(CancellationToken ct)
    {
        var caringGuard = await GuardCaringCommunityAsync(ct);
        if (caringGuard is not null)
        {
            return caringGuard;
        }

        if (!await _regionalPoints.IsRegionalPointsEnabledAsync(_tenant.GetTenantIdOrThrow(), ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Regional points are not enabled for this community."));
        }

        return null;
    }

    private int CurrentUserId()
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return int.TryParse(raw, out var value) ? value : 0;
    }

    private static int ReadInt(JsonElement payload, string key, int fallback = 0)
    {
        if (payload.ValueKind != JsonValueKind.Object || !payload.TryGetProperty(key, out var value))
        {
            return fallback;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number => value.TryGetInt32(out var number) ? number : fallback,
            JsonValueKind.String => int.TryParse(value.GetString(), out var number) ? number : fallback,
            JsonValueKind.True => 1,
            JsonValueKind.False => 0,
            _ => fallback
        };
    }

    private static decimal ReadDecimal(JsonElement payload, string key, decimal fallback = 0m)
    {
        if (payload.ValueKind != JsonValueKind.Object || !payload.TryGetProperty(key, out var value))
        {
            return fallback;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number => value.TryGetDecimal(out var number) ? number : fallback,
            JsonValueKind.String => decimal.TryParse(value.GetString(), out var number) ? number : fallback,
            _ => fallback
        };
    }

    private static bool ReadBool(JsonElement payload, string key, bool fallback = false)
    {
        if (payload.ValueKind != JsonValueKind.Object || !payload.TryGetProperty(key, out var value))
        {
            return fallback;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => value.TryGetDecimal(out var number) ? number != 0m : fallback,
            JsonValueKind.String => value.GetString()?.Trim().ToLowerInvariant() switch
            {
                "1" or "true" or "yes" or "on" => true,
                "0" or "false" or "no" or "off" => false,
                _ => fallback
            },
            _ => fallback
        };
    }

    private static string? ReadString(JsonElement payload, string key)
    {
        return payload.ValueKind == JsonValueKind.Object
            && payload.TryGetProperty(key, out var value)
            && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;
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
