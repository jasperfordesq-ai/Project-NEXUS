// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// A user's score entry in a leaderboard season.
/// Unique constraint: TenantId + SeasonId + UserId.
/// </summary>
public class LeaderboardEntry : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public int SeasonId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// Total XP earned during this season.
    /// </summary>
    public int Score { get; set; } = 0;

    /// <summary>
    /// Computed rank within the season (nullable until calculated).
    /// </summary>
    public int? Rank { get; set; }

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public LeaderboardSeason? Season { get; set; }
    public User? User { get; set; }
}
