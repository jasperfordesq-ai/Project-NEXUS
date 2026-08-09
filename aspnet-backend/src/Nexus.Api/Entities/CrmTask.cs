// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Admin CRM task assigned to a user, for follow-up or action items.
/// </summary>
public class CrmTask : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>The user this task relates to.</summary>
    public int TargetUserId { get; set; }

    /// <summary>Admin who created the task.</summary>
    public int AssignedToAdminId { get; set; }

    [Required]
    [MaxLength(255)]
    public string Title { get; set; } = string.Empty;

    public string? Description { get; set; }

    /// <summary>low | medium | high</summary>
    [MaxLength(20)]
    public string Priority { get; set; } = "medium";

    /// <summary>pending | done</summary>
    [MaxLength(20)]
    public string Status { get; set; } = "pending";

    public DateTime? DueDate { get; set; }
    public DateTime? CompletedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? TargetUser { get; set; }
    public User? AssignedToAdmin { get; set; }
}
