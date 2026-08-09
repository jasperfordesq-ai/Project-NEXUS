// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Primitives;
using Nexus.Api.Data;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Metadata-only community safeguarding confirmations. Certificate evidence,
/// arbitrary statuses, uploads, bulk decisions, and generic record mutation are
/// deliberately absent from this controller.
/// </summary>
[ApiController]
[Route("api/v2/admin/vetting")]
[Authorize(Policy = "BrokerOrAdmin")]
public sealed class AdminSafeguardingVettingController : ControllerBase
{
    private static readonly HashSet<string> ProhibitedInputFields = new(StringComparer.Ordinal)
    {
        "document", "file", "document_url", "reference_number", "certificate_number",
        "issue_date", "expiry_date", "renewal_date", "notes", "result", "status",
        "scheme_code", "attestation_code", "vetting_type", "purpose_code",
        "scope_type", "scope_identifier", "policy_version", "confirmed_at",
        "works_with_children", "works_with_vulnerable_adults", "requires_enhanced_check"
    };

    private readonly TenantContext _tenant;
    private readonly SafeguardingVettingAccessService _access;
    private readonly SafeguardingJurisdictionService _jurisdictions;
    private readonly MemberVettingAttestationService _attestations;

    public AdminSafeguardingVettingController(
        TenantContext tenant,
        SafeguardingVettingAccessService access,
        SafeguardingJurisdictionService jurisdictions,
        MemberVettingAttestationService attestations)
    {
        _tenant = tenant;
        _access = access;
        _jurisdictions = jurisdictions;
        _attestations = attestations;
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        if (await DecisionMakerAsync(cancellationToken) is null)
        {
            return DecisionMakerDenied();
        }

        var page = QueryInt("page", 1, 1);
        var perPage = QueryInt("per_page", 25, 1, 100);
        var result = await _attestations.ListMembersAsync(
            _tenant.GetTenantIdOrThrow(),
            Request.Query["status"].FirstOrDefault() ?? "all",
            Request.Query["search"].FirstOrDefault() ?? string.Empty,
            page,
            perPage,
            cancellationToken);

        return LaravelData(
            result.Data.Select(MapListItem).ToArray(),
            new
            {
                pagination = new
                {
                    current_page = result.Pagination.CurrentPage,
                    per_page = result.Pagination.PerPage,
                    total = result.Pagination.Total,
                    last_page = result.Pagination.LastPage
                }
            });
    }

    [HttpGet("stats")]
    public async Task<IActionResult> Stats(CancellationToken cancellationToken)
    {
        if (await DecisionMakerAsync(cancellationToken) is null)
        {
            return DecisionMakerDenied();
        }

        var stats = await _attestations.StatsAsync(_tenant.GetTenantIdOrThrow(), cancellationToken);
        return LaravelData(new
        {
            total_members = stats.TotalMembers,
            confirmed = stats.Confirmed,
            revoked = stats.Revoked,
            not_confirmed = stats.NotConfirmed,
            review_requested = stats.ReviewRequested,
            policy = MapPolicy(stats.Policy)
        });
    }

    [HttpGet("policy")]
    public async Task<IActionResult> Policy(CancellationToken cancellationToken)
    {
        if (await DecisionMakerAsync(cancellationToken) is null)
        {
            return DecisionMakerDenied();
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        var policy = await _jurisdictions.GetPolicyAsync(tenantId, cancellationToken);
        return LaravelData(new
        {
            policy = MapPolicy(policy),
            jurisdictions = _jurisdictions.AvailableJurisdictions().Select(MapJurisdiction).ToArray(),
            revocation_reason_codes = MemberVettingAttestationService.RevocationReasonCodes.ToArray(),
            review_resolution_codes = MemberVettingAttestationService.ReviewResolutionCodes.ToArray()
        });
    }

    [HttpPut("policy")]
    [EnableRateLimiting(RateLimitingExtensions.SafeguardingVettingPolicyUpdatePolicy)]
    public async Task<IActionResult> UpdatePolicy(CancellationToken cancellationToken)
    {
        var adminId = await VettingAdminAsync(cancellationToken);
        if (adminId is null)
        {
            return VettingAdminDenied();
        }

        var input = await SafeguardingVettingRequestInput.ReadAsync(Request, cancellationToken);
        if (RejectProhibitedInput(input, "jurisdiction") is { } rejected)
        {
            return rejected;
        }

        var jurisdiction = input.String("jurisdiction").Trim();
        if (jurisdiction.Length == 0)
        {
            return LaravelError(
                "VALIDATION_ERROR",
                "Choose the community safeguarding jurisdiction before confirming vetting.",
                "jurisdiction",
                StatusCodes.Status422UnprocessableEntity);
        }

        try
        {
            var result = await _jurisdictions.ConfigureAsync(
                _tenant.GetTenantIdOrThrow(),
                jurisdiction,
                adminId.Value,
                cancellationToken);
            return LaravelData(new
            {
                policy = MapPolicy(result.Policy),
                preference_transition = MapTransition(result.PreferenceTransition),
                message = "The safeguarding jurisdiction has been updated."
            });
        }
        catch (SafeguardingPolicyException exception)
        {
            return PolicyError(exception);
        }
    }

    [HttpPost("policy/rotate")]
    [EnableRateLimiting(RateLimitingExtensions.SafeguardingVettingPolicyRotationPolicy)]
    public async Task<IActionResult> RotatePolicy(CancellationToken cancellationToken)
    {
        var adminId = await VettingAdminAsync(cancellationToken);
        if (adminId is null)
        {
            return VettingAdminDenied();
        }

        var input = await SafeguardingVettingRequestInput.ReadAsync(Request, cancellationToken);
        if (RejectProhibitedInput(input, "acknowledgement", "reason_code") is { } rejected)
        {
            return rejected;
        }
        if (!input.Bool("acknowledgement"))
        {
            return LaravelError(
                "VALIDATION_ERROR",
                "Confirm that rotating this policy will require affected members to be reconfirmed.",
                "acknowledgement",
                StatusCodes.Status422UnprocessableEntity);
        }

        var reasonCode = input.String("reason_code", "policy_changed").Trim();
        if (!SafeguardingVettingCatalog.RotationReasonCodes.Contains(reasonCode))
        {
            return LaravelError(
                "VALIDATION_ERROR",
                "Choose a valid reason code.",
                "reason_code",
                StatusCodes.Status422UnprocessableEntity);
        }

        try
        {
            var result = await _jurisdictions.RotatePolicyVersionAsync(
                _tenant.GetTenantIdOrThrow(),
                adminId.Value,
                reasonCode,
                cancellationToken);
            return LaravelData(new
            {
                policy = MapPolicy(result.Policy),
                reason_code = result.ReasonCode,
                affected_member_count = result.AffectedMemberCount,
                message = "The safeguarding policy version has been rotated. Previous confirmations no longer authorise protected contact."
            });
        }
        catch (SafeguardingPolicyException exception)
        {
            return PolicyError(exception);
        }
    }

    [HttpGet("user/{userId:int}")]
    public async Task<IActionResult> GetUserRecords(int userId, CancellationToken cancellationToken)
    {
        if (await DecisionMakerAsync(cancellationToken) is null)
        {
            return DecisionMakerDenied();
        }

        try
        {
            var records = await _attestations.GetUserRecordsAsync(
                _tenant.GetTenantIdOrThrow(),
                userId,
                cancellationToken);
            return LaravelData(records.Select(MapUserRecord).ToArray());
        }
        catch (SafeguardingPolicyException exception)
        {
            return PolicyError(exception);
        }
    }

    [HttpPost("user/{userId:int}/confirm")]
    [EnableRateLimiting(RateLimitingExtensions.SafeguardingVettingDecisionPolicy)]
    public async Task<IActionResult> Confirm(int userId, CancellationToken cancellationToken)
    {
        var actorId = await DecisionMakerAsync(cancellationToken);
        if (actorId is null)
        {
            return DecisionMakerDenied();
        }

        var input = await SafeguardingVettingRequestInput.ReadAsync(Request, cancellationToken);
        if (RejectProhibitedInput(input, "acknowledgement", "review_request_id") is { } rejected)
        {
            return rejected;
        }
        if (!input.Bool("acknowledgement"))
        {
            return LaravelError(
                "VALIDATION_ERROR",
                "You must confirm the community acknowledgement before saving this decision.",
                "acknowledgement",
                StatusCodes.Status422UnprocessableEntity);
        }

        try
        {
            var record = await _attestations.ConfirmForCurrentPolicyAsync(
                _tenant.GetTenantIdOrThrow(),
                userId,
                actorId.Value,
                input.OptionalPositiveLong("review_request_id"),
                cancellationToken);
            return LaravelData(MapFullRecord(record, _tenant.GetTenantIdOrThrow()), status: StatusCodes.Status201Created);
        }
        catch (SafeguardingPolicyException exception)
        {
            return PolicyError(exception);
        }
    }

    [HttpPost("user/{userId:int}/revoke")]
    [EnableRateLimiting(RateLimitingExtensions.SafeguardingVettingDecisionPolicy)]
    public async Task<IActionResult> Revoke(int userId, CancellationToken cancellationToken)
    {
        var actorId = await DecisionMakerAsync(cancellationToken);
        if (actorId is null)
        {
            return DecisionMakerDenied();
        }

        var input = await SafeguardingVettingRequestInput.ReadAsync(Request, cancellationToken);
        if (RejectProhibitedInput(input, "reason_code", "review_request_id") is { } rejected)
        {
            return rejected;
        }

        var reasonCode = input.String("reason_code", "community_decision_withdrawn").Trim();
        try
        {
            var record = await _attestations.RevokeForCurrentPolicyAsync(
                _tenant.GetTenantIdOrThrow(),
                userId,
                actorId.Value,
                reasonCode,
                input.OptionalPositiveLong("review_request_id"),
                cancellationToken);
            return LaravelData(MapFullRecord(record, _tenant.GetTenantIdOrThrow()));
        }
        catch (SafeguardingPolicyException exception)
        {
            return PolicyError(exception);
        }
    }

    [HttpPost("reviews/{reviewId:long}/resolve")]
    [EnableRateLimiting(RateLimitingExtensions.SafeguardingVettingDecisionPolicy)]
    public async Task<IActionResult> ResolveReview(long reviewId, CancellationToken cancellationToken)
    {
        var actorId = await DecisionMakerAsync(cancellationToken);
        if (actorId is null)
        {
            return DecisionMakerDenied();
        }

        var input = await SafeguardingVettingRequestInput.ReadAsync(Request, cancellationToken);
        if (RejectProhibitedInput(input, "resolution_code") is { } rejected)
        {
            return rejected;
        }

        try
        {
            var review = await _attestations.ResolveReviewAsync(
                _tenant.GetTenantIdOrThrow(),
                reviewId,
                actorId.Value,
                input.String("resolution_code").Trim(),
                cancellationToken);
            return LaravelData(MapReview(review, _tenant.GetTenantIdOrThrow()));
        }
        catch (SafeguardingPolicyException exception)
        {
            return PolicyError(exception);
        }
    }

    [HttpGet("{id:long}")]
    public async Task<IActionResult> Show(long id, CancellationToken cancellationToken)
    {
        if (await DecisionMakerAsync(cancellationToken) is null)
        {
            return DecisionMakerDenied();
        }

        var record = await _attestations.GetByIdAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            cancellationToken);
        return record is null
            ? LaravelError(
                "NOT_FOUND",
                "No vetting confirmation was found for this member.",
                null,
                StatusCodes.Status404NotFound)
            : LaravelData(MapFullRecord(record, _tenant.GetTenantIdOrThrow()));
    }

    private Task<int?> DecisionMakerAsync(CancellationToken cancellationToken)
        => _access.ResolveDecisionMakerUserIdAsync(User, cancellationToken);

    private Task<int?> VettingAdminAsync(CancellationToken cancellationToken)
        => _access.ResolveVettingAdminUserIdAsync(User, cancellationToken);

    private IActionResult? RejectProhibitedInput(
        SafeguardingVettingRequestInput input,
        params string[] allowedFields)
    {
        if (input.HasFiles)
        {
            return LaravelError(
                "VETTING_EVIDENCE_PROHIBITED",
                "Do not upload or enter certificates, reference numbers, dates, results, notes, or other vetting evidence in Project NEXUS.",
                "file",
                StatusCodes.Status422UnprocessableEntity);
        }

        var allowed = allowedFields.ToHashSet(StringComparer.Ordinal);
        var invalid = input.Keys.FirstOrDefault(ProhibitedInputFields.Contains)
            ?? input.Keys.FirstOrDefault(key => !allowed.Contains(key));
        return invalid is null
            ? null
            : LaravelError(
                "VETTING_EVIDENCE_PROHIBITED",
                "Do not upload or enter certificates, reference numbers, dates, results, notes, or other vetting evidence in Project NEXUS.",
                invalid,
                StatusCodes.Status422UnprocessableEntity);
    }

    private IActionResult PolicyError(SafeguardingPolicyException exception)
    {
        var status = exception.ReasonCode switch
        {
            "MEMBER_NOT_FOUND" or "VETTING_CONFIRMATION_NOT_FOUND" or "VETTING_REVIEW_REQUEST_NOT_FOUND"
                => StatusCodes.Status404NotFound,
            "VETTING_SELF_CONFIRMATION_FORBIDDEN" or "VETTING_DECISION_ACTOR_NOT_FOUND"
                => StatusCodes.Status403Forbidden,
            "SAFEGUARDING_POLICY_UNAVAILABLE" or "SAFEGUARDING_JURISDICTION_REQUIRED"
                => StatusCodes.Status409Conflict,
            _ => StatusCodes.Status422UnprocessableEntity
        };
        return LaravelError(exception.ReasonCode, PolicyMessage(exception.ReasonCode), null, status);
    }

    internal static string PolicyMessage(string reasonCode) => reasonCode switch
    {
        "MEMBER_NOT_FOUND" => "Member not found",
        "VETTING_CONFIRMATION_NOT_FOUND" => "No vetting confirmation was found for this member.",
        "VETTING_REVIEW_REQUEST_NOT_FOUND" => "The vetting review request was not found.",
        "VETTING_SELF_CONFIRMATION_FORBIDDEN" => "You cannot confirm your own vetting status.",
        "VETTING_DECISION_ACTOR_NOT_FOUND" => "The authorised decision maker could not be verified.",
        "SAFEGUARDING_JURISDICTION_REQUIRED" => "Choose the community safeguarding jurisdiction before confirming vetting.",
        "SAFEGUARDING_POLICY_UNAVAILABLE" => "The safeguarding policy is not available for this action.",
        "INVALID_SAFEGUARDING_JURISDICTION" => "Choose a valid safeguarding jurisdiction.",
        "INVALID_REASON_CODE" => "Choose a valid reason code.",
        "INVALID_VETTING_REVOCATION_REASON" => "Choose a valid reason for revoking this confirmation.",
        "INVALID_VETTING_REVIEW_RESOLUTION" => "Choose a valid review outcome.",
        _ => "The vetting decision could not be saved."
    };

    private ObjectResult DecisionMakerDenied()
    {
        ApplyV2Headers();
        return StatusCode(
            StatusCodes.Status403Forbidden,
            new
            {
                success = false,
                error = "Only an authorised broker or administrator can make vetting decisions.",
                code = "AUTH_INSUFFICIENT_PERMISSIONS"
            });
    }

    private ObjectResult VettingAdminDenied()
    {
        ApplyV2Headers();
        return StatusCode(
            StatusCodes.Status403Forbidden,
            new
            {
                success = false,
                error = "Admin access required",
                code = "AUTH_INSUFFICIENT_PERMISSIONS"
            });
    }

    private ObjectResult LaravelData(object data, object? meta = null, int status = StatusCodes.Status200OK)
    {
        ApplyV2Headers();
        return StatusCode(status, new
        {
            data,
            meta = MergeMeta(meta)
        });
    }

    private object MergeMeta(object? meta)
    {
        var baseUrl = $"{Request.Scheme}://{Request.Host}{Request.PathBase}";
        if (meta is null)
        {
            return new { base_url = baseUrl };
        }

        var pagination = meta.GetType().GetProperty("pagination")?.GetValue(meta);
        return new { base_url = baseUrl, pagination };
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

    private int QueryInt(string key, int fallback, int minimum, int? maximum = null)
    {
        var value = Request.Query[key].FirstOrDefault();
        if (!int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
        {
            return fallback;
        }
        parsed = Math.Max(minimum, parsed);
        return maximum.HasValue ? Math.Min(maximum.Value, parsed) : parsed;
    }

    internal static object MapPolicy(SafeguardingPolicyState policy) => new
    {
        configured = policy.Configured,
        contact_policy_available = policy.ContactPolicyAvailable,
        jurisdiction = policy.Jurisdiction,
        scheme_code = policy.SchemeCode,
        attestation_code = policy.AttestationCode,
        purpose_code = policy.PurposeCode,
        scope_type = policy.ScopeType,
        scope_identifier = policy.ScopeIdentifier,
        policy_version = policy.PolicyVersion,
        label = policy.Label,
        attestation_label = policy.AttestationLabel,
        preset = policy.Preset
    };

    private static object MapJurisdiction(SafeguardingJurisdictionOption option) => new
    {
        code = option.Code,
        label = option.Label,
        attestation_code = option.AttestationCode,
        attestation_label = option.AttestationLabel,
        available_for_contact_policy = option.AvailableForContactPolicy,
        contact_policy_available = option.ContactPolicyAvailable
    };

    private static object MapTransition(SafeguardingPreferenceTransitionResult transition) => new
    {
        created = transition.Created,
        updated = transition.Updated,
        deactivated = transition.Deactivated,
        preserved = transition.Preserved,
        review_required_count = transition.ReviewRequiredCount
    };

    private static object MapListItem(VettingMemberListItem item) => new
    {
        user_id = item.UserId,
        first_name = item.FirstName,
        last_name = item.LastName,
        email = item.Email,
        avatar_url = item.AvatarUrl,
        attestation_id = item.AttestationId,
        decision = item.Decision,
        confirmed_by = item.ConfirmedBy,
        confirmed_at = item.ConfirmedAt,
        revoked_by = item.RevokedBy,
        revoked_at = item.RevokedAt,
        revocation_reason_code = item.RevocationReasonCode,
        policy_version = item.PolicyVersion,
        review_request_id = item.ReviewRequestId,
        review_status = item.ReviewStatus,
        requested_at = item.RequestedAt,
        policy = MapPolicy(item.Policy)
    };

    private static object MapFullRecord(VettingAttestationRecord record, int tenantId) => new
    {
        id = record.Id,
        tenant_id = tenantId,
        user_id = record.UserId,
        scheme_code = record.SchemeCode,
        attestation_code = record.AttestationCode,
        purpose_code = record.PurposeCode,
        scope_type = record.ScopeType,
        scope_identifier = record.ScopeIdentifier,
        decision = record.Decision,
        confirmed_by = record.ConfirmedBy,
        confirmed_at = record.ConfirmedAt,
        revoked_by = record.RevokedBy,
        revoked_at = record.RevokedAt,
        revocation_reason_code = record.RevocationReasonCode,
        policy_version = record.PolicyVersion,
        created_at = record.CreatedAt,
        updated_at = record.UpdatedAt,
        first_name = record.FirstName,
        last_name = record.LastName,
        email = record.Email,
        avatar_url = record.AvatarUrl,
        confirmed_by_name = record.ConfirmedByName
    };

    private static object MapUserRecord(VettingAttestationRecord record) => new
    {
        id = record.Id,
        user_id = record.UserId,
        scheme_code = record.SchemeCode,
        attestation_code = record.AttestationCode,
        purpose_code = record.PurposeCode,
        scope_type = record.ScopeType,
        scope_identifier = record.ScopeIdentifier,
        decision = record.Decision,
        confirmed_at = record.ConfirmedAt,
        revoked_at = record.RevokedAt,
        revocation_reason_code = record.RevocationReasonCode,
        policy_version = record.PolicyVersion,
        confirmed_by_name = record.ConfirmedByName
    };

    internal static object MapMemberStatus(MemberVettingStatus status)
    {
        if (!status.Policy.Configured || !status.Policy.ContactPolicyAvailable)
        {
            return new
            {
                policy = MapPolicy(status.Policy),
                decision = status.Decision,
                review_status = status.ReviewStatus,
                confirmed_at = status.ConfirmedAt
            };
        }

        return new
        {
            policy = MapPolicy(status.Policy),
            decision = status.Decision,
            review_status = status.ReviewStatus,
            confirmed_at = status.ConfirmedAt,
            revoked_at = status.RevokedAt
        };
    }

    internal static object MapReview(VettingReviewRecord review, int tenantId) => new
    {
        id = review.Id,
        tenant_id = tenantId,
        user_id = review.UserId,
        jurisdiction = review.Jurisdiction,
        scheme_code = review.SchemeCode,
        attestation_code = review.AttestationCode,
        purpose_code = review.PurposeCode,
        scope_type = review.ScopeType,
        scope_identifier = review.ScopeIdentifier,
        policy_version = review.PolicyVersion,
        status = review.Status,
        request_source = review.RequestSource,
        requested_by = review.RequestedBy,
        requested_at = review.RequestedAt,
        handled_by = review.HandledBy,
        handled_at = review.HandledAt,
        resolution_code = review.ResolutionCode,
        created_at = review.CreatedAt,
        updated_at = review.UpdatedAt
    };
}

/// <summary>
/// Laravel-style merged request input for mutation endpoints. It intentionally
/// avoids MVC body binding so empty bodies and multipart evidence reach the
/// controller and receive the safeguarding-specific contract response.
/// </summary>
internal sealed class SafeguardingVettingRequestInput
{
    private readonly Dictionary<string, object?> _values = new(StringComparer.Ordinal);

    private SafeguardingVettingRequestInput()
    {
    }

    public bool HasFiles { get; private set; }
    public IEnumerable<string> Keys => _values.Keys;
    public bool IsEmpty => !HasFiles && _values.Count == 0;

    public static async Task<SafeguardingVettingRequestInput> ReadAsync(
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        var result = new SafeguardingVettingRequestInput();
        foreach (var pair in request.Query)
        {
            result._values[pair.Key] = StringValue(pair.Value);
        }

        if (request.HasFormContentType)
        {
            var form = await request.ReadFormAsync(cancellationToken);
            foreach (var pair in form)
            {
                result._values[pair.Key] = StringValue(pair.Value);
            }
            result.HasFiles = form.Files.Count > 0;
        }
        else if (IsJson(request.ContentType) && request.ContentLength is not 0)
        {
            try
            {
                using var document = await JsonDocument.ParseAsync(request.Body, cancellationToken: cancellationToken);
                if (document.RootElement.ValueKind == JsonValueKind.Object)
                {
                    foreach (var property in document.RootElement.EnumerateObject())
                    {
                        result._values[property.Name] = property.Value.Clone();
                    }
                }
                else if (document.RootElement.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined))
                {
                    result._values["request"] = document.RootElement.Clone();
                }
            }
            catch (JsonException)
            {
                result._values["request"] = null;
            }
        }

        return result;
    }

    public string String(string key, string fallback = "")
    {
        if (!_values.TryGetValue(key, out var value) || value is null)
        {
            return fallback;
        }
        if (value is string text)
        {
            return text;
        }
        if (value is JsonElement element)
        {
            return element.ValueKind switch
            {
                JsonValueKind.String => element.GetString() ?? fallback,
                JsonValueKind.Number => element.GetRawText(),
                JsonValueKind.True => "1",
                JsonValueKind.False => string.Empty,
                JsonValueKind.Null or JsonValueKind.Undefined => fallback,
                _ => element.GetRawText()
            };
        }
        return Convert.ToString(value, CultureInfo.InvariantCulture) ?? fallback;
    }

    public bool Bool(string key, bool fallback = false)
    {
        if (!_values.TryGetValue(key, out var value) || value is null)
        {
            return fallback;
        }
        if (value is JsonElement element)
        {
            if (element.ValueKind == JsonValueKind.True) return true;
            if (element.ValueKind == JsonValueKind.False) return false;
        }

        return String(key).Trim().ToLowerInvariant() is "1" or "true" or "yes" or "on";
    }

    public long? OptionalPositiveLong(string key)
    {
        var raw = String(key);
        return long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) && parsed > 0
            ? parsed
            : null;
    }

    public bool Contains(string key) => _values.ContainsKey(key);

    private static object? StringValue(StringValues values)
        => values.Count switch
        {
            0 => null,
            1 => values[0],
            _ => values.ToArray()
        };

    private static bool IsJson(string? contentType)
    {
        if (string.IsNullOrWhiteSpace(contentType))
        {
            return false;
        }
        var mediaType = contentType.Split(';', 2)[0].Trim();
        return mediaType.Equals("application/json", StringComparison.OrdinalIgnoreCase)
            || mediaType.EndsWith("+json", StringComparison.OrdinalIgnoreCase);
    }
}
