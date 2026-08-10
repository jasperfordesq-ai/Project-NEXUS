// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Tracks an identity verification session between a user and a provider.
/// Sensitive provider payloads are NOT stored — only metadata, status, and decision.
/// </summary>
public class IdentityVerificationSession : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// The provider used for this session.
    /// </summary>
    public VerificationProvider Provider { get; set; }

    /// <summary>
    /// The verification level requested.
    /// </summary>
    public VerificationLevel Level { get; set; }

    /// <summary>
    /// Current status of the session.
    /// </summary>
    public VerificationSessionStatus Status { get; set; } = VerificationSessionStatus.Created;

    /// <summary>
    /// Provider's external session/transaction ID.
    /// </summary>
    [MaxLength(500)]
    public string? ExternalSessionId { get; set; }

    /// <summary>
    /// URL the user should be redirected to for hosted verification (if applicable).
    /// </summary>
    [MaxLength(2000)]
    public string? RedirectUrl { get; set; }

    /// <summary>
    /// Provider's decision: "approved", "declined", "review", etc.
    /// </summary>
    [MaxLength(100)]
    public string? ProviderDecision { get; set; }

    /// <summary>
    /// Provider's reason for the decision (sanitized, no PII).
    /// </summary>
    [MaxLength(1000)]
    public string? DecisionReason { get; set; }

    /// <summary>
    /// Provider's confidence/risk score (0.0 to 1.0) if available.
    /// </summary>
    public double? ConfidenceScore { get; set; }

    /// <summary>
    /// When the session expires.
    /// </summary>
    public DateTime ExpiresAt { get; set; }

    /// <summary>
    /// When verification was completed (success or failure).
    /// </summary>
    public DateTime? CompletedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public User? User { get; set; }
    public Tenant? Tenant { get; set; }
    public ICollection<IdentityVerificationEvent> Events { get; set; } = new List<IdentityVerificationEvent>();
}
