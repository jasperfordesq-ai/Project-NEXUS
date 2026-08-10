// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// A personal or community goal that a user sets for themselves.
/// Goals can be time-based, count-based, or milestone-based.
/// </summary>
public class Goal : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    [MaxLength(255)]
    public string Title { get; set; } = string.Empty;

    [MaxLength(2000)]
    public string? Description { get; set; }

    /// <summary>Goal type: "hours" (exchange X hours), "count" (complete X exchanges), "custom".</summary>
    [MaxLength(20)]
    public string GoalType { get; set; } = "custom";

    /// <summary>Target value for measurable goals (hours to exchange, exchanges to complete).</summary>
    public decimal? TargetValue { get; set; }

    /// <summary>Current progress toward the target.</summary>
    public decimal CurrentValue { get; set; }

    /// <summary>Optional category focus for the goal.</summary>
    [MaxLength(100)]
    public string? Category { get; set; }

    public string Status { get; set; } = "active"; // active, completed, abandoned
    public DateTime? TargetDate { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public ICollection<GoalMilestone> Milestones { get; set; } = new List<GoalMilestone>();
}

/// <summary>
/// A milestone/checkpoint within a goal.
/// </summary>
public class GoalMilestone : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int GoalId { get; set; }

    [MaxLength(255)]
    public string Title { get; set; } = string.Empty;

    public bool IsCompleted { get; set; }
    public DateTime? CompletedAt { get; set; }
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public Goal? Goal { get; set; }
}
