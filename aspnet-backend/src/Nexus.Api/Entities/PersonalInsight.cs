// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Cached personal insight/stat for a user's dashboard.
/// Periodically recalculated from activity data.
/// </summary>
public class PersonalInsight : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string InsightType { get; set; } = string.Empty; // hours_given, hours_received, top_category, streak_days, connections_made, impact_score, community_rank
    public string Value { get; set; } = string.Empty; // JSON or scalar value
    public string? Label { get; set; } // Human-readable label
    public string? Period { get; set; } // week, month, quarter, all_time
    public DateTime CalculatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
