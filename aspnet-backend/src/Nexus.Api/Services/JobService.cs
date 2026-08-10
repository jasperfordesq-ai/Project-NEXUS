// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing job vacancies, applications, and saved jobs.
/// All operations are tenant-scoped via global query filters.
/// </summary>
public class JobService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<JobService> _logger;

    private static readonly HashSet<string> ValidJobTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "full-time", "part-time", "volunteer", "contract", "one-off"
    };

    private static readonly HashSet<string> ValidStatuses = new(StringComparer.OrdinalIgnoreCase)
    {
        "draft", "active", "filled", "expired", "cancelled"
    };

    private static readonly HashSet<string> ValidApplicationStatuses = new(StringComparer.OrdinalIgnoreCase)
    {
        "pending", "reviewed", "accepted", "rejected", "withdrawn"
    };

    public JobService(NexusDbContext db, ILogger<JobService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// List jobs with pagination and optional filters.
    /// By default returns only active jobs, ordered by featured first then newest.
    /// </summary>
    public async Task<(List<JobVacancy> Jobs, int Total)> ListJobsAsync(
        int tenantId, string? search, string? category, string? jobType, string? status, int page, int limit)
    {
        var query = _db.JobVacancies.AsQueryable();

        // Default to active status if not specified
        var filterStatus = string.IsNullOrEmpty(status) ? "active" : status;
        query = query.Where(j => j.Status == filterStatus);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(j =>
                j.Title.ToLower().Contains(term) ||
                (j.Description != null && j.Description.ToLower().Contains(term)) ||
                (j.RequiredSkills != null && j.RequiredSkills.ToLower().Contains(term)));
        }

        if (!string.IsNullOrWhiteSpace(category))
        {
            query = query.Where(j => j.Category == category.Trim());
        }

        if (!string.IsNullOrWhiteSpace(jobType))
        {
            query = query.Where(j => j.JobType == jobType.Trim().ToLower());
        }

        var total = await query.CountAsync();

        var jobs = await query
            .AsNoTracking()
            .Include(j => j.PostedBy)
            .OrderByDescending(j => j.IsFeatured)
            .ThenByDescending(j => j.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return (jobs, total);
    }

    /// <summary>
    /// Get a single job by ID and increment the view count.
    /// </summary>
    public async Task<JobVacancy?> GetJobAsync(int tenantId, int jobId)
    {
        var job = await _db.JobVacancies
            .Include(j => j.PostedBy)
            .FirstOrDefaultAsync(j => j.Id == jobId);

        if (job != null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE \"job_vacancies\" SET \"ViewCount\" = \"ViewCount\" + 1 WHERE \"Id\" = {job.Id}");
        }

        return job;
    }

    /// <summary>
    /// Create a new job vacancy.
    /// </summary>
    public async Task<(JobVacancy? Job, string? Error)> CreateJobAsync(
        int tenantId, int userId, string title, string? description, string category,
        string jobType, string? location, bool isRemote, decimal? timeCreditsPerHour,
        string? requiredSkills, string? contactEmail, string? status, DateTime? expiresAt)
    {
        if (string.IsNullOrWhiteSpace(title))
            return (null, "Title is required");

        if (title.Length > 255)
            return (null, "Title must be 255 characters or less");

        if (string.IsNullOrWhiteSpace(category))
            return (null, "Category is required");

        var normalizedJobType = jobType?.Trim().ToLower() ?? "full-time";
        if (!ValidJobTypes.Contains(normalizedJobType))
            return (null, $"Job type must be one of: {string.Join(", ", ValidJobTypes)}");

        var normalizedStatus = status?.Trim().ToLower() ?? "draft";
        if (normalizedStatus != "draft" && normalizedStatus != "active")
            return (null, "Status must be 'draft' or 'active' when creating");

        if (expiresAt.HasValue && expiresAt.Value <= DateTime.UtcNow)
            return (null, "Expiration date must be in the future");

        var job = new JobVacancy
        {
            TenantId = tenantId,
            PostedByUserId = userId,
            Title = title.Trim(),
            Description = description?.Trim(),
            Category = category.Trim(),
            JobType = normalizedJobType,
            Location = location?.Trim(),
            IsRemote = isRemote,
            TimeCreditsPerHour = timeCreditsPerHour,
            RequiredSkills = requiredSkills?.Trim(),
            ContactEmail = contactEmail?.Trim(),
            Status = normalizedStatus,
            ExpiresAt = expiresAt,
            CreatedAt = DateTime.UtcNow
        };

        _db.JobVacancies.Add(job);
        await _db.SaveChangesAsync();

        // Reload with navigation
        await _db.Entry(job).Reference(j => j.PostedBy).LoadAsync();

        _logger.LogInformation("Created job {JobId} by user {UserId} in tenant {TenantId}",
            job.Id, userId, tenantId);

        return (job, null);
    }

    /// <summary>
    /// Update an existing job vacancy. Only the owner or admin can update.
    /// </summary>
    public async Task<(JobVacancy? Job, string? Error)> UpdateJobAsync(
        int tenantId, int userId, int jobId, bool isAdmin,
        string? title, string? description, string? category, string? jobType,
        string? location, bool? isRemote, decimal? timeCreditsPerHour,
        string? requiredSkills, string? contactEmail, string? status, DateTime? expiresAt)
    {
        var job = await _db.JobVacancies
            .Include(j => j.PostedBy)
            .FirstOrDefaultAsync(j => j.Id == jobId);

        if (job == null)
            return (null, "Job not found");

        if (job.PostedByUserId != userId && !isAdmin)
            return (null, "You can only update your own job postings");

        if (title != null)
        {
            if (string.IsNullOrWhiteSpace(title))
                return (null, "Title cannot be empty");
            if (title.Length > 255)
                return (null, "Title must be 255 characters or less");
            job.Title = title.Trim();
        }

        if (description != null)
            job.Description = description.Trim();

        if (category != null)
        {
            if (string.IsNullOrWhiteSpace(category))
                return (null, "Category cannot be empty");
            job.Category = category.Trim();
        }

        if (jobType != null)
        {
            var normalizedJobType = jobType.Trim().ToLower();
            if (!ValidJobTypes.Contains(normalizedJobType))
                return (null, $"Job type must be one of: {string.Join(", ", ValidJobTypes)}");
            job.JobType = normalizedJobType;
        }

        if (location != null)
            job.Location = location.Trim();

        if (isRemote.HasValue)
            job.IsRemote = isRemote.Value;

        if (timeCreditsPerHour.HasValue)
            job.TimeCreditsPerHour = timeCreditsPerHour.Value;

        if (requiredSkills != null)
            job.RequiredSkills = requiredSkills.Trim();

        if (contactEmail != null)
            job.ContactEmail = contactEmail.Trim();

        if (status != null)
        {
            var normalizedStatus = status.Trim().ToLower();
            if (!ValidStatuses.Contains(normalizedStatus))
                return (null, $"Status must be one of: {string.Join(", ", ValidStatuses)}");
            job.Status = normalizedStatus;

            if (normalizedStatus == "filled")
                job.FilledAt = DateTime.UtcNow;
        }

        if (expiresAt.HasValue)
        {
            if (expiresAt.Value <= DateTime.UtcNow)
                return (null, "Expiration date must be in the future");
            job.ExpiresAt = expiresAt.Value;
        }

        job.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Updated job {JobId} by user {UserId}", jobId, userId);

        return (job, null);
    }

    /// <summary>
    /// Delete a job vacancy. Only the owner or admin can delete.
    /// </summary>
    public async Task<string?> DeleteJobAsync(int tenantId, int userId, int jobId, bool isAdmin)
    {
        var job = await _db.JobVacancies.FirstOrDefaultAsync(j => j.Id == jobId);

        if (job == null)
            return "Job not found";

        if (job.PostedByUserId != userId && !isAdmin)
            return "You can only delete your own job postings";

        _db.JobVacancies.Remove(job);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Deleted job {JobId} by user {UserId}", jobId, userId);

        return null;
    }

    /// <summary>
    /// Apply for a job. Cannot apply to own jobs or apply twice.
    /// </summary>
    public async Task<(JobApplication? Application, string? Error)> ApplyAsync(
        int tenantId, int userId, int jobId, string? coverLetter)
    {
        var job = await _db.JobVacancies.FirstOrDefaultAsync(j => j.Id == jobId);

        if (job == null)
            return (null, "Job not found");

        if (job.Status != "active")
            return (null, "Can only apply to active jobs");

        if (job.PostedByUserId == userId)
            return (null, "You cannot apply to your own job posting");

        var existingApplication = await _db.JobApplications
            .AnyAsync(a => a.JobId == jobId && a.ApplicantUserId == userId);

        if (existingApplication)
            return (null, "You have already applied for this job");

        var application = new JobApplication
        {
            TenantId = tenantId,
            JobId = jobId,
            ApplicantUserId = userId,
            CoverLetter = coverLetter?.Trim(),
            Status = "pending",
            CreatedAt = DateTime.UtcNow
        };

        _db.JobApplications.Add(application);

        // Increment application count
        job.ApplicationCount++;

        await _db.SaveChangesAsync();

        // Load navigation
        await _db.Entry(application).Reference(a => a.Applicant).LoadAsync();
        await _db.Entry(application).Reference(a => a.Job).LoadAsync();

        _logger.LogInformation("User {UserId} applied to job {JobId} in tenant {TenantId}",
            userId, jobId, tenantId);

        return (application, null);
    }

    /// <summary>
    /// Get current user's job applications.
    /// </summary>
    public async Task<List<JobApplication>> GetMyApplicationsAsync(int tenantId, int userId)
    {
        return await _db.JobApplications
            .AsNoTracking()
            .Include(a => a.Job)
                .ThenInclude(j => j!.PostedBy)
            .Where(a => a.ApplicantUserId == userId)
            .OrderByDescending(a => a.CreatedAt)
            .ToListAsync();
    }

    /// <summary>
    /// Get applications for a specific job. Only the job poster can view.
    /// </summary>
    public async Task<(List<JobApplication>? Applications, string? Error)> GetJobApplicationsAsync(
        int tenantId, int userId, int jobId)
    {
        var job = await _db.JobVacancies.FirstOrDefaultAsync(j => j.Id == jobId);

        if (job == null)
            return (null, "Job not found");

        if (job.PostedByUserId != userId)
            return (null, "Only the job poster can view applications");

        var applications = await _db.JobApplications
            .AsNoTracking()
            .Include(a => a.Applicant)
            .Where(a => a.JobId == jobId)
            .OrderByDescending(a => a.CreatedAt)
            .ToListAsync();

        return (applications, null);
    }

    /// <summary>
    /// Update application status (accept/reject). Only the job poster can do this.
    /// </summary>
    public async Task<(JobApplication? Application, string? Error)> UpdateApplicationStatusAsync(
        int tenantId, int userId, int jobId, int applicationId, string status, string? notes)
    {
        var job = await _db.JobVacancies.FirstOrDefaultAsync(j => j.Id == jobId);

        if (job == null)
            return (null, "Job not found");

        if (job.PostedByUserId != userId)
            return (null, "Only the job poster can review applications");

        var application = await _db.JobApplications
            .Include(a => a.Applicant)
            .FirstOrDefaultAsync(a => a.Id == applicationId && a.JobId == jobId);

        if (application == null)
            return (null, "Application not found");

        var normalizedStatus = status.Trim().ToLower();
        if (!ValidApplicationStatuses.Contains(normalizedStatus))
            return (null, $"Status must be one of: {string.Join(", ", ValidApplicationStatuses)}");

        application.Status = normalizedStatus;
        application.ReviewedAt = DateTime.UtcNow;
        application.ReviewedByUserId = userId;
        application.ReviewNotes = notes?.Trim();
        application.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Updated application {ApplicationId} to {Status} for job {JobId}",
            applicationId, normalizedStatus, jobId);

        return (application, null);
    }

    /// <summary>
    /// Save/bookmark a job.
    /// </summary>
    public async Task<(SavedJob? Saved, string? Error)> SaveJobAsync(int tenantId, int userId, int jobId)
    {
        var jobExists = await _db.JobVacancies.AnyAsync(j => j.Id == jobId);
        if (!jobExists)
            return (null, "Job not found");

        var alreadySaved = await _db.SavedJobs
            .AnyAsync(s => s.UserId == userId && s.JobId == jobId);

        if (alreadySaved)
            return (null, "Job already saved");

        var saved = new SavedJob
        {
            TenantId = tenantId,
            UserId = userId,
            JobId = jobId,
            CreatedAt = DateTime.UtcNow
        };

        _db.SavedJobs.Add(saved);
        await _db.SaveChangesAsync();

        return (saved, null);
    }

    /// <summary>
    /// Remove a saved/bookmarked job.
    /// </summary>
    public async Task<string?> UnsaveJobAsync(int tenantId, int userId, int jobId)
    {
        var saved = await _db.SavedJobs
            .FirstOrDefaultAsync(s => s.UserId == userId && s.JobId == jobId);

        if (saved == null)
            return "Saved job not found";

        _db.SavedJobs.Remove(saved);
        await _db.SaveChangesAsync();

        return null;
    }

    /// <summary>
    /// Get user's saved/bookmarked jobs.
    /// </summary>
    public async Task<List<SavedJob>> GetSavedJobsAsync(int tenantId, int userId)
    {
        return await _db.SavedJobs
            .AsNoTracking()
            .Include(s => s.Job)
                .ThenInclude(j => j!.PostedBy)
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();
    }

    /// <summary>
    /// Renew a job posting by extending expiry by 30 days.
    /// </summary>
    public async Task<(JobVacancy? Job, string? Error)> RenewJobAsync(int tenantId, int userId, int jobId)
    {
        var job = await _db.JobVacancies
            .Include(j => j.PostedBy)
            .FirstOrDefaultAsync(j => j.Id == jobId);

        if (job == null)
            return (null, "Job not found");

        if (job.PostedByUserId != userId)
            return (null, "You can only renew your own job postings");

        var baseDate = job.ExpiresAt ?? DateTime.UtcNow;
        if (baseDate < DateTime.UtcNow)
            baseDate = DateTime.UtcNow;

        job.ExpiresAt = baseDate.AddDays(30);
        job.Status = "active";
        job.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Renewed job {JobId} by user {UserId}, new expiry: {ExpiresAt}",
            jobId, userId, job.ExpiresAt);

        return (job, null);
    }

    /// <summary>
    /// Toggle featured flag on a job (admin only).
    /// </summary>
    public async Task<(JobVacancy? Job, string? Error)> FeatureJobAsync(int tenantId, int jobId, bool featured)
    {
        var job = await _db.JobVacancies
            .Include(j => j.PostedBy)
            .FirstOrDefaultAsync(j => j.Id == jobId);

        if (job == null)
            return (null, "Job not found");

        job.IsFeatured = featured;
        job.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Set job {JobId} featured={Featured}", jobId, featured);

        return (job, null);
    }


    // ---- NEW SERVICE METHODS (Task 1 additions) ----

    public async Task<(JobVacancy? Job, string? Error)> RenewJobAsync(int tenantId, int userId, int jobId, int daysToExtend)
    {
        var job = await _db.JobVacancies.Include(j => j.PostedBy).FirstOrDefaultAsync(j => j.Id == jobId);
        if (job == null) return (null, "Job not found");
        if (daysToExtend < 1 || daysToExtend > 365) return (null, "Days to extend must be between 1 and 365");
        if (job.PostedByUserId != userId) return (null, "You can only renew your own job postings");
        var baseDate = job.ExpiresAt ?? DateTime.UtcNow;
        if (baseDate < DateTime.UtcNow) baseDate = DateTime.UtcNow;
        job.ExpiresAt = baseDate.AddDays(daysToExtend);
        job.Status = "active";
        job.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        _logger.LogInformation("Renewed job {JobId} by user {UserId} by {Days} days", jobId, userId, daysToExtend);
        return (job, null);
    }

    public async Task<(JobVacancy? Job, string? Error)> AdminRenewJobAsync(int tenantId, int jobId, int daysToExtend)
    {
        var job = await _db.JobVacancies.Include(j => j.PostedBy).FirstOrDefaultAsync(j => j.Id == jobId);
        if (job == null) return (null, "Job not found");
        if (daysToExtend < 1 || daysToExtend > 365) return (null, "Days to extend must be between 1 and 365");
        var baseDate = job.ExpiresAt ?? DateTime.UtcNow;
        if (baseDate < DateTime.UtcNow) baseDate = DateTime.UtcNow;
        job.ExpiresAt = baseDate.AddDays(daysToExtend);
        job.Status = "active";
        job.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        _logger.LogInformation("Admin renewed job {JobId} by {Days} days", jobId, daysToExtend);
        return (job, null);
    }

    public async Task<(JobVacancy? Job, DateTime FeaturedUntil, string? Error)> FeatureJobForDaysAsync(int tenantId, int jobId, int daysToFeature)
    {
        if (daysToFeature < 1 || daysToFeature > 365) return (null, default, "Days to feature must be between 1 and 365");
        var job = await _db.JobVacancies.Include(j => j.PostedBy).FirstOrDefaultAsync(j => j.Id == jobId);
        if (job == null) return (null, default, "Job not found");
        var featuredUntil = DateTime.UtcNow.AddDays(daysToFeature);
        job.IsFeatured = true;
        job.FeaturedUntil = featuredUntil;
        job.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        _logger.LogInformation("Featured job {JobId} for {Days} days", jobId, daysToFeature);
        return (job, featuredUntil, null);
    }

    public async Task<(bool Success, string? Error)> UnfeatureJobAsync(int tenantId, int jobId)
    {
        var job = await _db.JobVacancies.FirstOrDefaultAsync(j => j.Id == jobId);
        if (job == null) return (false, "Job not found");
        job.IsFeatured = false;
        job.FeaturedUntil = null;
        job.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (true, null);
    }

    public async Task<(decimal Score, List<string> SkillsMatched, List<string> SkillsMissing)> GetJobMatchScoreAsync(int tenantId, int userId, int jobId)
    {
        var job = await _db.JobVacancies.AsNoTracking().FirstOrDefaultAsync(j => j.Id == jobId);
        if (job == null) return (0m, new List<string>(), new List<string>());

        var requiredSkills = (job.RequiredSkills ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => s.ToLowerInvariant()).ToList();

        if (requiredSkills.Count == 0) return (85m, new List<string>(), new List<string>());

        var userSkillNames = await _db.UserSkills.AsNoTracking()
            .Where(us => us.UserId == userId)
            .Include(us => us.Skill)
            .Select(us => us.Skill != null ? us.Skill.Name.ToLower() : string.Empty)
            .Where(name => name != string.Empty)
            .ToListAsync();

        var matched = requiredSkills.Where(r => userSkillNames.Any(u => u.Contains(r) || r.Contains(u))).ToList();
        var missing = requiredSkills.Except(matched).ToList();
        var score = Math.Round((decimal)matched.Count / requiredSkills.Count * 100m, 1);
        return (Math.Max(0m, Math.Min(100m, score)), matched, missing);
    }

    public async Task<(bool Qualified, decimal Score, string Reason, List<string> SkillsMatched, List<string> SkillsMissing)> IsUserQualifiedAsync(int tenantId, int userId, int jobId)
    {
        var (score, matched, missing) = await GetJobMatchScoreAsync(tenantId, userId, jobId);
        var qualified = score >= 70m;
        var reason = qualified
            ? string.Format("You match {0}% of required skills.", score)
            : string.Format("You match {0}% of required skills. A minimum of 70% is required.", score);
        return (qualified, score, reason, matched, missing);
    }

    public async Task<(SavedSearch? Alert, string? Error)> CreateJobAlertAsync(int tenantId, int userId, string keywords, string? category, string? jobType)
    {
        if (string.IsNullOrWhiteSpace(keywords)) return (null, "Keywords are required");
        var queryJson = System.Text.Json.JsonSerializer.Serialize(new
        {
            keywords = keywords.Trim(),
            category = category != null ? category.Trim() : (string?)null,
            job_type = jobType != null ? jobType.Trim() : (string?)null
        });
        var alert = new SavedSearch
        {
            TenantId = tenantId, UserId = userId,
            Name = string.Concat("Job alert: ", keywords.Trim()),
            SearchType = "job_alert",
            QueryJson = queryJson,
            NotifyOnNewResults = true,
            CreatedAt = DateTime.UtcNow
        };
        _db.SavedSearches.Add(alert);
        await _db.SaveChangesAsync();
        _logger.LogInformation("Created job alert {AlertId} for user {UserId}", alert.Id, userId);
        return (alert, null);
    }

    public async Task<(bool Success, string? Error)> DeleteJobAlertAsync(int tenantId, int userId, int alertId)
    {
        var alert = await _db.SavedSearches.FirstOrDefaultAsync(s => s.Id == alertId && s.UserId == userId && s.SearchType == "job_alert");
        if (alert == null) return (false, "Job alert not found");
        _db.SavedSearches.Remove(alert);
        await _db.SaveChangesAsync();
        return (true, null);
    }

    public async Task<List<SavedSearch>> ListJobAlertsAsync(int tenantId, int userId)
    {
        return await _db.SavedSearches.AsNoTracking()
            .Where(s => s.UserId == userId && s.SearchType == "job_alert")
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();
    }

    /// <summary>
    /// Get distinct job categories with counts of active jobs.
    /// </summary>
    public async Task<List<(string Category, int Count)>> GetJobCategoriesAsync(int tenantId)
    {
        var categories = await _db.JobVacancies
            .AsNoTracking()
            .Where(j => j.Status == "active")
            .GroupBy(j => j.Category)
            .Select(g => new { Category = g.Key, Count = g.Count() })
            .OrderByDescending(c => c.Count)
            .ToListAsync();

        return categories.Select(c => (c.Category, c.Count)).ToList();
    }

    /// <summary>
    /// List all jobs for admin moderation (any status).
    /// </summary>
    public async Task<(List<JobVacancy> Jobs, int Total)> ListAllJobsAsync(
        int tenantId, string? status, int page, int limit)
    {
        var query = _db.JobVacancies.AsQueryable();

        if (!string.IsNullOrWhiteSpace(status))
            query = query.Where(j => j.Status == status.Trim().ToLower());

        var total = await query.CountAsync();

        var jobs = await query
            .AsNoTracking()
            .Include(j => j.PostedBy)
            .OrderByDescending(j => j.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return (jobs, total);
    }

    /// <summary>
    /// Admin: change job status.
    /// </summary>
    public async Task<(JobVacancy? Job, string? Error)> AdminUpdateStatusAsync(
        int tenantId, int jobId, string status)
    {
        var normalizedStatus = status.Trim().ToLower();
        if (!ValidStatuses.Contains(normalizedStatus))
            return (null, $"Status must be one of: {string.Join(", ", ValidStatuses)}");

        var job = await _db.JobVacancies
            .Include(j => j.PostedBy)
            .FirstOrDefaultAsync(j => j.Id == jobId);

        if (job == null)
            return (null, "Job not found");

        job.Status = normalizedStatus;
        if (normalizedStatus == "filled")
            job.FilledAt = DateTime.UtcNow;
        job.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin updated job {JobId} status to {Status}", jobId, normalizedStatus);

        return (job, null);
    }

    /// <summary>
    /// Get job module statistics for admin dashboard.
    /// </summary>
    public async Task<object> GetJobStatsAsync(int tenantId)
    {
        var totalJobs = await _db.JobVacancies.CountAsync();
        var activeJobs = await _db.JobVacancies.CountAsync(j => j.Status == "active");
        var filledJobs = await _db.JobVacancies.CountAsync(j => j.Status == "filled");
        var expiredJobs = await _db.JobVacancies.CountAsync(j => j.Status == "expired");
        var totalApplications = await _db.JobApplications.CountAsync();
        var pendingApplications = await _db.JobApplications.CountAsync(a => a.Status == "pending");
        var acceptedApplications = await _db.JobApplications.CountAsync(a => a.Status == "accepted");
        var featuredJobs = await _db.JobVacancies.CountAsync(j => j.IsFeatured);

        var topCategories = await _db.JobVacancies
            .AsNoTracking()
            .Where(j => j.Status == "active")
            .GroupBy(j => j.Category)
            .Select(g => new { category = g.Key, count = g.Count() })
            .OrderByDescending(c => c.count)
            .Take(10)
            .ToListAsync();

        return new
        {
            total_jobs = totalJobs,
            active_jobs = activeJobs,
            filled_jobs = filledJobs,
            expired_jobs = expiredJobs,
            featured_jobs = featuredJobs,
            total_applications = totalApplications,
            pending_applications = pendingApplications,
            accepted_applications = acceptedApplications,
            top_categories = topCategories
        };
    }
}
