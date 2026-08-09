// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public class VerificationBadgeType
{
    public int Id { get; set; }
    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? IconUrl { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class UserVerificationBadge : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public int BadgeTypeId { get; set; }
    public DateTime AwardedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ExpiresAt { get; set; }
    public int? AwardedById { get; set; }
    public string? Notes { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public VerificationBadgeType? BadgeType { get; set; }
    public User? AwardedBy { get; set; }
}
