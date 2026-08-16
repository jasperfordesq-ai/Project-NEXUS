// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

/// <summary>
/// A volunteer's accessibility needs, and reviews of volunteering
/// organisations (R-27).
///
/// 🔴 Both had client screens and no table until 2026-08-16, so both returned
/// an empty list that a member reads as "I have none" and a visitor reads as
/// "this organisation has no reviews".
/// </summary>
[ApiController]
[Authorize]
public class VolunteerMemberRecordsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<VolunteerMemberRecordsController> _logger;

    public VolunteerMemberRecordsController(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<VolunteerMemberRecordsController> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    // ── Accessibility needs ──────────────────────────────────────────────

    /// <summary>
    /// GET /api/v2/volunteering/accessibility-needs — mine.
    ///
    /// The client reads a bare array (<c>api.get&lt;AccessibilityNeed[]&gt;</c>),
    /// so the payload is an array under <c>data</c>.
    /// </summary>
    [HttpGet("api/v2/volunteering/accessibility-needs")]
    [HttpGet("api/volunteering/accessibility-needs")]
    public async Task<IActionResult> ListAccessibilityNeeds()
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var needs = await _db.VolunteerAccessibilityNeeds.AsNoTracking()
            .Where(n => n.UserId == userId.Value)
            .OrderBy(n => n.NeedType)
            .Select(n => new
            {
                id = n.Id,
                need_type = n.NeedType,
                description = n.Description ?? string.Empty,
                accommodations_required = n.AccommodationsRequired ?? string.Empty,
                emergency_contact_name = n.EmergencyContactName ?? string.Empty,
                emergency_contact_phone = n.EmergencyContactPhone ?? string.Empty,
            })
            .ToListAsync(HttpContext.RequestAborted);

        return Ok(new { data = needs });
    }

    /// <summary>
    /// PUT /api/v2/volunteering/accessibility-needs — replace mine.
    ///
    /// The screen edits the whole set and saves it at once, so this is a
    /// replace rather than a merge: a need the member removed on screen must
    /// disappear, or they would have no way to withdraw one.
    ///
    /// 🔴 This is health-adjacent information about a member, so it is scoped
    /// hard to the caller: the body cannot name a user, and rows are matched by
    /// (caller, need type) rather than by any id the client sends. An id in the
    /// payload is deliberately ignored — honouring it would let one member
    /// overwrite another's record by guessing a number.
    /// </summary>
    [HttpPut("api/v2/volunteering/accessibility-needs")]
    [HttpPut("api/volunteering/accessibility-needs")]
    public async Task<IActionResult> ReplaceAccessibilityNeeds([FromBody] AccessibilityNeedsRequest? request)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var submitted = request?.Needs ?? [];
        var ct = HttpContext.RequestAborted;

        foreach (var need in submitted)
        {
            var type = need.NeedType?.Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(type)
                || !VolunteerAccessibilityNeed.NeedTypes.All.Contains(type))
            {
                return BadRequest(new
                {
                    error = $"need_type must be one of: {string.Join(", ", VolunteerAccessibilityNeed.NeedTypes.All)}",
                    code = "VALIDATION_ERROR",
                });
            }
        }

        // The unique key is (tenant, user, need_type), so two entries of the
        // same type in one payload would violate it. Reject rather than let the
        // database decide which one survives.
        var duplicates = submitted
            .GroupBy(n => n.NeedType?.Trim().ToLowerInvariant())
            .Where(g => g.Count() > 1)
            .Select(g => g.Key)
            .ToList();
        if (duplicates.Count > 0)
        {
            return BadRequest(new
            {
                error = $"Each need type may appear once; repeated: {string.Join(", ", duplicates)}",
                code = "VALIDATION_ERROR",
            });
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var existing = await _db.VolunteerAccessibilityNeeds
            .Where(n => n.UserId == userId.Value)
            .ToListAsync(ct);

        var now = DateTime.UtcNow;

        foreach (var need in submitted)
        {
            var type = need.NeedType!.Trim().ToLowerInvariant();
            var row = existing.FirstOrDefault(e =>
                string.Equals(e.NeedType, type, StringComparison.OrdinalIgnoreCase));

            if (row is null)
            {
                row = new VolunteerAccessibilityNeed
                {
                    TenantId = tenantId,
                    UserId = userId.Value,
                    NeedType = type,
                    CreatedAt = now,
                };
                _db.VolunteerAccessibilityNeeds.Add(row);
            }

            row.Description = Blank(need.Description);
            row.AccommodationsRequired = Blank(need.AccommodationsRequired);
            row.EmergencyContactName = Blank(need.EmergencyContactName);
            row.EmergencyContactPhone = Blank(need.EmergencyContactPhone);
            row.UpdatedAt = now;
        }

        var keptTypes = submitted
            .Select(n => n.NeedType!.Trim().ToLowerInvariant())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var removed = existing.Where(e => !keptTypes.Contains(e.NeedType)).ToList();
        if (removed.Count > 0) _db.VolunteerAccessibilityNeeds.RemoveRange(removed);

        await _db.SaveChangesAsync(ct);

        return Ok(new { success = true, data = new { saved = submitted.Count, removed = removed.Count } });
    }

    // ── Reviews ──────────────────────────────────────────────────────────

    /// <summary>
    /// GET /api/v2/volunteering/reviews/organization/{id} — an organisation's
    /// reviews. The client reads <c>{ reviews: [...] }</c>.
    /// </summary>
    [HttpGet("api/v2/volunteering/reviews/organization/{organisationId:int}")]
    [HttpGet("api/volunteering/reviews/organization/{organisationId:int}")]
    public async Task<IActionResult> OrganisationReviews(int organisationId)
    {
        var ct = HttpContext.RequestAborted;

        var reviews = await _db.VolunteerReviews.AsNoTracking()
            .Where(r => r.TargetType == VolunteerReview.TargetTypes.Organization
                && r.TargetId == organisationId
                && r.Approved)
            .OrderByDescending(r => r.CreatedAt)
            .Take(200)
            .Select(r => new
            {
                id = r.Id,
                rating = r.Rating,
                comment = r.Comment ?? string.Empty,
                author = new
                {
                    id = (int?)r.ReviewerId,
                    name = r.Reviewer != null ? r.Reviewer.FirstName : string.Empty,
                    avatar = r.Reviewer != null ? r.Reviewer.AvatarUrl : null,
                },
                created_at = r.CreatedAt,
            })
            .ToListAsync(ct);

        return Ok(new { reviews });
    }

    /// <summary>
    /// POST /api/v2/volunteering/reviews — leave a review.
    ///
    /// One review per person per subject: a second submission updates the
    /// first rather than stacking, because a single reviewer able to post ten
    /// five-star reviews makes the average worthless.
    /// </summary>
    [HttpPost("api/v2/volunteering/reviews")]
    [HttpPost("api/volunteering/reviews")]
    public async Task<IActionResult> CreateReview([FromBody] ReviewRequest? request)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var targetType = request?.TargetType?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(targetType)
            || !VolunteerReview.TargetTypes.All.Contains(targetType))
        {
            return BadRequest(new
            {
                error = "target_type must be 'organization' or 'user'",
                code = "VALIDATION_ERROR",
            });
        }

        if (request!.TargetId <= 0)
        {
            return BadRequest(new { error = "target_id is required", code = "VALIDATION_ERROR" });
        }

        if (request.Rating < 1 || request.Rating > 5)
        {
            return BadRequest(new { error = "rating must be between 1 and 5", code = "VALIDATION_ERROR" });
        }

        // Reviewing yourself is not a review.
        if (targetType == VolunteerReview.TargetTypes.User && request.TargetId == userId.Value)
        {
            return BadRequest(new { error = "You cannot review yourself", code = "VALIDATION_ERROR" });
        }

        var ct = HttpContext.RequestAborted;
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var existing = await _db.VolunteerReviews.FirstOrDefaultAsync(r =>
            r.ReviewerId == userId.Value
            && r.TargetType == targetType
            && r.TargetId == request.TargetId, ct);

        if (existing is null)
        {
            existing = new VolunteerReview
            {
                TenantId = tenantId,
                ReviewerId = userId.Value,
                TargetType = targetType,
                TargetId = request.TargetId,
                CreatedAt = DateTime.UtcNow,
            };
            _db.VolunteerReviews.Add(existing);
        }

        existing.Rating = request.Rating;
        existing.Comment = Blank(request.Comment);

        await _db.SaveChangesAsync(ct);

        return Ok(new { success = true, data = new { id = existing.Id, rating = existing.Rating } });
    }

    private static string? Blank(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    public sealed class AccessibilityNeedsRequest
    {
        [JsonPropertyName("needs")]
        public List<AccessibilityNeedInput> Needs { get; set; } = [];
    }

    public sealed class AccessibilityNeedInput
    {
        [JsonPropertyName("need_type")]
        public string? NeedType { get; set; }

        [JsonPropertyName("description")]
        public string? Description { get; set; }

        [JsonPropertyName("accommodations_required")]
        public string? AccommodationsRequired { get; set; }

        [JsonPropertyName("emergency_contact_name")]
        public string? EmergencyContactName { get; set; }

        [JsonPropertyName("emergency_contact_phone")]
        public string? EmergencyContactPhone { get; set; }
    }

    public sealed class ReviewRequest
    {
        [JsonPropertyName("target_type")]
        public string? TargetType { get; set; }

        [JsonPropertyName("target_id")]
        public int TargetId { get; set; }

        [JsonPropertyName("rating")]
        public int Rating { get; set; }

        [JsonPropertyName("comment")]
        public string? Comment { get; set; }
    }
}
