// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Nexus.Api.Entities;
using Nexus.Api.Observability;

namespace Nexus.Api.Services;

/// <summary>
/// Shared best-effort post-commit effects for canonical personal-wallet
/// transfers. Replayed idempotent responses deliberately skip every effect.
/// </summary>
public sealed class PersonalWalletTransferEffectsService
{
    private readonly GamificationService _gamification;
    private readonly ILogger<PersonalWalletTransferEffectsService> _logger;

    public PersonalWalletTransferEffectsService(
        GamificationService gamification,
        ILogger<PersonalWalletTransferEffectsService> logger)
    {
        _gamification = gamification;
        _logger = logger;
    }

    public async Task RunAsync(int tenantId, PersonalWalletTransferResult result)
    {
        if (!result.Success
            || result.IsReplay
            || !result.TransactionId.HasValue
            || !result.SenderId.HasValue
            || !result.ReceiverId.HasValue)
        {
            return;
        }

        await RunBestEffortAsync(
            () => _gamification.AwardXpAsync(
                result.SenderId.Value,
                XpLog.Amounts.ExchangeCompleted,
                XpLog.Sources.TransactionCompleted,
                result.TransactionId,
                "Completed a transaction"),
            "sender XP",
            result.TransactionId.Value);
        await RunBestEffortAsync(
            () => _gamification.AwardXpAsync(
                result.ReceiverId.Value,
                XpLog.Amounts.ExchangeCompleted,
                XpLog.Sources.TransactionCompleted,
                result.TransactionId,
                "Completed a transaction"),
            "receiver XP",
            result.TransactionId.Value);
        await RunBestEffortAsync(
            () => _gamification.CheckAndAwardBadgesAsync(
                result.SenderId.Value,
                "transaction_completed"),
            "sender badges",
            result.TransactionId.Value);
        await RunBestEffortAsync(
            () => _gamification.CheckAndAwardBadgesAsync(
                result.ReceiverId.Value,
                "transaction_completed"),
            "receiver badges",
            result.TransactionId.Value);

        NexusMetrics.WalletTransfers.Add(
            1,
            new KeyValuePair<string, object?>("tenant_id", tenantId));
        _logger.LogInformation(
            "Transfer of {Amount} hours from user {SenderId} to user {ReceiverId} completed (transaction {TransactionId})",
            result.Amount,
            result.SenderId,
            result.ReceiverId,
            result.TransactionId);
    }

    private async Task RunBestEffortAsync(
        Func<Task> action,
        string effect,
        int transactionId)
    {
        try
        {
            await action();
        }
        catch (Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Personal-wallet {Effect} failed after transaction {TransactionId} committed",
                effect,
                transactionId);
        }
    }
}
