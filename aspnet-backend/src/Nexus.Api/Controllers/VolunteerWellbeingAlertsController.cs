// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v2/admin/volunteering/wellbeing/alerts")]
public sealed class VolunteerWellbeingAlertsController : ControllerBase
{
    private static readonly string[] AlertStatuses = ["active", "acknowledged", "resolved", "dismissed"];
    private static readonly string[] UpdateStatuses = ["acknowledged", "resolved", "dismissed"];
    private static readonly HashSet<string> AdminRoles = new(StringComparer.Ordinal)
    {
        "admin",
        "tenant_admin",
        "tenant_super_admin",
        "super_admin",
        "god"
    };

    private readonly VolunteerWellbeingAlertService _service;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<VolunteerWellbeingAlertsController> _logger;

    public VolunteerWellbeingAlertsController(
        VolunteerWellbeingAlertService service,
        TenantContext tenantContext,
        ILogger<VolunteerWellbeingAlertsController> logger)
    {
        _service = service;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    [HttpGet]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerWellbeingAlertsPolicy)]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        SetCompatibilityHeaders(tenantId);

        if (!await _service.IsFeatureEnabledAsync(tenantId, ct))
        {
            return Error(
                StatusCodes.Status403Forbidden,
                "FEATURE_DISABLED",
                "Volunteering module is not enabled for this community");
        }

        if (!IsModuleAdmin())
        {
            return Error(StatusCodes.Status403Forbidden, "FORBIDDEN", "Admin access required");
        }

        var status = Request.Query["status"].FirstOrDefault();
        if (string.IsNullOrEmpty(status) || status == "0")
        {
            status = "active";
        }

        if (!AlertStatuses.Contains(status, StringComparer.Ordinal))
        {
            return Error(
                StatusCodes.Status422UnprocessableEntity,
                "VALIDATION_ERROR",
                $"Invalid status. Must be one of: {string.Join(", ", AlertStatuses)}",
                "status");
        }

        var alerts = await _service.ListAsync(tenantId, status, ct);
        return Ok(new
        {
            data = alerts.Select(alert => new
            {
                id = alert.Id,
                user_id = alert.UserId,
                user_name = alert.UserName,
                avatar_url = alert.AvatarUrl,
                risk_level = alert.RiskLevel,
                risk_score = alert.RiskScore,
                indicators = alert.Indicators,
                coordinator_notified = alert.CoordinatorNotified,
                coordinator_notes = alert.CoordinatorNotes,
                status = alert.Status,
                created_at = alert.CreatedAt,
                updated_at = alert.UpdatedAt
            }),
            meta = new
            {
                base_url = BaseUrl(),
                per_page = alerts.Count,
                has_more = false
            }
        });
    }

    [HttpPut("{id:int}")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerWellbeingAlertUpdatePolicy)]
    public async Task<IActionResult> Update(int id, CancellationToken ct)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        SetCompatibilityHeaders(tenantId);

        if (!await _service.IsFeatureEnabledAsync(tenantId, ct))
        {
            return Error(
                StatusCodes.Status403Forbidden,
                "FEATURE_DISABLED",
                "Volunteering module is not enabled for this community");
        }

        if (!IsModuleAdmin())
        {
            return Error(StatusCodes.Status403Forbidden, "FORBIDDEN", "Admin access required");
        }

        var payload = await ReadPayloadAsync(ct);
        var status = ReadPhpScalar(payload, "status", string.Empty);
        if (!UpdateStatuses.Contains(status, StringComparer.Ordinal))
        {
            return Error(
                StatusCodes.Status422UnprocessableEntity,
                "VALIDATION_ERROR",
                $"Invalid status. Must be one of: {string.Join(", ", UpdateStatuses)}",
                "status");
        }

        var note = ReadOptionalPhpScalar(payload, "note");
        if (note is not null)
        {
            note = note.Trim();
            if (note.Length == 0)
            {
                note = null;
            }
        }

        try
        {
            if (!await _service.UpdateAsync(tenantId, id, status, note, ct))
            {
                return Error(StatusCodes.Status404NotFound, "NOT_FOUND", "Alert not found");
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to update wellbeing alert {AlertId} for tenant {TenantId}", id, tenantId);
            // Preserve Laravel's current getErrorStatus quirk: SERVER_ERROR falls
            // through to its default 400 rather than being mapped to 500.
            return Error(StatusCodes.Status400BadRequest, "SERVER_ERROR", "Failed to update alert status");
        }

        return Ok(new
        {
            data = new { id, status },
            meta = new { base_url = BaseUrl() }
        });
    }

    private bool IsModuleAdmin()
    {
        var role = User.GetRole() ?? "member";
        return AdminRoles.Contains(role);
    }

    private void SetCompatibilityHeaders(int tenantId)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = tenantId.ToString();
    }

    private string BaseUrl() => $"{Request.Scheme}://{Request.Host}".TrimEnd('/');

    private ObjectResult Error(int status, string code, string message, string? field = null)
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

        return StatusCode(status, new { errors = new[] { error } });
    }

    private async Task<JsonElement?> ReadPayloadAsync(CancellationToken ct)
    {
        try
        {
            using var document = await JsonDocument.ParseAsync(Request.Body, cancellationToken: ct);
            return document.RootElement.ValueKind == JsonValueKind.Object
                ? document.RootElement.Clone()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string ReadPhpScalar(JsonElement? payload, string property, string defaultValue)
    {
        return ReadOptionalPhpScalar(payload, property) ?? defaultValue;
    }

    private static string? ReadOptionalPhpScalar(JsonElement? payload, string property)
    {
        if (payload is null ||
            payload.Value.ValueKind != JsonValueKind.Object ||
            !payload.Value.TryGetProperty(property, out var value) ||
            value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.True => "1",
            JsonValueKind.False => string.Empty,
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.Array or JsonValueKind.Object => "Array",
            _ => null
        };
    }
}
