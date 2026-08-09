// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Insurance certificate tracking for members. Tenant-scoped.
/// Tracks professional indemnity, public liability, etc.
/// </summary>
public class InsuranceCertificate : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// Type: professional_indemnity, public_liability, employers_liability, other
    /// </summary>
    public string Type { get; set; } = "other";

    public string? Provider { get; set; }
    public string? PolicyNumber { get; set; }
    public decimal? CoverAmount { get; set; }

    public DateTime StartDate { get; set; }
    public DateTime ExpiryDate { get; set; }

    /// <summary>
    /// URL or file reference to the uploaded certificate.
    /// </summary>
    public string? DocumentUrl { get; set; }

    /// <summary>
    /// pending, verified, expired, rejected
    /// </summary>
    public string Status { get; set; } = "pending";

    public int? VerifiedById { get; set; }
    public DateTime? VerifiedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public User? VerifiedBy { get; set; }
}
