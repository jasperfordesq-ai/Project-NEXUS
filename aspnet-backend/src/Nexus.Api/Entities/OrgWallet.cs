// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Organisation wallet for holding time credits. Tenant-scoped.
/// Separate from personal wallets - org wallets can receive donations and fund org activities.
/// </summary>
public class OrgWallet : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public int OrganisationId { get; set; }

    public decimal Balance { get; set; } = 0;
    public decimal TotalReceived { get; set; } = 0;
    public decimal TotalSpent { get; set; } = 0;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public Organisation? Organisation { get; set; }
}

/// <summary>
/// Transaction on an organisation wallet. Tenant-scoped.
/// </summary>
public class OrgWalletTransaction : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public int OrgWalletId { get; set; }

    /// <summary>
    /// credit or debit
    /// </summary>
    public string Type { get; set; } = "credit";

    public decimal Amount { get; set; }
    public decimal BalanceAfter { get; set; }

    /// <summary>
    /// donation, transfer, admin_grant, activity_spend, refund
    /// </summary>
    public string Category { get; set; } = "donation";

    public string? Description { get; set; }

    /// <summary>
    /// User who initiated the transaction.
    /// </summary>
    public int? InitiatedById { get; set; }

    /// <summary>
    /// If donation from personal wallet, the source user.
    /// </summary>
    public int? FromUserId { get; set; }

    /// <summary>
    /// If transfer to personal wallet, the target user.
    /// </summary>
    public int? ToUserId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public OrgWallet? OrgWallet { get; set; }
    public User? InitiatedBy { get; set; }
    public User? FromUser { get; set; }
    public User? ToUser { get; set; }
}
