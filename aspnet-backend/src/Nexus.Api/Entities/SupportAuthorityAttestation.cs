// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Staff record that a formal authority document (ADMCA 2015 / EPA vocabulary)
/// was SIGHTED for a represent-tier relationship — Laravel parity for
/// support_authority_attestations. An attestation is a record, never
/// authorisation: nothing anywhere grants power because of it; the represent
/// tier itself remains granted only by the supported member. One row per
/// (tenant, relationship, authority_type) — re-attestation reuses the row.
/// Free text is encrypted at rest and private notes are never returned.
/// </summary>
public class SupportAuthorityAttestation : ITenantEntity
{
    public static readonly string[] AuthorityTypes =
        ["dmr_court_order", "power_of_attorney", "edm_assistant_agreement", "co_decision_agreement"];

    public static readonly string[] RevocationReasonCodes =
        ["authority_ended", "superseded", "entered_in_error", "expired", "other_documented"];

    public const string PolicyVersionCurrent = "1";

    public long Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>The account_relationships row this authority claim is about.</summary>
    public int RelationshipId { get; set; }

    /// <summary>Denormalised for member-history queries, like vetting user_id.</summary>
    public int SupportedUserId { get; set; }

    public string AuthorityType { get; set; } = string.Empty;

    /// <summary>Staff explicitly acknowledged they sighted the authority; never inferred.</summary>
    public bool AcknowledgedSighted { get; set; }

    /// <summary>What the authority covers, in staff words — encrypted at rest.</summary>
    public string? ScopeSummaryEncrypted { get; set; }

    public string? PrivateNotesEncrypted { get; set; }

    /// <summary>active | revoked.</summary>
    public string Decision { get; set; } = "active";

    /// <summary>Staff member who attested; NULL only after account deletion.</summary>
    public int? AttestedBy { get; set; }

    public DateTime? AttestedAt { get; set; }
    public int? RevokedBy { get; set; }
    public DateTime? RevokedAt { get; set; }

    /// <summary>Closed vocabulary — see RevocationReasonCodes.</summary>
    public string? RevocationReasonCode { get; set; }

    public string PolicyVersion { get; set; } = PolicyVersionCurrent;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public AccountRelationship? Relationship { get; set; }
    public User? SupportedUser { get; set; }
}

/// <summary>
/// Append-only attestation history (attested | re_attested | revoked) —
/// a database trigger refuses UPDATE and DELETE.
/// </summary>
public class SupportAuthorityAttestationEvent : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public long AttestationId { get; set; }
    public int RelationshipId { get; set; }
    public int SupportedUserId { get; set; }
    public string EventType { get; set; } = string.Empty;
    public string? DecisionBefore { get; set; }
    public string DecisionAfter { get; set; } = string.Empty;
    public string? ReasonCode { get; set; }
    public int? ActorUserId { get; set; }
    public string PolicyVersion { get; set; } = SupportAuthorityAttestation.PolicyVersionCurrent;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public SupportAuthorityAttestation? Attestation { get; set; }
}
