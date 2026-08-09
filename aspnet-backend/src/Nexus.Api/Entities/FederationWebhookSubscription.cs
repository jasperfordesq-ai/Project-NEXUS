// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

public enum FederationWebhookDirection
{
    Outbound = 0,
    Inbound = 1
}

public enum FederationWebhookStatus
{
    Active = 0,
    Paused = 1,
    Failed = 2
}

/// <summary>
/// Typed registry for federation webhook subscriptions. Replaces the
/// previous TenantConfig JSON-blob persistence at key
/// "admin_explicit.federation.webhooks".
/// </summary>
public class FederationWebhookSubscription : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    [MaxLength(255)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(1000)]
    public string TargetUrl { get; set; } = string.Empty;

    /// <summary>Comma-separated event types.</summary>
    [MaxLength(1000)]
    public string EventTypes { get; set; } = string.Empty;

    public FederationWebhookDirection Direction { get; set; } = FederationWebhookDirection.Outbound;
    public FederationWebhookStatus Status { get; set; } = FederationWebhookStatus.Active;

    /// <summary>Optional shared secret for outbound HMAC signing.</summary>
    [MaxLength(500)]
    public string? Secret { get; set; }

    public DateTime? LastDeliveredAt { get; set; }
    public DateTime? LastFailureAt { get; set; }

    [MaxLength(2000)]
    public string? LastFailureReason { get; set; }

    public int RetryCount { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public long? CreatedBy { get; set; }

    public Tenant? Tenant { get; set; }
}

/// <summary>
/// Audit log row for webhook delivery attempts (replaces the per-webhook
/// TenantConfig log key).
/// </summary>
public class FederationWebhookDeliveryLog : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int SubscriptionId { get; set; }

    public bool Success { get; set; }

    [MaxLength(2000)]
    public string? Reason { get; set; }

    [MaxLength(20)]
    public string? Action { get; set; }

    public string? PayloadJson { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public FederationWebhookSubscription? Subscription { get; set; }
    public Tenant? Tenant { get; set; }
}
