// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/caring-community")]
[Authorize]
public sealed class CaringCommunityMemberController : ControllerBase
{
    private readonly CaringSupportRelationshipService _relationships;
    private readonly CaringSafeguardingService _safeguarding;
    private readonly CaringCommunityDataExportService _dataExport;
    private readonly CaringCommunityAhvPensionExportService _ahvPensionExport;
    private readonly CaringCommunityFutureCareFundService _futureCareFund;
    private readonly CaringRegionalPointService _regionalPoints;
    private readonly CaringResearchPartnershipService _research;
    private readonly CaringCommunityVereineAdminService _vereine;
    private readonly TenantContext _tenant;
    private readonly NexusDbContext _db;

    public CaringCommunityMemberController(
        CaringSupportRelationshipService relationships,
        CaringSafeguardingService safeguarding,
        CaringCommunityDataExportService dataExport,
        CaringCommunityAhvPensionExportService ahvPensionExport,
        CaringCommunityFutureCareFundService futureCareFund,
        CaringRegionalPointService regionalPoints,
        CaringResearchPartnershipService research,
        CaringCommunityVereineAdminService vereine,
        TenantContext tenant,
        NexusDbContext db)
    {
        _relationships = relationships;
        _safeguarding = safeguarding;
        _dataExport = dataExport;
        _ahvPensionExport = ahvPensionExport;
        _futureCareFund = futureCareFund;
        _regionalPoints = regionalPoints;
        _research = research;
        _vereine = vereine;
        _tenant = tenant;
        _db = db;
    }

    [HttpGet("my-relationships")]
    public async Task<IActionResult> MyRelationships(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var data = await _relationships.ListForMemberAsync(_tenant.GetTenantIdOrThrow(), userId.Value, ct);
        return Ok(new { data });
    }

    [HttpGet("safeguarding/my-reports")]
    public async Task<IActionResult> SafeguardingMyReports(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var items = await _safeguarding.MyReportsAsync(_tenant.GetTenantIdOrThrow(), userId.Value, ct);
        return Ok(new { data = new { items } });
    }

    [HttpPost("safeguarding/report")]
    public async Task<IActionResult> SafeguardingReport(
        [FromBody] JsonElement payload,
        CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        var result = await _safeguarding.SubmitReportAsync(
            _tenant.GetTenantIdOrThrow(),
            user.UserId!.Value,
            new Dictionary<string, object?>
            {
                ["category"] = ReadString(payload, "category"),
                ["severity"] = ReadString(payload, "severity"),
                ["description"] = ReadString(payload, "description"),
                ["subject_user_id"] = ReadNullableInt(payload, "subject_user_id"),
                ["subject_organisation_id"] = ReadNullableInt(payload, "subject_organisation_id"),
                ["evidence_url"] = ReadString(payload, "evidence_url")
            },
            ct);

        if (!result.Succeeded)
        {
            var code = result.ErrorCode == "VALIDATION_ERROR"
                ? "VALIDATION_ERROR"
                : "REPORT_FAILED";
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError(code, result.ErrorMessage ?? "Validation failed."));
        }

        return StatusCode(StatusCodes.Status201Created, new
        {
            data = new
            {
                report_id = result.ReportId,
                success = true
            }
        });
    }

    [HttpPost("request-help")]
    public async Task<IActionResult> RequestHelp(
        [FromBody] JsonElement payload,
        CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        var result = await _relationships.CreateMemberHelpRequestAsync(
            _tenant.GetTenantIdOrThrow(),
            user.UserId!.Value,
            new Dictionary<string, object?>
            {
                ["what"] = ReadString(payload, "what"),
                ["when"] = ReadString(payload, "when"),
                ["contact_preference"] = ReadString(payload, "contact_preference")
            },
            ct);

        if (!result.Succeeded)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelErrors(result.Errors ?? Array.Empty<MemberHelpRequestError>()));
        }

        return StatusCode(StatusCodes.Status201Created, new
        {
            data = new
            {
                success = true,
                message = "Help request submitted."
            }
        });
    }

    [HttpPost("request-help/voice")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<IActionResult> RequestHelpVoice(
        [FromForm] IFormFile? audio,
        [FromForm] string? locale,
        CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        if (audio is null || audio.Length <= 0)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "Validation failed.", "audio"));
        }

        if (audio.Length > 10 * 1024 * 1024)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "Validation failed.", "audio"));
        }

        var mime = audio.ContentType ?? string.Empty;
        if (!mime.StartsWith("audio/", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(mime, "video/webm", StringComparison.OrdinalIgnoreCase))
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "Validation failed.", "audio"));
        }

        await using var stream = audio.OpenReadStream();
        var result = await _relationships.ProcessMemberHelpRequestVoiceAsync(
            _tenant.GetTenantIdOrThrow(),
            user.UserId!.Value,
            stream,
            audio.FileName,
            mime,
            SanitizeLocale(locale),
            ct);

        if (!result.Succeeded)
        {
            return StatusCode(StatusCodes.Status502BadGateway,
                LaravelError("TRANSCRIPTION_FAILED", "Server error."));
        }

        return Ok(new
        {
            data = new
            {
                transcript = result.Transcript,
                detected_language = result.DetectedLanguage,
                suggested_category = result.SuggestedCategory,
                suggested_when = result.SuggestedWhen,
                suggested_contact_preference = result.SuggestedContactPreference,
                raw_text = result.RawText
            }
        });
    }

    [HttpPost("vereine/{organizationId}/members/import/preview")]
    public async Task<IActionResult> PreviewVereinMemberImport(
        int organizationId,
        [FromBody] JsonElement payload,
        CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        var result = await _vereine.PreviewVereinMemberImportAsync(
            _tenant.GetTenantIdOrThrow(),
            organizationId,
            ReadString(payload, "csv") ?? string.Empty,
            ct);

        return ImportResult(result, StatusCodes.Status200OK);
    }

    [HttpPost("vereine/{organizationId}/members/import")]
    public async Task<IActionResult> ImportVereinMembers(
        int organizationId,
        [FromBody] JsonElement payload,
        CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        var result = await _vereine.ImportVereinMembersAsync(
            _tenant.GetTenantIdOrThrow(),
            organizationId,
            user.UserId!.Value,
            ReadString(payload, "csv") ?? string.Empty,
            ct);

        return ImportResult(result, StatusCodes.Status201Created);
    }

    [HttpGet("me/data-export")]
    public async Task<IActionResult> MyDataExport(CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        var payload = await _dataExport.BuildAsync(
            _tenant.GetTenantIdOrThrow(),
            user.UserId!.Value,
            ct);

        var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
        {
            WriteIndented = true
        });
        var fileName = $"my-data-{user.UserId.Value}-{DateTime.UtcNow:yyyy-MM-dd}.json";

        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private";
        Response.Headers["Pragma"] = "no-cache";

        return File(
            Encoding.UTF8.GetBytes(json),
            "application/json; charset=utf-8",
            fileName);
    }

    [HttpGet("my-ahv-pension-export")]
    public async Task<IActionResult> MyAhvPensionExport(
        [FromQuery(Name = "from")] string? fromDate,
        [FromQuery(Name = "to")] string? toDate,
        CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        var data = await _ahvPensionExport.BuildAsync(
            _tenant.GetTenantIdOrThrow(),
            user.UserId!.Value,
            fromDate,
            toDate,
            ct);

        return Ok(new { data });
    }

    [HttpPut("me/onboarding-choice")]
    public async Task<IActionResult> SetOnboardingChoice(
        [FromBody] CaringCommunityOnboardingChoiceRequest? request,
        CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        var choice = request?.Choice ?? string.Empty;
        if (choice is not ("recipient" or "helper" or "browse"))
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "Validation failed.", "choice"));
        }

        var row = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item =>
                item.TenantId == _tenant.GetTenantIdOrThrow()
                && item.Id == user.UserId!.Value,
                ct);

        if (row is not null)
        {
            row.NotificationPreferences = UpsertOnboardingChoice(row.NotificationPreferences, choice);
            row.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }

        return Ok(new { data = new { success = true, choice } });
    }

    [HttpGet("my-future-care-fund")]
    public async Task<IActionResult> MyFutureCareFund(CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        var data = await _futureCareFund.SummaryAsync(
            _tenant.GetTenantIdOrThrow(),
            user.UserId!.Value,
            ct);

        return Ok(new { data });
    }

    [HttpGet("regional-points/summary")]
    public async Task<IActionResult> RegionalPointsSummary(CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        try
        {
            var data = await _regionalPoints.MemberSummaryAsync(
                _tenant.GetTenantIdOrThrow(),
                user.UserId!.Value,
                ct);

            return Ok(new { data });
        }
        catch (RegionalPointFeatureDisabledException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", ex.Message));
        }
    }

    [HttpGet("regional-points/history")]
    public async Task<IActionResult> RegionalPointsHistory(
        [FromQuery] int? limit,
        CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        try
        {
            var items = await _regionalPoints.MemberHistoryAsync(
                _tenant.GetTenantIdOrThrow(),
                user.UserId!.Value,
                limit,
                ct);

            return Ok(new { data = new { items } });
        }
        catch (RegionalPointFeatureDisabledException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", ex.Message));
        }
    }

    [HttpPost("regional-points/transfer")]
    public async Task<IActionResult> RegionalPointsTransfer(
        [FromBody] JsonElement payload,
        CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        var recipientId = ReadInt(payload, "recipient_user_id");
        if (recipientId <= 0)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "Validation failed.", "recipient_user_id"));
        }

        try
        {
            var data = await _regionalPoints.TransferBetweenMembersAsync(
                _tenant.GetTenantIdOrThrow(),
                user.UserId!.Value,
                recipientId,
                ReadDecimal(payload, "points"),
                ReadString(payload, "message"),
                ct);

            return StatusCode(StatusCodes.Status201Created, new { data });
        }
        catch (RegionalPointValidationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", ex.Message));
        }
        catch (RegionalPointOperationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("REGIONAL_POINTS_TRANSFER_FAILED", ex.Message));
        }
        catch (RegionalPointFeatureDisabledException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("REGIONAL_POINTS_TRANSFER_FAILED", ex.Message));
        }
    }

    [HttpGet("regional-points/marketplace/quote")]
    public async Task<IActionResult> RegionalPointsMarketplaceQuote(
        [FromQuery(Name = "seller_id")] int sellerId,
        [FromQuery(Name = "listing_id")] int? listingId,
        [FromQuery(Name = "order_total_chf")] decimal orderTotalChf,
        CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        if (sellerId <= 0)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "Validation failed.", "seller_id"));
        }

        if (orderTotalChf <= 0m)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "Validation failed.", "order_total_chf"));
        }

        var data = await _regionalPoints.CalculateMarketplaceDiscountAsync(
            _tenant.GetTenantIdOrThrow(),
            user.UserId!.Value,
            sellerId,
            listingId,
            orderTotalChf,
            ct);

        return Ok(new { data });
    }

    [HttpPost("regional-points/marketplace/redeem")]
    public async Task<IActionResult> RegionalPointsMarketplaceRedeem(
        [FromBody] JsonElement payload,
        CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        var sellerId = ReadInt(payload, "seller_id");
        if (sellerId <= 0)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "Validation failed.", "seller_id"));
        }

        try
        {
            var result = await _regionalPoints.RedeemForMarketplaceDiscountAsync(
                _tenant.GetTenantIdOrThrow(),
                user.UserId!.Value,
                sellerId,
                ReadNullableInt(payload, "listing_id"),
                ReadDecimal(payload, "points_to_use"),
                ReadDecimal(payload, "order_total_chf"),
                ct);

            return StatusCode(StatusCodes.Status201Created, new { data = result with { Success = true } });
        }
        catch (RegionalPointValidationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", ex.Message));
        }
        catch (RegionalPointFeatureDisabledException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", ex.Message));
        }
        catch (RegionalPointOperationException ex)
        {
            var code = ex.Message.Contains("not enough", StringComparison.OrdinalIgnoreCase)
                ? "INSUFFICIENT_REGIONAL_POINTS"
                : "REGIONAL_POINTS_REDEMPTION_FAILED";
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError(code, ex.Message));
        }
    }

    [HttpGet("research/consent")]
    public async Task<IActionResult> ResearchConsent(CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        var data = await _research.GetConsentAsync(
            _tenant.GetTenantIdOrThrow(),
            user.UserId!.Value,
            ct);

        return Ok(new { data });
    }

    [HttpPut("research/consent")]
    public async Task<IActionResult> UpdateResearchConsent(
        [FromBody] ResearchConsentRequest? request,
        CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        try
        {
            var data = await _research.RecordConsentAsync(
                _tenant.GetTenantIdOrThrow(),
                user.UserId!.Value,
                request?.ConsentStatus ?? string.Empty,
                request?.Notes,
                ct);

            return Ok(new { data });
        }
        catch (CaringResearchValidationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", ex.Message, "consent_status"));
        }
    }

    [HttpPost("my-relationships/{id:int}/pause")]
    public async Task<IActionResult> PauseRelationship(
        int id,
        [FromBody] RelationshipLifecycleRequest? request,
        CancellationToken ct)
    {
        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        var result = await _relationships.PauseRelationshipAsync(
            _tenant.GetTenantIdOrThrow(),
            user.UserId!.Value,
            id,
            request?.ResumeAt,
            ct);

        return LifecycleResponse(result);
    }

    [HttpPost("my-relationships/{id:int}/end")]
    public async Task<IActionResult> EndRelationship(
        int id,
        [FromBody] RelationshipLifecycleRequest? request,
        CancellationToken ct)
    {
        _ = request;

        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        var result = await _relationships.EndRelationshipAsync(
            _tenant.GetTenantIdOrThrow(),
            user.UserId!.Value,
            id,
            ct);

        return LifecycleResponse(result);
    }

    [HttpPost("my-relationships/{id:int}/resume")]
    public async Task<IActionResult> ResumeRelationship(
        int id,
        [FromBody] RelationshipLifecycleRequest? request,
        CancellationToken ct)
    {
        _ = request;

        var user = await GuardAndUserAsync(ct);
        if (user.Result is not null)
        {
            return user.Result;
        }

        var result = await _relationships.ResumeRelationshipAsync(
            _tenant.GetTenantIdOrThrow(),
            user.UserId!.Value,
            id,
            ct);

        return LifecycleResponse(result);
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        if (!await _relationships.IsFeatureEnabledAsync(_tenant.GetTenantIdOrThrow(), ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private async Task<(IActionResult? Result, int? UserId)> GuardAndUserAsync(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return (guard, null);
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return (Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required.")), null);
        }

        return (null, userId.Value);
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

    private static int ReadInt(JsonElement payload, string name)
    {
        return payload.ValueKind == JsonValueKind.Object
            && payload.TryGetProperty(name, out var value)
            ? ReadIntValue(value)
            : 0;
    }

    private static int? ReadNullableInt(JsonElement payload, string name)
    {
        if (payload.ValueKind != JsonValueKind.Object
            || !payload.TryGetProperty(name, out var value)
            || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        if (value.ValueKind == JsonValueKind.String && string.IsNullOrWhiteSpace(value.GetString()))
        {
            return null;
        }

        var parsed = ReadIntValue(value);
        return parsed > 0 ? parsed : null;
    }

    private static decimal ReadDecimal(JsonElement payload, string name)
    {
        return payload.ValueKind == JsonValueKind.Object
            && payload.TryGetProperty(name, out var value)
            ? ReadDecimalValue(value)
            : 0m;
    }

    private static string? ReadString(JsonElement payload, string name)
    {
        if (payload.ValueKind != JsonValueKind.Object
            || !payload.TryGetProperty(name, out var value)
            || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : value.ToString();
    }

    private static string SanitizeLocale(string? locale)
    {
        var sanitized = Regex.Replace(locale ?? string.Empty, "[^a-zA-Z-]", string.Empty);
        return string.IsNullOrWhiteSpace(sanitized) ? "en" : sanitized;
    }

    private static string UpsertOnboardingChoice(string? rawPreferences, string choice)
    {
        JsonObject root;
        try
        {
            var parsed = string.IsNullOrWhiteSpace(rawPreferences)
                ? null
                : JsonNode.Parse(rawPreferences);
            root = parsed as JsonObject ?? new JsonObject();
        }
        catch (JsonException)
        {
            root = new JsonObject();
        }

        var caring = root["caring_community"] as JsonObject ?? new JsonObject();
        caring["onboarding_choice"] = choice;
        root["caring_community"] = caring;

        return root.ToJsonString();
    }

    private static int ReadIntValue(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt32(out var parsed) => parsed,
            JsonValueKind.String when int.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => 0
        };
    }

    private static decimal ReadDecimalValue(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetDecimal(out var parsed) => parsed,
            JsonValueKind.String when decimal.TryParse(value.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => 0m
        };
    }

    private IActionResult LifecycleResponse(RelationshipLifecycleResult result)
    {
        if (result.Succeeded)
        {
            return Ok(new { data = new { success = true, status = result.Status } });
        }

        var statusCode = result.ErrorCode switch
        {
            "NOT_FOUND" => StatusCodes.Status404NotFound,
            "INVALID_STATE" => StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR" => StatusCodes.Status422UnprocessableEntity,
            _ => StatusCodes.Status500InternalServerError
        };

        return StatusCode(statusCode, LaravelError(
            result.ErrorCode ?? "SERVER_ERROR",
            result.ErrorCode switch
            {
                "NOT_FOUND" => "Not found.",
                "INVALID_STATE" => "Relationship cannot be changed from its current state.",
                "VALIDATION_ERROR" => "Validation failed.",
                _ => "Server error."
            },
            result.ErrorField));
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

    private static object LaravelErrors(IEnumerable<MemberHelpRequestError> errors)
    {
        return new
        {
            errors = errors.Select(error => new Dictionary<string, object?>
            {
                ["code"] = error.Code,
                ["message"] = error.Message,
                ["field"] = error.Field
            }).ToArray()
        };
    }
}

public sealed class RelationshipLifecycleRequest
{
    [JsonPropertyName("reason")]
    public string? Reason { get; set; }

    [JsonPropertyName("resume_at")]
    public string? ResumeAt { get; set; }
}

public sealed class ResearchConsentRequest
{
    [JsonPropertyName("consent_status")]
    public string? ConsentStatus { get; set; }

    [JsonPropertyName("notes")]
    public string? Notes { get; set; }
}

public sealed class CaringCommunityOnboardingChoiceRequest
{
    [JsonPropertyName("choice")]
    public string? Choice { get; set; }
}
