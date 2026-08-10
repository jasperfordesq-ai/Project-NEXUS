// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Defines parent-child relationships between tenants.
/// NOT tenant-scoped (system-level entity).
/// </summary>
public class TenantHierarchy
{
    public int Id { get; set; }
    public int ParentTenantId { get; set; }
    public int ChildTenantId { get; set; }

    /// <summary>
    /// What the child can inherit from the parent: config, listings, members, all
    /// </summary>
    public string InheritanceMode { get; set; } = "config";

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? ParentTenant { get; set; }
    public Tenant? ChildTenant { get; set; }
}
