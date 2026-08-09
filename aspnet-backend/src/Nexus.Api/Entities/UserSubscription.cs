// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

public enum SubscriptionStatus { Active, Cancelled, Expired, PastDue }

/// <summary>
/// A member's subscription to a SubscriptionPlan.
/// Tracks billing dates, status, and optional Stripe integration.
/// </summary>
public class UserSubscription : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public int PlanId { get; set; }

    public SubscriptionStatus Status { get; set; } = SubscriptionStatus.Active;

    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ExpiresAt { get; set; }
    public DateTime? CancelledAt { get; set; }
    public DateTime? NextBillingDate { get; set; }

    [MaxLength(200)]
    public string? StripeSubscriptionId { get; set; }

    [MaxLength(1000)]
    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public User? User { get; set; }
    public SubscriptionPlan? Plan { get; set; }
}
