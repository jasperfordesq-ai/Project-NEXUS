// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Nexus.Api.Data;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Canonical Laravel V2 owner for the safeguarding step used by the React
/// onboarding wizard.
/// </summary>
[ApiController]
[Route("api/v2/onboarding")]
[Authorize]
public sealed class OnboardingSafeguardingController : ControllerBase
{
    private readonly OnboardingSafeguardingService _safeguarding;
    private readonly TenantContext _tenant;

    public OnboardingSafeguardingController(
        OnboardingSafeguardingService safeguarding,
        TenantContext tenant)
    {
        _safeguarding = safeguarding;
        _tenant = tenant;
    }

    [HttpGet("safeguarding-options")]
    public async Task<IActionResult> Options(CancellationToken cancellationToken)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var userId = CurrentUserId();
        var locale = await _safeguarding.ResolveLocaleAsync(
            tenantId,
            userId,
            Request.Headers.AcceptLanguage.FirstOrDefault(),
            cancellationToken);
        var options = await _safeguarding.GetOptionsAsync(tenantId, locale, cancellationToken);
        return await LaravelDataAsync(options.Select(option => new
        {
            id = option.Id,
            option_key = option.OptionKey,
            option_type = option.OptionType,
            label = option.Label,
            description = option.Description,
            help_url = option.HelpUrl,
            is_required = option.IsRequired,
            select_options = option.SelectOptions
        }).ToArray(), tenantId, cancellationToken);
    }

    [HttpPost("safeguarding")]
    [EnableRateLimiting(RateLimitingExtensions.SafeguardingOnboardingMutationPolicy)]
    public async Task<IActionResult> Save(CancellationToken cancellationToken)
    {
        IReadOnlyList<OnboardingSafeguardingPreferenceInput> preferences;
        try
        {
            preferences = await ReadPreferencesAsync(cancellationToken);
        }
        catch (OnboardingSafeguardingValidationException exception)
        {
            return LaravelError(exception.Message, "preferences");
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        var userId = CurrentUserId();
        var locale = await _safeguarding.ResolveLocaleAsync(
            tenantId,
            userId,
            Request.Headers.AcceptLanguage.FirstOrDefault(),
            cancellationToken);
        try
        {
            await _safeguarding.SavePreferencesAsync(
                tenantId,
                userId,
                preferences,
                HttpContext.Connection.RemoteIpAddress?.ToString(),
                locale,
                cancellationToken);
        }
        catch (OnboardingSafeguardingValidationException exception)
        {
            return LaravelError(exception.Message, "preferences");
        }

        return await LaravelDataAsync(new
        {
            message = "Safeguarding preferences saved",
            preferences_count = preferences.Count
        }, tenantId, cancellationToken);
    }

    private async Task<IReadOnlyList<OnboardingSafeguardingPreferenceInput>> ReadPreferencesAsync(
        CancellationToken cancellationToken)
    {
        JsonDocument? document = null;
        try
        {
            document = await JsonDocument.ParseAsync(Request.Body, cancellationToken: cancellationToken);
        }
        catch (JsonException)
        {
            throw EmptyPreferences();
        }

        using (document)
        {
            if (document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty("preferences", out var array)
                || array.ValueKind != JsonValueKind.Array
                || array.GetArrayLength() == 0)
            {
                throw EmptyPreferences();
            }

            var result = new List<OnboardingSafeguardingPreferenceInput>(array.GetArrayLength());
            var index = 0;
            foreach (var item in array.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object
                    || !item.TryGetProperty("option_id", out var optionIdElement)
                    || IsPhpEmpty(optionIdElement))
                {
                    throw new OnboardingSafeguardingValidationException(
                        $"preferences[{index}].option_id is required");
                }

                var optionId = ParseOptionId(optionIdElement);
                var value = item.TryGetProperty("value", out var valueElement)
                    ? ScalarString(valueElement)
                    : "1";
                if (value is null)
                {
                    throw new OnboardingSafeguardingValidationException(
                        "The selected safeguarding value is invalid.");
                }
                var notes = item.TryGetProperty("notes", out var notesElement)
                    ? NullableScalarString(notesElement)
                    : null;
                if (item.TryGetProperty("notes", out notesElement)
                    && notesElement.ValueKind is JsonValueKind.Array or JsonValueKind.Object)
                {
                    throw new OnboardingSafeguardingValidationException(
                        "One or more safeguarding options are invalid.");
                }

                result.Add(new OnboardingSafeguardingPreferenceInput(optionId, value, notes));
                index++;
            }
            return result;
        }
    }

    private async Task<ObjectResult> LaravelDataAsync(
        object data,
        int tenantId,
        CancellationToken cancellationToken)
    {
        ApplyV2Headers(tenantId);
        var origin = $"{Request.Scheme}://{Request.Host}{Request.PathBase}";
        var baseUrl = await _safeguarding.ResolveBaseUrlAsync(tenantId, origin, cancellationToken);
        return Ok(new
        {
            data,
            meta = new { base_url = baseUrl }
        });
    }

    private ObjectResult LaravelError(string message, string field)
    {
        ApplyV2Headers(_tenant.GetTenantIdOrThrow());
        return StatusCode(StatusCodes.Status422UnprocessableEntity, new
        {
            errors = new[]
            {
                new
                {
                    code = "VALIDATION_ERROR",
                    message,
                    field
                }
            }
        });
    }

    private void ApplyV2Headers(int tenantId)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = tenantId.ToString(CultureInfo.InvariantCulture);
    }

    private int CurrentUserId()
    {
        var raw = User.FindFirst("sub")?.Value
            ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out var userId)
            ? userId
            : throw new InvalidOperationException("Authenticated user ID claim is missing.");
    }

    private static int ParseOptionId(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var numeric))
        {
            return numeric;
        }
        if (value.ValueKind == JsonValueKind.String
            && int.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out numeric))
        {
            return numeric;
        }
        if (value.ValueKind == JsonValueKind.True)
        {
            return 1;
        }
        return 0;
    }

    private static bool IsPhpEmpty(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.False => true,
        JsonValueKind.Number => value.TryGetDecimal(out var number) && number == 0,
        JsonValueKind.String => string.IsNullOrEmpty(value.GetString()) || value.GetString() == "0",
        JsonValueKind.Array => value.GetArrayLength() == 0,
        JsonValueKind.Object => !value.EnumerateObject().Any(),
        _ => false
    };

    private static string? NullableScalarString(JsonElement value)
        => value.ValueKind == JsonValueKind.Null ? null : ScalarString(value);

    private static string? ScalarString(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString(),
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.True => "1",
        JsonValueKind.False or JsonValueKind.Null => string.Empty,
        _ => null
    };

    private static OnboardingSafeguardingValidationException EmptyPreferences()
        => new("preferences must be a non-empty array of {option_id, value}");
}
