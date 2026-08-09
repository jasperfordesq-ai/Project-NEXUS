// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Tracks GDPR data export requests from users.
/// Users can request a copy of all their personal data.
/// </summary>
public class DataExportRequest : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    public ExportStatus Status { get; set; } = ExportStatus.Pending;

    [MaxLength(20)]
    public string Format { get; set; } = "json";

    [MaxLength(1000)]
    public string? FileUrl { get; set; }

    public long? FileSizeBytes { get; set; }

    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public DateTime? DownloadedAt { get; set; }

    [MaxLength(1000)]
    public string? ErrorMessage { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}

/// <summary>
/// Status of a data export request.
/// </summary>
public enum ExportStatus
{
    Pending,
    Processing,
    Ready,
    Downloaded,
    Expired,
    Failed
}
