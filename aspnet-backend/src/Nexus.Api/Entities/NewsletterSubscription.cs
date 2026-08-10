// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a newsletter subscription for a user or external email address.
/// Phase 31: Newsletter system.
/// Unique constraint: TenantId + Email.
/// </summary>
public class NewsletterSubscription : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// Associated user ID. Null for external subscribers who are not platform users.
    /// </summary>
    public int? UserId { get; set; }

    /// <summary>
    /// Subscriber email address.
    /// </summary>
    [Required]
    [MaxLength(255)]
    public string Email { get; set; } = string.Empty;

    /// <summary>
    /// Whether the subscriber is currently subscribed.
    /// </summary>
    public bool IsSubscribed { get; set; } = true;

    public DateTime SubscribedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// When the subscriber unsubscribed, if applicable.
    /// </summary>
    public DateTime? UnsubscribedAt { get; set; }

    /// <summary>
    /// How the subscription was created: "registration", "manual", "import".
    /// </summary>
    [MaxLength(50)]
    public string? Source { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
