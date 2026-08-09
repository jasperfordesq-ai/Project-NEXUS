// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using System.Text.Json;
using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Member-owned safeguarding preferences and metadata-only vetting review
/// workflows. A member can always inspect and revoke their own active flags.
/// </summary>
[ApiController]
[Route("api/v2/safeguarding")]
[Authorize]
public sealed class SafeguardingVettingMemberController : ControllerBase
{
    private static readonly IReadOnlyDictionary<string, string> EnglishPresetCopy =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["safeguarding.presets.common.options.is_vulnerable_adult.label"] =
                "I consider myself a vulnerable adult and may need additional safeguarding support",
            ["safeguarding.presets.scotland.options.is_vulnerable_adult.label"] =
                "I consider myself a vulnerable or protected adult and may need additional safeguarding support",
            ["safeguarding.presets.common.options.is_vulnerable_adult.description"] =
                "This lets our coordinators know you may need extra support when arranging exchanges. A coordinator will be in touch to discuss how we can help. This information is confidential.",
            ["safeguarding.presets.common.options.requires_vetted_partners.label"] =
                "I would prefer to only interact with members who have been appropriately vetted",
            ["safeguarding.presets.england_wales.options.requires_vetted_partners.description"] =
                "In England & Wales, this means DBS-checked members. Our coordinators will ensure you are only matched with vetted members.",
            ["safeguarding.presets.scotland.options.requires_vetted_partners.description"] =
                "In Scotland, this means PVG scheme members. Our coordinators will ensure you are only matched with vetted members.",
            ["safeguarding.presets.northern_ireland.options.requires_vetted_partners.description"] =
                "In Northern Ireland, this means AccessNI-checked members. Our coordinators will ensure you are only matched with vetted members.",
            ["safeguarding.presets.ireland.options.requires_vetted_partners.description"] =
                "In Ireland, this means Garda Vetted members. Our coordinators will ensure you are only matched with vetted members.",
            ["safeguarding.presets.common.options.requires_coordinator_contact.label"] =
                "I would like a coordinator to help arrange my exchanges rather than being contacted directly",
            ["safeguarding.presets.common.options.requires_coordinator_contact.description"] =
                "A coordinator will mediate all contact and help arrange exchanges on your behalf. Other members will not be able to message you directly.",
            ["safeguarding.presets.ireland.options.requires_coordinator_contact.description"] =
                "A coordinator (broker) will mediate all contact and help arrange exchanges on your behalf. Other members will not be able to message you directly.",
            ["safeguarding.presets.common.options.no_home_visits.label"] =
                "I do not want members visiting my home without coordinator arrangement",
            ["safeguarding.presets.common.options.no_home_visits.description"] =
                "All home visits will be arranged through a coordinator who can ensure appropriate safeguards are in place.",
            ["safeguarding.presets.common.options.works_with_children.label"] =
                "I plan to offer services that may involve children or young people (under 18)",
            ["safeguarding.presets.england_wales.options.works_with_children.description"] =
                "A coordinator may discuss DBS check requirements with you.",
            ["safeguarding.presets.scotland.options.works_with_children.description"] =
                "A coordinator may discuss PVG scheme membership with you.",
            ["safeguarding.presets.northern_ireland.options.works_with_children.description"] =
                "A coordinator may discuss AccessNI checking with you.",
            ["safeguarding.presets.ireland.options.works_with_children.description"] =
                "A coordinator may discuss Garda Vetting requirements with you. In Ireland, certain activities involving children require vetting under the National Vetting Bureau Act 2012.",
            ["safeguarding.presets.common.options.works_with_vulnerable_adults.label"] =
                "I plan to offer services that may involve vulnerable adults",
            ["safeguarding.presets.scotland.options.works_with_vulnerable_adults.label"] =
                "I plan to offer services that may involve protected adults",
            ["safeguarding.presets.ireland.options.works_with_vulnerable_adults.description"] =
                "A coordinator may discuss Garda Vetting requirements with you. Activities involving vulnerable adults may require vetting.",
            ["safeguarding.presets.common.options.none_apply.label"] =
                "None of these apply to me",
            ["safeguarding.presets.common.options.none_apply.description"] =
                "I have reviewed the options above and none of them apply to my situation. This is recorded so coordinators know I have seen and considered this step."
        };

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;
    private readonly MemberVettingAttestationService _attestations;
    private readonly SafeguardingPreferencePolicyService _preferencePolicy;
    private readonly ILogger<SafeguardingVettingMemberController> _logger;

    public SafeguardingVettingMemberController(
        NexusDbContext db,
        TenantContext tenant,
        MemberVettingAttestationService attestations,
        SafeguardingPreferencePolicyService preferencePolicy,
        ILogger<SafeguardingVettingMemberController> logger)
    {
        _db = db;
        _tenant = tenant;
        _attestations = attestations;
        _preferencePolicy = preferencePolicy;
        _logger = logger;
    }

    [HttpGet("my-preferences")]
    public async Task<IActionResult> MyPreferences(CancellationToken cancellationToken)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var userId = CurrentUserId();
        try
        {
            var now = DateTime.UtcNow;
            await _db.UserSafeguardingPreferences
                .IgnoreQueryFilters()
                .Where(preference => preference.TenantId == tenantId
                    && preference.UserId == userId
                    && preference.RevokedAt == null
                    && preference.ReviewReminderSentAt != null
                    && preference.ReviewConfirmedAt == null)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(preference => preference.ReviewConfirmedAt, now),
                    cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Safeguarding preference review confirmation stamp failed for member {UserId}",
                userId);
        }

        var rows = await _db.UserSafeguardingPreferences
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Include(preference => preference.Option)
            .Where(preference => preference.TenantId == tenantId
                && preference.UserId == userId
                && preference.RevokedAt == null
                && preference.Option != null
                && preference.Option.TenantId == tenantId
                && preference.Option.IsActive)
            .OrderBy(preference => preference.Option!.SortOrder)
            .ThenBy(preference => preference.Id)
            .ToListAsync(cancellationToken);

        var preferences = rows.Select(preference =>
        {
            var activations = ParseActivations(preference.Option?.TriggersJson);
            return new
            {
                preference_id = preference.Id,
                option_id = preference.OptionId,
                option_key = preference.Option?.OptionKey ?? string.Empty,
                label = LocalizePresetCopy(preference.Option?.Label),
                description = LocalizePresetCopy(preference.Option?.Description),
                selected_value = preference.SelectedValue,
                consent_given_at = preference.ConsentGivenAt,
                created_at = preference.CreatedAt,
                policy_review_required = preference.PolicyReviewRequiredAt is not null,
                policy_review_reason_code = preference.PolicyReviewReasonCode,
                activations = new
                {
                    requires_broker_approval = activations.RequiresBrokerApproval,
                    restricts_messaging = activations.RestrictsMessaging,
                    restricts_matching = activations.RestrictsMatching,
                    requires_vetted_interaction = activations.RequiresVettedInteraction,
                    vetting_type_required = activations.VettingTypeRequired
                }
            };
        }).ToArray();

        return LaravelData(new { preferences, count = preferences.Length });
    }

    [HttpPost("revoke")]
    public async Task<IActionResult> Revoke(CancellationToken cancellationToken)
    {
        var input = await SafeguardingVettingRequestInput.ReadAsync(Request, cancellationToken);
        var rawOptionId = input.String("option_id");
        if (!input.Contains("option_id") || string.IsNullOrWhiteSpace(rawOptionId))
        {
            return LaravelError(
                "VALIDATION_ERROR",
                "The option id field is required.",
                "option_id",
                StatusCodes.Status422UnprocessableEntity);
        }
        if (!long.TryParse(rawOptionId, out var parsedOptionId))
        {
            return LaravelError(
                "VALIDATION_ERROR",
                "The option id field must be an integer.",
                "option_id",
                StatusCodes.Status422UnprocessableEntity);
        }
        if (parsedOptionId < 1)
        {
            return LaravelError(
                "VALIDATION_ERROR",
                "The option id field must be at least 1.",
                "option_id",
                StatusCodes.Status422UnprocessableEntity);
        }

        var revoked = parsedOptionId <= int.MaxValue
            && await _preferencePolicy.RevokeMemberPreferenceAsync(
                _tenant.GetTenantIdOrThrow(),
                CurrentUserId(),
                (int)parsedOptionId,
                cancellationToken);
        if (!revoked)
        {
            return LaravelError(
                "NOT_FOUND",
                "We could not revoke that preference. It may already have been revoked.",
                "option_id",
                StatusCodes.Status404NotFound);
        }

        return LaravelData(new { revoked = true, option_id = parsedOptionId });
    }

    [HttpPost("confirm-policy-review")]
    [EnableRateLimiting(RateLimitingExtensions.SafeguardingVettingMemberMutationPolicy)]
    public async Task<IActionResult> ConfirmPolicyReview(CancellationToken cancellationToken)
    {
        try
        {
            var updated = await _preferencePolicy.ConfirmMemberPolicyReviewAsync(
                _tenant.GetTenantIdOrThrow(),
                CurrentUserId(),
                cancellationToken);
            return LaravelData(new
            {
                confirmed = true,
                updated_count = updated,
                message = "Your safeguarding preference review has been confirmed."
            });
        }
        catch (SafeguardingPolicyException exception)
        {
            return LaravelError(
                exception.ReasonCode,
                AdminSafeguardingVettingController.PolicyMessage(exception.ReasonCode),
                null,
                StatusCodes.Status422UnprocessableEntity);
        }
    }

    [HttpGet("my-vetting-status")]
    public async Task<IActionResult> MyVettingStatus(CancellationToken cancellationToken)
    {
        var status = await _attestations.GetMemberStatusAsync(
            _tenant.GetTenantIdOrThrow(),
            CurrentUserId(),
            cancellationToken);
        return LaravelData(AdminSafeguardingVettingController.MapMemberStatus(status));
    }

    [HttpPost("vetting-review-request")]
    [EnableRateLimiting(RateLimitingExtensions.SafeguardingVettingMemberMutationPolicy)]
    public async Task<IActionResult> RequestVettingReview(CancellationToken cancellationToken)
    {
        var input = await SafeguardingVettingRequestInput.ReadAsync(Request, cancellationToken);
        if (!input.IsEmpty)
        {
            return LaravelError(
                "VETTING_EVIDENCE_PROHIBITED",
                "Request a broker review without attaching or entering any evidence.",
                "request",
                StatusCodes.Status422UnprocessableEntity);
        }

        try
        {
            var review = await _attestations.RequestReviewAsync(
                _tenant.GetTenantIdOrThrow(),
                CurrentUserId(),
                cancellationToken);
            return LaravelData(
                AdminSafeguardingVettingController.MapReview(review, _tenant.GetTenantIdOrThrow()),
                StatusCodes.Status201Created);
        }
        catch (SafeguardingPolicyException exception)
        {
            var status = exception.ReasonCode is "SAFEGUARDING_JURISDICTION_REQUIRED" or "SAFEGUARDING_POLICY_UNAVAILABLE"
                ? StatusCodes.Status409Conflict
                : StatusCodes.Status422UnprocessableEntity;
            var message = exception.ReasonCode switch
            {
                "SAFEGUARDING_JURISDICTION_REQUIRED" =>
                    "Choose the community safeguarding jurisdiction before confirming vetting.",
                "SAFEGUARDING_POLICY_UNAVAILABLE" =>
                    "The safeguarding policy is not available for this action.",
                _ => "The broker review request could not be created."
            };
            return LaravelError(exception.ReasonCode, message, null, status);
        }
    }

    private int CurrentUserId()
    {
        var raw = User.FindFirst("sub")?.Value
            ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(raw, out var userId)
            ? userId
            : throw new InvalidOperationException("Authenticated user ID claim is missing.");
    }

    private ObjectResult LaravelData(object data, int status = StatusCodes.Status200OK)
    {
        ApplyV2Headers();
        return StatusCode(status, new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}{Request.PathBase}" }
        });
    }

    private ObjectResult LaravelError(string code, string message, string? field, int status)
    {
        ApplyV2Headers();
        return StatusCode(status, new
        {
            errors = new[]
            {
                field is null
                    ? new Dictionary<string, object?>
                    {
                        ["code"] = code,
                        ["message"] = message
                    }
                    : new Dictionary<string, object?>
                    {
                        ["code"] = code,
                        ["message"] = message,
                        ["field"] = field
                    }
            }
        });
    }

    private void ApplyV2Headers()
    {
        Response.Headers["API-Version"] = "2.0";
        if (_tenant.TenantId is int tenantId)
        {
            Response.Headers["X-Tenant-ID"] = tenantId.ToString(CultureInfo.InvariantCulture);
        }
    }

    private static string? LocalizePresetCopy(string? value)
        => value is not null && EnglishPresetCopy.TryGetValue(value, out var localized)
            ? localized
            : value;

    private static SafeguardingPreferenceActivations ParseActivations(string? triggersJson)
    {
        if (string.IsNullOrWhiteSpace(triggersJson))
        {
            return new(false, false, false, false, null);
        }

        try
        {
            using var document = JsonDocument.Parse(triggersJson);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return new(false, false, false, false, null);
            }

            var root = document.RootElement;
            return new(
                TriggerBool(root, "requires_broker_approval"),
                TriggerBool(root, "restricts_messaging"),
                TriggerBool(root, "restricts_matching"),
                TriggerBool(root, "requires_vetted_interaction"),
                root.TryGetProperty("vetting_type_required", out var required)
                    && required.ValueKind == JsonValueKind.String
                        ? required.GetString()
                        : null);
        }
        catch (JsonException)
        {
            return new(false, false, false, false, null);
        }
    }

    private static bool TriggerBool(JsonElement root, string key)
    {
        if (!root.TryGetProperty(key, out var value))
        {
            return false;
        }

        // Laravel exposes these values with PHP's boolean-cast semantics.
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False or JsonValueKind.Null or JsonValueKind.Undefined => false,
            JsonValueKind.Number => !value.TryGetDouble(out var number) || number != 0,
            JsonValueKind.String => value.GetString() is { Length: > 0 } text && text != "0",
            JsonValueKind.Array => value.GetArrayLength() > 0,
            JsonValueKind.Object => value.EnumerateObject().Any(),
            _ => false
        };
    }

    private sealed record SafeguardingPreferenceActivations(
        bool RequiresBrokerApproval,
        bool RestrictsMessaging,
        bool RestrictsMatching,
        bool RequiresVettedInteraction,
        string? VettingTypeRequired);
}
