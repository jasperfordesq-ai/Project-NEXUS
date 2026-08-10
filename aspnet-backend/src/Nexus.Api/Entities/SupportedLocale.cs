// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// A locale (language) supported by a tenant.
/// Each tenant can enable different languages for their community.
/// </summary>
public class SupportedLocale : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The locale code (e.g. "en", "fr", "ga").
    /// </summary>
    [Required]
    [MaxLength(10)]
    public string Locale { get; set; } = string.Empty;

    /// <summary>
    /// Display name in English (e.g. "English", "French", "Irish").
    /// </summary>
    [Required]
    [MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Display name in the native language (e.g. "English", "Fran\u00e7ais", "Gaeilge").
    /// </summary>
    [Required]
    [MaxLength(100)]
    public string NativeName { get; set; } = string.Empty;

    /// <summary>
    /// Whether this is the default locale for the tenant.
    /// Only one locale per tenant should be marked as default.
    /// </summary>
    public bool IsDefault { get; set; } = false;

    /// <summary>
    /// Whether this locale is currently active and available to users.
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// Percentage of translation keys that have been translated for this locale.
    /// Updated when translations are added or removed.
    /// </summary>
    public int CompletionPercent { get; set; } = 0;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
}
