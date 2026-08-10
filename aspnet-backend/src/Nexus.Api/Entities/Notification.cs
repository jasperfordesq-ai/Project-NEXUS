// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// In-app notification for a user.
/// Notifications are created when events occur (connection requests, messages, etc.)
/// </summary>
public class Notification : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// Notification type - determines icon/behavior in UI.
    /// Examples: connection_request, connection_accepted, message_received, listing_response
    /// </summary>
    public string Type { get; set; } = string.Empty;

    /// <summary>
    /// Short title displayed in notification list.
    /// Example: "New connection request"
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// Longer body text with details.
    /// Example: "John Doe wants to connect with you"
    /// </summary>
    public string? Body { get; set; }

    /// <summary>
    /// JSON data for the notification (e.g., related entity IDs).
    /// Example: {"connection_id": 123, "from_user_id": 456}
    /// </summary>
    public string? Data { get; set; }

    /// <summary>
    /// Canonical frontend navigation target. This is stored separately from
    /// Data because React consumes a top-level <c>link</c> property.
    /// </summary>
    [MaxLength(2000)]
    public string? Link { get; set; }

    /// <summary>
    /// Whether the user has read/dismissed this notification.
    /// </summary>
    public bool IsRead { get; set; } = false;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ReadAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }

    /// <summary>
    /// Notification type constants.
    /// </summary>
    public static class Types
    {
        public const string ConnectionRequest = "connection_request";
        public const string ConnectionAccepted = "connection_accepted";
        public const string ConnectionDeclined = "connection_declined";
        public const string MessageReceived = "message_received";
        public const string ListingResponse = "listing_response";
        public const string TransferReceived = "transfer_received";
        public const string System = "system";
    }
}
