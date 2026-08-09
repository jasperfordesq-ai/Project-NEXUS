// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Jobs controller - CRUD for job vacancies, applications, and saved jobs.
/// All endpoints require authentication.
/// </summary>
[ApiController]
[Route("api/jobs")]
[Authorize]
public class JobsController : ControllerBase
{
    private readonly JobService _jobService;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<JobsController> _logger;

    public JobsController(JobService jobService, TenantContext tenantContext, ILogger<JobsController> logger)
    {
        _jobService = jobService;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// List active jobs with pagination and optional filters.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? search = null,
        [FromQuery] string? category = null,
        [FromQuery] string? job_type = null,
        [FromQuery] string? status = null)
    {
        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);

        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var (jobs, total) = await _jobService.ListJobsAsync(
            _tenantContext.TenantId.Value, search, category, job_type, status, page, limit);

        var data = jobs.Select(j => MapJobResponse(j));

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
    /// Get distinct job categories with active job counts.
    /// </summary>
    [HttpGet("categories")]
    public async Task<IActionResult> GetCategories()
    {
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var categories = await _jobService.GetJobCategoriesAsync(_tenantContext.TenantId.Value);

        return Ok(new
        {
            data = categories.Select(c => new { category = c.Category, count = c.Count })
        });
    }

    /// <summary>
    /// Get a single job by ID.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var job = await _jobService.GetJobAsync(_tenantContext.TenantId.Value, id);

        if (job == null)
            return NotFound(new { error = "Job not found" });

        return Ok(MapJobResponse(job));
    }

    /// <summary>
    /// Create a new job vacancy.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateJobRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null)
            return Unauthorized(new { error = "Invalid token" });

        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var (job, error) = await _jobService.CreateJobAsync(
            _tenantContext.TenantId.Value, userId.Value,
            request.Title, request.Description, request.Category,
            request.JobType, request.Location, request.IsRemote,
            request.TimeCreditsPerHour, request.RequiredSkills,
            request.ContactEmail, request.Status, request.ExpiresAt);

        if (error != null)
            return BadRequest(new { error });

        return CreatedAtAction(nameof(GetById), new { id = job!.Id }, MapJobResponse(job));
    }

    /// <summary>
    /// Update an existing job (owner only).
    /// </summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateJobRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null)
            return Unauthorized(new { error = "Invalid token" });

        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var isAdmin = User.IsAdmin();

        var (job, error) = await _jobService.UpdateJobAsync(
            _tenantContext.TenantId.Value, userId.Value, id, isAdmin,
            request.Title, request.Description, request.Category,
            request.JobType, request.Location, request.IsRemote,
            request.TimeCreditsPerHour, request.RequiredSkills,
            request.ContactEmail, request.Status, request.ExpiresAt);

        if (error == "Job not found")
            return NotFound(new { error });

        if (error == "You can only update your own job postings")
            return StatusCode(403, new { error });

        if (error != null)
            return BadRequest(new { error });

        return Ok(MapJobResponse(job!));
    }

    /// <summary>
    /// Delete a job (owner only).
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var userId = User.GetUserId();
        if (userId == null)
            return Unauthorized(new { error = "Invalid token" });

        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var isAdmin = User.IsAdmin();

        var error = await _jobService.DeleteJobAsync(
            _tenantContext.TenantId.Value, userId.Value, id, isAdmin);

        if (error == "Job not found")
            return NotFound(new { error });

        if (error == "You can only delete your own job postings")
            return StatusCode(403, new { error });

        if (error != null)
            return BadRequest(new { error });

        return NoContent();
    }

    /// <summary>
    /// Apply for a job.
    /// </summary>
    [HttpPost("{id:int}/apply")]
    public async Task<IActionResult> Apply(int id, [FromBody] ApplyJobRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null)
            return Unauthorized(new { error = "Invalid token" });

        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var (application, error) = await _jobService.ApplyAsync(
            _tenantContext.TenantId.Value, userId.Value, id, request.CoverLetter);

        if (error == "Job not found")
            return NotFound(new { error });

        if (error != null)
            return BadRequest(new { error });

        return CreatedAtAction(nameof(GetMyApplications), null, MapApplicationResponse(application!));
    }

    /// <summary>
    /// List current user's job applications.
    /// </summary>
    [HttpGet("my-applications")]
    public async Task<IActionResult> GetMyApplications()
    {
        var userId = User.GetUserId();
        if (userId == null)
            return Unauthorized(new { error = "Invalid token" });

        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var applications = await _jobService.GetMyApplicationsAsync(
            _tenantContext.TenantId.Value, userId.Value);

        return Ok(new
        {
            data = applications.Select(a => MapApplicationResponse(a))
        });
    }

    /// <summary>
    /// List applications for a job (poster only).
    /// </summary>
    [HttpGet("{id:int}/applications")]
    public async Task<IActionResult> GetJobApplications(int id)
    {
        var userId = User.GetUserId();
        if (userId == null)
            return Unauthorized(new { error = "Invalid token" });

        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var (applications, error) = await _jobService.GetJobApplicationsAsync(
            _tenantContext.TenantId.Value, userId.Value, id);

        if (error == "Job not found")
            return NotFound(new { error });

        if (error != null)
            return StatusCode(403, new { error });

        return Ok(new
        {
            data = applications!.Select(a => MapApplicationResponse(a))
        });
    }

    /// <summary>
    /// Review an application (poster only).
    /// </summary>
    [HttpPut("{id:int}/applications/{appId:int}")]
    public async Task<IActionResult> ReviewApplication(int id, int appId, [FromBody] ReviewJobApplicationRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null)
            return Unauthorized(new { error = "Invalid token" });

        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        if (string.IsNullOrWhiteSpace(request.Status))
            return BadRequest(new { error = "Status is required" });

        var (application, error) = await _jobService.UpdateApplicationStatusAsync(
            _tenantContext.TenantId.Value, userId.Value, id, appId, request.Status, request.Notes);

        if (error == "Job not found" || error == "Application not found")
            return NotFound(new { error });

        if (error == "Only the job poster can review applications")
            return StatusCode(403, new { error });

        if (error != null)
            return BadRequest(new { error });

        return Ok(MapApplicationResponse(application!));
    }

    /// <summary>
    /// Save/bookmark a job.
    /// </summary>
    [HttpPost("{id:int}/save")]
    public async Task<IActionResult> SaveJob(int id)
    {
        var userId = User.GetUserId();
        if (userId == null)
            return Unauthorized(new { error = "Invalid token" });

        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var (saved, error) = await _jobService.SaveJobAsync(
            _tenantContext.TenantId.Value, userId.Value, id);

        if (error == "Job not found")
            return NotFound(new { error });

        if (error != null)
            return BadRequest(new { error });

        return Ok(new { message = "Job saved", job_id = id });
    }

    /// <summary>
    /// Remove a saved/bookmarked job.
    /// </summary>
    [HttpDelete("{id:int}/save")]
    public async Task<IActionResult> UnsaveJob(int id)
    {
        var userId = User.GetUserId();
        if (userId == null)
            return Unauthorized(new { error = "Invalid token" });

        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var error = await _jobService.UnsaveJobAsync(
            _tenantContext.TenantId.Value, userId.Value, id);

        if (error != null)
            return NotFound(new { error });

        return NoContent();
    }

    /// <summary>
    /// List user's saved jobs.
    /// </summary>
    [HttpGet("saved")]
    public async Task<IActionResult> GetSavedJobs()
    {
        var userId = User.GetUserId();
        if (userId == null)
            return Unauthorized(new { error = "Invalid token" });

        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var savedJobs = await _jobService.GetSavedJobsAsync(
            _tenantContext.TenantId.Value, userId.Value);

        return Ok(new
        {
            data = savedJobs.Select(s => new
            {
                id = s.Id,
                job = s.Job != null ? MapJobResponse(s.Job) : null,
                saved_at = s.CreatedAt
            })
        });
    }

    /// <summary>
    /// Renew a job posting. Admin can renew any job; owners renew their own.
    /// Optional body: { days: int } (default 30, max 365).
    /// </summary>
    [HttpPost("{id:int}/renew")]
    public async Task<IActionResult> RenewJob(int id, [FromBody] RenewJobRequest? request)
    {
        var userId = User.GetUserId();
        if (userId == null)
            return Unauthorized(new { error = "Invalid token" });

        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var days = request?.Days is > 0 ? request.Days : 30;
        var isAdmin = User.IsAdmin();

        Entities.JobVacancy? job;
        string? error;

        if (isAdmin)
            (job, error) = await _jobService.AdminRenewJobAsync(_tenantContext.TenantId.Value, id, days);
        else
            (job, error) = await _jobService.RenewJobAsync(_tenantContext.TenantId.Value, userId.Value, id, days);

        if (error == "Job not found")
            return NotFound(new { error });

        if (error != null)
            return StatusCode(403, new { error });

        return Ok(new { message = "Job renewed", new_expiry = job!.ExpiresAt });
    }


    // ---- NEW ENDPOINTS (Task 1 additions) ----

    [HttpGet("{id:int}/match")]
    public async Task<IActionResult> GetJobMatchScore(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });

        var (score, matched, missing) = await _jobService.GetJobMatchScoreAsync(_tenantContext.TenantId.Value, userId.Value, id);
        return Ok(new { job_id = id, score, qualified = score >= 70m, skills_matched = matched, skills_missing = missing });
    }

    [HttpGet("{id:int}/qualified")]
    public async Task<IActionResult> GetQualification(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });

        var (qualified, score, reason, matched, missing) = await _jobService.IsUserQualifiedAsync(_tenantContext.TenantId.Value, userId.Value, id);
        return Ok(new { qualified, score, reason, skills_matched = matched, skills_missing = missing });
    }

    [HttpPost("{id:int}/feature")]
    public async Task<IActionResult> FeatureJob(int id, [FromBody] FeatureJobRequest request)
    {
        if (!User.IsAdmin())
            return StatusCode(403, new { error = "Admin only" });
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });

        var days = request.Days > 0 ? request.Days : 30;
        var (job, featuredUntil, error) = await _jobService.FeatureJobForDaysAsync(_tenantContext.TenantId.Value, id, days);
        if (error == "Job not found") return NotFound(new { error });
        if (error != null) return BadRequest(new { error });
        return Ok(new { message = "Job featured", featured_until = featuredUntil });
    }

    [HttpDelete("{id:int}/feature")]
    public async Task<IActionResult> UnfeatureJob(int id)
    {
        if (!User.IsAdmin())
            return StatusCode(403, new { error = "Admin only" });
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });

        var (success, error) = await _jobService.UnfeatureJobAsync(_tenantContext.TenantId.Value, id);
        if (error == "Job not found") return NotFound(new { error });
        if (error != null) return BadRequest(new { error });
        return Ok(new { message = "Job unfeatured" });
    }

    [HttpGet("alerts")]
    public async Task<IActionResult> GetAlerts()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });

        var alerts = await _jobService.ListJobAlertsAsync(_tenantContext.TenantId.Value, userId.Value);
        return Ok(new { data = alerts.Select(a => new { id = a.Id, name = a.Name, query = a.QueryJson, notify = a.NotifyOnNewResults, created_at = a.CreatedAt }) });
    }

    [HttpPost("alerts")]
    public async Task<IActionResult> CreateAlert([FromBody] CreateJobAlertRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });

        var (alert, error) = await _jobService.CreateJobAlertAsync(_tenantContext.TenantId.Value, userId.Value, request.Keywords, request.Category, request.JobType);
        if (error != null) return BadRequest(new { error });
        return CreatedAtAction(nameof(GetAlerts), null, new { id = alert!.Id, name = alert.Name, created_at = alert.CreatedAt });
    }

    [HttpDelete("alerts/{alertId:int}")]
    public async Task<IActionResult> DeleteAlert(int alertId)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        if (!_tenantContext.TenantId.HasValue) return BadRequest(new { error = "Tenant context not resolved" });

        var (success, error) = await _jobService.DeleteJobAlertAsync(_tenantContext.TenantId.Value, userId.Value, alertId);
        if (error == "Job alert not found") return NotFound(new { error });
        if (error != null) return BadRequest(new { error });
        return NoContent();
    }

    private static object MapJobResponse(Entities.JobVacancy job)
    {
        return new
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
            expires_at = job.ExpiresAt,
            filled_at = job.FilledAt,
            view_count = job.ViewCount,
            application_count = job.ApplicationCount,
            created_at = job.CreatedAt,
            updated_at = job.UpdatedAt,
            posted_by = job.PostedBy != null
                ? new
                {
                    id = job.PostedBy.Id,
                    first_name = job.PostedBy.FirstName,
                    last_name = job.PostedBy.LastName
                }
                : null
        };
    }

    private static object MapApplicationResponse(Entities.JobApplication app)
    {
        return new
        {
            id = app.Id,
            job_id = app.JobId,
            cover_letter = app.CoverLetter,
            status = app.Status,
            reviewed_at = app.ReviewedAt,
            review_notes = app.ReviewNotes,
            created_at = app.CreatedAt,
            updated_at = app.UpdatedAt,
            applicant = app.Applicant != null
                ? new
                {
                    id = app.Applicant.Id,
                    first_name = app.Applicant.FirstName,
                    last_name = app.Applicant.LastName
                }
                : null,
            job = app.Job != null
                ? new
                {
                    id = app.Job.Id,
                    title = app.Job.Title,
                    status = app.Job.Status
                }
                : null
        };
    }
}

// DTOs

public class CreateJobRequest
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("category")]
    public string Category { get; set; } = string.Empty;

    [JsonPropertyName("job_type")]
    public string JobType { get; set; } = "full-time";

    [JsonPropertyName("location")]
    public string? Location { get; set; }

    [JsonPropertyName("is_remote")]
    public bool IsRemote { get; set; }

    [JsonPropertyName("time_credits_per_hour")]
    public decimal? TimeCreditsPerHour { get; set; }

    [JsonPropertyName("required_skills")]
    public string? RequiredSkills { get; set; }

    [JsonPropertyName("contact_email")]
    public string? ContactEmail { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("expires_at")]
    public DateTime? ExpiresAt { get; set; }
}

public class UpdateJobRequest
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("category")]
    public string? Category { get; set; }

    [JsonPropertyName("job_type")]
    public string? JobType { get; set; }

    [JsonPropertyName("location")]
    public string? Location { get; set; }

    [JsonPropertyName("is_remote")]
    public bool? IsRemote { get; set; }

    [JsonPropertyName("time_credits_per_hour")]
    public decimal? TimeCreditsPerHour { get; set; }

    [JsonPropertyName("required_skills")]
    public string? RequiredSkills { get; set; }

    [JsonPropertyName("contact_email")]
    public string? ContactEmail { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("expires_at")]
    public DateTime? ExpiresAt { get; set; }
}

public class ApplyJobRequest
{
    [JsonPropertyName("cover_letter")]
    public string? CoverLetter { get; set; }
}

public class ReviewJobApplicationRequest
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("notes")]
    public string? Notes { get; set; }
}

public class FeatureJobRequest
{
    [JsonPropertyName("days")]
    public int Days { get; set; } = 30;
}

public class CreateJobAlertRequest
{
    [JsonPropertyName("keywords")]
    public string Keywords { get; set; } = string.Empty;

    [JsonPropertyName("category")]
    public string? Category { get; set; }

    [JsonPropertyName("job_type")]
    public string? JobType { get; set; }
}

public class RenewJobRequest
{
    [JsonPropertyName("days")]
    public int Days { get; set; } = 30;
}
