// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

namespace Nexus.Api.Entities;

public sealed class EventSafetyRequirement : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long Revision { get; set; }=1; public int CurrentVersion { get; set; }=1; public int? PublishedVersion { get; set; } public string Status { get; set; }="draft"; public int CreatedByUserId { get; set; } public int UpdatedByUserId { get; set; } public int? PublishedByUserId { get; set; } public DateTime? PublishedAt { get; set; } public int? ArchivedByUserId { get; set; } public DateTime? ArchivedAt { get; set; } public DateTime CreatedAt { get; set; }=DateTime.UtcNow; public DateTime UpdatedAt { get; set; }=DateTime.UtcNow;
}
public sealed class EventSafetyRequirementVersion : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long RequirementsId { get; set; } public int VersionNumber { get; set; } public int? MinimumAge { get; set; } public bool GuardianConsentRequired { get; set; } public int? MinorAgeThreshold { get; set; } public bool CodeOfConductRequired { get; set; } public string? CodeOfConductText { get; set; } public string? CodeOfConductTextVersion { get; set; } public string? CodeOfConductTextHash { get; set; } public string EligibilityPolicyHash { get; set; }=string.Empty; public int CapturedByUserId { get; set; } public string IdempotencyHash { get; set; }=string.Empty; public string RequestHash { get; set; }=string.Empty; public DateTime CreatedAt { get; set; }=DateTime.UtcNow;
}
public sealed class EventSafetyRequirementHistory : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long RequirementsId { get; set; } public long RequirementsRevision { get; set; } public long RequirementsVersionId { get; set; } public int RequirementsVersionNumber { get; set; } public string Action { get; set; }=string.Empty; public int ActorUserId { get; set; } public string IdempotencyHash { get; set; }=string.Empty; public string RequestHash { get; set; }=string.Empty; public string Metadata { get; set; }="{}"; public DateTime CreatedAt { get; set; }=DateTime.UtcNow;
}
public sealed class EventSafetyCodeAcknowledgement : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long RequirementsId { get; set; } public long RequirementsVersionId { get; set; } public int RequirementsVersionNumber { get; set; } public int UserId { get; set; } public long EvidenceSequence { get; set; } public string Action { get; set; }=string.Empty; public long? ReferencedAcknowledgementId { get; set; } public string TextVersion { get; set; }=string.Empty; public string TextHash { get; set; }=string.Empty; public DateTime AcknowledgedAt { get; set; } public int ActorUserId { get; set; } public string IdempotencyHash { get; set; }=string.Empty; public string RequestHash { get; set; }=string.Empty; public DateTime RecordedAt { get; set; }=DateTime.UtcNow;
}
public sealed class EventGuardianConsent : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long RequirementsId { get; set; } public long RequirementsVersionId { get; set; } public int RequirementsVersionNumber { get; set; } public int MinorUserId { get; set; } public string GuardianEmailCiphertext { get; set; }=string.Empty; public string GuardianIdentityCiphertext { get; set; }=string.Empty; public string GuardianEmailBlindHash { get; set; }=string.Empty; public string GuardianLocale { get; set; }="en"; public string RelationshipCode { get; set; }=string.Empty; public string ConsentTextHash { get; set; }=string.Empty; public string PolicyBindingHash { get; set; }=string.Empty; public string TokenHash { get; set; }=string.Empty; public string Status { get; set; }="pending"; public long ConsentVersion { get; set; }=1; public int RequestedByUserId { get; set; } public string RequestIdempotencyHash { get; set; }=string.Empty; public string RequestHash { get; set; }=string.Empty; public DateTime RequestedAt { get; set; }=DateTime.UtcNow; public DateTime ExpiresAt { get; set; } public DateTime? TokenConsumedAt { get; set; } public DateTime? GrantedAt { get; set; } public int? WithdrawnByUserId { get; set; } public DateTime? WithdrawnAt { get; set; } public DateTime CreatedAt { get; set; }=DateTime.UtcNow; public DateTime UpdatedAt { get; set; }=DateTime.UtcNow;
}
public sealed class EventGuardianConsentHistory : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long ConsentId { get; set; } public int MinorUserId { get; set; } public long ConsentVersion { get; set; } public string Status { get; set; }=string.Empty; public string Action { get; set; }=string.Empty; public string ActorType { get; set; }=string.Empty; public int? ActorUserId { get; set; } public string IdempotencyHash { get; set; }=string.Empty; public string RequestHash { get; set; }=string.Empty; public string Evidence { get; set; }="{}"; public DateTime CreatedAt { get; set; }=DateTime.UtcNow;
}
public sealed class EventParticipationDenial : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public int UserId { get; set; } public string Decision { get; set; }=string.Empty; public string ReasonCode { get; set; }=string.Empty; public string Status { get; set; }="active"; public long DecisionVersion { get; set; }=1; public int ReviewedByUserId { get; set; } public DateTime EffectiveFrom { get; set; } public DateTime? EffectiveUntil { get; set; } public string CreateIdempotencyHash { get; set; }=string.Empty; public string CreateRequestHash { get; set; }=string.Empty; public int? WithdrawnByUserId { get; set; } public DateTime? WithdrawnAt { get; set; } public DateTime CreatedAt { get; set; }=DateTime.UtcNow; public DateTime UpdatedAt { get; set; }=DateTime.UtcNow;
}
public sealed class EventParticipationDenialHistory : ITenantEntity
{
    public long Id { get; set; } public int TenantId { get; set; } public int EventId { get; set; } public long DenialId { get; set; } public int UserId { get; set; } public long DecisionVersion { get; set; } public string Decision { get; set; }=string.Empty; public string ReasonCode { get; set; }=string.Empty; public string Status { get; set; }=string.Empty; public string Action { get; set; }=string.Empty; public int ReviewerUserId { get; set; } public DateTime EffectiveFrom { get; set; } public DateTime? EffectiveUntil { get; set; } public string IdempotencyHash { get; set; }=string.Empty; public string RequestHash { get; set; }=string.Empty; public DateTime CreatedAt { get; set; }=DateTime.UtcNow;
}
