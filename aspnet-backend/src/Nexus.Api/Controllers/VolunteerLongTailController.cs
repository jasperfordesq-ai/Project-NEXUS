// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Phase 65 — volunteer long-tail endpoints (expenses, wellbeing,
/// certificates, emergency alerts). Routes prefixed /api/volunteer/* for the
/// member-facing flows and /api/admin/volunteer/* for coordinator review.
/// Public certificate verification lives at /api/certificates/verify/{code}.
/// </summary>
[ApiController]
[Authorize]
public class VolunteerLongTailController : ControllerBase
{
    private readonly VolunteerLongTailService _service;

    public VolunteerLongTailController(VolunteerLongTailService service)
    {
        _service = service;
    }

    // ─── Member-facing (auth required) ──────────────────────────────────────

    [HttpPost("api/volunteer/expenses")]
    public async Task<IActionResult> SubmitExpense([FromBody] SubmitExpenseRequest req)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized();
        try
        {
            var entity = await _service.SubmitExpenseAsync(
                userId.Value, req.ShiftId, req.Amount, req.Currency ?? "EUR",
                req.Category, req.Description, req.ReceiptUrl);
            return Created($"/api/volunteer/expenses/{entity.Id}", new { data = MapExpense(entity) });
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpGet("api/volunteer/expenses/me")]
    public async Task<IActionResult> ListMyExpenses()
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized();
        var rows = await _service.ListExpensesForUserAsync(userId.Value);
        return Ok(new { data = rows.Select(MapExpense), total = rows.Count });
    }

    [HttpGet("api/volunteer/expenses/{id:int}")]
    public async Task<IActionResult> GetExpense(int id)
    {
        var entity = await _service.GetExpenseAsync(id);
        return entity == null ? NotFound() : Ok(new { data = MapExpense(entity) });
    }

    [HttpPost("api/volunteer/wellbeing")]
    public async Task<IActionResult> SubmitWellbeing([FromBody] SubmitWellbeingRequest req)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized();
        try
        {
            var entity = await _service.SubmitWellbeingAsync(
                userId.Value, req.ShiftId, req.Score, req.Note, req.RequiresFollowUp ?? false);
            return Created($"/api/volunteer/wellbeing/{entity.Id}", new { data = MapWellbeing(entity) });
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpGet("api/volunteer/certificates/me")]
    public async Task<IActionResult> ListMyCertificates()
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized();
        var rows = await _service.ListCertificatesForUserAsync(userId.Value);
        return Ok(new { data = rows.Select(MapCertificate), total = rows.Count });
    }

    [HttpGet("api/volunteer/alerts/active")]
    public async Task<IActionResult> ListActiveAlerts()
    {
        var rows = await _service.ListActiveAlertsAsync();
        return Ok(new { data = rows.Select(MapAlert), total = rows.Count });
    }

    // ─── Public certificate verification (no auth) ──────────────────────────

    [HttpGet("api/certificates/verify/{code}")]
    [AllowAnonymous]
    public async Task<IActionResult> VerifyCertificate(string code)
    {
        var entity = await _service.VerifyByCodeAsync(code);
        if (entity == null) return NotFound(new { verified = false, error = "invalid_or_expired" });
        return Ok(new
        {
            verified = true,
            data = new
            {
                entity.Id,
                entity.Title,
                entity.Description,
                hours_recognised = entity.HoursRecognised,
                issued_by = entity.IssuedBy,
                issued_at = entity.IssuedAt,
                expires_at = entity.ExpiresAt
            }
        });
    }

    // ─── Coordinator/admin (admin policy) ───────────────────────────────────

    [HttpGet("api/admin/volunteer/expenses")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> ListExpensesForReview([FromQuery] string? status = null)
    {
        var s = ParseStatus(status) ?? VolunteerExpenseStatus.Submitted;
        var rows = await _service.ListExpensesByStatusAsync(s);
        return Ok(new { data = rows.Select(MapExpense), total = rows.Count, status = s.ToString() });
    }

    [HttpPost("api/admin/volunteer/expenses/{id:int}/review")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> ReviewExpense(int id, [FromBody] ReviewExpenseRequest req)
    {
        var reviewer = User.GetUserId();
        if (reviewer is null) return Unauthorized();
        var entity = await _service.ReviewExpenseAsync(id, reviewer.Value, req.Approve, req.Note);
        return entity == null ? NotFound() : Ok(new { data = MapExpense(entity) });
    }

    [HttpPost("api/admin/volunteer/expenses/{id:int}/reimburse")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> Reimburse(int id)
    {
        var entity = await _service.MarkReimbursedAsync(id);
        return entity == null ? NotFound() : Ok(new { data = MapExpense(entity) });
    }

    [HttpGet("api/admin/volunteer/wellbeing/follow-ups")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> ListWellbeingFollowUps()
    {
        var rows = await _service.ListUnresolvedFollowUpsAsync();
        return Ok(new { data = rows.Select(MapWellbeing), total = rows.Count });
    }

    [HttpPost("api/admin/volunteer/wellbeing/{id:int}/resolve")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> ResolveWellbeing(int id, [FromBody] ResolveWellbeingRequest req)
    {
        var resolver = User.GetUserId();
        if (resolver is null) return Unauthorized();
        var entity = await _service.ResolveWellbeingAsync(id, resolver.Value, req.ResolutionNote);
        return entity == null ? NotFound() : Ok(new { data = MapWellbeing(entity) });
    }

    [HttpPost("api/admin/volunteer/certificates")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> IssueCertificate([FromBody] IssueCertificateRequest req)
    {
        try
        {
            var entity = await _service.IssueCertificateAsync(
                req.UserId, req.Title, req.Description, req.HoursRecognised,
                req.IssuedBy, req.ExpiresAt, req.IsPubliclyVerifiable ?? true);
            return Created($"/api/admin/volunteer/certificates/{entity.Id}", new { data = MapCertificate(entity) });
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("api/admin/volunteer/certificates/{id:int}/revoke")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> RevokeCertificate(int id, [FromBody] RevokeCertificateRequest req)
    {
        var entity = await _service.RevokeCertificateAsync(id, req.Reason);
        return entity == null ? NotFound() : Ok(new { data = MapCertificate(entity) });
    }

    [HttpPost("api/admin/volunteer/alerts")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> CreateAlert([FromBody] CreateAlertRequest req)
    {
        var creator = User.GetUserId();
        if (creator is null) return Unauthorized();
        try
        {
            var severity = Enum.TryParse<VolunteerEmergencyAlertSeverity>(req.Severity ?? "Info", true, out var sev)
                ? sev : VolunteerEmergencyAlertSeverity.Info;
            var entity = await _service.CreateAlertAsync(creator.Value, req.Title, req.Body, severity, req.OpportunityId, req.ShiftId);
            return Created($"/api/volunteer/alerts/{entity.Id}", new { data = MapAlert(entity) });
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("api/admin/volunteer/alerts/{id:int}/acknowledge")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AcknowledgeAlert(int id)
    {
        var entity = await _service.AcknowledgeAlertAsync(id);
        return entity == null ? NotFound() : Ok(new { data = MapAlert(entity) });
    }

    // ─── Mappers ────────────────────────────────────────────────────────────

    private static object MapExpense(VolunteerExpense e) => new
    {
        e.Id, e.UserId, e.ShiftId, e.Amount, e.Currency, e.Category, e.Description,
        receipt_url = e.ReceiptUrl, status = e.Status.ToString(),
        reviewer_note = e.ReviewerNote, reviewed_by_user_id = e.ReviewedByUserId,
        reviewed_at = e.ReviewedAt, reimbursed_at = e.ReimbursedAt,
        created_at = e.CreatedAt, updated_at = e.UpdatedAt
    };

    private static object MapWellbeing(VolunteerWellbeing w) => new
    {
        w.Id, w.UserId, w.ShiftId, w.Score, w.Note,
        requires_follow_up = w.RequiresFollowUp, is_resolved = w.IsResolved,
        resolved_by_user_id = w.ResolvedByUserId, resolved_at = w.ResolvedAt,
        resolution_note = w.ResolutionNote,
        created_at = w.CreatedAt, updated_at = w.UpdatedAt
    };

    private static object MapCertificate(VolunteerCertificate c) => new
    {
        c.Id, c.UserId, c.Title, c.Description,
        hours_recognised = c.HoursRecognised, issued_by = c.IssuedBy,
        issued_at = c.IssuedAt, expires_at = c.ExpiresAt,
        verification_code = c.VerificationCode,
        is_publicly_verifiable = c.IsPubliclyVerifiable, pdf_url = c.PdfUrl,
        is_revoked = c.IsRevoked, revocation_reason = c.RevocationReason,
        revoked_at = c.RevokedAt,
        created_at = c.CreatedAt, updated_at = c.UpdatedAt
    };

    private static object MapAlert(VolunteerEmergencyAlert a) => new
    {
        a.Id, a.OpportunityId, a.ShiftId, a.Title, a.Body,
        severity = a.Severity.ToString(),
        created_by_user_id = a.CreatedByUserId,
        is_active = a.IsActive, acknowledged_at = a.AcknowledgedAt,
        created_at = a.CreatedAt, updated_at = a.UpdatedAt
    };

    private static VolunteerExpenseStatus? ParseStatus(string? s) =>
        Enum.TryParse<VolunteerExpenseStatus>(s, true, out var v) ? v : null;

    // ─── Request DTOs ───────────────────────────────────────────────────────

    public class SubmitExpenseRequest
    {
        [JsonPropertyName("shift_id")] public int? ShiftId { get; set; }
        [JsonPropertyName("amount")] public decimal Amount { get; set; }
        [JsonPropertyName("currency")] public string? Currency { get; set; }
        [JsonPropertyName("category")] public string Category { get; set; } = string.Empty;
        [JsonPropertyName("description")] public string Description { get; set; } = string.Empty;
        [JsonPropertyName("receipt_url")] public string? ReceiptUrl { get; set; }
    }

    public class ReviewExpenseRequest
    {
        [JsonPropertyName("approve")] public bool Approve { get; set; }
        [JsonPropertyName("note")] public string? Note { get; set; }
    }

    public class SubmitWellbeingRequest
    {
        [JsonPropertyName("shift_id")] public int? ShiftId { get; set; }
        [JsonPropertyName("score")] public int Score { get; set; }
        [JsonPropertyName("note")] public string? Note { get; set; }
        [JsonPropertyName("requires_follow_up")] public bool? RequiresFollowUp { get; set; }
    }

    public class ResolveWellbeingRequest
    {
        [JsonPropertyName("resolution_note")] public string? ResolutionNote { get; set; }
    }

    public class IssueCertificateRequest
    {
        [JsonPropertyName("user_id")] public int UserId { get; set; }
        [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;
        [JsonPropertyName("description")] public string? Description { get; set; }
        [JsonPropertyName("hours_recognised")] public decimal? HoursRecognised { get; set; }
        [JsonPropertyName("issued_by")] public string? IssuedBy { get; set; }
        [JsonPropertyName("expires_at")] public DateTime? ExpiresAt { get; set; }
        [JsonPropertyName("is_publicly_verifiable")] public bool? IsPubliclyVerifiable { get; set; }
    }

    public class RevokeCertificateRequest
    {
        [JsonPropertyName("reason")] public string Reason { get; set; } = string.Empty;
    }

    public class CreateAlertRequest
    {
        [JsonPropertyName("opportunity_id")] public int? OpportunityId { get; set; }
        [JsonPropertyName("shift_id")] public int? ShiftId { get; set; }
        [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;
        [JsonPropertyName("body")] public string Body { get; set; } = string.Empty;
        [JsonPropertyName("severity")] public string? Severity { get; set; }
    }
}
