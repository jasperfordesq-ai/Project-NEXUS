// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Shared transactional boundary for personal-wallet debits backed by the
/// .NET transaction ledger. Every certified balance-checking writer must take
/// the same one-bigint advisory key before reading and spending a user balance.
/// </summary>
public sealed class PersonalWalletLedgerService
{
    public const string TransferTransactionType = "transfer";
    public const string VolunteerOrganisationBalanceAdapterTransactionType =
        "volunteer_org_balance_adapter";
    public const string CaringHourGiftAdapterTransactionType =
        "caring_hour_gift_adapter";
    public const string CaringLoyaltyAdapterTransactionType =
        "caring_loyalty_adapter";
    public const string CaringHourEstateAdapterTransactionType =
        "caring_hour_estate_adapter";

    private readonly NexusDbContext _db;
    private readonly ILogger<PersonalWalletLedgerService> _logger;

    public PersonalWalletLedgerService(
        NexusDbContext db,
        ILogger<PersonalWalletLedgerService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public Task AcquireSpendLockAsync(int userId, CancellationToken ct = default)
        => AcquireSpendLocksAsync([userId], ct);

    public async Task AcquireSpendLocksAsync(
        IEnumerable<int> userIds,
        CancellationToken ct = default)
    {
        if (_db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("A database transaction is required before acquiring a personal-wallet spend lock.");

        foreach (var userId in userIds.Distinct().OrderBy(id => id))
        {
            await _db.Database.ExecuteSqlRawAsync(
                "SELECT pg_advisory_xact_lock({0})",
                new object[] { userId },
                ct);
        }
    }

    public async Task<decimal> GetBalanceAsync(
        int tenantId,
        int userId,
        CancellationToken ct = default)
    {
        var received = await _db.Transactions
            .IgnoreQueryFilters()
            .Where(row => row.TenantId == tenantId
                && row.ReceiverId == userId
                && row.Status == TransactionStatus.Completed)
            .SumAsync(row => row.Amount, ct);
        var sent = await _db.Transactions
            .IgnoreQueryFilters()
            .Where(row => row.TenantId == tenantId
                && row.SenderId == userId
                && row.Status == TransactionStatus.Completed)
            .SumAsync(row => row.Amount, ct);
        return received - sent;
    }

    public async Task<PersonalWalletTransferResult> TransferAsync(
        int tenantId,
        int senderId,
        string? recipient,
        decimal amount,
        string? description,
        string? idempotencyKey,
        CancellationToken ct = default)
    {
        recipient = recipient?.Trim();
        description = description?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(recipient))
            return PersonalWalletTransferResult.Failed(
                "VALIDATION_ERROR", "Recipient is required");
        if (amount <= 0m)
            return PersonalWalletTransferResult.Failed(
                "VALIDATION_ERROR", "Amount must be greater than zero");
        if (amount > 1000m)
            return PersonalWalletTransferResult.Failed(
                "VALIDATION_ERROR", "Amount cannot exceed 1000 credits");
        if (decimal.Round(amount, 2) != amount)
            return PersonalWalletTransferResult.Failed(
                "VALIDATION_ERROR", "Amount cannot have more than two decimal places");
        var receiver = await ResolveRecipientAsync(tenantId, recipient, ct);
        if (receiver is null)
            return PersonalWalletTransferResult.Failed(
                "NOT_FOUND", "Recipient not found");
        if (receiver.Id == senderId)
            return PersonalWalletTransferResult.Failed(
                "VALIDATION_ERROR", "Cannot transfer to yourself");
        if (!receiver.IsActive || receiver.SuspendedAt.HasValue)
            return PersonalWalletTransferResult.Failed(
                "TRANSFER_FAILED", "Recipient account is inactive");

        TransferClaim claim;
        try
        {
            claim = await ClaimTransferAsync(
                tenantId,
                senderId,
                receiver.Id,
                amount,
                description,
                idempotencyKey,
                ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            // Match Laravel's fail-open cache behavior: idempotency storage
            // degradation must not make every legitimate transfer unavailable.
            _logger.LogWarning(
                exception,
                "Wallet idempotency storage unavailable for tenant {TenantId}, sender {SenderId}; proceeding fail-open",
                tenantId,
                senderId);
            claim = TransferClaim.FailOpen();
        }
        if (!claim.Claimed)
        {
            if (claim.State?.TransactionId is int priorTransactionId)
            {
                var replay = await ReplayAsync(
                    tenantId,
                    senderId,
                    priorTransactionId,
                    claim.State.BalanceAfter,
                    ct);
                if (replay is not null)
                    return replay;
            }

            return PersonalWalletTransferResult.Failed(
                "DUPLICATE_TRANSACTION", "A matching transfer is already being processed");
        }

        await using var databaseTransaction = await _db.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            ct);
        var commitAttempted = false;
        int? attemptedTransactionId = null;
        decimal? attemptedBalanceAfter = null;
        try
        {
            await AcquireSpendLocksAsync([senderId, receiver.Id], ct);

            var sender = await _db.Users
                .IgnoreQueryFilters()
                .SingleOrDefaultAsync(user => user.Id == senderId
                    && user.TenantId == tenantId
                    && user.IsActive
                    && user.SuspendedAt == null, ct);
            if (sender is null)
            {
                await databaseTransaction.RollbackAsync(ct);
                await databaseTransaction.DisposeAsync();
                await ReleaseClaimAsync(tenantId, claim.Key, CancellationToken.None);
                return PersonalWalletTransferResult.Failed(
                    "TRANSFER_FAILED", "Sender account is inactive");
            }

            receiver = await _db.Users
                .IgnoreQueryFilters()
                .SingleOrDefaultAsync(user => user.Id == receiver.Id
                    && user.TenantId == tenantId, ct);
            if (receiver is null || !receiver.IsActive || receiver.SuspendedAt.HasValue)
            {
                await databaseTransaction.RollbackAsync(ct);
                await databaseTransaction.DisposeAsync();
                await ReleaseClaimAsync(tenantId, claim.Key, CancellationToken.None);
                return PersonalWalletTransferResult.Failed(
                    "TRANSFER_FAILED", "Recipient account is inactive");
            }

            var balance = await GetBalanceAsync(tenantId, senderId, ct);
            if (balance < amount)
            {
                await databaseTransaction.RollbackAsync(ct);
                await databaseTransaction.DisposeAsync();
                await ReleaseClaimAsync(tenantId, claim.Key, CancellationToken.None);
                return PersonalWalletTransferResult.Failed(
                    "INSUFFICIENT_FUNDS", "Insufficient balance");
            }

            var ledgerRow = new Transaction
            {
                TenantId = tenantId,
                SenderId = senderId,
                ReceiverId = receiver.Id,
                Amount = amount,
                Description = description,
                TransactionType = TransferTransactionType,
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow
            };
            _db.Transactions.Add(ledgerRow);
            await _db.SaveChangesAsync(ct);
            var balanceAfter = balance - amount;
            attemptedTransactionId = ledgerRow.Id;
            attemptedBalanceAfter = balanceAfter;
            await CompleteClaimInCurrentTransactionAsync(
                tenantId,
                claim.Key,
                ledgerRow.Id,
                balanceAfter,
                claim.ExpiresAt,
                ct);
            commitAttempted = true;
            await databaseTransaction.CommitAsync(ct);

            return PersonalWalletTransferResult.Succeeded(
                ledgerRow.Id,
                amount,
                balanceAfter,
                sender.Id,
                sender.FirstName,
                sender.LastName,
                sender.AvatarUrl,
                receiver.Id,
                receiver.FirstName,
                receiver.LastName,
                receiver.AvatarUrl,
                description,
                ledgerRow.CreatedAt);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            if (!commitAttempted)
            {
                try
                {
                    await databaseTransaction.RollbackAsync(CancellationToken.None);
                }
                catch
                {
                    // The provider may already have rolled the transaction back.
                }
            }
            await databaseTransaction.DisposeAsync();
            _db.ChangeTracker.Clear();
            await ReconcileClaimAfterFailureAsync(
                tenantId,
                senderId,
                claim,
                attemptedTransactionId,
                attemptedBalanceAfter,
                CancellationToken.None);
            throw;
        }
        catch (Exception exception)
        {
            if (!commitAttempted)
            {
                try
                {
                    await databaseTransaction.RollbackAsync(CancellationToken.None);
                }
                catch
                {
                    // The provider may already have rolled the transaction back.
                }
            }
            await databaseTransaction.DisposeAsync();
            _db.ChangeTracker.Clear();
            var committed = await ReconcileClaimAfterFailureAsync(
                tenantId,
                senderId,
                claim,
                attemptedTransactionId,
                attemptedBalanceAfter,
                CancellationToken.None);
            if (committed is not null)
                return committed;
            _logger.LogError(
                exception,
                "Personal wallet transfer failed for tenant {TenantId}, sender {SenderId}",
                tenantId,
                senderId);
            return PersonalWalletTransferResult.Failed(
                "SERVER_ERROR", "Transfer failed");
        }
    }

    private async Task<User?> ResolveRecipientAsync(
        int tenantId,
        string recipient,
        CancellationToken ct)
    {
        if (int.TryParse(recipient, out var recipientId) && recipientId > 0)
        {
            return await _db.Users
                .IgnoreQueryFilters()
                .AsNoTracking()
                .SingleOrDefaultAsync(user => user.Id == recipientId
                    && user.TenantId == tenantId, ct);
        }

        if (recipient.Contains('@'))
        {
            var normalizedEmail = recipient.ToLowerInvariant();
            return await _db.Users
                .IgnoreQueryFilters()
                .AsNoTracking()
                .SingleOrDefaultAsync(user => user.TenantId == tenantId
                    && user.Email.ToLower() == normalizedEmail, ct);
        }

        // The .NET user model has no Laravel username column yet.
        return null;
    }

    private async Task<TransferClaim> ClaimTransferAsync(
        int tenantId,
        int senderId,
        int receiverId,
        decimal amount,
        string description,
        string? explicitKey,
        CancellationToken ct)
    {
        explicitKey = explicitKey?.Trim();
        var isExplicit = !string.IsNullOrWhiteSpace(explicitKey);
        var fingerprintSource = isExplicit
            ? $"key:{explicitKey}"
            : $"content:{receiverId}|{amount.ToString("0.############################", CultureInfo.InvariantCulture)}|{description}";
        var hash = Convert.ToHexString(
                SHA256.HashData(Encoding.UTF8.GetBytes(fingerprintSource)))
            .ToLowerInvariant();
        var key = $"wallet.idem.{senderId}.{hash}";
        var expiresAt = DateTime.UtcNow.AddSeconds(isExplicit ? 86400 : 120);

        // TenantConfig is a compatibility store rather than a TTL cache. Remove
        // a bounded batch that is safely older than the maximum 24-hour claim
        // window so transfer traffic cannot grow settings rows without bound.
        try
        {
            var staleBefore = DateTime.UtcNow.AddDays(-2);
            var staleClaims = await _db.TenantConfigs
                .IgnoreQueryFilters()
                .Where(row => row.TenantId == tenantId
                    && row.Key.StartsWith("wallet.idem.")
                    && row.CreatedAt < staleBefore)
                .OrderBy(row => row.Id)
                .Take(25)
                .ToListAsync(ct);
            if (staleClaims.Count > 0)
            {
                _db.TenantConfigs.RemoveRange(staleClaims);
                await _db.SaveChangesAsync(ct);
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _db.ChangeTracker.Clear();
            _logger.LogWarning(
                exception,
                "Could not clean expired wallet idempotency claims for tenant {TenantId}",
                tenantId);
        }

        var existing = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(row => row.TenantId == tenantId && row.Key == key, ct);
        if (existing is not null)
        {
            var state = ParseClaimState(existing.Value);
            if (state?.ExpiresAt > DateTime.UtcNow)
                return new(false, key, state, state.ExpiresAt);

            _db.TenantConfigs.Remove(existing);
            await _db.SaveChangesAsync(ct);
        }

        var claimState = new TransferClaimState("pending", null, null, expiresAt);
        var claimRow = new TenantConfig
        {
            TenantId = tenantId,
            Key = key,
            Value = JsonSerializer.Serialize(claimState),
            CreatedAt = DateTime.UtcNow
        };
        _db.TenantConfigs.Add(claimRow);
        try
        {
            await _db.SaveChangesAsync(ct);
            return new(true, key, claimState, expiresAt);
        }
        catch (DbUpdateException)
        {
            _db.Entry(claimRow).State = EntityState.Detached;
            var raced = await _db.TenantConfigs
                .IgnoreQueryFilters()
                .AsNoTracking()
                .SingleOrDefaultAsync(row => row.TenantId == tenantId && row.Key == key, ct);
            if (raced is null)
                throw;

            var state = ParseClaimState(raced.Value);
            return new(false, key, state, state?.ExpiresAt ?? expiresAt);
        }
    }

    private async Task<PersonalWalletTransferResult?> ReplayAsync(
        int tenantId,
        int senderId,
        int transactionId,
        decimal? balanceAfter,
        CancellationToken ct)
    {
        var row = await _db.Transactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(transaction => transaction.Id == transactionId
                && transaction.TenantId == tenantId
                && transaction.SenderId == senderId
                && transaction.TransactionType == TransferTransactionType
                && transaction.Status == TransactionStatus.Completed)
            .Select(transaction => new
            {
                transaction.Id,
                transaction.Amount,
                transaction.Description,
                transaction.CreatedAt,
                SenderId = transaction.SenderId!.Value,
                SenderFirstName = transaction.Sender == null ? string.Empty : transaction.Sender.FirstName,
                SenderLastName = transaction.Sender == null ? string.Empty : transaction.Sender.LastName,
                SenderAvatarUrl = transaction.Sender == null ? null : transaction.Sender.AvatarUrl,
                ReceiverId = transaction.ReceiverId!.Value,
                ReceiverFirstName = transaction.Receiver == null ? string.Empty : transaction.Receiver.FirstName,
                ReceiverLastName = transaction.Receiver == null ? string.Empty : transaction.Receiver.LastName,
                ReceiverAvatarUrl = transaction.Receiver == null ? null : transaction.Receiver.AvatarUrl
            })
            .SingleOrDefaultAsync(ct);
        if (row is null)
            return null;

        return PersonalWalletTransferResult.Succeeded(
            row.Id,
            row.Amount,
            balanceAfter ?? await GetBalanceAsync(tenantId, senderId, ct),
            row.SenderId,
            row.SenderFirstName,
            row.SenderLastName,
            row.SenderAvatarUrl,
            row.ReceiverId,
            row.ReceiverFirstName,
            row.ReceiverLastName,
            row.ReceiverAvatarUrl,
            row.Description ?? string.Empty,
            row.CreatedAt,
            isReplay: true);
    }

    private async Task CompleteClaimInCurrentTransactionAsync(
        int tenantId,
        string? key,
        int transactionId,
        decimal balanceAfter,
        DateTime expiresAt,
        CancellationToken ct)
    {
        if (key is null)
            return;

        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .SingleAsync(config => config.TenantId == tenantId && config.Key == key, ct);
        row.Value = JsonSerializer.Serialize(
            new TransferClaimState("completed", transactionId, balanceAfter, expiresAt));
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
    }

    private async Task ReleaseClaimAsync(
        int tenantId,
        string? key,
        CancellationToken ct)
    {
        if (key is null)
            return;

        try
        {
            var row = await _db.TenantConfigs
                .IgnoreQueryFilters()
                .SingleOrDefaultAsync(config => config.TenantId == tenantId && config.Key == key, ct);
            if (row is null)
                return;

            _db.TenantConfigs.Remove(row);
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Could not release wallet idempotency claim {TenantId}/{Key}",
                tenantId,
                key);
        }
    }

    private async Task<PersonalWalletTransferResult?> ReconcileClaimAfterFailureAsync(
        int tenantId,
        int senderId,
        TransferClaim claim,
        int? attemptedTransactionId,
        decimal? attemptedBalanceAfter,
        CancellationToken ct)
    {
        if (claim.Key is null)
            return null;

        try
        {
            var row = await _db.TenantConfigs
                .IgnoreQueryFilters()
                .AsNoTracking()
                .SingleOrDefaultAsync(config => config.TenantId == tenantId
                    && config.Key == claim.Key, ct);
            var state = row is null ? null : ParseClaimState(row.Value);
            if (state?.TransactionId is int committedTransactionId)
            {
                return await ReplayAsync(
                    tenantId,
                    senderId,
                    committedTransactionId,
                    state.BalanceAfter,
                    ct);
            }

            if (attemptedTransactionId.HasValue)
            {
                var committed = await ReplayAsync(
                    tenantId,
                    senderId,
                    attemptedTransactionId.Value,
                    attemptedBalanceAfter,
                    ct);
                if (committed is not null)
                    return committed;
            }

            // Ledger and completed claim are written in one transaction. A
            // readable pending claim with no committed ledger proves rollback,
            // so it is safe to release for a legitimate retry. Malformed or
            // unreadable state remains fail-closed until expiry.
            if (state?.Status == "pending")
                await ReleaseClaimAsync(tenantId, claim.Key, ct);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Could not reconcile wallet claim after transaction failure {TenantId}/{Key}; leaving it fail-closed",
                tenantId,
                claim.Key);
        }

        return null;
    }

    private static TransferClaimState? ParseClaimState(string value)
    {
        try
        {
            return JsonSerializer.Deserialize<TransferClaimState>(value);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private sealed record TransferClaim(
        bool Claimed,
        string? Key,
        TransferClaimState? State,
        DateTime ExpiresAt)
    {
        public static TransferClaim FailOpen() =>
            new(true, null, null, DateTime.UtcNow);
    }

    private sealed record TransferClaimState(
        string Status,
        int? TransactionId,
        decimal? BalanceAfter,
        DateTime ExpiresAt);
}

public sealed record PersonalWalletTransferResult(
    bool Success,
    bool IsReplay,
    int? TransactionId,
    decimal? Amount,
    decimal? NewBalance,
    int? SenderId,
    string? SenderFirstName,
    string? SenderLastName,
    string? SenderAvatarUrl,
    int? ReceiverId,
    string? ReceiverFirstName,
    string? ReceiverLastName,
    string? ReceiverAvatarUrl,
    string? Description,
    DateTime? CreatedAt,
    string? ErrorCode,
    string? ErrorMessage)
{
    public static PersonalWalletTransferResult Succeeded(
        int transactionId,
        decimal amount,
        decimal newBalance,
        int senderId,
        string senderFirstName,
        string senderLastName,
        string? senderAvatarUrl,
        int receiverId,
        string receiverFirstName,
        string receiverLastName,
        string? receiverAvatarUrl,
        string description,
        DateTime createdAt,
        bool isReplay = false) =>
        new(
            true,
            isReplay,
            transactionId,
            amount,
            newBalance,
            senderId,
            senderFirstName,
            senderLastName,
            senderAvatarUrl,
            receiverId,
            receiverFirstName,
            receiverLastName,
            receiverAvatarUrl,
            description,
            createdAt,
            null,
            null);

    public static PersonalWalletTransferResult Failed(string code, string message) =>
        new(false, false, null, null, null, null, null, null, null, null, null, null, null, null, null, code, message);
}
