// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Partner venue — a local business or community space that records member
/// engagement via the member pass QR. Laravel parity subsystem (tables
/// partner_venues / partner_member_passes / partner_venue_visits, shipped
/// 2026-08-01). Engagement only: the platform issues no coupon and applies no
/// discount here.
/// </summary>
public class PartnerVenue : ITenantEntity
{
    public const string StatusActive = "active";
    public const string StatusPaused = "paused";
    public const string StatusArchived = "archived";
    public static readonly string[] AllowedStatuses = [StatusActive, StatusPaused, StatusArchived];
    public static readonly string[] AllowedCategories = ["cafe", "shop", "leisure", "community", "other"];

    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Slug { get; set; }
    public string? Description { get; set; }
    public string? Category { get; set; }
    public string? OfferSummary { get; set; }
    public string? AddressLine { get; set; }
    public string? City { get; set; }
    public string? Postcode { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public string? Website { get; set; }
    public string? ContactEmail { get; set; }
    public string? LogoUrl { get; set; }
    public string Status { get; set; } = StatusActive;

    /// <summary>
    /// Reserved for venue-poster self-service check-in; not issued in v1
    /// (mirrors the Laravel column, which is likewise unfilled and hidden).
    /// </summary>
    public string? PosterToken { get; set; }

    public int? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? Creator { get; set; }
}

/// <summary>
/// A member's standing pass QR token. One row per (tenant, user); the token
/// rotates in place. 64 lowercase hex chars, globally unique, stored plain —
/// it is a bearer credential, which is why GDPR erasure deletes the row.
/// </summary>
public class PartnerMemberPass : ITenantEntity
{
    public const string StatusActive = "active";
    public const string StatusRevoked = "revoked";

    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string Token { get; set; } = string.Empty;
    public string Status { get; set; } = StatusActive;
    public DateTime? LastUsedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}

/// <summary>
/// One recorded engagement. The unique key (tenant, venue, user, visited_on)
/// is load-bearing: it is both the idempotency key and the one-per-day
/// anti-gaming ceiling, enforced by the database rather than application code.
/// </summary>
public class PartnerVenueVisit : ITenantEntity
{
    public const string SourceMemberPass = "member_pass";

    public long Id { get; set; }
    public int TenantId { get; set; }
    public int VenueId { get; set; }

    /// <summary>Member whose engagement is recorded.</summary>
    public int UserId { get; set; }

    /// <summary>Venue staff account that recorded the visit.</summary>
    public int? RecordedByUserId { get; set; }

    public string Source { get; set; } = SourceMemberPass;
    public DateOnly VisitedOn { get; set; }
    public DateTime? VisitedAt { get; set; }
    public string? Metadata { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public PartnerVenue? Venue { get; set; }
    public User? User { get; set; }
    public User? RecordedByUser { get; set; }
}

/// <summary>
/// Venue staff roster. Laravel stores this in the shared org_members pivot
/// with org_type='partner_venue'; here it is a dedicated table because the
/// ASP.NET org_members mapping hard-pins org_type='volunteer' and carries a
/// composite FK to vol_organizations. The externally observable contract
/// (roster shapes, who may record visits) is identical; the storage choice is
/// internal and recorded in the parity docs. ANY active row grants the right
/// to record visits — the role value carries no extra privilege.
/// </summary>
public class PartnerVenueStaffMember : ITenantEntity
{
    public static readonly string[] AllowedRoles = ["owner", "admin", "member"];

    public int Id { get; set; }
    public int TenantId { get; set; }
    public int VenueId { get; set; }
    public int UserId { get; set; }
    public string Role { get; set; } = "member";
    public string Status { get; set; } = "active";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public PartnerVenue? Venue { get; set; }
    public User? User { get; set; }
}
