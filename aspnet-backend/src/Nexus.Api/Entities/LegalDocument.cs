// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// A legal document (e.g. Terms of Service, Privacy Policy) that users may need to accept.
/// Unique constraint: TenantId + Slug + Version.
/// </summary>
public class LegalDocument : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    [MaxLength(255)]
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// URL-friendly identifier, e.g. "terms-of-service", "privacy-policy".
    /// </summary>
    [MaxLength(100)]
    public string Slug { get; set; } = string.Empty;

    /// <summary>
    /// Full text content of the legal document.
    /// </summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>
    /// Version string, e.g. "1.0", "2.1".
    /// </summary>
    [MaxLength(20)]
    public string Version { get; set; } = string.Empty;

    /// <summary>
    /// Whether this version is the currently active version.
    /// Only one version per slug should be active at a time.
    /// </summary>
    public bool IsActive { get; set; }

    /// <summary>
    /// Whether users must accept this document (e.g. ToS = true, changelog = false).
    /// </summary>
    public bool RequiresAcceptance { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
}
