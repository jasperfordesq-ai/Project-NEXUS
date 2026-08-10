// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// A user's saved search query that can be re-run and optionally trigger notifications.
/// </summary>
public class SavedSearch : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string SearchType { get; set; } = "listings"; // listings, users, events, groups
    public string QueryJson { get; set; } = "{}"; // serialized search parameters
    public bool NotifyOnNewResults { get; set; }
    public int? LastResultCount { get; set; }
    public DateTime? LastRunAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
