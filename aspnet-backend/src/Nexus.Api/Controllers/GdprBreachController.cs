// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/gdpr")]
[Authorize(Policy = "AdminOnly")]
public class GdprBreachController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<GdprBreachController> _logger;

    public GdprBreachController(NexusDbContext db, TenantContext tenantContext, ILogger<GdprBreachController> logger)
    { _db = db; _tenantContext = tenantContext; _logger = logger; }

    [HttpGet("breaches")]
    public async Task<IActionResult> GetBreaches([FromQuery] string? status = null, [FromQuery] string? severity = null, [FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        if (page < 1) page = 1; if (limit < 1) limit = 1; if (limit > 100) limit = 100;
        var query = _db.GdprBreaches.AsQueryable();
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(b => b.Status == status);
        if (!string.IsNullOrWhiteSpace(severity)) query = query.Where(b => b.Severity == severity);
        var total = await query.CountAsync();
        var breaches = await query.AsNoTracking().OrderByDescending(b => b.DetectedAt).Skip((page - 1) * limit).Take(limit)
            .Select(b => new { b.Id, b.Title, b.Severity, b.Status, affected_users_count = b.AffectedUsersCount, detected_at = b.DetectedAt, contained_at = b.ContainedAt, resolved_at = b.ResolvedAt, reported_to_authority_at = b.ReportedToAuthorityAt, reported_by = b.ReportedBy != null ? new { b.ReportedBy.Id, b.ReportedBy.FirstName, b.ReportedBy.LastName } : null, created_at = b.CreatedAt }).ToListAsync();
        return Ok(new { data = breaches, pagination = new { page, limit, total, pages = (int)Math.Ceiling(total / (double)limit) } });
    }

    [HttpGet("breaches/{id:int}")]
    public async Task<IActionResult> GetBreach(int id)
    {
        var breach = await _db.GdprBreaches.AsNoTracking().Where(b => b.Id == id)
            .Select(b => new { b.Id, b.Title, b.Description, b.Severity, b.Status, affected_users_count = b.AffectedUsersCount, data_types_affected = b.DataTypesAffected, detected_at = b.DetectedAt, contained_at = b.ContainedAt, resolved_at = b.ResolvedAt, reported_to_authority_at = b.ReportedToAuthorityAt, authority_reference = b.AuthorityReference, remediation_steps = b.RemediationSteps, reported_by = b.ReportedBy != null ? new { b.ReportedBy.Id, b.ReportedBy.FirstName, b.ReportedBy.LastName } : null, created_at = b.CreatedAt, updated_at = b.UpdatedAt }).FirstOrDefaultAsync();
        if (breach == null) return NotFound(new { error = "Breach not found" });
        return Ok(breach);
    }

    [HttpPost("breaches")]
    public async Task<IActionResult> CreateBreach([FromBody] CreateBreachRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        if (string.IsNullOrWhiteSpace(request.Title)) return BadRequest(new { error = "Title is required" });
        if (string.IsNullOrWhiteSpace(request.Description)) return BadRequest(new { error = "Description is required" });
        var validSeverities = new[] { "low", "medium", "high", "critical" };
        var severity = request.Severity ?? "low";
        if (!validSeverities.Contains(severity)) return BadRequest(new { error = "Invalid severity. Valid: low, medium, high, critical" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var breach = new GdprBreach { TenantId = tenantId, Title = request.Title.Trim(), Description = request.Description.Trim(), Severity = severity, Status = "detected", AffectedUsersCount = request.AffectedUsersCount, DataTypesAffected = request.DataTypesAffected?.Trim(), DetectedAt = request.DetectedAt ?? DateTime.UtcNow, ReportedById = userId.Value };
        _db.GdprBreaches.Add(breach);
        await _db.SaveChangesAsync();
        _logger.LogWarning("GDPR Breach reported by admin {UserId}: {Title} (severity: {Severity})", userId, breach.Title, breach.Severity);
        return CreatedAtAction(nameof(GetBreach), new { id = breach.Id }, new { success = true, message = "Breach reported", breach = new { breach.Id, breach.Title, breach.Severity, breach.Status, detected_at = breach.DetectedAt, created_at = breach.CreatedAt } });
    }

    [HttpPut("breaches/{id:int}")]
    public async Task<IActionResult> UpdateBreach(int id, [FromBody] UpdateBreachRequest request)
    {
        var breach = await _db.GdprBreaches.FirstOrDefaultAsync(b => b.Id == id);
        if (breach == null) return NotFound(new { error = "Breach not found" });
        var validStatuses = new[] { "detected", "contained", "investigating", "remediated", "resolved", "closed" };
        if (request.Status != null)
        {
            if (!validStatuses.Contains(request.Status)) return BadRequest(new { error = "Invalid status" });
            breach.Status = request.Status;
            if (request.Status == "contained" && breach.ContainedAt == null) breach.ContainedAt = DateTime.UtcNow;
            else if (request.Status == "resolved" || request.Status == "closed") breach.ResolvedAt ??= DateTime.UtcNow;
        }
        if (request.RemediationSteps != null) breach.RemediationSteps = request.RemediationSteps.Trim();
        if (request.AffectedUsersCount.HasValue) breach.AffectedUsersCount = request.AffectedUsersCount.Value;
        if (request.Severity != null)
        {
            var validSeverities = new[] { "low", "medium", "high", "critical" };
            if (!validSeverities.Contains(request.Severity)) return BadRequest(new { error = "Invalid severity" });
            breach.Severity = request.Severity;
        }
        breach.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, message = "Breach updated", breach = new { breach.Id, breach.Title, breach.Severity, breach.Status, remediation_steps = breach.RemediationSteps, contained_at = breach.ContainedAt, resolved_at = breach.ResolvedAt, updated_at = breach.UpdatedAt } });
    }

    [HttpPut("breaches/{id:int}/report-authority")]
    public async Task<IActionResult> ReportToAuthority(int id, [FromBody] ReportAuthorityRequest? request = null)
    {
        var breach = await _db.GdprBreaches.FirstOrDefaultAsync(b => b.Id == id);
        if (breach == null) return NotFound(new { error = "Breach not found" });
        if (breach.ReportedToAuthorityAt != null) return BadRequest(new { error = "Breach has already been reported to authority" });
        breach.ReportedToAuthorityAt = DateTime.UtcNow;
        breach.AuthorityReference = request?.AuthorityReference?.Trim();
        breach.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, message = "Breach marked as reported to authority", breach = new { breach.Id, reported_to_authority_at = breach.ReportedToAuthorityAt, authority_reference = breach.AuthorityReference } });
    }

    [HttpGet("consent-types")]
    public async Task<IActionResult> GetConsentTypes()
    {
        var types = await _db.GdprConsentTypes.AsNoTracking().OrderBy(c => c.Key)
            .Select(c => new { c.Id, c.Key, c.Name, c.Description, is_required = c.IsRequired, c.Version, is_active = c.IsActive, created_at = c.CreatedAt, updated_at = c.UpdatedAt }).ToListAsync();
        return Ok(new { data = types });
    }

    [HttpPost("consent-types")]
    public async Task<IActionResult> CreateConsentType([FromBody] CreateConsentTypeRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Key)) return BadRequest(new { error = "Key is required" });
        if (string.IsNullOrWhiteSpace(request.Name)) return BadRequest(new { error = "Name is required" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (await _db.GdprConsentTypes.AnyAsync(c => c.Key == request.Key)) return Conflict(new { error = "Consent type with this key already exists" });
        var ct = new GdprConsentType { TenantId = tenantId, Key = request.Key.Trim(), Name = request.Name.Trim(), Description = request.Description?.Trim(), IsRequired = request.IsRequired, Version = 1, IsActive = true };
        _db.GdprConsentTypes.Add(ct);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetConsentTypes), null, new { success = true, message = "Consent type created", consent_type = new { ct.Id, ct.Key, ct.Name, ct.Description, is_required = ct.IsRequired, ct.Version, is_active = ct.IsActive, created_at = ct.CreatedAt } });
    }

    [HttpGet("consent-stats")]
    public async Task<IActionResult> GetConsentStats()
    {
        var types = await _db.GdprConsentTypes.AsNoTracking().Where(c => c.IsActive).ToListAsync();

        // Batch query: get all consent counts in a single DB round-trip instead of 2 queries per type
        var consentCounts = await _db.ConsentRecords
            .GroupBy(c => new { c.ConsentType, c.IsGranted })
            .Select(g => new { g.Key.ConsentType, g.Key.IsGranted, Count = g.Count() })
            .ToListAsync();

        var countLookup = consentCounts.ToLookup(c => c.ConsentType);

        var stats = types.Select(ct =>
        {
            var typeRecords = countLookup[ct.Key];
            var granted = typeRecords.Where(r => r.IsGranted).Sum(r => r.Count);
            var revoked = typeRecords.Where(r => !r.IsGranted).Sum(r => r.Count);
            return new { consent_type = ct.Key, name = ct.Name, is_required = ct.IsRequired, granted_count = granted, revoked_count = revoked, total_records = granted + revoked };
        });

        return Ok(new { data = stats });
    }

    private int? GetCurrentUserId() => User.GetUserId();
}

public class CreateBreachRequest
{
    [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;
    [JsonPropertyName("description")] public string Description { get; set; } = string.Empty;
    [JsonPropertyName("severity")] public string? Severity { get; set; }
    [JsonPropertyName("affected_users_count")] public int AffectedUsersCount { get; set; }
    [JsonPropertyName("data_types_affected")] public string? DataTypesAffected { get; set; }
    [JsonPropertyName("detected_at")] public DateTime? DetectedAt { get; set; }
}
public class UpdateBreachRequest
{
    [JsonPropertyName("status")] public string? Status { get; set; }
    [JsonPropertyName("severity")] public string? Severity { get; set; }
    [JsonPropertyName("remediation_steps")] public string? RemediationSteps { get; set; }
    [JsonPropertyName("affected_users_count")] public int? AffectedUsersCount { get; set; }
}
public class ReportAuthorityRequest
{
    [JsonPropertyName("authority_reference")] public string? AuthorityReference { get; set; }
}
public class CreateConsentTypeRequest
{
    [JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("is_required")] public bool IsRequired { get; set; }
}
