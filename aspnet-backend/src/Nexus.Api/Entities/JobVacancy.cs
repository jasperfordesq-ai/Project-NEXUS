// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a job vacancy posting in the timebanking system.
/// Jobs can be paid in time credits, traditional currency, or volunteer-based.
/// </summary>
public class JobVacancy : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int PostedByUserId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Category { get; set; } = string.Empty;
    public string JobType { get; set; } = "full-time"; // full-time, part-time, volunteer, contract, one-off
    public string? Location { get; set; }
    public bool IsRemote { get; set; }
    public decimal? TimeCreditsPerHour { get; set; }
    public string? RequiredSkills { get; set; } // comma-separated
    public string? ContactEmail { get; set; }
    public string Status { get; set; } = "draft"; // draft, active, filled, expired, cancelled
    public bool IsFeatured { get; set; }
    public DateTime? FeaturedUntil { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public DateTime? FilledAt { get; set; }
    public int ViewCount { get; set; }
    public int ApplicationCount { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? PostedBy { get; set; }
    public ICollection<JobApplication> Applications { get; set; } = new List<JobApplication>();
    public ICollection<SavedJob> SavedJobs { get; set; } = new List<SavedJob>();
}
