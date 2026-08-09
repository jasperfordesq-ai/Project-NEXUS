// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Links a primary user account to sub-accounts (family members, dependents).
/// The primary user can manage sub-accounts and view their activity.
/// </summary>
public class SubAccount : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int PrimaryUserId { get; set; }
    public int SubUserId { get; set; }
    public string Relationship { get; set; } = "family"; // family, dependent, minor, managed
    public string? DisplayName { get; set; } // optional override for sub-account name
    public bool CanTransact { get; set; } = true; // sub-account can make exchanges
    public bool CanMessage { get; set; } = true;
    public bool CanJoinGroups { get; set; } = true;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? PrimaryUser { get; set; }
    public User? SubUser { get; set; }
}
