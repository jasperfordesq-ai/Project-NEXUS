// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Metadata-only current-policy attestation and review workflow. Certificate
/// evidence and legacy VettingRecord rows are deliberately outside this service.
/// </summary>
public sealed class MemberVettingAttestationService
{
    public static IReadOnlySet<string> RevocationReasonCodes => SafeguardingVettingCatalog.RevocationReasonCodes;
    public static IReadOnlySet<string> ReviewResolutionCodes => SafeguardingVettingCatalog.ReviewResolutionCodes;

    private readonly NexusDbContext _db;
    private readonly SafeguardingJurisdictionService _jurisdictions;
    private readonly SafeguardingVettingNotificationService _notifications;

    public MemberVettingAttestationService(
        NexusDbContext db,
        SafeguardingJurisdictionService jurisdictions,
        SafeguardingVettingNotificationService notifications)
    {
        _db = db;
        _jurisdictions = jurisdictions;
        _notifications = notifications;
    }

    public async Task<VettingAttestationRecord> ConfirmForCurrentPolicyAsync(
        int tenantId,
        int memberId,
        int actorUserId,
        long? reviewRequestId = null,
        CancellationToken cancellationToken = default)
    {
        await AssertMemberBelongsToTenantAsync(memberId, tenantId, cancellationToken);
        await AssertActorMayDecideForMemberAsync(actorUserId, memberId, tenantId, cancellationToken);
        var ownsWorkflow = _db.Database.CurrentTransaction is null;
        await using var transaction = await BeginIfNeededAsync(cancellationToken);
        var policy = _jurisdictions.RequireAvailablePolicy(
            await _jurisdictions.LockPolicyForUpdateAsync(tenantId, cancellationToken));
        await SafeguardingDatabaseLocks.LockMemberAttestationsAsync(
            _db,
            tenantId,
            memberId,
            cancellationToken);

        var existing = await DecisionScopeQuery(tenantId, memberId, policy)
            .SingleOrDefaultAsync(cancellationToken);
        if (existing is not null
            && existing.Decision == MemberVettingAttestation.ConfirmedDecision
            && existing.PolicyVersion == policy.PolicyVersion)
        {
            await ResolvePendingReviewsAsync(
                tenantId,
                memberId,
                policy,
                actorUserId,
                "confirmed",
                reviewRequestId,
                cancellationToken);
            await _db.SaveChangesAsync(cancellationToken);
            await CommitIfOwnedAsync(transaction, cancellationToken);
            var unchanged = await MapAttestationAsync(existing, includeMember: true, cancellationToken);
            if (ownsWorkflow)
            {
                await _notifications.NotifyMemberStatusUpdatedAsync(tenantId, memberId, cancellationToken);
            }
            return unchanged;
        }

        var now = DateTime.UtcNow;
        var before = existing?.Decision;
        var eventType = existing is null ? "confirmed" : "reconfirmed";
        if (existing is null)
        {
            existing = new MemberVettingAttestation
            {
                TenantId = tenantId,
                UserId = memberId,
                SchemeCode = policy.SchemeCode!,
                AttestationCode = policy.AttestationCode!,
                PurposeCode = policy.PurposeCode,
                ScopeType = policy.ScopeType,
                ScopeIdentifier = policy.ScopeIdentifier,
                CreatedAt = now
            };
            _db.MemberVettingAttestations.Add(existing);
        }

        existing.Decision = MemberVettingAttestation.ConfirmedDecision;
        existing.ConfirmedByUserId = actorUserId;
        existing.ConfirmedAt = now;
        existing.RevokedByUserId = null;
        existing.RevokedAt = null;
        existing.RevocationReasonCode = null;
        existing.PolicyVersion = policy.PolicyVersion!;
        existing.UpdatedAt = now;
        await _db.SaveChangesAsync(cancellationToken);
        AppendDecisionEvent(existing, actorUserId, policy, eventType, before,
            MemberVettingAttestation.ConfirmedDecision, null, now);
        await ResolvePendingReviewsAsync(
            tenantId,
            memberId,
            policy,
            actorUserId,
            "confirmed",
            reviewRequestId,
            cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
        await CommitIfOwnedAsync(transaction, cancellationToken);

        var result = await MapAttestationAsync(existing, includeMember: true, cancellationToken);
        if (ownsWorkflow)
        {
            await _notifications.NotifyMemberStatusUpdatedAsync(tenantId, memberId, cancellationToken);
        }
        return result;
    }

    public async Task<VettingAttestationRecord> RevokeForCurrentPolicyAsync(
        int tenantId,
        int memberId,
        int actorUserId,
        string reasonCode = "community_decision_withdrawn",
        long? reviewRequestId = null,
        CancellationToken cancellationToken = default)
    {
        if (!RevocationReasonCodes.Contains(reasonCode))
        {
            throw new SafeguardingPolicyException("INVALID_VETTING_REVOCATION_REASON");
        }
        await AssertMemberBelongsToTenantAsync(memberId, tenantId, cancellationToken);
        await AssertActorMayDecideForMemberAsync(actorUserId, memberId, tenantId, cancellationToken);
        var ownsWorkflow = _db.Database.CurrentTransaction is null;
        await using var transaction = await BeginIfNeededAsync(cancellationToken);
        var policy = _jurisdictions.RequireAvailablePolicy(
            await _jurisdictions.LockPolicyForUpdateAsync(tenantId, cancellationToken));
        await SafeguardingDatabaseLocks.LockMemberAttestationsAsync(
            _db,
            tenantId,
            memberId,
            cancellationToken);
        var existing = await DecisionScopeQuery(tenantId, memberId, policy)
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new SafeguardingPolicyException("VETTING_CONFIRMATION_NOT_FOUND");

        if (existing.Decision == MemberVettingAttestation.RevokedDecision)
        {
            await ResolvePendingReviewsAsync(
                tenantId,
                memberId,
                policy,
                actorUserId,
                "confirmation_withdrawn",
                reviewRequestId,
                cancellationToken);
            await _db.SaveChangesAsync(cancellationToken);
            await CommitIfOwnedAsync(transaction, cancellationToken);
            var unchanged = await MapAttestationAsync(existing, includeMember: true, cancellationToken);
            if (ownsWorkflow)
            {
                await _notifications.NotifyMemberStatusUpdatedAsync(tenantId, memberId, cancellationToken);
            }
            return unchanged;
        }

        var now = DateTime.UtcNow;
        var before = existing.Decision;
        existing.Decision = MemberVettingAttestation.RevokedDecision;
        existing.RevokedByUserId = actorUserId;
        existing.RevokedAt = now;
        existing.RevocationReasonCode = reasonCode;
        existing.UpdatedAt = now;
        AppendDecisionEvent(existing, actorUserId, policy, "revoked", before,
            MemberVettingAttestation.RevokedDecision, reasonCode, now);
        await ResolvePendingReviewsAsync(
            tenantId,
            memberId,
            policy,
            actorUserId,
            "confirmation_withdrawn",
            reviewRequestId,
            cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
        await CommitIfOwnedAsync(transaction, cancellationToken);

        var result = await MapAttestationAsync(existing, includeMember: true, cancellationToken);
        if (ownsWorkflow)
        {
            await _notifications.NotifyMemberStatusUpdatedAsync(tenantId, memberId, cancellationToken);
        }
        return result;
    }

    public async Task<VettingReviewRecord> RequestReviewAsync(
        int tenantId,
        int memberId,
        CancellationToken cancellationToken = default)
    {
        await AssertMemberBelongsToTenantAsync(memberId, tenantId, cancellationToken);
        var ownsWorkflow = _db.Database.CurrentTransaction is null;
        await using var transaction = await BeginIfNeededAsync(cancellationToken);
        var policy = _jurisdictions.RequireAvailablePolicy(
            await _jurisdictions.LockPolicyForUpdateAsync(tenantId, cancellationToken));

        var existing = await _db.SafeguardingVettingReviewRequests
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(review => review.TenantId == tenantId
                && review.UserId == memberId
                && review.PurposeCode == policy.PurposeCode
                && review.ScopeType == policy.ScopeType
                && review.ScopeIdentifier == policy.ScopeIdentifier, cancellationToken);
        var now = DateTime.UtcNow;
        var isCurrentPending = existing is not null
            && existing.Status == SafeguardingVettingReviewRequest.PendingStatus
            && existing.Jurisdiction == policy.Jurisdiction
            && existing.SchemeCode == policy.SchemeCode
            && existing.AttestationCode == policy.AttestationCode
            && existing.PolicyVersion == policy.PolicyVersion;

        if (existing is null)
        {
            existing = new SafeguardingVettingReviewRequest
            {
                TenantId = tenantId,
                UserId = memberId,
                PurposeCode = policy.PurposeCode,
                ScopeType = policy.ScopeType,
                ScopeIdentifier = policy.ScopeIdentifier,
                CreatedAt = now
            };
            _db.SafeguardingVettingReviewRequests.Add(existing);
        }
        if (!isCurrentPending)
        {
            existing.Jurisdiction = policy.Jurisdiction;
            existing.SchemeCode = policy.SchemeCode!;
            existing.AttestationCode = policy.AttestationCode!;
            existing.PolicyVersion = policy.PolicyVersion!;
            existing.Status = SafeguardingVettingReviewRequest.PendingStatus;
            existing.RequestSource = SafeguardingVettingReviewRequest.MemberRequestSource;
            existing.RequestedByUserId = memberId;
            existing.RequestedAt = now;
            existing.HandledByUserId = null;
            existing.HandledAt = null;
            existing.ResolutionCode = null;
            existing.UpdatedAt = now;
        }

        await _db.SaveChangesAsync(cancellationToken);
        await CommitIfOwnedAsync(transaction, cancellationToken);
        var result = MapReview(existing);
        if (ownsWorkflow)
        {
            await _notifications.NotifyDecisionMakersOfReviewRequestAsync(tenantId, cancellationToken);
        }
        return result;
    }

    public async Task<VettingReviewRecord> ResolveReviewAsync(
        int tenantId,
        long reviewRequestId,
        int actorUserId,
        string resolutionCode,
        CancellationToken cancellationToken = default)
    {
        if (!ReviewResolutionCodes.Contains(resolutionCode))
        {
            throw new SafeguardingPolicyException("INVALID_VETTING_REVIEW_RESOLUTION");
        }
        await AssertActorExistsAsync(actorUserId, tenantId, cancellationToken);
        await using var transaction = await BeginIfNeededAsync(cancellationToken);
        await SafeguardingDatabaseLocks.AcquireTenantPolicyLockAsync(_db, tenantId, cancellationToken);
        var review = await _db.SafeguardingVettingReviewRequests
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(candidate => candidate.TenantId == tenantId
                && candidate.Id == reviewRequestId, cancellationToken)
            ?? throw new SafeguardingPolicyException("VETTING_REVIEW_REQUEST_NOT_FOUND");
        if (review.Status != SafeguardingVettingReviewRequest.PendingStatus)
        {
            await CommitIfOwnedAsync(transaction, cancellationToken);
            return MapReview(review);
        }

        var now = DateTime.UtcNow;
        review.Status = SafeguardingVettingReviewRequest.CompletedStatus;
        review.HandledByUserId = actorUserId;
        review.HandledAt = now;
        review.ResolutionCode = resolutionCode;
        review.UpdatedAt = now;
        await _db.SaveChangesAsync(cancellationToken);
        await CommitIfOwnedAsync(transaction, cancellationToken);
        return MapReview(review);
    }

    public async Task<bool> HasConfirmedAttestationAsync(
        int tenantId,
        int memberId,
        string schemeCode,
        string attestationCode,
        string purposeCode,
        string scopeType = SafeguardingVettingCatalog.TenantScope,
        string scopeIdentifier = "",
        string? policyVersion = null,
        CancellationToken cancellationToken = default)
    {
        var query = _db.MemberVettingAttestations.IgnoreQueryFilters().AsNoTracking()
            .Where(attestation => attestation.TenantId == tenantId
                && attestation.UserId == memberId
                && attestation.SchemeCode == schemeCode
                && attestation.AttestationCode == attestationCode
                && attestation.PurposeCode == purposeCode
                && attestation.ScopeType == scopeType
                && attestation.ScopeIdentifier == scopeIdentifier
                && attestation.Decision == MemberVettingAttestation.ConfirmedDecision
                && attestation.ConfirmedByUserId != null
                && attestation.ConfirmedAt != null
                && attestation.RevokedAt == null);
        if (policyVersion is not null)
        {
            query = query.Where(attestation => attestation.PolicyVersion == policyVersion);
        }
        return await query.AnyAsync(cancellationToken);
    }

    public Task LockMemberAttestationsForUpdateAsync(
        int tenantId,
        int memberId,
        CancellationToken cancellationToken = default)
        => SafeguardingDatabaseLocks.LockMemberAttestationsAsync(
            _db,
            tenantId,
            memberId,
            cancellationToken);

    public async Task<MemberVettingStatus> GetMemberStatusAsync(
        int tenantId,
        int memberId,
        CancellationToken cancellationToken = default)
    {
        var policy = await _jurisdictions.GetPolicyAsync(tenantId, cancellationToken);
        if (!policy.Configured || !policy.ContactPolicyAvailable || policy.AttestationCode is null)
        {
            return new(policy, "not_confirmed", null, null, null);
        }

        var attestation = await CurrentPolicyDecisionQuery(tenantId, memberId, policy)
            .AsNoTracking()
            .SingleOrDefaultAsync(cancellationToken);
        var review = await CurrentPolicyReviewQuery(tenantId, memberId, policy)
            .AsNoTracking()
            .SingleOrDefaultAsync(cancellationToken);
        return new(
            policy,
            attestation?.Decision ?? "not_confirmed",
            review?.Status,
            attestation?.ConfirmedAt,
            attestation?.RevokedAt);
    }

    public async Task<VettingMemberListResult> ListMembersAsync(
        int tenantId,
        string? status = null,
        string? search = null,
        int page = 1,
        int perPage = 25,
        CancellationToken cancellationToken = default)
    {
        var policy = await _jurisdictions.GetPolicyAsync(tenantId, cancellationToken);
        page = Math.Max(1, page);
        perPage = Math.Clamp(perPage, 1, 100);
        var users = _db.Users.IgnoreQueryFilters().AsNoTracking()
            .Where(user => user.TenantId == tenantId
                && (user.IsActive
                    || user.SuspendedAt != null
                    || user.RegistrationStatus != RegistrationStatus.Active));
        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalized = search.Trim().ToLower();
            users = users.Where(user => user.FirstName.ToLower().Contains(normalized)
                || user.LastName.ToLower().Contains(normalized)
                || user.Email.ToLower().Contains(normalized));
        }

        var hasCurrentPolicy = policy.AttestationCode is not null
            && policy.SchemeCode is not null
            && policy.PolicyVersion is not null;
        var normalizedStatus = status?.Trim() ?? "all";
        if (hasCurrentPolicy)
        {
            users = normalizedStatus switch
            {
                "confirmed" => users.Where(user => _db.MemberVettingAttestations.IgnoreQueryFilters()
                    .Any(attestation => attestation.TenantId == tenantId
                        && attestation.UserId == user.Id
                        && attestation.SchemeCode == policy.SchemeCode
                        && attestation.AttestationCode == policy.AttestationCode
                        && attestation.PurposeCode == policy.PurposeCode
                        && attestation.ScopeType == policy.ScopeType
                        && attestation.ScopeIdentifier == policy.ScopeIdentifier
                        && attestation.PolicyVersion == policy.PolicyVersion
                        && attestation.Decision == MemberVettingAttestation.ConfirmedDecision)),
                "revoked" => users.Where(user => _db.MemberVettingAttestations.IgnoreQueryFilters()
                    .Any(attestation => attestation.TenantId == tenantId
                        && attestation.UserId == user.Id
                        && attestation.SchemeCode == policy.SchemeCode
                        && attestation.AttestationCode == policy.AttestationCode
                        && attestation.PurposeCode == policy.PurposeCode
                        && attestation.ScopeType == policy.ScopeType
                        && attestation.ScopeIdentifier == policy.ScopeIdentifier
                        && attestation.PolicyVersion == policy.PolicyVersion
                        && attestation.Decision == MemberVettingAttestation.RevokedDecision)),
                "review_requested" => users.Where(user => _db.SafeguardingVettingReviewRequests.IgnoreQueryFilters()
                    .Any(review => review.TenantId == tenantId
                        && review.UserId == user.Id
                        && review.SchemeCode == policy.SchemeCode
                        && review.AttestationCode == policy.AttestationCode
                        && review.PurposeCode == policy.PurposeCode
                        && review.ScopeType == policy.ScopeType
                        && review.ScopeIdentifier == policy.ScopeIdentifier
                        && review.PolicyVersion == policy.PolicyVersion
                        && review.Status == SafeguardingVettingReviewRequest.PendingStatus)),
                "not_confirmed" => users.Where(user => !_db.MemberVettingAttestations.IgnoreQueryFilters()
                    .Any(attestation => attestation.TenantId == tenantId
                        && attestation.UserId == user.Id
                        && attestation.SchemeCode == policy.SchemeCode
                        && attestation.AttestationCode == policy.AttestationCode
                        && attestation.PurposeCode == policy.PurposeCode
                        && attestation.ScopeType == policy.ScopeType
                        && attestation.ScopeIdentifier == policy.ScopeIdentifier
                        && attestation.PolicyVersion == policy.PolicyVersion
                        && attestation.Decision == MemberVettingAttestation.ConfirmedDecision)),
                _ => users
            };
        }
        else if (normalizedStatus is "confirmed" or "revoked" or "review_requested")
        {
            users = users.Where(_ => false);
        }

        var total = await users.CountAsync(cancellationToken);
        var orderedUsers = hasCurrentPolicy
            ? users.OrderBy(user => _db.SafeguardingVettingReviewRequests.IgnoreQueryFilters()
                    .Any(review => review.TenantId == tenantId
                        && review.UserId == user.Id
                        && review.SchemeCode == policy.SchemeCode
                        && review.AttestationCode == policy.AttestationCode
                        && review.PurposeCode == policy.PurposeCode
                        && review.ScopeType == policy.ScopeType
                        && review.ScopeIdentifier == policy.ScopeIdentifier
                        && review.PolicyVersion == policy.PolicyVersion
                        && review.Status == SafeguardingVettingReviewRequest.PendingStatus)
                    ? 0
                    : 1)
                .ThenBy(user => user.FirstName)
                .ThenBy(user => user.LastName)
            : users.OrderBy(user => user.FirstName).ThenBy(user => user.LastName);
        var pageUsers = await orderedUsers
            .Skip((page - 1) * perPage)
            .Take(perPage)
            .ToListAsync(cancellationToken);
        var userIds = pageUsers.Select(user => user.Id).ToArray();
        var attestations = hasCurrentPolicy
            ? await _db.MemberVettingAttestations.IgnoreQueryFilters().AsNoTracking()
                .Where(attestation => attestation.TenantId == tenantId
                    && userIds.Contains(attestation.UserId)
                    && attestation.SchemeCode == policy.SchemeCode
                    && attestation.AttestationCode == policy.AttestationCode
                    && attestation.PurposeCode == policy.PurposeCode
                    && attestation.ScopeType == policy.ScopeType
                    && attestation.ScopeIdentifier == policy.ScopeIdentifier
                    && attestation.PolicyVersion == policy.PolicyVersion)
                .ToDictionaryAsync(attestation => attestation.UserId, cancellationToken)
            : new Dictionary<int, MemberVettingAttestation>();
        var reviews = hasCurrentPolicy
            ? await _db.SafeguardingVettingReviewRequests.IgnoreQueryFilters().AsNoTracking()
                .Where(review => review.TenantId == tenantId
                    && userIds.Contains(review.UserId)
                    && review.SchemeCode == policy.SchemeCode
                    && review.AttestationCode == policy.AttestationCode
                    && review.PurposeCode == policy.PurposeCode
                    && review.ScopeType == policy.ScopeType
                    && review.ScopeIdentifier == policy.ScopeIdentifier
                    && review.PolicyVersion == policy.PolicyVersion)
                .ToDictionaryAsync(review => review.UserId, cancellationToken)
            : new Dictionary<int, SafeguardingVettingReviewRequest>();

        var data = pageUsers
            .Select(user =>
            {
                attestations.TryGetValue(user.Id, out var attestation);
                reviews.TryGetValue(user.Id, out var review);
                return new VettingMemberListItem(
                    user.Id,
                    user.FirstName,
                    user.LastName,
                    user.Email,
                    user.AvatarUrl,
                    attestation?.Id,
                    attestation?.Decision ?? "not_confirmed",
                    attestation?.ConfirmedByUserId,
                    attestation?.ConfirmedAt,
                    attestation?.RevokedByUserId,
                    attestation?.RevokedAt,
                    attestation?.RevocationReasonCode,
                    attestation?.PolicyVersion,
                    review?.Id,
                    review?.Status,
                    review?.RequestedAt,
                    policy);
            })
            .OrderBy(item => item.ReviewStatus == SafeguardingVettingReviewRequest.PendingStatus ? 0 : 1)
            .ThenBy(item => item.FirstName)
            .ThenBy(item => item.LastName)
            .ToArray();
        var lastPage = Math.Max(1, (int)Math.Ceiling(total / (double)perPage));
        return new(data, new(page, perPage, total, lastPage));
    }

    public async Task<VettingStats> StatsAsync(
        int tenantId,
        CancellationToken cancellationToken = default)
    {
        var policy = await _jurisdictions.GetPolicyAsync(tenantId, cancellationToken);
        var totalMembers = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(user => user.TenantId == tenantId
                && (user.IsActive
                    || user.SuspendedAt != null
                    || user.RegistrationStatus != RegistrationStatus.Active), cancellationToken);
        var confirmed = 0;
        var revoked = 0;
        var reviewRequested = 0;
        if (policy.SchemeCode is not null && policy.AttestationCode is not null && policy.PolicyVersion is not null)
        {
            var decisions = _db.MemberVettingAttestations.IgnoreQueryFilters().AsNoTracking()
                .Where(attestation => attestation.TenantId == tenantId
                    && attestation.SchemeCode == policy.SchemeCode
                    && attestation.AttestationCode == policy.AttestationCode
                    && attestation.PurposeCode == policy.PurposeCode
                    && attestation.ScopeType == policy.ScopeType
                    && attestation.ScopeIdentifier == policy.ScopeIdentifier
                    && attestation.PolicyVersion == policy.PolicyVersion);
            confirmed = await decisions.CountAsync(
                attestation => attestation.Decision == MemberVettingAttestation.ConfirmedDecision,
                cancellationToken);
            revoked = await decisions.CountAsync(
                attestation => attestation.Decision == MemberVettingAttestation.RevokedDecision,
                cancellationToken);
            reviewRequested = await CurrentPolicyReviewBaseQuery(tenantId, policy)
                .AsNoTracking()
                .CountAsync(review => review.Status == SafeguardingVettingReviewRequest.PendingStatus, cancellationToken);
        }
        return new(totalMembers, confirmed, revoked, Math.Max(0, totalMembers - confirmed), reviewRequested, policy);
    }

    public async Task<IReadOnlyList<VettingAttestationRecord>> GetUserRecordsAsync(
        int tenantId,
        int memberId,
        CancellationToken cancellationToken = default)
    {
        await AssertMemberBelongsToTenantAsync(memberId, tenantId, cancellationToken);
        var rows = await _db.MemberVettingAttestations.IgnoreQueryFilters().AsNoTracking()
            .Where(attestation => attestation.TenantId == tenantId && attestation.UserId == memberId)
            .OrderByDescending(attestation => attestation.UpdatedAt)
            .ToListAsync(cancellationToken);
        var result = new List<VettingAttestationRecord>(rows.Count);
        foreach (var row in rows)
        {
            result.Add(await MapAttestationAsync(row, includeMember: false, cancellationToken));
        }
        return result;
    }

    public async Task<VettingAttestationRecord?> GetByIdAsync(
        int tenantId,
        long attestationId,
        CancellationToken cancellationToken = default)
    {
        var row = await _db.MemberVettingAttestations.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(attestation => attestation.TenantId == tenantId
                && attestation.Id == attestationId, cancellationToken);
        return row is null ? null : await MapAttestationAsync(row, includeMember: true, cancellationToken);
    }

    public async Task<VettingReviewRecord?> GetReviewByIdAsync(
        int tenantId,
        long reviewId,
        CancellationToken cancellationToken = default)
    {
        var review = await _db.SafeguardingVettingReviewRequests.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(candidate => candidate.TenantId == tenantId
                && candidate.Id == reviewId, cancellationToken);
        return review is null ? null : MapReview(review);
    }

    private IQueryable<MemberVettingAttestation> DecisionScopeQuery(
        int tenantId,
        int memberId,
        SafeguardingPolicyState policy)
        => _db.MemberVettingAttestations.IgnoreQueryFilters()
            .Where(attestation => attestation.TenantId == tenantId
                && attestation.UserId == memberId
                && attestation.SchemeCode == policy.SchemeCode
                && attestation.AttestationCode == policy.AttestationCode
                && attestation.PurposeCode == policy.PurposeCode
                && attestation.ScopeType == policy.ScopeType
                && attestation.ScopeIdentifier == policy.ScopeIdentifier);

    private IQueryable<MemberVettingAttestation> CurrentPolicyDecisionQuery(
        int tenantId,
        int memberId,
        SafeguardingPolicyState policy)
        => DecisionScopeQuery(tenantId, memberId, policy)
            .Where(attestation => attestation.PolicyVersion == policy.PolicyVersion);

    private IQueryable<SafeguardingVettingReviewRequest> CurrentPolicyReviewBaseQuery(
        int tenantId,
        SafeguardingPolicyState policy)
        => _db.SafeguardingVettingReviewRequests.IgnoreQueryFilters()
            .Where(review => review.TenantId == tenantId
                && review.SchemeCode == policy.SchemeCode
                && review.AttestationCode == policy.AttestationCode
                && review.PurposeCode == policy.PurposeCode
                && review.ScopeType == policy.ScopeType
                && review.ScopeIdentifier == policy.ScopeIdentifier
                && review.PolicyVersion == policy.PolicyVersion);

    private IQueryable<SafeguardingVettingReviewRequest> CurrentPolicyReviewQuery(
        int tenantId,
        int memberId,
        SafeguardingPolicyState policy)
        => CurrentPolicyReviewBaseQuery(tenantId, policy).Where(review => review.UserId == memberId);

    private async Task ResolvePendingReviewsAsync(
        int tenantId,
        int memberId,
        SafeguardingPolicyState policy,
        int actorUserId,
        string resolutionCode,
        long? reviewRequestId,
        CancellationToken cancellationToken)
    {
        var reviews = await CurrentPolicyReviewQuery(tenantId, memberId, policy)
            .Where(review => review.Status == SafeguardingVettingReviewRequest.PendingStatus
                && (!reviewRequestId.HasValue || review.Id == reviewRequestId.Value))
            .ToListAsync(cancellationToken);
        var now = DateTime.UtcNow;
        foreach (var review in reviews)
        {
            review.Status = SafeguardingVettingReviewRequest.CompletedStatus;
            review.HandledByUserId = actorUserId;
            review.HandledAt = now;
            review.ResolutionCode = resolutionCode;
            review.UpdatedAt = now;
        }
    }

    private void AppendDecisionEvent(
        MemberVettingAttestation attestation,
        int actorUserId,
        SafeguardingPolicyState policy,
        string eventType,
        string? decisionBefore,
        string decisionAfter,
        string? reasonCode,
        DateTime now)
        => _db.MemberVettingAttestationEvents.Add(new MemberVettingAttestationEvent
        {
            AttestationId = attestation.Id,
            TenantId = attestation.TenantId,
            UserId = attestation.UserId,
            SchemeCode = policy.SchemeCode!,
            AttestationCode = policy.AttestationCode!,
            PurposeCode = policy.PurposeCode,
            ScopeType = policy.ScopeType,
            ScopeIdentifier = policy.ScopeIdentifier,
            EventType = eventType,
            DecisionBefore = decisionBefore,
            DecisionAfter = decisionAfter,
            ReasonCode = reasonCode,
            ActorUserId = actorUserId,
            PolicyVersion = policy.PolicyVersion!,
            CreatedAt = now
        });

    private async Task AssertMemberBelongsToTenantAsync(
        int memberId,
        int tenantId,
        CancellationToken cancellationToken)
    {
        var exists = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(user => user.Id == memberId
                && user.TenantId == tenantId
                && (user.IsActive
                    || user.SuspendedAt != null
                    || user.RegistrationStatus != RegistrationStatus.Active), cancellationToken);
        if (!exists)
        {
            throw new SafeguardingPolicyException("MEMBER_NOT_FOUND");
        }
    }

    private async Task AssertActorMayDecideForMemberAsync(
        int actorUserId,
        int memberId,
        int tenantId,
        CancellationToken cancellationToken)
    {
        if (actorUserId == memberId)
        {
            throw new SafeguardingPolicyException("VETTING_SELF_CONFIRMATION_FORBIDDEN");
        }
        await AssertActorExistsAsync(actorUserId, tenantId, cancellationToken);
    }

    private async Task AssertActorExistsAsync(
        int actorUserId,
        int tenantId,
        CancellationToken cancellationToken)
    {
        var exists = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(user => user.Id == actorUserId
                && user.TenantId == tenantId
                && user.IsActive
                && user.SuspendedAt == null, cancellationToken);
        if (!exists)
        {
            throw new SafeguardingPolicyException("VETTING_DECISION_ACTOR_NOT_FOUND");
        }
    }

    private async Task<VettingAttestationRecord> MapAttestationAsync(
        MemberVettingAttestation attestation,
        bool includeMember,
        CancellationToken cancellationToken)
    {
        var confirmer = attestation.ConfirmedByUserId is null
            ? null
            : await _db.Users.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(user => user.TenantId == attestation.TenantId
                    && user.Id == attestation.ConfirmedByUserId, cancellationToken);
        var member = !includeMember
            ? null
            : await _db.Users.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(user => user.TenantId == attestation.TenantId
                    && user.Id == attestation.UserId, cancellationToken);
        var confirmerName = confirmer is null
            ? null
            : string.Join(' ', new[] { confirmer.FirstName, confirmer.LastName }
                .Where(part => !string.IsNullOrWhiteSpace(part)));
        return new(
            attestation.Id,
            attestation.UserId,
            attestation.SchemeCode,
            attestation.AttestationCode,
            attestation.PurposeCode,
            attestation.ScopeType,
            attestation.ScopeIdentifier,
            attestation.Decision,
            attestation.ConfirmedByUserId,
            attestation.ConfirmedAt,
            attestation.RevokedByUserId,
            attestation.RevokedAt,
            attestation.RevocationReasonCode,
            attestation.PolicyVersion,
            attestation.CreatedAt,
            attestation.UpdatedAt,
            string.IsNullOrWhiteSpace(confirmerName) ? null : confirmerName,
            member?.FirstName,
            member?.LastName,
            member?.Email,
            member?.AvatarUrl);
    }

    private static VettingReviewRecord MapReview(SafeguardingVettingReviewRequest review)
        => new(
            review.Id,
            review.UserId,
            review.Jurisdiction,
            review.SchemeCode,
            review.AttestationCode,
            review.PurposeCode,
            review.ScopeType,
            review.ScopeIdentifier,
            review.PolicyVersion,
            review.Status,
            review.RequestSource,
            review.RequestedByUserId,
            review.RequestedAt,
            review.HandledByUserId,
            review.HandledAt,
            review.ResolutionCode,
            review.CreatedAt,
            review.UpdatedAt);

    private async Task<IDbContextTransaction?> BeginIfNeededAsync(CancellationToken cancellationToken)
    {
        if (_db.Database.CurrentTransaction is not null || !_db.Database.IsRelational())
        {
            return null;
        }
        return await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
    }

    private static Task CommitIfOwnedAsync(
        IDbContextTransaction? transaction,
        CancellationToken cancellationToken)
        => transaction?.CommitAsync(cancellationToken) ?? Task.CompletedTask;
}
