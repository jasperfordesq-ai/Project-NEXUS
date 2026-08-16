// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// A member backing a community project. Mirrors Laravel's
/// <c>vol_community_project_supporters</c>.
///
/// 🔴 Why this exists (R-28). Supporting a project wrote an opaque blob into
/// tenant config, and the project list returned raw records carrying neither
/// <c>supporter_count</c> nor <c>has_supported</c> — the two fields the screen
/// displays. So the whole feature was cosmetic: tapping support nudged a number
/// the client had invented, the server stored the fact where nothing read it,
/// and the next page load showed no supporters at all.
///
/// 🔴 Note what a "project" is here. Laravel has its own
/// <c>vol_community_projects</c> table; this backend serves community projects
/// from <c>VolunteerOpportunities</c>. That divergence is older than this table
/// and is not resolved by it — the foreign key points at an opportunity.
/// </summary>
public class VolunteerProjectSupporter : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>The supported project — a <see cref="VolunteerOpportunity"/> here.</summary>
    public int ProjectId { get; set; }

    public int UserId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
