// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Log entry recording a user's daily reward claim, including XP and any bonus awarded.
/// </summary>
public class DailyRewardLog : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// The day number in the streak cycle when this reward was claimed.
    /// </summary>
    public int DayNumber { get; set; }

    /// <summary>
    /// Amount of XP awarded for this claim.
    /// </summary>
    public int XpAwarded { get; set; }

    /// <summary>
    /// Description of any bonus awarded (e.g., badge name, item key), or null if XP only.
    /// </summary>
    public string? BonusAwarded { get; set; }

    public DateTime ClaimedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
