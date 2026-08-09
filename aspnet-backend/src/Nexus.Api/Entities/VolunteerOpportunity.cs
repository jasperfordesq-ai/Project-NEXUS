// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a volunteer opportunity that users can apply to.
/// Opportunities can be standalone or associated with a group.
/// </summary>
public class VolunteerOpportunity : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// Title of the volunteer opportunity.
    /// </summary>
    [Required]
    [MaxLength(255)]
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// Detailed description of the opportunity.
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// User who created/organizes this opportunity.
    /// </summary>
    public int OrganizerId { get; set; }

    /// <summary>
    /// Optional dedicated volunteer organisation. OrganizerId remains the
    /// Laravel-equivalent created_by user and is not an organisation key.
    /// </summary>
    public int? VolunteerOrganisationId { get; set; }

    /// <summary>
    /// Optional group context for this opportunity.
    /// </summary>
    public int? GroupId { get; set; }

    /// <summary>
    /// Physical or virtual location.
    /// </summary>
    [MaxLength(500)]
    public string? Location { get; set; }

    /// <summary>
    /// Optional category for filtering.
    /// </summary>
    public int? CategoryId { get; set; }

    /// <summary>
    /// Current status of the opportunity.
    /// </summary>
    public OpportunityStatus Status { get; set; } = OpportunityStatus.Draft;

    /// <summary>
    /// Number of volunteers needed.
    /// </summary>
    public int RequiredVolunteers { get; set; }

    /// <summary>
    /// Whether this is a recurring opportunity.
    /// </summary>
    public bool IsRecurring { get; set; } = false;

    /// <summary>
    /// When the opportunity starts.
    /// </summary>
    public DateTime? StartsAt { get; set; }

    /// <summary>
    /// When the opportunity ends.
    /// </summary>
    public DateTime? EndsAt { get; set; }

    /// <summary>
    /// Deadline for applications.
    /// </summary>
    public DateTime? ApplicationDeadline { get; set; }

    /// <summary>
    /// Comma-separated list of required skills.
    /// </summary>
    public string? SkillsRequired { get; set; }

    /// <summary>
    /// Time credits earned per shift upon completion.
    /// </summary>
    public decimal? CreditReward { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? Organizer { get; set; }
    public VolunteerOrganisation? VolunteerOrganisation { get; set; }
    public Group? Group { get; set; }
    public Category? Category { get; set; }
    public ICollection<VolunteerShift> Shifts { get; set; } = new List<VolunteerShift>();
    public ICollection<VolunteerApplication> Applications { get; set; } = new List<VolunteerApplication>();
}

/// <summary>
/// Status of a volunteer opportunity.
/// </summary>
public enum OpportunityStatus
{
    /// <summary>Opportunity is being drafted and not yet visible.</summary>
    Draft,
    /// <summary>Opportunity is published and accepting applications.</summary>
    Published,
    /// <summary>Opportunity is closed and no longer accepting applications.</summary>
    Closed,
    /// <summary>Opportunity has been cancelled.</summary>
    Cancelled
}
