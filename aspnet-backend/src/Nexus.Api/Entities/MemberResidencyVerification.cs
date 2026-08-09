// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Tenant-scoped member residency declaration and coordinator attestation.
/// Mirrors Laravel's member_residency_verifications table.
/// </summary>
public sealed class MemberResidencyVerification : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string DeclaredMunicipality { get; set; } = string.Empty;
    public string DeclaredPostcode { get; set; } = string.Empty;
    public string? DeclaredAddress { get; set; }
    public string? EvidenceNote { get; set; }
    public string Status { get; set; } = "pending";
    public int? AttestedBy { get; set; }
    public DateTime? AttestedAt { get; set; }
    public string? RejectionReason { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
