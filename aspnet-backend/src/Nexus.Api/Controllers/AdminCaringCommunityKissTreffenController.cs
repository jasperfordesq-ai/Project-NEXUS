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
[Route("api/admin/caring-community/kiss-treffen")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityKissTreffenController : ControllerBase
{
    private readonly KissTreffenService _treffen;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityKissTreffenController(
        KissTreffenService treffen,
        TenantContext tenant)
    {
        _treffen = treffen;
        _tenant = tenant;
    }

    [HttpPut("{eventId:int}")]
    public async Task<IActionResult> Upsert(
        int eventId,
        [FromBody] KissTreffenUpsertRequest? request,
        CancellationToken ct = default)
    {
        if (User.GetUserId() is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        try
        {
            var data = await _treffen.UpsertAsync(
                _tenant.GetTenantIdOrThrow(),
                eventId,
                request?.TreffenType,
                request?.MembersOnly,
                request?.QuorumRequired,
                request?.FondationHeader,
                request?.MinutesDocumentUrl,
                request?.CoordinatorNotes,
                ct);

            return Ok(new { data });
        }
        catch (ArgumentException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", ex.Message));
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("KISS_TREFFEN_FAILED", ex.Message));
        }
    }

    [HttpPost("{eventId:int}/minutes")]
    public async Task<IActionResult> RecordMinutes(
        int eventId,
        [FromBody] KissTreffenMinutesRequest? request,
        CancellationToken ct = default)
    {
        var adminId = User.GetUserId();
        if (adminId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        try
        {
            var data = await _treffen.RecordMinutesAsync(
                _tenant.GetTenantIdOrThrow(),
                eventId,
                adminId.Value,
                request?.MinutesDocumentUrl,
                request?.CoordinatorNotes,
                ct);

            return Ok(new { data });
        }
        catch (ArgumentException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", ex.Message));
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("KISS_TREFFEN_FAILED", ex.Message));
        }
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _treffen.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        if (!await _treffen.IsAvailableAsync(ct))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                LaravelError("SERVICE_UNAVAILABLE", "Caring Community Treffen meeting records are not available for this community."));
        }

        return null;
    }

    private static object LaravelError(string code, string message)
    {
        return new
        {
            errors = new[]
            {
                new LaravelErrorRow(code, message)
            }
        };
    }
}

public sealed class KissTreffenMinutesRequest
{
    [JsonPropertyName("minutes_document_url")] public string? MinutesDocumentUrl { get; set; }
    [JsonPropertyName("coordinator_notes")] public string? CoordinatorNotes { get; set; }
}

public sealed class KissTreffenUpsertRequest
{
    [JsonPropertyName("treffen_type")] public string? TreffenType { get; set; }
    [JsonPropertyName("members_only")] public bool? MembersOnly { get; set; }
    [JsonPropertyName("quorum_required")] public int? QuorumRequired { get; set; }
    [JsonPropertyName("fondation_header")] public string? FondationHeader { get; set; }
    [JsonPropertyName("minutes_document_url")] public string? MinutesDocumentUrl { get; set; }
    [JsonPropertyName("coordinator_notes")] public string? CoordinatorNotes { get; set; }
}
