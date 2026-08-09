// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Tracks an individual user's progress toward completing a GamificationChallenge.
/// </summary>
public class ChallengeProgress : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ChallengeId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// How many times the target action has been performed so far.
    /// </summary>
    public int CurrentCount { get; set; } = 0;

    public bool IsCompleted { get; set; } = false;
    public DateTime? CompletedAt { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public GamificationChallenge? Challenge { get; set; }
    public User? User { get; set; }
}
