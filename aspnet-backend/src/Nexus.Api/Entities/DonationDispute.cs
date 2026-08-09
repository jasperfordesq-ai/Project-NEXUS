// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Durable Stripe dispute evidence for a fiat donation.
/// Mirrors Laravel's donation_disputes table.
/// </summary>
public sealed class DonationDispute : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public long? VolDonationId { get; set; }
    public string StripeDisputeId { get; set; } = string.Empty;
    public string? PaymentIntentId { get; set; }
    public string? ChargeId { get; set; }
    public int Amount { get; set; }
    public string Currency { get; set; } = "gbp";
    public string Status { get; set; } = "needs_response";
    public string? Reason { get; set; }
    public DateTime? EvidenceDueAt { get; set; }
    public string PaymentRoute { get; set; } = "platform_default";
    public string? StripeAccountId { get; set; }
    public string? PayloadJson { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
