// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Npgsql;

namespace Nexus.Api.Services;

/// <summary>
/// Laravel-contract-compatible group time exchanges.
///
/// The Laravel edition stores a mutable balance and writes provider credit rows.
/// ASP.NET derives balances from its transaction ledger, so completion writes the
/// canonical provider rows plus hidden balance-adapter rows for the independent
/// receiver debits. Only the canonical provider row IDs leave this service.
/// </summary>
public class GroupExchangeService
{
    private const string ProviderRole = "provider";
    private const string ReceiverRole = "receiver";
    private const string ExchangeTransactionType = "exchange";
    private const string BalanceAdapterTransactionType = "group_exchange_balance_adapter";

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly PushNotificationService _pushNotifications;
    private readonly EmailNotificationService _emailNotifications;
    private readonly ILogger<GroupExchangeService> _logger;
    private readonly PersonalWalletLedgerService _personalWallet;
    private readonly SafeguardingInteractionPolicy _safeguardingInteractions;

    public GroupExchangeService(
        NexusDbContext db,
        TenantContext tenantContext,
        PushNotificationService pushNotifications,
        EmailNotificationService emailNotifications,
        ILogger<GroupExchangeService> logger,
        PersonalWalletLedgerService personalWallet,
        SafeguardingInteractionPolicy safeguardingInteractions)
    {
        _db = db;
        _tenantContext = tenantContext;
        _pushNotifications = pushNotifications;
        _emailNotifications = emailNotifications;
        _logger = logger;
        _personalWallet = personalWallet;
        _safeguardingInteractions = safeguardingInteractions;
    }

    public async Task<GroupExchangeListResult> ListForUserAsync(
        int userId,
        string? status,
        int limit,
        int offset,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        limit = Math.Clamp(limit, 1, 100);
        offset = Math.Max(offset, 0);

        var query = _db.GroupExchanges
            .AsNoTracking()
            .Include(exchange => exchange.CreatedBy)
            .Include(exchange => exchange.Participants)
            .Where(exchange => exchange.TenantId == tenantId &&
                (exchange.CreatedById == userId ||
                 exchange.Participants.Any(participant => participant.UserId == userId)));

        if (HasPhpNonEmptyString(status))
        {
            query = query.Where(exchange => exchange.Status == status);
        }

        var exchanges = await query
            .OrderByDescending(exchange => exchange.Id)
            .Skip(offset)
            .Take(limit + 1)
            .ToListAsync(cancellationToken);

        var hasMore = exchanges.Count > limit;
        if (hasMore)
        {
            exchanges.RemoveAt(exchanges.Count - 1);
        }

        return new GroupExchangeListResult(
            exchanges.Select(MapListItem).ToList(),
            hasMore);
    }

    public async Task<GroupExchangeDetail?> GetAsync(
        int id,
        bool includeCalculatedSplit = false,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var exchange = await _db.GroupExchanges
            .AsNoTracking()
            .Include(item => item.CreatedBy)
            .Include(item => item.Participants)
                .ThenInclude(participant => participant.User)
            .FirstOrDefaultAsync(item => item.Id == id && item.TenantId == tenantId, cancellationToken);

        return exchange == null
            ? null
            : MapDetail(exchange, includeCalculatedSplit ? CalculateSplit(exchange) : null);
    }

    public async Task<GroupExchangeMutationResult> CreateAsync(
        int organizerId,
        CreateGroupExchangeInput input,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var participantInputs = NormalizeParticipantInputs(input.Participants);
        try
        {
            await using var transaction = await _db.Database.BeginTransactionAsync(
                IsolationLevel.ReadCommitted,
                cancellationToken);

            var participantError = await ValidateParticipantInputsAsync(
                organizerId,
                participantInputs,
                cancellationToken,
                includeOrganizerInUserValidation: true);

            var contactIds = participantInputs
                .Select(item => item.UserId)
                .Prepend(organizerId)
                .Distinct()
                .ToArray();
            var protection = await _safeguardingInteractions.EvaluateLockedAllPairsLocalContactsAsync(
                contactIds,
                tenantId,
                "group_exchange_create",
                cancellationToken);
            if (!protection.IsAllowed)
            {
                return GroupExchangeMutationResult.SafeguardingFailed(protection);
            }

            // Laravel evaluates the all-pairs contact policy even when a supplied
            // participant is not an active tenant user. A contact restriction wins;
            // otherwise create reports the canonical internal create failure.
            if (participantError != null)
            {
                return GroupExchangeMutationResult.Failed(
                    "Failed to create exchange",
                    "INTERNAL_ERROR");
            }

            var now = DateTime.UtcNow;
            var exchange = new GroupExchange
            {
                TenantId = tenantId,
                GroupId = null,
                Title = input.Title.Trim(),
                Description = NormalizeOptionalText(input.Description),
                TotalHours = RoundHours(input.TotalHours),
                Status = input.Status ?? "draft",
                SplitType = input.SplitType ?? "equal",
                ListingId = input.ListingId,
                BrokerId = input.BrokerId,
                BrokerNotes = input.BrokerNotes,
                CreatedById = organizerId,
                CreatedAt = now,
                UpdatedAt = now
            };

            foreach (var participantInput in participantInputs)
            {
                exchange.Participants.Add(new GroupExchangeParticipant
                {
                    UserId = participantInput.UserId,
                    Role = participantInput.Role,
                    Hours = RoundHours(participantInput.Hours),
                    Weight = RoundWeight(participantInput.Weight),
                    IsConfirmed = false,
                    CreatedAt = now
                });
            }

            _db.GroupExchanges.Add(exchange);
            await _db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            _logger.LogInformation(
                "User {OrganizerId} created group exchange {ExchangeId} for tenant {TenantId}",
                organizerId,
                exchange.Id,
                tenantId);

            return GroupExchangeMutationResult.Succeeded(exchange.Id);
        }
        catch (DbUpdateException exception)
        {
            _logger.LogWarning(exception, "Could not create group exchange for user {OrganizerId}", organizerId);
            return GroupExchangeMutationResult.Failed(
                "An unexpected error occurred.",
                "SERVER_ERROR");
        }
    }

    public async Task<bool> UpdateAsync(
        int id,
        UpdateGroupExchangeInput input,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (input.Title is null &&
            input.Description is null &&
            input.SplitType is null &&
            !input.TotalHours.HasValue &&
            !input.BrokerId.HasValue &&
            input.BrokerNotes is null &&
            !input.ListingId.HasValue)
        {
            return true;
        }

        var lockAttempted = false;
        await _db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            lockAttempted = true;
            await AcquireSessionExchangeLockAsync(tenantId, id, cancellationToken);
            await using var transaction = await _db.Database.BeginTransactionAsync(
                IsolationLevel.Serializable,
                cancellationToken);

            var exchange = await _db.GroupExchanges
                .Include(item => item.Participants)
                .FirstOrDefaultAsync(item => item.Id == id && item.TenantId == tenantId, cancellationToken);

            if (exchange == null)
            {
                return false;
            }

            if (input.Title != null) exchange.Title = input.Title;
            if (input.Description != null) exchange.Description = input.Description;
            if (input.SplitType != null) exchange.SplitType = input.SplitType;
            if (input.TotalHours.HasValue) exchange.TotalHours = RoundHours(input.TotalHours.Value);
            if (input.BrokerId.HasValue) exchange.BrokerId = input.BrokerId;
            if (input.BrokerNotes != null) exchange.BrokerNotes = input.BrokerNotes;
            if (input.ListingId.HasValue) exchange.ListingId = input.ListingId;
            exchange.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        finally
        {
            await ReleaseSessionExchangeLockAndCloseAsync(tenantId, id, lockAttempted);
        }
    }

    public async Task<bool> CancelAsync(int id, CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var lockAttempted = false;
        await _db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            lockAttempted = true;
            await AcquireSessionExchangeLockAsync(tenantId, id, cancellationToken);
            await using var transaction = await _db.Database.BeginTransactionAsync(
                IsolationLevel.Serializable,
                cancellationToken);

            var exchange = await _db.GroupExchanges
                .FirstOrDefaultAsync(item => item.Id == id && item.TenantId == tenantId, cancellationToken);

            if (exchange == null)
            {
                return false;
            }

            exchange.Status = "cancelled";
            exchange.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        finally
        {
            await ReleaseSessionExchangeLockAndCloseAsync(tenantId, id, lockAttempted);
        }
    }

    public async Task<GroupExchangeOperationResult> AddParticipantAsync(
        int exchangeId,
        int organizerId,
        GroupExchangeParticipantInput input,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (!IsValidParticipant(input))
        {
            return GroupExchangeOperationResult.Failed("Failed to add participant (may already exist)");
        }

        var lockAttempted = false;
        await _db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            lockAttempted = true;
            await AcquireSessionExchangeLockAsync(tenantId, exchangeId, cancellationToken);
            await using var transaction = await _db.Database.BeginTransactionAsync(
                IsolationLevel.ReadCommitted,
                cancellationToken);

            var exchange = await _db.GroupExchanges
                .Include(item => item.Participants)
                .FirstOrDefaultAsync(item => item.Id == exchangeId &&
                                             item.TenantId == tenantId &&
                                             item.CreatedById == organizerId,
                    cancellationToken);

            if (exchange == null)
            {
                return GroupExchangeOperationResult.Failed("Failed to add participant (may already exist)");
            }

            var participantError = await ValidateParticipantInputsAsync(
                organizerId,
                new[] { input },
                cancellationToken,
                exchangeId,
                includeOrganizerInUserValidation: false);

            if (participantError != null)
            {
                return participantError;
            }

            var brokerApprovalError = await CheckBrokerApprovalAsync(
                new[] { input.UserId },
                tenantId,
                cancellationToken);
            if (brokerApprovalError != null)
            {
                return brokerApprovalError;
            }

            var contactIds = exchange.Participants
                .Select(item => item.UserId)
                .Prepend(input.UserId)
                .Prepend(exchange.CreatedById)
                .Distinct()
                .ToArray();
            var protection = await _safeguardingInteractions.EvaluateLockedAllPairsLocalContactsAsync(
                contactIds,
                tenantId,
                "group_exchange_add_participant",
                cancellationToken);
            if (!protection.IsAllowed)
            {
                return GroupExchangeOperationResult.SafeguardingFailed(protection);
            }

            var participant = new GroupExchangeParticipant
            {
                GroupExchangeId = exchangeId,
                UserId = input.UserId,
                Role = input.Role,
                Hours = RoundHours(input.Hours),
                Weight = RoundWeight(input.Weight),
                IsConfirmed = false,
                CreatedAt = DateTime.UtcNow
            };
            _db.GroupExchangeParticipants.Add(participant);

            await _db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return GroupExchangeOperationResult.Succeeded();
        }
        catch (DbUpdateException exception)
        {
            if (IsUniqueViolation(exception))
            {
                _logger.LogInformation(
                    exception,
                    "Participant {ParticipantId}/{Role} was not added to exchange {ExchangeId}",
                    input.UserId,
                    input.Role,
                    exchangeId);
                return GroupExchangeOperationResult.Failed("Failed to add participant (may already exist)");
            }

            _logger.LogError(
                exception,
                "Could not add participant {ParticipantId}/{Role} to group exchange {ExchangeId}",
                input.UserId,
                input.Role,
                exchangeId);
            return GroupExchangeOperationResult.Failed(
                "An unexpected error occurred.",
                "SERVER_ERROR");
        }
        finally
        {
            await ReleaseSessionExchangeLockAndCloseAsync(
                tenantId,
                exchangeId,
                lockAttempted);
        }
    }

    public async Task<bool> RemoveParticipantAsync(
        int exchangeId,
        int organizerId,
        int userId,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var lockAttempted = false;
        await _db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            lockAttempted = true;
            await AcquireSessionExchangeLockAsync(tenantId, exchangeId, cancellationToken);
            await using var transaction = await _db.Database.BeginTransactionAsync(
                IsolationLevel.Serializable,
                cancellationToken);

            var exchange = await _db.GroupExchanges
                .Include(item => item.Participants)
                .FirstOrDefaultAsync(item => item.Id == exchangeId &&
                                             item.TenantId == tenantId &&
                                             item.CreatedById == organizerId,
                    cancellationToken);

            if (exchange == null)
            {
                return false;
            }

            var participants = exchange.Participants
                .Where(participant => participant.UserId == userId)
                .ToList();
            if (participants.Count == 0)
            {
                return false;
            }

            _db.GroupExchangeParticipants.RemoveRange(participants);
            await _db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        finally
        {
            await ReleaseSessionExchangeLockAndCloseAsync(
                tenantId,
                exchangeId,
                lockAttempted);
        }
    }

    public async Task<GroupExchangeOperationResult> StartAsync(
        int exchangeId,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        IReadOnlyCollection<int> recipients;
        string exchangeTitle;

        var lockAttempted = false;
        await _db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            // Acquire the session lock before opening the transaction so a
            // waiter starts from the state committed by the preceding writer.
            lockAttempted = true;
            await AcquireSessionExchangeLockAsync(tenantId, exchangeId, cancellationToken);

            await using var transaction = await _db.Database.BeginTransactionAsync(
                IsolationLevel.ReadCommitted,
                cancellationToken);

            var exchange = await _db.GroupExchanges
                .Include(item => item.Participants)
                .FirstOrDefaultAsync(item => item.Id == exchangeId && item.TenantId == tenantId, cancellationToken);

            if (exchange == null)
            {
                return GroupExchangeOperationResult.Failed("Exchange not found");
            }

            if (exchange.Status is not ("draft" or "pending_participants"))
            {
                return GroupExchangeOperationResult.Failed(
                    "This exchange cannot be started from its current status.");
            }

            if (!exchange.Participants.Any(item => item.Role == ProviderRole) ||
                !exchange.Participants.Any(item => item.Role == ReceiverRole))
            {
                return GroupExchangeOperationResult.Failed(
                    "An exchange needs at least one provider and one receiver before it can start.");
            }

            var split = CalculateSplit(exchange);
            var imbalance = GetSplitImbalanceError(split);
            if (imbalance != null)
            {
                return GroupExchangeOperationResult.Failed(imbalance);
            }

            var protection = await _safeguardingInteractions.EvaluateLockedAllPairsLocalContactsAsync(
                exchange.Participants
                    .Select(item => item.UserId)
                    .Prepend(exchange.CreatedById),
                tenantId,
                "group_exchange_start",
                cancellationToken);
            if (!protection.IsAllowed)
            {
                return GroupExchangeOperationResult.SafeguardingFailed(protection);
            }

            exchange.Status = "pending_confirmation";
            exchange.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            recipients = exchange.Participants.Select(item => item.UserId).Distinct().ToArray();
            exchangeTitle = exchange.Title;
        }
        finally
        {
            await ReleaseSessionExchangeLockAndCloseAsync(
                tenantId,
                exchangeId,
                lockAttempted);
        }

        // The status transition is committed. A client disconnect must not cancel
        // the best-effort delivery side effects for that durable event.
        await NotifyStartAsync(exchangeId, exchangeTitle, recipients, tenantId, CancellationToken.None);
        return GroupExchangeOperationResult.Succeeded();
    }

    public async Task<GroupExchangeOperationResult> ConfirmParticipationAsync(
        int exchangeId,
        int userId,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var lockAttempted = false;
        await _db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            lockAttempted = true;
            await AcquireSessionExchangeLockAsync(tenantId, exchangeId, cancellationToken);
            await using var transaction = await _db.Database.BeginTransactionAsync(
                IsolationLevel.ReadCommitted,
                cancellationToken);

            var exchange = await _db.GroupExchanges
                .Include(item => item.Participants)
                .FirstOrDefaultAsync(item => item.Id == exchangeId &&
                                             item.TenantId == tenantId,
                    cancellationToken);
            if (exchange == null)
            {
                return GroupExchangeOperationResult.Failed("Failed to confirm participation");
            }

            var matchingParticipants = exchange.Participants
                .Where(participant => participant.UserId == userId && !participant.IsConfirmed)
                .ToArray();
            if (matchingParticipants.Length == 0)
            {
                return GroupExchangeOperationResult.Failed("Failed to confirm participation");
            }

            var protection = await _safeguardingInteractions.EvaluateLockedAllPairsLocalContactsAsync(
                exchange.Participants.Select(item => item.UserId),
                tenantId,
                "group_exchange_confirm",
                cancellationToken);
            if (!protection.IsAllowed)
            {
                return GroupExchangeOperationResult.SafeguardingFailed(protection);
            }

            var now = DateTime.UtcNow;
            foreach (var participant in matchingParticipants)
            {
                participant.IsConfirmed = true;
                participant.ConfirmedAt = now;
            }

            await _db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return GroupExchangeOperationResult.Succeeded();
        }
        finally
        {
            await ReleaseSessionExchangeLockAndCloseAsync(
                tenantId,
                exchangeId,
                lockAttempted);
        }
    }

    public async Task<GroupExchangeCompletionResult> CompleteAsync(
        int exchangeId,
        CancellationToken cancellationToken = default)
    {
        // The session lock serializes same-exchange completion; payer locks inside
        // the transaction serialize the shared personal-ledger balance across
        // different exchange and wallet workflows.
        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                return await CompleteOnceAsync(exchangeId, cancellationToken);
            }
            catch (Exception exception) when (attempt < 2 && IsSerializationFailure(exception))
            {
                _db.ChangeTracker.Clear();
                _logger.LogWarning(
                    exception,
                    "Retrying serialized completion for group exchange {ExchangeId} (attempt {Attempt})",
                    exchangeId,
                    attempt + 2);
            }
        }

        return GroupExchangeCompletionResult.Failed("Exchange is already completed");
    }

    private async Task<GroupExchangeCompletionResult> CompleteOnceAsync(
        int exchangeId,
        CancellationToken cancellationToken)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        List<GroupExchangeSplit> split;
        List<int> transactionIds;
        string title;

        var lockAttempted = false;
        await _db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            lockAttempted = true;
            await AcquireSessionExchangeLockAsync(tenantId, exchangeId, cancellationToken);

            await using var transaction = await _db.Database.BeginTransactionAsync(
                IsolationLevel.ReadCommitted,
                cancellationToken);

            var exchange = await _db.GroupExchanges
                .Include(item => item.Participants)
                .FirstOrDefaultAsync(item => item.Id == exchangeId && item.TenantId == tenantId, cancellationToken);

            if (exchange == null)
            {
                return GroupExchangeCompletionResult.Failed("Exchange not found");
            }

            if (exchange.Status == "completed")
            {
                return GroupExchangeCompletionResult.Failed("Exchange is already completed");
            }

            if (exchange.Status == "cancelled")
            {
                return GroupExchangeCompletionResult.Failed("Exchange cancelled");
            }

            var unconfirmed = exchange.Participants.Count(item => !item.IsConfirmed);
            if (unconfirmed > 0)
            {
                return GroupExchangeCompletionResult.Failed(
                    $"{unconfirmed} participant(s) still need to confirm");
            }

            var protection = await _safeguardingInteractions.EvaluateLockedAllPairsLocalContactsAsync(
                exchange.Participants.Select(item => item.UserId),
                tenantId,
                "group_exchange_complete",
                cancellationToken);
            if (!protection.IsAllowed)
            {
                return GroupExchangeCompletionResult.SafeguardingFailed(protection);
            }

            split = CalculateSplit(exchange);
            if (split.Count == 0)
            {
                return GroupExchangeCompletionResult.Failed("Exchange has no participants");
            }

            var imbalance = GetSplitImbalanceError(split);
            if (imbalance != null)
            {
                return GroupExchangeCompletionResult.Failed(imbalance);
            }

            var receivers = AggregatePositiveSplit(split, ReceiverRole);
            var providers = AggregatePositiveSplit(split, ProviderRole);

            foreach (var payerId in receivers
                         .Select(item => item.UserId)
                         .Distinct()
                         .OrderBy(id => id))
            {
                await _personalWallet.AcquireSpendLockAsync(payerId, cancellationToken);
            }

            foreach (var receiver in receivers)
            {
                var balance = await _personalWallet.GetBalanceAsync(
                    tenantId,
                    receiver.UserId,
                    cancellationToken);
                if (balance < receiver.Hours)
                {
                    // Laravel's guarded balance decrement raises from inside the
                    // transaction. Return its externally-observable generic 500
                    // contract while the uncommitted completion rolls back.
                    return GroupExchangeCompletionResult.Failed(
                        "An unexpected error occurred.",
                        "SERVER_ERROR");
                }
            }

            var now = DateTime.UtcNow;
            var canonicalTransactions = providers.Select(provider => new Transaction
            {
                TenantId = tenantId,
                SenderId = exchange.CreatedById,
                ReceiverId = provider.UserId,
                Amount = provider.Hours,
                Description = $"Group exchange: {exchange.Title}",
                TransactionType = ExchangeTransactionType,
                ListingId = null,
                Status = TransactionStatus.Completed,
                CreatedAt = now
            }).ToList();

            // Laravel updates mutable user balances independently of its provider
            // transaction rows. The .NET edition derives balances from the ledger,
            // so hidden adapter rows neutralize the organizer metadata leg and apply
            // the receiver debits without changing the public provider-row contract.
            var adapterTransactions = new List<Transaction>();
            if (canonicalTransactions.Count > 0)
            {
                adapterTransactions.Add(new Transaction
                {
                    TenantId = tenantId,
                    SenderId = null,
                    ReceiverId = exchange.CreatedById,
                    Amount = providers.Sum(provider => provider.Hours),
                    Description = $"Group exchange balance adapter: {exchange.Id}",
                    TransactionType = BalanceAdapterTransactionType,
                    ListingId = null,
                    Status = TransactionStatus.Completed,
                    DeletedForReceiver = true,
                    CreatedAt = now
                });
            }
            adapterTransactions.AddRange(receivers.Select(receiver => new Transaction
            {
                TenantId = tenantId,
                SenderId = receiver.UserId,
                ReceiverId = null,
                Amount = receiver.Hours,
                Description = $"Group exchange balance adapter: {exchange.Id}",
                TransactionType = BalanceAdapterTransactionType,
                ListingId = null,
                Status = TransactionStatus.Completed,
                DeletedForSender = true,
                CreatedAt = now
            }));

            _db.Transactions.AddRange(canonicalTransactions);
            _db.Transactions.AddRange(adapterTransactions);
            exchange.Status = "completed";
            exchange.CompletedAt = now;
            exchange.UpdatedAt = now;
            await _db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            transactionIds = canonicalTransactions.Select(item => item.Id).ToList();
            title = exchange.Title;
        }
        finally
        {
            await ReleaseSessionExchangeLockAndCloseAsync(
                tenantId,
                exchangeId,
                lockAttempted);
        }

        // Settlement is committed. Notification delivery is deliberately detached
        // from the request token so a disconnect cannot silence the financial event.
        await NotifyCompletionAsync(exchangeId, title, split, tenantId, CancellationToken.None);
        _logger.LogInformation(
            "Completed group exchange {ExchangeId} with {TransactionCount} conserved ledger transfers",
            exchangeId,
            transactionIds.Count);

        return GroupExchangeCompletionResult.Succeeded(transactionIds);
    }

    private async Task<GroupExchangeOperationResult?> ValidateParticipantInputsAsync(
        int organizerId,
        IReadOnlyCollection<GroupExchangeParticipantInput> participants,
        CancellationToken cancellationToken,
        int? existingExchangeId = null,
        bool includeOrganizerInUserValidation = false)
    {
        var duplicate = participants
            .GroupBy(item => (item.UserId, item.Role), EqualityComparer<(int, string)>.Default)
            .Any(group => group.Count() > 1);
        if (duplicate)
        {
            return GroupExchangeOperationResult.Failed("Failed to add participant (may already exist)");
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var userIds = participants.Select(item => item.UserId);
        if (includeOrganizerInUserValidation)
        {
            userIds = userIds.Append(organizerId);
        }
        var distinctUserIds = userIds.Distinct().ToArray();
        var foundUserIds = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.TenantId == tenantId &&
                           distinctUserIds.Contains(user.Id) &&
                           user.IsActive)
            .Select(user => user.Id)
            .ToListAsync(cancellationToken);

        if (foundUserIds.Count != distinctUserIds.Length)
        {
            return GroupExchangeOperationResult.Failed("Failed to add participant (may already exist)");
        }

        if (existingExchangeId.HasValue)
        {
            var existingParticipants = await _db.GroupExchangeParticipants
                .AsNoTracking()
                .Where(item => item.GroupExchangeId == existingExchangeId.Value)
                .Select(item => new { item.UserId, item.Role })
                .ToListAsync(cancellationToken);

            if (participants.Any(candidate => existingParticipants.Any(existing =>
                    existing.UserId == candidate.UserId && existing.Role == candidate.Role)))
            {
                return GroupExchangeOperationResult.Failed("Failed to add participant (may already exist)");
            }
        }

        return null;
    }

    private async Task<GroupExchangeOperationResult?> CheckBrokerApprovalAsync(
        IEnumerable<int> targetUserIds,
        int tenantId,
        CancellationToken cancellationToken)
    {
        foreach (var targetUserId in targetUserIds.Where(id => id > 0).Distinct().OrderBy(id => id))
        {
            try
            {
                var triggers = await _safeguardingInteractions.GetLockedActiveTriggerStateAsync(
                    targetUserId,
                    tenantId,
                    cancellationToken);
                if (triggers.RequiresBrokerApproval)
                {
                    _logger.LogInformation(
                        "Participant {ParticipantId} was blocked because their active safeguarding preference requires broker approval",
                        targetUserId);
                    return GroupExchangeOperationResult.Failed("Failed to add participant (may already exist)");
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                _logger.LogError(
                    exception,
                    "Safeguarding broker-approval lookup failed closed for participant {ParticipantId} in tenant {TenantId}",
                    targetUserId,
                    tenantId);
                return GroupExchangeOperationResult.Failed(
                    GroupExchangeSafeguardingError.PolicyUnavailableMessage,
                    "SAFEGUARDING_POLICY_UNAVAILABLE");
            }
        }

        return null;
    }

    private async Task AcquireSessionExchangeLockAsync(
        int tenantId,
        int exchangeId,
        CancellationToken cancellationToken)
    {
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_lock({tenantId}, {exchangeId})",
            cancellationToken);
    }

    private async Task ReleaseSessionExchangeLockAndCloseAsync(
        int tenantId,
        int exchangeId,
        bool lockAttempted)
    {
        try
        {
            if (lockAttempted &&
                _db.Database.GetDbConnection().State != ConnectionState.Closed)
            {
                // Never pass the request token here: after a commit (or a client
                // disconnect), releasing the session lock is mandatory before the
                // connection can return to the pool.
                await _db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT pg_advisory_unlock({tenantId}, {exchangeId})",
                    CancellationToken.None);
            }
        }
        catch (Exception exception)
        {
            _logger.LogError(
                exception,
                "Could not explicitly release group-exchange session lock {TenantId}/{ExchangeId}; closing connection",
                tenantId,
                exchangeId);
        }
        finally
        {
            try
            {
                await _db.Database.CloseConnectionAsync();
            }
            catch (Exception exception)
            {
                _logger.LogError(
                    exception,
                    "Could not close connection after group-exchange session lock {TenantId}/{ExchangeId}",
                    tenantId,
                    exchangeId);
            }
        }
    }

    private static List<GroupExchangeSplit> CalculateSplit(GroupExchange exchange)
    {
        var participants = exchange.Participants.OrderBy(item => item.Id).ToList();
        if (participants.Count == 0)
        {
            return new List<GroupExchangeSplit>();
        }

        if (exchange.SplitType == "custom")
        {
            return participants.Select(item => new GroupExchangeSplit(
                item.UserId,
                item.Role,
                RoundHours(item.Hours))).ToList();
        }

        var result = new List<GroupExchangeSplit>();
        foreach (var roleGroup in participants.GroupBy(item => item.Role))
        {
            var roleParticipants = roleGroup.ToList();
            var allocated = 0m;

            if (exchange.SplitType == "weighted")
            {
                var totalWeight = roleParticipants.Sum(item => item.Weight);
                if (totalWeight <= 0m)
                {
                    totalWeight = roleParticipants.Count;
                }

                for (var index = 0; index < roleParticipants.Count; index++)
                {
                    var participant = roleParticipants[index];
                    var hours = index == roleParticipants.Count - 1
                        ? RoundHours(exchange.TotalHours - allocated)
                        : RoundHours(((participant.Weight == 0m ? 1m : participant.Weight) / totalWeight) *
                                     exchange.TotalHours);
                    allocated += hours;
                    result.Add(new GroupExchangeSplit(participant.UserId, participant.Role, hours));
                }
            }
            else
            {
                var hoursEach = RoundHours(exchange.TotalHours / roleParticipants.Count);
                for (var index = 0; index < roleParticipants.Count; index++)
                {
                    var participant = roleParticipants[index];
                    var hours = index == roleParticipants.Count - 1
                        ? RoundHours(exchange.TotalHours - allocated)
                        : hoursEach;
                    allocated += hours;
                    result.Add(new GroupExchangeSplit(participant.UserId, participant.Role, hours));
                }
            }
        }

        return result;
    }

    private static string? GetSplitImbalanceError(IReadOnlyCollection<GroupExchangeSplit> split)
    {
        var credits = split
            .Where(item => item.Role == ProviderRole && item.Hours > 0m)
            .Sum(item => RoundHours(item.Hours));
        var debits = split
            .Where(item => item.Role != ProviderRole && item.Hours > 0m)
            .Sum(item => RoundHours(item.Hours));

        credits = RoundHours(credits);
        debits = RoundHours(debits);
        return credits == debits
            ? null
            : $"Provider hours ({credits:F2}) and receiver hours ({debits:F2}) must be equal — " +
              "an exchange cannot create or destroy time credits. Adjust participant hours and try again.";
    }

    private static List<GroupExchangeSplit> AggregatePositiveSplit(
        IEnumerable<GroupExchangeSplit> split,
        string role)
    {
        return split
            .Where(item => item.Role == role && item.Hours > 0m)
            .GroupBy(item => item.UserId)
            .Select(group => new GroupExchangeSplit(group.Key, role, RoundHours(group.Sum(item => item.Hours))))
            .ToList();
    }

    private async Task NotifyStartAsync(
        int exchangeId,
        string title,
        IReadOnlyCollection<int> userIds,
        int tenantId,
        CancellationToken cancellationToken)
    {
        foreach (var userId in userIds.Distinct())
        {
            var body = $"Group exchange “{title}” needs your confirmation.";
            await NotifyBestEffortAsync(
                tenantId,
                userId,
                "group_exchange",
                "Group exchange needs confirmation",
                body,
                $"/group-exchanges/{exchangeId}",
                "group_exchange_start",
                exchangeId,
                cancellationToken);
        }
    }

    private async Task NotifyCompletionAsync(
        int exchangeId,
        string title,
        IReadOnlyCollection<GroupExchangeSplit> split,
        int tenantId,
        CancellationToken cancellationToken)
    {
        foreach (var change in split.Where(item => item.Hours > 0m))
        {
            var direction = change.Role == ProviderRole ? "credited" : "debited";
            var body = $"Your wallet was {direction} {change.Hours:F2} hours for “{title}”.";
            await NotifyBestEffortAsync(
                tenantId,
                change.UserId,
                "transaction",
                "Group exchange completed",
                body,
                "/wallet",
                "group_exchange_completed",
                exchangeId,
                cancellationToken);
        }
    }

    private async Task NotifyBestEffortAsync(
        int tenantId,
        int userId,
        string type,
        string title,
        string body,
        string link,
        string emailTemplate,
        int exchangeId,
        CancellationToken cancellationToken)
    {
        var notification = new Notification
        {
            TenantId = tenantId,
            UserId = userId,
            Type = type,
            Title = title,
            Body = body,
            Data = JsonSerializer.Serialize(new { exchange_id = exchangeId, link }),
            CreatedAt = DateTime.UtcNow
        };

        try
        {
            _db.Notifications.Add(notification);
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(
                exception,
                "Could not create {NotificationType} notification for user {UserId}",
                type,
                userId);
            _db.Entry(notification).State = EntityState.Detached;
        }

        try
        {
            await _pushNotifications.SendPushAsync(
                userId,
                title,
                body,
                JsonSerializer.Serialize(new { exchange_id = exchangeId, link }));
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Could not send group-exchange push to user {UserId}", userId);
            // A provider-log entity left Added after a failed push save must not
            // poison the independent email channel.
            _db.ChangeTracker.Clear();
        }

        try
        {
            if (await ShouldSendTransactionalEmailAsync(userId, cancellationToken))
            {
                await _emailNotifications.SendTemplatedEmailAsync(userId, emailTemplate, new Dictionary<string, string>
                {
                    ["exchange_id"] = exchangeId.ToString(),
                    ["title"] = title,
                    ["message"] = body,
                    ["link"] = link
                });
            }
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Could not send group-exchange email to user {UserId}", userId);
        }
    }

    private async Task<bool> ShouldSendTransactionalEmailAsync(
        int userId,
        CancellationToken cancellationToken)
    {
        string? preferencesJson;
        try
        {
            preferencesJson = await _db.Users
                .AsNoTracking()
                .Where(user => user.Id == userId)
                .Select(user => user.NotificationPreferences)
                .FirstOrDefaultAsync(cancellationToken);
        }
        catch (Exception exception)
        {
            // Canonical behavior is fail-open for this preference lookup; the
            // outer channel wrapper still prevents a transport failure from
            // affecting the committed exchange.
            _logger.LogDebug(
                exception,
                "Could not load email_transactions preference for user {UserId}; using canonical default-on",
                userId);
            return true;
        }

        if (string.IsNullOrWhiteSpace(preferencesJson))
        {
            return true;
        }

        try
        {
            using var document = JsonDocument.Parse(preferencesJson);
            if (document.RootElement.ValueKind != JsonValueKind.Object ||
                !document.RootElement.TryGetProperty("email_transactions", out var preference))
            {
                return true;
            }

            return preference.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.Number when preference.TryGetInt64(out var numeric) => numeric != 0,
                JsonValueKind.String when bool.TryParse(preference.GetString(), out var parsed) => parsed,
                _ => true
            };
        }
        catch (JsonException exception)
        {
            _logger.LogDebug(
                exception,
                "Could not parse email_transactions preference for user {UserId}; using canonical default-on",
                userId);
            return true;
        }
    }

    private static GroupExchangeListItem MapListItem(GroupExchange exchange)
    {
        return new GroupExchangeListItem(
            exchange.Id,
            exchange.Title,
            exchange.Description,
            exchange.CreatedById,
            DisplayName(exchange.CreatedBy),
            exchange.CreatedBy?.AvatarUrl,
            exchange.Status,
            exchange.SplitType,
            exchange.TotalHours,
            exchange.Participants.Count,
            exchange.CreatedAt,
            exchange.UpdatedAt,
            exchange.CompletedAt);
    }

    private static GroupExchangeDetail MapDetail(
        GroupExchange exchange,
        IReadOnlyCollection<GroupExchangeSplit>? calculatedSplit)
    {
        return new GroupExchangeDetail(
            exchange.Id,
            exchange.TenantId,
            exchange.Title,
            exchange.Description,
            exchange.CreatedById,
            DisplayName(exchange.CreatedBy),
            exchange.CreatedBy?.AvatarUrl,
            exchange.ListingId,
            exchange.Status,
            exchange.SplitType,
            exchange.TotalHours,
            exchange.BrokerId,
            exchange.BrokerNotes,
            exchange.CompletedAt,
            exchange.CreatedAt,
            exchange.UpdatedAt,
            exchange.Participants.Count,
            exchange.Participants.OrderBy(item => item.Id).Select(item => new GroupExchangeParticipantDetail(
                item.Id,
                item.GroupExchangeId,
                item.UserId,
                DisplayName(item.User),
                DisplayName(item.User),
                item.User?.AvatarUrl,
                item.User?.AvatarUrl,
                item.User?.Email,
                item.Role,
                item.Hours,
                item.Weight,
                item.IsConfirmed,
                item.ConfirmedAt,
                item.Notes,
                item.CreatedAt)).ToList(),
            calculatedSplit);
    }

    private static string DisplayName(User? user) => user == null
        ? string.Empty
        : $"{user.FirstName} {user.LastName}".Trim();

    private static GroupExchangeParticipantInput[] NormalizeParticipantInputs(
        IReadOnlyCollection<GroupExchangeParticipantInput>? participants)
    {
        var normalized = new List<GroupExchangeParticipantInput>();
        var indexByKey = new Dictionary<(int UserId, string Role), int>();
        foreach (var participant in participants ?? Array.Empty<GroupExchangeParticipantInput>())
        {
            var candidate = NormalizeParticipantInput(participant);
            if (candidate.UserId <= 0 || string.IsNullOrEmpty(candidate.Role))
            {
                continue;
            }

            // PHP's associative participant map overwrites the value for an exact
            // user/role key without moving that key's original insertion position.
            var key = (candidate.UserId, candidate.Role);
            if (indexByKey.TryGetValue(key, out var existingIndex))
            {
                normalized[existingIndex] = candidate;
            }
            else
            {
                indexByKey[key] = normalized.Count;
                normalized.Add(candidate);
            }
        }
        return normalized.ToArray();
    }

    private static GroupExchangeParticipantInput NormalizeParticipantInput(
        GroupExchangeParticipantInput input) =>
        input with { Role = (input.Role ?? string.Empty).Trim() };

    private static bool IsValidParticipant(GroupExchangeParticipantInput input) =>
        input.UserId > 0 && HasPhpNonEmptyString(input.Role);

    private static bool HasPhpNonEmptyString(string? value) =>
        !string.IsNullOrEmpty(value) && value != "0";

    private static string? NormalizeOptionalText(string? value)
    {
        if (value == null) return null;
        var trimmed = value.Trim();
        return HasPhpNonEmptyString(trimmed) ? trimmed : null;
    }

    private static decimal RoundHours(decimal value) =>
        Math.Round(value, 2, MidpointRounding.AwayFromZero);

    private static decimal RoundWeight(decimal value) =>
        Math.Round(value, 2, MidpointRounding.AwayFromZero);

    private static bool IsUniqueViolation(Exception exception)
    {
        var pending = new Stack<Exception>();
        pending.Push(exception);

        while (pending.Count > 0)
        {
            var current = pending.Pop();
            if (current is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                return true;
            }

            if (current is AggregateException aggregate)
            {
                foreach (var inner in aggregate.InnerExceptions)
                {
                    pending.Push(inner);
                }
            }
            else if (current.InnerException != null)
            {
                pending.Push(current.InnerException);
            }
        }

        return false;
    }

    private static bool IsSerializationFailure(Exception exception)
    {
        var pending = new Stack<Exception>();
        pending.Push(exception);

        while (pending.Count > 0)
        {
            var current = pending.Pop();
            if (current is PostgresException { SqlState: PostgresErrorCodes.SerializationFailure })
            {
                return true;
            }

            if (current is AggregateException aggregate)
            {
                foreach (var inner in aggregate.InnerExceptions)
                {
                    pending.Push(inner);
                }
            }
            else if (current.InnerException != null)
            {
                pending.Push(current.InnerException);
            }
        }

        return false;
    }
}

public sealed record CreateGroupExchangeInput(
    string Title,
    string? Description,
    string? Status,
    string? SplitType,
    decimal TotalHours,
    int? ListingId,
    int? BrokerId,
    string? BrokerNotes,
    IReadOnlyCollection<GroupExchangeParticipantInput>? Participants);

public sealed record UpdateGroupExchangeInput(
    string? Title,
    string? Description,
    string? SplitType,
    decimal? TotalHours,
    int? BrokerId,
    string? BrokerNotes,
    int? ListingId);

public sealed record GroupExchangeParticipantInput(
    int UserId,
    string Role,
    decimal Hours,
    decimal Weight = 1m);

public sealed record GroupExchangeListResult(
    IReadOnlyCollection<GroupExchangeListItem> Items,
    bool HasMore);

public sealed record GroupExchangeMutationResult(
    bool Success,
    int? ExchangeId,
    string? Error,
    string? ErrorCode)
{
    public static GroupExchangeMutationResult Succeeded(int exchangeId) => new(true, exchangeId, null, null);
    public static GroupExchangeMutationResult Failed(string error, string? errorCode = "VALIDATION_ERROR") =>
        new(false, null, error, errorCode);
    public static GroupExchangeMutationResult SafeguardingFailed(SafeguardingInteractionDecision decision) =>
        new(false, null, GroupExchangeSafeguardingError.Message(decision), decision.Code);
}

public sealed record GroupExchangeOperationResult(bool Success, string? Error, string? ErrorCode)
{
    public static GroupExchangeOperationResult Succeeded() => new(true, null, null);
    public static GroupExchangeOperationResult Failed(string error, string? errorCode = "VALIDATION_ERROR") =>
        new(false, error, errorCode);
    public static GroupExchangeOperationResult SafeguardingFailed(SafeguardingInteractionDecision decision) =>
        new(false, GroupExchangeSafeguardingError.Message(decision), decision.Code);
}

public sealed record GroupExchangeCompletionResult(
    bool Success,
    IReadOnlyCollection<int> TransactionIds,
    string? Error,
    string? ErrorCode)
{
    public static GroupExchangeCompletionResult Succeeded(IReadOnlyCollection<int> ids) =>
        new(true, ids, null, null);
    public static GroupExchangeCompletionResult Failed(string error, string? errorCode = "VALIDATION_ERROR") =>
        new(false, Array.Empty<int>(), error, errorCode);
    public static GroupExchangeCompletionResult SafeguardingFailed(SafeguardingInteractionDecision decision) =>
        new(false, Array.Empty<int>(), GroupExchangeSafeguardingError.Message(decision), decision.Code);
}

public sealed record GroupExchangeListItem(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("organizer_id")] int OrganizerId,
    [property: JsonPropertyName("organizer_name")] string OrganizerName,
    [property: JsonPropertyName("organizer_avatar")] string? OrganizerAvatar,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("split_type")] string SplitType,
    [property: JsonPropertyName("total_hours")] decimal TotalHours,
    [property: JsonPropertyName("participant_count")] int ParticipantCount,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt,
    [property: JsonPropertyName("completed_at")] DateTime? CompletedAt);

public sealed record GroupExchangeDetail(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("organizer_id")] int OrganizerId,
    [property: JsonPropertyName("organizer_name")] string OrganizerName,
    [property: JsonPropertyName("organizer_avatar")] string? OrganizerAvatar,
    [property: JsonPropertyName("listing_id")] int? ListingId,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("split_type")] string SplitType,
    [property: JsonPropertyName("total_hours")] decimal TotalHours,
    [property: JsonPropertyName("broker_id")] int? BrokerId,
    [property: JsonPropertyName("broker_notes")] string? BrokerNotes,
    [property: JsonPropertyName("completed_at")] DateTime? CompletedAt,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt,
    [property: JsonPropertyName("participant_count")] int ParticipantCount,
    [property: JsonPropertyName("participants")] IReadOnlyCollection<GroupExchangeParticipantDetail> Participants,
    [property: JsonPropertyName("calculated_split")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyCollection<GroupExchangeSplit>? CalculatedSplit);

public sealed record GroupExchangeParticipantDetail(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("group_exchange_id")] int GroupExchangeId,
    [property: JsonPropertyName("user_id")] int UserId,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("user_name")] string UserName,
    [property: JsonPropertyName("avatar_url")] string? AvatarUrl,
    [property: JsonPropertyName("user_avatar")] string? UserAvatar,
    [property: JsonPropertyName("user_email")] string? UserEmail,
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("hours")] decimal Hours,
    [property: JsonPropertyName("weight")] decimal Weight,
    [property: JsonPropertyName("confirmed")] bool Confirmed,
    [property: JsonPropertyName("confirmed_at")] DateTime? ConfirmedAt,
    [property: JsonPropertyName("notes")] string? Notes,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt);

public sealed record GroupExchangeSplit(
    [property: JsonPropertyName("user_id")] int UserId,
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("hours")] decimal Hours);

internal static class GroupExchangeSafeguardingError
{
    public const string PolicyUnavailableMessage =
        "We cannot confirm the community safeguarding policy right now. No message has been sent. Please try again shortly.";

    public static string Message(SafeguardingInteractionDecision decision)
    {
        return decision.Code switch
        {
            "SAFEGUARDING_POLICY_UNAVAILABLE" => PolicyUnavailableMessage,
            "VETTING_REQUIRED" =>
                $"This conversation is paused by a community safeguarding rule. Your community must have recorded a current {string.Join(", ", decision.RequiredAttestationLabels ?? Array.Empty<string>())} confirmation for you before you can message this member. Ask your broker or community administrator to record this metadata-only status. Do not send or upload any vetting document.",
            _ =>
                "This member has asked for a coordinator to arrange contact on their behalf. Your message has not been sent. Please contact your broker or community administrator so they can help arrange the next safe step."
        };
    }
}
