// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;

namespace Nexus.Api.Services;

public sealed record SafeguardingPolicyState(
    bool Configured,
    bool ContactPolicyAvailable,
    string Jurisdiction,
    string? SchemeCode,
    string? AttestationCode,
    string PurposeCode,
    string ScopeType,
    string ScopeIdentifier,
    string? PolicyVersion,
    string Label,
    string? AttestationLabel,
    string? Preset);

public sealed record SafeguardingJurisdictionOption(
    string Code,
    string Label,
    string? AttestationCode,
    string? AttestationLabel,
    bool AvailableForContactPolicy,
    bool ContactPolicyAvailable);

public sealed record SafeguardingPreferenceTransitionResult(
    IReadOnlyList<string> Created,
    IReadOnlyList<string> Updated,
    IReadOnlyList<string> Deactivated,
    IReadOnlyList<string> Preserved,
    int ReviewRequiredCount,
    [property: JsonIgnore] IReadOnlyList<int> ReviewUserIds);

public sealed record SafeguardingPolicyConfigurationResult(
    SafeguardingPolicyState Policy,
    SafeguardingPreferenceTransitionResult PreferenceTransition);

public sealed record SafeguardingPolicyRotationResult(
    SafeguardingPolicyState Policy,
    string ReasonCode,
    int AffectedMemberCount,
    [property: JsonIgnore] IReadOnlyList<int> AffectedMemberIds);

public sealed record VettingAttestationRecord(
    long Id,
    int UserId,
    string SchemeCode,
    string AttestationCode,
    string PurposeCode,
    string ScopeType,
    string ScopeIdentifier,
    string Decision,
    int? ConfirmedBy,
    DateTime? ConfirmedAt,
    int? RevokedBy,
    DateTime? RevokedAt,
    string? RevocationReasonCode,
    string PolicyVersion,
    DateTime? CreatedAt,
    DateTime? UpdatedAt,
    string? ConfirmedByName = null,
    string? FirstName = null,
    string? LastName = null,
    string? Email = null,
    string? AvatarUrl = null);

public sealed record VettingReviewRecord(
    long Id,
    int UserId,
    string Jurisdiction,
    string SchemeCode,
    string AttestationCode,
    string PurposeCode,
    string ScopeType,
    string ScopeIdentifier,
    string PolicyVersion,
    string Status,
    string RequestSource,
    int? RequestedBy,
    DateTime RequestedAt,
    int? HandledBy,
    DateTime? HandledAt,
    string? ResolutionCode,
    DateTime? CreatedAt,
    DateTime? UpdatedAt);

public sealed record MemberVettingStatus(
    SafeguardingPolicyState Policy,
    string Decision,
    string? ReviewStatus,
    DateTime? ConfirmedAt,
    DateTime? RevokedAt);

public sealed record VettingMemberListItem(
    int UserId,
    string FirstName,
    string LastName,
    string Email,
    string? AvatarUrl,
    long? AttestationId,
    string Decision,
    int? ConfirmedBy,
    DateTime? ConfirmedAt,
    int? RevokedBy,
    DateTime? RevokedAt,
    string? RevocationReasonCode,
    string? PolicyVersion,
    long? ReviewRequestId,
    string? ReviewStatus,
    DateTime? RequestedAt,
    SafeguardingPolicyState Policy);

public sealed record VettingPagination(int CurrentPage, int PerPage, int Total, int LastPage);

public sealed record VettingMemberListResult(
    IReadOnlyList<VettingMemberListItem> Data,
    VettingPagination Pagination);

public sealed record VettingStats(
    int TotalMembers,
    int Confirmed,
    int Revoked,
    int NotConfirmed,
    int ReviewRequested,
    SafeguardingPolicyState Policy);

public sealed record SafeguardingTriggerState(
    bool RequiresVettedInteraction,
    bool RequiresBrokerApproval,
    bool RestrictsMessaging,
    bool RestrictsMatching,
    bool NotifyAdminOnSelection,
    IReadOnlyList<string> VettingTypesRequired);

public sealed record SafeguardingInteractionDecision(
    string Status,
    string Code,
    int RecipientTenantId,
    string PurposeCode,
    string ScopeType,
    string ScopeIdentifier,
    string? PolicyVersion = null,
    IReadOnlyList<string>? RequiredAttestationCodes = null,
    IReadOnlyList<string>? RequiredAttestationLabels = null,
    bool CanRequestCoordinator = false)
{
    public const string Allow = "allow";
    public const string Deny = "deny";
    public const string Unavailable = "unavailable";

    public bool IsAllowed => Status == Allow;
    public bool IsDenied => Status == Deny;
    public bool IsUnavailable => Status == Unavailable;
}
