// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public enum ProvisioningRequestStatus
{
    Pending = 0,
    Approved = 1,
    Provisioning = 2,
    Ready = 3,
    Failed = 4,
    Rejected = 5
}

/// <summary>
/// A new-tenant provisioning request. TenantId is the parent / onboarding tenant
/// hosting the request (typically the super-admin tenant). CreatedTenantId is set
/// when provisioning completes successfully.
/// </summary>
public class ProvisioningRequest : ITenantEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int TenantId { get; set; }

    public string OrgName { get; set; } = string.Empty;
    public string RequestedSubdomain { get; set; } = string.Empty;
    public string ContactName { get; set; } = string.Empty;
    public string ContactEmail { get; set; } = string.Empty;
    public string? ContactPhone { get; set; }
    public string? Plan { get; set; }
    public string? Country { get; set; }
    public string? Notes { get; set; }

    public ProvisioningRequestStatus Status { get; set; } = ProvisioningRequestStatus.Pending;

    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ApprovedAt { get; set; }
    public DateTime? ProvisionedAt { get; set; }
    public DateTime? FailedAt { get; set; }

    public int? ApprovedBy { get; set; }
    public int? ProvisionedBy { get; set; }
    public string? FailureReason { get; set; }

    public int? CreatedTenantId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
}
