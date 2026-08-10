// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Custom CMS page for tenant-scoped static content.
/// Supports versioning, menu placement, and scheduled publishing.
/// </summary>
public class Page : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public string Title { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;

    public bool IsPublished { get; set; } = false;
    public int SortOrder { get; set; } = 0;

    /// <summary>
    /// Whether to show in navigation menu.
    /// </summary>
    public bool ShowInMenu { get; set; } = false;

    /// <summary>
    /// Menu location: header, footer, sidebar
    /// </summary>
    public string? MenuLocation { get; set; }

    /// <summary>
    /// Optional parent page for hierarchy.
    /// </summary>
    public int? ParentId { get; set; }

    public DateTime? PublishAt { get; set; }
    public int CreatedById { get; set; }
    public int CurrentVersion { get; set; } = 1;

    // SEO fields
    public string? MetaTitle { get; set; }
    public string? MetaDescription { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? CreatedBy { get; set; }
    public Page? Parent { get; set; }
    public ICollection<Page> Children { get; set; } = new List<Page>();
    public ICollection<PageVersion> Versions { get; set; } = new List<PageVersion>();
}
