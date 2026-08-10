// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Tracks a user's participation and progress in a challenge.
/// Unique constraint: TenantId + ChallengeId + UserId.
/// </summary>
public class ChallengeParticipant : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public int ChallengeId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// Current number of completed actions toward the challenge target.
    /// </summary>
    public int CurrentProgress { get; set; } = 0;

    public bool IsCompleted { get; set; } = false;
    public DateTime? CompletedAt { get; set; }

    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public Challenge? Challenge { get; set; }
    public User? User { get; set; }
}
