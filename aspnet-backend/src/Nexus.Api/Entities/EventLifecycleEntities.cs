// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace Nexus.Api.Entities;

public sealed class EventStatusHistory : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public int ActorUserId { get; set; }
    public long LifecycleVersion { get; set; }
    public string FromPublicationStatus { get; set; } = string.Empty;
    public string ToPublicationStatus { get; set; } = string.Empty;
    public string FromOperationalStatus { get; set; } = string.Empty;
    public string ToOperationalStatus { get; set; } = string.Empty;
    public string FromLegacyStatus { get; set; } = string.Empty;
    public string ToLegacyStatus { get; set; } = string.Empty;
    public string? Reason { get; set; }
    public string Metadata { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventDomainOutbox : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public string AggregateStream { get; set; } = "lifecycle";
    public long AggregateVersion { get; set; }
    public string Action { get; set; } = "event.lifecycle.transitioned";
    public string IdempotencyKey { get; set; } = string.Empty;
    public string ProductionMode { get; set; } = "direct";
    public string Status { get; set; } = "direct";
    public string Payload { get; set; } = "{}";
    public DateTime? AvailableAt { get; set; }
    public Guid? ClaimToken { get; set; }
    public DateTime? ClaimedAt { get; set; }
    public short Attempts { get; set; }
    public DateTime? NextAttemptAt { get; set; }
    public DateTime? ProcessedAt { get; set; }
    public DateTime? DeadLetteredAt { get; set; }
    public string? LastError { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Canonical moderation queue row shared by event publication and the admin
/// moderation workspace. Event submission keeps one pending row per event.
/// </summary>
public sealed class ContentModerationQueue : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public string ContentType { get; set; } = string.Empty;
    public int ContentId { get; set; }
    public int AuthorId { get; set; }
    public string? Title { get; set; }
    public string Status { get; set; } = "pending";
    public int? ReviewerId { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public string? RejectionReason { get; set; }
    public bool AutoFlagged { get; set; }
    public string? FlagReason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}
