// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public sealed class EventAttendanceCreditClaim : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public long AttendanceId { get; set; }
    public int UserId { get; set; }
    public string ClaimType { get; set; } = string.Empty;
    public string IdempotencyKey { get; set; } = string.Empty;
    public string FundingSourceType { get; set; } = string.Empty;
    public int? FundingSourceId { get; set; }
    public int? PayerUserId { get; set; }
    public int? PayeeUserId { get; set; }
    public decimal Amount { get; set; }
    public string Unit { get; set; } = "time_credit";
    public string Status { get; set; } = "pending";
    public long? TransactionId { get; set; }
    public long? ParentClaimId { get; set; }
    public string? FailureCode { get; set; }
    public string? ReversalCode { get; set; }
    public string Metadata { get; set; } = "{}";
    public DateTime? ClaimedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime? FailedAt { get; set; }
    public DateTime? ReversedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventAnalyticsOptionalFact : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public string? OccurrenceKey { get; set; }
    public string Metric { get; set; } = string.Empty;
    public string DeduplicationHash { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty;
    public string? SubjectHash { get; set; }
    public string? PseudonymKeyVersion { get; set; }
    public long? ConsentRecordId { get; set; }
    public string? ConsentVersion { get; set; }
    public string SourceSurface { get; set; } = string.Empty;
    public string ClientPlatform { get; set; } = string.Empty;
    public string Dimensions { get; set; } = "{}";
    public bool IsLate { get; set; }
    public DateTime OccurredAt { get; set; }
    public DateTime ReceivedAt { get; set; }
    public DateTime RetentionDueAt { get; set; }
    public string Status { get; set; } = "active";
    public DateTime? WithdrawnAt { get; set; }
}

public sealed class EventAnalyticsWithdrawalRun : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int ActorUserId { get; set; }
    public string IdempotencyHash { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty;
    public int ConsentCount { get; set; }
    public int FactCount { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventAnalyticsAccessAudit : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public int ActorUserId { get; set; }
    public string AccessScope { get; set; } = string.Empty;
    public string PurposeCode { get; set; } = string.Empty;
    public string QueryHash { get; set; } = string.Empty;
    public int ResultCount { get; set; }
    public int SuppressedCount { get; set; }
    public int PrivacyThreshold { get; set; } = 5;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
