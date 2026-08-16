// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// A volunteer's accessibility needs. Mirrors Laravel's
/// <c>vol_accessibility_needs</c>.
///
/// 🔴 Why this exists (R-27). The React app has an accessibility-needs screen
/// and this backend had no table behind it, so the endpoint returned an empty
/// list: a volunteer could record what they need to take part, be told it was
/// saved, and have it silently discarded. For accessibility information that is
/// worse than not offering the feature — the member believes the organiser
/// knows, and the organiser never hears.
///
/// One row per (member, need type), matching Laravel's unique key, so recording
/// the same need twice updates rather than duplicates.
/// </summary>
public class VolunteerAccessibilityNeed : ITenantEntity
{
    /// <summary>Matches Laravel's enum on <c>need_type</c>.</summary>
    public static class NeedTypes
    {
        public const string Mobility = "mobility";
        public const string Visual = "visual";
        public const string Hearing = "hearing";
        public const string Cognitive = "cognitive";
        public const string Dietary = "dietary";
        public const string Language = "language";
        public const string Other = "other";

        public static readonly string[] All =
            [Mobility, Visual, Hearing, Cognitive, Dietary, Language, Other];
    }

    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    [MaxLength(30)]
    public string NeedType { get; set; } = NeedTypes.Other;

    public string? Description { get; set; }
    public string? AccommodationsRequired { get; set; }

    [MaxLength(255)]
    public string? EmergencyContactName { get; set; }

    [MaxLength(50)]
    public string? EmergencyContactPhone { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}

/// <summary>
/// A volunteer's credential — vetting, first aid, safeguarding training and the
/// like. Mirrors Laravel's <c>vol_credentials</c>.
///
/// 🔴 Why this exists (R-27). The React app lists, uploads and deletes these,
/// and this backend had no table, so the list was always empty. A volunteer who
/// had uploaded their vetting saw nothing; a coordinator checking whether
/// someone is cleared to work with children saw nothing either. That is a
/// safeguarding control reading as "no records" rather than "not loaded".
///
/// <c>ExpiresAt</c> is a date, not a timestamp, matching Laravel: a certificate
/// expires on a day, not at an instant, and treating it as a timestamp makes the
/// expiry hour depend on the reader's time zone.
/// </summary>
public class VolunteerCredential : ITenantEntity
{
    public static class Statuses
    {
        public const string Pending = "pending";
        public const string Verified = "verified";
        public const string Rejected = "rejected";
        public const string Expired = "expired";

        public static readonly string[] All = [Pending, Verified, Rejected, Expired];
    }

    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>e.g. garda_vetting, dbs_check, first_aid, safeguarding.</summary>
    [MaxLength(100)]
    public string CredentialType { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? FileUrl { get; set; }

    [MaxLength(255)]
    public string? FileName { get; set; }

    [MaxLength(20)]
    public string Status { get; set; } = Statuses.Pending;

    public int? VerifiedBy { get; set; }
    public DateTime? VerifiedAt { get; set; }

    /// <summary>Date only — a certificate expires on a day, not at an instant.</summary>
    public DateOnly? ExpiresAt { get; set; }

    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public User? Verifier { get; set; }
}

/// <summary>
/// A review of a volunteering organisation or of a volunteer. Mirrors Laravel's
/// <c>vol_reviews</c>.
///
/// 🔴 Why this exists (R-27). The React app reads
/// <c>/v2/volunteering/reviews/organization/{id}</c> and this backend had no
/// table, so every organisation showed no reviews at all — indistinguishable
/// from a genuinely unreviewed organisation, which is exactly the wrong
/// impression to give someone deciding where to volunteer.
///
/// <c>Approved</c> defaults to true, matching Laravel: reviews are visible
/// unless moderated away, not held for approval.
/// </summary>
public class VolunteerReview : ITenantEntity
{
    public static class TargetTypes
    {
        public const string Organization = "organization";
        public const string User = "user";

        public static readonly string[] All = [Organization, User];
    }

    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ReviewerId { get; set; }

    [MaxLength(20)]
    public string TargetType { get; set; } = TargetTypes.Organization;

    public int TargetId { get; set; }

    /// <summary>1–5. Enforced by a check constraint as well as by validation.</summary>
    public int Rating { get; set; }

    public string? Comment { get; set; }

    public bool Approved { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public User? Reviewer { get; set; }
}
