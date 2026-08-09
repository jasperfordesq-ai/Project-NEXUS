// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a specific shift within a volunteer opportunity.
/// Volunteers check in and out of shifts to log hours.
/// </summary>
public class VolunteerShift : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The opportunity this shift belongs to.
    /// </summary>
    public int OpportunityId { get; set; }

    /// <summary>
    /// Optional title for the shift (e.g. "Morning shift").
    /// </summary>
    [MaxLength(255)]
    public string? Title { get; set; }

    /// <summary>
    /// When the shift starts.
    /// </summary>
    public DateTime StartsAt { get; set; }

    /// <summary>
    /// When the shift ends.
    /// </summary>
    public DateTime EndsAt { get; set; }

    /// <summary>
    /// Maximum number of volunteers for this shift.
    /// </summary>
    public int MaxVolunteers { get; set; }

    /// <summary>
    /// Physical or virtual location (overrides opportunity location if set).
    /// </summary>
    [MaxLength(500)]
    public string? Location { get; set; }

    /// <summary>
    /// Additional notes about this shift.
    /// </summary>
    [MaxLength(2000)]
    public string? Notes { get; set; }

    /// <summary>
    /// Current status of the shift.
    /// </summary>
    public ShiftStatus Status { get; set; } = ShiftStatus.Scheduled;

    public int? RecurringPatternId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public VolunteerOpportunity? Opportunity { get; set; }
    public RecurringShiftPattern? RecurringPattern { get; set; }
    public ICollection<VolunteerCheckIn> CheckIns { get; set; } = new List<VolunteerCheckIn>();
}

/// <summary>
/// Status of a volunteer shift.
/// </summary>
public enum ShiftStatus
{
    /// <summary>Shift is scheduled but hasn't started.</summary>
    Scheduled,
    /// <summary>Shift is currently in progress.</summary>
    InProgress,
    /// <summary>Shift has been completed.</summary>
    Completed,
    /// <summary>Shift has been cancelled.</summary>
    Cancelled
}
