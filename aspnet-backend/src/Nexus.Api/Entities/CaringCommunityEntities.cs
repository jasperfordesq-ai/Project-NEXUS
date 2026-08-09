// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Tenant-scoped Caring Community emergency/safety alert.
/// Mirrors Laravel's caring_emergency_alerts table.
/// </summary>
public class CaringEmergencyAlert : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public string Severity { get; set; } = "warning";
    public string? GeographicScope { get; set; }
    public string? TargetUserIds { get; set; }
    public DateTime? SentAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public bool IsActive { get; set; } = true;
    public int? CreatedBy { get; set; }
    public int DismissedCount { get; set; }
    public bool PushSent { get; set; }
    public string? PushResult { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}

/// <summary>
/// Tenant-scoped cross-platform Caring Community federation peer.
/// Mirrors Laravel's caring_federation_peers table.
/// </summary>
public class CaringFederationPeer : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string PeerSlug { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string BaseUrl { get; set; } = string.Empty;
    public string SharedSecret { get; set; } = string.Empty;
    public string Status { get; set; } = "pending";
    public string? Notes { get; set; }
    public DateTime? LastHandshakeAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}

/// <summary>
/// Tenant-scoped Caring Community pilot sub-region.
/// Mirrors Laravel's caring_sub_regions table.
/// </summary>
public class CaringSubRegion : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string Type { get; set; } = "quartier";
    public string? Description { get; set; }
    public string? PostalCodes { get; set; }
    public string? BoundaryGeoJson { get; set; }
    public decimal? CenterLatitude { get; set; }
    public decimal? CenterLongitude { get; set; }
    public string Status { get; set; } = "active";
    public int? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}

/// <summary>
/// Tenant-scoped Caring Community care-provider directory entry.
/// Mirrors Laravel's caring_care_providers table.
/// </summary>
public class CaringCareProvider : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Categories { get; set; }
    public string? Address { get; set; }
    public int? SubRegionId { get; set; }
    public string? ContactPhone { get; set; }
    public string? ContactEmail { get; set; }
    public string? WebsiteUrl { get; set; }
    public string? OpeningHours { get; set; }
    public bool IsVerified { get; set; }
    public string Status { get; set; } = "active";
    public int? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}

/// <summary>
/// Tenant-scoped verified or pending link between an informal caregiver and a cared-for member.
/// Mirrors Laravel's caring_caregiver_links table.
/// </summary>
public class CaringCaregiverLink : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int CaregiverId { get; set; }
    public int CaredForId { get; set; }
    public string RelationshipType { get; set; } = "family";
    public bool IsPrimary { get; set; }
    public DateOnly StartDate { get; set; }
    public string? Notes { get; set; }
    public string Status { get; set; } = "pending";
    public int? ApprovedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? Caregiver { get; set; }
    public User? CaredFor { get; set; }
}

/// <summary>
/// Tenant-scoped temporary cover-care request for an informal caregiver.
/// Mirrors Laravel's caring_cover_requests table.
/// </summary>
public class CaringCoverRequest : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int CaregiverLinkId { get; set; }
    public int CaregiverId { get; set; }
    public int CaredForId { get; set; }
    public int? SupportRelationshipId { get; set; }
    public int? MatchedSupporterId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Briefing { get; set; }
    public string? RequiredSkillsJson { get; set; }
    public DateTime StartsAt { get; set; }
    public DateTime EndsAt { get; set; }
    public decimal? ExpectedHours { get; set; }
    public int MinimumTrustTier { get; set; } = 1;
    public string Urgency { get; set; } = "planned";
    public string Status { get; set; } = "open";
    public DateTime? MatchedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public CaringCaregiverLink? CaregiverLink { get; set; }
    public User? Caregiver { get; set; }
    public User? CaredFor { get; set; }
    public User? MatchedSupporter { get; set; }
    public CaringSupportRelationship? SupportRelationship { get; set; }
}

/// <summary>
/// Optional tenant-scoped Caring Community support taxonomy used by some Laravel pilots.
/// Mirrors Laravel's caring_support_categories table reference.
/// </summary>
public class CaringSupportCategory : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Color { get; set; }
    public string? Icon { get; set; }
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }
    public decimal SubstitutionCoefficient { get; set; } = 1m;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}

/// <summary>
/// Tenant-scoped KISS-style support relationship between a supporter and care recipient.
/// Mirrors Laravel's caring_support_relationships table.
/// </summary>
public class CaringSupportRelationship : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int SupporterId { get; set; }
    public int RecipientId { get; set; }
    public int? CoordinatorId { get; set; }
    public int? OrganizationId { get; set; }
    public int? CategoryId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Frequency { get; set; } = "weekly";
    public decimal ExpectedHours { get; set; } = 1m;
    public DateOnly StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public string Status { get; set; } = "active";
    public DateTime? LastLoggedAt { get; set; }
    public DateTime? NextCheckInAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? Supporter { get; set; }
    public User? Recipient { get; set; }
    public User? Coordinator { get; set; }
    public VolunteerOrganisation? Organization { get; set; }
}

/// <summary>
/// Tenant-scoped log of actioned Caring Community tandem suggestions.
/// Mirrors Laravel's caring_tandem_suggestion_log table.
/// </summary>
public class CaringTandemSuggestionLog : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int SupporterUserId { get; set; }
    public int RecipientUserId { get; set; }
    public string Action { get; set; } = "dismissed";
    public int? CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Tenant-scoped open support request from a Caring Community member.
/// Mirrors Laravel's caring_help_requests table.
/// </summary>
public class CaringHelpRequest : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string What { get; set; } = string.Empty;
    public string WhenNeeded { get; set; } = string.Empty;
    public string ContactPreference { get; set; } = "either";
    public string Status { get; set; } = "pending";
    public bool IsOnBehalf { get; set; }
    public int? RequestedById { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public User? RequestedBy { get; set; }
}

/// <summary>
/// Minimal tenant-scoped volunteering log surface used by Caring Community parity endpoints.
/// Mirrors the Laravel vol_logs columns consumed by recipient-circle and KPI services.
/// </summary>
public class VolunteerLog : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public int? OrganizationId { get; set; }
    public int? OpportunityId { get; set; }
    public int? CaringSupportRelationshipId { get; set; }
    public int? SupportRecipientId { get; set; }
    public DateOnly DateLogged { get; set; }
    public decimal Hours { get; set; }
    public string? Description { get; set; }
    public string? Feedback { get; set; }
    public string Status { get; set; } = "pending";
    public int? AssignedTo { get; set; }
    public DateTime? AssignedAt { get; set; }
    public DateTime? EscalatedAt { get; set; }
    public string? EscalationNote { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public VolunteerOrganisation? Organization { get; set; }
    public VolunteerOpportunity? Opportunity { get; set; }
    public User? SupportRecipient { get; set; }
    public User? AssignedUser { get; set; }
    public CaringSupportRelationship? CaringSupportRelationship { get; set; }
}

/// <summary>
/// Tenant-scoped Caring Community project announcement.
/// Mirrors Laravel's caring_project_announcements table.
/// </summary>
public class CaringProjectAnnouncement : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int? CreatedBy { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Summary { get; set; }
    public string? Location { get; set; }
    public string Status { get; set; } = "draft";
    public string? CurrentStage { get; set; }
    public int ProgressPercent { get; set; }
    public DateTime? StartsAt { get; set; }
    public DateTime? EndsAt { get; set; }
    public DateTime? PublishedAt { get; set; }
    public DateTime? LastUpdateAt { get; set; }
    public int SubscriberCount { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? Creator { get; set; }
    public ICollection<CaringProjectUpdate> Updates { get; set; } = new List<CaringProjectUpdate>();
    public ICollection<CaringProjectSubscription> Subscriptions { get; set; } = new List<CaringProjectSubscription>();
}

/// <summary>
/// Tenant-scoped update for a Caring Community project announcement.
/// Mirrors Laravel's caring_project_updates table.
/// </summary>
public class CaringProjectUpdate : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ProjectId { get; set; }
    public int? CreatedBy { get; set; }
    public string? StageLabel { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Body { get; set; }
    public int? ProgressPercent { get; set; }
    public bool IsMilestone { get; set; }
    public string Status { get; set; } = "draft";
    public DateTime? PublishedAt { get; set; }
    public int NotificationCount { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public CaringProjectAnnouncement? Project { get; set; }
    public User? Creator { get; set; }
}

/// <summary>
/// Tenant-scoped subscription linking a member to project announcement updates.
/// Mirrors Laravel's caring_project_subscriptions table.
/// </summary>
public class CaringProjectSubscription : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ProjectId { get; set; }
    public int UserId { get; set; }
    public DateTime SubscribedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UnsubscribedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public CaringProjectAnnouncement? Project { get; set; }
    public User? User { get; set; }
}

/// <summary>
/// Tenant-scoped smart nudge delivery row.
/// Mirrors Laravel's caring_smart_nudges table.
/// </summary>
public class CaringSmartNudge : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int TargetUserId { get; set; }
    public int? RelatedUserId { get; set; }
    public string SourceType { get; set; } = "tandem_candidate";
    public string? DispatchKey { get; set; }
    public decimal Score { get; set; }
    public string? Signals { get; set; }
    public long? NotificationId { get; set; }
    public string Status { get; set; } = "sent";
    public DateTime SentAt { get; set; } = DateTime.UtcNow;
    public DateTime? ConvertedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? TargetUser { get; set; }
    public User? RelatedUser { get; set; }
}

/// <summary>
/// Tenant-scoped scanned paper consent/onboarding intake awaiting coordinator review.
/// Mirrors Laravel's caring_paper_onboarding_intakes table.
/// </summary>
public class CaringPaperOnboardingIntake : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int? UploadedBy { get; set; }
    public int? ReviewedBy { get; set; }
    public int? CreatedUserId { get; set; }
    public string Status { get; set; } = "pending_review";
    public string OriginalFilename { get; set; } = string.Empty;
    public string StoredPath { get; set; } = string.Empty;
    public string? MimeType { get; set; }
    public int? FileSize { get; set; }
    public string OcrProvider { get; set; } = "manual_review_stub";
    public string? ExtractedFields { get; set; }
    public string? CorrectedFields { get; set; }
    public string? CoordinatorNotes { get; set; }
    public DateTime? ConfirmedAt { get; set; }
    public DateTime? RejectedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }

    public Tenant? Tenant { get; set; }
}

/// <summary>
/// Tenant-scoped Caring Community invite code.
/// Mirrors Laravel's caring_invite_codes table.
/// </summary>
public class CaringInviteCode : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string? Label { get; set; }
    public int CreatedByUserId { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? UsedAt { get; set; }
    public int? UsedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? CreatedByUser { get; set; }
    public User? UsedByUser { get; set; }
}

/// <summary>
/// Tenant-scoped Caring Community KPI baseline snapshot.
/// Mirrors Laravel's caring_kpi_baselines table.
/// </summary>
public class CaringKpiBaseline : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public string Label { get; set; } = string.Empty;
    public string BaselinePeriod { get; set; } = "{}";
    public DateTime? CapturedAt { get; set; } = DateTime.UtcNow;
    public string Metrics { get; set; } = "{}";
    public string? Notes { get; set; }
    public int? CapturedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}

/// <summary>
/// Tenant-scoped informal neighbourly favour record.
/// Mirrors Laravel's caring_favours table.
/// </summary>
public class CaringFavour : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int OfferedByUserId { get; set; }
    public int? ReceivedByUserId { get; set; }
    public string? Category { get; set; }
    public string Description { get; set; } = string.Empty;
    public DateOnly FavourDate { get; set; }
    public bool IsAnonymous { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? OfferedByUser { get; set; }
    public User? ReceivedByUser { get; set; }
}

/// <summary>
/// Tenant-scoped municipality feedback inbox row.
/// Mirrors Laravel's caring_municipality_feedback table.
/// </summary>
public class CaringMunicipalityFeedback : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int? SubmitterUserId { get; set; }
    public int? SubRegionId { get; set; }
    public string Category { get; set; } = "question";
    public string Subject { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public string? SentimentTag { get; set; }
    public string Status { get; set; } = "new";
    public int? AssignedUserId { get; set; }
    public string? AssignedRole { get; set; }
    public string? TriageNotes { get; set; }
    public string? ResolutionNotes { get; set; }
    public bool IsAnonymous { get; set; }
    public bool IsPublic { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }

    public Tenant? Tenant { get; set; }
}

/// <summary>
/// Tenant-scoped reusable municipal/KISS report template.
/// Mirrors Laravel's municipal_report_templates table.
/// </summary>
public class MunicipalReportTemplate : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Audience { get; set; } = "municipality";
    public string DatePreset { get; set; } = "last_90_days";
    public bool IncludeSocialValue { get; set; } = true;
    public int? HourValueChf { get; set; }
    public string? Sections { get; set; }
    public int? CreatedBy { get; set; }
    public int? UpdatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}

/// <summary>
/// Tenant-scoped municipality domain verification row.
/// Mirrors Laravel's municipal_verifications table.
/// </summary>
public class MunicipalVerification : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public string Domain { get; set; } = string.Empty;
    public string Method { get; set; } = "dns_txt";
    public string Status { get; set; } = "pending";
    public string? DnsRecordName { get; set; }
    public string? DnsRecordValue { get; set; }
    public int? RequestedBy { get; set; }
    public int? VerifiedBy { get; set; }
    public DateTime? VerifiedAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public string? AttestationNote { get; set; }
    public string? Metadata { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}

/// <summary>
/// Tenant-scoped municipality survey header.
/// Mirrors Laravel's municipality_surveys table.
/// </summary>
public class MunicipalitySurvey : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int CreatedBy { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Status { get; set; } = "draft";
    public bool IsAnonymous { get; set; }
    public string? TargetAudience { get; set; }
    public DateTime? StartsAt { get; set; }
    public DateTime? EndsAt { get; set; }
    public int ResponseCount { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? Creator { get; set; }
    public ICollection<MunicipalitySurveyQuestion> Questions { get; set; } = new List<MunicipalitySurveyQuestion>();
    public ICollection<MunicipalitySurveyResponse> Responses { get; set; } = new List<MunicipalitySurveyResponse>();
}

/// <summary>
/// Tenant-scoped ordered question for a municipality survey.
/// Mirrors Laravel's municipality_survey_questions table.
/// </summary>
public class MunicipalitySurveyQuestion : ITenantEntity
{
    public long Id { get; set; }
    public long SurveyId { get; set; }
    public int TenantId { get; set; }
    public string QuestionText { get; set; } = string.Empty;
    public string QuestionType { get; set; } = "open_text";
    public string? Options { get; set; }
    public bool IsRequired { get; set; } = true;
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public MunicipalitySurvey? Survey { get; set; }
}

/// <summary>
/// Tenant-scoped response to a municipality survey.
/// Mirrors Laravel's municipality_survey_responses table.
/// </summary>
public class MunicipalitySurveyResponse : ITenantEntity
{
    public long Id { get; set; }
    public long SurveyId { get; set; }
    public int TenantId { get; set; }
    public int? UserId { get; set; }
    public string? SessionToken { get; set; }
    public string Answers { get; set; } = "{}";
    public DateTime SubmittedAt { get; set; } = DateTime.UtcNow;
    public string? IpHash { get; set; }

    public Tenant? Tenant { get; set; }
    public MunicipalitySurvey? Survey { get; set; }
    public User? User { get; set; }
}

/// <summary>
/// Tenant-scoped legacy hour estate planning record.
/// Mirrors Laravel's caring_hour_estates table.
/// </summary>
public class CaringHourEstate : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int MemberUserId { get; set; }
    public int? BeneficiaryUserId { get; set; }
    public string PolicyAction { get; set; } = "donate_to_solidarity";
    public string Status { get; set; } = "nominated";
    public decimal? ReportedBalanceHours { get; set; }
    public decimal? SettledHours { get; set; }
    public int? SettlementTransactionId { get; set; }
    public string? PolicyDocumentReference { get; set; }
    public string? MemberNotes { get; set; }
    public string? CoordinatorNotes { get; set; }
    public DateTime? NominatedAt { get; set; }
    public DateTime? ReportedDeceasedAt { get; set; }
    public DateTime? SettledAt { get; set; }
    public int? ReportedBy { get; set; }
    public int? SettledBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? MemberUser { get; set; }
    public User? BeneficiaryUser { get; set; }
    public Transaction? SettlementTransaction { get; set; }
}

/// <summary>
/// Tenant-scoped cross-cooperative banked-hour transfer record.
/// Mirrors Laravel's caring_hour_transfers table.
/// </summary>
public class CaringHourTransfer : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public string CounterpartTenantSlug { get; set; } = string.Empty;
    public string Role { get; set; } = "source";
    public int MemberUserId { get; set; }
    public string CounterpartMemberEmail { get; set; } = string.Empty;
    public decimal HoursTransferred { get; set; }
    public string Status { get; set; } = "pending";
    public string? Reason { get; set; }
    public string? Signature { get; set; }
    public string? PayloadJson { get; set; }
    public long? LinkedTransferId { get; set; }
    public string? RemoteIdempotencyKey { get; set; }
    public bool IsRemote { get; set; }
    public string? RemoteDeliveryStatus { get; set; }
    public int RemoteDeliveryAttempts { get; set; }
    public string? RemoteDeliveryLastError { get; set; }
    public DateTime? RemoteDeliveryNextRetryAt { get; set; }
    public DateTime? RemoteDeliveredAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? MemberUser { get; set; }
}

/// <summary>
/// Tenant-scoped member-to-member hour gift.
/// Mirrors Laravel's caring_hour_gifts table.
/// </summary>
public class CaringHourGift : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int SenderUserId { get; set; }
    public int RecipientUserId { get; set; }
    public int? ReservationTransactionId { get; set; }
    public int? SettlementTransactionId { get; set; }
    public decimal Hours { get; set; }
    public string? Message { get; set; }
    public string Status { get; set; } = "pending";
    public string? DeclineReason { get; set; }
    public DateTime? AcceptedAt { get; set; }
    public DateTime? DeclinedAt { get; set; }
    public DateTime? RevertedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? SenderUser { get; set; }
    public User? RecipientUser { get; set; }
    public Transaction? ReservationTransaction { get; set; }
    public Transaction? SettlementTransaction { get; set; }
}

/// <summary>
/// Tenant-scoped KISS/Caring Community ritual meeting metadata linked to an event.
/// Mirrors Laravel's caring_kiss_treffen table.
/// </summary>
public class CaringKissTreffen : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int? EventId { get; set; }
    public string TreffenType { get; set; } = "monthly_stamm";
    public bool MembersOnly { get; set; } = true;
    public int? QuorumRequired { get; set; }
    public string? FondationHeader { get; set; }
    public string? MinutesDocumentUrl { get; set; }
    public DateTime? MinutesUploadedAt { get; set; }
    public int? MinutesUploadedBy { get; set; }
    public string? CoordinatorNotes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public Event? Event { get; set; }
}

/// <summary>
/// Tenant-scoped regional-point wallet for a Caring Community member.
/// Mirrors Laravel's caring_regional_point_accounts table.
/// </summary>
public class CaringRegionalPointAccount : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public decimal Balance { get; set; }
    public decimal LifetimeEarned { get; set; }
    public decimal LifetimeSpent { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public ICollection<CaringRegionalPointTransaction> Transactions { get; set; } = new List<CaringRegionalPointTransaction>();
}

/// <summary>
/// Tenant-scoped regional-point ledger transaction.
/// Mirrors Laravel's caring_regional_point_transactions table.
/// </summary>
public class CaringRegionalPointTransaction : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public long AccountId { get; set; }
    public int UserId { get; set; }
    public int? ActorUserId { get; set; }
    public string Type { get; set; } = "admin_issue";
    public string Direction { get; set; } = "credit";
    public decimal Points { get; set; }
    public decimal BalanceAfter { get; set; }
    public string? ReferenceType { get; set; }
    public long? ReferenceId { get; set; }
    public string? Description { get; set; }
    public string? Metadata { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public CaringRegionalPointAccount? Account { get; set; }
    public User? User { get; set; }
    public User? ActorUser { get; set; }
}

/// <summary>
/// Tenant-scoped marketplace seller settings for accepting regional points.
/// Mirrors Laravel's marketplace_seller_regional_point_settings table.
/// </summary>
public class MarketplaceSellerRegionalPointSetting : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int SellerUserId { get; set; }
    public bool AcceptsRegionalPoints { get; set; }
    public decimal RegionalPointsPerChf { get; set; } = 10m;
    public int RegionalPointsMaxDiscountPct { get; set; } = 25;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? SellerUser { get; set; }
}

/// <summary>
/// Tenant-scoped Caring Community research partner.
/// Mirrors Laravel's caring_research_partners table.
/// </summary>
public class CaringResearchPartner : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Institution { get; set; } = string.Empty;
    public string? ContactEmail { get; set; }
    public string? AgreementReference { get; set; }
    public string? MethodologyUrl { get; set; }
    public string Status { get; set; } = "draft";
    public string? DataScope { get; set; }
    public DateOnly? StartsAt { get; set; }
    public DateOnly? EndsAt { get; set; }
    public int? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? Creator { get; set; }
    public ICollection<CaringResearchDatasetExport> DatasetExports { get; set; } = new List<CaringResearchDatasetExport>();
}

/// <summary>
/// Tenant-scoped Caring Community member consent for aggregate research datasets.
/// Mirrors Laravel's caring_research_consents table.
/// </summary>
public class CaringResearchConsent : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string ConsentStatus { get; set; } = "opted_out";
    public string ConsentVersion { get; set; } = "research-v1";
    public DateTime? ConsentedAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}

/// <summary>
/// Tenant-scoped Caring Community anonymised aggregate dataset export.
/// Mirrors Laravel's caring_research_dataset_exports table.
/// </summary>
public class CaringResearchDatasetExport : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public long PartnerId { get; set; }
    public int? RequestedBy { get; set; }
    public string DatasetKey { get; set; } = "caring_community_aggregate_v1";
    public DateOnly PeriodStart { get; set; }
    public DateOnly PeriodEnd { get; set; }
    public string Status { get; set; } = "generated";
    public int RowCount { get; set; }
    public string AnonymizationVersion { get; set; } = "aggregate-v1";
    public string DataHash { get; set; } = string.Empty;
    public DateTime GeneratedAt { get; set; } = DateTime.UtcNow;
    public string? Metadata { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public CaringResearchPartner? Partner { get; set; }
    public User? RequestedByUser { get; set; }
}

/// <summary>
/// Tenant-scoped Verein federation consent for municipal event sharing.
/// Mirrors Laravel's verein_federation_consents table.
/// </summary>
public class VereinFederationConsent : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public int OrganizationId { get; set; }
    public string SharingScope { get; set; } = "none";
    public string? MunicipalityCode { get; set; }
    public bool IsActive { get; set; } = true;
    public int? OptedInByAdminId { get; set; }
    public DateTime? OptedInAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public Organisation? Organisation { get; set; }
    public User? OptedInByAdmin { get; set; }
}

/// <summary>
/// Tenant-scoped criteria JSON for the Caring Community trust-tier system.
/// Mirrors Laravel's caring_trust_tier_config table.
/// </summary>
public class CaringTrustTierConfig : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public string Criteria { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}
