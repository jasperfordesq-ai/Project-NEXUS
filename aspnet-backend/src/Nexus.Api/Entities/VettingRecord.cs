// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public class VettingRecord : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string VettingType { get; set; } = string.Empty;
    public string Status { get; set; } = "pending";
    public string? ReferenceNumber { get; set; }
    public DateTime? IssuedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public string? DocumentUrl { get; set; }
    public string? Notes { get; set; }
    public bool LegacySensitiveMetadataRedacted { get; set; }
    public int? VerifiedById { get; set; }
    public DateTime? VerifiedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public User? VerifiedBy { get; set; }
}
