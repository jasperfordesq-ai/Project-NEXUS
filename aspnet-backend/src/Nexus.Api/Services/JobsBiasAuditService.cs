// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Computes a per-protected-attribute fairness audit on job applications,
/// using the "four-fifths rule" — flag any subgroup whose advancement rate
/// (shortlisted/accepted vs total) is less than 80% of the highest subgroup
/// rate.
///
/// Real per-protected-attribute audits depend on the User entity capturing
/// fields such as Gender, AgeBand, Ethnicity, DisabilityStatus. The current
/// V2 User entity captures none of these. Until the profile is expanded the
/// service returns an empty report with an explanatory message rather than
/// failing — keeping the endpoint shape stable for the admin UI.
/// </summary>
public class JobsBiasAuditService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;

    /// <summary>
    /// Statuses that count as "advanced past initial screening" — the
    /// numerator of the advancement-rate metric. Anything else (pending,
    /// rejected, withdrawn) is in the pool but not advanced.
    /// </summary>
    private static readonly HashSet<string> AdvancedStatuses = new(StringComparer.OrdinalIgnoreCase)
    {
        "reviewed", "shortlisted", "accepted", "hired",
    };

    public JobsBiasAuditService(NexusDbContext db, TenantContext tenant)
    {
        _db = db;
        _tenant = tenant;
    }

    public async Task<BiasAuditReport> RunAuditAsync(int? jobId, DateTime since, CancellationToken ct)
    {
        if (!_tenant.TenantId.HasValue)
        {
            return new BiasAuditReport
            {
                JobId = jobId,
                Since = since,
                GeneratedAt = DateTime.UtcNow,
                TotalApplications = 0,
                Attributes = new List<AttributeBreakdown>(),
                Message = "tenant context not resolved",
            };
        }

        var tenantId = _tenant.TenantId.Value;

        var query = _db.JobApplications
            .Where(a => a.TenantId == tenantId && a.CreatedAt >= since);

        if (jobId.HasValue)
            query = query.Where(a => a.JobId == jobId.Value);

        var applications = await query
            .Select(a => new { a.Id, a.JobId, a.ApplicantUserId, a.Status, a.CreatedAt })
            .ToListAsync(ct);

        // Detect which protected attributes the User entity actually exposes.
        // The V2 User entity (as of 2026-05-10) does NOT yet capture Gender,
        // DateOfBirth, Ethnicity, or DisabilityStatus, so we surface an
        // explicit empty-report message instead of fabricating buckets.
        var capturedAttributes = DetectCapturedAttributes();

        if (capturedAttributes.Count == 0)
        {
            return new BiasAuditReport
            {
                JobId = jobId,
                Since = since,
                GeneratedAt = DateTime.UtcNow,
                TotalApplications = applications.Count,
                Attributes = new List<AttributeBreakdown>(),
                Message = "no protected attributes captured on the user profile — bias audit cannot run until the profile is expanded (Gender / AgeBand / Ethnicity / DisabilityStatus)",
            };
        }

        // When attributes do exist (future expansion), the per-attribute
        // computation flow lives here. Kept as a placeholder so the shape
        // is in place for when User profile fields land.
        var breakdowns = new List<AttributeBreakdown>();

        return new BiasAuditReport
        {
            JobId = jobId,
            Since = since,
            GeneratedAt = DateTime.UtcNow,
            TotalApplications = applications.Count,
            Attributes = breakdowns,
            Message = null,
        };
    }

    /// <summary>
    /// Reflects on the User entity to discover which protected attributes
    /// are actually captured. Returns the property names so the audit can
    /// build buckets only for fields that exist.
    /// </summary>
    private static List<string> DetectCapturedAttributes()
    {
        var captured = new List<string>();
        var userType = typeof(User);
        string[] candidates = { "Gender", "AgeBand", "DateOfBirth", "Ethnicity", "DisabilityStatus" };
        foreach (var name in candidates)
        {
            if (userType.GetProperty(name) != null)
                captured.Add(name);
        }
        return captured;
    }

    public static bool IsAdvanced(string status) => AdvancedStatuses.Contains(status);
}

public class BiasAuditReport
{
    public int? JobId { get; set; }
    public DateTime Since { get; set; }
    public DateTime GeneratedAt { get; set; }
    public int TotalApplications { get; set; }
    public List<AttributeBreakdown> Attributes { get; set; } = new();
    public string? Message { get; set; }
}

public class AttributeBreakdown
{
    public string Attribute { get; set; } = string.Empty;
    public List<GroupBreakdown> Groups { get; set; } = new();
}

public class GroupBreakdown
{
    public string Group { get; set; } = string.Empty;
    public int TotalApplicants { get; set; }
    public int AdvancedCount { get; set; }
    public double AdvancementRate { get; set; }
    public bool FourFifthsFlag { get; set; }
}
