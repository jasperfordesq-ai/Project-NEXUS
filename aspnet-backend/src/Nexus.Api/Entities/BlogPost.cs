// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Blog post for tenant-scoped CMS.
/// Supports draft/published/archived status, categories, featured images, and SEO.
/// </summary>
public class BlogPost : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public string Title { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string? Excerpt { get; set; }
    public string? FeaturedImageUrl { get; set; }

    /// <summary>
    /// draft, published, archived
    /// </summary>
    public string Status { get; set; } = "draft";

    public int? CategoryId { get; set; }
    public int AuthorId { get; set; }

    /// <summary>
    /// Comma-separated tags.
    /// </summary>
    public string? Tags { get; set; }

    public bool IsFeatured { get; set; } = false;
    public int ViewCount { get; set; } = 0;

    public DateTime? PublishedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // SEO fields
    public string? MetaTitle { get; set; }
    public string? MetaDescription { get; set; }
    public string? CanonicalUrl { get; set; }
    public string? OgImageUrl { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? Author { get; set; }
    public BlogCategory? Category { get; set; }
}
