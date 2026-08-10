// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Authoritative tenant safeguarding jurisdiction and policy-version lifecycle.
/// The tenant row is the mutex for policy, preference, review, and attestation writes.
/// </summary>
public sealed class SafeguardingJurisdictionService
{
    public const string PurposeSafeguardedMemberContact = SafeguardingVettingCatalog.PurposeSafeguardedMemberContact;
    public const string ScopeTenant = SafeguardingVettingCatalog.TenantScope;
    public const string Unconfigured = SafeguardingVettingCatalog.Unconfigured;

    private readonly NexusDbContext _db;
    private readonly SafeguardingPreferencePolicyService _preferences;
    private readonly SafeguardingVettingNotificationService _notifications;

    public SafeguardingJurisdictionService(
        NexusDbContext db,
        SafeguardingPreferencePolicyService preferences,
        SafeguardingVettingNotificationService notifications)
    {
        _db = db;
        _preferences = preferences;
        _notifications = notifications;
    }

    public IReadOnlyList<SafeguardingJurisdictionOption> AvailableJurisdictions()
        => SafeguardingVettingCatalog.AvailableJurisdictions();

    public async Task<SafeguardingPolicyState> GetPolicyAsync(
        int tenantId,
        CancellationToken cancellationToken = default)
    {
        var setting = await _db.TenantSafeguardingSettings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(row => row.TenantId == tenantId, cancellationToken);
        return PolicyFromSetting(setting);
    }

    public async Task<SafeguardingPolicyState> LockPolicyForUpdateAsync(
        int tenantId,
        CancellationToken cancellationToken = default)
    {
        if (_db.Database.IsRelational() && _db.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException("Safeguarding policy locks require an active database transaction.");
        }

        await SafeguardingDatabaseLocks.AcquireTenantPolicyLockAsync(_db, tenantId, cancellationToken);
        var setting = await _db.TenantSafeguardingSettings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(row => row.TenantId == tenantId, cancellationToken);
        return PolicyFromSetting(setting);
    }

    public async Task<SafeguardingPolicyConfigurationResult> ConfigureAsync(
        int tenantId,
        string jurisdiction,
        int actorUserId,
        CancellationToken cancellationToken = default)
    {
        jurisdiction = jurisdiction.Trim();
        if (jurisdiction != Unconfigured && !SafeguardingVettingCatalog.Policies.ContainsKey(jurisdiction))
        {
            throw new SafeguardingPolicyException("INVALID_SAFEGUARDING_JURISDICTION");
        }

        await AssertActorExistsAsync(tenantId, actorUserId, cancellationToken);
        await using var transaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        await SafeguardingDatabaseLocks.AcquireTenantPolicyLockAsync(_db, tenantId, cancellationToken);

        var setting = await _db.TenantSafeguardingSettings
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(row => row.TenantId == tenantId, cancellationToken);
        var previous = PolicyFromSetting(setting);
        var now = DateTime.UtcNow;
        SafeguardingPolicyDefinition? definition = null;

        if (jurisdiction == Unconfigured)
        {
            if (setting is not null)
            {
                _db.TenantSafeguardingSettings.Remove(setting);
            }
        }
        else
        {
            definition = SafeguardingVettingCatalog.Policies[jurisdiction];
            if (setting is null)
            {
                setting = new TenantSafeguardingSetting
                {
                    TenantId = tenantId,
                    CreatedAt = now
                };
                _db.TenantSafeguardingSettings.Add(setting);
            }

            if (!string.Equals(setting.Jurisdiction, jurisdiction, StringComparison.Ordinal))
            {
                setting.Jurisdiction = jurisdiction;
                setting.PolicyVersion = NewPolicyVersion(definition.BasePolicyVersion);
                setting.ConfiguredByUserId = actorUserId;
                setting.ConfiguredAt = now;
                setting.UpdatedAt = now;
            }
        }

        var nextPolicy = jurisdiction == Unconfigured
            ? UnconfiguredPolicy()
            : PolicyFromValues(setting!, definition!);
        var transition = await _preferences.ApplyForConfiguredPolicyAsync(
            tenantId,
            nextPolicy.Preset,
            previous.Jurisdiction != nextPolicy.Jurisdiction,
            actorUserId,
            cancellationToken);

        await _db.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        await _preferences.NotifyTransitionAsync(tenantId, transition, cancellationToken);
        return new(nextPolicy, transition);
    }

    public async Task<SafeguardingPolicyRotationResult> RotatePolicyVersionAsync(
        int tenantId,
        int actorUserId,
        string reasonCode,
        CancellationToken cancellationToken = default)
    {
        if (!SafeguardingVettingCatalog.RotationReasonCodes.Contains(reasonCode))
        {
            throw new SafeguardingPolicyException("INVALID_REASON_CODE");
        }
        await AssertActorExistsAsync(tenantId, actorUserId, cancellationToken);

        await using var transaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        await SafeguardingDatabaseLocks.AcquireTenantPolicyLockAsync(_db, tenantId, cancellationToken);
        var setting = await _db.TenantSafeguardingSettings
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(row => row.TenantId == tenantId, cancellationToken);
        var policy = PolicyFromSetting(setting);
        policy = RequireAvailablePolicy(policy);

        var previousVersion = policy.PolicyVersion!;
        var affectedMemberIds = await _db.MemberVettingAttestations
            .IgnoreQueryFilters()
            .Where(attestation => attestation.TenantId == tenantId
                && attestation.SchemeCode == policy.SchemeCode
                && attestation.AttestationCode == policy.AttestationCode
                && attestation.PurposeCode == policy.PurposeCode
                && attestation.ScopeType == policy.ScopeType
                && attestation.ScopeIdentifier == policy.ScopeIdentifier
                && attestation.PolicyVersion == previousVersion
                && attestation.Decision == MemberVettingAttestation.ConfirmedDecision)
            .Select(attestation => attestation.UserId)
            .Distinct()
            .ToListAsync(cancellationToken);

        var now = DateTime.UtcNow;
        var newVersion = NewPolicyVersion(previousVersion.Split(':', 2)[0]);
        setting!.PolicyVersion = newVersion;
        setting.ConfiguredByUserId = actorUserId;
        setting.ConfiguredAt = now;
        setting.UpdatedAt = now;

        var existingReviews = await _db.SafeguardingVettingReviewRequests
            .IgnoreQueryFilters()
            .Where(review => review.TenantId == tenantId
                && affectedMemberIds.Contains(review.UserId)
                && review.PurposeCode == policy.PurposeCode
                && review.ScopeType == policy.ScopeType
                && review.ScopeIdentifier == policy.ScopeIdentifier)
            .ToDictionaryAsync(review => review.UserId, cancellationToken);
        foreach (var memberId in affectedMemberIds)
        {
            if (!existingReviews.TryGetValue(memberId, out var review))
            {
                review = new SafeguardingVettingReviewRequest
                {
                    TenantId = tenantId,
                    UserId = memberId,
                    PurposeCode = policy.PurposeCode,
                    ScopeType = policy.ScopeType,
                    ScopeIdentifier = policy.ScopeIdentifier,
                    CreatedAt = now
                };
                _db.SafeguardingVettingReviewRequests.Add(review);
            }

            review.Jurisdiction = policy.Jurisdiction;
            review.SchemeCode = policy.SchemeCode!;
            review.AttestationCode = policy.AttestationCode!;
            review.PolicyVersion = newVersion;
            review.Status = SafeguardingVettingReviewRequest.PendingStatus;
            review.RequestSource = "policy_rotation";
            review.RequestedByUserId = actorUserId;
            review.RequestedAt = now;
            review.HandledByUserId = null;
            review.HandledAt = null;
            review.ResolutionCode = null;
            // Laravel updateOrInsert deliberately refreshes created_at for an
            // existing review row on every controlled policy rotation.
            review.CreatedAt = now;
            review.UpdatedAt = now;
        }

        _db.SafeguardingPolicyRotationEvents.Add(new SafeguardingPolicyRotationEvent
        {
            TenantId = tenantId,
            Jurisdiction = policy.Jurisdiction,
            SchemeCode = policy.SchemeCode!,
            AttestationCode = policy.AttestationCode!,
            PurposeCode = policy.PurposeCode,
            ScopeType = policy.ScopeType,
            ScopeIdentifier = policy.ScopeIdentifier,
            PreviousPolicyVersion = previousVersion,
            NewPolicyVersion = newVersion,
            ReasonCode = reasonCode,
            ActorUserId = actorUserId,
            AffectedMemberCount = affectedMemberIds.Count,
            CreatedAt = now
        });

        await _db.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        var rotatedPolicy = policy with { PolicyVersion = newVersion };
        await _notifications.NotifyPolicyRotationMembersAsync(
            tenantId,
            affectedMemberIds,
            cancellationToken);
        return new(rotatedPolicy, reasonCode, affectedMemberIds.Count, affectedMemberIds);
    }

    internal SafeguardingPolicyState RequireAvailablePolicy(SafeguardingPolicyState policy)
    {
        if (!policy.Configured)
        {
            throw new SafeguardingPolicyException("SAFEGUARDING_JURISDICTION_REQUIRED");
        }
        if (!policy.ContactPolicyAvailable
            || policy.SchemeCode is null
            || policy.AttestationCode is null
            || policy.PolicyVersion is null)
        {
            throw new SafeguardingPolicyException("SAFEGUARDING_POLICY_UNAVAILABLE");
        }
        return policy;
    }

    private async Task AssertActorExistsAsync(
        int tenantId,
        int actorUserId,
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

    private static SafeguardingPolicyState PolicyFromSetting(TenantSafeguardingSetting? setting)
    {
        if (setting is null
            || !SafeguardingVettingCatalog.Policies.TryGetValue(setting.Jurisdiction, out var definition))
        {
            return UnconfiguredPolicy();
        }
        return PolicyFromValues(setting, definition);
    }

    private static SafeguardingPolicyState PolicyFromValues(
        TenantSafeguardingSetting setting,
        SafeguardingPolicyDefinition definition)
        => new(
            true,
            definition.ContactPolicyAvailable,
            setting.Jurisdiction,
            definition.SchemeCode,
            definition.AttestationCode,
            PurposeSafeguardedMemberContact,
            ScopeTenant,
            string.Empty,
            string.IsNullOrWhiteSpace(setting.PolicyVersion)
                ? definition.BasePolicyVersion
                : setting.PolicyVersion,
            definition.Label,
            definition.AttestationLabel,
            definition.Preset);

    private static SafeguardingPolicyState UnconfiguredPolicy()
        => new(
            false,
            false,
            Unconfigured,
            null,
            null,
            PurposeSafeguardedMemberContact,
            ScopeTenant,
            string.Empty,
            null,
            "Safeguarding jurisdiction not configured",
            null,
            null);

    private static string NewPolicyVersion(string baseVersion)
        => $"{baseVersion}:{Guid.NewGuid():D}";
}
