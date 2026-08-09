// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a user's application to volunteer for an opportunity.
/// Applications go through a review workflow: Pending → Approved/Declined.
/// </summary>
public class VolunteerApplication : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The opportunity being applied to.
    /// </summary>
    public int OpportunityId { get; set; }

    /// <summary>
    /// Optional shift selected for this application. Applications created for an
    /// opportunity without a specific rota slot remain valid with a null value.
    /// </summary>
    public int? ShiftId { get; set; }

    /// <summary>
    /// The user who is applying.
    /// </summary>
    public int UserId { get; set; }

    /// <summary>
    /// Current status of the application.
    /// </summary>
    public ApplicationStatus Status { get; set; } = ApplicationStatus.Pending;

    /// <summary>
    /// Optional message from the applicant.
    /// </summary>
    [MaxLength(2000)]
    public string? Message { get; set; }

    /// <summary>
    /// Optional note recorded by the opportunity manager when deciding the
    /// application. Tenants may require this field for declines.
    /// </summary>
    [MaxLength(2000)]
    public string? OrgNote { get; set; }

    /// <summary>
    /// User who reviewed the application (organizer).
    /// </summary>
    public int? ReviewedById { get; set; }

    /// <summary>
    /// When the application was reviewed.
    /// </summary>
    public DateTime? ReviewedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public VolunteerOpportunity? Opportunity { get; set; }
    public VolunteerShift? Shift { get; set; }
    public User? User { get; set; }
    public User? ReviewedBy { get; set; }
}

/// <summary>
/// Status of a volunteer application.
/// </summary>
public enum ApplicationStatus
{
    /// <summary>Application is awaiting review.</summary>
    Pending,
    /// <summary>Application has been approved.</summary>
    Approved,
    /// <summary>Application has been declined.</summary>
    Declined,
    /// <summary>Application was withdrawn by the applicant.</summary>
    Withdrawn
}
