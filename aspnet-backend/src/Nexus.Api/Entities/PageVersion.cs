// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Version history for CMS pages. Tenant-scoped.
/// Each edit creates a new version for audit trail and rollback.
/// </summary>
public class PageVersion : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public int PageId { get; set; }
    public int VersionNumber { get; set; }

    public string Title { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;

    public int CreatedById { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public Page? Page { get; set; }
    public User? CreatedBy { get; set; }
}
