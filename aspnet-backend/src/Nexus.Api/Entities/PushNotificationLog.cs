// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Log of push notifications sent to devices.
/// Tracks delivery status for debugging and analytics.
/// </summary>
public class PushNotificationLog : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public int SubscriptionId { get; set; }

    [Required]
    [MaxLength(255)]
    public string Title { get; set; } = string.Empty;

    [Required]
    [MaxLength(1000)]
    public string Body { get; set; } = string.Empty;

    /// <summary>
    /// JSON payload with additional data for the notification.
    /// </summary>
    public string? Data { get; set; }

    public PushStatus Status { get; set; } = PushStatus.Pending;

    /// <summary>
    /// Error message if delivery failed.
    /// </summary>
    [MaxLength(1000)]
    public string? ErrorMessage { get; set; }

    /// <summary>
    /// When the notification was actually sent to the push service.
    /// </summary>
    public DateTime? SentAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public PushSubscription? Subscription { get; set; }
}

/// <summary>
/// Status of a push notification delivery attempt.
/// </summary>
public enum PushStatus
{
    /// <summary>Queued for sending.</summary>
    Pending,
    /// <summary>Successfully delivered to push service.</summary>
    Sent,
    /// <summary>Delivery failed (see ErrorMessage).</summary>
    Failed,
    /// <summary>Device token has expired and subscription was deactivated.</summary>
    Expired
}
