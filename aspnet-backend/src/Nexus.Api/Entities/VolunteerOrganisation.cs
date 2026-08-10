// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// A tenant-scoped organisation that owns volunteer opportunities. This is
/// deliberately separate from <see cref="Organisation"/>, whose lifecycle is
/// used by employer, community, and Verein workflows.
/// </summary>
public sealed class VolunteerOrganisation : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int OwnerUserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? ContactEmail { get; set; }
    public string? Website { get; set; }
    public string? LogoUrl { get; set; }
    public string? Location { get; set; }
    public string Status { get; set; } = "pending";
    public string? OrgType { get; set; } = "organisation";
    public string? MeetingSchedule { get; set; }
    public bool AutoPayEnabled { get; set; }
    public decimal Balance { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? OwnerUser { get; set; }
    public ICollection<VolunteerOrganisationMember> Members { get; set; } = [];
    public ICollection<VolunteerOpportunity> Opportunities { get; set; } = [];
    public ICollection<VolunteerOrganisationTransaction> Transactions { get; set; } = [];
}

/// <summary>
/// Explicit volunteer-organisation membership. Roles and lifecycle states
/// intentionally mirror Laravel's volunteer rows without sharing the generic
/// organisation membership table.
/// </summary>
public sealed class VolunteerOrganisationMember : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int VolunteerOrganisationId { get; set; }
    public string OrgType { get; set; } = "volunteer";
    public int UserId { get; set; }
    public string Role { get; set; } = "member";
    public string Status { get; set; } = "active";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public VolunteerOrganisation? VolunteerOrganisation { get; set; }
    public User? User { get; set; }
}

/// <summary>
/// Canonical volunteer-organisation wallet audit row.
/// </summary>
public sealed class VolunteerOrganisationTransaction : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int VolunteerOrganisationId { get; set; }
    public int? UserId { get; set; }
    public int? VolunteerLogId { get; set; }
    public string Type { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public decimal BalanceAfter { get; set; }
    public string? Description { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public VolunteerOrganisation? VolunteerOrganisation { get; set; }
    public User? User { get; set; }
    public VolunteerLog? VolunteerLog { get; set; }
}
