// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// A subscription plan offered to members of a tenant.
/// Plans define feature limits and pricing tiers.
/// </summary>
public class SubscriptionPlan : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    [Required]
    [MaxLength(150)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(1000)]
    public string? Description { get; set; }

    /// <summary>Monthly price in the configured currency.</summary>
    public decimal Price { get; set; }

    [MaxLength(3)]
    public string Currency { get; set; } = "EUR";

    /// <summary>Maximum number of active members allowed under this plan (0 = unlimited).</summary>
    public int MaxMembers { get; set; }

    /// <summary>Maximum number of listings per member (0 = unlimited).</summary>
    public int MaxListings { get; set; }

    /// <summary>Maximum exchanges per member per calendar month (0 = unlimited).</summary>
    public int MaxExchangesPerMonth { get; set; }

    /// <summary>JSON array of feature flag strings (e.g. ["analytics","api_access"]).</summary>
    public string Features { get; set; } = "[]";

    public bool IsActive { get; set; } = true;

    /// <summary>If false, plan is internal-only and not shown on the public pricing page.</summary>
    public bool IsPublic { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public List<UserSubscription> Subscriptions { get; set; } = new();
}
