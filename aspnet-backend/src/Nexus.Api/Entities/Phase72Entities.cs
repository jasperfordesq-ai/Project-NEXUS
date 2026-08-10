// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Phase 72 — long-tail entities.
 *
 *   - MoneyDonation       : fiat (Stripe) donation. Distinct from CreditDonation
 *                           which moves time-credits internally.
 *   - Bookmark            : generic save of any content type (listing, event,
 *                           blog post, group, user, etc.). Distinct from the
 *                           pre-existing FeedBookmark which is feed-post only.
 *   - BookmarkCollection  : named user-owned bucket of bookmarks.
 *   - PeerEndorsement     : "I vouch for this person" general endorsement.
 *                           Distinct from the pre-existing Endorsement entity
 *                           which is skill-specific (UserSkill endorsement).
 *   - UserPresence        : per-user last-seen + online indicator. Lightweight
 *                           heartbeat row updated by frontend.
 */

using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

namespace Nexus.Api.Entities;

// ─── MoneyDonation (Stripe) ──────────────────────────────────────────────────

public enum MoneyDonationStatus
{
    Pending = 0,
    Succeeded = 1,
    Failed = 2,
    Refunded = 3,
    Cancelled = 4
}

public class MoneyDonation : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>Optional — null for anonymous donations.</summary>
    public int? DonorUserId { get; set; }

    /// <summary>Cleartext donor name for display + receipt (anonymous fine).</summary>
    [MaxLength(200)]
    public string? DonorDisplayName { get; set; }

    /// <summary>Email captured for the receipt; required if DonorUserId is null.</summary>
    [MaxLength(255)]
    public string? DonorEmail { get; set; }

    /// <summary>Amount in the smallest currency unit (cents). Stripe convention.</summary>
    public long AmountMinorUnits { get; set; }

    [Required, MaxLength(3)]
    public string Currency { get; set; } = "EUR";

    [MaxLength(500)]
    public string? Message { get; set; }

    /// <summary>Stripe Checkout Session id (cs_...) returned at session creation.</summary>
    [MaxLength(200)]
    public string? StripeCheckoutSessionId { get; set; }

    /// <summary>Stripe PaymentIntent id (pi_...) populated when payment_intent.succeeded fires.</summary>
    [MaxLength(200)]
    public string? StripePaymentIntentId { get; set; }

    /// <summary>
    /// Top-level Stripe event id (evt_...) of the webhook that last advanced
    /// this donation. Used for idempotent webhook dedup — Stripe retries the
    /// same evt_ id on delivery failure, and our handler must not double-apply.
    /// Filtered-unique index ensures the second delivery is a no-op.
    /// </summary>
    [MaxLength(200)]
    public string? StripeWebhookEventId { get; set; }

    public MoneyDonationStatus Status { get; set; } = MoneyDonationStatus.Pending;

    [MaxLength(500)]
    public string? FailureReason { get; set; }

    public DateTime? CompletedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}

// ─── Bookmark (generic) + BookmarkCollection ────────────────────────────────

public enum BookmarkContentType
{
    Listing = 0,
    Event = 1,
    Group = 2,
    BlogPost = 3,
    User = 4,
    Resource = 5,
    Job = 6,
    Post = 7,
    Discussion = 8
}

[Index(nameof(TenantId), nameof(UserId), nameof(ContentType), nameof(ContentId), IsUnique = true)]
public class Bookmark : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    public BookmarkContentType ContentType { get; set; }
    public int ContentId { get; set; }

    /// <summary>Optional collection bucket; null = "Saved" default bucket.</summary>
    public int? CollectionId { get; set; }

    /// <summary>Optional user-supplied note about why they saved this.</summary>
    [MaxLength(1000)]
    public string? Note { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public BookmarkCollection? Collection { get; set; }
}

public class BookmarkCollection : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    [Required, MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? Description { get; set; }

    /// <summary>True = collection is visible on the user's public profile.</summary>
    public bool IsPublic { get; set; } = false;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public ICollection<Bookmark> Bookmarks { get; set; } = new List<Bookmark>();
}

// ─── PeerEndorsement (general "I vouch for this person") ────────────────────

[Index(nameof(TenantId), nameof(EndorserId), nameof(EndorsedUserId), IsUnique = true)]
public class PeerEndorsement : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public int EndorserId { get; set; }
    public int EndorsedUserId { get; set; }

    /// <summary>1–5 rating for the endorsed user's overall trustworthiness.</summary>
    public int Strength { get; set; } = 5;

    [MaxLength(1000)]
    public string? Comment { get; set; }

    /// <summary>Optional relationship label: "neighbour", "colleague", "friend".</summary>
    [MaxLength(100)]
    public string? Relationship { get; set; }

    /// <summary>True if either party flagged the endorsement and it was hidden.</summary>
    public bool IsHidden { get; set; } = false;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}

// ─── UserPresence (heartbeat + online indicator) ────────────────────────────

[Index(nameof(TenantId), nameof(UserId), IsUnique = true)]
public class UserPresence : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;

    /// <summary>"web", "ios", "android" — captured from the heartbeat call.</summary>
    [MaxLength(20)]
    public string? Platform { get; set; }

    /// <summary>
    /// User-set status: "online", "away", "do_not_disturb", "invisible".
    /// "invisible" makes the user appear offline in others' presence queries
    /// without losing the LastSeenAt heartbeat.
    /// </summary>
    [MaxLength(20)]
    public string Status { get; set; } = "online";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
