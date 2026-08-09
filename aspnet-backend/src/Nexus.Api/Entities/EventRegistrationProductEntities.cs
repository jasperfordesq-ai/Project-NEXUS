// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public sealed class EventRegistrationSettings : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public long Revision { get; set; } = 1; public string Status { get; set; } = "draft";
    public string ApprovalMode { get; set; } = "auto"; public string FormState { get; set; } = "none";
    public long? PublishedFormVersionId { get; set; } public int PerMemberLimit { get; set; } = 1;
    public bool GuestsEnabled { get; set; } public int MaxGuestsPerRegistration { get; set; }
    public int GuestRetentionDays { get; set; } = 30; public DateTime? OpensAtUtc { get; set; }
    public DateTime? ClosesAtUtc { get; set; } public DateTime? CancellationCutoffAtUtc { get; set; }
    public string EventTimezoneSnapshot { get; set; } = "UTC"; public int CreatedBy { get; set; }
    public int UpdatedBy { get; set; } public int? PublishedBy { get; set; } public DateTime? PublishedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventRegistrationSettingsHistory : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public long SettingsId { get; set; } public long SettingsRevision { get; set; } public string Action { get; set; } = string.Empty;
    public int ActorUserId { get; set; } public string IdempotencyHash { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty; public string Snapshot { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventRegistrationFormVersion : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public long VersionNumber { get; set; } = 1; public long Revision { get; set; } = 1;
    public string Status { get; set; } = "draft"; public string Name { get; set; } = string.Empty;
    public string? Description { get; set; } public string? DefinitionHash { get; set; } public long? ForkedFromFormId { get; set; }
    public int CreatedBy { get; set; } public int UpdatedBy { get; set; } public int? PublishedBy { get; set; }
    public string CreateIdempotencyHash { get; set; } = string.Empty; public string CreateRequestHash { get; set; } = string.Empty;
    public DateTime? PublishedAt { get; set; } public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventRegistrationFormQuestion : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public long FormVersionId { get; set; } public string StableKey { get; set; } = string.Empty; public int Position { get; set; }
    public string QuestionType { get; set; } = "short_text"; public string Prompt { get; set; } = string.Empty;
    public string? HelpText { get; set; } public bool IsRequired { get; set; }
    public string DataClassification { get; set; } = "public"; public string Purpose { get; set; } = string.Empty;
    public int RetentionDays { get; set; } public string? ChoiceOptions { get; set; }
    public string? ValidationRules { get; set; } public string? VisibilityRules { get; set; }
    public string? DisplayedText { get; set; } public string? DisplayedTextVersion { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventRegistrationFormSubmission : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public long RegistrationId { get; set; } public long FormVersionId { get; set; } public int UserId { get; set; }
    public long Revision { get; set; } = 1; public string Status { get; set; } = "draft"; public int AttemptNumber { get; set; } = 1;
    public int? EffectiveSlot { get; set; } public long? SupersedesSubmissionId { get; set; } public DateTime? SupersededAt { get; set; }
    public string SaveIdempotencyHash { get; set; } = string.Empty; public string SaveRequestHash { get; set; } = string.Empty;
    public DateTime? SubmittedAt { get; set; } public DateTime? WithdrawnAt { get; set; } public DateTime? AnonymisedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventRegistrationFormAnswer : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public long SubmissionId { get; set; } public long QuestionId { get; set; } public string StableKey { get; set; } = string.Empty;
    public string DataClassification { get; set; } = "public"; public string Purpose { get; set; } = string.Empty;
    public string? ValueJson { get; set; } public string ValueHash { get; set; } = string.Empty; public bool IsPurged { get; set; }
    public DateTime? PurgedAt { get; set; } public DateTime RetentionDueAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventRegistrationSubmissionHistory : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public long SubmissionId { get; set; } public long SubmissionRevision { get; set; } public string Action { get; set; } = string.Empty;
    public int ActorUserId { get; set; } public string IdempotencyHash { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty; public string Snapshot { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventRegistrationAnswerAccessAudit : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public long SubmissionId { get; set; } public long AnswerId { get; set; } public long QuestionId { get; set; }
    public int ActorUserId { get; set; } public string Action { get; set; } = string.Empty;
    public string Purpose { get; set; } = string.Empty; public string CorrelationId { get; set; } = string.Empty;
    public bool IncludedSensitive { get; set; } public int AnswerCount { get; set; } public string Metadata { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventInvitationCampaign : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public string CampaignType { get; set; } = "member"; public string Status { get; set; } = "previewed"; public long Revision { get; set; } = 1;
    public string Source { get; set; } = "{}"; public string SourceHash { get; set; } = string.Empty; public int SourceSchemaVersion { get; set; } = 1; public string? SegmentCriteriaSummary { get; set; }
    public int PreviewCount { get; set; } public int ValidCount { get; set; } public int ErrorCount { get; set; }
    public string PreviewErrors { get; set; } = "[]"; public string DefaultLocale { get; set; } = "en";
    public DateTime? ScheduledForUtc { get; set; } public DateTime? StartedAt { get; set; } public DateTime? CompletedAt { get; set; } public DateTime? IssuedAt { get; set; } public DateTime? CancelledAt { get; set; }
    public string? CancellationReason { get; set; } public int CreatedBy { get; set; } public int UpdatedBy { get; set; }
    public string CreateIdempotencyHash { get; set; } = string.Empty; public string CreateRequestHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventInvitationCampaignHistory : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public long CampaignId { get; set; } public long CampaignRevision { get; set; } public string Action { get; set; } = string.Empty;
    public int ActorUserId { get; set; } public string IdempotencyHash { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty; public string Snapshot { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventInvitation : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long CampaignId { get; set; }
    public int? UserId { get; set; } public string? EmailCiphertext { get; set; } public string? EmailBlindHash { get; set; }
    public string TokenHash { get; set; } = string.Empty; public string TokenPrefix { get; set; } = string.Empty;
    public string Status { get; set; } = "issued"; public long InvitationVersion { get; set; } = 1;
    public string Locale { get; set; } = "en"; public DateTime TokenExpiresAt { get; set; }
    public DateTime? AcceptedAt { get; set; } public int? AcceptedBy { get; set; } public DateTime? RevokedAt { get; set; }
    public int? RevokedBy { get; set; } public string? RevocationReason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventInvitationHistory : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public long InvitationId { get; set; } public long InvitationVersion { get; set; } public string Action { get; set; } = string.Empty;
    public int ActorUserId { get; set; } public string IdempotencyHash { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty; public string Metadata { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventInvitationDeliveryEvidence : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public long CampaignId { get; set; } public long InvitationId { get; set; } public long OutboxId { get; set; } public long? NotificationDeliveryId { get; set; } public long EvidenceVersion { get; set; } = 1; public string Channel { get; set; } = "email";
    public string Status { get; set; } = "queued"; public string RecipientHash { get; set; } = string.Empty;
    public string RecipientLocale { get; set; } = "en"; public string PreferenceDecision { get; set; } = "allowed"; public string? PreferenceReason { get; set; } public string? ProviderEvidenceId { get; set; } public string? FailureCode { get; set; }
    public string IdempotencyHash { get; set; } = string.Empty; public DateTime? DeliveredAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow; public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventNotificationPreferenceProduct : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public int? EventId { get; set; }
    public int? CategoryId { get; set; }
    public bool? EmailEnabled { get; set; }
    public bool? InAppEnabled { get; set; }
    public bool? WebPushEnabled { get; set; }
    public bool? FcmEnabled { get; set; }
    public bool? RealtimeEnabled { get; set; }
    public string? Cadence { get; set; }
    public bool? RemindersEnabled { get; set; }
    public long PreferenceVersion { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventReminderRuleProduct : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public int UserId { get; set; }
    public int OffsetMinutes { get; set; }
    public bool Enabled { get; set; } = true;
    public bool? EmailEnabled { get; set; }
    public bool? InAppEnabled { get; set; }
    public bool? WebPushEnabled { get; set; }
    public bool? FcmEnabled { get; set; }
    public bool? RealtimeEnabled { get; set; }
    public long RuleVersion { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventNotificationDelivery : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public long OutboxId { get; set; }
    public int? RecipientUserId { get; set; }
    public string? ExternalRecipientHash { get; set; }
    public string Channel { get; set; } = string.Empty;
    public string DeliveryKey { get; set; } = string.Empty;
    public string Status { get; set; } = "pending";
    public short Attempts { get; set; }
    public DateTime? NextAttemptAt { get; set; }
    public Guid? ClaimToken { get; set; }
    public DateTime? ClaimedAt { get; set; }
    public DateTime? DeliveredAt { get; set; }
    public DateTime? SuppressedAt { get; set; }
    public DateTime? DeadLetteredAt { get; set; }
    public string? PreferenceReason { get; set; }
    public string? SuppressionReason { get; set; }
    public string? Provider { get; set; }
    public string? ProviderEvidenceId { get; set; }
    public string? LastError { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventRegistrationGuest : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public long RegistrationId { get; set; } public long? TicketEntitlementId { get; set; } public int GuestNumber { get; set; }
    public long Revision { get; set; } = 1; public string Status { get; set; } = "captured";
    public string? DisplayNameCiphertext { get; set; } public string? EmailCiphertext { get; set; }
    public string? PhoneCiphertext { get; set; } public string? EmailBlindHash { get; set; } public string IdentityFingerprint { get; set; } = string.Empty; public string? PreferredLocale { get; set; }
    public bool NotificationConsent { get; set; } public string ConsentTextHash { get; set; } = string.Empty;
    public string ConsentTextVersion { get; set; } = string.Empty; public string? NotificationConsentHash { get; set; }
    public string? NotificationConsentVersion { get; set; } public DateTime ConsentedAt { get; set; } = DateTime.UtcNow; public DateTime? NotificationConsentedAt { get; set; } public DateTime RetentionDueAt { get; set; }
    public DateTime? WithdrawnAt { get; set; } public DateTime? AnonymisedAt { get; set; }
    public int CreatedBy { get; set; } public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventRegistrationGuestAttendance : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long RegistrationId { get; set; } public long GuestId { get; set; }
    public string Status { get; set; } = "not_checked_in"; public long Version { get; set; }
    public DateTime StatusChangedAt { get; set; } = DateTime.UtcNow; public int? StatusChangedBy { get; set; }
    public DateTime? CheckedInAt { get; set; } public DateTime? CheckedOutAt { get; set; } public DateTime? AttendedAt { get; set; } public DateTime? NoShowAt { get; set; }
    public int? UpdatedBy { get; set; } public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventRegistrationGuestAttendanceHistory : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public long AttendanceId { get; set; } public long RegistrationId { get; set; } public long GuestId { get; set; } public long AttendanceVersion { get; set; }
    public string Action { get; set; } = string.Empty; public string FromStatus { get; set; } = string.Empty; public string ToStatus { get; set; } = string.Empty; public string Status { get; set; } = string.Empty;
    public int ActorUserId { get; set; } public string IdempotencyHash { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty; public string? Reason { get; set; } public string Metadata { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventRegistrationRetentionRun : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public string Mode { get; set; } = "dry_run"; public long? DryRunId { get; set; } public DateTime AsOfUtc { get; set; }
    public int EligibleCount { get; set; } public int AffectedCount { get; set; } public string Status { get; set; } = "completed";
    public int CreatedBy { get; set; } public string IdempotencyHash { get; set; } = string.Empty;
    public string RequestHash { get; set; } = string.Empty; public DateTime CompletedAt { get; set; } = DateTime.UtcNow;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class EventRegistrationRetentionItem : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; }
    public long RetentionRunId { get; set; } public string SubjectType { get; set; } = string.Empty; public long SubjectId { get; set; }
    public string Action { get; set; } = string.Empty; public string Status { get; set; } = "eligible";
    public string Evidence { get; set; } = "{}"; public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
