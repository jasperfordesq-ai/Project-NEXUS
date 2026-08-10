// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Services;
using System.Security.Claims;
using System.Text.Json;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/caring-community/research")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityResearchController : ControllerBase
{
    private readonly CaringResearchPartnershipService _research;
    private readonly ResearchAgreementTemplateService _templates;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityResearchController(
        CaringResearchPartnershipService research,
        ResearchAgreementTemplateService templates,
        TenantContext tenant)
    {
        _research = research;
        _templates = templates;
        _tenant = tenant;
    }

    [HttpGet("agreement-templates")]
    public async Task<IActionResult> AgreementTemplates(CancellationToken ct)
    {
        var guard = await GuardResearchAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        return Ok(new
        {
            data = new
            {
                templates = _templates.ListTemplates()
            }
        });
    }

    [HttpPost("agreement-templates/{key}/render")]
    public async Task<IActionResult> RenderAgreementTemplate(string key, [FromBody] Dictionary<string, object?>? request, CancellationToken ct)
    {
        var guard = await GuardResearchAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        try
        {
            return Ok(new
            {
                data = _templates.Render(key, ExtractTemplateValues(request))
            });
        }
        catch (ArgumentException ex)
        {
            return StatusCode(StatusCodes.Status404NotFound,
                LaravelError("TEMPLATE_NOT_FOUND", ex.Message));
        }
    }

    [HttpGet("partners")]
    public async Task<IActionResult> Partners(CancellationToken ct)
    {
        var guard = await GuardResearchAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var partners = await _research.ListPartnersAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data = new { partners } });
    }

    [HttpPost("partners")]
    public async Task<IActionResult> CreatePartner([FromBody] Dictionary<string, object?>? request, CancellationToken ct)
    {
        var guard = await GuardResearchAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        if (!TryCreatePartnerInput(request, out var input))
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "Validation failed."));
        }

        try
        {
            var partner = await _research.CreatePartnerAsync(
                _tenant.GetTenantIdOrThrow(),
                CurrentUserId(),
                input,
                ct);

            return StatusCode(StatusCodes.Status201Created, new { data = partner });
        }
        catch (CaringResearchValidationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", ex.Message));
        }
    }

    [HttpGet("dataset-exports")]
    public async Task<IActionResult> DatasetExports([FromQuery(Name = "partner_id")] int? partnerId, CancellationToken ct)
    {
        var guard = await GuardResearchAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var exports = await _research.ListDatasetExportsAsync(_tenant.GetTenantIdOrThrow(), partnerId, ct);
        return Ok(new { data = new { exports } });
    }

    [HttpPost("partners/{partnerId}/dataset-exports")]
    public async Task<IActionResult> GenerateDatasetExport(long partnerId, [FromBody] Dictionary<string, object?>? request, CancellationToken ct)
    {
        var guard = await GuardResearchAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        if (request is null
            || !TryDateOnly(request, "period_start", out var periodStart)
            || !TryDateOnly(request, "period_end", out var periodEnd)
            || periodStart is null
            || periodEnd is null
            || periodEnd.Value < periodStart.Value)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "Validation failed."));
        }

        try
        {
            var result = await _research.GenerateDatasetExportAsync(
                _tenant.GetTenantIdOrThrow(),
                partnerId,
                CurrentUserId(),
                periodStart.Value,
                periodEnd.Value,
                ct);

            return StatusCode(StatusCodes.Status201Created, new { data = result });
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("RESEARCH_EXPORT_FAILED", ex.Message));
        }
    }

    [HttpPost("dataset-exports/{exportId}/revoke")]
    public async Task<IActionResult> RevokeDatasetExport(long exportId, CancellationToken ct)
    {
        var guard = await GuardResearchAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        try
        {
            var export = await _research.RevokeDatasetExportAsync(
                _tenant.GetTenantIdOrThrow(),
                exportId,
                CurrentUserId(),
                ct);

            return Ok(new { data = export });
        }
        catch (KeyNotFoundException ex)
        {
            return StatusCode(StatusCodes.Status404NotFound,
                LaravelError("RESEARCH_EXPORT_NOT_FOUND", ex.Message));
        }
    }

    private async Task<IActionResult?> GuardResearchAsync(CancellationToken ct)
    {
        if (!await _research.IsCaringCommunityEnabledAsync(_tenant.GetTenantIdOrThrow(), ct))
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

    private static IReadOnlyDictionary<string, string> ExtractTemplateValues(Dictionary<string, object?>? request)
    {
        if (request is null || !request.TryGetValue("values", out var values) || values is null)
        {
            return new Dictionary<string, string>();
        }

        if (values is JsonElement json)
        {
            return ExtractTemplateValues(json);
        }

        if (values is not IDictionary<string, object?> dictionary)
        {
            return new Dictionary<string, string>();
        }

        return dictionary
            .Select(item => (item.Key, Value: CoerceScalar(item.Value)))
            .Where(item => item.Value is not null)
            .ToDictionary(item => item.Key, item => item.Value!);
    }

    private static IReadOnlyDictionary<string, string> ExtractTemplateValues(JsonElement values)
    {
        if (values.ValueKind != JsonValueKind.Object)
        {
            return new Dictionary<string, string>();
        }

        var result = new Dictionary<string, string>();
        foreach (var property in values.EnumerateObject())
        {
            var value = CoerceScalar(property.Value);
            if (value is not null)
            {
                result[property.Name] = value;
            }
        }

        return result;
    }

    private static string? CoerceScalar(object? value)
    {
        return value switch
        {
            null => null,
            JsonElement json => CoerceScalar(json),
            string text => text,
            bool flag => flag ? "true" : "false",
            byte or sbyte or short or ushort or int or uint or long or ulong or float or double or decimal => Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture),
            _ => null
        };
    }

    private static string? CoerceScalar(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => null
        };
    }

    private int CurrentUserId()
    {
        return int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)
            ? userId
            : 0;
    }

    private static bool TryCreatePartnerInput(
        Dictionary<string, object?>? request,
        out CaringResearchPartnerCreateInput input)
    {
        input = default!;
        if (request is null)
        {
            return false;
        }

        var name = ScalarString(request, "name")?.Trim();
        var institution = ScalarString(request, "institution")?.Trim();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(institution))
        {
            return false;
        }

        var contactEmail = BlankToNull(ScalarString(request, "contact_email"));
        if (contactEmail is not null)
        {
            try
            {
                _ = new System.Net.Mail.MailAddress(contactEmail);
            }
            catch (FormatException)
            {
                return false;
            }
        }

        var methodologyUrl = BlankToNull(ScalarString(request, "methodology_url"));
        if (methodologyUrl is not null
            && !Uri.TryCreate(methodologyUrl, UriKind.Absolute, out _))
        {
            return false;
        }

        var status = BlankToNull(ScalarString(request, "status")) ?? "draft";
        if (status is not ("draft" or "active" or "paused" or "ended"))
        {
            return false;
        }

        if (!TryDateOnly(request, "starts_at", out var startsAt)
            || !TryDateOnly(request, "ends_at", out var endsAt))
        {
            return false;
        }

        input = new CaringResearchPartnerCreateInput(
            name,
            institution,
            contactEmail,
            BlankToNull(ScalarString(request, "agreement_reference")),
            methodologyUrl,
            status,
            request.TryGetValue("data_scope", out var dataScope) ? dataScope : null,
            startsAt,
            endsAt);

        return true;
    }

    private static bool TryDateOnly(Dictionary<string, object?> request, string key, out DateOnly? value)
    {
        value = null;
        var raw = BlankToNull(ScalarString(request, key));
        if (raw is null)
        {
            return true;
        }

        if (!DateOnly.TryParse(raw, System.Globalization.CultureInfo.InvariantCulture, out var parsed))
        {
            return false;
        }

        value = parsed;
        return true;
    }

    private static string? BlankToNull(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
    }

    private static string? ScalarString(Dictionary<string, object?> request, string key)
    {
        return request.TryGetValue(key, out var value) ? CoerceScalar(value) : null;
    }
}
