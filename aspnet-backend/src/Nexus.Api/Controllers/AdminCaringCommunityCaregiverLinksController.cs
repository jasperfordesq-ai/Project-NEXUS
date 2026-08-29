// Copyright © 2024–2026 Jasper Ford
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
[Route("api/admin/caring-community/caregiver-links")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityCaregiverLinksController : ControllerBase
{
    private readonly CaregiverSupportService _caregivers;
    private readonly SafeguardingInteractionPolicy _safeguarding;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityCaregiverLinksController(
        CaregiverSupportService caregivers,
        SafeguardingInteractionPolicy safeguarding,
        TenantContext tenant)
    {
        _caregivers = caregivers;
        _safeguarding = safeguarding;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index([FromQuery] string status = "pending", CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null) return guard;
        if (status is not ("pending" or "active" or "rejected" or "inactive"))
        {
            return UnprocessableEntity(LaravelError("VALIDATION_ERROR", "Caregiver link status is invalid.", "status"));
        }

        var data = await _caregivers.GetLinksForReviewAsync(_tenant.GetTenantIdOrThrow(), status, ct);
        return Ok(new { data });
    }

    [HttpPost("{id:int}/approve")]
    public async Task<IActionResult> Approve(
        int id,
        [FromBody] Dictionary<string, object?>? request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null) return guard;
        if (!RequestBool(request, "consent_verified"))
        {
            return UnprocessableEntity(LaravelError("VALIDATION_ERROR", "Explicit consent verification is required.", "consent_verified"));
        }

        var evidence = RequestString(request, "consent_evidence");
        if (evidence.Length == 0)
        {
            return UnprocessableEntity(LaravelError("VALIDATION_ERROR", "Consent evidence is required.", "consent_evidence"));
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        var pending = (await _caregivers.GetLinksForReviewAsync(tenantId, "pending", ct))
            .SingleOrDefault(link => link.Id == id);
        if (pending is null)
        {
            return NotFound(LaravelError("NOT_FOUND", "Pending caregiver link not found."));
        }
        if (pending.RecipientConfirmedAt is null)
        {
            return UnprocessableEntity(LaravelError("CONSENT_REQUIRED", "The care recipient must confirm this relationship before staff can approve it.", "recipient_confirmed_at"));
        }

        var caregiverToRecipient = await _safeguarding.EvaluateLocalContactAsync(
            pending.CaregiverId, pending.CaredForId, tenantId, "caring_caregiver_link_approval", ct);
        var recipientToCaregiver = await _safeguarding.EvaluateLocalContactAsync(
            pending.CaredForId, pending.CaregiverId, tenantId, "caring_caregiver_link_approval", ct);
        var approverId = User.GetUserId();
        if (approverId is null) return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));

        var result = await _caregivers.ApproveLinkAsync(
            tenantId, approverId.Value, id, evidence, caregiverToRecipient, recipientToCaregiver, ct);
        return MutationResult(result);
    }

    [HttpPost("{id:int}/reject")]
    public async Task<IActionResult> Reject(
        int id,
        [FromBody] Dictionary<string, object?>? request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null) return guard;
        var actorId = User.GetUserId();
        if (actorId is null) return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));

        var result = await _caregivers.RejectIncomingLinkAsync(
            _tenant.GetTenantIdOrThrow(), actorId.Value, id, RequestString(request, "reason"), staff: true, ct);
        return MutationResult(result);
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        return await _caregivers.IsFeatureEnabledAsync(_tenant.GetTenantIdOrThrow(), ct)
            ? null
            : StatusCode(StatusCodes.Status403Forbidden, LaravelError("FEATURE_DISABLED", "Service unavailable."));
    }

    private IActionResult MutationResult(CaregiverLinkMutationResult result)
    {
        return result.ErrorCode switch
        {
            "VALIDATION_ERROR" => UnprocessableEntity(LaravelError(result.ErrorCode, result.ErrorMessage ?? "Validation failed.", result.ErrorField)),
            "CONSENT_REQUIRED" => UnprocessableEntity(LaravelError(result.ErrorCode, result.ErrorMessage ?? "Care recipient confirmation is required.", result.ErrorField)),
            "NOT_FOUND" => NotFound(LaravelError(result.ErrorCode, result.ErrorMessage ?? "Caregiver link not found.")),
            "CONFLICT" => Conflict(LaravelError(result.ErrorCode, result.ErrorMessage ?? "Caregiver link conflict.")),
            "SAFEGUARDING_CONTACT_RESTRICTED" => StatusCode(StatusCodes.Status403Forbidden, LaravelError(result.ErrorCode, result.ErrorMessage ?? "Safeguarding policy restricted this relationship.")),
            _ => Ok(new { data = result.Row })
        };
    }

    private static bool RequestBool(IReadOnlyDictionary<string, object?>? request, string key)
    {
        if (request is null || !request.TryGetValue(key, out var value) || value is null) return false;
        if (value is JsonElement json) return json.ValueKind == JsonValueKind.True;
        return value is true || string.Equals(Convert.ToString(value, CultureInfo.InvariantCulture), "true", StringComparison.OrdinalIgnoreCase);
    }

    private static string RequestString(IReadOnlyDictionary<string, object?>? request, string key)
    {
        if (request is null || !request.TryGetValue(key, out var value) || value is null) return string.Empty;
        return value is JsonElement json
            ? json.ValueKind == JsonValueKind.String ? json.GetString()?.Trim() ?? string.Empty : json.ToString().Trim()
            : Convert.ToString(value, CultureInfo.InvariantCulture)?.Trim() ?? string.Empty;
    }

    private static object LaravelError(string code, string message, string? field = null)
    {
        var error = new Dictionary<string, object?> { ["code"] = code, ["message"] = message };
        if (field is not null) error["field"] = field;
        return new { errors = new[] { error } };
    }
}
