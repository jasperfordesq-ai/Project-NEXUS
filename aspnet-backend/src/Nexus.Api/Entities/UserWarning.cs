// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a warning issued to a user by an admin.
/// Warnings are tenant-scoped and may be linked to a content report.
/// </summary>
public class UserWarning : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The user who received the warning.
    /// </summary>
    public int UserId { get; set; }

    /// <summary>
    /// The admin who issued the warning.
    /// </summary>
    public int IssuedById { get; set; }

    /// <summary>
    /// Reason for the warning.
    /// </summary>
    [Required]
    [MaxLength(2000)]
    public string Reason { get; set; } = string.Empty;

    /// <summary>
    /// Severity level of the warning.
    /// </summary>
    public WarningSeverity Severity { get; set; }

    /// <summary>
    /// Optional linked content report that triggered this warning.
    /// </summary>
    public int? ReportId { get; set; }

    /// <summary>
    /// When the user acknowledged the warning.
    /// </summary>
    public DateTime? AcknowledgedAt { get; set; }

    /// <summary>
    /// When the warning expires (null = never expires).
    /// </summary>
    public DateTime? ExpiresAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public User? IssuedBy { get; set; }
    public ContentReport? Report { get; set; }
}

/// <summary>
/// Severity level for user warnings.
/// </summary>
public enum WarningSeverity
{
    Informal,
    Formal,
    Final
}
