// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Tenant-scoped OpenID Connect provider configuration.
/// Mirrors Laravel's tenant_sso_providers registry.
/// </summary>
public class TenantSsoProvider : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string ProviderKey { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Preset { get; set; } = "generic";
    public string IssuerUrl { get; set; } = string.Empty;
    public string ClientId { get; set; } = string.Empty;
    public string? ClientSecretEncrypted { get; set; }
    public string Scopes { get; set; } = "openid profile email";
    public string? AllowedEmailDomains { get; set; }
    public bool AutoProvision { get; set; } = true;
    public bool IsEnabled { get; set; }
    public int? UpdatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}
