// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// A single translation string for a locale.
/// Translations are tenant-scoped, allowing each community to customise their UI text.
/// </summary>
public class Translation : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The locale code (e.g. "en", "fr", "de", "es", "ga", "pl", "pt").
    /// </summary>
    [Required]
    [MaxLength(10)]
    public string Locale { get; set; } = string.Empty;

    /// <summary>
    /// The translation key (e.g. "nav.home", "exchange.status.completed").
    /// Uses dot notation for namespacing.
    /// </summary>
    [Required]
    [MaxLength(255)]
    public string Key { get; set; } = string.Empty;

    /// <summary>
    /// The translated text value.
    /// </summary>
    [Required]
    public string Value { get; set; } = string.Empty;

    /// <summary>
    /// Optional namespace for grouping (e.g. "common", "exchange", "admin").
    /// </summary>
    [MaxLength(100)]
    public string? Namespace { get; set; }

    /// <summary>
    /// Whether this translation has been reviewed and approved.
    /// </summary>
    public bool IsApproved { get; set; } = false;

    /// <summary>
    /// The admin user who approved this translation.
    /// </summary>
    public int? ApprovedById { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? ApprovedBy { get; set; }
}
