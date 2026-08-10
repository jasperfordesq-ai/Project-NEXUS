// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Transactional wallet operations for the dedicated volunteer-organisation
/// domain. Personal balances remain ledger-derived in the .NET edition: a
/// deposit is a transaction with a null receiver, while a later hours payout
/// is represented by a transaction with a null sender.
/// </summary>
public sealed class VolunteerOrganisationWalletService
{
    private readonly NexusDbContext _db;
    private readonly PersonalWalletLedgerService _personalWallet;
    private readonly ILogger<VolunteerOrganisationWalletService> _logger;

    public VolunteerOrganisationWalletService(
        NexusDbContext db,
        PersonalWalletLedgerService personalWallet,
        ILogger<VolunteerOrganisationWalletService> logger)
    {
        _db = db;
        _personalWallet = personalWallet;
        _logger = logger;
    }

    public async Task<VolunteerOrganisationWalletSummary> GetSummaryAsync(
        int tenantId,
        int organisationId,
        CancellationToken ct = default)
    {
        var balance = await _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(org => org.Id == organisationId && org.TenantId == tenantId)
            .Select(org => (decimal?)org.Balance)
            .SingleOrDefaultAsync(ct) ?? 0m;

        var stats = await _db.VolunteerOrganisationTransactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(transaction => transaction.TenantId == tenantId
                && transaction.VolunteerOrganisationId == organisationId)
            .GroupBy(_ => 1)
            .Select(group => new
            {
                TotalDeposited = group.Sum(row => row.Amount > 0m ? row.Amount : 0m),
                TotalPaidOut = group.Sum(row => row.Amount < 0m ? -row.Amount : 0m),
                TransactionCount = group.Count()
            })
            .SingleOrDefaultAsync(ct);

        var pendingHours = 0m;
        if (await TableExistsAsync("vol_logs", ct))
        {
            pendingHours = await _db.VolunteerLogs
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(log => log.TenantId == tenantId
                    && log.OrganizationId == organisationId
                    && log.Status == "pending")
                .SumAsync(log => log.Hours, ct);
        }

        return new(
            balance,
            stats?.TotalDeposited ?? 0m,
            stats?.TotalPaidOut ?? 0m,
            stats?.TransactionCount ?? 0,
            pendingHours);
    }

    public async Task<VolunteerOrganisationWalletPage> GetTransactionsAsync(
        int tenantId,
        int organisationId,
        int perPage,
        string? cursor,
        string? type,
        CancellationToken ct = default)
    {
        perPage = Math.Clamp(perPage, 1, 50);
        var cursorId = DecodeCursor(cursor);
        var query = _db.VolunteerOrganisationTransactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(transaction => transaction.TenantId == tenantId
                && transaction.VolunteerOrganisationId == organisationId);

        if (cursorId.HasValue)
            query = query.Where(transaction => transaction.Id < cursorId.Value);
        if (!string.IsNullOrWhiteSpace(type))
            query = query.Where(transaction => transaction.Type == type.Trim());

        var rows = await query
            .OrderByDescending(transaction => transaction.Id)
            .Take(perPage + 1)
            .Select(transaction => new VolunteerOrganisationWalletTransactionView(
                transaction.Id,
                transaction.Type,
                transaction.Amount,
                transaction.BalanceAfter,
                transaction.Description,
                transaction.CreatedAt,
                transaction.VolunteerLogId,
                transaction.UserId.HasValue
                    ? new VolunteerOrganisationWalletUserView(
                        transaction.UserId.Value,
                        transaction.User == null
                            ? "Unknown user"
                            : (transaction.User.FirstName + " " + transaction.User.LastName).Trim(),
                        transaction.User == null ? null : transaction.User.AvatarUrl)
                    : null))
            .ToListAsync(ct);

        var hasMore = rows.Count > perPage;
        if (hasMore)
            rows.RemoveAt(rows.Count - 1);

        return new(
            rows,
            hasMore && rows.Count > 0 ? EncodeCursor(rows[^1].Id) : null,
            hasMore,
            perPage);
    }

    public async Task<VolunteerOrganisationWalletMutationResult> DepositAsync(
        int tenantId,
        int userId,
        int organisationId,
        decimal amount,
        string? note,
        CancellationToken ct = default)
    {
        if (amount <= 0m)
            return VolunteerOrganisationWalletMutationResult.Failed(
                "VALIDATION_ERROR", "Amount must be greater than zero", "amount");
        if (decimal.Truncate(amount) != amount)
            return VolunteerOrganisationWalletMutationResult.Failed(
                "VALIDATION_ERROR", "Deposits must be a whole number of credits", "amount");
        if (amount > 1000m)
            return VolunteerOrganisationWalletMutationResult.Failed(
                "VALIDATION_ERROR", "Deposit cannot exceed 1000 credits", "amount");

        await using var transaction = await _db.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            ct);
        try
        {
            // Existing personal-wallet writers use PostgreSQL's one-bigint
            // advisory-lock namespace keyed by user id. Share that exact key so
            // a deposit cannot race a transfer/donation that spends the same
            // ledger-derived balance, then take the organisation-scoped key.
            await _personalWallet.AcquireSpendLockAsync(userId, ct);
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock({tenantId}, {-organisationId})",
                ct);

            var user = await _db.Users
                .IgnoreQueryFilters()
                .SingleOrDefaultAsync(row => row.Id == userId
                    && row.TenantId == tenantId
                    && row.IsActive, ct);
            if (user is null)
            {
                await transaction.RollbackAsync(ct);
                return VolunteerOrganisationWalletMutationResult.Failed(
                    "NOT_FOUND", "User not found");
            }

            var organisation = await _db.VolunteerOrganisations
                .IgnoreQueryFilters()
                .SingleOrDefaultAsync(org => org.Id == organisationId
                    && org.TenantId == tenantId, ct);
            if (organisation is null)
            {
                await transaction.RollbackAsync(ct);
                return VolunteerOrganisationWalletMutationResult.Failed(
                    "NOT_FOUND", "Organisation not found");
            }
            if (organisation.Status is not ("active" or "approved"))
            {
                await transaction.RollbackAsync(ct);
                return VolunteerOrganisationWalletMutationResult.Failed(
                    "ORG_NOT_ACTIVE", "Organisation is not active");
            }

            var personalBalance = await _personalWallet.GetBalanceAsync(tenantId, userId, ct);
            if (personalBalance < amount)
            {
                await transaction.RollbackAsync(ct);
                return VolunteerOrganisationWalletMutationResult.Failed(
                    "VALIDATION_ERROR", "Insufficient personal balance");
            }

            var newBalance = organisation.Balance + amount;
            var description = string.IsNullOrWhiteSpace(note)
                ? $"Deposit from {(user.FirstName + " " + user.LastName).Trim()}"
                : note.Trim();

            organisation.Balance = newBalance;
            organisation.UpdatedAt = DateTime.UtcNow;
            _db.Transactions.Add(new Transaction
            {
                TenantId = tenantId,
                SenderId = userId,
                ReceiverId = null,
                Amount = amount,
                Description = $"Volunteer organisation deposit: {description}",
                TransactionType = PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType,
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow
            });
            _db.VolunteerOrganisationTransactions.Add(new VolunteerOrganisationTransaction
            {
                TenantId = tenantId,
                VolunteerOrganisationId = organisationId,
                UserId = userId,
                Type = "deposit",
                Amount = amount,
                BalanceAfter = newBalance,
                Description = description,
                CreatedAt = DateTime.UtcNow
            });

            await _db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return VolunteerOrganisationWalletMutationResult.Succeeded(
                newBalance,
                "Deposit successful");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            await transaction.RollbackAsync(CancellationToken.None);
            _logger.LogError(
                exception,
                "Volunteer organisation deposit failed for tenant {TenantId}, organisation {OrganisationId}, user {UserId}",
                tenantId,
                organisationId,
                userId);
            return VolunteerOrganisationWalletMutationResult.Failed(
                "SERVER_ERROR", "Deposit failed");
        }
    }

    public async Task<VolunteerOrganisationWalletMutationResult> AdminAdjustmentAsync(
        int tenantId,
        int adminUserId,
        int organisationId,
        decimal amount,
        string? reason,
        CancellationToken ct = default)
    {
        amount = decimal.Round(amount, 2, MidpointRounding.AwayFromZero);
        if (amount == 0m)
            return VolunteerOrganisationWalletMutationResult.Failed(
                "VALIDATION_ERROR", "Amount cannot be zero", "amount");
        if (string.IsNullOrWhiteSpace(reason))
            return VolunteerOrganisationWalletMutationResult.Failed(
                "VALIDATION_ERROR", "Reason is required", "reason");

        await using var transaction = await _db.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            ct);
        try
        {
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock({tenantId}, {-organisationId})",
                ct);
            var organisation = await _db.VolunteerOrganisations
                .IgnoreQueryFilters()
                .SingleOrDefaultAsync(org => org.Id == organisationId
                    && org.TenantId == tenantId, ct);
            if (organisation is null)
            {
                await transaction.RollbackAsync(ct);
                return VolunteerOrganisationWalletMutationResult.Failed(
                    "VALIDATION_ERROR", "Organisation not found");
            }

            var newBalance = organisation.Balance + amount;
            if (newBalance < 0m)
            {
                await transaction.RollbackAsync(ct);
                return VolunteerOrganisationWalletMutationResult.Failed(
                    "VALIDATION_ERROR", "Adjustment cannot make the balance negative");
            }

            organisation.Balance = newBalance;
            organisation.UpdatedAt = DateTime.UtcNow;
            _db.VolunteerOrganisationTransactions.Add(new VolunteerOrganisationTransaction
            {
                TenantId = tenantId,
                VolunteerOrganisationId = organisationId,
                UserId = adminUserId,
                Type = "admin_adjustment",
                Amount = amount,
                BalanceAfter = newBalance,
                Description = $"Admin adjustment: {reason.Trim()}",
                CreatedAt = DateTime.UtcNow
            });
            await _db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return VolunteerOrganisationWalletMutationResult.Succeeded(
                newBalance,
                "Adjustment applied");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            await transaction.RollbackAsync(CancellationToken.None);
            _logger.LogError(
                exception,
                "Volunteer organisation adjustment failed for tenant {TenantId}, organisation {OrganisationId}",
                tenantId,
                organisationId);
            return VolunteerOrganisationWalletMutationResult.Failed(
                "SERVER_ERROR", "Adjustment failed");
        }
    }

    private Task<bool> TableExistsAsync(string tableName, CancellationToken ct) =>
        _db.Database
            .SqlQueryRaw<bool>(
                "SELECT to_regclass({0}) IS NOT NULL AS \"Value\"",
                $"public.{tableName}")
            .SingleAsync(ct);

    // Laravel's volunteer-wallet service uses a plain numeric keyset cursor.
    private static string EncodeCursor(int id) => id.ToString();

    private static int? DecodeCursor(string? cursor)
    {
        if (string.IsNullOrWhiteSpace(cursor))
            return null;
        return int.TryParse(cursor, out var id) && id > 0 ? id : null;
    }
}

public sealed record VolunteerOrganisationWalletSummary(
    [property: JsonPropertyName("balance")] decimal Balance,
    [property: JsonPropertyName("total_deposited")] decimal TotalDeposited,
    [property: JsonPropertyName("total_paid_out")] decimal TotalPaidOut,
    [property: JsonPropertyName("transaction_count")] int TransactionCount,
    [property: JsonPropertyName("pending_hours_value")] decimal PendingHoursValue);

public sealed record VolunteerOrganisationWalletUserView(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("avatar_url")] string? AvatarUrl);

public sealed record VolunteerOrganisationWalletTransactionView(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("amount")] decimal Amount,
    [property: JsonPropertyName("balance_after")] decimal BalanceAfter,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("vol_log_id")] int? VolunteerLogId,
    [property: JsonPropertyName("user")] VolunteerOrganisationWalletUserView? User);

public sealed record VolunteerOrganisationWalletPage(
    IReadOnlyList<VolunteerOrganisationWalletTransactionView> Items,
    string? Cursor,
    bool HasMore,
    int PerPage);

public sealed record VolunteerOrganisationWalletMutationResult(
    bool Success,
    decimal? NewBalance,
    string? Message,
    string? ErrorCode,
    string? ErrorMessage,
    string? ErrorField)
{
    public static VolunteerOrganisationWalletMutationResult Succeeded(
        decimal newBalance,
        string message) =>
        new(true, newBalance, message, null, null, null);

    public static VolunteerOrganisationWalletMutationResult Failed(
        string code,
        string message,
        string? field = null) =>
        new(false, null, null, code, message, field);
}
