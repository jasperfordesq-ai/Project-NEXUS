// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

public enum DeliverableStatus { Pending, InProgress, Completed, Cancelled }
public enum DeliverablePriority { Low, Medium, High, Critical }

/// <summary>
/// A work deliverable that can be assigned to a member and tracked through completion.
/// Scoped to a tenant; used by admin teams to manage tasks and milestones.
/// </summary>
public class Deliverable : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    [Required]
    [MaxLength(300)]
    public string Title { get; set; } = string.Empty;

    [MaxLength(5000)]
    public string? Description { get; set; }

    public int? AssignedToUserId { get; set; }
    public int CreatedByUserId { get; set; }

    public DeliverableStatus Status { get; set; } = DeliverableStatus.Pending;
    public DeliverablePriority Priority { get; set; } = DeliverablePriority.Medium;

    public DateTime? DueDate { get; set; }
    public DateTime? CompletedAt { get; set; }

    /// <summary>Comma-separated tag labels for filtering (e.g. "sprint-1,backend").</summary>
    [MaxLength(500)]
    public string? Tags { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public User? AssignedTo { get; set; }
    public User? CreatedBy { get; set; }
    public List<DeliverableComment> Comments { get; set; } = new();
}
