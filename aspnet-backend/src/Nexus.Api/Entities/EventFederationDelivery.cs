// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace Nexus.Api.Entities;

public sealed class EventFederationDelivery : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public int ExternalPartnerId { get; set; }
    public short PayloadSchemaVersion { get; set; } = 1;
    public long EventAggregateVersion { get; set; }
    public long EventCalendarVersion { get; set; }
    public string Action { get; set; } = "upsert";
    public string IdempotencyKey { get; set; } = string.Empty;
    public string PayloadHash { get; set; } = string.Empty;
    public string Payload { get; set; } = "{}";
    public string Status { get; set; } = "pending";
    public short Attempts { get; set; }
    public DateTime? AvailableAt { get; set; }
    public DateTime? NextAttemptAt { get; set; }
    public Guid? ClaimToken { get; set; }
    public DateTime? ClaimedAt { get; set; }
    public DateTime? LastAttemptAt { get; set; }
    public DateTime? DeliveredAt { get; set; }
    public DateTime? DeadLetteredAt { get; set; }
    public string? LastErrorCode { get; set; }
    public string? LastError { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
