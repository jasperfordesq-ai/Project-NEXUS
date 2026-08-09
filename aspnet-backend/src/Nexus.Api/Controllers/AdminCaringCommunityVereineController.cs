// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/caring-community/vereine")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityVereineController : ControllerBase
{
    private readonly CaringCommunityVereineAdminService _vereine;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityVereineController(
        CaringCommunityVereineAdminService vereine,
        TenantContext tenant)
    {
        _vereine = vereine;
        _tenant = tenant;
    }

    [HttpPost("{organizationId}/members/import/preview")]
    public async Task<IActionResult> PreviewVereinMemberImport(
        int organizationId,
        [FromBody] Dictionary<string, object?>? request,
        CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _vereine.PreviewVereinMemberImportAsync(
            _tenant.GetTenantIdOrThrow(),
            organizationId,
            StringValue(request, "csv"),
            ct);

        return ImportResult(result, StatusCodes.Status200OK);
    }

    [HttpPost("{organizationId}/members/import")]
    public async Task<IActionResult> ImportVereinMembers(
        int organizationId,
        [FromBody] Dictionary<string, object?>? request,
        CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _vereine.ImportVereinMembersAsync(
            _tenant.GetTenantIdOrThrow(),
            organizationId,
            User.GetUserId() ?? 0,
            StringValue(request, "csv"),
            ct);

        return ImportResult(result, StatusCodes.Status201Created);
    }

    [HttpPost("{organizationId}/admins")]
    public async Task<IActionResult> AssignVereinAdmin(
        int organizationId,
        [FromBody] Dictionary<string, object?>? request,
        CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        var userId = IntValue(request, "user_id");
        if (userId <= 0)
        {
            return UnprocessableEntity(LaravelError(
                "VALIDATION_ERROR",
                "The user_id field is required.",
                "user_id"));
        }

        var result = await _vereine.AssignVereinAdminAsync(
            tenantId,
            organizationId,
            userId,
            User.GetUserId() ?? 0,
            ct);

        if (!result.Succeeded)
        {
            var code = result.ErrorCode ?? "VALIDATION_ERROR";
            var status = code == "VEREIN_ADMIN_UNAVAILABLE"
                ? StatusCodes.Status503ServiceUnavailable
                : StatusCodes.Status422UnprocessableEntity;
            var message = code == "VEREIN_ADMIN_UNAVAILABLE"
                ? "Verein admin assignment is unavailable."
                : "Verein admin assignment could not be completed.";

            return StatusCode(status, LaravelError(code, message));
        }

        return StatusCode(StatusCodes.Status201Created, new { data = result.Payload });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        if (!await _vereine.IsFeatureEnabledAsync(_tenant.GetTenantIdOrThrow(), ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private IActionResult ImportResult(VereinAdminAssignmentResult result, int successStatus)
    {
        if (result.Succeeded)
        {
            return StatusCode(successStatus, new { data = result.Payload });
        }

        var code = result.ErrorCode ?? "VALIDATION_ERROR";
        var status = code == "VEREIN_IMPORT_UNAVAILABLE"
            ? StatusCodes.Status503ServiceUnavailable
            : StatusCodes.Status422UnprocessableEntity;
        var message = code == "VEREIN_IMPORT_UNAVAILABLE"
            ? "Verein member import is unavailable."
            : "Verein member import could not be completed.";

        return StatusCode(status, LaravelError(code, message));
    }

    private static string StringValue(IReadOnlyDictionary<string, object?>? request, string key)
    {
        if (request is null || !request.TryGetValue(key, out var value) || value is null)
        {
            return string.Empty;
        }

        return value switch
        {
            string text => text,
            JsonElement json when json.ValueKind == JsonValueKind.String => json.GetString() ?? string.Empty,
            JsonElement json => json.ToString(),
            _ => Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty
        };
    }

    private static int IntValue(IReadOnlyDictionary<string, object?>? request, string key)
    {
        if (request is null || !request.TryGetValue(key, out var value) || value is null)
        {
            return 0;
        }

        return value switch
        {
            int number => number,
            long number when number <= int.MaxValue && number >= int.MinValue => (int)number,
            decimal number when number <= int.MaxValue && number >= int.MinValue => (int)number,
            double number when number <= int.MaxValue && number >= int.MinValue => (int)number,
            float number when number <= int.MaxValue && number >= int.MinValue => (int)number,
            string text when int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) => parsed,
            JsonElement json => JsonIntValue(json),
            _ => 0
        };
    }

    private static int JsonIntValue(JsonElement json)
    {
        if (json.ValueKind == JsonValueKind.Number && json.TryGetInt32(out var number))
        {
            return number;
        }

        return json.ValueKind == JsonValueKind.String
            && int.TryParse(json.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
                ? parsed
                : 0;
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
