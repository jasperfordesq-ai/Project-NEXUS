// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// A skill taxonomy category — the tree behind <c>/api/v2/skills/categories</c>.
///
/// 🔴 This is NOT <see cref="Category"/>. They are different tables with
/// different columns serving different pages: <c>Category</c> is the listing /
/// event / volunteering taxonomy, and skills have their own tree with a parent
/// link, an icon and a display order.
///
/// The endpoint used to answer from <c>Category</c> instead, because no skill
/// category table existed on this backend. It returned a 200 with plausible
/// content, so nothing failed and no route inventory noticed — the response
/// simply described the wrong taxonomy. Mirrors Laravel's <c>skill_categories</c>
/// (database/schema/mysql-schema.sql), read by App\Services\SkillTaxonomyService.
/// </summary>
public class SkillCategory : ITenantEntity
{
    public int Id { get; set; }

    public int TenantId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Slug { get; set; } = string.Empty;

    /// <summary>Parent category, or null for a root. Self-referencing.</summary>
    public int? ParentId { get; set; }

    public string? Description { get; set; }

    public string? Icon { get; set; }

    /// <summary>Explicit ordering; Laravel sorts by this then by name.</summary>
    public int DisplayOrder { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Null until the row is first updated, as in Laravel.</summary>
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public SkillCategory? Parent { get; set; }
    public ICollection<SkillCategory> Children { get; set; } = new List<SkillCategory>();
}
