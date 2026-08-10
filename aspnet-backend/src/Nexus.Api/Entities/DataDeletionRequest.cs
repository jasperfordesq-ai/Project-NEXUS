// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Tracks GDPR "right to be forgotten" deletion requests.
/// Requires admin review before processing.
/// </summary>
public class DataDeletionRequest : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    public DeletionStatus Status { get; set; } = DeletionStatus.Pending;

    [MaxLength(2000)]
    public string? Reason { get; set; }

    public int? ReviewedById { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public DateTime? CompletedAt { get; set; }

    /// <summary>
    /// Legal justification for retaining some data (e.g., financial records, legal holds).
    /// </summary>
    [MaxLength(1000)]
    public string? DataRetainedReason { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public User? ReviewedBy { get; set; }
}

/// <summary>
/// Status of a data deletion request.
/// </summary>
public enum DeletionStatus
{
    Pending,
    Approved,
    Processing,
    Completed,
    Rejected
}
