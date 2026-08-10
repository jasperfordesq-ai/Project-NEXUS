// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents an audit log entry tracking user and system actions.
/// Tenant-scoped for multi-tenant isolation.
/// </summary>
public class AuditLog : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The user who performed the action. Null for system-initiated actions.
    /// </summary>
    public int? UserId { get; set; }

    /// <summary>
    /// The action performed, e.g. "user.login", "listing.create", "admin.user.suspend".
    /// </summary>
    [Required]
    [MaxLength(100)]
    public string Action { get; set; } = string.Empty;

    /// <summary>
    /// The type of entity affected, e.g. "Listing", "Exchange", "User".
    /// </summary>
    [MaxLength(100)]
    public string? EntityType { get; set; }

    /// <summary>
    /// The ID of the affected entity.
    /// </summary>
    public int? EntityId { get; set; }

    /// <summary>
    /// JSON representation of the previous values (before the change).
    /// </summary>
    [Column(TypeName = "text")]
    public string? OldValues { get; set; }

    /// <summary>
    /// JSON representation of the new values (after the change).
    /// </summary>
    [Column(TypeName = "text")]
    public string? NewValues { get; set; }

    /// <summary>
    /// The IP address of the request originator.
    /// </summary>
    [MaxLength(50)]
    public string? IpAddress { get; set; }

    /// <summary>
    /// The user agent string from the request.
    /// </summary>
    [MaxLength(500)]
    public string? UserAgent { get; set; }

    /// <summary>
    /// Additional JSON metadata for the audit entry.
    /// </summary>
    [Column(TypeName = "text")]
    public string? Metadata { get; set; }

    /// <summary>
    /// Severity level of the audit event.
    /// </summary>
    public AuditSeverity Severity { get; set; } = AuditSeverity.Info;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}

/// <summary>
/// Severity levels for audit log entries.
/// </summary>
public enum AuditSeverity
{
    Info,
    Warning,
    Critical
}
