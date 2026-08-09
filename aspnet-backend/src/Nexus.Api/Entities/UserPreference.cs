// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Per-user general preferences (theme, language, timezone, privacy, etc.).
/// One record per user per tenant. Created with defaults on first access.
/// </summary>
public class UserPreference : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// UI theme preference. Options: "light", "dark", "system".
    /// </summary>
    [MaxLength(20)]
    public string Theme { get; set; } = "system";

    /// <summary>
    /// Preferred language/locale code (e.g. "en", "fr", "de").
    /// </summary>
    [MaxLength(10)]
    public string Language { get; set; } = "en";

    /// <summary>
    /// IANA timezone identifier (e.g. "UTC", "Europe/London", "America/New_York").
    /// </summary>
    [MaxLength(100)]
    public string Timezone { get; set; } = "UTC";

    /// <summary>
    /// How often to receive email digest summaries. Options: "daily", "weekly", "never".
    /// </summary>
    [MaxLength(20)]
    public string EmailDigestFrequency { get; set; } = "weekly";

    /// <summary>
    /// Who can see this user's profile. Options: "public", "members", "connections".
    /// </summary>
    [MaxLength(20)]
    public string ProfileVisibility { get; set; } = "public";

    /// <summary>
    /// Whether to show online/active status to other users.
    /// </summary>
    public bool ShowOnlineStatus { get; set; } = true;

    /// <summary>
    /// Whether to show last-seen timestamp to other users.
    /// </summary>
    public bool ShowLastSeen { get; set; } = true;


    /// <summary>Whether to show email address on profile.</summary>
    public bool ShowEmail { get; set; } = false;

    /// <summary>Whether to show phone number on profile.</summary>
    public bool ShowPhone { get; set; } = false;

    /// <summary>Whether to show location on profile.</summary>
    public bool ShowLocation { get; set; } = true;

    /// <summary>Whether profile appears in search results.</summary>
    public bool Searchable { get; set; } = true;

    /// <summary>Whether email notifications are enabled.</summary>
    public bool EmailNotifications { get; set; } = true;

    /// <summary>Whether push notifications are enabled.</summary>
    public bool PushNotifications { get; set; } = true;

    /// <summary>Whether SMS notifications are enabled.</summary>
    public bool SmsNotifications { get; set; } = false;

    /// <summary>Preferred date format (e.g. "DD/MM/YYYY").</summary>
    [MaxLength(20)]
    public string DateFormat { get; set; } = "DD/MM/YYYY";

    /// <summary>Number of items per page in lists.</summary>
    public int ItemsPerPage { get; set; } = 20;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
