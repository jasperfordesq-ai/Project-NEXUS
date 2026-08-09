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
    Expired
}
