// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Association between a user and an organisation. Tenant-scoped.
/// </summary>
public class OrganisationMember : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public int OrganisationId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// Role within org: owner, admin, member, volunteer
    /// </summary>
    public string Role { get; set; } = "member";

    /// <summary>
    /// Job title / position within the organisation.
    /// </summary>
    public string? JobTitle { get; set; }

    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public Organisation? Organisation { get; set; }
    public User? User { get; set; }
}
