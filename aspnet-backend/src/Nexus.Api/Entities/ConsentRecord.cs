// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Tracks user consent for GDPR compliance.
/// Records when consent was granted or revoked for each consent type.
/// Unique constraint: TenantId + UserId + ConsentType.
/// </summary>
public class ConsentRecord : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// Type of consent, e.g. "marketing_emails", "analytics", "data_sharing", "terms_of_service".
    /// </summary>
    [MaxLength(100)]
    public string ConsentType { get; set; } = string.Empty;

    public bool IsGranted { get; set; }

    public DateTime? GrantedAt { get; set; }
    public DateTime? RevokedAt { get; set; }

    [MaxLength(50)]
    public string? IpAddress { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
