// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing sub-accounts (family members, dependents, managed accounts).
/// Primary users can create and manage sub-accounts with configurable permissions.
/// </summary>
public class SubAccountService
{
    private static readonly bool ChildApprovalWorkflowAvailable = false;
    private readonly NexusDbContext _db;
    private readonly ILogger<SubAccountService> _logger;
    private readonly PersonalWalletLedgerService _personalWallet;

    private static readonly HashSet<string> ValidRelationships = new(StringComparer.OrdinalIgnoreCase)
    {
        "family", "dependent", "minor", "managed"
    };

    private const int MaxSubAccountsPerUser = 10;

    public SubAccountService(
        NexusDbContext db,
        ILogger<SubAccountService> logger,
        PersonalWalletLedgerService personalWallet)
    {
        _db = db;
        _logger = logger;
        _personalWallet = personalWallet;
    }

    /// <summary>
    /// List sub-accounts for a primary user, including user details.
    /// </summary>
    public async Task<List<SubAccount>> GetSubAccountsAsync(int primaryUserId)
    {
        return await _db.Set<SubAccount>()
            .Include(s => s.SubUser)
            .Where(s => s.PrimaryUserId == primaryUserId && s.IsActive)
            .OrderBy(s => s.CreatedAt)
            .ToListAsync();
    }

    /// <summary>
    /// Get a single sub-account, verifying ownership.
    /// </summary>
    public async Task<(SubAccount? SubAccount, string? Error)> GetSubAccountAsync(int id, int primaryUserId)
    {
        var sub = await _db.Set<SubAccount>()
            .Include(s => s.SubUser)
            .FirstOrDefaultAsync(s => s.Id == id);

        if (sub == null)
            return (null, "Sub-account not found.");

        if (sub.PrimaryUserId != primaryUserId)
            return (null, "You do not own this sub-account.");

        return (sub, null);
    }

    /// <summary>
    /// Create a sub-account link. Validates relationship type,
    /// prevents circular references, and enforces max 10 sub-accounts.
    /// </summary>
    public async Task<(SubAccount? SubAccount, string? Error)> CreateSubAccountAsync(
        int tenantId, int primaryUserId, int subUserId, string relationship, string? displayName)
    {
        if (!ChildApprovalWorkflowAvailable)
        {
            return (null,
                "Sub-account linking is unavailable until the managed user can explicitly approve the relationship and permissions.");
        }

        if (primaryUserId == subUserId)
            return (null, "Cannot add yourself as a sub-account.");

        if (!ValidRelationships.Contains(relationship))
            return (null, "Invalid relationship. Must be one of: " + string.Join(", ", ValidRelationships));

        // Verify sub user exists
        var subUser = await _db.Users.FirstOrDefaultAsync(x => x.Id == subUserId);
        if (subUser == null)
            return (null, "Sub-account user not found.");

        // Prevent circular: check if sub user already has primary user as their sub-account
        var circular = await _db.Set<SubAccount>()
            .AnyAsync(s => s.PrimaryUserId == subUserId && s.SubUserId == primaryUserId && s.IsActive);
        if (circular)
            return (null, "Circular sub-account relationship not allowed.");

        // Check if already exists
        var existing = await _db.Set<SubAccount>()
            .AnyAsync(s => s.PrimaryUserId == primaryUserId && s.SubUserId == subUserId && s.IsActive);
        if (existing)
            return (null, "This user is already a sub-account.");

        // Enforce max sub-accounts
        var count = await _db.Set<SubAccount>()
            .CountAsync(s => s.PrimaryUserId == primaryUserId && s.IsActive);
        if (count >= MaxSubAccountsPerUser)
            return (null, $"Maximum of {MaxSubAccountsPerUser} sub-accounts reached.");

        var sub = new SubAccount
        {
            TenantId = tenantId,
            PrimaryUserId = primaryUserId,
            SubUserId = subUserId,
            Relationship = relationship.ToLowerInvariant(),
            DisplayName = displayName?.Trim(),
            CanTransact = true,
            CanMessage = true,
            CanJoinGroups = true,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<SubAccount>().Add(sub);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Sub-account created: User {SubUserId} linked to primary {PrimaryUserId} as {Relationship}",
            subUserId, primaryUserId, relationship);

        return (sub, null);
    }

    /// <summary>
    /// Update sub-account settings. Verifies ownership.
    /// </summary>
    public async Task<(SubAccount? SubAccount, string? Error)> UpdateSubAccountAsync(
        int id, int primaryUserId, string? displayName, bool? canTransact, bool? canMessage, bool? canJoinGroups)
    {
        var sub = await _db.Set<SubAccount>().FirstOrDefaultAsync(x => x.Id == id);

        if (sub == null)
            return (null, "Sub-account not found.");

        if (sub.PrimaryUserId != primaryUserId)
            return (null, "You do not own this sub-account.");

        if (!sub.IsActive)
            return (null, "Sub-account is no longer active.");

        if (displayName != null)
            sub.DisplayName = displayName.Trim();

        if (canTransact.HasValue)
            sub.CanTransact = canTransact.Value;

        if (canMessage.HasValue)
            sub.CanMessage = canMessage.Value;

        if (canJoinGroups.HasValue)
            sub.CanJoinGroups = canJoinGroups.Value;

        sub.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return (sub, null);
    }

    /// <summary>
    /// Soft-delete a sub-account by setting IsActive to false.
    /// </summary>
    public async Task<(bool Success, string? Error)> RemoveSubAccountAsync(int id, int primaryUserId)
    {
        var sub = await _db.Set<SubAccount>().FirstOrDefaultAsync(x => x.Id == id);

        if (sub == null)
            return (false, "Sub-account not found.");

        if (sub.PrimaryUserId != primaryUserId)
            return (false, "You do not own this sub-account.");

        sub.IsActive = false;
        sub.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Sub-account {Id} deactivated by user {PrimaryUserId}", id, primaryUserId);

        return (true, null);
    }

    /// <summary>
    /// Find who manages a given user (their primary account).
    /// </summary>
    public async Task<(SubAccount? SubAccount, string? Error)> GetPrimaryAccountAsync(int subUserId)
    {
        var sub = await _db.Set<SubAccount>()
            .Include(s => s.PrimaryUser)
            .FirstOrDefaultAsync(s => s.SubUserId == subUserId && s.IsActive);

        if (sub == null)
            return (null, "This user is not a managed sub-account.");

        return (sub, null);
    }

    /// <summary>
    /// Check if a user is a sub-account of someone.
    /// </summary>
    public async Task<bool> IsManagedAccountAsync(int userId)
    {
        return await _db.Set<SubAccount>()
            .AnyAsync(s => s.SubUserId == userId && s.IsActive);
    }

    /// <summary>
    /// Get the combined wallet balance for a primary user and all active sub-accounts.
    /// </summary>
    public async Task<(decimal PooledBalance, List<SubAccountBalanceItem> Breakdown, string? Error)> GetPooledBalanceAsync(int primaryUserId)
    {
        // Get all active sub-accounts for this primary user
        var subAccounts = await _db.Set<SubAccount>()
            .Include(s => s.SubUser)
            .Where(s => s.PrimaryUserId == primaryUserId && s.IsActive)
            .ToListAsync();

        var primaryUser = await _db.Users.FirstOrDefaultAsync(x => x.Id == primaryUserId);
        if (primaryUser == null)
            return (0m, new List<SubAccountBalanceItem>(), "Primary user not found.");

        // Collect all user IDs (primary + subs)
        var allUserIds = new List<int> { primaryUserId };
        allUserIds.AddRange(subAccounts.Select(s => s.SubUserId));

        // Compute balance for each user from transactions
        var breakdown = new List<SubAccountBalanceItem>();
        decimal pooledBalance = 0m;

        foreach (var userId in allUserIds)
        {
            var received = await _db.Transactions
                .Where(t => t.ReceiverId == userId && t.Status == TransactionStatus.Completed)
                .SumAsync(t => (decimal?)t.Amount) ?? 0m;

            var sent = await _db.Transactions
                .Where(t => t.SenderId == userId && t.Status == TransactionStatus.Completed)
                .SumAsync(t => (decimal?)t.Amount) ?? 0m;

            var balance = received - sent;
            pooledBalance += balance;

            if (userId == primaryUserId)
            {
                breakdown.Add(new SubAccountBalanceItem
                {
                    UserId = userId,
                    Name = $"{primaryUser.FirstName} {primaryUser.LastName}",
                    Relationship = "primary",
                    Balance = balance
                });
            }
            else
            {
                var sub = subAccounts.First(s => s.SubUserId == userId);
                var subUser = sub.SubUser;
                breakdown.Add(new SubAccountBalanceItem
                {
                    UserId = userId,
                    Name = sub.DisplayName ?? (subUser != null ? $"{subUser.FirstName} {subUser.LastName}" : $"User {userId}"),
                    Relationship = sub.Relationship,
                    Balance = balance
                });
            }
        }

        return (pooledBalance, breakdown, null);
    }

    /// <summary>
    /// Transfer credits between a primary account and a sub-account (or vice versa).
    /// Only primary account holder can initiate.
    /// </summary>
    public async Task<(bool Success, string? Error)> PoolTransferAsync(
        int tenantId, int primaryUserId, int fromUserId, int toUserId, decimal amount, string? description)
    {
        if (!ChildApprovalWorkflowAvailable)
        {
            return (false,
                "Pooled wallet transfers are unavailable until the managed user has explicitly approved transaction access.");
        }

        if (amount <= 0)
            return (false, "Transfer amount must be greater than zero.");

        if (fromUserId == toUserId)
            return (false, "Cannot transfer to the same account.");

        // Validate that primaryUserId owns both accounts
        var isPrimaryFrom = fromUserId == primaryUserId;
        var isPrimaryTo = toUserId == primaryUserId;

        if (!isPrimaryFrom && !isPrimaryTo)
            return (false, "One of the accounts must be the primary account.");

        // The non-primary account must be an active sub-account of the primary user
        var otherUserId = isPrimaryFrom ? toUserId : fromUserId;
        var subAccount = await _db.Set<SubAccount>()
            .FirstOrDefaultAsync(s => s.PrimaryUserId == primaryUserId && s.SubUserId == otherUserId && s.IsActive);

        if (subAccount == null)
            return (false, "The target account is not an active sub-account of this primary user.");

        // Enforce the CanTransact permission on the sub-account
        if (!subAccount.CanTransact)
            return (false, "This sub-account does not have permission to transfer credits.");

        // READ COMMITTED is safe here because every personal-wallet spender
        // takes the same transaction-scoped advisory lock before its balance read.
        await using var dbTransaction = await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted);
        try
        {
            // Lock on sender to serialize concurrent transfers from same user
            await _personalWallet.AcquireSpendLockAsync(fromUserId);

            // Check sender has sufficient balance (now protected by lock)
            var senderBalance = await _personalWallet.GetBalanceAsync(tenantId, fromUserId);
            if (senderBalance < amount)
            {
                await dbTransaction.RollbackAsync();
                return (false, $"Insufficient balance. Available: {senderBalance:F2}, requested: {amount:F2}.");
            }

            // Create the transaction
            var transaction = new Transaction
            {
                TenantId = tenantId,
                SenderId = fromUserId,
                ReceiverId = toUserId,
                Amount = amount,
                Description = description ?? "Family pool transfer",
                TransactionType = "sub_account_transfer",
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow
            };

            _db.Transactions.Add(transaction);
            await _db.SaveChangesAsync();
            await dbTransaction.CommitAsync();

            _logger.LogInformation(
                "Pool transfer: {Amount} credits from user {FromUserId} to user {ToUserId} (primary: {PrimaryUserId})",
                amount, fromUserId, toUserId, primaryUserId);

            return (true, null);
        }
        catch (DbUpdateException ex)
        {
            await dbTransaction.RollbackAsync();
            _logger.LogError(ex, "Database error during pool transfer from user {FromUserId} to user {ToUserId}", fromUserId, toUserId);
            return (false, "Transfer failed due to a database error. Please try again.");
        }
    }


    /// <summary>
    /// Get aggregated activity feed for a primary user and all their sub-accounts.
    /// Combines recent activity across the family/managed group.
    /// </summary>
    public async Task<(List<FamilyActivityItem> Activities, string? Error)> GetFamilyActivityFeedAsync(
        int primaryUserId, int page = 1, int limit = 20)
    {
        // Get all active sub-accounts for the primary user
        var subAccounts = await _db.Set<SubAccount>()
            .Include(s => s.SubUser)
            .Where(s => s.PrimaryUserId == primaryUserId && s.IsActive)
            .ToListAsync();

        var primaryUser = await _db.Users.FirstOrDefaultAsync(x => x.Id == primaryUserId);
        if (primaryUser == null)
            return (new List<FamilyActivityItem>(), "Primary user not found.");

        // Collect all user IDs (primary + subs)
        var allUserIds = new List<int> { primaryUserId };
        allUserIds.AddRange(subAccounts.Select(s => s.SubUserId));

        // Build a map of userId -> (name, relationship)
        var userInfo = new Dictionary<int, (string Name, string Relationship)>
        {
            [primaryUserId] = ($"{primaryUser.FirstName} {primaryUser.LastName}", "primary")
        };
        foreach (var sub in subAccounts)
        {
            var subUser = sub.SubUser;
            var name = sub.DisplayName ?? (subUser != null ? $"{subUser.FirstName} {subUser.LastName}" : $"User {sub.SubUserId}");
            userInfo[sub.SubUserId] = (name, sub.Relationship);
        }

        var activities = new List<FamilyActivityItem>();

        // Query transactions
        var transactions = await _db.Transactions
            .Where(t => ((t.SenderId.HasValue && allUserIds.Contains(t.SenderId.Value))
                    || (t.ReceiverId.HasValue && allUserIds.Contains(t.ReceiverId.Value)))
                && t.Status == TransactionStatus.Completed)
            .OrderByDescending(t => t.CreatedAt)
            .Take(limit * 3)
            .ToListAsync();

        foreach (var t in transactions)
        {
            var userId = t.SenderId.HasValue && allUserIds.Contains(t.SenderId.Value)
                ? t.SenderId.Value
                : t.ReceiverId!.Value;
            var (name, relationship) = userInfo.GetValueOrDefault(userId, ($"User {userId}", "unknown"));
            activities.Add(new FamilyActivityItem
            {
                ActivityType = "transaction",
                UserId = userId,
                UserName = name,
                Relationship = relationship,
                Description = t.Description ?? "Credit transfer",
                Amount = t.Amount,
                CreatedAt = t.CreatedAt
            });
        }

        // Query feed posts
        var posts = await _db.Set<FeedPost>()
            .Where(p => allUserIds.Contains(p.UserId))
            .OrderByDescending(p => p.CreatedAt)
            .Take(limit * 3)
            .ToListAsync();

        foreach (var p in posts)
        {
            var (name, relationship) = userInfo.GetValueOrDefault(p.UserId, ($"User {p.UserId}", "unknown"));
            var preview = p.Content.Length > 100 ? p.Content.Substring(0, 100) + "..." : p.Content;
            activities.Add(new FamilyActivityItem
            {
                ActivityType = "post",
                UserId = p.UserId,
                UserName = name,
                Relationship = relationship,
                Description = preview,
                Amount = null,
                CreatedAt = p.CreatedAt
            });
        }

        // Query exchanges
        var exchanges = await _db.Exchanges
            .Where(e => allUserIds.Contains(e.InitiatorId) || allUserIds.Contains(e.ListingOwnerId))
            .OrderByDescending(e => e.CreatedAt)
            .Take(limit * 3)
            .ToListAsync();

        foreach (var e in exchanges)
        {
            var userId = allUserIds.Contains(e.InitiatorId) ? e.InitiatorId : e.ListingOwnerId;
            var (name, relationship) = userInfo.GetValueOrDefault(userId, ($"User {userId}", "unknown"));
            activities.Add(new FamilyActivityItem
            {
                ActivityType = "exchange",
                UserId = userId,
                UserName = name,
                Relationship = relationship,
                Description = e.RequestMessage ?? $"Exchange #{e.Id} ({e.Status})",
                Amount = e.AgreedHours,
                CreatedAt = e.CreatedAt
            });
        }

        // Sort all activities by date descending and paginate
        var skip = (page - 1) * limit;
        var result = activities
            .OrderByDescending(a => a.CreatedAt)
            .Skip(skip)
            .Take(limit)
            .ToList();

        return (result, null);
    }
}

public class SubAccountBalanceItem
{
    public int UserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Relationship { get; set; } = string.Empty;
    public decimal Balance { get; set; }
}

public class FamilyActivityItem
{
    public string ActivityType { get; set; } = string.Empty;
    public int UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
    public string Relationship { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public decimal? Amount { get; set; }
    public DateTime CreatedAt { get; set; }
}
