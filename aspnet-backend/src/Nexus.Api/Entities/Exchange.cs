// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a timebanking exchange between two users.
/// An exchange tracks the full lifecycle: request → accept → in-progress → complete → rate.
/// Credits are transferred automatically upon completion.
/// </summary>
public class Exchange : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The listing this exchange is based on.
    /// </summary>
    public int ListingId { get; set; }

    /// <summary>
    /// The user who initiated the exchange request.
    /// For an Offer listing, this is the person requesting the service.
    /// For a Request listing, this is the person offering to fulfill it.
    /// </summary>
    public int InitiatorId { get; set; }

    /// <summary>
    /// The user who owns the listing (the counterparty).
    /// </summary>
    public int ListingOwnerId { get; set; }

    /// <summary>
    /// The user providing the service (determined when exchange is accepted).
    /// </summary>
    public int? ProviderId { get; set; }

    /// <summary>
    /// The user receiving the service.
    /// </summary>
    public int? ReceiverId { get; set; }

    public ExchangeStatus Status { get; set; } = ExchangeStatus.Requested;

    /// <summary>
    /// Agreed hours for the exchange. Initially from listing's EstimatedHours,
    /// can be adjusted when accepted or completed.
    /// </summary>
    public decimal AgreedHours { get; set; }

    /// <summary>
    /// Actual hours worked, recorded at completion.
    /// </summary>
    public decimal? ActualHours { get; set; }

    /// <summary>
    /// Optional message from the initiator when requesting.
    /// </summary>
    public string? RequestMessage { get; set; }

    /// <summary>
    /// Optional message when declining or cancelling.
    /// </summary>
    public string? DeclineReason { get; set; }

    /// <summary>
    /// Optional notes added during the exchange.
    /// </summary>
    public string? Notes { get; set; }

    /// <summary>
    /// Scheduled date/time for the exchange to take place.
    /// </summary>
    public DateTime? ScheduledAt { get; set; }

    /// <summary>
    /// When the exchange was started (moved to InProgress).
    /// </summary>
    public DateTime? StartedAt { get; set; }

    /// <summary>
    /// When the exchange was completed.
    /// </summary>
    public DateTime? CompletedAt { get; set; }

    /// <summary>
    /// When the exchange was cancelled or declined.
    /// </summary>
    public DateTime? CancelledAt { get; set; }

    // ── Two-party hours confirmation ────────────────────────────────────────────
    // 🔴 These five columns are the whole reason an exchange could not settle here
    // until 2026-08-21. Laravel records each party's confirmation SEPARATELY and
    // moves credits only once both are present and agree, so a single
    // "confirmed" flag or a value stuffed into Notes cannot represent the state:
    // either would settle real credits on one person's word.
    //
    // Names, nullability and precision are copied from Laravel's committed schema
    // dump, `database/schema/mysql-schema.sql:8909-8917` (table `exchange_requests`):
    //   requester_confirmed_at    timestamp NULL DEFAULT NULL
    //   requester_confirmed_hours decimal(5,2) DEFAULT NULL
    //   provider_confirmed_at     timestamp NULL DEFAULT NULL
    //   provider_confirmed_hours  decimal(5,2) DEFAULT NULL
    //   final_hours               decimal(5,2) DEFAULT NULL  -- 'Agreed hours after confirmation'
    //
    // The React client reads all five by name (react-frontend/src/types/api.ts:1663-1667)
    // and gates the "Confirm Hours" button on the two timestamps
    // (pages/exchanges/ExchangeDetailPage.tsx:401-404).
    //
    // 🔴 Party mapping. Laravel's `requester_id` is the member who opened the
    // request and `provider_id` is the listing owner, regardless of listing type;
    // that maps to InitiatorId and ListingOwnerId here. It is NOT the same axis as
    // ProviderId/ReceiverId, which encode who does the work and therefore who pays
    // — that axis flips for a Request-type listing. Confusing the two moves credits
    // backwards, which is a bug Laravel already had and fixed
    // (ExchangeWorkflowService.php:1176-1194).

    /// <summary>
    /// When the requester (<see cref="InitiatorId"/>) confirmed the hours worked.
    /// </summary>
    public DateTime? RequesterConfirmedAt { get; set; }

    /// <summary>
    /// The hours the requester confirmed, after the tenant's variance clamp.
    /// </summary>
    public decimal? RequesterConfirmedHours { get; set; }

    /// <summary>
    /// When the provider (<see cref="ListingOwnerId"/>) confirmed the hours worked.
    /// </summary>
    public DateTime? ProviderConfirmedAt { get; set; }

    /// <summary>
    /// The hours the provider confirmed, after the tenant's variance clamp.
    /// </summary>
    public decimal? ProviderConfirmedHours { get; set; }

    /// <summary>
    /// The agreed hours actually settled, once both confirmations agree.
    /// Null until settlement; never written on a disputed or one-sided exchange.
    /// </summary>
    public decimal? FinalHours { get; set; }

    /// <summary>
    /// The transaction created when the exchange is completed.
    /// </summary>
    public int? TransactionId { get; set; }

    /// <summary>
    /// Group context - if this exchange happens within a group.
    /// </summary>
    public int? GroupId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    [Timestamp]
    public byte[]? RowVersion { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public Listing? Listing { get; set; }
    public User? Initiator { get; set; }
    public User? ListingOwner { get; set; }
    public User? Provider { get; set; }
    public User? Receiver { get; set; }
    public Transaction? Transaction { get; set; }
    public Group? Group { get; set; }
    public ICollection<ExchangeRating> Ratings { get; set; } = new List<ExchangeRating>();
}

/// <summary>
/// Exchange lifecycle states.
/// </summary>
public enum ExchangeStatus
{
    /// <summary>Exchange has been requested by the initiator.</summary>
    Requested,
    /// <summary>Listing owner has accepted the request.</summary>
    Accepted,
    /// <summary>Service is being performed.</summary>
    InProgress,
    /// <summary>Service has been completed and credits transferred.</summary>
    Completed,
    /// <summary>Exchange was declined by the listing owner.</summary>
    Declined,
    /// <summary>Exchange was cancelled by either party.</summary>
    Cancelled,
    /// <summary>Exchange is under dispute.</summary>
    Disputed,
    /// <summary>Dispute has been resolved.</summary>
    Resolved,
    /// <summary>Exchange expired without action.</summary>
    Expired,
    /// <summary>
    /// The provider has marked the work done; both parties must now confirm the
    /// hours before any credits move. Laravel's `pending_confirmation`.
    ///
    /// 🔴 Appended at the END of the enum on purpose. The value is persisted by
    /// NAME (WalletConfiguration.cs: <c>HasConversion&lt;string&gt;().HasMaxLength(20)</c>,
    /// and "PendingConfirmation" is 19 characters), so ordering does not affect
    /// stored rows — but inserting a member mid-enum would silently change every
    /// integer-persisted enum elsewhere that copies this pattern. Keep additions
    /// at the end.
    /// </summary>
    PendingConfirmation
}
