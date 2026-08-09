// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Durable link between a local account and a validated external identity.
/// Provider names for tenant OIDC are tenant-qualified: sso:{tenant}:{key}.
/// </summary>
public sealed class OAuthIdentity : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string Provider { get; set; } = string.Empty;
    public string ProviderUserId { get; set; } = string.Empty;
    public string? ProviderEmail { get; set; }
    public string? AvatarUrl { get; set; }
    public string? RawPayload { get; set; }
    public DateTime LinkedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastUsedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

/// <summary>
/// One-use server-side OIDC authorization flow. Secrets are encrypted and the
/// public state nonce is stored only as a SHA-256 digest.
/// </summary>
public sealed class SsoOidcFlow : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public string ProviderKey { get; set; } = string.Empty;
    public string StateNonceHash { get; set; } = string.Empty;
    public string CodeVerifierCiphertext { get; set; } = string.Empty;
    public string OidcNonce { get; set; } = string.Empty;
    public string BrowserChallenge { get; set; } = string.Empty;
    public string RedirectUri { get; set; } = string.Empty;
    public DateTime AuthenticationStartedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? ConsumedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Browser-bound one-time grant exchanged by the unchanged React callback page.
/// Pending identity data is encrypted and is committed only after possession of
/// the initiating browser verifier is proven.
/// </summary>
public sealed class OAuthCallbackGrant : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string CodeHash { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public bool IsNew { get; set; }
    public string BrowserChallenge { get; set; } = string.Empty;
    public DateTime AuthenticationStartedAt { get; set; }
    public string? PendingIdentityCiphertext { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? ConsumedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
