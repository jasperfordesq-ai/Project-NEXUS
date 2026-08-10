// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a skill in the catalog that users can claim and be endorsed for.
/// Skills are tenant-scoped and optionally linked to a category.
/// </summary>
public class Skill : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    [Required]
    [MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    public string Slug { get; set; } = string.Empty;

    public int? CategoryId { get; set; }

    [MaxLength(500)]
    public string? Description { get; set; }

    /// <summary>
    /// Whether this skill can be verified through endorsements.
    /// </summary>
    public bool IsVerifiable { get; set; } = false;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public Category? Category { get; set; }
}
