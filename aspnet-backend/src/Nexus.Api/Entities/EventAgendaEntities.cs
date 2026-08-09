// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace Nexus.Api.Entities;

public sealed class EventSession : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public long Version { get; set; } = 1; public string Title { get; set; } = ""; public string? Description { get; set; }
    public string SessionType { get; set; } = "session"; public string Visibility { get; set; } = "public"; public int? Capacity { get; set; }
    public string Status { get; set; } = "scheduled"; public DateTime StartsAtUtc { get; set; } public DateTime EndsAtUtc { get; set; }
    public string Timezone { get; set; } = "UTC"; public string? TrackName { get; set; } public string? RoomName { get; set; }
    public string? RoomKey { get; set; } public int Position { get; set; } public string? CancellationReason { get; set; }
    public int CreatedBy { get; set; } public int UpdatedBy { get; set; } public int? CancelledBy { get; set; }
    public DateTime? CancelledAt { get; set; } public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public ICollection<EventSessionSpeaker> Speakers { get; set; } = new List<EventSessionSpeaker>();
    public ICollection<EventSessionResource> Resources { get; set; } = new List<EventSessionResource>();
}

public sealed class EventSessionSpeaker : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long SessionId { get; set; }
    public int? UserId { get; set; } public string? DisplayName { get; set; } public string? RoleLabel { get; set; } public int Position { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventSessionResource : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long SessionId { get; set; }
    public string ResourceType { get; set; } = "link"; public string Visibility { get; set; } = "public"; public string Title { get; set; } = "";
    public string UrlCiphertext { get; set; } = ""; public int Position { get; set; } public int CreatedBy { get; set; } public int UpdatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventSessionHistory : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long? SessionId { get; set; }
    public int ActorUserId { get; set; } public long AgendaVersion { get; set; } public string Action { get; set; } = "";
    public string IdempotencyKey { get; set; } = ""; public string RequestHash { get; set; } = ""; public string ChangedFields { get; set; } = "[]";
    public string AffectedSessionIds { get; set; } = "[]"; public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventSessionRegistration : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long SessionId { get; set; }
    public int UserId { get; set; } public long EventRegistrationId { get; set; } public long EventRegistrationVersion { get; set; }
    public long Version { get; set; } = 1; public string Status { get; set; } = "registered"; public DateTime RegisteredAt { get; set; }
    public DateTime? WithdrawnAt { get; set; } public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventSessionRegistrationHistory : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long SessionId { get; set; }
    public long RegistrationId { get; set; } public int UserId { get; set; } public long EventRegistrationId { get; set; }
    public long EventRegistrationVersion { get; set; } public int ActorUserId { get; set; } public long RegistrationVersion { get; set; }
    public string Action { get; set; } = ""; public string IdempotencyKey { get; set; } = ""; public string RequestHash { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventStaffAssignment : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public int UserId { get; set; }
    public string Role { get; set; } = "check_in_staff"; public string Status { get; set; } = "active"; public long AssignmentVersion { get; set; } = 1;
    public DateTime GrantedAt { get; set; } public int GrantedBy { get; set; } public DateTime? RevokedAt { get; set; } public int? RevokedBy { get; set; }
    public DateTime? ExpiresAt { get; set; } public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public ICollection<EventStaffAssignmentHistory> History { get; set; } = new List<EventStaffAssignmentHistory>();
}

public sealed class EventStaffAssignmentHistory : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long AssignmentId { get; set; }
    public int UserId { get; set; } public string Role { get; set; } = ""; public int ActorUserId { get; set; } public long AssignmentVersion { get; set; }
    public string Action { get; set; } = ""; public string? IdempotencyKey { get; set; } public string? FromStatus { get; set; } public string ToStatus { get; set; } = "";
    public DateTime? PreviousExpiresAt { get; set; } public DateTime? NewExpiresAt { get; set; } public string Metadata { get; set; } = "{}"; public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventCalendarFeedToken : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int UserId { get; set; }
    public string TokenHash { get; set; } = ""; public string TokenPrefix { get; set; } = ""; public string? Label { get; set; }
    public string Locale { get; set; } = "en"; public DateTime? LastUsedAt { get; set; } public DateTime? RevokedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventCheckinCredential : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public long RegistrationId { get; set; } public int UserId { get; set; } public int CredentialVersion { get; set; } = 1;
    public string Status { get; set; } = "active"; public string TokenHash { get; set; } = string.Empty; public string TokenFingerprint { get; set; } = string.Empty;
    public string IssueIdempotencyHash { get; set; } = string.Empty; public int IssuedByUserId { get; set; } public DateTime IssuedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; } public long? SupersededById { get; set; } public DateTime? RotatedAt { get; set; }
    public int? RevokedByUserId { get; set; } public DateTime? RevokedAt { get; set; } public string? RevocationReason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventCheckinDevice : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public Guid PublicId { get; set; } = Guid.NewGuid();
    public string Label { get; set; } = string.Empty; public int RegisteredByUserId { get; set; } public int DeviceVersion { get; set; } = 1;
    public string Status { get; set; } = "active"; public string SecretHash { get; set; } = string.Empty; public string SecretFingerprint { get; set; } = string.Empty;
    public string RegistrationIdempotencyHash { get; set; } = string.Empty; public string? LastRotationIdempotencyHash { get; set; }
    public DateTime RegisteredAt { get; set; } = DateTime.UtcNow; public DateTime ExpiresAt { get; set; } public DateTime? RotatedAt { get; set; }
    public int? RevokedByUserId { get; set; } public DateTime? RevokedAt { get; set; } public string? RevocationReason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventOfflineSyncBatch : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long DeviceId { get; set; }
    public int SubmittedByUserId { get; set; } public string ClientBatchId { get; set; } = string.Empty; public string PayloadHash { get; set; } = string.Empty;
    public long ManifestVersion { get; set; } public int ItemCount { get; set; } public string Status { get; set; } = "pending";
    public int AcceptedCount { get; set; } public int ConflictCount { get; set; } public int RejectedCount { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime? CompletedAt { get; set; } public DateTime? DeadLetteredAt { get; set; }
    public string? TerminalCode { get; set; } public ICollection<EventOfflineSyncItem> Items { get; set; } = new List<EventOfflineSyncItem>();
}

public sealed class EventOfflineSyncItem : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long BatchId { get; set; }
    public long DeviceId { get; set; }
    public int Position { get; set; } public string ClientNonce { get; set; } = string.Empty; public string Operation { get; set; } = string.Empty;
    public DateTime ObservedAt { get; set; } public long ExpectedAttendanceVersion { get; set; } public string CredentialFingerprint { get; set; } = string.Empty;
    public string CredentialHashReference { get; set; } = string.Empty; public long? CredentialId { get; set; } public long? RegistrationId { get; set; }
    public int? UserId { get; set; } public string? Reason { get; set; } public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public ICollection<EventOfflineSyncDecision> Decisions { get; set; } = new List<EventOfflineSyncDecision>();
}

public sealed class EventOfflineSyncDecision : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long BatchId { get; set; } public long ItemId { get; set; }
    public int DecisionVersion { get; set; } = 1; public string Outcome { get; set; } = string.Empty; public string? Code { get; set; } public string? Reason { get; set; }
    public long AttendanceVersionBefore { get; set; } public long? AttendanceVersionAfter { get; set; } public long? AttendanceActivityId { get; set; }
    public int DecidedByUserId { get; set; } public string? ResolutionIdempotencyHash { get; set; } public DateTime DecidedAt { get; set; } = DateTime.UtcNow;
}
