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
[Route("api/caring-community/leads")]
public sealed class CaringCommunityLeadCaptureController : ControllerBase
{
    private readonly LeadNurtureService _leads;
    private readonly TenantContext _tenant;

    public CaringCommunityLeadCaptureController(
        LeadNurtureService leads,
        TenantContext tenant)
    {
        _leads = leads;
        _tenant = tenant;
    }

    [HttpPost("capture")]
    public async Task<IActionResult> Capture([FromBody] LeadCaptureRequest request, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var sourceIp = HttpContext.Connection.RemoteIpAddress?.ToString();
        var result = await _leads.CaptureAsync(_tenant.GetTenantIdOrThrow(), request, sourceIp, ct);
        if (result.Errors is { Count: > 0 })
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, new { errors = result.Errors });
        }

        return Ok(new
        {
            data = new
            {
                contact_id = result.Contact?.Id,
                duplicate = result.Duplicate,
                segment = result.Contact?.Segment,
                stage = result.Contact?.Stage
            }
        });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _leads.IsFeatureEnabledAsync(tenantId, ct))
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

[ApiController]
[Route("api/admin/caring-community/leads")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityLeadNurtureController : ControllerBase
{
    private readonly LeadNurtureService _leads;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityLeadNurtureController(
        LeadNurtureService leads,
        TenantContext tenant)
    {
        _leads = leads;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index(
        [FromQuery] string? segment = null,
        [FromQuery] string? stage = null,
        [FromQuery] int? limit = null,
        CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _leads.ListContactsAsync(_tenant.GetTenantIdOrThrow(), segment, stage, limit, ct);
        return Ok(new { data });
    }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _leads.SummaryAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpGet("export.csv")]
    public async Task<IActionResult> ExportCsv(
        [FromQuery] string? segment = null,
        CancellationToken ct = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _leads.IsFeatureEnabledAsync(tenantId, ct))
        {
            return new ContentResult
            {
                Content = "feature disabled",
                ContentType = "text/plain",
                StatusCode = StatusCodes.Status403Forbidden
            };
        }

        var csv = await _leads.ExportCsvAsync(tenantId, segment, ct);
        Response.Headers.ContentDisposition = "attachment; filename=\"lead-nurture-export.csv\"";
        return Content(csv, "text/csv; charset=UTF-8");
    }

    [HttpPut("{contactId}")]
    public async Task<IActionResult> Update(
        string contactId,
        [FromBody] JsonElement payload,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _leads.UpdateAsync(_tenant.GetTenantIdOrThrow(), contactId, payload, ct);
        return MutationResponse(result);
    }

    [HttpPost("{contactId}/unsubscribe")]
    public async Task<IActionResult> Unsubscribe(string contactId, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _leads.UnsubscribeAsync(_tenant.GetTenantIdOrThrow(), contactId, ct);
        return MutationResponse(result);
    }

    private IActionResult MutationResponse(LeadNurtureMutationResult result)
    {
        if (result.Errors is { Count: > 0 })
        {
            var status = result.Errors[0].Code == "NOT_FOUND"
                ? StatusCodes.Status404NotFound
                : StatusCodes.Status422UnprocessableEntity;

            return StatusCode(status, new { errors = result.Errors });
        }

        return Ok(new { data = result.Contact });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _leads.IsFeatureEnabledAsync(tenantId, ct))
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
