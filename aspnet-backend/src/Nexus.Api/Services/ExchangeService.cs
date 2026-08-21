// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Observability;

namespace Nexus.Api.Services;

/// <summary>
/// Manages the exchange workflow lifecycle.
/// Handles state transitions, credit transfers, and ratings.
/// </summary>
public class ExchangeService
{
    /// <summary>
    /// Laravel's transaction_type for an exchange settlement leg
    /// (ExchangeWorkflowService.php:1249). The same literal
    /// <c>GroupExchangeService</c> uses for group settlements.
    /// </summary>
    public const string ExchangeTransactionType = "exchange";

    /// <summary>
    /// The window inside which two confirmed hour figures count as agreement.
    /// Laravel: <c>$varianceTolerance = 0.25</c> in
    /// <c>ExchangeWorkflowService::processConfirmations</c> (:927). Beyond it the
    /// exchange goes to dispute and NO credits move.
    /// </summary>
    public const decimal AgreementToleranceHours = 0.25m;

    /// <summary>
    /// Below this the two figures are treated as the same number and the
    /// requester's value is settled verbatim rather than averaged. Laravel:
    /// <c>abs($requesterHours - $providerHours) &lt; 0.01</c> (:923).
    /// </summary>
    private const decimal IdenticalHoursEpsilon = 0.01m;

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly GamificationService _gamification;
    private readonly ILogger<ExchangeService> _logger;
    private readonly IConfiguration _configuration;
    private readonly PersonalWalletLedgerService _wallet;
    private readonly ExchangeWorkflowConfigService _workflowConfig;

    // Valid state transitions: from -> allowed destinations
    //
    // 🔴 InProgress no longer transitions straight to Completed. That edge was the
    // schema-less shortcut: it let one party's "complete" be the settlement, which
    // is exactly what Laravel refuses to do. The canonical machine is
    //   pending_provider -> accepted -> in_progress -> pending_confirmation -> completed
    // (Laravel's TRANSITIONS map, app/Services/ExchangeWorkflowService.php), and
    // `Requested` here is Laravel's `pending_provider`. Completion is reachable ONLY
    // from PendingConfirmation, and only from ConfirmHoursAsync with two agreeing
    // confirmations on record.
    private static readonly Dictionary<ExchangeStatus, ExchangeStatus[]> ValidTransitions = new()
    {
        [ExchangeStatus.Requested] = new[] { ExchangeStatus.Accepted, ExchangeStatus.Declined, ExchangeStatus.Cancelled, ExchangeStatus.Expired },
        [ExchangeStatus.Accepted] = new[] { ExchangeStatus.InProgress, ExchangeStatus.Cancelled },
        [ExchangeStatus.InProgress] = new[] { ExchangeStatus.PendingConfirmation, ExchangeStatus.Cancelled, ExchangeStatus.Disputed },
        [ExchangeStatus.PendingConfirmation] = new[] { ExchangeStatus.Completed, ExchangeStatus.Disputed, ExchangeStatus.Cancelled },
        [ExchangeStatus.Completed] = new[] { ExchangeStatus.Disputed },
        [ExchangeStatus.Disputed] = new[] { ExchangeStatus.Resolved },
        [ExchangeStatus.Declined] = Array.Empty<ExchangeStatus>(),
        [ExchangeStatus.Cancelled] = Array.Empty<ExchangeStatus>(),
        [ExchangeStatus.Resolved] = Array.Empty<ExchangeStatus>(),
        [ExchangeStatus.Expired] = Array.Empty<ExchangeStatus>(),
    };

    public ExchangeService(
        NexusDbContext db,
        TenantContext tenantContext,
        GamificationService gamification,
        ILogger<ExchangeService> logger,
        IConfiguration configuration,
        PersonalWalletLedgerService wallet,
        ExchangeWorkflowConfigService workflowConfig)
    {
        _db = db;
        _tenantContext = tenantContext;
        _gamification = gamification;
        _logger = logger;
        _configuration = configuration;
        _wallet = wallet;
        _workflowConfig = workflowConfig;
    }

    /// <summary>
    /// Create a new exchange request on a listing.
    /// </summary>
    public async Task<(Exchange? Exchange, string? Error)> CreateExchangeAsync(
        int initiatorId, int listingId, decimal? agreedHours, string? message, DateTime? scheduledAt, int? groupId)
    {
        var listing = await _db.Listings
            .FirstOrDefaultAsync(l => l.Id == listingId && l.Status == ListingStatus.Active);

        if (listing == null)
            return (null, "Listing not found or not active");

        if (listing.UserId == initiatorId)
            return (null, "Cannot request an exchange on your own listing");

        // Check for existing active exchange between these users on this listing
        var existingExchange = await _db.Exchanges
            .AnyAsync(e => e.ListingId == listingId
                && e.InitiatorId == initiatorId
                && e.Status != ExchangeStatus.Declined
                && e.Status != ExchangeStatus.Cancelled
                && e.Status != ExchangeStatus.Expired
                && e.Status != ExchangeStatus.Completed
                && e.Status != ExchangeStatus.Resolved);

        if (existingExchange)
            return (null, "You already have an active exchange request on this listing");

        // Determine provider and receiver based on listing type
        int? providerId = null;
        int? receiverId = null;

        if (listing.Type == ListingType.Offer)
        {
            // Listing owner offers a service, initiator receives it
            providerId = listing.UserId;
            receiverId = initiatorId;
        }
        else
        {
            // Listing owner requests a service, initiator provides it
            providerId = initiatorId;
            receiverId = listing.UserId;
        }

        // Configurable hour limits (defaults match V1)
        var minHours = _configuration.GetValue("ExchangeLimits:MinHours", 0.25m);
        var maxHours = _configuration.GetValue("ExchangeLimits:MaxHours", 24.0m);
        var hours = agreedHours ?? listing.EstimatedHours ?? 1.0m;
        if (hours < minHours)
            return (null, $"Minimum exchange duration is {minHours} hours");
        if (hours > maxHours)
            return (null, $"Maximum exchange duration is {maxHours} hours");

        var exchange = new Exchange
        {
            ListingId = listingId,
            InitiatorId = initiatorId,
            ListingOwnerId = listing.UserId,
            ProviderId = providerId,
            ReceiverId = receiverId,
            AgreedHours = hours,
            RequestMessage = message?.Trim(),
            ScheduledAt = scheduledAt,
            GroupId = groupId,
            Status = ExchangeStatus.Requested,
            CreatedAt = DateTime.UtcNow
        };

        _db.Exchanges.Add(exchange);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Exchange {ExchangeId} created: user {InitiatorId} → listing {ListingId}",
            exchange.Id, initiatorId, listingId);

        return (exchange, null);
    }

    /// <summary>
    /// Accept an exchange request. Only the listing owner can accept.
    /// </summary>
    public async Task<(Exchange? Exchange, string? Error)> AcceptExchangeAsync(
        int exchangeId, int userId, decimal? adjustedHours)
    {
        var exchange = await GetExchangeWithValidation(exchangeId, userId);
        if (exchange == null)
            return (null, "Exchange not found");

        if (exchange.ListingOwnerId != userId)
            return (null, "Only the listing owner can accept this exchange");

        var transitionError = ValidateTransition(exchange, ExchangeStatus.Accepted);
        if (transitionError != null)
            return (null, transitionError);

        exchange.Status = ExchangeStatus.Accepted;
        if (adjustedHours.HasValue && adjustedHours.Value > 0)
            exchange.AgreedHours = adjustedHours.Value;
        exchange.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Exchange {ExchangeId} accepted by user {UserId}", exchangeId, userId);
        return (exchange, null);
    }

    /// <summary>
    /// Decline an exchange request. Only the listing owner can decline.
    /// </summary>
    public async Task<(Exchange? Exchange, string? Error)> DeclineExchangeAsync(
        int exchangeId, int userId, string? reason)
    {
        var exchange = await GetExchangeWithValidation(exchangeId, userId);
        if (exchange == null)
            return (null, "Exchange not found");

        if (exchange.ListingOwnerId != userId)
            return (null, "Only the listing owner can decline this exchange");

        var transitionError = ValidateTransition(exchange, ExchangeStatus.Declined);
        if (transitionError != null)
            return (null, transitionError);

        exchange.Status = ExchangeStatus.Declined;
        exchange.DeclineReason = reason?.Trim();
        exchange.CancelledAt = DateTime.UtcNow;
        exchange.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Exchange {ExchangeId} declined by user {UserId}", exchangeId, userId);
        return (exchange, null);
    }

    /// <summary>
    /// Start the exchange (move to InProgress). Either party can start.
    /// </summary>
    public async Task<(Exchange? Exchange, string? Error)> StartExchangeAsync(int exchangeId, int userId)
    {
        var exchange = await GetExchangeWithValidation(exchangeId, userId);
        if (exchange == null)
            return (null, "Exchange not found");

        if (!IsParticipant(exchange, userId))
            return (null, "You are not a participant in this exchange");

        var transitionError = ValidateTransition(exchange, ExchangeStatus.InProgress);
        if (transitionError != null)
            return (null, transitionError);

        exchange.Status = ExchangeStatus.InProgress;
        exchange.StartedAt = DateTime.UtcNow;
        exchange.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Exchange {ExchangeId} started by user {UserId}", exchangeId, userId);
        return (exchange, null);
    }

    /// <summary>
    /// Mark the work done and hand the exchange to the two-party confirmation step.
    /// This is what Laravel's <c>POST /v2/exchanges/{id}/complete</c> does —
    /// <c>ExchangeWorkflowService::markReadyForConfirmation</c>
    /// (app/Services/ExchangeWorkflowService.php:397-418) — and it is NOT settlement.
    ///
    /// 🔴 THIS METHOD MOVES NO CREDITS, ON ANY PATH, AND MUST NOT BE MADE TO.
    /// Until 2026-08-21 it refused outright because the model could not hold two
    /// separate confirmations; the columns now exist, and the temptation this replaces
    /// is to settle here instead. Settling here would pay out on ONE party's word,
    /// which is the single thing this feature exists to prevent. All credit movement
    /// lives in <see cref="ConfirmHoursAsync"/>, behind two recorded confirmations
    /// that agree within <see cref="AgreementToleranceHours"/>.
    ///
    /// <paramref name="actualHours"/> is accepted for wire compatibility (the
    /// controller's <c>CompleteExchangeRequest</c> carries it) and deliberately
    /// IGNORED: the settled figure comes from the two confirmations, never from the
    /// party who declares the work finished. Laravel's equivalent takes no hours at
    /// all.
    /// </summary>
    public async Task<(Exchange? Exchange, string? Error)> CompleteExchangeAsync(
        int exchangeId, int userId, decimal? actualHours)
    {
        var exchange = await GetExchangeWithValidation(exchangeId, userId);
        if (exchange == null)
            return (null, "Exchange not found");

        if (!IsParticipant(exchange, userId))
            return (null, "You are not a participant in this exchange");

        // Laravel restricts this to the PROVIDER and calls out why: it closes a
        // direct-call IDOR where the receiver could declare their own work done
        // (ExchangeWorkflowService.php:401-404). The React client shows the button on
        // exactly that rule — `canComplete = isProvider && status === 'in_progress'`
        // (react-frontend/src/pages/exchanges/ExchangeDetailPage.tsx:400).
        var providerId = ResolveProviderId(exchange);
        if (providerId == null || providerId.Value != userId)
            return (null, "Only the provider can mark this exchange as complete");

        var transitionError = ValidateTransition(exchange, ExchangeStatus.PendingConfirmation);
        if (transitionError != null)
            return (null, transitionError);

        exchange.Status = ExchangeStatus.PendingConfirmation;
        exchange.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Exchange {ExchangeId} marked ready for confirmation by provider {UserId}; no credits moved",
            exchangeId, userId);
        return (exchange, null);
    }

    /// <summary>
    /// Record one party's confirmed hours and, once BOTH parties have confirmed and
    /// their figures agree, settle the exchange through the personal-wallet ledger.
    ///
    /// This is the transaction a timebank exists for, so the rules are copied from
    /// Laravel rather than invented — <c>ExchangeWorkflowService::confirmCompletion</c>
    /// (:445-526), <c>::processConfirmations</c> (:919-1006) and
    /// <c>::createTransaction</c> (:1164-1268):
    ///
    ///  1. only a participant may confirm; anyone else gets NOT_FOUND, not a 403, so
    ///     an outsider cannot use the status code to enumerate exchange ids;
    ///  2. the exchange must be InProgress or PendingConfirmation. Confirming while
    ///     InProgress also advances it, which is Laravel's behaviour and lets a
    ///     receiver confirm before the provider marks the work done;
    ///  3. the submitted hours are CLAMPED into the tenant's variance window around
    ///     AgreedHours (default ±25%, <c>max_hour_variance_percent</c>) before being
    ///     stored — a party cannot confirm an arbitrary number;
    ///  4. credits move only when both confirmations exist AND
    ///     |requester − provider| ≤ 0.25h. Identical (&lt;0.01h apart) settles the
    ///     requester's figure; merely close settles the mean. Anything wider goes to
    ///     Disputed and moves NOTHING;
    ///  5. the payer is the party RECEIVING the service and the payee the party
    ///     PROVIDING it. That axis flips with the listing type, and getting it wrong
    ///     charges the helper — a bug Laravel shipped and fixed (:1176-1194).
    ///
    /// 🔴 Concurrency. Everything happens inside one database transaction holding
    /// <see cref="PersonalWalletLedgerService"/> advisory locks on both members, taken
    /// in sorted order by that service. Those two locks do double duty: they serialise
    /// the two confirmations racing each other on this exchange, AND they serialise
    /// this settlement against every other certified writer that spends the payer's
    /// balance. The balance itself is DERIVED from the ledger by that service — this
    /// method never writes a balance column, and there is no balance column to write.
    ///
    /// 🔴 Exactly-once. A settled exchange is Completed, and Completed is not an
    /// accepted input state at step 2, so a replayed or duplicated confirmation is
    /// refused rather than paying twice. That refusal is load-bearing: the alias this
    /// endpoint replaced was measured live REOPENING a completed exchange that already
    /// carried a settled TransactionId.
    /// </summary>
    public async Task<ExchangeConfirmationResult> ConfirmHoursAsync(
        int exchangeId,
        int userId,
        decimal hours,
        CancellationToken cancellationToken = default)
    {
        if (hours <= 0m)
            return ExchangeConfirmationResult.Failed(
                ExchangeConfirmationError.Validation, "Confirmed hours must be greater than zero");

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var variancePercent = (await _workflowConfig.GetAsync(cancellationToken)).MaxHourVariancePercent;

        // Read the two member ids before opening the transaction so the advisory-lock
        // key set is known up front; the authoritative re-read happens under the locks.
        var parties = await _db.Exchanges
            .AsNoTracking()
            .IgnoreQueryFilters()
            .Where(e => e.Id == exchangeId && e.TenantId == tenantId)
            .Select(e => new { e.InitiatorId, e.ListingOwnerId, e.ProviderId, e.ReceiverId })
            .FirstOrDefaultAsync(cancellationToken);

        if (parties == null || (parties.InitiatorId != userId && parties.ListingOwnerId != userId))
            return ExchangeConfirmationResult.Failed(
                ExchangeConfirmationError.NotFound, "Exchange not found");

        var lockIds = new[] { parties.InitiatorId, parties.ListingOwnerId, parties.ProviderId ?? 0, parties.ReceiverId ?? 0 }
            .Where(id => id > 0);

        await using var databaseTransaction = await _db.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted, cancellationToken);

        await _wallet.AcquireSpendLocksAsync(lockIds, cancellationToken);

        var exchange = await _db.Exchanges
            .IgnoreQueryFilters()
            .Include(e => e.Listing)
            .FirstOrDefaultAsync(e => e.Id == exchangeId && e.TenantId == tenantId, cancellationToken);

        if (exchange == null || !IsParticipant(exchange, userId))
            return ExchangeConfirmationResult.Failed(
                ExchangeConfirmationError.NotFound, "Exchange not found");

        if (exchange.Status is not (ExchangeStatus.InProgress or ExchangeStatus.PendingConfirmation))
        {
            // Includes the already-settled case. Refusing here is what makes a
            // repeated confirmation idempotent instead of a second payment.
            _logger.LogInformation(
                "Refused hours confirmation for exchange {ExchangeId} in status {Status}",
                exchangeId, exchange.Status);
            return ExchangeConfirmationResult.Failed(
                ExchangeConfirmationError.Workflow,
                "This exchange is not awaiting hours confirmation");
        }

        var confirmed = ClampToVarianceWindow(hours, exchange.AgreedHours, variancePercent);
        var now = DateTime.UtcNow;
        var isRequester = exchange.InitiatorId == userId;

        if (isRequester)
        {
            exchange.RequesterConfirmedAt = now;
            exchange.RequesterConfirmedHours = confirmed;
        }
        else
        {
            exchange.ProviderConfirmedAt = now;
            exchange.ProviderConfirmedHours = confirmed;
        }

        if (exchange.Status == ExchangeStatus.InProgress)
            exchange.Status = ExchangeStatus.PendingConfirmation;

        exchange.UpdatedAt = now;

        if (exchange.RequesterConfirmedAt == null || exchange.ProviderConfirmedAt == null)
        {
            await _db.SaveChangesAsync(cancellationToken);
            await databaseTransaction.CommitAsync(cancellationToken);
            _logger.LogInformation(
                "Exchange {ExchangeId}: recorded {Party} confirmation of {Hours}h; awaiting the counterparty",
                exchangeId, isRequester ? "requester" : "provider", confirmed);
            return ExchangeConfirmationResult.Recorded(exchange);
        }

        var requesterHours = exchange.RequesterConfirmedHours ?? 0m;
        var providerHours = exchange.ProviderConfirmedHours ?? 0m;
        var gap = Math.Abs(requesterHours - providerHours);

        if (gap > AgreementToleranceHours)
        {
            exchange.Status = ExchangeStatus.Disputed;
            exchange.Notes =
                $"Hours mismatch: requester={requesterHours}, provider={providerHours}";
            await _db.SaveChangesAsync(cancellationToken);
            await databaseTransaction.CommitAsync(cancellationToken);
            _logger.LogWarning(
                "Exchange {ExchangeId} disputed: requester confirmed {RequesterHours}h, provider {ProviderHours}h; no credits moved",
                exchangeId, requesterHours, providerHours);
            return ExchangeConfirmationResult.Disputed(exchange);
        }

        // Rounded to two places on purpose: FinalHours is decimal(5,2), so an
        // unrounded mean such as 2.125 would be rounded by the database anyway and
        // the ledger amount would then disagree with the stored figure by a cent of
        // an hour. AwayFromZero matches MySQL's rounding on the canonical engine.
        var finalHours = gap < IdenticalHoursEpsilon
            ? requesterHours
            : decimal.Round((requesterHours + providerHours) / 2m, 2, MidpointRounding.AwayFromZero);

        var payerId = ResolveReceiverId(exchange);
        var payeeId = ResolveProviderId(exchange);

        if (payerId == null || payeeId == null || payerId.Value == payeeId.Value)
        {
            _logger.LogError(
                "Exchange {ExchangeId}: cannot determine payer/payee (receiver={Receiver}, provider={Provider}) — refusing to move credits",
                exchangeId, payerId, payeeId);
            DiscardUncommittedConfirmation();
            return ExchangeConfirmationResult.Failed(
                ExchangeConfirmationError.PartyUnavailable,
                "One of the participants is no longer available for this exchange");
        }

        // A party who changed community (or was deleted) is invisible to a
        // tenant-scoped lookup. Laravel checks BOTH ends before touching balances,
        // because without it the payer was debited while the credit matched zero
        // rows and the credits were silently destroyed (:1226-1240).
        var presentParties = await _db.Users
            .IgnoreQueryFilters()
            .Where(u => u.TenantId == tenantId && (u.Id == payerId.Value || u.Id == payeeId.Value))
            .Select(u => u.Id)
            .ToListAsync(cancellationToken);

        if (presentParties.Count != 2)
        {
            _logger.LogError(
                "Exchange {ExchangeId}: payer {PayerId} and/or payee {PayeeId} not found in tenant {TenantId} — refusing to move credits",
                exchangeId, payerId, payeeId, tenantId);
            DiscardUncommittedConfirmation();
            return ExchangeConfirmationResult.Failed(
                ExchangeConfirmationError.PartyUnavailable,
                "One of the participants is no longer available for this exchange");
        }

        var payerBalance = await _wallet.GetBalanceAsync(tenantId, payerId.Value, cancellationToken);
        if (payerBalance < finalHours)
        {
            // The uncommitted transaction rolls back on dispose, so the
            // counterparty's confirmation is NOT lost and nothing moved. Laravel
            // surfaces this as a typed 422 rather than an opaque 500.
            _logger.LogWarning(
                "Exchange {ExchangeId}: payer {PayerId} has {Balance}h, needs {FinalHours}h — settlement refused",
                exchangeId, payerId, payerBalance, finalHours);
            DiscardUncommittedConfirmation();
            return ExchangeConfirmationResult.Failed(
                ExchangeConfirmationError.InsufficientBalance,
                "Insufficient balance to complete this exchange");
        }

        var transitionError = ValidateTransition(exchange, ExchangeStatus.Completed);
        if (transitionError != null)
        {
            DiscardUncommittedConfirmation();
            return ExchangeConfirmationResult.Failed(ExchangeConfirmationError.Workflow, transitionError);
        }

        var settlement = new Transaction
        {
            TenantId = tenantId,
            SenderId = payerId.Value,
            ReceiverId = payeeId.Value,
            Amount = finalHours,
            // Laravel's exact description, so wallet history reads the same in both
            // engines (ExchangeWorkflowService.php:1250).
            Description = $"Exchange #{exchangeId} for listing: {exchange.Listing?.Title ?? string.Empty}",
            TransactionType = ExchangeTransactionType,
            ListingId = exchange.ListingId,
            Status = TransactionStatus.Completed,
            CreatedAt = now
        };
        _db.Transactions.Add(settlement);
        await _db.SaveChangesAsync(cancellationToken);

        exchange.FinalHours = finalHours;
        exchange.ActualHours = finalHours;
        exchange.TransactionId = settlement.Id;
        exchange.CompletedAt = now;
        exchange.Status = ExchangeStatus.Completed;
        exchange.UpdatedAt = now;
        await _db.SaveChangesAsync(cancellationToken);
        await databaseTransaction.CommitAsync(cancellationToken);

        _logger.LogInformation(
            "Exchange {ExchangeId} settled: {FinalHours}h from user {PayerId} to user {PayeeId} via transaction {TransactionId}",
            exchangeId, finalHours, payerId, payeeId, settlement.Id);

        return ExchangeConfirmationResult.Settled(exchange, settlement.Id);
    }

    /// <summary>
    /// Forget the in-memory confirmation after a refusal that happens once the entity
    /// has already been mutated. The database transaction rolls back on dispose, so the
    /// row is untouched — but this DbContext is scoped and a later SaveChanges in the
    /// same scope would otherwise flush the abandoned confirmation, persisting a change
    /// the caller was just told did not happen.
    /// </summary>
    private void DiscardUncommittedConfirmation() => _db.ChangeTracker.Clear();

    /// <summary>
    /// Clamp a submitted figure into the tenant's variance window around the agreed
    /// hours. Laravel: <c>ExchangeWorkflowService::confirmCompletion</c> :480-486,
    /// window read from <c>max_hour_variance_percent</c> (default 25).
    /// </summary>
    private static decimal ClampToVarianceWindow(decimal hours, decimal agreedHours, int variancePercent)
    {
        if (agreedHours <= 0m) return hours;
        var factor = Math.Clamp(variancePercent, 0, 100) / 100m;
        var minimum = agreedHours * (1m - factor);
        var maximum = agreedHours * (1m + factor);
        return Math.Clamp(hours, minimum, maximum);
    }

    /// <summary>
    /// Who does the work, and therefore who is PAID. Stored at creation; derived from
    /// the listing type for rows that predate that (an Offer is fulfilled by its
    /// owner, a Request by whoever answered it).
    /// </summary>
    private static int? ResolveProviderId(Exchange exchange)
    {
        if (exchange.ProviderId.HasValue) return exchange.ProviderId;
        if (exchange.Listing == null) return null;
        return exchange.Listing.Type == ListingType.Offer
            ? exchange.ListingOwnerId
            : exchange.InitiatorId;
    }

    /// <summary>Who receives the service, and therefore who PAYS.</summary>
    private static int? ResolveReceiverId(Exchange exchange)
    {
        if (exchange.ReceiverId.HasValue) return exchange.ReceiverId;
        if (exchange.Listing == null) return null;
        return exchange.Listing.Type == ListingType.Offer
            ? exchange.InitiatorId
            : exchange.ListingOwnerId;
    }

    /// <summary>
    /// Cancel an exchange. Either party can cancel before completion.
    /// </summary>
    public async Task<(Exchange? Exchange, string? Error)> CancelExchangeAsync(
        int exchangeId, int userId, string? reason)
    {
        var exchange = await GetExchangeWithValidation(exchangeId, userId);
        if (exchange == null)
            return (null, "Exchange not found");

        if (!IsParticipant(exchange, userId))
            return (null, "You are not a participant in this exchange");

        var transitionError = ValidateTransition(exchange, ExchangeStatus.Cancelled);
        if (transitionError != null)
            return (null, transitionError);

        exchange.Status = ExchangeStatus.Cancelled;
        exchange.DeclineReason = reason?.Trim();
        exchange.CancelledAt = DateTime.UtcNow;
        exchange.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Exchange {ExchangeId} cancelled by user {UserId}", exchangeId, userId);
        return (exchange, null);
    }

    /// <summary>
    /// Dispute a completed exchange.
    /// </summary>
    public async Task<(Exchange? Exchange, string? Error)> DisputeExchangeAsync(
        int exchangeId, int userId, string reason)
    {
        var exchange = await GetExchangeWithValidation(exchangeId, userId);
        if (exchange == null)
            return (null, "Exchange not found");

        if (!IsParticipant(exchange, userId))
            return (null, "You are not a participant in this exchange");

        if (string.IsNullOrWhiteSpace(reason))
            return (null, "A reason is required for disputes");

        var transitionError = ValidateTransition(exchange, ExchangeStatus.Disputed);
        if (transitionError != null)
            return (null, transitionError);

        exchange.Status = ExchangeStatus.Disputed;
        exchange.Notes = $"Disputed by user {userId}: {reason.Trim()}";
        exchange.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogWarning("Exchange {ExchangeId} disputed by user {UserId}: {Reason}",
            exchangeId, userId, reason);
        return (exchange, null);
    }

    /// <summary>
    /// Rate the other participant after exchange completion.
    /// </summary>
    public async Task<(ExchangeRating? Rating, string? Error)> RateExchangeAsync(
        int exchangeId, int raterId, int rating, string? comment, bool? wouldWorkAgain)
    {
        var exchange = await _db.Exchanges
            .Include(e => e.Ratings)
            .FirstOrDefaultAsync(e => e.Id == exchangeId);

        if (exchange == null)
            return (null, "Exchange not found");

        if (!IsParticipant(exchange, raterId))
            return (null, "You are not a participant in this exchange");

        if (exchange.Status != ExchangeStatus.Completed && exchange.Status != ExchangeStatus.Resolved)
            return (null, "Can only rate completed exchanges");

        if (rating < 1 || rating > 5)
            return (null, "Rating must be between 1 and 5");

        // Check if already rated
        if (exchange.Ratings.Any(r => r.RaterId == raterId))
            return (null, "You have already rated this exchange");

        // Determine who is being rated
        var ratedUserId = GetOtherParticipant(exchange, raterId);
        if (ratedUserId == null)
            return (null, "Cannot determine the other participant");

        var exchangeRating = new ExchangeRating
        {
            ExchangeId = exchangeId,
            RaterId = raterId,
            RatedUserId = ratedUserId.Value,
            Rating = rating,
            Comment = comment?.Trim(),
            WouldWorkAgain = wouldWorkAgain,
            CreatedAt = DateTime.UtcNow
        };

        _db.ExchangeRatings.Add(exchangeRating);
        await _db.SaveChangesAsync();

        // Award XP and check badges (non-critical)
        try
        {
            await _gamification.AwardXpAsync(raterId, XpLog.Amounts.ReviewLeft, XpLog.Sources.ReviewLeft, exchangeId, "Rated an exchange");
            await _gamification.CheckAndAwardBadgesAsync(raterId, "review_left");
            if (rating == 5)
                await _gamification.CheckAndAwardBadgesAsync(ratedUserId.Value, "five_star_received");
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP for rating exchange {ExchangeId}", exchangeId);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP for rating exchange {ExchangeId}", exchangeId);
        }

        _logger.LogInformation("Exchange {ExchangeId} rated by user {RaterId}: {Rating}/5",
            exchangeId, raterId, rating);
        return (exchangeRating, null);
    }

    private async Task<Exchange?> GetExchangeWithValidation(int exchangeId, int userId)
    {
        return await _db.Exchanges
            .Include(e => e.Listing)
            .FirstOrDefaultAsync(e => e.Id == exchangeId);
    }

    private static bool IsParticipant(Exchange exchange, int userId)
    {
        return exchange.InitiatorId == userId || exchange.ListingOwnerId == userId;
    }

    private static int? GetOtherParticipant(Exchange exchange, int userId)
    {
        if (exchange.InitiatorId == userId) return exchange.ListingOwnerId;
        if (exchange.ListingOwnerId == userId) return exchange.InitiatorId;
        return null;
    }

    private static string? ValidateTransition(Exchange exchange, ExchangeStatus newStatus)
    {
        if (!ValidTransitions.TryGetValue(exchange.Status, out var allowed) || !allowed.Contains(newStatus))
            return $"Cannot transition from {exchange.Status} to {newStatus}";
        return null;
    }
}

/// <summary>
/// What a refused hours confirmation was refused for. Kept as a closed set rather
/// than a message so the controller can pick the status code Laravel returns —
/// message-sniffing is how a 422 became an opaque 500 on the canonical engine.
/// </summary>
public enum ExchangeConfirmationError
{
    /// <summary>No such exchange for this tenant, or the caller is not a party. 404.</summary>
    NotFound,
    /// <summary>Missing or non-positive hours. 400.</summary>
    Validation,
    /// <summary>Wrong state — including already settled. 400.</summary>
    Workflow,
    /// <summary>The payer cannot cover the settled hours. 422, Laravel's INSUFFICIENT_BALANCE.</summary>
    InsufficientBalance,
    /// <summary>A party left the tenant or cannot be resolved. 409, Laravel's EXCHANGE_PARTY_UNAVAILABLE.</summary>
    PartyUnavailable
}

/// <summary>Which of the three legitimate confirmation outcomes happened.</summary>
public enum ExchangeConfirmationOutcome
{
    /// <summary>Refused; nothing changed.</summary>
    Refused,
    /// <summary>This party's figure is stored; the counterparty has still to confirm.</summary>
    Recorded,
    /// <summary>Both agreed; credits moved exactly once.</summary>
    Settled,
    /// <summary>Both confirmed but disagreed by more than the tolerance; no credits moved.</summary>
    Disputed
}

/// <summary>
/// Outcome of <see cref="ExchangeService.ConfirmHoursAsync"/>. <see cref="Settled"/>
/// is the only value that implies credits moved, and it always carries the
/// settlement's <see cref="TransactionId"/> — a "success" with no transaction id is
/// not representable.
/// </summary>
public sealed record ExchangeConfirmationResult(
    ExchangeConfirmationOutcome Outcome,
    Exchange? Exchange,
    ExchangeConfirmationError? Error,
    string? Message,
    int? TransactionId)
{
    public bool Ok => Outcome != ExchangeConfirmationOutcome.Refused;

    public static ExchangeConfirmationResult Recorded(Exchange exchange) =>
        new(ExchangeConfirmationOutcome.Recorded, exchange, null, null, null);

    public static ExchangeConfirmationResult Settled(Exchange exchange, int transactionId) =>
        new(ExchangeConfirmationOutcome.Settled, exchange, null, null, transactionId);

    public static ExchangeConfirmationResult Disputed(Exchange exchange) =>
        new(ExchangeConfirmationOutcome.Disputed, exchange, null, null, null);

    public static ExchangeConfirmationResult Failed(ExchangeConfirmationError error, string message) =>
        new(ExchangeConfirmationOutcome.Refused, null, error, message, null);
}
