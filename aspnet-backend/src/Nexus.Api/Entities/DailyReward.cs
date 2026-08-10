// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Record of a daily reward claimed by a user.
/// Day cycles from 1-7 with scaling XP rewards.
/// </summary>
public class DailyReward : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public int UserId { get; set; }

    /// <summary>
    /// Consecutive day number in the reward cycle (1-7).
    /// </summary>
    public int Day { get; set; }

    /// <summary>
    /// Amount of XP awarded for this claim.
    /// </summary>
    public int XpAwarded { get; set; }

    public DateTime ClaimedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
