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
/// Member self-service guardian endpoints — Laravel parity for
/// SafeguardingMemberController's guardian surface. The ward answers a
/// staff-proposed arrangement (consent / decline / withdraw) and grants or
/// takes back powers; the guardian gets a deliberately minimal read-only
/// view. Error shape quirks copied on purpose: a malformed assignment_id is
/// 422 VALIDATION_ERROR with the "Resource not found" message; not-yours and
/// not-live are an indistinguishable 404 so the endpoint cannot probe
/// others' arrangements.
/// </summary>
[ApiController]
[Authorize]
public class SafeguardingGuardianController : ControllerBase
{
    private readonly GuardianArrangementService _arrangements;

    public SafeguardingGuardianController(GuardianArrangementService arrangements)
    {
        _arrangements = arrangements;
    }

    [HttpGet("api/v2/safeguarding/my-guardians")]
    public async Task<IActionResult> MyGuardians()
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        return LaravelData(new
        {
            guardians = await _arrangements.ForWardAsync(userId.Value, HttpContext.RequestAborted),
            pending_count = await _arrangements.PendingCountForWardAsync(userId.Value, HttpContext.RequestAborted)
        });
    }

    [HttpGet("api/v2/safeguarding/my-wards")]
    public async Task<IActionResult> MyWards()
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        return LaravelData(new
        {
            wards = await _arrangements.ForGuardianAsync(userId.Value, HttpContext.RequestAborted)
        });
    }

    [HttpPost("api/v2/safeguarding/consent-to-guardian")]
    public Task<IActionResult> ConsentToGuardian([FromBody] JsonElement body)
        => RecordWardResponse(body, GuardianArrangementService.ActionConsented);

    [HttpPost("api/v2/safeguarding/decline-guardian")]
    public Task<IActionResult> DeclineGuardian([FromBody] JsonElement body)
        => RecordWardResponse(body, GuardianArrangementService.ActionDeclined);

    [HttpPost("api/v2/safeguarding/withdraw-guardian-consent")]
    public Task<IActionResult> WithdrawGuardianConsent([FromBody] JsonElement body)
        => RecordWardResponse(body, GuardianArrangementService.ActionWithdrawn);

    [HttpPost("api/v2/safeguarding/guardian-permissions")]
    public async Task<IActionResult> UpdateGuardianPermissions([FromBody] JsonElement body)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        if (!TryReadAssignmentId(body, out var assignmentId))
        {
            return LaravelError(422, "VALIDATION_ERROR", "Resource not found", "assignment_id");
        }

        if (body.ValueKind != JsonValueKind.Object
            || !body.TryGetProperty("tiers", out var tiersElement)
            || tiersElement.ValueKind != JsonValueKind.Object)
        {
            return LaravelError(422, "VALIDATION_ERROR", TiersInvalidMessage, "tiers");
        }

        var tiers = new Dictionary<string, string>();
        foreach (var property in tiersElement.EnumerateObject())
        {
            if (property.Value.ValueKind == JsonValueKind.String)
                tiers[property.Name] = property.Value.GetString() ?? "";
        }

        GuardianArrangementService.TiersResult result;
        try
        {
            result = await _arrangements.SetTiersAsync(
                userId.Value, assignmentId, tiers, HttpContext.RequestAborted);
        }
        catch (Exception ex)
        {
            // Safeguarding contact-policy refusal on expansion.
            return LaravelError(403, "SAFEGUARDING_CONTACT_RESTRICTED", ex.Message, null);
        }

        if (!result.Ok)
        {
            return result.Code == "NOT_FOUND"
                ? LaravelError(404, "NOT_FOUND", "Resource not found", null)
                : LaravelError(422, "VALIDATION_ERROR", TiersInvalidMessage, "tiers");
        }

        return LaravelData(new { tiers = result.Tiers });
    }

    private async Task<IActionResult> RecordWardResponse(JsonElement body, string action)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        if (!TryReadAssignmentId(body, out var assignmentId))
        {
            return LaravelError(422, "VALIDATION_ERROR", "Resource not found", "assignment_id");
        }

        string? reason = null;
        if (body.ValueKind == JsonValueKind.Object
            && body.TryGetProperty("reason", out var reasonElement)
            && reasonElement.ValueKind == JsonValueKind.String)
        {
            reason = reasonElement.GetString();
        }

        var result = await _arrangements.RespondAsync(
            userId.Value, assignmentId, action, reason,
            HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(),
            HttpContext.RequestAborted);

        if (!result.Ok)
        {
            return result.Code == "NOT_FOUND"
                ? LaravelError(404, "NOT_FOUND", "Resource not found", null)
                : LaravelError(422, "VALIDATION_ERROR",
                    "That response is not available for this arrangement.", null);
        }

        return LaravelData(new
        {
            state = result.State,
            already = result.Already,
            consent_given = result.State == "consented",
            already_given = result.Already && result.State == "consented"
        });
    }

    private static bool TryReadAssignmentId(JsonElement body, out int assignmentId)
    {
        assignmentId = 0;
        if (body.ValueKind != JsonValueKind.Object
            || !body.TryGetProperty("assignment_id", out var value))
        {
            return false;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out assignmentId)) return true;
        return value.ValueKind == JsonValueKind.String
            && int.TryParse(value.GetString(), out assignmentId);
    }

    private const string TiersInvalidMessage =
        "The permissions you chose could not be saved. Choose one of the offered levels";

    private IActionResult LaravelData(object data)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = (User.GetTenantId() ?? 0).ToString();
        return Ok(new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private IActionResult LaravelError(int status, string code, string message, string? field)
    {
        Response.Headers["API-Version"] = "2.0";
        if (field is null)
            return StatusCode(status, new { errors = new[] { new { code, message } } });
        return StatusCode(status, new { errors = new[] { new { code, message, field } } });
    }
}
