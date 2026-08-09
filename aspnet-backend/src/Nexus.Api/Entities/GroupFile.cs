// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// A file shared within a group.
/// </summary>
public class GroupFile : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int GroupId { get; set; }
    public int UploadedById { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string FileUrl { get; set; } = string.Empty;
    public string? ContentType { get; set; }
    public long FileSizeBytes { get; set; }
    public string? Description { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public Group? Group { get; set; }
    public User? UploadedBy { get; set; }
}
