// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Audit trail for identity verification session state changes.
/// Provides a complete history of what happened during verification.
/// </summary>
public class IdentityVerificationEvent : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int SessionId { get; set; }

    /// <summary>
    /// Event type, e.g. "session.created", "webhook.received", "status.changed", "admin.override".
    /// </summary>
    [Required]
    [MaxLength(100)]
    public string EventType { get; set; } = string.Empty;

    /// <summary>
    /// Previous status (for state transitions).
    /// </summary>
    public VerificationSessionStatus? PreviousStatus { get; set; }

    /// <summary>
    /// New status (for state transitions).
    /// </summary>
    public VerificationSessionStatus? NewStatus { get; set; }

    /// <summary>
    /// Sanitized event metadata (no PII, no raw provider payloads).
    /// </summary>
    [MaxLength(4000)]
    public string? Metadata { get; set; }

    /// <summary>
    /// IP address of the actor (user or webhook source).
    /// </summary>
    [MaxLength(50)]
    public string? IpAddress { get; set; }

    /// <summary>
    /// User who triggered this event (null for provider webhooks).
    /// </summary>
    public int? ActorUserId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public IdentityVerificationSession? Session { get; set; }
}
