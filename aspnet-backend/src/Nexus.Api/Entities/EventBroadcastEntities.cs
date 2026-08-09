// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace Nexus.Api.Entities;

public sealed class EventRegistration : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public int UserId { get; set; }
    public string CapacityPoolKey { get; set; } = "event";
    public string? AllocationKey { get; set; }
    public string RegistrationState { get; set; } = "confirmed";
    public long RegistrationVersion { get; set; } = 1;
    public int PartySize { get; set; } = 1;
    public DateTime StateChangedAt { get; set; } = DateTime.UtcNow;
    public int? StateChangedBy { get; set; }
    public DateTime? InvitedAt { get; set; }
    public DateTime? PendingAt { get; set; }
    public DateTime? ConfirmedAt { get; set; }
    public DateTime? DeclinedAt { get; set; }
    public DateTime? CancelledAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventWaitlistEntry : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public int UserId { get; set; }
    public string CapacityPoolKey { get; set; } = "event";
    public string? AllocationKey { get; set; }
    public string QueueState { get; set; } = "waiting";
    public long QueueVersion { get; set; } = 1;
    public long QueueSequence { get; set; }
    public DateTime StateChangedAt { get; set; } = DateTime.UtcNow;
    public int? StateChangedBy { get; set; }
    public DateTime? OfferedAt { get; set; }
    public DateTime? OfferExpiresAt { get; set; }
    public string? OfferTokenHash { get; set; }
    public DateTime? OfferTokenUsedAt { get; set; }
    public DateTime? AcceptedAt { get; set; }
    public long? AcceptedRegistrationId { get; set; }
    public DateTime? ExpiredAt { get; set; }
    public DateTime? CancelledAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventRegistrationHistory : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public long RegistrationId { get; set; }
    public int UserId { get; set; }
    public int? ActorUserId { get; set; }
    public string CapacityPoolKey { get; set; } = "event";
    public string? AllocationKey { get; set; }
    public long RegistrationVersion { get; set; }
    public string Action { get; set; } = string.Empty;
    public string? FromState { get; set; }
    public string ToState { get; set; } = string.Empty;
    public string IdempotencyKey { get; set; } = string.Empty;
    public string? Reason { get; set; }
    public string Metadata { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventWaitlistEntryHistory : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public long WaitlistEntryId { get; set; }
    public int UserId { get; set; }
    public int? ActorUserId { get; set; }
    public string CapacityPoolKey { get; set; } = "event";
    public string? AllocationKey { get; set; }
    public long QueueVersion { get; set; }
    public long QueueSequence { get; set; }
    public string Action { get; set; } = string.Empty;
    public string? FromState { get; set; }
    public string ToState { get; set; } = string.Empty;
    public string IdempotencyKey { get; set; } = string.Empty;
    public string? Reason { get; set; }
    public string Metadata { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventAttendance : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public int UserId { get; set; }
    public string AttendanceStatus { get; set; } = "attended";
    public long AttendanceVersion { get; set; } = 1;
    public DateTime StatusChangedAt { get; set; } = DateTime.UtcNow;
    public int? StatusChangedBy { get; set; }
    public DateTime? CheckedInAt { get; set; }
    public int? CheckedInBy { get; set; }
    public DateTime? CheckedOutAt { get; set; }
    public decimal? HoursCredited { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventAttendanceActivity : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public long AttendanceId { get; set; }
    public int UserId { get; set; }
    public int ActorUserId { get; set; }
    public long AttendanceVersion { get; set; }
    public string Action { get; set; } = string.Empty;
    public string? FromStatus { get; set; }
    public string ToStatus { get; set; } = string.Empty;
    public string IdempotencyKey { get; set; } = string.Empty;
    public string? Reason { get; set; }
    public string Metadata { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventBroadcast : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public string Variant { get; set; } = "announcement";
    public string Status { get; set; } = "draft";
    public int BroadcastVersion { get; set; } = 1;
    public string AudienceSegments { get; set; } = "[]";
    public string Channels { get; set; } = "[]";
    public string Body { get; set; } = string.Empty;
    public string ContentHash { get; set; } = string.Empty;
    public DateTime? ScheduledAt { get; set; }
    public int RecipientCount { get; set; }
    public int DeliveryCount { get; set; }
    public int DeliveredCount { get; set; }
    public int SuppressedCount { get; set; }
    public int DeadLetterCount { get; set; }
    public int CreatedByUserId { get; set; }
    public int UpdatedByUserId { get; set; }
    public int? ScheduledByUserId { get; set; }
    public int? CancelledByUserId { get; set; }
    public DateTime? CancelledAt { get; set; }
    public DateTime? SentAt { get; set; }
    public DateTime? FailedAt { get; set; }
    public string? FailureCode { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventBroadcastHistory : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public long BroadcastId { get; set; }
    public int BroadcastVersion { get; set; }
    public string Action { get; set; } = string.Empty;
    public string? FromStatus { get; set; }
    public string ToStatus { get; set; } = string.Empty;
    public int? ActorUserId { get; set; }
    public string IdempotencyHash { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty;
    public string ContentHash { get; set; } = string.Empty;
    public string Metadata { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventBroadcastDelivery : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public long BroadcastId { get; set; }
    public int FrozenBroadcastVersion { get; set; }
    public int RecipientUserId { get; set; }
    public string Channel { get; set; } = string.Empty;
    public string DeliveryKey { get; set; } = string.Empty;
    public string Status { get; set; } = "pending";
    public int Attempts { get; set; }
    public DateTime AvailableAt { get; set; }
    public DateTime? NextAttemptAt { get; set; }
    public string? ClaimToken { get; set; }
    public DateTime? ClaimedAt { get; set; }
    public DateTime? DeliveredAt { get; set; }
    public DateTime? SuppressedAt { get; set; }
    public DateTime? DeadLetteredAt { get; set; }
    public DateTime? CancelledAt { get; set; }
    public string? PreferenceReason { get; set; }
    public string? SuppressionReason { get; set; }
    public string? Provider { get; set; }
    public string? ProviderEvidenceId { get; set; }
    public string? LastErrorCode { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventBroadcastDeliveryAttempt : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public long BroadcastId { get; set; }
    public long DeliveryId { get; set; }
    public int AttemptNumber { get; set; }
    public string Outcome { get; set; } = string.Empty;
    public string? Provider { get; set; }
    public string? ProviderEvidenceId { get; set; }
    public string? ReasonCode { get; set; }
    public string Metadata { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
