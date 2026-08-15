// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Event attendance credit ledger â€” Laravel parity for EventCreditService.
/// Credits are minted FROM the community (sender null) to the attendee, once
/// per member per event, database-enforced; a reversal is a child claim
/// moving the same amount member â†’ community, balance allowed to go negative.
/// The platform capability 'attendance_credits' (off | treasury) is the kill
/// switch: off blocks minting AND admin retries; the ledger read and the
/// reversal correction path deliberately survive it.
/// </summary>
public class EventCreditService
{
    public const string TypeReward = "attendance_reward";
    public const string TypeReversal = "attendance_reward_reversal";
    public const string TransactionTypeReward = "event_attendance_reward";
    public const string TransactionTypeReversal = "event_attendance_reversal";
    public const string FundingSource = "tenant_treasury";
    public const string StatusPending = "pending";
    public const string StatusCompleted = "completed";
    public const string StatusFailed = "failed";
    public const string StatusReversed = "reversed";

    private readonly NexusDbContext _db;
    private readonly PlatformCapabilityService _capabilities;
    private readonly IConfiguration _configuration;
    private readonly ILogger<EventCreditService> _logger;

    public EventCreditService(
        NexusDbContext db,
        PlatformCapabilityService capabilities,
        IConfiguration configuration,
        ILogger<EventCreditService> logger)
    {
        _db = db;
        _capabilities = capabilities;
        _configuration = configuration;
        _logger = logger;
    }

    public sealed record Outcome(
        string Status, long? ClaimId = null, int? TransactionId = null, decimal? Amount = null);

    public decimal Ceiling()
    {
        var raw = _configuration["Events:AttendanceCreditMax"];
        return decimal.TryParse(raw, out var parsed) && parsed > 0 ? Math.Round(parsed, 2) : 2.00m;
    }

    public Task<string> ModeAsync(CancellationToken ct)
        => _capabilities.EffectiveValueAsync("attendance_credits", ct);

    /// <summary>Per-event claims roll-up for the reward-config screen.</summary>
    public async Task<List<object>> ClaimsRollupAsync(int eventId, CancellationToken ct)
    {
        var rows = await _db.EventAttendanceCreditClaims
            .AsNoTracking()
            .Where(c => c.EventId == eventId
                && c.ClaimType == TypeReward)
            .GroupBy(c => c.Status)
            .Select(g => new { Status = g.Key, Count = g.Count(), Total = g.Sum(c => c.Amount) })
            .ToListAsync(ct);
        return rows.Select(r => (object)new
        {
            status = r.Status,
            count = r.Count,
            total_amount = (double)r.Total
        }).ToList();
    }

    /// <summary>
    /// Admin retry of a failed reward mint. The platform kill switch also
    /// blocks retries; the claim's FROZEN amount is used, never the event's
    /// current configuration.
    /// </summary>
    public async Task<Outcome> RetryClaimAsync(long claimId, CancellationToken ct)
    {
        if (await ModeAsync(ct) != "treasury") return new Outcome("disabled");

        var claim = await _db.EventAttendanceCreditClaims
            .FirstOrDefaultAsync(c => c.Id == claimId, ct);
        if (claim is null) return new Outcome("not_found");
        if (claim.ClaimType != TypeReward
            || claim.Status != StatusFailed)
        {
            return new Outcome("not_retryable");
        }

        // Conditional failedâ†’pending flip is the race guard.
        var flipped = await _db.EventAttendanceCreditClaims
            .Where(c => c.Id == claimId && c.Status == StatusFailed)
            .ExecuteUpdateAsync(s => s
                .SetProperty(c => c.Status, StatusPending)
                .SetProperty(c => c.FailureCode, (string?)null)
                .SetProperty(c => c.UpdatedAt, DateTime.UtcNow), ct);
        if (flipped != 1) return new Outcome("not_retryable");

        await _db.Entry(claim).ReloadAsync(ct);
        var amount = Math.Min(Math.Round(claim.Amount, 2), Ceiling());
        return await AttemptMintAsync(claim, amount, ct);
    }

    /// <summary>
    /// Admin reversal of a completed reward: the original flips to reversed,
    /// a child claim reclaims the amount member â†’ community. One reversal per
    /// reward, database-enforced twice.
    /// </summary>
    public async Task<Outcome> ReverseClaimAsync(
        long claimId, int actorUserId, string reason, CancellationToken ct)
    {
        var claim = await _db.EventAttendanceCreditClaims
            .FirstOrDefaultAsync(c => c.Id == claimId, ct);
        if (claim is null) return new Outcome("not_found");
        if (claim.ClaimType != TypeReward
            || claim.Status != StatusCompleted
            || claim.ReversedAt is not null)
        {
            return new Outcome("not_reversible");
        }

        var flipped = await _db.EventAttendanceCreditClaims
            .Where(c => c.Id == claimId
                && c.Status == StatusCompleted
                && c.ReversedAt == null)
            .ExecuteUpdateAsync(s => s
                .SetProperty(c => c.Status, StatusReversed)
                .SetProperty(c => c.ReversedAt, DateTime.UtcNow)
                .SetProperty(c => c.ReversalCode, "admin_reversal")
                .SetProperty(c => c.UpdatedAt, DateTime.UtcNow), ct);
        if (flipped != 1) return new Outcome("not_reversible");

        var child = new EventAttendanceCreditClaim
        {
            TenantId = claim.TenantId,
            EventId = claim.EventId,
            AttendanceId = claim.AttendanceId,
            UserId = claim.UserId,
            ClaimType = TypeReversal,
            IdempotencyKey =
                $"event_credit:{claim.TenantId}:{claim.EventId}:{claim.UserId}:attendance_reward_reversal",
            FundingSourceType = FundingSource,
            PayerUserId = claim.UserId,
            PayeeUserId = null,
            Amount = claim.Amount,
            Status = StatusPending,
            ParentClaimId = claim.Id,
            Metadata = System.Text.Json.JsonSerializer.Serialize(new
            {
                schema_version = 1,
                mode = "treasury",
                actor_user_id = actorUserId,
                reason
            }),
            CreatedAt = DateTime.UtcNow
        };
        _db.EventAttendanceCreditClaims.Add(child);
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // A reversal already exists â€” restore the original and refuse.
            _db.Entry(child).State = EntityState.Detached;
            await RestoreReversedAsync(claim.Id, ct);
            return new Outcome("not_reversible");
        }

        try
        {
            // Reclaim member â†’ community: sender is the member, receiver null.
            // Balance is deliberately allowed to go negative.
            var transaction = new Transaction
            {
                TenantId = claim.TenantId,
                SenderId = claim.UserId,
                ReceiverId = null,
                Amount = claim.Amount,
                Description = $"Reversal of event attendance reward (event #{claim.EventId})",
                TransactionType = TransactionTypeReversal,
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow
            };
            _db.Transactions.Add(transaction);
            child.Status = StatusCompleted;
            child.CompletedAt = DateTime.UtcNow;
            child.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            child.TransactionId = transaction.Id;
            await _db.SaveChangesAsync(ct);
            return new Outcome("reversed", child.Id, transaction.Id, claim.Amount);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[EventCredits] reclaim failed for claim {ClaimId}", claimId);
            child.Status = StatusFailed;
            child.FailureCode = "reclaim_failed";
            child.FailedAt = DateTime.UtcNow;
            child.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(CancellationToken.None);
            await RestoreReversedAsync(claim.Id, CancellationToken.None);
            return new Outcome("reverse_failed", child.Id, null, claim.Amount);
        }
    }

    private async Task<Outcome> AttemptMintAsync(
        EventAttendanceCreditClaim claim, decimal amount, CancellationToken ct)
    {
        try
        {
            // Community mint: no sender â€” credits are created, not moved.
            var transaction = new Transaction
            {
                TenantId = claim.TenantId,
                SenderId = null,
                ReceiverId = claim.UserId,
                Amount = amount,
                Description = $"Event attendance reward (event #{claim.EventId})",
                TransactionType = TransactionTypeReward,
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow
            };
            _db.Transactions.Add(transaction);
            claim.Status = StatusCompleted;
            claim.CompletedAt = DateTime.UtcNow;
            claim.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            claim.TransactionId = transaction.Id;
            await _db.SaveChangesAsync(ct);
            return new Outcome("settled", claim.Id, transaction.Id, amount);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[EventCredits] mint failed for claim {ClaimId}", claim.Id);
            claim.Status = StatusFailed;
            claim.FailureCode = "mint_failed";
            claim.FailedAt = DateTime.UtcNow;
            claim.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(CancellationToken.None);
            return new Outcome("deferred_failed", claim.Id, null, amount);
        }
    }

    private Task RestoreReversedAsync(long claimId, CancellationToken ct) =>
        _db.EventAttendanceCreditClaims
            .Where(c => c.Id == claimId && c.Status == StatusReversed)
            .ExecuteUpdateAsync(s => s
                .SetProperty(c => c.Status, StatusCompleted)
                .SetProperty(c => c.ReversedAt, (DateTime?)null)
                .SetProperty(c => c.ReversalCode, (string?)null)
                .SetProperty(c => c.UpdatedAt, DateTime.UtcNow), ct);
}
