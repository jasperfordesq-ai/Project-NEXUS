// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// One tenant's configured safeguarding jurisdiction and current policy version.
/// TenantId is both the primary key and the tenant foreign key.
/// </summary>
public sealed class TenantSafeguardingSetting : ITenantEntity
{
    public int TenantId { get; set; }

    [MaxLength(40)]
    public string Jurisdiction { get; set; } = string.Empty;

    [MaxLength(64)]
    public string PolicyVersion { get; set; } = "1";

    public int? ConfiguredByUserId { get; set; }
    public DateTime ConfiguredAt { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? Configurer { get; set; }
}

/// <summary>
/// Metadata-only community safeguarding decision for one member, purpose, and scope.
/// Certificate references, documents, issue dates, and other evidence are prohibited.
/// </summary>
public sealed class MemberVettingAttestation : ITenantEntity
{
    public const string ConfirmedDecision = "confirmed";
    public const string RevokedDecision = "revoked";

    public long Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    [MaxLength(64)]
    public string SchemeCode { get; set; } = string.Empty;

    [MaxLength(64)]
    public string AttestationCode { get; set; } = string.Empty;

    [MaxLength(64)]
    public string PurposeCode { get; set; } = string.Empty;

    [MaxLength(32)]
    public string ScopeType { get; set; } = "tenant";

    [MaxLength(191)]
    public string ScopeIdentifier { get; set; } = string.Empty;

    [MaxLength(20)]
    public string Decision { get; set; } = string.Empty;

    public int? ConfirmedByUserId { get; set; }
    public DateTime? ConfirmedAt { get; set; }
    public int? RevokedByUserId { get; set; }
    public DateTime? RevokedAt { get; set; }

    [MaxLength(64)]
    public string? RevocationReasonCode { get; set; }

    [MaxLength(64)]
    public string PolicyVersion { get; set; } = "1";

    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? Member { get; set; }
    public User? Confirmer { get; set; }
    public User? Revoker { get; set; }
    public ICollection<MemberVettingAttestationEvent> Events { get; set; } = new List<MemberVettingAttestationEvent>();
}

/// <summary>
/// Append-only metadata history for safeguarding attestation decisions.
/// </summary>
public sealed class MemberVettingAttestationEvent : ITenantEntity
{
    public long Id { get; set; }
    public long AttestationId { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    [MaxLength(64)]
    public string SchemeCode { get; set; } = string.Empty;

    [MaxLength(64)]
    public string AttestationCode { get; set; } = string.Empty;

    [MaxLength(64)]
    public string PurposeCode { get; set; } = string.Empty;

    [MaxLength(32)]
    public string ScopeType { get; set; } = string.Empty;

    [MaxLength(191)]
    public string ScopeIdentifier { get; set; } = string.Empty;

    [MaxLength(32)]
    public string EventType { get; set; } = string.Empty;

    [MaxLength(20)]
    public string? DecisionBefore { get; set; }

    [MaxLength(20)]
    public string DecisionAfter { get; set; } = string.Empty;

    [MaxLength(64)]
    public string? ReasonCode { get; set; }

    public int? ActorUserId { get; set; }

    [MaxLength(64)]
    public string PolicyVersion { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; }

    public MemberVettingAttestation? Attestation { get; set; }
    public Tenant? Tenant { get; set; }
    public User? Member { get; set; }
    public User? Actor { get; set; }
}

public sealed class SafeguardingVettingReviewRequest : ITenantEntity
{
    public const string PendingStatus = "pending";
    public const string CompletedStatus = "completed";
    public const string CancelledStatus = "cancelled";
    public const string MemberRequestSource = "member_request";

    public long Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    [MaxLength(40)]
    public string Jurisdiction { get; set; } = string.Empty;

    [MaxLength(64)]
    public string SchemeCode { get; set; } = string.Empty;

    [MaxLength(64)]
    public string AttestationCode { get; set; } = string.Empty;

    [MaxLength(64)]
    public string PurposeCode { get; set; } = string.Empty;

    [MaxLength(32)]
    public string ScopeType { get; set; } = "tenant";

    [MaxLength(191)]
    public string ScopeIdentifier { get; set; } = string.Empty;

    [MaxLength(64)]
    public string PolicyVersion { get; set; } = string.Empty;

    [MaxLength(20)]
    public string Status { get; set; } = PendingStatus;

    [MaxLength(32)]
    public string RequestSource { get; set; } = MemberRequestSource;

    public int? RequestedByUserId { get; set; }
    public DateTime RequestedAt { get; set; }
    public int? HandledByUserId { get; set; }
    public DateTime? HandledAt { get; set; }

    [MaxLength(64)]
    public string? ResolutionCode { get; set; }

    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? Member { get; set; }
    public User? Requester { get; set; }
    public User? Handler { get; set; }
}

/// <summary>
/// Append-only audit record for a tenant safeguarding policy-version rotation.
/// </summary>
public sealed class SafeguardingPolicyRotationEvent : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }

    [MaxLength(40)]
    public string Jurisdiction { get; set; } = string.Empty;

    [MaxLength(64)]
    public string SchemeCode { get; set; } = string.Empty;

    [MaxLength(64)]
    public string AttestationCode { get; set; } = string.Empty;

    [MaxLength(64)]
    public string PurposeCode { get; set; } = string.Empty;

    [MaxLength(32)]
    public string ScopeType { get; set; } = string.Empty;

    [MaxLength(191)]
    public string ScopeIdentifier { get; set; } = string.Empty;

    [MaxLength(64)]
    public string PreviousPolicyVersion { get; set; } = string.Empty;

    [MaxLength(64)]
    public string NewPolicyVersion { get; set; } = string.Empty;

    [MaxLength(64)]
    public string ReasonCode { get; set; } = string.Empty;

    public int? ActorUserId { get; set; }
    public int AffectedMemberCount { get; set; }
    public DateTime CreatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? Actor { get; set; }
}
