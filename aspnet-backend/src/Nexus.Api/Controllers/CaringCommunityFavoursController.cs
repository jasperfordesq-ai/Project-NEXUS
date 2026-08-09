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
[Route("api/caring-community")]
[Authorize]
public sealed class CaringCommunityFavoursController : ControllerBase
{
    private readonly CaringFavourService _favours;
    private readonly TenantContext _tenant;

    public CaringCommunityFavoursController(CaringFavourService favours, TenantContext tenant)
    {
        _favours = favours;
        _tenant = tenant;
    }

    [HttpPost("offer-favour")]
    public async Task<IActionResult> OfferFavour(
        [FromBody] OfferFavourRequest? request,
        CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _favours.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        try
        {
            var result = await _favours.OfferFavourAsync(
                tenantId,
                userId.Value,
                request?.Description,
                request?.Category,
                request?.FavourDate,
                request?.IsAnonymous ?? false,
                ct);

            if (!result.Succeeded)
            {
                return StatusCode(StatusCodes.Status422UnprocessableEntity, new { errors = result.Errors });
            }

            return StatusCode(StatusCodes.Status201Created, new { data = result.Data });
        }
        catch
        {
            return StatusCode(StatusCodes.Status500InternalServerError,
                LaravelError("SERVER_ERROR", "Server error."));
        }
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

public sealed class OfferFavourRequest
{
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("category")] public string? Category { get; set; }
    [JsonPropertyName("received_by_name")] public string? ReceivedByName { get; set; }
    [JsonPropertyName("favour_date")] public string? FavourDate { get; set; }
    [JsonPropertyName("is_anonymous")] public bool IsAnonymous { get; set; }
}
