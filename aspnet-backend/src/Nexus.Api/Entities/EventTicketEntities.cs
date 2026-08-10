// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace Nexus.Api.Entities;

public sealed class EventTicketType : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public string OccurrenceKey { get; set; } = string.Empty;
    public long Version { get; set; } = 1;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Kind { get; set; } = "free";
    public decimal UnitPriceCredits { get; set; }
    public int AllocationLimit { get; set; }
    public DateTime SalesOpensAt { get; set; }
    public DateTime SalesClosesAt { get; set; }
    public DateTime EventStartsAtSnapshot { get; set; }
    public string EventTimezoneSnapshot { get; set; } = "UTC";
    public int PerMemberLimit { get; set; }
    public string EligibilityPolicy { get; set; } = "{}";
    public DateTime? RefundCutoffAt { get; set; }
    public bool OrganizerCancelRefundable { get; set; }
    public string Status { get; set; } = "draft";
    public int CreatedBy { get; set; }
    public int UpdatedBy { get; set; }
    public int? ActivatedBy { get; set; }
    public DateTime? ActivatedAt { get; set; }
    public int? PausedBy { get; set; }
    public DateTime? PausedAt { get; set; }
    public int? ArchivedBy { get; set; }
    public DateTime? ArchivedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventTicketTypeHistory : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public long TicketTypeId { get; set; }
    public long TicketVersion { get; set; }
    public string Action { get; set; } = string.Empty;
    public int ActorUserId { get; set; }
    public string IdempotencyHash { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty;
    public string ChangedFields { get; set; } = "{}";
    public string? Reason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventTicketEntitlement : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public long TicketTypeId { get; set; }
    public long RegistrationId { get; set; }
    public int UserId { get; set; }
    public int Units { get; set; }
    public string TicketKindSnapshot { get; set; } = "free";
    public decimal UnitPriceCreditsSnapshot { get; set; }
    public decimal TotalPriceCreditsSnapshot { get; set; }
    public string Status { get; set; } = "confirmed";
    public long Version { get; set; } = 1;
    public int CreatedBy { get; set; }
    public string AllocationIdempotencyHash { get; set; } = string.Empty;
    public string AllocationRequestHash { get; set; } = string.Empty;
    public DateTime ConfirmedAt { get; set; } = DateTime.UtcNow;
    public int? CancelledBy { get; set; }
    public string? CancellationReason { get; set; }
    public DateTime? CancelledAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventTicketEntitlementHistory : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public long TicketTypeId { get; set; }
    public long EntitlementId { get; set; }
    public long RegistrationId { get; set; }
    public int UserId { get; set; }
    public long EntitlementVersion { get; set; }
    public string Action { get; set; } = string.Empty;
    public int Units { get; set; }
    public string TicketKindSnapshot { get; set; } = "free";
    public decimal UnitPriceCreditsSnapshot { get; set; }
    public decimal TotalPriceCreditsSnapshot { get; set; }
    public int ActorUserId { get; set; }
    public string IdempotencyHash { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty;
    public string? Reason { get; set; }
    public string Metadata { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventTicketInventoryHistory : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public long TicketTypeId { get; set; }
    public long EntitlementId { get; set; }
    public long EntitlementVersion { get; set; }
    public string Action { get; set; } = string.Empty;
    public int QuantityDelta { get; set; }
    public int ConfirmedUnitsAfter { get; set; }
    public int ActorUserId { get; set; }
    public string IdempotencyHash { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
