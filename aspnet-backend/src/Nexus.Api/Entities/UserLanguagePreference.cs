// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// A user's preferred language settings.
/// Each user can choose a preferred locale and an optional fallback.
/// </summary>
public class UserLanguagePreference : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// The user's preferred locale code (e.g. "fr", "ga").
    /// </summary>
    [Required]
    [MaxLength(10)]
    public string PreferredLocale { get; set; } = "en";

    /// <summary>
    /// Optional fallback locale if a translation is missing in the preferred locale.
    /// Defaults to the tenant's default locale if not set.
    /// </summary>
    [MaxLength(10)]
    public string? FallbackLocale { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
