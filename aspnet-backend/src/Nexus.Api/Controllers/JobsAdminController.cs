// Copyright © 2024–2026 Jasper Ford
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
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin controller for job moderation and management.
/// </summary>
[ApiController]
[Route("api/admin/jobs")]
[Authorize(Policy = "AdminOnly")]
public class JobsAdminController : ControllerBase
{
    private readonly JobService _jobService;
    private readonly JobsBiasAuditService _biasAuditService;
    private readonly TenantContext _tenantContext;
    private readonly NexusDbContext _db;
    private readonly ILogger<JobsAdminController> _logger;

    public JobsAdminController(
        JobService jobService,
        JobsBiasAuditService biasAuditService,
        TenantContext tenantContext,
        NexusDbContext db,
        ILogger<JobsAdminController> logger)
    {
        _jobService = jobService;
        _biasAuditService = biasAuditService;
        _tenantContext = tenantContext;
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// Run a fairness ("four-fifths rule") audit across job applications.
    /// </summary>
    [HttpGet("bias-audit")]
    public async Task<IActionResult> BiasAudit(
        [FromQuery] int? jobId = null,
        [FromQuery] DateTime? since = null,
        CancellationToken ct = default)
    {
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var sinceUtc = (since ?? DateTime.UtcNow.AddDays(-90)).ToUniversalTime();
        var report = await _biasAuditService.RunAuditAsync(jobId, sinceUtc, ct);
        return Ok(report);
    }

    /// <summary>
    /// List all jobs (any status) for admin moderation.
    /// </summary>
    [HttpGet]
    [HttpGet("/api/v2/admin/jobs")]
    public async Task<IActionResult> ListAll(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? status = null)
    {
        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);

        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var (jobs, total) = await _jobService.ListAllJobsAsync(
            _tenantContext.TenantId.Value, status, page, limit);

        var data = jobs.Select(j => new
        {
            id = j.Id,
            title = j.Title,
            description = j.Description,
            category = j.Category,
            job_type = j.JobType,
            location = j.Location,
            is_remote = j.IsRemote,
            time_credits_per_hour = j.TimeCreditsPerHour,
            required_skills = j.RequiredSkills,
            contact_email = j.ContactEmail,
            status = j.Status,
            is_featured = j.IsFeatured,
            expires_at = j.ExpiresAt,
            filled_at = j.FilledAt,
            view_count = j.ViewCount,
            application_count = j.ApplicationCount,
            created_at = j.CreatedAt,
            updated_at = j.UpdatedAt,
            posted_by = j.PostedBy != null
                ? new
                {
                    id = j.PostedBy.Id,
                    first_name = j.PostedBy.FirstName,
                    last_name = j.PostedBy.LastName
                }
                : null
        });

        return Ok(new
        {
            data,
            pagination = new
            {
                page,
                limit,
                total,
                pages = (int)Math.Ceiling((double)total / limit)
            }
        });
    }

    /// <summary>
    /// Laravel React alias: GET /api/v2/admin/jobs/{id}.
    /// </summary>
    [HttpGet("/api/v2/admin/jobs/{id:int}")]
    public async Task<IActionResult> ShowV2(int id)
    {
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var job = await _db.JobVacancies
            .AsNoTracking()
            .Include(j => j.PostedBy)
            .FirstOrDefaultAsync(j => j.Id == id);

        return job == null
            ? NotFound(new { error = "Job not found" })
            : Ok(new { data = ProjectJob(job) });
    }

    /// <summary>
    /// Laravel React alias: DELETE /api/v2/admin/jobs/{id}.
    /// </summary>
    [HttpDelete("/api/v2/admin/jobs/{id:int}")]
    public async Task<IActionResult> DeleteV2(int id)
    {
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var error = await _jobService.DeleteJobAsync(
            _tenantContext.TenantId.Value,
            User.GetUserId() ?? 0,
            id,
            isAdmin: true);

        return error == "Job not found"
            ? NotFound(new { error })
            : error != null
                ? BadRequest(new { error })
                : Ok(new { data = new { deleted = true, id } });
    }

    /// <summary>
    /// Laravel React alias: POST /api/v2/admin/jobs/{id}/feature.
    /// </summary>
    [HttpPost("/api/v2/admin/jobs/{id:int}/feature")]
    public async Task<IActionResult> FeatureV2(int id, [FromBody] AdminFeatureJobV2Request? request)
    {
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var days = Math.Clamp(request?.DurationDays ?? 7, 1, 90);
        var (job, featuredUntil, error) = await _jobService.FeatureJobForDaysAsync(
            _tenantContext.TenantId.Value,
            id,
            days);

        return error == "Job not found"
            ? NotFound(new { error })
            : error != null
                ? BadRequest(new { error })
                : Ok(new { data = new { featured = true, id = job!.Id, duration_days = days, featured_until = featuredUntil } });
    }

    /// <summary>
    /// Laravel React alias: POST /api/v2/admin/jobs/{id}/unfeature.
    /// </summary>
    [HttpPost("/api/v2/admin/jobs/{id:int}/unfeature")]
    public async Task<IActionResult> UnfeatureV2(int id)
    {
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var (success, error) = await _jobService.UnfeatureJobAsync(_tenantContext.TenantId.Value, id);

        return error == "Job not found"
            ? NotFound(new { error })
            : !success
                ? BadRequest(new { error = error ?? "Update failed" })
                : Ok(new { data = new { featured = false, id } });
    }

    /// <summary>
    /// Laravel React alias: GET /api/v2/admin/jobs/{id}/applications.
    /// </summary>
    [HttpGet("/api/v2/admin/jobs/{id:int}/applications")]
    public async Task<IActionResult> GetApplicationsV2(int id)
    {
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var exists = await _db.JobVacancies.AsNoTracking().AnyAsync(j => j.Id == id);
        if (!exists)
            return NotFound(new { error = "Job not found" });

        var applications = await _db.JobApplications
            .AsNoTracking()
            .Include(a => a.Applicant)
            .Where(a => a.JobId == id)
            .OrderByDescending(a => a.CreatedAt)
            .Select(a => new
            {
                id = a.Id,
                job_id = a.JobId,
                applicant_user_id = a.ApplicantUserId,
                applicant = a.Applicant == null
                    ? null
                    : new
                    {
                        id = a.Applicant.Id,
                        first_name = a.Applicant.FirstName,
                        last_name = a.Applicant.LastName,
                        email = a.Applicant.Email
                    },
                cover_letter = a.CoverLetter,
                status = a.Status,
                reviewed_at = a.ReviewedAt,
                reviewed_by_user_id = a.ReviewedByUserId,
                review_notes = a.ReviewNotes,
                created_at = a.CreatedAt,
                updated_at = a.UpdatedAt
            })
            .ToListAsync();

        return Ok(new { data = applications });
    }

    /// <summary>
    /// Laravel React alias: PUT /api/v2/admin/jobs/applications/{id}.
    /// </summary>
    [HttpPut("/api/v2/admin/jobs/applications/{id:int}")]
    public async Task<IActionResult> UpdateApplicationV2(int id, [FromBody] AdminUpdateApplicationStatusRequest request)
    {
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        if (string.IsNullOrWhiteSpace(request.Status))
            return UnprocessableEntity(new { error = "VALIDATION_REQUIRED", field = "status" });

        var application = await _db.JobApplications
            .Include(a => a.Job)
            .Include(a => a.Applicant)
            .FirstOrDefaultAsync(a => a.Id == id);

        if (application == null)
            return NotFound(new { error = "Application not found" });

        var normalizedStatus = request.Status.Trim().ToLowerInvariant();
        if (normalizedStatus is not ("pending" or "reviewed" or "accepted" or "rejected" or "withdrawn"))
            return UnprocessableEntity(new { error = "VALIDATION_ERROR", field = "status" });

        application.Status = normalizedStatus;
        application.ReviewedAt = DateTime.UtcNow;
        application.ReviewedByUserId = User.GetUserId();
        application.ReviewNotes = request.Notes?.Trim();
        application.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { data = new { updated = true, id = application.Id, status = application.Status } });
    }

    /// <summary>
    /// Admin: change job status (override).
    /// </summary>
    [HttpPut("{id:int}/status")]
    public async Task<IActionResult> UpdateStatus(int id, [FromBody] AdminUpdateJobStatusRequest request)
    {
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        if (string.IsNullOrWhiteSpace(request.Status))
            return BadRequest(new { error = "Status is required" });

        var (job, error) = await _jobService.AdminUpdateStatusAsync(
            _tenantContext.TenantId.Value, id, request.Status);

        if (error == "Job not found")
            return NotFound(new { error });

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            id = job!.Id,
            title = job.Title,
            status = job.Status,
            updated_at = job.UpdatedAt
        });
    }

    /// <summary>
    /// Admin: toggle featured flag.
    /// </summary>
    [HttpPost("{id:int}/feature")]
    public async Task<IActionResult> ToggleFeatured(int id, [FromBody] AdminFeatureJobRequest request)
    {
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var (job, error) = await _jobService.FeatureJobAsync(
            _tenantContext.TenantId.Value, id, request.Featured);

        if (error == "Job not found")
            return NotFound(new { error });

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            id = job!.Id,
            title = job.Title,
            is_featured = job.IsFeatured,
            updated_at = job.UpdatedAt
        });
    }

    /// <summary>
    /// Admin: get job module statistics.
    /// </summary>
    [HttpGet("stats")]
    [HttpGet("/api/v2/admin/jobs/stats")]
    public async Task<IActionResult> GetStats()
    {
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var stats = await _jobService.GetJobStatsAsync(_tenantContext.TenantId.Value);

        return Ok(stats);
    }

    private static object ProjectJob(JobVacancy job) => new
    {
        id = job.Id,
        title = job.Title,
        description = job.Description,
        category = job.Category,
        job_type = job.JobType,
        location = job.Location,
        is_remote = job.IsRemote,
        time_credits_per_hour = job.TimeCreditsPerHour,
        required_skills = job.RequiredSkills,
        contact_email = job.ContactEmail,
        status = job.Status,
        is_featured = job.IsFeatured,
        featured_until = job.FeaturedUntil,
        expires_at = job.ExpiresAt,
        filled_at = job.FilledAt,
        view_count = job.ViewCount,
        application_count = job.ApplicationCount,
        created_at = job.CreatedAt,
        updated_at = job.UpdatedAt,
        posted_by = job.PostedBy == null
            ? null
            : new
            {
                id = job.PostedBy.Id,
                first_name = job.PostedBy.FirstName,
                last_name = job.PostedBy.LastName,
                email = job.PostedBy.Email
            }
    };
}

// Admin DTOs

public class AdminUpdateJobStatusRequest
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;
}

public class AdminFeatureJobRequest
{
    [JsonPropertyName("featured")]
    public bool Featured { get; set; }
}

public class AdminFeatureJobV2Request
{
    [JsonPropertyName("duration_days")]
    public int? DurationDays { get; set; }
}

public class AdminUpdateApplicationStatusRequest
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("notes")]
    public string? Notes { get; set; }
}
