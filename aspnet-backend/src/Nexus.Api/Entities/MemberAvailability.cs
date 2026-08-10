// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a user's availability schedule for exchanges.
/// Stores recurring weekly availability (day + time slots).
/// </summary>
public class MemberAvailability : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>Day of week (0=Sunday through 6=Saturday).</summary>
    public int DayOfWeek { get; set; }

    /// <summary>Start time (e.g. "09:00").</summary>
    [MaxLength(5)]
    public string StartTime { get; set; } = string.Empty;

    /// <summary>End time (e.g. "17:00").</summary>
    [MaxLength(5)]
    public string EndTime { get; set; } = string.Empty;

    /// <summary>Whether this slot is active.</summary>
    public bool IsActive { get; set; } = true;

    /// <summary>Optional note (e.g. "Mornings only", "Flexible").</summary>
    [MaxLength(255)]
    public string? Note { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}

/// <summary>
/// One-off availability exception (e.g. "I'm free on Saturday March 15th").
/// </summary>
public class AvailabilityException : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>The specific date.</summary>
    public DateTime Date { get; set; }

    /// <summary>"available" or "unavailable" (overrides weekly schedule).</summary>
    [MaxLength(20)]
    public string Type { get; set; } = "unavailable";

    [MaxLength(5)]
    public string? StartTime { get; set; }

    [MaxLength(5)]
    public string? EndTime { get; set; }

    [MaxLength(255)]
    public string? Reason { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
