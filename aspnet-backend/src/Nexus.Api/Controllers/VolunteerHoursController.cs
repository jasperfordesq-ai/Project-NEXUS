// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v2/volunteering/hours")]
public sealed class VolunteerHoursController : ControllerBase
{
    private readonly VolunteerHoursService _hours;
    private readonly TenantContext _tenant;
    private readonly NexusDbContext _db;

    public VolunteerHoursController(
        VolunteerHoursService hours,
        TenantContext tenant,
        NexusDbContext db)
    {
        _hours = hours;
        _tenant = tenant;
        _db = db;
    }

    [HttpGet]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerHoursListPolicy)]
    public async Task<IActionResult> MyHours(
        [FromQuery(Name = "per_page")] string? perPage,
        [FromQuery] string? cursor,
        CancellationToken ct)
    {
        var tenantId = TenantId();
        SetV2Headers(tenantId);
        if (!await _hours.IsFeatureEnabledAsync(tenantId, ct))
            return Error(403, "FEATURE_DISABLED", "Volunteering feature is disabled.");

        var page = await _hours.ListMyHoursAsync(
            tenantId,
            UserId(),
            PerPage(perPage),
            cursor,
            ct);
        return Ok(new
        {
            data = new
            {
                items = page.Items,
                cursor = page.Cursor,
                has_more = page.HasMore
            },
            meta = await BaseMetaAsync(tenantId, ct)
        });
    }

    [HttpPost]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerHoursLogPolicy)]
    public async Task<IActionResult> LogHours(
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] VolunteerHoursLogRequest? request,
        CancellationToken ct)
    {
        var tenantId = TenantId();
        SetV2Headers(tenantId);
        if (!await _hours.IsFeatureEnabledAsync(tenantId, ct))
            return Error(403, "FEATURE_DISABLED", "Volunteering feature is disabled.");

        var parseError = ParseLogRequest(request, out var command);
        if (parseError is not null)
            return Error(parseError.StatusCode, parseError.Code, parseError.Message, parseError.Field);

        var result = await _hours.LogAsync(tenantId, UserId(), command!, ct);
        if (!result.IsSuccess)
            return ServiceError(result.Error!);

        return StatusCode(StatusCodes.Status201Created, new
        {
            data = new
            {
                id = result.Value!.Id,
                status = result.Value.Status,
                message = result.Value.Message
            },
            meta = await BaseMetaAsync(tenantId, ct)
        });
    }

    [HttpGet("summary")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerHoursSummaryPolicy)]
    public async Task<IActionResult> Summary(CancellationToken ct)
    {
        var tenantId = TenantId();
        SetV2Headers(tenantId);
        if (!await _hours.IsFeatureEnabledAsync(tenantId, ct))
            return Error(403, "FEATURE_DISABLED", "Volunteering feature is disabled.");

        return Ok(new
        {
            data = await _hours.SummaryAsync(tenantId, UserId(), ct),
            meta = await BaseMetaAsync(tenantId, ct)
        });
    }

    [HttpGet("pending-review")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerHoursPendingReviewPolicy)]
    public async Task<IActionResult> PendingReview(
        [FromQuery(Name = "per_page")] string? perPage,
        [FromQuery] string? cursor,
        CancellationToken ct)
    {
        var tenantId = TenantId();
        SetV2Headers(tenantId);
        if (!await _hours.IsFeatureEnabledAsync(tenantId, ct))
            return Error(403, "FEATURE_DISABLED", "Volunteering feature is disabled.");

        var page = await _hours.PendingForReviewerAsync(
            tenantId,
            UserId(),
            PerPage(perPage),
            cursor,
            ct);
        return Ok(new
        {
            data = new
            {
                items = page.Items,
                cursor = page.Cursor,
                has_more = page.HasMore
            },
            meta = await BaseMetaAsync(tenantId, ct)
        });
    }

    [HttpPut("{id:int}/verify")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerHoursVerifyPolicy)]
    public async Task<IActionResult> Verify(
        int id,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] VolunteerHoursVerifyRequest? request,
        CancellationToken ct)
    {
        var tenantId = TenantId();
        SetV2Headers(tenantId);
        if (!await _hours.IsFeatureEnabledAsync(tenantId, ct))
            return Error(403, "FEATURE_DISABLED", "Volunteering feature is disabled.");

        var action = request?.Action is JsonElement { ValueKind: JsonValueKind.String } actionElement
            ? actionElement.GetString()
            : null;
        if (action is not ("approve" or "decline"))
            return Error(422, "VALIDATION_ERROR", "Action must be approve or decline.", "action");

        var result = await _hours.VerifyAsync(
            tenantId,
            UserId(),
            id,
            action,
            tenantAdministrator: false,
            ct);
        if (!result.IsSuccess)
            return ServiceError(result.Error!);

        return Ok(new
        {
            data = new
            {
                id = result.Value!.Id,
                status = result.Value.Status,
                payment_result = result.Value.PaymentOutcome
            },
            meta = await BaseMetaAsync(tenantId, ct)
        });
    }

    [HttpGet("/api/v2/volunteering/organisations/{organisationId:int}/hours/pending")]
    [EnableRateLimiting(RateLimitingExtensions.VolunteerHoursOrganisationPendingPolicy)]
    public async Task<IActionResult> OrganisationPending(
        int organisationId,
        [FromQuery(Name = "per_page")] string? perPage,
        [FromQuery] string? cursor,
        CancellationToken ct)
    {
        var tenantId = TenantId();
        SetV2Headers(tenantId);
        if (!await _hours.IsFeatureEnabledAsync(tenantId, ct))
            return Error(403, "FEATURE_DISABLED", "Volunteering feature is disabled.");

        var result = await _hours.PendingForOrganisationAsync(
            tenantId,
            UserId(),
            organisationId,
            PerPage(perPage),
            cursor,
            User.IsAdmin(),
            ct);
        if (!result.IsSuccess)
            return ServiceError(result.Error!);

        var page = result.Page!;
        return Ok(new
        {
            data = page.Items,
            meta = CollectionMeta(page, await BaseUrlAsync(tenantId, ct))
        });
    }

    private IActionResult ServiceError(VolunteerHoursError error) =>
        Error(error.StatusCode, error.Code, error.Message, error.Field);

    private IActionResult Error(int status, string code, string message, string? field = null)
    {
        var error = new Dictionary<string, object?>
        {
            ["code"] = code,
            ["message"] = message
        };
        if (field is not null)
            error["field"] = field;
        return StatusCode(status, new { errors = new[] { error } });
    }

    private async Task<object> BaseMetaAsync(int tenantId, CancellationToken ct) =>
        new { base_url = await BaseUrlAsync(tenantId, ct) };

    private static Dictionary<string, object?> CollectionMeta(
        VolunteerHoursPage page,
        string baseUrl)
    {
        var meta = new Dictionary<string, object?>
        {
            ["base_url"] = baseUrl,
            ["per_page"] = page.PerPage,
            ["has_more"] = page.HasMore
        };
        if (page.Cursor is not null)
            meta["cursor"] = page.Cursor;
        return meta;
    }

    private async Task<string> BaseUrlAsync(int tenantId, CancellationToken ct)
    {
        var domain = await _db.Tenants
            .AsNoTracking()
            .Where(tenant => tenant.Id == tenantId)
            .Select(tenant => tenant.Domain)
            .SingleOrDefaultAsync(ct);
        return NormalizeBaseUrl(domain, $"{Request.Scheme}://{Request.Host}");
    }

    private static string NormalizeBaseUrl(string? domain, string fallback)
    {
        if (string.IsNullOrWhiteSpace(domain))
            return fallback.TrimEnd('/');
        var trimmed = domain.Trim().TrimEnd('/');
        return Uri.TryCreate(trimmed, UriKind.Absolute, out var absolute)
            && absolute.Scheme is "http" or "https"
                ? absolute.ToString().TrimEnd('/')
                : $"https://{trimmed}";
    }

    private int TenantId() => _tenant.GetTenantIdOrThrow();

    private int UserId() => User.GetUserId()
        ?? throw new InvalidOperationException("Authenticated user id is required.");

    private void SetV2Headers(int tenantId)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = tenantId.ToString(CultureInfo.InvariantCulture);
    }

    private static int PerPage(string? raw) =>
        int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? Math.Clamp(parsed, 1, 50)
            : 20;

    private static VolunteerHoursError? ParseLogRequest(
        VolunteerHoursLogRequest? request,
        out VolunteerHourLogCommand? command)
    {
        command = null;
        if (request is null)
            return new(422, "VALIDATION_ERROR", "Organisation is required.", "organization_id");

        var organisationId = Integer(request.OrganizationId);
        if (request.OrganizationId is { } orgElement
            && orgElement.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined)
            && organisationId is null)
        {
            return new(422, "VALIDATION_ERROR", "Organisation must be an integer.", "organization_id");
        }

        var opportunityId = Integer(request.OpportunityId);
        if (request.OpportunityId is { } opportunityElement
            && opportunityElement.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined)
            && opportunityId is null)
        {
            return new(422, "VALIDATION_ERROR", "Opportunity must be an integer.", "opportunity_id");
        }
        if (opportunityId == 0)
            opportunityId = null;

        var hours = Decimal(request.Hours);
        if (request.Hours is { } hoursElement
            && hoursElement.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined)
            && hours is null)
        {
            return new(422, "VALIDATION_ERROR", "Hours must be numeric.", "hours");
        }

        var date = String(request.Date);
        if (request.Date is { } dateElement
            && dateElement.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined)
            && date is null)
        {
            return new(422, "VALIDATION_ERROR", "Date must be a string.", "date");
        }

        var description = String(request.Description);
        if (request.Description is { } descriptionElement
            && descriptionElement.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined)
            && description is null)
        {
            return new(422, "VALIDATION_ERROR", "Description must be a string.", "description");
        }

        command = new(organisationId, opportunityId, date, hours, description);
        return null;
    }

    private static int? Integer(JsonElement? element)
    {
        if (element is null || element.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;
        if (element.Value.ValueKind == JsonValueKind.Number
            && element.Value.TryGetInt32(out var number))
            return number;
        return element.Value.ValueKind == JsonValueKind.String
            && int.TryParse(element.Value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out number)
                ? number
                : null;
    }

    private static decimal? Decimal(JsonElement? element)
    {
        if (element is null || element.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;
        if (element.Value.ValueKind == JsonValueKind.Number
            && element.Value.TryGetDecimal(out var number))
            return number;
        return element.Value.ValueKind == JsonValueKind.String
            && decimal.TryParse(
                element.Value.GetString(),
                NumberStyles.Float,
                CultureInfo.InvariantCulture,
                out number)
                ? number
                : null;
    }

    private static string? String(JsonElement? element)
    {
        if (element is null || element.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return null;
        return element.Value.ValueKind == JsonValueKind.String
            ? element.Value.GetString()
            : null;
    }
}

[ApiController]
[Authorize(Policy = "AdminOnly")]
[Route("api/v2/admin/volunteering/hours")]
public sealed class AdminVolunteerHoursController : ControllerBase
{
    private readonly VolunteerHoursService _hours;
    private readonly TenantContext _tenant;
    private readonly NexusDbContext _db;

    public AdminVolunteerHoursController(
        VolunteerHoursService hours,
        TenantContext tenant,
        NexusDbContext db)
    {
        _hours = hours;
        _tenant = tenant;
        _db = db;
    }

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery(Name = "per_page")] string? perPage,
        [FromQuery] string? cursor,
        [FromQuery] string? status,
        CancellationToken ct)
    {
        var tenantId = TenantId();
        SetV2Headers(tenantId);
        if (!await _hours.IsFeatureEnabledAsync(tenantId, ct))
            return Error(403, "FEATURE_DISABLED", "Service unavailable.");

        var page = await _hours.AdminListAsync(
            tenantId,
            PerPage(perPage),
            cursor,
            status,
            ct);
        var topMeta = new Dictionary<string, object?>
        {
            ["base_url"] = await BaseUrlAsync(tenantId, ct),
            ["per_page"] = page.PerPage,
            ["has_more"] = page.HasMore,
            ["next_cursor"] = page.NextCursor
        };
        return Ok(new
        {
            data = new
            {
                items = page.Items,
                stats = page.Stats,
                meta = page.Meta
            },
            meta = topMeta
        });
    }

    [HttpPost("{id:int}/verify")]
    public async Task<IActionResult> Verify(
        int id,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] VolunteerHoursVerifyRequest? request,
        CancellationToken ct)
    {
        var tenantId = TenantId();
        SetV2Headers(tenantId);
        if (!await _hours.IsFeatureEnabledAsync(tenantId, ct))
            return Error(403, "FEATURE_DISABLED", "Service unavailable.");

        var action = request?.Action is JsonElement { ValueKind: JsonValueKind.String } actionElement
            ? actionElement.GetString()
            : null;
        if (action is not ("approve" or "decline"))
            return Error(400, "VALIDATION_ERROR", "Decision is required.", "action");

        var result = await _hours.VerifyAsync(
            tenantId,
            User.GetUserId() ?? throw new InvalidOperationException("Authenticated user id is required."),
            id,
            action,
            tenantAdministrator: true,
            ct);
        if (!result.IsSuccess)
            return Error(
                result.Error!.StatusCode,
                result.Error.Code,
                result.Error.Message,
                result.Error.Field);

        return Ok(new
        {
            data = new
            {
                id = result.Value!.Id,
                status = result.Value.Status,
                paid = result.Value.PaymentOutcome == "paid",
                payment_outcome = result.Value.PaymentOutcome
            },
            meta = new { base_url = await BaseUrlAsync(tenantId, ct) }
        });
    }

    private IActionResult Error(int status, string code, string message, string? field = null)
    {
        var error = new Dictionary<string, object?>
        {
            ["code"] = code,
            ["message"] = message
        };
        if (field is not null)
            error["field"] = field;
        return StatusCode(status, new { errors = new[] { error } });
    }

    private int TenantId() => _tenant.GetTenantIdOrThrow();

    private void SetV2Headers(int tenantId)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = tenantId.ToString(CultureInfo.InvariantCulture);
    }

    private async Task<string> BaseUrlAsync(int tenantId, CancellationToken ct)
    {
        var domain = await _db.Tenants
            .AsNoTracking()
            .Where(tenant => tenant.Id == tenantId)
            .Select(tenant => tenant.Domain)
            .SingleOrDefaultAsync(ct);
        if (string.IsNullOrWhiteSpace(domain))
            return $"{Request.Scheme}://{Request.Host}".TrimEnd('/');
        var trimmed = domain.Trim().TrimEnd('/');
        return Uri.TryCreate(trimmed, UriKind.Absolute, out var absolute)
            && absolute.Scheme is "http" or "https"
                ? absolute.ToString().TrimEnd('/')
                : $"https://{trimmed}";
    }

    private static int PerPage(string? raw) =>
        int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? Math.Clamp(parsed, 1, 50)
            : 20;
}

public sealed class VolunteerHoursLogRequest
{
    [JsonPropertyName("organization_id")]
    public JsonElement? OrganizationId { get; init; }

    [JsonPropertyName("opportunity_id")]
    public JsonElement? OpportunityId { get; init; }

    [JsonPropertyName("date")]
    public JsonElement? Date { get; init; }

    [JsonPropertyName("hours")]
    public JsonElement? Hours { get; init; }

    [JsonPropertyName("description")]
    public JsonElement? Description { get; init; }
}

public sealed class VolunteerHoursVerifyRequest
{
    [JsonPropertyName("action")]
    public JsonElement? Action { get; init; }
}
