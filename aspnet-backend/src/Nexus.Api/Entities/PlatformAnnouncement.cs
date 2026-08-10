// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// System-wide announcement from administrators.
/// Announcements can be time-bounded and categorized by severity.
/// </summary>
public class PlatformAnnouncement : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// Announcement title.
    /// </summary>
    [Required]
    [MaxLength(255)]
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// Full content of the announcement.
    /// </summary>
    [Required]
    public string Content { get; set; } = string.Empty;

    /// <summary>
    /// Type/severity of the announcement.
    /// </summary>
    public AnnouncementType Type { get; set; } = AnnouncementType.Info;

    /// <summary>
    /// Whether the announcement is currently active.
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// When the announcement becomes visible (null = immediately).
    /// </summary>
    public DateTime? StartsAt { get; set; }

    /// <summary>
    /// When the announcement expires (null = no expiry).
    /// </summary>
    public DateTime? EndsAt { get; set; }

    /// <summary>
    /// Admin who created the announcement.
    /// </summary>
    public int CreatedById { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? CreatedBy { get; set; }
}

/// <summary>
/// Type/severity of a platform announcement.
/// </summary>
public enum AnnouncementType
{
    Info,
    Warning,
    Critical,
    Maintenance
}
