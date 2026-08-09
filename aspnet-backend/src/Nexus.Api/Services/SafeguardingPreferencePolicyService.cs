// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Applies jurisdiction presets without silently removing a member's active
/// protection. Selected stale protective options are preserved; transitions to
/// unavailable policy preserve every selected preset option and require review.
/// </summary>
public sealed class SafeguardingPreferencePolicyService
{
    private const string LegacySafeguardingMonitoringReason =
        "Safeguarding: self-identified during onboarding";
    private static readonly string[] ProtectiveTriggerKeys =
    [
        "requires_vetted_interaction",
        "requires_broker_approval",
        "restricts_messaging",
        "restricts_matching"
    ];

    private readonly NexusDbContext _db;
    private readonly SafeguardingVettingNotificationService _notifications;
    private readonly ILogger<SafeguardingPreferencePolicyService> _logger;

    public SafeguardingPreferencePolicyService(
        NexusDbContext db,
        SafeguardingVettingNotificationService notifications,
        ILogger<SafeguardingPreferencePolicyService> logger)
    {
        _db = db;
        _notifications = notifications;
        _logger = logger;
    }

    public async Task<SafeguardingPreferenceTransitionResult> ReplaceCountryPresetAsync(
        int tenantId,
        string presetKey,
        bool requireMemberReview,
        CancellationToken cancellationToken = default)
    {
        var ownsWorkflow = _db.Database.CurrentTransaction is null;
        await using var transaction = await BeginIfNeededAsync(cancellationToken);
        await SafeguardingDatabaseLocks.AcquireTenantPolicyLockAsync(_db, tenantId, cancellationToken);

        var result = await ReplaceCountryPresetCoreAsync(
            tenantId,
            presetKey,
            requireMemberReview,
            cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        if (ownsWorkflow && result.ReviewUserIds.Count > 0)
        {
            await _notifications.NotifyJurisdictionReviewRequiredAsync(
                tenantId,
                result.ReviewUserIds,
                cancellationToken);
        }
        return result;
    }

    public async Task<SafeguardingPreferenceTransitionResult> PreservePresetProtectionsForUnavailablePolicyAsync(
        int tenantId,
        int? actorUserId,
        CancellationToken cancellationToken = default)
    {
        var ownsWorkflow = _db.Database.CurrentTransaction is null;
        await using var transaction = await BeginIfNeededAsync(cancellationToken);
        await SafeguardingDatabaseLocks.AcquireTenantPolicyLockAsync(_db, tenantId, cancellationToken);

        var result = await PreserveUnavailableCoreAsync(tenantId, actorUserId, cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        if (ownsWorkflow && result.ReviewUserIds.Count > 0)
        {
            await _notifications.NotifyJurisdictionReviewRequiredAsync(
                tenantId,
                result.ReviewUserIds,
                cancellationToken);
        }
        return result;
    }

    public async Task<int> ConfirmMemberPolicyReviewAsync(
        int tenantId,
        int memberId,
        CancellationToken cancellationToken = default)
    {
        var memberExists = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(user => user.TenantId == tenantId && user.Id == memberId && user.IsActive, cancellationToken);
        if (!memberExists)
        {
            throw new SafeguardingPolicyException("MEMBER_NOT_FOUND");
        }

        await using var transaction = await BeginIfNeededAsync(cancellationToken);
        await SafeguardingDatabaseLocks.AcquireTenantPolicyLockAsync(_db, tenantId, cancellationToken);
        var preferences = await _db.UserSafeguardingPreferences.IgnoreQueryFilters()
            .Where(preference => preference.TenantId == tenantId
                && preference.UserId == memberId
                && preference.RevokedAt == null
                && preference.PolicyReviewRequiredAt != null)
            .ToListAsync(cancellationToken);
        var now = DateTime.UtcNow;
        foreach (var preference in preferences)
        {
            preference.PolicyReviewRequiredAt = null;
            preference.PolicyReviewReasonCode = null;
            preference.ConsentGivenAt = now;
            preference.UpdatedAt = now;
        }
        await _db.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }
        return preferences.Count;
    }

    public async Task<bool> RevokeMemberPreferenceAsync(
        int tenantId,
        int memberId,
        int optionId,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        var preference = await _db.UserSafeguardingPreferences
            .IgnoreQueryFilters()
            .Include(row => row.Option)
            .Where(row => row.TenantId == tenantId
                && row.UserId == memberId
                && row.OptionId == optionId
                && row.RevokedAt == null)
            .OrderBy(row => row.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (preference is null)
        {
            return false;
        }

        var now = DateTime.UtcNow;
        preference.RevokedAt = now;
        preference.UpdatedAt = now;
        _db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId,
            UserId = memberId,
            Action = "safeguarding_consent_revoked",
            EntityType = "user",
            EntityId = memberId,
            Metadata = JsonSerializer.Serialize(new { option_id = optionId }),
            Severity = AuditSeverity.Info,
            CreatedAt = now
        });

        var legacyRestriction = await _db.UserMonitoringRestrictions
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(row => row.TenantId == tenantId
                && row.UserId == memberId
                && row.Reason == LegacySafeguardingMonitoringReason, cancellationToken);
        if (legacyRestriction is not null)
        {
            legacyRestriction.UnderMonitoring = false;
            legacyRestriction.RequiresBrokerApproval = false;
            legacyRestriction.UpdatedAt = now;
        }

        var member = await _db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(user => user.TenantId == tenantId && user.Id == memberId, cancellationToken);
        var optionLabel = SafeguardingVettingCatalog.EnglishOptionLabel(
            preference.Option?.OptionKey,
            preference.Option?.Label,
            preference.Option?.PresetSource);

        await _db.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        await _notifications.NotifyConsentRevokedAsync(
            tenantId,
            member?.FirstName,
            member?.LastName,
            memberId,
            optionLabel,
            cancellationToken);
        return true;
    }

    internal async Task<SafeguardingPreferenceTransitionResult> ApplyForConfiguredPolicyAsync(
        int tenantId,
        string? preset,
        bool requireMemberReview,
        int actorUserId,
        CancellationToken cancellationToken)
    {
        if (preset is not null)
        {
            return await ReplaceCountryPresetCoreAsync(
                tenantId,
                preset,
                requireMemberReview,
                cancellationToken);
        }

        return await PreserveUnavailableCoreAsync(tenantId, actorUserId, cancellationToken);
    }

    internal Task NotifyTransitionAsync(
        int tenantId,
        SafeguardingPreferenceTransitionResult transition,
        CancellationToken cancellationToken)
        => transition.ReviewUserIds.Count == 0
            ? Task.CompletedTask
            : _notifications.NotifyJurisdictionReviewRequiredAsync(
                tenantId,
                transition.ReviewUserIds,
                cancellationToken);

    private async Task<SafeguardingPreferenceTransitionResult> ReplaceCountryPresetCoreAsync(
        int tenantId,
        string presetKey,
        bool requireMemberReview,
        CancellationToken cancellationToken)
    {
        var definitions = SafeguardingVettingCatalog.PresetOptions(presetKey);
        if (definitions.Count == 0)
        {
            return EmptyTransition();
        }

        var now = DateTime.UtcNow;
        var created = new List<string>();
        var updated = new List<string>();
        var deactivated = new List<string>();
        var preserved = new List<string>();

        var activePreferences = await _db.UserSafeguardingPreferences
            .IgnoreQueryFilters()
            .Where(preference => preference.TenantId == tenantId && preference.RevokedAt == null)
            .ToListAsync(cancellationToken);
        var affectedUserIds = activePreferences.Select(preference => preference.UserId).Distinct().ToArray();

        var options = await _db.SafeguardingOptions
            .IgnoreQueryFilters()
            .Where(option => option.TenantId == tenantId)
            .ToListAsync(cancellationToken);
        var optionById = options.ToDictionary(option => option.Id);
        var reviewUserIds = requireMemberReview
            ? activePreferences
                .Where(preference => optionById.TryGetValue(preference.OptionId, out var option)
                    && option.PresetSource is not null)
                .Select(preference => preference.UserId)
                .Distinct()
                .ToArray()
            : Array.Empty<int>();

        var newKeys = definitions.Select(definition => definition.OptionKey).ToHashSet(StringComparer.Ordinal);
        foreach (var stale in options.Where(option => option.IsActive
                     && option.PresetSource is not null
                     && !newKeys.Contains(option.OptionKey)))
        {
            var selected = activePreferences.Where(preference => preference.OptionId == stale.Id).ToArray();
            if (selected.Length > 0 && HasProtectiveTriggers(stale.TriggersJson))
            {
                preserved.Add(stale.OptionKey);
                continue;
            }

            stale.IsActive = false;
            stale.UpdatedAt = now;
            foreach (var preference in selected)
            {
                preference.RevokedAt = now;
                preference.UpdatedAt = now;
            }
            deactivated.Add(stale.OptionKey);
        }

        var sortOrder = 0;
        foreach (var definition in definitions)
        {
            sortOrder += 10;
            var option = options.FirstOrDefault(candidate => candidate.OptionKey == definition.OptionKey);
            if (option is null)
            {
                option = new SafeguardingOption
                {
                    TenantId = tenantId,
                    OptionKey = definition.OptionKey,
                    CreatedAt = now
                };
                _db.SafeguardingOptions.Add(option);
                options.Add(option);
                created.Add(definition.OptionKey);
            }
            else
            {
                updated.Add(definition.OptionKey);
            }

            option.OptionType = definition.OptionType;
            option.Label = definition.Label;
            option.Description = definition.Description;
            option.HelpUrl = definition.HelpUrl;
            option.SortOrder = sortOrder;
            option.IsActive = true;
            option.IsRequired = false;
            option.SelectOptionsJson = null;
            option.TriggersJson = JsonSerializer.Serialize(definition.Triggers);
            option.PresetSource = presetKey;
            option.UpdatedAt = now;
        }

        MarkPolicyReview(activePreferences, reviewUserIds, now);
        _logger.LogInformation(
            "Safeguarding preset {Preset} applied for tenant {TenantId}; affected users {AffectedCount}, review users {ReviewCount}",
            presetKey,
            tenantId,
            affectedUserIds.Length,
            reviewUserIds.Length);

        return new(created, updated, deactivated, preserved, reviewUserIds.Length, reviewUserIds);
    }

    private async Task<SafeguardingPreferenceTransitionResult> PreserveUnavailableCoreAsync(
        int tenantId,
        int? actorUserId,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var options = await _db.SafeguardingOptions
            .IgnoreQueryFilters()
            .Where(option => option.TenantId == tenantId
                && option.PresetSource != null
                && option.IsActive)
            .ToListAsync(cancellationToken);
        if (options.Count == 0)
        {
            return EmptyTransition();
        }

        var optionIds = options.Select(option => option.Id).ToArray();
        var activePreferences = await _db.UserSafeguardingPreferences
            .IgnoreQueryFilters()
            .Where(preference => preference.TenantId == tenantId
                && optionIds.Contains(preference.OptionId)
                && preference.RevokedAt == null)
            .ToListAsync(cancellationToken);
        var selectedOptionIds = activePreferences.Select(preference => preference.OptionId).ToHashSet();
        var preserved = options.Where(option => selectedOptionIds.Contains(option.Id)).ToArray();
        var deactivated = options.Where(option => !selectedOptionIds.Contains(option.Id)).ToArray();
        foreach (var option in deactivated)
        {
            option.IsActive = false;
            option.UpdatedAt = now;
        }

        var reviewUserIds = activePreferences.Select(preference => preference.UserId).Distinct().ToArray();
        MarkPolicyReview(activePreferences, reviewUserIds, now);
        _logger.LogInformation(
            "Safeguarding preset protections preserved fail-closed for tenant {TenantId} by actor {ActorUserId}; review users {ReviewCount}",
            tenantId,
            actorUserId,
            reviewUserIds.Length);

        return new(
            Array.Empty<string>(),
            Array.Empty<string>(),
            deactivated.Select(option => option.OptionKey).ToArray(),
            preserved.Select(option => option.OptionKey).ToArray(),
            reviewUserIds.Length,
            reviewUserIds);
    }

    private static void MarkPolicyReview(
        IEnumerable<UserSafeguardingPreference> activePreferences,
        IReadOnlyCollection<int> reviewUserIds,
        DateTime now)
    {
        if (reviewUserIds.Count == 0)
        {
            return;
        }

        var users = reviewUserIds.ToHashSet();
        foreach (var preference in activePreferences.Where(preference => users.Contains(preference.UserId)))
        {
            preference.PolicyReviewRequiredAt = now;
            preference.PolicyReviewReasonCode = "jurisdiction_changed";
            preference.UpdatedAt = now;
        }
    }

    private static bool HasProtectiveTriggers(string? triggersJson)
    {
        if (string.IsNullOrWhiteSpace(triggersJson))
        {
            return false;
        }
        try
        {
            using var document = JsonDocument.Parse(triggersJson);
            return document.RootElement.ValueKind == JsonValueKind.Object
                && ProtectiveTriggerKeys.Any(key => document.RootElement.TryGetProperty(key, out var value)
                    && value.ValueKind == JsonValueKind.True);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private async Task<IDbContextTransaction?> BeginIfNeededAsync(CancellationToken cancellationToken)
    {
        if (_db.Database.CurrentTransaction is not null || !_db.Database.IsRelational())
        {
            return null;
        }
        return await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
    }

    private static SafeguardingPreferenceTransitionResult EmptyTransition()
        => new(
            Array.Empty<string>(),
            Array.Empty<string>(),
            Array.Empty<string>(),
            Array.Empty<string>(),
            0,
            Array.Empty<int>());
}
