// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Defines an onboarding step for a tenant. Tenant-scoped.
/// </summary>
public class OnboardingStep : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// Step key: profile_complete, skills_added, first_listing, first_exchange, etc.
    /// </summary>
    public string Key { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int SortOrder { get; set; } = 0;
    public bool IsRequired { get; set; } = false;

    /// <summary>
    /// XP reward for completing this step.
    /// </summary>
    public int XpReward { get; set; } = 0;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
}

/// <summary>
/// Tracks a user's progress through onboarding steps. Tenant-scoped.
/// </summary>
public class OnboardingProgress : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public int StepId { get; set; }

    public bool IsCompleted { get; set; } = false;
    public DateTime? CompletedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public OnboardingStep? Step { get; set; }
}
