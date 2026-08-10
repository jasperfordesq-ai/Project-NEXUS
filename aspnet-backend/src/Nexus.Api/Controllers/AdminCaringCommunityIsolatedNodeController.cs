// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/caring-community/isolated-node")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityIsolatedNodeController : ControllerBase
{
    private readonly IsolatedNodeReadinessService _readiness;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityIsolatedNodeController(
        IsolatedNodeReadinessService readiness,
        TenantContext tenant)
    {
        _readiness = readiness;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _readiness.GetAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpPut("items/{itemKey}")]
    public async Task<IActionResult> Update(
        string itemKey,
        [FromBody] JsonElement payload,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        if (!_readiness.Schema.Any(row => row.Key == itemKey))
        {
            return StatusCode(StatusCodes.Status404NotFound,
                LaravelError("INVALID_ITEM_KEY", $"Unknown decision-gate item: {itemKey}", "item_key"));
        }

        var fields = ParsePayload(payload);
        if (fields.Count == 0)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("EMPTY_PAYLOAD", "At least one of value, owner, status, or notes must be provided."));
        }

        var result = await _readiness.UpdateAsync(
            _tenant.GetTenantIdOrThrow(),
            itemKey,
            fields,
            ct);

        if (result.Errors is { Count: > 0 })
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, new { errors = result.Errors });
        }

        return Ok(new { data = new { item = result.Item, gate = result.Gate } });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _readiness.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private static IReadOnlyDictionary<string, JsonElement> ParsePayload(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object)
        {
            return new Dictionary<string, JsonElement>();
        }

        var fields = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var property in payload.EnumerateObject())
        {
            if (property.Name is "value" or "owner" or "status" or "notes")
            {
                fields[property.Name] = property.Value.Clone();
            }
        }

        return fields;
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
