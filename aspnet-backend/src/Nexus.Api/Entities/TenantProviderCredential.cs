// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Encrypted, tenant-scoped credentials for identity-verification providers.
/// Mirrors Laravel's tenant_provider_credentials store.
/// </summary>
public class TenantProviderCredential : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string ProviderSlug { get; set; } = string.Empty;
    public string CredentialsEncrypted { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}
