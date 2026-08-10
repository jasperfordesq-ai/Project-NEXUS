// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents one user endorsing another user's skill.
/// Each endorser can only endorse a given UserSkill once.
/// </summary>
public class Endorsement : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The UserSkill being endorsed.
    /// </summary>
    public int UserSkillId { get; set; }

    /// <summary>
    /// The user giving the endorsement.
    /// </summary>
    public int EndorserId { get; set; }

    /// <summary>
    /// The user being endorsed (denormalized for query convenience).
    /// </summary>
    public int EndorsedUserId { get; set; }

    [MaxLength(500)]
    public string? Comment { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public UserSkill? UserSkill { get; set; }
    public User? Endorser { get; set; }
    public User? EndorsedUser { get; set; }
}
