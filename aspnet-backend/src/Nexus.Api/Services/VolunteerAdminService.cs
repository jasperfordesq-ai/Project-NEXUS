// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Volunteer admin extras — training courses, completions, guardian consents,
/// per-tenant policy. Pairs with <see cref="VolunteerLongTailService"/>.
///
/// Tenant scoping is enforced via global query filters on each entity.
/// </summary>
public class VolunteerAdminService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;
    private readonly ILogger<VolunteerAdminService> _logger;

    public VolunteerAdminService(NexusDbContext db, TenantContext tenant, ILogger<VolunteerAdminService> logger)
    {
        _db = db;
        _tenant = tenant;
        _logger = logger;
    }

    // ─── Training courses ──────────────────────────────────────────────────

    public Task<List<VolunteerTrainingCourse>> ListCoursesAsync(bool? activeOnly = null)
    {
        var q = _db.VolunteerTrainingCourses.AsNoTracking().AsQueryable();
        if (activeOnly == true) q = q.Where(c => c.Active);
        return q.OrderByDescending(c => c.CreatedAt).ToListAsync();
    }

    public Task<VolunteerTrainingCourse?> GetCourseAsync(int id)
        => _db.VolunteerTrainingCourses.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id);

    public async Task<VolunteerTrainingCourse> CreateCourseAsync(
        string title, string? description, int durationMinutes, bool isRequired, bool active)
    {
        if (string.IsNullOrWhiteSpace(title))
            throw new ArgumentException("Title required", nameof(title));
        if (durationMinutes < 0)
            throw new ArgumentException("Duration must be >= 0", nameof(durationMinutes));

        var entity = new VolunteerTrainingCourse
        {
            TenantId = _tenant.GetTenantIdOrThrow(),
            Title = title.Trim(),
            Description = description,
            DurationMinutes = durationMinutes,
            IsRequired = isRequired,
            Active = active,
            CreatedAt = DateTime.UtcNow
        };
        _db.VolunteerTrainingCourses.Add(entity);
        await _db.SaveChangesAsync();
        return entity;
    }

    public async Task<VolunteerTrainingCourse?> UpdateCourseAsync(
        int id, string? title, string? description, int? durationMinutes, bool? isRequired, bool? active)
    {
        var entity = await _db.VolunteerTrainingCourses.FirstOrDefaultAsync(c => c.Id == id);
        if (entity == null) return null;
        if (!string.IsNullOrWhiteSpace(title)) entity.Title = title.Trim();
        if (description != null) entity.Description = description;
        if (durationMinutes.HasValue && durationMinutes.Value >= 0) entity.DurationMinutes = durationMinutes.Value;
        if (isRequired.HasValue) entity.IsRequired = isRequired.Value;
        if (active.HasValue) entity.Active = active.Value;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return entity;
    }

    public async Task<bool> DeleteCourseAsync(int id)
    {
        var entity = await _db.VolunteerTrainingCourses.FirstOrDefaultAsync(c => c.Id == id);
        if (entity == null) return false;
        _db.VolunteerTrainingCourses.Remove(entity);
        await _db.SaveChangesAsync();
        return true;
    }

    // ─── Training completions ─────────────────────────────────────────────

    public Task<List<VolunteerTrainingCompletion>> ListCompletionsAsync(int? userId = null, int? courseId = null)
    {
        var q = _db.VolunteerTrainingCompletions.AsNoTracking().AsQueryable();
        if (userId.HasValue) q = q.Where(c => c.UserId == userId.Value);
        if (courseId.HasValue) q = q.Where(c => c.CourseId == courseId.Value);
        return q.OrderByDescending(c => c.CompletedAt).Take(500).ToListAsync();
    }

    public async Task<VolunteerTrainingCompletion> MarkCompletedAsync(
        int userId, int courseId, int? score, string? certificateUrl)
    {
        var course = await _db.VolunteerTrainingCourses.FirstOrDefaultAsync(c => c.Id == courseId)
            ?? throw new ArgumentException("Course not found", nameof(courseId));

        var existing = await _db.VolunteerTrainingCompletions
            .FirstOrDefaultAsync(c => c.UserId == userId && c.CourseId == courseId);

        if (existing != null)
        {
            existing.CompletedAt = DateTime.UtcNow;
            if (score.HasValue) existing.Score = score;
            if (!string.IsNullOrWhiteSpace(certificateUrl)) existing.CertificateUrl = certificateUrl;
            await _db.SaveChangesAsync();
            return existing;
        }

        var entity = new VolunteerTrainingCompletion
        {
            TenantId = _tenant.GetTenantIdOrThrow(),
            UserId = userId,
            CourseId = courseId,
            CompletedAt = DateTime.UtcNow,
            Score = score,
            CertificateUrl = certificateUrl
        };
        _db.VolunteerTrainingCompletions.Add(entity);
        await _db.SaveChangesAsync();
        return entity;
    }

    // ─── Guardian consents ────────────────────────────────────────────────

    public Task<List<VolunteerGuardianConsent>> ListConsentsAsync(VolunteerGuardianConsentStatus? status = null)
    {
        var q = _db.VolunteerGuardianConsents.AsNoTracking().AsQueryable();
        if (status.HasValue) q = q.Where(c => c.Status == status.Value);
        return q.OrderByDescending(c => c.CreatedAt).Take(500).ToListAsync();
    }

    // ─── Tenant policy (singleton) ────────────────────────────────────────

    public async Task<VolunteerTenantPolicy> GetPolicyAsync()
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var policy = await _db.VolunteerTenantPolicies.FirstOrDefaultAsync(p => p.TenantId == tenantId);
        if (policy != null) return policy;

        // Lazily create the singleton with sensible defaults.
        policy = new VolunteerTenantPolicy
        {
            TenantId = tenantId,
            UpdatedAt = DateTime.UtcNow
        };
        _db.VolunteerTenantPolicies.Add(policy);
        await _db.SaveChangesAsync();
        return policy;
    }

    public async Task<VolunteerTenantPolicy> UpdatePolicyAsync(
        int? minAge,
        decimal? hoursRequiredForCertificate,
        int? certificateTemplateId,
        int? requireGuardianConsentUnder,
        bool? autoApproveVerifiedAdults)
    {
        var policy = await GetPolicyAsync();
        if (minAge.HasValue && minAge.Value >= 0) policy.MinAge = minAge.Value;
        if (hoursRequiredForCertificate.HasValue && hoursRequiredForCertificate.Value >= 0)
            policy.HoursRequiredForCertificate = hoursRequiredForCertificate.Value;
        if (certificateTemplateId.HasValue) policy.CertificateTemplateId = certificateTemplateId.Value;
        if (requireGuardianConsentUnder.HasValue && requireGuardianConsentUnder.Value >= 0)
            policy.RequireGuardianConsentUnder = requireGuardianConsentUnder.Value;
        if (autoApproveVerifiedAdults.HasValue) policy.AutoApproveVerifiedAdults = autoApproveVerifiedAdults.Value;
        policy.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return policy;
    }
}
