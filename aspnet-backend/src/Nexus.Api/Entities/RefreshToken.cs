// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a refresh token for a user session.
/// Refresh tokens are long-lived and can be used to obtain new access tokens.
/// They are tenant-scoped and can be revoked.
/// </summary>
public class RefreshToken : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// The actual token string (hashed for security).
    /// </summary>
    public string TokenHash { get; set; } = string.Empty;

    /// <summary>
    /// When this token expires.
    /// </summary>
    public DateTime ExpiresAt { get; set; }

    /// <summary>
    /// When this token was created.
    /// </summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// When this token was revoked (null if still valid).
    /// </summary>
    public DateTime? RevokedAt { get; set; }

    /// <summary>
    /// Reason for revocation (logout, password_change, admin_revoke, etc.).
    /// </summary>
    public string? RevokedReason { get; set; }

    /// <summary>
    /// Client identifier (e.g., "web", "mobile", "api").
    /// </summary>
    public string? ClientType { get; set; }

    /// <summary>
    /// IP address that created this token.
    /// </summary>
    public string? CreatedByIp { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }

    /// <summary>
    /// Check if this token is still valid (not expired and not revoked).
    /// </summary>
    public bool IsValid => RevokedAt == null && DateTime.UtcNow < ExpiresAt;
}
