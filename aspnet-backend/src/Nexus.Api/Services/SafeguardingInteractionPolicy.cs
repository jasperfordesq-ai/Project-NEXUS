// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;

namespace Nexus.Api.Services;

/// <summary>
/// One fail-closed policy boundary for member-to-member contact. Preflight is
/// read-only; definitive writes call the locked variant inside their transaction.
/// </summary>
public sealed class SafeguardingInteractionPolicy
{
    private readonly NexusDbContext _db;
    private readonly MemberVettingAttestationService _attestations;
    private readonly SafeguardingJurisdictionService _jurisdictions;
    private readonly ILogger<SafeguardingInteractionPolicy> _logger;

    public SafeguardingInteractionPolicy(
        NexusDbContext db,
        MemberVettingAttestationService attestations,
        SafeguardingJurisdictionService jurisdictions,
        ILogger<SafeguardingInteractionPolicy> logger)
    {
        _db = db;
        _attestations = attestations;
        _jurisdictions = jurisdictions;
        _logger = logger;
    }

    public Task<SafeguardingInteractionDecision> EvaluateLocalContactAsync(
        int senderId,
        int recipientId,
        int tenantId,
        string channel = "direct_message",
        CancellationToken cancellationToken = default)
        => EvaluateAsync(senderId, tenantId, recipientId, tenantId, channel, false, cancellationToken);

    public async Task<SafeguardingInteractionDecision> EvaluateLockedLocalContactAsync(
        int senderId,
        int recipientId,
        int tenantId,
        string channel = "direct_message",
        CancellationToken cancellationToken = default)
    {
        SafeguardingPolicyState policy;
        try
        {
            policy = await _jurisdictions.LockPolicyForUpdateAsync(tenantId, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            LogUnavailable(tenantId, recipientId, channel, "locked_jurisdiction_lookup_failed", exception);
            return Unavailable(tenantId);
        }

        SafeguardingTriggerState triggers;
        try
        {
            await SafeguardingDatabaseLocks.LockRecipientPreferencesAndOptionsAsync(
                _db,
                tenantId,
                recipientId,
                cancellationToken);
            triggers = await LoadActiveTriggersAsync(recipientId, tenantId, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            LogUnavailable(tenantId, recipientId, channel, "locked_trigger_lookup_failed", exception);
            return Unavailable(tenantId);
        }

        if (triggers.RequiresVettedInteraction)
        {
            try
            {
                await _attestations.LockMemberAttestationsForUpdateAsync(
                    tenantId,
                    senderId,
                    cancellationToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                LogUnavailable(tenantId, recipientId, channel, "locked_attestation_lookup_failed", exception);
                return Unavailable(tenantId);
            }
        }

        return await EvaluateResolvedStateAsync(
            senderId,
            tenantId,
            recipientId,
            tenantId,
            channel,
            false,
            triggers,
            policy,
            cancellationToken);
    }

    public Task<SafeguardingInteractionDecision> EvaluateCrossTenantContactAsync(
        int senderId,
        int senderTenantId,
        int recipientId,
        int recipientTenantId,
        string channel = "federated_message",
        CancellationToken cancellationToken = default)
        => EvaluateAsync(
            senderId,
            senderTenantId,
            recipientId,
            recipientTenantId,
            channel,
            false,
            cancellationToken);

    public Task<SafeguardingInteractionDecision> EvaluateExternalContactAsync(
        int recipientId,
        int recipientTenantId,
        string externalActorReference,
        string channel = "external_federated_message",
        CancellationToken cancellationToken = default)
        => string.IsNullOrEmpty(externalActorReference)
            ? Task.FromResult(Unavailable(recipientTenantId))
            : EvaluateAsync(
                null,
                null,
                recipientId,
                recipientTenantId,
                channel,
                true,
                cancellationToken);

    public async Task<SafeguardingInteractionDecision> EvaluateManyLocalContactsAsync(
        int senderId,
        IEnumerable<int> recipientIds,
        int tenantId,
        string channel,
        CancellationToken cancellationToken = default)
    {
        SafeguardingInteractionDecision? firstDenial = null;
        foreach (var recipientId in recipientIds.Distinct())
        {
            if (recipientId == senderId)
            {
                continue;
            }
            var decision = await EvaluateLocalContactAsync(
                senderId,
                recipientId,
                tenantId,
                channel,
                cancellationToken);
            if (decision.IsUnavailable)
            {
                return decision;
            }
            if (decision.IsDenied && firstDenial is null)
            {
                firstDenial = decision;
            }
        }
        return firstDenial ?? Allowed(tenantId);
    }

    /// <summary>
    /// Definitive one-sender/many-recipient decision. The caller must already
    /// own a transaction. Recipients are locked in ascending order, then the
    /// sender's attestations are locked once, preventing call-site lock drift.
    /// </summary>
    public async Task<SafeguardingInteractionDecision> EvaluateLockedManyLocalContactsAsync(
        int senderId,
        IEnumerable<int> recipientIds,
        int tenantId,
        string channel,
        CancellationToken cancellationToken = default)
    {
        var recipients = recipientIds.Where(id => id != senderId).Distinct().OrderBy(id => id).ToArray();
        SafeguardingPolicyState policy;
        try
        {
            policy = await _jurisdictions.LockPolicyForUpdateAsync(tenantId, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            LogUnavailable(tenantId, recipients.FirstOrDefault(), channel, "locked_jurisdiction_lookup_failed", exception);
            return Unavailable(tenantId);
        }

        var triggersByRecipient = new Dictionary<int, SafeguardingTriggerState>();
        try
        {
            foreach (var recipientId in recipients)
            {
                await SafeguardingDatabaseLocks.LockRecipientPreferencesAndOptionsAsync(
                    _db,
                    tenantId,
                    recipientId,
                    cancellationToken);
                triggersByRecipient[recipientId] = await LoadActiveTriggersAsync(
                    recipientId,
                    tenantId,
                    cancellationToken);
            }
            if (triggersByRecipient.Values.Any(triggers => triggers.RequiresVettedInteraction))
            {
                await _attestations.LockMemberAttestationsForUpdateAsync(
                    tenantId,
                    senderId,
                    cancellationToken);
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            LogUnavailable(tenantId, recipients.FirstOrDefault(), channel, "locked_contact_state_lookup_failed", exception);
            return Unavailable(tenantId);
        }

        SafeguardingInteractionDecision? firstDenial = null;
        foreach (var recipientId in recipients)
        {
            var decision = await EvaluateResolvedStateAsync(
                senderId,
                tenantId,
                recipientId,
                tenantId,
                channel,
                false,
                triggersByRecipient[recipientId],
                policy,
                cancellationToken);
            if (decision.IsUnavailable)
            {
                return decision;
            }
            if (decision.IsDenied && firstDenial is null)
            {
                firstDenial = decision;
            }
        }
        return firstDenial ?? Allowed(tenantId);
    }

    /// <summary>
    /// Definitive all-pairs, bidirectional group decision. Locks policy once,
    /// then every participant's preferences/options and attestations in stable
    /// ascending-ID order before evaluating A-to-B and B-to-A for every pair.
    /// </summary>
    public async Task<SafeguardingInteractionDecision> EvaluateLockedAllPairsLocalContactsAsync(
        IEnumerable<int> participantIds,
        int tenantId,
        string channel,
        CancellationToken cancellationToken = default)
    {
        // Preserve caller order for first-denial precedence (Laravel's
        // array_unique keeps first occurrence order), but acquire every database
        // lock in deterministic ID order to avoid lock inversions.
        var participants = participantIds.Where(id => id > 0).Distinct().ToArray();
        var lockOrder = participants.OrderBy(id => id).ToArray();
        SafeguardingPolicyState policy;
        try
        {
            policy = await _jurisdictions.LockPolicyForUpdateAsync(tenantId, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            LogUnavailable(tenantId, participants.FirstOrDefault(), channel, "locked_jurisdiction_lookup_failed", exception);
            return Unavailable(tenantId);
        }

        var triggersByParticipant = new Dictionary<int, SafeguardingTriggerState>();
        try
        {
            foreach (var participantId in lockOrder)
            {
                await SafeguardingDatabaseLocks.LockRecipientPreferencesAndOptionsAsync(
                    _db,
                    tenantId,
                    participantId,
                    cancellationToken);
                triggersByParticipant[participantId] = await LoadActiveTriggersAsync(
                    participantId,
                    tenantId,
                    cancellationToken);
            }
            if (triggersByParticipant.Values.Any(triggers => triggers.RequiresVettedInteraction))
            {
                foreach (var participantId in lockOrder)
                {
                    await _attestations.LockMemberAttestationsForUpdateAsync(
                        tenantId,
                        participantId,
                        cancellationToken);
                }
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            LogUnavailable(tenantId, participants.FirstOrDefault(), channel, "locked_contact_state_lookup_failed", exception);
            return Unavailable(tenantId);
        }

        SafeguardingInteractionDecision? firstDenial = null;
        for (var left = 0; left < participants.Length; left++)
        {
            for (var right = left + 1; right < participants.Length; right++)
            {
                foreach (var pair in new[]
                         {
                             (Sender: participants[left], Recipient: participants[right]),
                             (Sender: participants[right], Recipient: participants[left])
                         })
                {
                    var decision = await EvaluateResolvedStateAsync(
                        pair.Sender,
                        tenantId,
                        pair.Recipient,
                        tenantId,
                        channel,
                        false,
                        triggersByParticipant[pair.Recipient],
                        policy,
                        cancellationToken);
                    if (decision.IsUnavailable)
                    {
                        return decision;
                    }
                    if (decision.IsDenied && firstDenial is null)
                    {
                        firstDenial = decision;
                    }
                }
            }
        }
        return firstDenial ?? Allowed(tenantId);
    }

    /// <summary>
    /// Exposes the same live trigger projection used by contact decisions for
    /// adjacent workflow rules such as broker approval. It is always an
    /// explicit tenant-scoped read and has no cache activation dependency.
    /// </summary>
    public Task<SafeguardingTriggerState> GetActiveTriggerStateAsync(
        int userId,
        int tenantId,
        CancellationToken cancellationToken = default)
        => LoadActiveTriggersAsync(userId, tenantId, cancellationToken);

    /// <summary>
    /// Reads the live trigger projection while holding the same tenant-policy
    /// and recipient-state locks used by definitive contact decisions. The
    /// caller must already own a transaction.
    /// </summary>
    public async Task<SafeguardingTriggerState> GetLockedActiveTriggerStateAsync(
        int userId,
        int tenantId,
        CancellationToken cancellationToken = default)
    {
        await _jurisdictions.LockPolicyForUpdateAsync(tenantId, cancellationToken);
        await SafeguardingDatabaseLocks.LockRecipientPreferencesAndOptionsAsync(
            _db,
            tenantId,
            userId,
            cancellationToken);
        return await LoadActiveTriggersAsync(userId, tenantId, cancellationToken);
    }

    public async Task AssertLocalContactAllowedAsync(
        int senderId,
        int recipientId,
        int tenantId,
        string channel,
        CancellationToken cancellationToken = default)
        => ThrowWhenDenied(await EvaluateLocalContactAsync(
            senderId,
            recipientId,
            tenantId,
            channel,
            cancellationToken));

    public async Task AssertCrossTenantContactAllowedAsync(
        int senderId,
        int senderTenantId,
        int recipientId,
        int recipientTenantId,
        string channel,
        CancellationToken cancellationToken = default)
        => ThrowWhenDenied(await EvaluateCrossTenantContactAsync(
            senderId,
            senderTenantId,
            recipientId,
            recipientTenantId,
            channel,
            cancellationToken));

    public async Task AssertManyLocalContactsAllowedAsync(
        int senderId,
        IEnumerable<int> recipientIds,
        int tenantId,
        string channel,
        CancellationToken cancellationToken = default)
        => ThrowWhenDenied(await EvaluateManyLocalContactsAsync(
            senderId,
            recipientIds,
            tenantId,
            channel,
            cancellationToken));

    private async Task<SafeguardingInteractionDecision> EvaluateAsync(
        int? senderUserId,
        int? senderTenantId,
        int recipientId,
        int recipientTenantId,
        string channel,
        bool externalActor,
        CancellationToken cancellationToken)
    {
        SafeguardingTriggerState triggers;
        try
        {
            triggers = await LoadActiveTriggersAsync(recipientId, recipientTenantId, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            LogUnavailable(recipientTenantId, recipientId, channel, "trigger_lookup_failed", exception);
            return Unavailable(recipientTenantId);
        }

        SafeguardingPolicyState? policy = null;
        if (triggers.RequiresVettedInteraction)
        {
            try
            {
                policy = await _jurisdictions.GetPolicyAsync(recipientTenantId, cancellationToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                LogUnavailable(recipientTenantId, recipientId, channel, "jurisdiction_lookup_failed", exception);
                return Unavailable(recipientTenantId);
            }
        }

        return await EvaluateResolvedStateAsync(
            senderUserId,
            senderTenantId,
            recipientId,
            recipientTenantId,
            channel,
            externalActor,
            triggers,
            policy,
            cancellationToken);
    }

    private async Task<SafeguardingInteractionDecision> EvaluateResolvedStateAsync(
        int? senderUserId,
        int? senderTenantId,
        int recipientId,
        int recipientTenantId,
        string channel,
        bool externalActor,
        SafeguardingTriggerState triggers,
        SafeguardingPolicyState? policy,
        CancellationToken cancellationToken)
    {
        if (triggers.RestrictsMessaging)
        {
            return new(
                SafeguardingInteractionDecision.Deny,
                "SAFEGUARDING_CONTACT_RESTRICTED",
                recipientTenantId,
                SafeguardingVettingCatalog.PurposeSafeguardedMemberContact,
                SafeguardingVettingCatalog.TenantScope,
                string.Empty,
                CanRequestCoordinator: true);
        }
        if (!triggers.RequiresVettedInteraction)
        {
            return Allowed(recipientTenantId);
        }

        var requiredCodes = triggers.VettingTypesRequired
            .Where(code => !string.IsNullOrWhiteSpace(code))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (requiredCodes.Length == 0)
        {
            LogUnavailable(recipientTenantId, recipientId, channel, "missing_attestation_requirement");
            return Unavailable(recipientTenantId);
        }
        if (policy is null
            || !policy.Configured
            || !policy.ContactPolicyAvailable
            || policy.SchemeCode is null
            || policy.AttestationCode is null
            || policy.PolicyVersion is null)
        {
            LogUnavailable(recipientTenantId, recipientId, channel, "jurisdiction_unconfigured_or_unsupported");
            return Unavailable(recipientTenantId, requiredCodes);
        }
        if (requiredCodes.Length != 1 || requiredCodes[0] != policy.AttestationCode)
        {
            LogUnavailable(recipientTenantId, recipientId, channel, "requirement_policy_mismatch");
            return Unavailable(recipientTenantId, requiredCodes);
        }

        var labels = requiredCodes.Select(SafeguardingVettingCatalog.AttestationLabel).ToArray();
        if (externalActor || senderUserId is null || senderTenantId != recipientTenantId)
        {
            return DeniedForVetting(recipientTenantId, policy, requiredCodes, labels);
        }

        bool confirmed;
        try
        {
            confirmed = await _attestations.HasConfirmedAttestationAsync(
                recipientTenantId,
                senderUserId.Value,
                policy.SchemeCode,
                policy.AttestationCode,
                policy.PurposeCode,
                policy.ScopeType,
                policy.ScopeIdentifier,
                policy.PolicyVersion,
                cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            LogUnavailable(recipientTenantId, recipientId, channel, "attestation_lookup_failed", exception);
            return Unavailable(recipientTenantId, requiredCodes);
        }
        if (!confirmed)
        {
            return DeniedForVetting(recipientTenantId, policy, requiredCodes, labels);
        }

        return new(
            SafeguardingInteractionDecision.Allow,
            "SAFEGUARDING_ALLOWED",
            recipientTenantId,
            policy.PurposeCode,
            policy.ScopeType,
            policy.ScopeIdentifier,
            policy.PolicyVersion,
            requiredCodes,
            labels);
    }

    private async Task<SafeguardingTriggerState> LoadActiveTriggersAsync(
        int userId,
        int tenantId,
        CancellationToken cancellationToken)
    {
        var triggerRows = await (
                from preference in _db.UserSafeguardingPreferences.IgnoreQueryFilters().AsNoTracking()
                join option in _db.SafeguardingOptions.IgnoreQueryFilters().AsNoTracking()
                    on new { preference.TenantId, Id = preference.OptionId }
                    equals new { option.TenantId, Id = option.Id }
                where preference.TenantId == tenantId
                    && preference.UserId == userId
                    && preference.RevokedAt == null
                    && option.IsActive
                orderby option.Id
                select option.TriggersJson)
            .ToListAsync(cancellationToken);

        var requiresVetted = false;
        var brokerApproval = false;
        var restrictsMessaging = false;
        var restrictsMatching = false;
        var notifyAdmin = false;
        var codes = new List<string>();
        foreach (var triggersJson in triggerRows)
        {
            if (string.IsNullOrWhiteSpace(triggersJson))
            {
                continue;
            }
            try
            {
                using var document = JsonDocument.Parse(triggersJson);
                if (document.RootElement.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }
                var triggers = document.RootElement;
                var rowRequiresVetted = True(triggers, "requires_vetted_interaction");
                requiresVetted |= rowRequiresVetted;
                brokerApproval |= True(triggers, "requires_broker_approval");
                restrictsMessaging |= True(triggers, "restricts_messaging");
                restrictsMatching |= True(triggers, "restricts_matching");
                notifyAdmin |= True(triggers, "notify_admin_on_selection");
                if (rowRequiresVetted
                    && triggers.TryGetProperty("vetting_type_required", out var code)
                    && code.ValueKind == JsonValueKind.String
                    && !string.IsNullOrWhiteSpace(code.GetString()))
                {
                    codes.Add(code.GetString()!);
                }
            }
            catch (JsonException)
            {
                // Laravel treats historical malformed trigger JSON as no triggers.
            }
        }
        return new(
            requiresVetted,
            brokerApproval,
            restrictsMessaging,
            restrictsMatching,
            notifyAdmin,
            codes.Distinct(StringComparer.Ordinal).ToArray());
    }

    private static bool True(JsonElement root, string property)
    {
        if (!root.TryGetProperty(property, out var value))
        {
            return false;
        }

        // Laravel merges historical JSON with PHP's !empty semantics. Preserve
        // restrictions encoded before the managed presets standardized on JSON
        // booleans; treating a legacy truthy value as false would fail open.
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False or JsonValueKind.Null or JsonValueKind.Undefined => false,
            JsonValueKind.Number => !value.TryGetDouble(out var number) || number != 0,
            JsonValueKind.String => value.GetString() is { Length: > 0 } text && text != "0",
            JsonValueKind.Array => value.GetArrayLength() > 0,
            JsonValueKind.Object => value.EnumerateObject().Any(),
            _ => false
        };
    }

    private static SafeguardingInteractionDecision Allowed(int tenantId)
        => new(
            SafeguardingInteractionDecision.Allow,
            "SAFEGUARDING_ALLOWED",
            tenantId,
            SafeguardingVettingCatalog.PurposeSafeguardedMemberContact,
            SafeguardingVettingCatalog.TenantScope,
            string.Empty);

    private static SafeguardingInteractionDecision DeniedForVetting(
        int tenantId,
        SafeguardingPolicyState policy,
        IReadOnlyList<string> codes,
        IReadOnlyList<string> labels)
        => new(
            SafeguardingInteractionDecision.Deny,
            "VETTING_REQUIRED",
            tenantId,
            policy.PurposeCode,
            policy.ScopeType,
            policy.ScopeIdentifier,
            policy.PolicyVersion,
            codes,
            labels,
            true);

    private static SafeguardingInteractionDecision Unavailable(
        int tenantId,
        IReadOnlyList<string>? codes = null)
    {
        codes ??= Array.Empty<string>();
        return new(
            SafeguardingInteractionDecision.Unavailable,
            "SAFEGUARDING_POLICY_UNAVAILABLE",
            tenantId,
            SafeguardingVettingCatalog.PurposeSafeguardedMemberContact,
            SafeguardingVettingCatalog.TenantScope,
            string.Empty,
            RequiredAttestationCodes: codes,
            RequiredAttestationLabels: codes.Select(SafeguardingVettingCatalog.AttestationLabel).ToArray(),
            CanRequestCoordinator: true);
    }

    private static void ThrowWhenDenied(SafeguardingInteractionDecision decision)
    {
        if (decision.IsAllowed)
        {
            return;
        }
        var message = decision.Code switch
        {
            "SAFEGUARDING_POLICY_UNAVAILABLE" => "The safeguarding policy is temporarily unavailable.",
            "VETTING_REQUIRED" => $"Community vetting confirmation is required: {string.Join(", ", decision.RequiredAttestationLabels ?? Array.Empty<string>())}.",
            _ => "Direct contact is restricted by the recipient's safeguarding preferences."
        };
        throw new SafeguardingPolicyException(decision.Code, message);
    }

    private void LogUnavailable(
        int tenantId,
        int recipientId,
        string channel,
        string reason,
        Exception? exception = null)
        => _logger.LogError(
            exception,
            "Safeguarding interaction policy unavailable for tenant {TenantId}, recipient {RecipientId}, channel {Channel}: {Reason}",
            tenantId,
            recipientId,
            channel,
            reason);
}
