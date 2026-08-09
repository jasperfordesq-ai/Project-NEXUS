// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// API key for authenticating external federation requests.
/// Keys are stored as SHA-256 hashes; the raw key is only shown once at creation.
/// </summary>
public class FederationApiKey : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>SHA-256 hash of the API key.</summary>
    [MaxLength(64)]
    public string KeyHash { get; set; } = string.Empty;

    /// <summary>First 8 characters of the key for display purposes.</summary>
    [MaxLength(8)]
    public string KeyPrefix { get; set; } = string.Empty;

    [MaxLength(255)]
    public string Name { get; set; } = string.Empty;

    /// <summary>Permissions granted: listings, exchanges, members, events.</summary>
    [MaxLength(500)]
    public string Scopes { get; set; } = "listings";

    public bool IsActive { get; set; } = true;
    public DateTime? ExpiresAt { get; set; }
    public DateTime? LastUsedAt { get; set; }
    public int? RateLimitPerMinute { get; set; } = 60;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
}
