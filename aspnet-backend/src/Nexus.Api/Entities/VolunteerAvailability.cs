// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a volunteer's recurring or one-time availability window.
/// Used by the predictive staffing system to match available volunteers to shifts.
/// </summary>
public class VolunteerAvailability : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The volunteer user.
    /// </summary>
    public int UserId { get; set; }

    /// <summary>
    /// Day of week (0 = Sunday, 6 = Saturday).
    /// </summary>
    public int DayOfWeek { get; set; }

    /// <summary>
    /// Start time of availability window.
    /// </summary>
    public TimeOnly StartTime { get; set; }

    /// <summary>
    /// End time of availability window.
    /// </summary>
    public TimeOnly EndTime { get; set; }

    /// <summary>
    /// Whether this availability repeats weekly.
    /// </summary>
    public bool IsRecurring { get; set; } = true;

    /// <summary>
    /// When this availability starts being effective (null = immediately).
    /// </summary>
    public DateTime? EffectiveFrom { get; set; }

    /// <summary>
    /// When this availability stops being effective (null = indefinitely).
    /// </summary>
    public DateTime? EffectiveUntil { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
