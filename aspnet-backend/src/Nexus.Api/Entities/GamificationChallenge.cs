// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// A time-limited gamification challenge that users can participate in to earn XP or badge rewards.
/// Distinct from the existing Challenge entity which uses ChallengeParticipant; this entity
/// tracks progress directly via ChallengeProgress.
/// </summary>
public class GamificationChallenge : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    /// <summary>
    /// Recurrence type: "daily", "weekly", or "special".
    /// </summary>
    public string Type { get; set; } = "daily";

    /// <summary>
    /// The action that counts toward this challenge (e.g., "exchange", "post", "login").
    /// </summary>
    public string ActionType { get; set; } = string.Empty;

    /// <summary>
    /// Number of times the action must be performed to complete the challenge.
    /// </summary>
    public int TargetCount { get; set; } = 1;

    /// <summary>
    /// XP awarded upon challenge completion.
    /// </summary>
    public int XpReward { get; set; }

    /// <summary>
    /// Optional badge slug awarded upon completion.
    /// </summary>
    public string? BadgeReward { get; set; }

    public DateTime StartsAt { get; set; }
    public DateTime EndsAt { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public ICollection<ChallengeProgress> Progresses { get; set; } = new List<ChallengeProgress>();
}
