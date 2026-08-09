// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public enum ApiPartnerStatus
{
    Active = 0,
    Suspended = 1,
    Revoked = 2,
    // Preserve the existing persisted enum values above. New partners begin
    // pending and require an explicit admin activation before API access.
    Pending = 3
}

/// <summary>
/// External third-party consumer of the public API. Distinct from
/// FederationPartner / FederationApiKey which represent peer timebanks.
/// API keys are stored as SHA-256 hashes; raw key is only returned at
/// registration or rotation.
/// </summary>
public class ApiPartner : ITenantEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int TenantId { get; set; }

    public string Name { get; set; } = string.Empty;
    public string ContactEmail { get; set; } = string.Empty;
    public string? Description { get; set; }

    public string ApiKeyHash { get; set; } = string.Empty;
    public string ApiKeyPrefix { get; set; } = string.Empty;

    public string Scopes { get; set; } = "read";
    public int RateLimitPerMinute { get; set; } = 60;
    public bool IsSandbox { get; set; } = true;
    public string? AllowedIpCidrs { get; set; }

    public ApiPartnerStatus Status { get; set; } = ApiPartnerStatus.Pending;

    public DateTime? LastUsedAt { get; set; }
    public int RequestsLast24h { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public int? CreatedBy { get; set; }
    public DateTime? RevokedAt { get; set; }
    public string? RevokedReason { get; set; }

    public Tenant? Tenant { get; set; }
}

/// <summary>Persisted hash/state for a short-lived partner OAuth token.</summary>
public class ApiPartnerAccessToken : ITenantEntity
{
    public long Id { get; set; }
    public Guid PartnerId { get; set; }
    public int TenantId { get; set; }
    public string AccessTokenHash { get; set; } = string.Empty;
    public string Scopes { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ApiPartner? Partner { get; set; }
    public Tenant? Tenant { get; set; }
}

/// <summary>
/// Durable partner/reference idempotency evidence for inbound wallet credits.
/// A completed row points at the single ledger mint created for the request.
/// </summary>
public class ApiPartnerWalletCredit : ITenantEntity
{
    public long Id { get; set; }
    public Guid PartnerId { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string Reference { get; set; } = string.Empty;
    public string ReferenceNormalized { get; set; } = string.Empty;
    public int? TransactionId { get; set; }
    public decimal Hours { get; set; }
    public string Status { get; set; } = "processing";
    public DateTime? CompletedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ApiPartner? Partner { get; set; }
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public Transaction? Transaction { get; set; }
}
