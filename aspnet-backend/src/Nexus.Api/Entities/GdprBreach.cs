// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public class GdprBreach : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Severity { get; set; } = "low";
    public string Status { get; set; } = "detected";
    public int AffectedUsersCount { get; set; }
    public string? DataTypesAffected { get; set; }
    public DateTime DetectedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ContainedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public DateTime? ReportedToAuthorityAt { get; set; }
    public string? AuthorityReference { get; set; }
    public string? RemediationSteps { get; set; }
    public int ReportedById { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? ReportedBy { get; set; }
}

public class GdprConsentType : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsRequired { get; set; }
    public int Version { get; set; } = 1;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}
