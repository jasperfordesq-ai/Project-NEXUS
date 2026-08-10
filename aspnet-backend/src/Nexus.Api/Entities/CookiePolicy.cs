// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Nexus.Api.Entities;

/// <summary>
/// Tenant-configurable cookie policy with versioning.
/// Phase 32: Cookie Consent system.
/// Unique constraint: TenantId + Version.
/// </summary>
public class CookiePolicy : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// Version identifier, e.g. "1.0", "1.1", "2.0".
    /// </summary>
    [Required]
    [MaxLength(20)]
    public string Version { get; set; } = string.Empty;

    /// <summary>
    /// HTML content of the cookie policy.
    /// </summary>
    [Required]
    [Column(TypeName = "text")]
    public string ContentHtml { get; set; } = string.Empty;

    /// <summary>
    /// Whether this is the currently active policy version.
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// When this policy version was published.
    /// </summary>
    public DateTime? PublishedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
}
