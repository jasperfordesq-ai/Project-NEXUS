// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// A carer/guardian support relationship — Laravel parity for the
/// account_relationships table (rebuilt on the platform 2026-08-06 under the
/// guardian three-tier redesign). ParentUserId is the SUPPORTER, ChildUserId
/// the SUPPORTED member. Authority lives in the Permissions JSON document
/// (legacy booleans + a "tiers" object, resolved by SupportTiers) — a
/// relationship row is never authorisation by itself.
///
/// Supersedes the weaker sub_accounts model for the /users/me/sub-accounts
/// contract; the legacy sub_accounts table remains only behind the deprecated
/// /api/sub-accounts CRUD.
/// </summary>
public class AccountRelationship : ITenantEntity
{
    public const string StatusActive = "active";
    public const string StatusPending = "pending";
    public const string StatusRevoked = "revoked";
    public static readonly string[] RelationshipTypes = ["family", "guardian", "carer", "organization"];
    public const int MaxChildren = 20;

    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>The supporter (carer/guardian).</summary>
    public int ParentUserId { get; set; }

    /// <summary>The supported member; only they can expand authority.</summary>
    public int ChildUserId { get; set; }

    public string RelationshipType { get; set; } = "family";

    /// <summary>
    /// JSON: {"can_view_activity":bool,"can_manage_listings":bool,
    /// "can_transact":bool,"can_view_messages":false,"tiers":{...}} — always
    /// written as SupportTiers.ToLegacyBooleans(tiers) + tiers.
    /// </summary>
    public string? Permissions { get; set; }

    public string Status { get; set; } = StatusPending;

    /// <summary>Staff member who proposed this relationship; NULL = member-initiated.</summary>
    public int? ProposedByUserId { get; set; }

    public string? StaffNotes { get; set; }
    public DateTime? ApprovedAt { get; set; }

    /// <summary>
    /// Mirror column only — real authority is tiers["messages"]; this exists
    /// so the counterparty-notice query can be indexed.
    /// </summary>
    public DateTime? MessageAccessGrantedAt { get; set; }

    public DateTime? DeclinedAt { get; set; }
    public DateTime? WithdrawnAt { get; set; }

    /// <summary>The answering member's own words — optional, never mandatory.</summary>
    public string? ResponseReason { get; set; }

    public int? SafeguardingAssignmentId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? ParentUser { get; set; }
    public User? ChildUser { get; set; }
}

/// <summary>
/// Append-only relationship history — Laravel account_relationship_events.
/// A database trigger refuses UPDATE, so the trail cannot be rewritten.
/// </summary>
public class AccountRelationshipEvent : ITenantEntity
{
    public static readonly string[] Actions =
        ["requested", "proposed", "approved", "declined", "withdrawn", "revoked", "permissions_changed"];
    public static readonly string[] ActorRoles = ["member", "staff", "system"];

    public long Id { get; set; }
    public int TenantId { get; set; }
    public int RelationshipId { get; set; }
    public int ParentUserId { get; set; }
    public int ChildUserId { get; set; }
    public string Action { get; set; } = string.Empty;
    public string ActorRole { get; set; } = "member";
    public int? ActorUserId { get; set; }
    public string? Reason { get; set; }

    /// <summary>JSON, e.g. tiers before/after on permissions_changed.</summary>
    public string? Details { get; set; }

    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
}
