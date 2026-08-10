// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Volunteer admin extras — adds three V1 admin sub-features that the existing
 * Phase 65 long-tail subsystem did not cover:
 *
 *   - VolunteerTrainingCourse / VolunteerTrainingCompletion
 *   - VolunteerGuardianConsent (under-18 parental consent flow)
 *   - VolunteerTenantPolicy (singleton per tenant — min age, hours required
 *     for certificate, default certificate template, etc.)
 *
 * Tenant-scoped via ITenantEntity. VolunteerTenantPolicy has a UNIQUE index
 * on TenantId so it acts as a singleton.
 */

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

// ─── VolunteerTrainingCourse ────────────────────────────────────────────────

public class VolunteerTrainingCourse : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    [Required, MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    [MaxLength(2000)]
    public string? Description { get; set; }

    /// <summary>Estimated time-to-complete in minutes.</summary>
    public int DurationMinutes { get; set; }

    /// <summary>Required courses must be completed before a volunteer can take shifts.</summary>
    public bool IsRequired { get; set; } = false;

    public bool Active { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}

// ─── VolunteerTrainingCompletion ────────────────────────────────────────────

public class VolunteerTrainingCompletion : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public int CourseId { get; set; }

    public DateTime CompletedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Optional pass/fail score (0-100).</summary>
    public int? Score { get; set; }

    /// <summary>Optional URL to a generated certificate of completion.</summary>
    [MaxLength(2000)]
    public string? CertificateUrl { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public VolunteerTrainingCourse? Course { get; set; }
}

// ─── VolunteerGuardianConsent ───────────────────────────────────────────────

public enum VolunteerGuardianConsentStatus
{
    Pending = 0,
    Active = 1,
    Expired = 2,
    Withdrawn = 3
}

public class VolunteerGuardianConsent : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>The under-18 volunteer this consent applies to.</summary>
    public int MinorUserId { get; set; }

    /// <summary>
    /// Optional opportunity scope. Null grants tenant-wide volunteering consent.
    /// </summary>
    public int? OpportunityId { get; set; }

    [Required, MaxLength(255)]
    public string GuardianName { get; set; } = string.Empty;

    [Required, MaxLength(320)]
    public string GuardianEmail { get; set; } = string.Empty;

    [MaxLength(50)]
    public string? GuardianPhone { get; set; }

    [Required, MaxLength(100)]
    public string GuardianRelationship { get; set; } = string.Empty;

    /// <summary>
    /// SHA-256 hash of the one-time 64-hex-character email credential. The raw
    /// token is never persisted or returned by an API.
    /// </summary>
    [MaxLength(64)]
    public string? ConsentTokenHash { get; set; }

    public DateTime? ConsentedAt { get; set; }

    [MaxLength(45)]
    public string? ConsentIp { get; set; }

    public DateTime? RevokedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }

    [MaxLength(2000)]
    public string? ConsentDocumentUrl { get; set; }

    public VolunteerGuardianConsentStatus Status { get; set; } = VolunteerGuardianConsentStatus.Pending;

    [MaxLength(500)]
    public string? ReviewerNote { get; set; }

    public int? ReviewedByUserId { get; set; }
    public DateTime? ReviewedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? Minor { get; set; }
    public VolunteerOpportunity? Opportunity { get; set; }
}

// ─── VolunteerTenantPolicy ──────────────────────────────────────────────────

public class VolunteerTenantPolicy : ITenantEntity
{
    public int Id { get; set; }

    /// <summary>UNIQUE — one policy row per tenant.</summary>
    public int TenantId { get; set; }

    /// <summary>Minimum age (years) to volunteer at all.</summary>
    public int MinAge { get; set; } = 16;

    /// <summary>Hours of volunteering required before a certificate is auto-issued.</summary>
    public decimal HoursRequiredForCertificate { get; set; } = 10m;

    /// <summary>ID of the certificate template to use (FK is loose — just an int).</summary>
    public int? CertificateTemplateId { get; set; }

    /// <summary>Volunteers under this age require parental/guardian consent.</summary>
    public int RequireGuardianConsentUnder { get; set; } = 18;

    /// <summary>If true, ID-verified adults skip the manual approval queue.</summary>
    public bool AutoApproveVerifiedAdults { get; set; } = false;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
}
