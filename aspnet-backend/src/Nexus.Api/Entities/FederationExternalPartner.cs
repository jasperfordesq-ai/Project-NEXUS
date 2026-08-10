// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public class FederationExternalPartner : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string BaseUrl { get; set; } = string.Empty;
    public string ApiPath { get; set; } = "/api/v1/federation";
    public string? ApiKey { get; set; }
    public string AuthMethod { get; set; } = "api_key";
    public string ProtocolType { get; set; } = "nexus";
    public string? SigningSecret { get; set; }
    public string? OAuthClientId { get; set; }
    public string? OAuthClientSecret { get; set; }
    public string? OAuthTokenUrl { get; set; }
    public bool AllowMemberSearch { get; set; } = true;
    public bool AllowListingSearch { get; set; } = true;
    public bool AllowMessaging { get; set; } = true;
    public bool AllowTransactions { get; set; } = true;
    public bool AllowEvents { get; set; }
    public bool AllowGroups { get; set; }
    public bool AllowConnections { get; set; }
    public bool AllowVolunteering { get; set; }
    public bool AllowMemberSync { get; set; }
    public string Status { get; set; } = "pending";
    public DateTime? VerifiedAt { get; set; }
    public DateTime? LastSyncAt { get; set; }
    public string? LastError { get; set; }
    public int ErrorCount { get; set; }
    public string? PartnerName { get; set; }
    public string? PartnerVersion { get; set; }
    public int? PartnerMemberCount { get; set; }
    public string? PartnerMetadata { get; set; }
    public int? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}

public class FederationExternalPartnerLog
{
    public int Id { get; set; }
    public int PartnerId { get; set; }
    public string Endpoint { get; set; } = string.Empty;
    public string Method { get; set; } = "GET";
    public string? RequestBody { get; set; }
    public int? ResponseCode { get; set; }
    public string? ResponseBody { get; set; }
    public int? ResponseTimeMs { get; set; }
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public FederationExternalPartner? Partner { get; set; }
}

public class FederationWebhookNonce
{
    public int Id { get; set; }
    public string PlatformId { get; set; } = string.Empty;
    public string Nonce { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class FederationSystemControl
{
    public int Id { get; set; }
    public bool FederationEnabled { get; set; } = true;
    public bool EmergencyLockdown { get; set; }
    public bool RequireTenantWhitelist { get; set; } = true;
    public bool AutoApprovePartnerships { get; set; }
    public int MaxPartnersPerTenant { get; set; } = 100;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class FederationTenantWhitelist : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public bool IsEnabled { get; set; } = true;
    public string? Notes { get; set; }
    public int? ApprovedByUserId { get; set; }
    public DateTime ApprovedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
}

public class FederationTenantFeature : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Feature { get; set; } = string.Empty;
    public bool IsEnabled { get; set; } = true;
    public string? Configuration { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
}
