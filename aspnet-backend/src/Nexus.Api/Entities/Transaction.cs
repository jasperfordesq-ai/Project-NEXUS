// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a time credit transaction between users.
/// Implements tenant isolation via ITenantEntity.
/// Uses optimistic concurrency via RowVersion to prevent concurrent modification issues.
/// </summary>
public class Transaction : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    // Laravel permits either ledger leg to be null for minted/burned credits.
    // Keeping those legs nullable also lets the .NET ledger represent volunteer
    // payouts and organisation deposits without inventing a fake user account.
    public int? SenderId { get; set; }
    public int? ReceiverId { get; set; }
    public decimal Amount { get; set; }
    public string? Description { get; set; }
    public string TransactionType { get; set; } = "transfer";
    public int? ListingId { get; set; }
    public int? VolunteerLogId { get; set; }
    public TransactionStatus Status { get; set; } = TransactionStatus.Completed;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Laravel's DELETE wallet-history contract hides the row independently for
    // each participant; it never changes financial status or balance effects.
    [JsonIgnore]
    public bool DeletedForSender { get; set; }

    [JsonIgnore]
    public bool DeletedForReceiver { get; set; }

    /// <summary>
    /// Optimistic concurrency token - automatically updated on each save.
    /// Prevents lost updates when concurrent transactions modify the same record.
    /// </summary>
    [Timestamp]
    public byte[]? RowVersion { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? Sender { get; set; }
    public User? Receiver { get; set; }
    public Listing? Listing { get; set; }
    public VolunteerLog? VolunteerLog { get; set; }
}

/// <summary>
/// Status of a transaction.
/// </summary>
public enum TransactionStatus
{
    Pending,
    Completed,
    Cancelled,
    Disputed,
    Refunded
}
