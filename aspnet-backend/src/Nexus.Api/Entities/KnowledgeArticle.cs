// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Knowledge base / help article for tenant-scoped documentation.
/// Supports markdown content, categories, tags, and view tracking.
/// </summary>
public class KnowledgeArticle : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// Article title.
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// URL-friendly slug (unique per tenant).
    /// </summary>
    public string Slug { get; set; } = string.Empty;

    /// <summary>
    /// Article body in markdown format.
    /// </summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>
    /// Category grouping (e.g., "Getting Started", "FAQ").
    /// </summary>
    public string? Category { get; set; }

    /// <summary>
    /// Comma-separated tags for filtering/search.
    /// </summary>
    public string? Tags { get; set; }

    /// <summary>
    /// Whether the article is visible to regular users.
    /// </summary>
    public bool IsPublished { get; set; } = false;

    /// <summary>
    /// Display order within a category (lower = first).
    /// </summary>
    public int SortOrder { get; set; } = 0;

    /// <summary>
    /// Number of times the article has been viewed.
    /// </summary>
    public int ViewCount { get; set; } = 0;

    /// <summary>
    /// User who created the article.
    /// </summary>
    public int CreatedById { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? CreatedBy { get; set; }
}
