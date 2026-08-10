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
[Route("api/admin/caring-community")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityTandemSuggestionsController : ControllerBase
{
    private readonly CaringTandemMatchingService _tandems;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityTandemSuggestionsController(
        CaringTandemMatchingService tandems,
        TenantContext tenant)
    {
        _tandems = tandems;
        _tenant = tenant;
    }

    [HttpGet("tandem-suggestions")]
    public async Task<IActionResult> TandemSuggestions([FromQuery] int? limit, CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var guard = await GuardAsync(tenantId, ct);
        if (guard is not null)
        {
            return guard;
        }

        var suggestions = await _tandems.SuggestTandemsAsync(tenantId, limit, ct);
        return Ok(new
        {
            data = new
            {
                suggestions,
                generated_at = DateTime.UtcNow.ToString("O")
            }
        });
    }

    [HttpPost("tandem-suggestions/dismiss")]
    public async Task<IActionResult> DismissTandemSuggestion(
        [FromBody] TandemSuggestionDismissRequest? request,
        CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var guard = await GuardAsync(tenantId, ct);
        if (guard is not null)
        {
            return guard;
        }

        var supporterId = request?.SupporterId;
        var recipientId = request?.RecipientId;
        if (supporterId is null || recipientId is null || supporterId < 1 || recipientId < 1 || supporterId == recipientId)
        {
            return UnprocessableEntity(LaravelError("VALIDATION_ERROR", "Validation failed."));
        }

        await _tandems.MarkSuggestionAsConsideredAsync(
            tenantId,
            supporterId.Value,
            recipientId.Value,
            "dismissed",
            User.GetUserId(),
            ct);

        return Ok(new { data = new { success = true } });
    }

    private async Task<IActionResult?> GuardAsync(int tenantId, CancellationToken ct)
    {
        if (!await _tandems.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
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

public sealed class TandemSuggestionDismissRequest
{
    [JsonPropertyName("supporter_id")]
    public int? SupporterId { get; set; }

    [JsonPropertyName("recipient_id")]
    public int? RecipientId { get; set; }
}
