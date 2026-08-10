// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for organisation wallet operations.
/// </summary>
public class OrgWalletService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<OrgWalletService> _logger;
    private readonly PersonalWalletLedgerService _personalWallet;

    public OrgWalletService(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<OrgWalletService> logger,
        PersonalWalletLedgerService personalWallet)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
        _personalWallet = personalWallet;
    }

    public async Task<OrgWallet?> GetWalletAsync(int organisationId)
    {
        return await _db.Set<OrgWallet>()
            .Include(w => w.Organisation)
            .FirstOrDefaultAsync(w => w.OrganisationId == organisationId);
    }

    public async Task<OrgWallet> EnsureWalletAsync(int organisationId)
    {
        var wallet = await _db.Set<OrgWallet>()
            .FirstOrDefaultAsync(w => w.OrganisationId == organisationId);

        if (wallet == null)
        {
            wallet = new OrgWallet { TenantId = _tenantContext.GetTenantIdOrThrow(), OrganisationId = organisationId };
            _db.Set<OrgWallet>().Add(wallet);
            await _db.SaveChangesAsync();
        }

        return wallet;
    }

    public async Task<List<OrgWalletTransaction>> GetTransactionsAsync(
        int organisationId, int page = 1, int limit = 20)
    {
        var wallet = await _db.Set<OrgWallet>()
            .FirstOrDefaultAsync(w => w.OrganisationId == organisationId);
        if (wallet == null) return new List<OrgWalletTransaction>();

        return await _db.Set<OrgWalletTransaction>()
            .Where(t => t.OrgWalletId == wallet.Id)
            .Include(t => t.InitiatedBy)
            .Include(t => t.FromUser)
            .Include(t => t.ToUser)
            .OrderByDescending(t => t.CreatedAt)
            .Skip((Math.Max(1, page) - 1) * Math.Clamp(limit, 1, 100))
            .Take(Math.Clamp(limit, 1, 100))
            .ToListAsync();
    }

    public async Task<(OrgWalletTransaction? Tx, string? Error)> DonateAsync(
        int organisationId, int fromUserId, decimal amount, string? description)
    {
        if (amount <= 0) return (null, "Amount must be positive");
        if (amount > 100) return (null, "Maximum donation is 100 credits per transaction");

        // READ COMMITTED is safe here because every personal-wallet spender
        // takes the same transaction-scoped advisory lock before its balance read.
        await using var dbTransaction = await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted);
        try
        {
            // Lock on sender to serialize concurrent donations from same user
            await _personalWallet.AcquireSpendLockAsync(fromUserId);
            await OrganisationLifecycleLock.AcquireAsync(_db, organisationId);

            var org = await _db.Set<Organisation>()
                .AsNoTracking()
                .FirstOrDefaultAsync(o => o.Id == organisationId);
            if (org == null)
            {
                await dbTransaction.RollbackAsync();
                return (null, "Organisation not found");
            }
            if (!string.Equals(org.Status, "verified", StringComparison.Ordinal))
            {
                await dbTransaction.RollbackAsync();
                return (null, "Organisation is not active");
            }

            // Check user has sufficient balance (now protected by lock)
            var tenantId = _tenantContext.GetTenantIdOrThrow();
            var userBalance = await _personalWallet.GetBalanceAsync(tenantId, fromUserId);
            if (userBalance < amount)
            {
                await dbTransaction.RollbackAsync();
                return (null, "Insufficient balance");
            }

            var wallet = await EnsureWalletAsync(organisationId);
            // One-sided personal debit: the organisation wallet is the
            // counter-ledger, so no synthetic user receiver is required.
            var debitTx = new Transaction
            {
                TenantId = tenantId,
                SenderId = fromUserId,
                ReceiverId = null,
                Amount = amount,
                Description = description ?? $"Donation to organisation #{organisationId}",
                TransactionType = "organisation_donation",
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow
            };
            _db.Transactions.Add(debitTx);

            // Credit org wallet
            wallet.Balance += amount;
            wallet.TotalReceived += amount;
            wallet.UpdatedAt = DateTime.UtcNow;

            var tx = new OrgWalletTransaction
            {
                OrgWalletId = wallet.Id,
                Type = "credit",
                Amount = amount,
                BalanceAfter = wallet.Balance,
                Category = "donation",
                Description = description ?? "Personal donation",
                InitiatedById = fromUserId,
                FromUserId = fromUserId
            };

            _db.Set<OrgWalletTransaction>().Add(tx);
            await _db.SaveChangesAsync();
            await dbTransaction.CommitAsync();

            _logger.LogInformation("User {UserId} donated {Amount} to org {OrgId}", fromUserId, amount, organisationId);
            return (tx, null);
        }
        catch (DbUpdateException ex)
        {
            await dbTransaction.RollbackAsync();
            _logger.LogError(ex, "Database error during donation from user {UserId} to org {OrgId}", fromUserId, organisationId);
            return (null, "Donation failed due to a database error. Please try again.");
        }
    }

    public async Task<(OrgWalletTransaction? Tx, string? Error)> TransferToUserAsync(
        int organisationId, int toUserId, int initiatedById, decimal amount, string? description)
    {
        if (amount <= 0) return (null, "Amount must be positive");

        // READ COMMITTED is intentional: a transfer may wait behind a status or
        // membership writer on the organisation lock and must then see that
        // writer's committed state rather than a pre-wait transaction snapshot.
        await using var dbTransaction = await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted);
        try
        {
            // Lock on org ID to serialize concurrent transfers from same wallet
            await OrganisationLifecycleLock.AcquireAsync(_db, organisationId);

            var org = await _db.Set<Organisation>()
                .AsNoTracking()
                .FirstOrDefaultAsync(o => o.Id == organisationId);
            if (org == null)
            {
                await dbTransaction.RollbackAsync();
                return (null, "Organisation not found");
            }
            if (!string.Equals(org.Status, "verified", StringComparison.Ordinal))
            {
                await dbTransaction.RollbackAsync();
                return (null, "Organisation is not active");
            }

            var member = await _db.Set<OrganisationMember>()
                .FirstOrDefaultAsync(m => m.OrganisationId == organisationId
                    && m.UserId == initiatedById);
            var isCanonicalOwner = org.OwnerId == initiatedById;
            var isOrganisationAdmin = string.Equals(
                member?.Role,
                "admin",
                StringComparison.OrdinalIgnoreCase);
            if (!isCanonicalOwner && !isOrganisationAdmin)
            {
                await dbTransaction.RollbackAsync();
                return (null, "Not authorized to transfer from this wallet");
            }

            var tenantId = _tenantContext.GetTenantIdOrThrow();
            var targetUser = await _db.Users
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(user => user.Id == toUserId
                    && user.TenantId == tenantId
                    && user.IsActive
                    && user.SuspendedAt == null);
            if (targetUser == null)
            {
                await dbTransaction.RollbackAsync();
                return (null, "Target user not found");
            }

            var wallet = await _db.Set<OrgWallet>()
                .FirstOrDefaultAsync(w => w.OrganisationId == organisationId);
            if (wallet == null)
            {
                await dbTransaction.RollbackAsync();
                return (null, "Organisation wallet not found");
            }
            if (wallet.Balance < amount)
            {
                await dbTransaction.RollbackAsync();
                return (null, "Insufficient org wallet balance");
            }

            // Debit org wallet
            wallet.Balance -= amount;
            wallet.TotalSpent += amount;
            wallet.UpdatedAt = DateTime.UtcNow;

            // Credit the target from the organisation's external wallet. A
            // self-transfer would have zero derived-balance effect.
            var creditTx = new Transaction
            {
                TenantId = tenantId,
                SenderId = null,
                ReceiverId = toUserId,
                Amount = amount,
                Description = description ?? $"Transfer from organisation #{organisationId}",
                TransactionType = "organisation_transfer",
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow
            };
            _db.Transactions.Add(creditTx);

            var tx = new OrgWalletTransaction
            {
                OrgWalletId = wallet.Id,
                Type = "debit",
                Amount = amount,
                BalanceAfter = wallet.Balance,
                Category = "transfer",
                Description = description ?? "Transfer to member",
                InitiatedById = initiatedById,
                ToUserId = toUserId
            };

            _db.Set<OrgWalletTransaction>().Add(tx);
            await _db.SaveChangesAsync();
            await dbTransaction.CommitAsync();

            _logger.LogInformation("Org {OrgId} transferred {Amount} to user {UserId}", organisationId, amount, toUserId);
            return (tx, null);
        }
        catch (DbUpdateException ex)
        {
            await dbTransaction.RollbackAsync();
            _logger.LogError(ex, "Database error during transfer from org {OrgId} to user {UserId}", organisationId, toUserId);
            return (null, "Transfer failed due to a database error. Please try again.");
        }
    }

    public async Task<(OrgWalletTransaction? Tx, string? Error)> AdminGrantAsync(
        int organisationId, decimal amount, string? description)
    {
        if (amount <= 0) return (null, "Amount must be positive");

        await using var dbTransaction = await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted);
        try
        {
            await OrganisationLifecycleLock.AcquireAsync(_db, organisationId);
            var tenantId = _tenantContext.GetTenantIdOrThrow();
            var organisation = await _db.Organisations
                .IgnoreQueryFilters()
                .AsNoTracking()
                .FirstOrDefaultAsync(candidate => candidate.Id == organisationId
                    && candidate.TenantId == tenantId);
            if (organisation == null)
            {
                await dbTransaction.RollbackAsync();
                return (null, "Organisation not found");
            }
            if (!string.Equals(organisation.Status, "verified", StringComparison.Ordinal))
            {
                await dbTransaction.RollbackAsync();
                return (null, "Organisation is not active");
            }
            var wallet = await EnsureWalletAsync(organisationId);

            wallet.Balance += amount;
            wallet.TotalReceived += amount;
            wallet.UpdatedAt = DateTime.UtcNow;

            var tx = new OrgWalletTransaction
            {
                OrgWalletId = wallet.Id,
                Type = "credit",
                Amount = amount,
                BalanceAfter = wallet.Balance,
                Category = "admin_grant",
                Description = description ?? "Admin grant"
            };

            _db.Set<OrgWalletTransaction>().Add(tx);
            await _db.SaveChangesAsync();
            await dbTransaction.CommitAsync();

            _logger.LogInformation("Admin granted {Amount} to org {OrgId}", amount, organisationId);
            return (tx, null);
        }
        catch (DbUpdateException ex)
        {
            await dbTransaction.RollbackAsync();
            _logger.LogError(ex, "Database error during admin grant to org {OrgId}", organisationId);
            return (null, "Grant failed due to a database error. Please try again.");
        }
    }
}
