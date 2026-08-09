// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a credit donation to a community fund or another user.
/// Donations are backed by a real transaction for audit trail.
/// Phase 19: Expanded Wallet.
/// </summary>
public class CreditDonation : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The user who donated credits.
    /// </summary>
    public int DonorId { get; set; }

    /// <summary>
    /// The recipient user. Null means donated to the community fund.
    /// </summary>
    public int? RecipientId { get; set; }

    public decimal Amount { get; set; }

    [MaxLength(500)]
    public string? Message { get; set; }

    /// <summary>
    /// The underlying transaction that moved the credits.
    /// </summary>
    public int TransactionId { get; set; }

    /// <summary>
    /// Whether the donor's identity is hidden from the recipient.
    /// </summary>
    public bool IsAnonymous { get; set; } = false;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? Donor { get; set; }
    public User? Recipient { get; set; }
    public Transaction? Transaction { get; set; }
}
