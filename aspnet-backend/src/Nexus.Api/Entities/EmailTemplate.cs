// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Customizable email templates per tenant.
///
/// Phase 64 — added native versioning to replace V1's Mailchimp-based template
/// authoring (Mailchimp removed per project owner directive 2026-05-09). Each
/// row is one immutable version of a template; only one version per
/// (TenantId, Key) should have IsActive=true at a time.
/// </summary>
public class EmailTemplate : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// Template key, e.g. "welcome", "exchange_requested", "exchange_completed", "digest_weekly".
    /// </summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>
    /// Monotonic version number per (TenantId, Key). Phase 64 — versioning.
    /// Older versions are retained for audit / rollback.
    /// </summary>
    public int Version { get; set; } = 1;

    public string Subject { get; set; } = string.Empty;

    /// <summary>
    /// HTML body template with placeholders like {{user_name}}, {{listing_title}}.
    /// </summary>
    public string BodyHtml { get; set; } = string.Empty;

    /// <summary>
    /// Plain text fallback.
    /// </summary>
    public string? BodyText { get; set; }

    /// <summary>
    /// Whether this version is the active one for sends. Only one row per
    /// (TenantId, Key) should be active at any time — enforced by
    /// EmailTemplateService when activating a new version.
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// Phase 64 — short note describing why this version was created
    /// ("fixed broken link", "new branding"). Surfaced in admin diff view.
    /// </summary>
    public string? ChangeNote { get; set; }

    /// <summary>Admin user who created this version. Phase 64.</summary>
    public int? CreatedByUserId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
}
