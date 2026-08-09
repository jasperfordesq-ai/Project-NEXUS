// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a password reset token.
/// These are short-lived tokens sent to user's email for password reset.
/// </summary>
public class PasswordResetToken : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// The token hash (never store plain token).
    /// </summary>
    public string TokenHash { get; set; } = string.Empty;

    /// <summary>
    /// When this token expires (typically 30 minutes — see PasswordResetExpiryMinutes).
    /// </summary>
    public DateTime ExpiresAt { get; set; }

    /// <summary>
    /// When this token was created.
    /// </summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// When this token was used (null if not yet used).
    /// </summary>
    public DateTime? UsedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }

    /// <summary>
    /// Check if this token is still valid (not expired and not used).
    /// </summary>
    public bool IsValid => UsedAt == null && DateTime.UtcNow < ExpiresAt;
}
