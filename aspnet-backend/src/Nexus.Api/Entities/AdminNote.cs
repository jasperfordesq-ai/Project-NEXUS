// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Admin note attached to a user for CRM purposes.
/// Allows admins to track interactions, compliance issues, support history, and feedback.
/// </summary>
public class AdminNote : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The user this note is about.
    /// </summary>
    public int UserId { get; set; }

    /// <summary>
    /// The admin who wrote this note.
    /// </summary>
    public int AdminId { get; set; }

    /// <summary>
    /// Note content (free-text).
    /// </summary>
    [Required]
    public string Content { get; set; } = string.Empty;

    /// <summary>
    /// Optional category for organizing notes.
    /// Examples: "general", "support", "compliance", "feedback"
    /// </summary>
    [MaxLength(50)]
    public string? Category { get; set; }

    /// <summary>
    /// Whether this note is flagged for follow-up or attention.
    /// </summary>
    public bool IsFlagged { get; set; } = false;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public User? Admin { get; set; }
}
