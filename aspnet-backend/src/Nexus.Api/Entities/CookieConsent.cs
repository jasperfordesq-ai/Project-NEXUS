// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Records a user's or visitor's cookie consent choices.
/// Phase 32: Cookie Consent system.
/// </summary>
public class CookieConsent : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// Associated user ID. Null for anonymous visitors.
    /// </summary>
    public int? UserId { get; set; }

    /// <summary>
    /// Session identifier for anonymous visitors.
    /// </summary>
    [MaxLength(100)]
    public string? SessionId { get; set; }

    /// <summary>
    /// Necessary cookies are always enabled and cannot be disabled.
    /// </summary>
    public bool NecessaryCookies { get; set; } = true;

    /// <summary>
    /// Whether the user consented to analytics cookies.
    /// </summary>
    public bool AnalyticsCookies { get; set; }

    /// <summary>
    /// Whether the user consented to marketing cookies.
    /// </summary>
    public bool MarketingCookies { get; set; }

    /// <summary>
    /// Whether the user consented to preference cookies.
    /// </summary>
    public bool PreferenceCookies { get; set; }

    /// <summary>
    /// IP address of the visitor when consent was given.
    /// </summary>
    [MaxLength(50)]
    public string? IpAddress { get; set; }

    /// <summary>
    /// User agent string of the visitor's browser.
    /// </summary>
    [MaxLength(500)]
    public string? UserAgent { get; set; }

    /// <summary>
    /// When the consent was originally given.
    /// </summary>
    public DateTime ConsentedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
