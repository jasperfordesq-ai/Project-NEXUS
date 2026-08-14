// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// A prepared support action awaiting the supported member's answer —
/// Laravel parity for support_pending_actions (shipped 2026-08-06). The
/// supporter (co_decide tier) prepares; the supported member confirms in-app
/// or via a single-use emailed token, declines, or lets it expire. Only on
/// confirmation does anything execute, with the supporter recorded as
/// acting_user_id on the resulting row.
///
/// Token design copies event_guardian_consents: only a SHA-256 hash is
/// stored, the token is single-use (TokenConsumedAt), and it expires.
/// PendingMessageRelationshipId is a nullable-unique mirror of RelationshipId
/// held only while a message-access ask is pending — the database-level
/// guarantee of one open ask per relationship — and is nulled on every exit
/// transition.
/// </summary>
public class SupportPendingAction : ITenantEntity
{
    public const string StatusPending = "pending";
    public const string StatusConfirmed = "confirmed";
    public const string StatusDeclined = "declined";
    public const string StatusExpired = "expired";
    public const string StatusCancelled = "cancelled";

    public const string TypeListingCreate = "listing_create";
    public const string TypeCreditTransfer = "credit_transfer";
    public const string TypeMessageAccessGrant = "message_access_grant";

    /// <summary>action_type → the SupportTiers capability it consumes.</summary>
    public static readonly IReadOnlyDictionary<string, string> TypeCapabilities =
        new Dictionary<string, string>
        {
            [TypeListingCreate] = "listings",
            [TypeCreditTransfer] = "credits",
            [TypeMessageAccessGrant] = "messages",
        };

    public static readonly string[] AttestChannels = ["phone", "in_person", "paper"];
    public const int ExpiryDays = 14;

    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>The account_relationships row this action was prepared under.</summary>
    public int RelationshipId { get; set; }

    /// <summary>The member the action belongs to; owner of the listing/credits.</summary>
    public int SupportedUserId { get; set; }

    /// <summary>Who prepared it; becomes acting_user_id on execution.</summary>
    public int SupporterUserId { get; set; }

    public string ActionType { get; set; } = string.Empty;

    /// <summary>JSON: the prepared action exactly as the member endpoint would receive it.</summary>
    public string Payload { get; set; } = "{}";

    public string Status { get; set; } = StatusPending;

    /// <summary>SHA-256 of the single-use confirmation token; the token itself is never stored.</summary>
    public string TokenHash { get; set; } = string.Empty;

    public DateTime? TokenConsumedAt { get; set; }

    /// <summary>Unconfirmed actions expire rather than lingering.</summary>
    public DateTime ExpiresAt { get; set; }

    public DateTime? ConfirmedAt { get; set; }
    public DateTime? DeclinedAt { get; set; }
    public DateTime? CancelledAt { get; set; }

    /// <summary>in_app | email_token | attested_offline.</summary>
    public string? ConfirmedVia { get; set; }

    public int? AttestedByUserId { get; set; }
    public string? AttestedChannel { get; set; }
    public string? AttestedWitness { get; set; }

    /// <summary>Optional, NEVER required — requiring a reason is pressure to consent.</summary>
    public string? DeclineReason { get; set; }

    public string? ResponseIp { get; set; }
    public string? ResponseUserAgent { get; set; }

    /// <summary>Listing id / transaction id once executed.</summary>
    public int? ResultId { get; set; }

    public int? PendingMessageRelationshipId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public AccountRelationship? Relationship { get; set; }
    public User? SupportedUser { get; set; }
    public User? SupporterUser { get; set; }
}
