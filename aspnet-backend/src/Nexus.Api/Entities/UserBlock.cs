// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Tenant-scoped Laravel-compatible user block record.
/// </summary>
public class UserBlock : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public int BlockedUserId { get; set; }
    public string? Reason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant Tenant { get; set; } = null!;
    public User User { get; set; } = null!;
    public User BlockedUser { get; set; } = null!;
}
