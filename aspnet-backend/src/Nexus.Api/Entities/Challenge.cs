// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Nexus.Api.Entities;

public enum ChallengeType
{
    Individual,
    Team,
    Community
}

public enum ChallengeDifficulty
{
    Easy,
    Medium,
    Hard,
    Epic
}

/// <summary>
/// A challenge that users can join and complete for XP and badge rewards.
/// </summary>
public class Challenge : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    [Required]
    [MaxLength(255)]
    public string Title { get; set; } = string.Empty;

    [Column(TypeName = "text")]
    public string? Description { get; set; }

    public ChallengeType ChallengeType { get; set; } = ChallengeType.Individual;

    /// <summary>
    /// The action type that counts toward this challenge (e.g. "exchange_completed", "listing_created").
    /// </summary>
    [Required]
    [MaxLength(100)]
    public string TargetAction { get; set; } = string.Empty;

    /// <summary>
    /// Number of actions required to complete this challenge.
    /// </summary>
    public int TargetCount { get; set; }

    /// <summary>
    /// XP awarded upon completing this challenge.
    /// </summary>
    public int XpReward { get; set; }

    /// <summary>
    /// Optional badge awarded on completion.
    /// </summary>
    public int? BadgeId { get; set; }

    public DateTime StartsAt { get; set; }
    public DateTime EndsAt { get; set; }

    public bool IsActive { get; set; } = true;

    /// <summary>
    /// Maximum number of participants. Null means unlimited.
    /// </summary>
    public int? MaxParticipants { get; set; }

    public ChallengeDifficulty Difficulty { get; set; } = ChallengeDifficulty.Medium;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public Badge? Badge { get; set; }
    public ICollection<ChallengeParticipant> Participants { get; set; } = new List<ChallengeParticipant>();
}
