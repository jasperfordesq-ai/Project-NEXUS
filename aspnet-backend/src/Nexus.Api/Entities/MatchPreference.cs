// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Stores a user's matching preferences for the smart matching engine.
/// Preferences influence how matches are scored and filtered.
/// </summary>
public class MatchPreference : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// Maximum distance in kilometers the user is willing to travel.
    /// Null means no distance preference.
    /// </summary>
    public double? MaxDistanceKm { get; set; }

    /// <summary>
    /// JSON array of preferred category IDs, e.g. "[1,3,7]".
    /// </summary>
    public string? PreferredCategories { get; set; }

    /// <summary>
    /// JSON array of available days, e.g. ["monday","tuesday","friday"].
    /// </summary>
    public string? AvailableDays { get; set; }

    /// <summary>
    /// Comma-separated time slots, e.g. "morning,afternoon,evening".
    /// </summary>
    public string? AvailableTimeSlots { get; set; }

    /// <summary>
    /// Comma-separated list of skills the user can offer.
    /// </summary>
    public string? SkillsOffered { get; set; }

    /// <summary>
    /// Comma-separated list of skills the user is looking for.
    /// </summary>
    public string? SkillsWanted { get; set; }

    /// <summary>
    /// Whether this preference set is active for matching.
    /// </summary>
    public bool IsActive { get; set; } = true;

    public string NotificationFrequency { get; set; } = "monthly";
    public bool NotifyHotMatches { get; set; } = true;
    public bool NotifyMutualMatches { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
