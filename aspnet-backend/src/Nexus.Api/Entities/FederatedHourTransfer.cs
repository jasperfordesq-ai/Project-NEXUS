// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Phase 68 — federated hour transfer between this tenant and a federation
/// partner. Each transfer has a local-side ledger entry and (for the
/// Outbound direction) a corresponding remote-side request.
///
/// Distinct from <see cref="FederatedExchange"/>: an exchange tracks the
/// social/match between two users; an hour transfer tracks the credit move
/// itself. One exchange can produce zero or one transfer.
/// </summary>
public class FederatedHourTransfer : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>The partner this transfer is with.</summary>
    public int PartnerId { get; set; }

    /// <summary>
    /// Outbound = this tenant is sending hours to the partner.
    /// Inbound = this tenant is receiving hours from the partner.
    /// </summary>
    public FederatedTransferDirection Direction { get; set; }

    /// <summary>Local user participating (sender if Outbound, receiver if Inbound).</summary>
    public int LocalUserId { get; set; }

    [MaxLength(200)]
    public string? RemoteUserExternalId { get; set; }

    [MaxLength(255)]
    public string? RemoteUserDisplayName { get; set; }

    public decimal Amount { get; set; }

    /// <summary>
    /// Remote credit-protocol token reference. CreditCommons uses
    /// <c>"&lt;node&gt;/&lt;id&gt;"</c>; Komunitin uses a transfer URL.
    /// </summary>
    [MaxLength(500)]
    public string? ExternalReference { get; set; }

    /// <summary>
    /// Which protocol this transfer used, e.g. "credit-commons", "komunitin",
    /// "native". Stored as a string for forward compatibility.
    /// </summary>
    [MaxLength(50)]
    public string Protocol { get; set; } = "native";

    public FederatedTransferStatus Status { get; set; } = FederatedTransferStatus.Pending;

    /// <summary>
    /// Local <c>Transactions.Id</c> created when this transfer is reconciled
    /// to the local wallet. Null until reconciled.
    /// </summary>
    public int? LocalTransactionId { get; set; }

    [MaxLength(500)]
    public string? Description { get; set; }

    /// <summary>
    /// Last reconciliation attempt — the cron that polls remote status writes
    /// this so we can rate-limit retries and surface stuck transfers in the
    /// admin federation dashboard.
    /// </summary>
    public DateTime? LastReconcileAttemptAt { get; set; }
    public DateTime? ReconciledAt { get; set; }

    [MaxLength(500)]
    public string? FailureReason { get; set; }

    public int RetryCount { get; set; } = 0;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public FederationPartner? Partner { get; set; }
}

public enum FederatedTransferDirection
{
    Outbound = 0,
    Inbound = 1
}

public enum FederatedTransferStatus
{
    /// <summary>Created locally; not yet sent to partner.</summary>
    Pending = 0,
    /// <summary>Sent to partner; awaiting their acknowledgement.</summary>
    Sent = 1,
    /// <summary>Partner acknowledged; awaiting final settlement.</summary>
    Acknowledged = 2,
    /// <summary>Settled on both sides; local Transaction created.</summary>
    Reconciled = 3,
    /// <summary>Partner rejected the transfer.</summary>
    Rejected = 4,
    /// <summary>Reconciliation gave up after too many failures.</summary>
    Failed = 5,
    /// <summary>Cancelled by either side before settlement.</summary>
    Cancelled = 6
}
