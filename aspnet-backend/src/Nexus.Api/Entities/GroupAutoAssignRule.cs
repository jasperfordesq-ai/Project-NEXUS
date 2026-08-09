// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace Nexus.Api.Entities;

/// <summary>
/// Tenant-owned rule used to place matching members into a group.
/// </summary>
public sealed class GroupAutoAssignRule : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int GroupId { get; set; }
    public string RuleType { get; set; } = string.Empty;
    public string RuleValue { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public Group? Group { get; set; }
}
