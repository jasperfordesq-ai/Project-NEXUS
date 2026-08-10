// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Phase 65 — Volunteer long-tail entities.
 *
 * Adds the four V1 volunteer subsystems that V2 had not ported:
 *   - VolunteerExpense (claim → review → approve/reject → reimburse)
 *   - VolunteerWellbeing (post-shift wellbeing pulse + free-text concern)
 *   - VolunteerCertificate (issued recognition certificates)
 *   - VolunteerEmergencyAlert (emergency contact broadcast — NOT the
 *     Caring Community alert system; this is volunteer-coordination only)
 *
 * Note: Caring Community alerts (CaringCommunityAlertService etc.) are tracked
 * parity gaps separately. VolunteerEmergencyAlert below covers ONLY the
 * volunteer-coordination flow (e.g. "Site closed today, do not show up").
 */

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

// ─── VolunteerExpense ───────────────────────────────────────────────────────

public enum VolunteerExpenseStatus
{
    Submitted = 0,
    UnderReview = 1,
    Approved = 2,
    Rejected = 3,
    Reimbursed = 4
}

public class VolunteerExpense : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>Optional shift this expense relates to.</summary>
    public int? ShiftId { get; set; }

    /// <summary>Amount claimed (in tenant's reporting currency).</summary>
    public decimal Amount { get; set; }

    [MaxLength(3)]
    public string Currency { get; set; } = "EUR";

    [Required, MaxLength(100)]
    public string Category { get; set; } = "travel";

    [Required, MaxLength(500)]
    public string Description { get; set; } = string.Empty;

    /// <summary>Optional receipt URL (uploaded to file service).</summary>
    [MaxLength(2000)]
    public string? ReceiptUrl { get; set; }

    public VolunteerExpenseStatus Status { get; set; } = VolunteerExpenseStatus.Submitted;

    [MaxLength(500)]
    public string? ReviewerNote { get; set; }

    public int? ReviewedByUserId { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public DateTime? ReimbursedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}

// ─── VolunteerWellbeing ─────────────────────────────────────────────────────

public class VolunteerWellbeing : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>Shift this pulse relates to (optional — could be a general wellbeing entry).</summary>
    public int? ShiftId { get; set; }

    /// <summary>1–5 wellbeing score. 1 = poor / unsafe, 5 = great.</summary>
    public int Score { get; set; }

    /// <summary>Free-text wellbeing note. May contain safeguarding concern.</summary>
    [MaxLength(2000)]
    public string? Note { get; set; }

    /// <summary>True if the volunteer flagged this as a concern needing follow-up.</summary>
    public bool RequiresFollowUp { get; set; } = false;

    /// <summary>Set when a coordinator marks the entry as actioned.</summary>
    public bool IsResolved { get; set; } = false;
    public int? ResolvedByUserId { get; set; }
    public DateTime? ResolvedAt { get; set; }
    [MaxLength(500)]
    public string? ResolutionNote { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}

// ─── VolunteerWellbeingAlert ────────────────────────────────────────────────

/// <summary>
/// Coordinator-facing burnout-risk alert produced by the volunteering wellbeing
/// assessment. This is deliberately separate from <see cref="VolunteerWellbeing"/>,
/// which stores volunteer-submitted post-shift pulse responses.
/// </summary>
public class VolunteerWellbeingAlert : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    [Required, MaxLength(20)]
    public string RiskLevel { get; set; } = "moderate";

    public decimal RiskScore { get; set; }

    /// <summary>JSON object containing the risk indicators found by the assessment.</summary>
    public string Indicators { get; set; } = "{}";

    public bool CoordinatorNotified { get; set; }

    public string? CoordinatorNotes { get; set; }

    [Required, MaxLength(20)]
    public string Status { get; set; } = "active";

    public DateTime? ResolvedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

// ─── VolunteerCertificate ───────────────────────────────────────────────────

public class VolunteerCertificate : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    [Required, MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    [MaxLength(2000)]
    public string? Description { get; set; }

    /// <summary>Hours recognised by this certificate.</summary>
    public decimal? HoursRecognised { get; set; }

    /// <summary>Issuing organisation/sponsor name.</summary>
    [MaxLength(200)]
    public string? IssuedBy { get; set; }

    public DateTime IssuedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ExpiresAt { get; set; }

    /// <summary>Public verification code printed on the certificate.</summary>
    [MaxLength(64)]
    public string VerificationCode { get; set; } = string.Empty;

    /// <summary>If true, anyone with the verification code can confirm authenticity.</summary>
    public bool IsPubliclyVerifiable { get; set; } = true;

    /// <summary>URL to a generated PDF of the certificate (file service).</summary>
    [MaxLength(2000)]
    public string? PdfUrl { get; set; }

    public bool IsRevoked { get; set; } = false;
    [MaxLength(500)]
    public string? RevocationReason { get; set; }
    public DateTime? RevokedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}

// ─── VolunteerEmergencyAlert ────────────────────────────────────────────────

public enum VolunteerEmergencyAlertSeverity
{
    Info = 0,
    Warning = 1,
    Urgent = 2
}

public class VolunteerEmergencyAlert : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>Optional opportunity scope (null = all volunteers in tenant).</summary>
    public int? OpportunityId { get; set; }

    /// <summary>Optional shift scope.</summary>
    public int? ShiftId { get; set; }

    [Required, MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    [Required, MaxLength(2000)]
    public string Body { get; set; } = string.Empty;

    public VolunteerEmergencyAlertSeverity Severity { get; set; } = VolunteerEmergencyAlertSeverity.Info;

    public int CreatedByUserId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime? AcknowledgedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}
