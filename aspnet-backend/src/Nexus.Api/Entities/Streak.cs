// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Tracks a user's daily activity streak for a given type.
/// Unique constraint: TenantId + UserId + StreakType.
/// </summary>
public class Streak : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public int UserId { get; set; }

    /// <summary>
    /// Type of streak being tracked (e.g. "daily_login", "daily_exchange", "daily_post").
    /// </summary>
    [Required]
    [MaxLength(50)]
    public string StreakType { get; set; } = string.Empty;

    /// <summary>
    /// Current consecutive day streak count.
    /// </summary>
    public int CurrentStreak { get; set; } = 0;

    /// <summary>
    /// Longest streak ever achieved.
    /// </summary>
    public int LongestStreak { get; set; } = 0;

    /// <summary>
    /// Date of the last recorded activity.
    /// </summary>
    public DateTime LastActivityDate { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
