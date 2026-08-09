// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Represents an application to a job vacancy.
/// </summary>
public class JobApplication : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int JobId { get; set; }
    public int ApplicantUserId { get; set; }
    public string? CoverLetter { get; set; }
    public string Status { get; set; } = "pending"; // pending, reviewed, accepted, rejected, withdrawn
    public DateTime? ReviewedAt { get; set; }
    public int? ReviewedByUserId { get; set; }
    public string? ReviewNotes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public JobVacancy? Job { get; set; }
    public User? Applicant { get; set; }
    public User? ReviewedBy { get; set; }
}
