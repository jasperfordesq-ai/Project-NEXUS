// Copyright (c) 2024-2026 Jasper Ford
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
using Nexus.Api.Authorization;

namespace Nexus.Api.Controllers;

/// <summary>
/// Safeguarding concerns raised during volunteering (R-27).
///
/// 🔴 What was here before, and it is the worst thing found in this backend.
/// A volunteer could report a safeguarding concern and receive "Incident
/// recorded". Nothing recorded it where anyone could read: the POST wrote the
/// body as an opaque blob into tenant config, the member's list returned a
/// hardcoded empty array, the single-incident endpoint fabricated
/// <c>{id, status:"open"}</c> for any id, and no admin surface read incidents at
/// all. The report was accepted, acknowledged, and lost — and neither the
/// reporter nor a safeguarding lead had any way to notice.
///
/// Rules here are safeguarding requirements rather than preferences:
///
/// <list type="bullet">
/// <item><description><b>Nobody can delete a report</b>, including the person
/// who made it. A raised concern is a record; withdrawing it is a status a lead
/// sets with a reason, not an erasure. There is deliberately no DELETE
/// endpoint.</description></item>
/// <item><description><b>A reporter sees only their own reports.</b> Reading
/// someone else's concern would expose the subject of it.</description></item>
/// <item><description><b>Only staff may triage.</b> Status, assignment,
/// authority notification and resolution are admin-only.</description></item>
/// <item><description><b>Resolution requires a reason.</b> Closing a
/// safeguarding concern with no note leaves no answer to "why was this
/// closed?", which is the question an inquiry asks first.</description></item>
/// </list>
/// </summary>
[ApiController]
[Authorize]
public class VolunteerSafeguardingIncidentsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<VolunteerSafeguardingIncidentsController> _logger;

    public VolunteerSafeguardingIncidentsController(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<VolunteerSafeguardingIncidentsController> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// POST /api/v2/volunteering/incidents — raise a concern.
    /// </summary>
    [HttpPost("api/v2/volunteering/incidents")]
    [HttpPost("api/volunteering/incidents")]
    public async Task<IActionResult> Report([FromBody] IncidentRequest? request)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var description = request?.Description?.Trim();
        if (string.IsNullOrWhiteSpace(description))
        {
            return BadRequest(new { error = "description is required", code = "VALIDATION_ERROR" });
        }

        var severity = Normalise(request?.Severity, VolunteerSafeguardingIncident.Severities.All,
            VolunteerSafeguardingIncident.Severities.Medium);
        if (severity is null)
        {
            return BadRequest(new
            {
                error = $"severity must be one of: {string.Join(", ", VolunteerSafeguardingIncident.Severities.All)}",
                code = "VALIDATION_ERROR",
            });
        }

        var incidentType = Normalise(request?.IncidentType, VolunteerSafeguardingIncident.IncidentTypes.All,
            VolunteerSafeguardingIncident.IncidentTypes.Concern);
        if (incidentType is null)
        {
            return BadRequest(new
            {
                error = $"incident_type must be one of: {string.Join(", ", VolunteerSafeguardingIncident.IncidentTypes.All)}",
                code = "VALIDATION_ERROR",
            });
        }

        DateOnly? incidentDate = null;
        if (!string.IsNullOrWhiteSpace(request?.IncidentDate))
        {
            if (!DateOnly.TryParse(request.IncidentDate, out var parsed))
            {
                return BadRequest(new { error = "incident_date must be a date (YYYY-MM-DD)", code = "VALIDATION_ERROR" });
            }
            incidentDate = parsed;
        }

        var incident = new VolunteerSafeguardingIncident
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            ReportedBy = userId.Value,
            Title = Blank(request?.Title),
            Description = description,
            Severity = severity,
            IncidentType = incidentType,
            Category = Blank(request?.Category) ?? "general",
            IncidentDate = incidentDate,
            ShiftId = request?.ShiftId,
            OpportunityId = request?.OpportunityId,
            OrganizationId = request?.OrganizationId,
            SubjectUserId = request?.SubjectUserId,
            InvolvedUserId = request?.InvolvedUserId,
            Status = VolunteerSafeguardingIncident.Statuses.Open,
            CreatedAt = DateTime.UtcNow,
        };

        _db.VolunteerSafeguardingIncidents.Add(incident);
        await _db.SaveChangesAsync(HttpContext.RequestAborted);

        // Logged without the description: a safeguarding concern must not be
        // copied into application logs, which have a different audience and
        // retention from the incident record itself.
        _logger.LogInformation(
            "Safeguarding incident {IncidentId} raised in tenant {TenantId}, severity {Severity}",
            incident.Id, incident.TenantId, incident.Severity);

        return Ok(new
        {
            success = true,
            data = new { id = incident.Id, status = incident.Status, severity = incident.Severity },
        });
    }

    /// <summary>
    /// GET /api/v2/volunteering/incidents — the concerns I raised.
    /// </summary>
    [HttpGet("api/v2/volunteering/incidents")]
    [HttpGet("api/volunteering/incidents")]
    public async Task<IActionResult> Mine([FromQuery] int page = 1, [FromQuery(Name = "per_page")] int perPage = 20)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var ct = HttpContext.RequestAborted;
        page = Math.Max(1, page);
        perPage = Math.Clamp(perPage, 1, 100);

        var query = _db.VolunteerSafeguardingIncidents.AsNoTracking()
            .Where(i => i.ReportedBy == userId.Value);

        var total = await query.CountAsync(ct);
        var items = await query
            .OrderByDescending(i => i.CreatedAt)
            .Skip((page - 1) * perPage)
            .Take(perPage)
            .Select(i => Summarise(i))
            .ToListAsync(ct);

        return Ok(new { items, total, page, per_page = perPage });
    }

    /// <summary>
    /// GET /api/v2/volunteering/incidents/{id} — one of mine.
    ///
    /// 🔴 404 for someone else's, not 403: confirming that an incident exists
    /// tells the asker that a concern was raised, which is itself disclosure.
    /// The previous handler answered a fabricated record for ANY id.
    /// </summary>
    [HttpGet("api/v2/volunteering/incidents/{id:int}")]
    [HttpGet("api/volunteering/incidents/{id:int}")]
    public async Task<IActionResult> One(int id)
    {
        var userId = User.GetUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });

        var incident = await _db.VolunteerSafeguardingIncidents.AsNoTracking()
            .Where(i => i.Id == id && i.ReportedBy == userId.Value)
            .Select(i => Summarise(i))
            .FirstOrDefaultAsync(HttpContext.RequestAborted);

        return incident is null
            ? NotFound(new { error = "Incident not found" })
            : Ok(new { data = incident });
    }

    /// <summary>
    /// GET /api/v2/admin/volunteering/incidents — the triage queue.
    ///
    /// Most severe first, then oldest: a critical concern raised an hour ago
    /// outranks a low one from last week, and within a severity the one that has
    /// waited longest is the one at risk of being forgotten.
    /// </summary>
    [HttpGet("api/v2/admin/volunteering/incidents")]
    [HttpGet("api/admin/volunteering/incidents")]
    [Authorize(Policy = NexusAuthorizationPolicies.AdminOnly)]
    public async Task<IActionResult> AdminList([FromQuery] string? status = null, [FromQuery] string? severity = null)
    {
        var ct = HttpContext.RequestAborted;
        var query = _db.VolunteerSafeguardingIncidents.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(i => i.Status == status.Trim().ToLowerInvariant());
        if (!string.IsNullOrWhiteSpace(severity)) query = query.Where(i => i.Severity == severity.Trim().ToLowerInvariant());

        var rows = await query.ToListAsync(ct);

        var ordered = rows
            .OrderBy(i => SeverityRank(i.Severity))
            .ThenBy(i => i.CreatedAt)
            .Take(500)
            .Select(i => new
            {
                id = i.Id,
                title = i.Title,
                description = i.Description,
                incident_type = i.IncidentType,
                category = i.Category,
                severity = i.Severity,
                status = i.Status,
                reported_by = i.ReportedBy,
                subject_user_id = i.SubjectUserId,
                involved_user_id = i.InvolvedUserId,
                shift_id = i.ShiftId,
                opportunity_id = i.OpportunityId,
                organization_id = i.OrganizationId,
                incident_date = i.IncidentDate?.ToString("yyyy-MM-dd"),
                assigned_to = i.AssignedTo,
                dlp_user_id = i.DlpUserId,
                dlp_notified_at = i.DlpNotifiedAt,
                authority_notified = i.AuthorityNotified,
                authority_reference = i.AuthorityReference,
                action_taken = i.ActionTaken,
                resolution_notes = i.ResolutionNotes,
                resolved_at = i.ResolvedAt,
                created_at = i.CreatedAt,
                updated_at = i.UpdatedAt,
            })
            .ToList();

        return Ok(new { data = ordered, total = ordered.Count });
    }

    /// <summary>
    /// PUT /api/v2/admin/volunteering/incidents/{id} — triage one.
    /// </summary>
    [HttpPut("api/v2/admin/volunteering/incidents/{id:int}")]
    [HttpPut("api/admin/volunteering/incidents/{id:int}")]
    [Authorize(Policy = NexusAuthorizationPolicies.AdminOnly)]
    public async Task<IActionResult> AdminUpdate(int id, [FromBody] IncidentTriageRequest? request)
    {
        var actorId = User.GetUserId();
        if (actorId is null) return Unauthorized(new { error = "Invalid token" });

        var ct = HttpContext.RequestAborted;
        var incident = await _db.VolunteerSafeguardingIncidents.FirstOrDefaultAsync(i => i.Id == id, ct);
        if (incident is null) return NotFound(new { error = "Incident not found" });

        if (request?.Status is not null)
        {
            var status = Normalise(request.Status, VolunteerSafeguardingIncident.Statuses.All, null);
            if (status is null)
            {
                return BadRequest(new
                {
                    error = $"status must be one of: {string.Join(", ", VolunteerSafeguardingIncident.Statuses.All)}",
                    code = "VALIDATION_ERROR",
                });
            }

            var closing = status is VolunteerSafeguardingIncident.Statuses.Resolved
                or VolunteerSafeguardingIncident.Statuses.Closed;

            // 🔴 A safeguarding concern closed with no reason leaves nothing to
            // answer "why was this closed?" — the first question any review
            // asks. The note may come with this request or already be on the
            // record.
            var note = Blank(request.ResolutionNotes) ?? incident.ResolutionNotes;
            if (closing && string.IsNullOrWhiteSpace(note))
            {
                return BadRequest(new
                {
                    error = "resolution_notes is required when resolving or closing an incident",
                    code = "VALIDATION_ERROR",
                });
            }

            incident.Status = status;
            if (closing) incident.ResolvedAt ??= DateTime.UtcNow;
        }

        if (request?.ResolutionNotes is not null) incident.ResolutionNotes = Blank(request.ResolutionNotes);
        if (request?.ActionTaken is not null) incident.ActionTaken = Blank(request.ActionTaken);
        if (request?.AssignedTo is not null) incident.AssignedTo = request.AssignedTo;
        if (request?.Severity is not null)
        {
            var severity = Normalise(request.Severity, VolunteerSafeguardingIncident.Severities.All, null);
            if (severity is null)
            {
                return BadRequest(new { error = "severity is not recognised", code = "VALIDATION_ERROR" });
            }
            incident.Severity = severity;
        }

        if (request?.DlpUserId is not null)
        {
            incident.DlpUserId = request.DlpUserId;
            incident.DlpNotifiedAt ??= DateTime.UtcNow;
        }

        if (request?.AuthorityNotified == true)
        {
            incident.AuthorityNotified = true;
            incident.AuthorityReference = Blank(request.AuthorityReference) ?? incident.AuthorityReference;
        }

        incident.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        _logger.LogInformation(
            "Safeguarding incident {IncidentId} triaged by {ActorId}: status {Status}, severity {Severity}",
            incident.Id, actorId.Value, incident.Status, incident.Severity);

        return Ok(new { success = true, data = new { id = incident.Id, status = incident.Status } });
    }

    /// <summary>Critical first — the queue is read top-down under pressure.</summary>
    private static int SeverityRank(string severity) => severity switch
    {
        VolunteerSafeguardingIncident.Severities.Critical => 0,
        VolunteerSafeguardingIncident.Severities.High => 1,
        VolunteerSafeguardingIncident.Severities.Medium => 2,
        _ => 3,
    };

    private static object Summarise(VolunteerSafeguardingIncident i) => new
    {
        id = i.Id,
        title = i.Title,
        description = i.Description,
        incident_type = i.IncidentType,
        category = i.Category,
        severity = i.Severity,
        status = i.Status,
        incident_date = i.IncidentDate == null ? null : i.IncidentDate.Value.ToString("yyyy-MM-dd"),
        action_taken = i.ActionTaken,
        resolution_notes = i.ResolutionNotes,
        resolved_at = i.ResolvedAt,
        created_at = i.CreatedAt,
        updated_at = i.UpdatedAt,
    };

    private static string? Normalise(string? value, string[] allowed, string? fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        var candidate = value.Trim().ToLowerInvariant();
        return allowed.Contains(candidate) ? candidate : null;
    }

    private static string? Blank(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    public sealed class IncidentRequest
    {
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("description")] public string? Description { get; set; }
        [JsonPropertyName("severity")] public string? Severity { get; set; }
        [JsonPropertyName("category")] public string? Category { get; set; }
        [JsonPropertyName("incident_type")] public string? IncidentType { get; set; }
        [JsonPropertyName("incident_date")] public string? IncidentDate { get; set; }
        [JsonPropertyName("shift_id")] public int? ShiftId { get; set; }
        [JsonPropertyName("opportunity_id")] public int? OpportunityId { get; set; }
        [JsonPropertyName("organization_id")] public int? OrganizationId { get; set; }
        [JsonPropertyName("subject_user_id")] public int? SubjectUserId { get; set; }
        [JsonPropertyName("involved_user_id")] public int? InvolvedUserId { get; set; }
    }

    public sealed class IncidentTriageRequest
    {
        [JsonPropertyName("status")] public string? Status { get; set; }
        [JsonPropertyName("severity")] public string? Severity { get; set; }
        [JsonPropertyName("assigned_to")] public int? AssignedTo { get; set; }
        [JsonPropertyName("action_taken")] public string? ActionTaken { get; set; }
        [JsonPropertyName("resolution_notes")] public string? ResolutionNotes { get; set; }
        [JsonPropertyName("dlp_user_id")] public int? DlpUserId { get; set; }
        [JsonPropertyName("authority_notified")] public bool? AuthorityNotified { get; set; }
        [JsonPropertyName("authority_reference")] public string? AuthorityReference { get; set; }
    }
}
