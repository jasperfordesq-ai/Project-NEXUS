// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Per-user notification preferences for each notification type.
/// Controls which channels (in-app, push, email) are enabled per notification type.
/// </summary>
public class NotificationPreference : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// The notification type this preference applies to.
    /// Examples: "exchange_requested", "message_received", "connection_request".
    /// </summary>
    [Required]
    [MaxLength(50)]
    public string NotificationType { get; set; } = string.Empty;

    /// <summary>
    /// Whether to show this notification type in the in-app notification feed.
    /// </summary>
    public bool EnableInApp { get; set; } = true;

    /// <summary>
    /// Whether to send push notifications to registered devices.
    /// </summary>
    public bool EnablePush { get; set; } = true;

    /// <summary>
    /// Whether to send email notifications.
    /// </summary>
    public bool EnableEmail { get; set; } = false;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
