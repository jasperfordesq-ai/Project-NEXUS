// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a content report filed by a user against any reportable content.
/// Reports are tenant-scoped and reviewed by admins.
/// </summary>
public class ContentReport : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The user who filed the report.
    /// </summary>
    public int ReporterId { get; set; }

    /// <summary>
    /// Type of content being reported: listing, user, post, comment, message, group, exchange.
    /// </summary>
    [MaxLength(50)]
    public string ContentType { get; set; } = string.Empty;

    /// <summary>
    /// ID of the reported content item.
    /// </summary>
    public int ContentId { get; set; }

    /// <summary>
    /// Reason for the report.
    /// </summary>
    public ReportReason Reason { get; set; }

    /// <summary>
    /// Additional details provided by the reporter.
    /// </summary>
    [MaxLength(2000)]
    public string? Description { get; set; }

    /// <summary>
    /// Current status of the report.
    /// </summary>
    public ReportStatus Status { get; set; } = ReportStatus.Pending;

    /// <summary>
    /// Admin who reviewed the report.
    /// </summary>
    public int? ReviewedById { get; set; }

    /// <summary>
    /// When the report was reviewed.
    /// </summary>
    public DateTime? ReviewedAt { get; set; }

    /// <summary>
    /// Notes from the reviewing admin.
    /// </summary>
    [MaxLength(2000)]
    public string? ReviewNotes { get; set; }

    /// <summary>
    /// Description of what action was taken.
    /// </summary>
    [MaxLength(500)]
    public string? ActionTaken { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? Reporter { get; set; }
    public User? ReviewedBy { get; set; }
}

/// <summary>
/// Reason for reporting content.
/// </summary>
public enum ReportReason
{
    Spam,
    Harassment,
    Inappropriate,
    Fraud,
    SafetyConcern,
    Other
}

/// <summary>
/// Status of a content report.
/// </summary>
public enum ReportStatus
{
    Pending,
    UnderReview,
    ActionTaken,
    Dismissed,
    Escalated
}
