// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a skill claimed by a user on their profile.
/// Tracks proficiency level and endorsement count.
/// </summary>
public class UserSkill : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public int SkillId { get; set; }

    /// <summary>
    /// Self-reported proficiency level.
    /// </summary>
    public SkillLevel ProficiencyLevel { get; set; } = SkillLevel.Beginner;

    /// <summary>
    /// Whether this skill has been verified through endorsements.
    /// Auto-set to true after receiving 3 endorsements.
    /// </summary>
    public bool IsVerified { get; set; } = false;

    /// <summary>
    /// Cached count of endorsements received for this skill.
    /// </summary>
    public int EndorsementCount { get; set; } = 0;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public Skill? Skill { get; set; }
    public ICollection<Endorsement> Endorsements { get; set; } = new List<Endorsement>();
}

/// <summary>
/// Proficiency level for a user's skill.
/// </summary>
public enum SkillLevel
{
    Beginner,
    Intermediate,
    Advanced,
    Expert
}
