// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// FCM/Web Push device registration for a user.
/// Each user can have multiple devices registered for push notifications.
/// </summary>
public class PushSubscription : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// FCM registration token or Web Push subscription endpoint.
    /// </summary>
    [Required]
    [MaxLength(500)]
    public string DeviceToken { get; set; } = string.Empty;

    /// <summary>
    /// Device platform: "web", "android", "ios".
    /// </summary>
    [Required]
    [MaxLength(20)]
    public string Platform { get; set; } = "web";

    /// <summary>
    /// Optional human-readable device name (e.g. "Chrome on Windows", "iPhone 15").
    /// </summary>
    [MaxLength(255)]
    public string? DeviceName { get; set; }

    /// <summary>
    /// Whether this subscription is still active. Set to false when token expires or is unregistered.
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// Last time a push notification was successfully sent to this device.
    /// </summary>
    public DateTime? LastUsedAt { get; set; }

    /// <summary>
    /// Web-Push only — base64url-encoded NIST P-256 public key the browser
    /// generates (browser <c>PushSubscription.getKey('p256dh')</c>).
    /// Used by the server to perform ECDH key agreement when encrypting
    /// payloads per RFC 8291. Null for FCM / native subscriptions.
    /// </summary>
    [MaxLength(200)]
    public string? P256dh { get; set; }

    /// <summary>
    /// Web-Push only — base64url-encoded 16-byte auth secret the browser
    /// generates (browser <c>PushSubscription.getKey('auth')</c>).
    /// Mixed into the HKDF derivation. Null for FCM / native subscriptions.
    /// </summary>
    [MaxLength(64)]
    public string? Auth { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
