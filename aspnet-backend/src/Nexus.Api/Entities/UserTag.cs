// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Admin-applied tag on a user for CRM segmentation.
/// Unique constraint: TenantId + UserId + Tag.
/// </summary>
public class UserTag : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public int UserId { get; set; }

    [Required]
    [MaxLength(100)]
    public string Tag { get; set; } = string.Empty;

    /// <summary>Admin who applied the tag.</summary>
    public int AppliedByAdminId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
