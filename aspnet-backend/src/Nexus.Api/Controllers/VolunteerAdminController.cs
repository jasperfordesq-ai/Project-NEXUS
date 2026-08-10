// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Volunteer admin extras — training courses + completions, guardian
/// consent review, per-tenant volunteer policy. Companion to
/// <see cref="VolunteerLongTailController"/>.
///
/// All routes are admin-only.
/// </summary>
[ApiController]
[Authorize(Policy = "AdminOnly")]
public class VolunteerAdminController : ControllerBase
{
    private readonly VolunteerAdminService _service;
    private readonly VolunteerGuardianConsentService _guardianConsent;
    private readonly TenantContext _tenantContext;

    public VolunteerAdminController(
        VolunteerAdminService service,
        VolunteerGuardianConsentService guardianConsent,
        TenantContext tenantContext)
    {
        _service = service;
        _guardianConsent = guardianConsent;
        _tenantContext = tenantContext;
    }

    // ─── Training courses ──────────────────────────────────────────────────

    [HttpGet("api/admin/volunteer/training/courses")]
    public async Task<IActionResult> ListCourses([FromQuery] bool? activeOnly = null)
    {
        var rows = await _service.ListCoursesAsync(activeOnly);
        return Ok(new { data = rows.Select(MapCourse), total = rows.Count });
    }

    [HttpPost("api/admin/volunteer/training/courses")]
    public async Task<IActionResult> CreateCourse([FromBody] CourseRequest req)
    {
        try
        {
            var entity = await _service.CreateCourseAsync(
                req.Title ?? string.Empty, req.Description,
                req.DurationMinutes ?? 0, req.IsRequired ?? false, req.Active ?? true);
            return Created($"/api/admin/volunteer/training/courses/{entity.Id}", new { data = MapCourse(entity) });
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPut("api/admin/volunteer/training/courses/{id:int}")]
    public async Task<IActionResult> UpdateCourse(int id, [FromBody] CourseRequest req)
    {
        var entity = await _service.UpdateCourseAsync(
            id, req.Title, req.Description, req.DurationMinutes, req.IsRequired, req.Active);
        return entity == null ? NotFound() : Ok(new { data = MapCourse(entity) });
    }

    [HttpDelete("api/admin/volunteer/training/courses/{id:int}")]
    public async Task<IActionResult> DeleteCourse(int id)
    {
        var ok = await _service.DeleteCourseAsync(id);
        return ok ? NoContent() : NotFound();
    }

    // ─── Training completions ─────────────────────────────────────────────

    [HttpGet("api/admin/volunteer/training/completions")]
    public async Task<IActionResult> ListCompletions([FromQuery] int? userId = null, [FromQuery] int? courseId = null)
    {
        var rows = await _service.ListCompletionsAsync(userId, courseId);
        return Ok(new { data = rows.Select(MapCompletion), total = rows.Count });
    }

    [HttpPost("api/admin/volunteer/training/completions/{userId:int}/{courseId:int}/mark-completed")]
    public async Task<IActionResult> MarkCompleted(int userId, int courseId, [FromBody] MarkCompletedRequest? req)
    {
        try
        {
            var entity = await _service.MarkCompletedAsync(userId, courseId, req?.Score, req?.CertificateUrl);
            return Ok(new { data = MapCompletion(entity) });
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    // ─── Guardian consents ────────────────────────────────────────────────

    [HttpGet("api/admin/volunteer/guardian-consents")]
    public async Task<IActionResult> ListConsents([FromQuery] string? status = null)
    {
        VolunteerGuardianConsentStatus? s = null;
        if (!string.IsNullOrWhiteSpace(status)
            && Enum.TryParse<VolunteerGuardianConsentStatus>(status, true, out var parsed))
        {
            s = parsed;
        }
        var rows = await _service.ListConsentsAsync(s);
        return Ok(new { data = rows.Select(MapConsent), total = rows.Count, status = s?.ToString() ?? "all" });
    }

    /// <summary>
    /// Canonical Laravel/React cursor-paginated guardian-consent read.
    /// Secret credential material is intentionally absent from the projection.
    /// </summary>
    [HttpGet("api/v2/admin/volunteering/guardian-consents")]
    public async Task<IActionResult> ListCanonicalGuardianConsents(
        [FromQuery] string? status = null,
        [FromQuery] int? cursor = null,
        [FromQuery] int limit = 20,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (!await _guardianConsent.IsVolunteeringEnabledAsync(tenantId, cancellationToken))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                errors = new[]
                {
                    new
                    {
                        code = "FEATURE_DISABLED",
                        message = "Volunteering module is not enabled for this community"
                    }
                }
            });
        }

        var page = await _guardianConsent.GetAdminPageAsync(
            tenantId,
            status,
            cursor,
            limit,
            cancellationToken);
        return Ok(new
        {
            data = new
            {
                items = page.Items.Select(MapCanonicalConsent),
                page.Cursor,
                has_more = page.HasMore
            },
            meta = new { base_url = BaseUrl() }
        });
    }

    [HttpPost("api/admin/volunteer/guardian-consents")]
    public IActionResult CreateConsent([FromBody] CreateConsentRequest req) =>
        LegacyGuardianDecisionGone();

    [HttpPost("api/admin/volunteer/guardian-consents/{id:int}/approve")]
    public IActionResult ApproveConsent(int id, [FromBody] ReviewConsentRequest? req) =>
        LegacyGuardianDecisionGone();

    [HttpPost("api/admin/volunteer/guardian-consents/{id:int}/reject")]
    public IActionResult RejectConsent(int id, [FromBody] ReviewConsentRequest? req) =>
        LegacyGuardianDecisionGone();

    [HttpPost("api/admin/volunteer/guardian-consents/{id:int}/revoke")]
    public IActionResult RevokeConsent(int id, [FromBody] ReviewConsentRequest? req) =>
        LegacyGuardianDecisionGone();

    // ─── Tenant policy (singleton) ────────────────────────────────────────

    [HttpGet("api/admin/volunteer/policy")]
    public async Task<IActionResult> GetPolicy()
    {
        var policy = await _service.GetPolicyAsync();
        return Ok(new { data = MapPolicy(policy) });
    }

    [HttpPut("api/admin/volunteer/policy")]
    public async Task<IActionResult> UpdatePolicy([FromBody] PolicyRequest req)
    {
        var policy = await _service.UpdatePolicyAsync(
            req.MinAge, req.HoursRequiredForCertificate,
            req.CertificateTemplateId, req.RequireGuardianConsentUnder,
            req.AutoApproveVerifiedAdults);
        return Ok(new { data = MapPolicy(policy) });
    }

    // ─── Mappers ──────────────────────────────────────────────────────────

    private static object MapCourse(VolunteerTrainingCourse c) => new
    {
        c.Id,
        c.Title,
        c.Description,
        duration_minutes = c.DurationMinutes,
        is_required = c.IsRequired,
        c.Active,
        created_at = c.CreatedAt,
        updated_at = c.UpdatedAt
    };

    private static object MapCompletion(VolunteerTrainingCompletion c) => new
    {
        c.Id,
        user_id = c.UserId,
        course_id = c.CourseId,
        completed_at = c.CompletedAt,
        c.Score,
        certificate_url = c.CertificateUrl
    };

    private static object MapConsent(VolunteerGuardianConsent c) => new
    {
        c.Id,
        minor_user_id = c.MinorUserId,
        guardian_name = c.GuardianName,
        guardian_email = c.GuardianEmail,
        guardian_relationship = c.GuardianRelationship,
        consented_at = c.ConsentedAt,
        revoked_at = c.RevokedAt,
        consent_document_url = c.ConsentDocumentUrl,
        status = c.Status.ToString(),
        reviewer_note = c.ReviewerNote,
        reviewed_by_user_id = c.ReviewedByUserId,
        reviewed_at = c.ReviewedAt,
        created_at = c.CreatedAt,
        updated_at = c.UpdatedAt
    };

    private static object MapCanonicalConsent(GuardianConsentAdminItem consent) => new
    {
        consent.Id,
        minor_user_id = consent.MinorUserId,
        minor_name = consent.MinorName,
        minor_email = consent.MinorEmail,
        guardian_name = consent.GuardianName,
        guardian_email = consent.GuardianEmail,
        guardian_phone = consent.GuardianPhone,
        relationship = consent.Relationship,
        opportunity_id = consent.OpportunityId,
        opportunity_title = consent.OpportunityTitle,
        status = consent.Status,
        consent_given_at = consent.ConsentedAt,
        consent_withdrawn_at = consent.WithdrawnAt,
        expires_at = consent.ExpiresAt,
        created_at = consent.CreatedAt,
        consent_date = consent.ConsentDate,
        expires_date = consent.ExpiresAt
    };

    private ObjectResult LegacyGuardianDecisionGone() =>
        StatusCode(StatusCodes.Status410Gone, new
        {
            errors = new[]
            {
                new
                {
                    code = "ENDPOINT_RETIRED",
                    message = "Guardian consent must be granted by the guardian using the secure email verification link."
                }
            }
        });

    private string BaseUrl() => $"{Request.Scheme}://{Request.Host}";

    private static object MapPolicy(VolunteerTenantPolicy p) => new
    {
        p.Id,
        tenant_id = p.TenantId,
        min_age = p.MinAge,
        hours_required_for_certificate = p.HoursRequiredForCertificate,
        certificate_template_id = p.CertificateTemplateId,
        require_guardian_consent_under = p.RequireGuardianConsentUnder,
        auto_approve_verified_adults = p.AutoApproveVerifiedAdults,
        updated_at = p.UpdatedAt
    };

    // ─── Request DTOs ─────────────────────────────────────────────────────

    public class CourseRequest
    {
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("description")] public string? Description { get; set; }
        [JsonPropertyName("duration_minutes")] public int? DurationMinutes { get; set; }
        [JsonPropertyName("is_required")] public bool? IsRequired { get; set; }
        [JsonPropertyName("active")] public bool? Active { get; set; }
    }

    public class MarkCompletedRequest
    {
        [JsonPropertyName("score")] public int? Score { get; set; }
        [JsonPropertyName("certificate_url")] public string? CertificateUrl { get; set; }
    }

    public class CreateConsentRequest
    {
        [JsonPropertyName("minor_user_id")] public int MinorUserId { get; set; }
        [JsonPropertyName("guardian_name")] public string? GuardianName { get; set; }
        [JsonPropertyName("guardian_email")] public string? GuardianEmail { get; set; }
        [JsonPropertyName("guardian_relationship")] public string? GuardianRelationship { get; set; }
        [JsonPropertyName("consent_document_url")] public string? ConsentDocumentUrl { get; set; }
    }

    public class ReviewConsentRequest
    {
        [JsonPropertyName("note")] public string? Note { get; set; }
    }

    public class PolicyRequest
    {
        [JsonPropertyName("min_age")] public int? MinAge { get; set; }
        [JsonPropertyName("hours_required_for_certificate")] public decimal? HoursRequiredForCertificate { get; set; }
        [JsonPropertyName("certificate_template_id")] public int? CertificateTemplateId { get; set; }
        [JsonPropertyName("require_guardian_consent_under")] public int? RequireGuardianConsentUnder { get; set; }
        [JsonPropertyName("auto_approve_verified_adults")] public bool? AutoApproveVerifiedAdults { get; set; }
    }
}
