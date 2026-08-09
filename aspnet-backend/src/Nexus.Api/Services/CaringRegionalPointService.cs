// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class CaringRegionalPointService
{
    public const string KeyPrefix = "caring_community.regional_points.";
    private const decimal MaxPointsPerRedemption = 100000m;

    private static readonly RegionalPointConfig Defaults = new(
        Enabled: false,
        Label: "Regional Points",
        Symbol: "pts",
        AutoIssueEnabled: false,
        PointsPerApprovedHour: 0m,
        MemberTransfersEnabled: false,
        MarketplaceRedemptionEnabled: false);

    private readonly NexusDbContext _db;

    public CaringRegionalPointService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<bool> IsCaringCommunityEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == "features.caring_community")
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public async Task<RegionalPointConfig> GetConfigAsync(int tenantId, CancellationToken ct)
    {
        var rows = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config => config.TenantId == tenantId && config.Key.StartsWith(KeyPrefix))
            .ToDictionaryAsync(
                config => config.Key[KeyPrefix.Length..],
                config => config.Value,
                StringComparer.Ordinal,
                ct);

        return Normalize(new RegionalPointConfig(
            Enabled: ParseBoolOrDefault(rows.GetValueOrDefault("enabled"), Defaults.Enabled),
            Label: rows.GetValueOrDefault("label") ?? Defaults.Label,
            Symbol: rows.GetValueOrDefault("symbol") ?? Defaults.Symbol,
            AutoIssueEnabled: ParseBoolOrDefault(rows.GetValueOrDefault("auto_issue_enabled"), Defaults.AutoIssueEnabled),
            PointsPerApprovedHour: ParseDecimalOrDefault(rows.GetValueOrDefault("points_per_approved_hour"), Defaults.PointsPerApprovedHour),
            MemberTransfersEnabled: ParseBoolOrDefault(rows.GetValueOrDefault("member_transfers_enabled"), Defaults.MemberTransfersEnabled),
            MarketplaceRedemptionEnabled: ParseBoolOrDefault(rows.GetValueOrDefault("marketplace_redemption_enabled"), Defaults.MarketplaceRedemptionEnabled)));
    }

    public async Task<RegionalPointConfig> UpdateConfigAsync(
        int tenantId,
        JsonElement payload,
        CancellationToken ct)
    {
        var current = await GetConfigAsync(tenantId, ct);
        var draft = current;

        if (payload.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in payload.EnumerateObject())
            {
                draft = Apply(draft, property.Name, property.Value);
            }
        }

        var normalized = Normalize(draft);
        var now = DateTime.UtcNow;
        foreach (var (key, value) in Serialize(normalized))
        {
            await UpsertSettingAsync(tenantId, KeyPrefix + key, value, now, ct);
        }

        return await GetConfigAsync(tenantId, ct);
    }

    public async Task<bool> IsRegionalPointsEnabledAsync(int tenantId, CancellationToken ct)
    {
        return await IsCaringCommunityEnabledAsync(tenantId, ct)
            && (await GetConfigAsync(tenantId, ct)).Enabled;
    }

    public async Task<RegionalPointLedgerResult> TenantLedgerAsync(
        int tenantId,
        int? limit,
        CancellationToken ct)
    {
        await AssertRegionalPointsEnabledAsync(tenantId, ct);
        var take = Math.Clamp(limit ?? 100, 1, 500);

        var accounts = _db.CaringRegionalPointAccounts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(account => account.TenantId == tenantId);
        var transactions = _db.CaringRegionalPointTransactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(transaction => transaction.TenantId == tenantId);

        var stats = new RegionalPointStats(
            AccountsCount: await accounts.CountAsync(ct),
            CirculatingPoints: RoundPoints(await accounts.Select(account => (decimal?)account.Balance).SumAsync(ct) ?? 0m),
            TotalIssued: RoundPoints(await transactions
                .Where(transaction => transaction.Direction == "credit")
                .Select(transaction => (decimal?)transaction.Points)
                .SumAsync(ct) ?? 0m),
            TotalSpent: RoundPoints(await transactions
                .Where(transaction => transaction.Direction == "debit")
                .Select(transaction => (decimal?)transaction.Points)
                .SumAsync(ct) ?? 0m));

        var rows = await transactions
            .OrderByDescending(transaction => transaction.CreatedAt)
            .ThenByDescending(transaction => transaction.Id)
            .Take(take)
            .ToListAsync(ct);

        var userIds = rows
            .Select(row => row.UserId)
            .Concat(rows.Where(row => row.ActorUserId.HasValue).Select(row => row.ActorUserId!.Value))
            .Distinct()
            .ToArray();
        var users = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.TenantId == tenantId && userIds.Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, ct);

        return new RegionalPointLedgerResult(
            stats,
            rows.Select(row => FormatTransaction(
                row,
                users.GetValueOrDefault(row.UserId),
                row.ActorUserId.HasValue ? users.GetValueOrDefault(row.ActorUserId.Value) : null)).ToArray());
    }

    public Task<RegionalPointMutationResult> IssueAsync(
        int tenantId,
        int userId,
        decimal points,
        string description,
        int actorId,
        CancellationToken ct)
    {
        return CreditAsync(tenantId, userId, points, "admin_issue", description, actorId, ct);
    }

    public async Task<RegionalPointMutationResult> AdjustAsync(
        int tenantId,
        int userId,
        decimal pointsDelta,
        string description,
        int actorId,
        CancellationToken ct)
    {
        if (pointsDelta == 0m)
        {
            throw new RegionalPointValidationException("Point adjustment must not be zero.");
        }

        return pointsDelta > 0m
            ? await CreditAsync(tenantId, userId, pointsDelta, "admin_adjustment", description, actorId, ct)
            : await DebitAsync(tenantId, userId, Math.Abs(pointsDelta), "admin_adjustment", description, actorId, ct);
    }

    /// <summary>
    /// Awards the tenant-configured regional points for one approved volunteer-hours log.
    /// The volunteer-log reference is the idempotency key, matching Laravel's
    /// <c>CaringRegionalPointService::awardForApprovedHours</c> contract.
    /// </summary>
    public async Task<RegionalPointHoursAwardResult?> AwardForApprovedHoursAsync(
        int tenantId,
        int userId,
        int volLogId,
        decimal hours,
        int? actorId,
        CancellationToken ct = default)
    {
        var config = await GetConfigAsync(tenantId, ct);
        if (!await IsRegionalPointsEnabledAsync(tenantId, ct)
            || !config.AutoIssueEnabled
            || config.PointsPerApprovedHour <= 0m
            || hours <= 0m
            || volLogId <= 0)
        {
            return null;
        }

        var points = NormalizePoints(RoundPoints(hours * config.PointsPerApprovedHour));
        await AssertTenantUserAsync(tenantId, userId, ct);

        await using var ownedTransaction = await BeginOwnedRelationalTransactionAsync(ct);

        await AcquireApprovedHoursReferenceLockAsync(tenantId, volLogId, ct);
        var existing = await LockApprovedHoursAwardAsync(tenantId, volLogId, ct);
        if (existing is not null)
        {
            if (ownedTransaction is not null)
            {
                await ownedTransaction.CommitAsync(ct);
            }

            return new RegionalPointHoursAwardResult(
                TransactionId: existing.Id,
                UserId: userId,
                Points: RoundPoints(existing.Points),
                Balance: RoundPoints(existing.BalanceAfter),
                AlreadyAwarded: true);
        }

        var account = await LockAccountAsync(tenantId, userId, ct);
        var roundedHours = RoundPoints(hours);
        var now = DateTime.UtcNow;
        var newBalance = RoundPoints(account.Balance + points);

        account.Balance = newBalance;
        account.LifetimeEarned = RoundPoints(account.LifetimeEarned + points);
        account.UpdatedAt = now;

        var transaction = new CaringRegionalPointTransaction
        {
            TenantId = tenantId,
            AccountId = account.Id,
            UserId = userId,
            ActorUserId = actorId is > 0 ? actorId : null,
            Type = "earned_for_hours",
            Direction = "credit",
            Points = points,
            BalanceAfter = newBalance,
            ReferenceType = "vol_log",
            ReferenceId = volLogId,
            Description = $"Regional points earned for {roundedHours.ToString("0.##", CultureInfo.InvariantCulture)} approved support hours.",
            Metadata = JsonSerializer.Serialize(new { hours = roundedHours }),
            CreatedAt = now
        };

        _db.CaringRegionalPointTransactions.Add(transaction);
        await _db.SaveChangesAsync(ct);
        if (ownedTransaction is not null)
        {
            await ownedTransaction.CommitAsync(ct);
        }

        return new RegionalPointHoursAwardResult(
            TransactionId: transaction.Id,
            UserId: userId,
            Points: points,
            Balance: newBalance,
            AlreadyAwarded: false);
    }

    /// <summary>
    /// Reverses every unreversed regional-point award for a volunteer log.
    /// Reversal is intentionally allowed to take the account negative because
    /// the member may already have spent the awarded points. The original
    /// credit remains as immutable audit evidence and repeated calls are no-ops.
    /// </summary>
    public async Task<bool> ReverseFromVolLogAsync(
        int tenantId,
        int volLogId,
        string reason,
        CancellationToken ct = default)
    {
        if (tenantId <= 0 || volLogId <= 0)
        {
            return false;
        }

        await using var ownedTransaction = await BeginOwnedRelationalTransactionAsync(ct);
        await AcquireApprovedHoursReferenceLockAsync(tenantId, volLogId, ct);

        var originalIssues = await LockApprovedHoursAwardsAsync(tenantId, volLogId, ct);
        if (originalIssues.Count == 0)
        {
            if (ownedTransaction is not null)
            {
                await ownedTransaction.CommitAsync(ct);
            }

            return false;
        }

        var reversalRows = await LockApprovedHoursReversalsAsync(tenantId, volLogId, ct);
        var reversedIssueIds = reversalRows
            .Select(row => ReadOriginalTransactionId(row.Metadata))
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .ToHashSet();
        var issuesToReverse = originalIssues
            .Where(issue => !reversedIssueIds.Contains(issue.Id)
                && issue.UserId > 0
                && RoundPoints(issue.Points) > 0m)
            .OrderBy(issue => issue.Id)
            .ToArray();

        if (issuesToReverse.Length == 0)
        {
            if (ownedTransaction is not null)
            {
                await ownedTransaction.CommitAsync(ct);
            }

            return false;
        }

        var accounts = new Dictionary<int, CaringRegionalPointAccount>();
        foreach (var userId in issuesToReverse.Select(issue => issue.UserId).Distinct().OrderBy(id => id))
        {
            accounts[userId] = await LockAccountAsync(tenantId, userId, ct);
        }

        var now = DateTime.UtcNow;
        var normalizedReason = NormalizeDescription(reason) ?? string.Empty;
        var description = NormalizeDescription($"Regional points reversed: {reason?.Trim()}");
        var createdAny = false;

        foreach (var issue in issuesToReverse)
        {
            if (!accounts.TryGetValue(issue.UserId, out var account))
            {
                continue;
            }

            var points = RoundPoints(issue.Points);
            var newBalance = RoundPoints(account.Balance - points);
            account.Balance = newBalance;
            account.LifetimeEarned = Math.Max(0m, RoundPoints(account.LifetimeEarned - points));
            account.UpdatedAt = now;

            _db.CaringRegionalPointTransactions.Add(new CaringRegionalPointTransaction
            {
                TenantId = tenantId,
                AccountId = account.Id,
                UserId = issue.UserId,
                ActorUserId = null,
                Type = "reversal",
                Direction = "debit",
                Points = points,
                BalanceAfter = newBalance,
                ReferenceType = "vol_log_reversal",
                ReferenceId = volLogId,
                Description = description,
                Metadata = JsonSerializer.Serialize(new
                {
                    original_transaction_id = issue.Id,
                    reason = normalizedReason
                }),
                CreatedAt = now
            });
            createdAny = true;
        }

        if (createdAny)
        {
            await _db.SaveChangesAsync(ct);
        }

        if (ownedTransaction is not null)
        {
            await ownedTransaction.CommitAsync(ct);
        }

        return createdAny;
    }

    public async Task<RegionalPointMemberSummary> MemberSummaryAsync(
        int tenantId,
        int userId,
        CancellationToken ct)
    {
        await AssertRegionalPointsEnabledAsync(tenantId, ct);
        var account = await EnsureAccountAsync(tenantId, userId, ct);

        return new RegionalPointMemberSummary(
            Enabled: true,
            Config: PublicConfig(await GetConfigAsync(tenantId, ct)),
            Account: new RegionalPointMemberAccount(
                UserId: userId,
                Balance: RoundPoints(account.Balance),
                LifetimeEarned: RoundPoints(account.LifetimeEarned),
                LifetimeSpent: RoundPoints(account.LifetimeSpent)));
    }

    public async Task<IReadOnlyList<RegionalPointMemberTransactionDto>> MemberHistoryAsync(
        int tenantId,
        int userId,
        int? limit,
        CancellationToken ct)
    {
        await AssertRegionalPointsEnabledAsync(tenantId, ct);
        var take = Math.Clamp(limit ?? 50, 1, 200);
        await EnsureAccountAsync(tenantId, userId, ct);

        var rows = await _db.CaringRegionalPointTransactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(transaction => transaction.TenantId == tenantId && transaction.UserId == userId)
            .OrderByDescending(transaction => transaction.CreatedAt)
            .ThenByDescending(transaction => transaction.Id)
            .Take(take)
            .ToListAsync(ct);

        return rows.Select(FormatMemberTransaction).ToArray();
    }

    public async Task<RegionalPointTransferResult> TransferBetweenMembersAsync(
        int tenantId,
        int senderId,
        int recipientId,
        decimal points,
        string? message,
        CancellationToken ct)
    {
        var config = await GetConfigAsync(tenantId, ct);
        await AssertRegionalPointsEnabledAsync(tenantId, ct);

        if (!config.MemberTransfersEnabled)
        {
            throw new RegionalPointOperationException("Regional point member transfers are disabled.");
        }

        if (senderId == recipientId)
        {
            throw new RegionalPointValidationException("Members cannot transfer regional points to themselves.");
        }

        points = NormalizePoints(points);
        await AssertTenantUserAsync(tenantId, senderId, ct);
        await AssertTenantUserAsync(tenantId, recipientId, ct);

        await using var ownedTransaction = await BeginOwnedRelationalTransactionAsync(ct);
        var lockedAccounts = new Dictionary<int, CaringRegionalPointAccount>();
        foreach (var userId in new[] { senderId, recipientId }.OrderBy(id => id))
        {
            lockedAccounts[userId] = await LockAccountAsync(tenantId, userId, ct);
        }

        var senderAccount = lockedAccounts[senderId];
        var recipientAccount = lockedAccounts[recipientId];
        if (senderAccount.Balance < points)
        {
            throw new RegionalPointOperationException("Not enough regional points.");
        }

        var now = DateTime.UtcNow;
        var senderNewBalance = RoundPoints(senderAccount.Balance - points);
        var recipientNewBalance = RoundPoints(recipientAccount.Balance + points);
        var description = NormalizeDescription(message) ?? "Regional point member transfer";

        senderAccount.Balance = senderNewBalance;
        senderAccount.LifetimeSpent = RoundPoints(senderAccount.LifetimeSpent + points);
        senderAccount.UpdatedAt = now;
        recipientAccount.Balance = recipientNewBalance;
        recipientAccount.LifetimeEarned = RoundPoints(recipientAccount.LifetimeEarned + points);
        recipientAccount.UpdatedAt = now;

        var debit = new CaringRegionalPointTransaction
        {
            TenantId = tenantId,
            AccountId = senderAccount.Id,
            UserId = senderId,
            ActorUserId = senderId,
            Type = "transfer_out",
            Direction = "debit",
            Points = points,
            BalanceAfter = senderNewBalance,
            Description = description,
            Metadata = JsonSerializer.Serialize(new { recipient_user_id = recipientId }),
            CreatedAt = now
        };
        var credit = new CaringRegionalPointTransaction
        {
            TenantId = tenantId,
            AccountId = recipientAccount.Id,
            UserId = recipientId,
            ActorUserId = senderId,
            Type = "transfer_in",
            Direction = "credit",
            Points = points,
            BalanceAfter = recipientNewBalance,
            Description = description,
            ReferenceType = "regional_point_transfer",
            Metadata = JsonSerializer.Serialize(new { sender_user_id = senderId }),
            CreatedAt = now
        };

        _db.CaringRegionalPointTransactions.AddRange(debit, credit);
        await _db.SaveChangesAsync(ct);

        debit.ReferenceType = "regional_point_transfer";
        debit.ReferenceId = credit.Id;
        credit.ReferenceId = debit.Id;
        await _db.SaveChangesAsync(ct);
        if (ownedTransaction is not null)
        {
            await ownedTransaction.CommitAsync(ct);
        }

        return new RegionalPointTransferResult(
            SenderTransactionId: debit.Id,
            RecipientTransactionId: credit.Id,
            SenderUserId: senderId,
            RecipientUserId: recipientId,
            Points: points,
            SenderBalance: senderNewBalance,
            RecipientBalance: recipientNewBalance);
    }

    public async Task<RegionalPointMarketplaceQuote> CalculateMarketplaceDiscountAsync(
        int tenantId,
        int memberId,
        int sellerId,
        int? listingId,
        decimal orderTotalChf,
        CancellationToken ct)
    {
        var config = await GetConfigAsync(tenantId, ct);
        if (!await IsCaringCommunityEnabledAsync(tenantId, ct)
            || !config.Enabled
            || !config.MarketplaceRedemptionEnabled)
        {
            return DisabledQuote("feature_disabled");
        }

        if (orderTotalChf <= 0m)
        {
            return DisabledQuote("invalid_order_total");
        }

        if (!await TenantUserExistsAsync(tenantId, memberId, ct)
            || !await TenantUserExistsAsync(tenantId, sellerId, ct))
        {
            return DisabledQuote("member_or_seller_unavailable");
        }

        if (listingId.HasValue
            && !await MarketplaceListingBelongsToSellerAsync(tenantId, listingId.Value, sellerId, ct))
        {
            return DisabledQuote("listing_unavailable");
        }

        var settings = await _db.MarketplaceSellerRegionalPointSettings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(setting => setting.TenantId == tenantId && setting.SellerUserId == sellerId, ct);
        if (settings is null || !settings.AcceptsRegionalPoints)
        {
            return DisabledQuote("merchant_disabled");
        }

        var pointsPerChf = RoundPoints(settings.RegionalPointsPerChf);
        var maxDiscountPct = settings.RegionalPointsMaxDiscountPct;
        if (pointsPerChf <= 0m || maxDiscountPct <= 0)
        {
            return DisabledQuote("merchant_misconfigured");
        }

        var account = await EnsureAccountAsync(tenantId, memberId, ct);
        var memberPoints = RoundPoints(account.Balance);
        var maxDiscountChf = RoundPoints(orderTotalChf * maxDiscountPct / 100m);
        var maxPointsByPolicy = RoundPoints(maxDiscountChf * pointsPerChf);
        var maxPointsUsable = Math.Max(
            0m,
            RoundPoints(Math.Min(memberPoints, Math.Min(maxPointsByPolicy, MaxPointsPerRedemption))));
        var effectiveDiscountChf = RoundPoints(maxPointsUsable / pointsPerChf);

        return new RegionalPointMarketplaceQuote(
            Accepts: true,
            MemberPoints: memberPoints,
            RegionalPointsPerChf: pointsPerChf,
            MaxDiscountPct: maxDiscountPct,
            MaxPointsUsable: maxPointsUsable,
            MaxDiscountChf: effectiveDiscountChf,
            Reason: null);
    }

    public async Task<RegionalPointMarketplaceRedemptionResult> RedeemForMarketplaceDiscountAsync(
        int tenantId,
        int memberId,
        int sellerId,
        int? listingId,
        decimal pointsToUse,
        decimal orderTotalChf,
        CancellationToken ct)
    {
        var config = await GetConfigAsync(tenantId, ct);
        await AssertRegionalPointsEnabledAsync(tenantId, ct);

        if (!config.MarketplaceRedemptionEnabled)
        {
            throw new RegionalPointOperationException("Regional point marketplace redemption is disabled.");
        }

        if (memberId == sellerId)
        {
            throw new RegionalPointOperationException("Members cannot redeem regional points with themselves.");
        }

        if (orderTotalChf <= 0m)
        {
            throw new RegionalPointValidationException("Order total must be greater than zero.");
        }

        pointsToUse = NormalizePoints(pointsToUse);
        if (pointsToUse > MaxPointsPerRedemption)
        {
            throw new RegionalPointValidationException("Regional point redemption amount exceeds the maximum allowed value.");
        }

        await AssertTenantUserAsync(tenantId, memberId, ct);
        await AssertTenantUserAsync(tenantId, sellerId, ct);

        if (listingId.HasValue
            && !await MarketplaceListingBelongsToSellerAsync(tenantId, listingId.Value, sellerId, ct))
        {
            throw new RegionalPointOperationException("Marketplace listing is unavailable for regional point redemption.");
        }

        var settings = await _db.MarketplaceSellerRegionalPointSettings
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(setting => setting.TenantId == tenantId && setting.SellerUserId == sellerId, ct);
        if (settings is null || !settings.AcceptsRegionalPoints)
        {
            throw new RegionalPointOperationException("Merchant does not accept regional points.");
        }

        var pointsPerChf = RoundPoints(settings.RegionalPointsPerChf);
        var maxDiscountPct = settings.RegionalPointsMaxDiscountPct;
        if (pointsPerChf <= 0m || maxDiscountPct <= 0)
        {
            throw new RegionalPointOperationException("Merchant regional point settings are invalid.");
        }

        var discountChf = RoundPoints(pointsToUse / pointsPerChf);
        var maxDiscountChf = RoundPoints(orderTotalChf * maxDiscountPct / 100m);
        if (discountChf > maxDiscountChf + 0.005m)
        {
            throw new RegionalPointOperationException("Regional point discount exceeds merchant policy.");
        }

        var account = await EnsureAccountAsync(tenantId, memberId, ct);
        if (account.Balance < pointsToUse)
        {
            throw new RegionalPointOperationException("Not enough regional points.");
        }

        var now = DateTime.UtcNow;
        var newBalance = RoundPoints(account.Balance - pointsToUse);
        account.Balance = newBalance;
        account.LifetimeSpent = RoundPoints(account.LifetimeSpent + pointsToUse);
        account.UpdatedAt = now;

        var transaction = new CaringRegionalPointTransaction
        {
            TenantId = tenantId,
            AccountId = account.Id,
            UserId = memberId,
            ActorUserId = memberId,
            Type = "redemption",
            Direction = "debit",
            Points = pointsToUse,
            BalanceAfter = newBalance,
            Description = "Marketplace regional point redemption",
            ReferenceType = listingId.HasValue ? "marketplace_listing" : "marketplace_seller",
            ReferenceId = listingId ?? sellerId,
            Metadata = JsonSerializer.Serialize(new
            {
                seller_user_id = sellerId,
                marketplace_listing_id = listingId,
                order_total_chf = RoundPoints(orderTotalChf),
                discount_chf = discountChf,
                regional_points_per_chf = pointsPerChf,
                max_discount_pct = maxDiscountPct
            }),
            CreatedAt = now
        };
        _db.CaringRegionalPointTransactions.Add(transaction);
        await _db.SaveChangesAsync(ct);

        return new RegionalPointMarketplaceRedemptionResult(
            TransactionId: transaction.Id,
            SellerUserId: sellerId,
            MarketplaceListingId: listingId,
            PointsUsed: pointsToUse,
            DiscountChf: discountChf,
            NewRegionalPointBalance: newBalance);
    }

    public async Task<RegionalPointSellerSettings> GetMarketplaceSellerSettingsAsync(
        int tenantId,
        int sellerId,
        CancellationToken ct)
    {
        await AssertRegionalPointsEnabledAsync(tenantId, ct);

        var row = await _db.MarketplaceSellerRegionalPointSettings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(setting => setting.TenantId == tenantId && setting.SellerUserId == sellerId, ct);

        return row is null
            ? RegionalPointSellerSettings.Default(sellerId)
            : new RegionalPointSellerSettings(
                SellerUserId: row.SellerUserId,
                AcceptsRegionalPoints: row.AcceptsRegionalPoints,
                RegionalPointsPerChf: RoundPoints(row.RegionalPointsPerChf),
                RegionalPointsMaxDiscountPct: row.RegionalPointsMaxDiscountPct);
    }

    public async Task<RegionalPointSellerSettings> UpdateMarketplaceSellerSettingsAsync(
        int tenantId,
        int sellerId,
        bool acceptsRegionalPoints,
        decimal pointsPerChf,
        int maxDiscountPct,
        CancellationToken ct)
    {
        await AssertRegionalPointsEnabledAsync(tenantId, ct);
        await AssertTenantUserAsync(tenantId, sellerId, ct);

        pointsPerChf = RoundPoints(pointsPerChf);
        if (pointsPerChf <= 0m || pointsPerChf > 100000m)
        {
            throw new RegionalPointValidationException("Regional points per CHF must be greater than zero.");
        }

        if (maxDiscountPct < 1 || maxDiscountPct > 100)
        {
            throw new RegionalPointValidationException("Regional point maximum discount must be between 1 and 100 percent.");
        }

        var now = DateTime.UtcNow;
        var row = await _db.MarketplaceSellerRegionalPointSettings
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(setting => setting.TenantId == tenantId && setting.SellerUserId == sellerId, ct);

        if (row is null)
        {
            row = new MarketplaceSellerRegionalPointSetting
            {
                TenantId = tenantId,
                SellerUserId = sellerId,
                CreatedAt = now
            };
            _db.MarketplaceSellerRegionalPointSettings.Add(row);
        }

        row.AcceptsRegionalPoints = acceptsRegionalPoints;
        row.RegionalPointsPerChf = pointsPerChf;
        row.RegionalPointsMaxDiscountPct = maxDiscountPct;
        row.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);

        return await GetMarketplaceSellerSettingsAsync(tenantId, sellerId, ct);
    }

    private static RegionalPointConfig Apply(RegionalPointConfig config, string key, JsonElement value)
    {
        return key switch
        {
            "enabled" => config with { Enabled = ReadBool(value, config.Enabled) },
            "label" => config with { Label = ReadString(value, config.Label) },
            "symbol" => config with { Symbol = ReadString(value, config.Symbol) },
            "auto_issue_enabled" => config with { AutoIssueEnabled = ReadBool(value, config.AutoIssueEnabled) },
            "points_per_approved_hour" => config with { PointsPerApprovedHour = ReadDecimal(value, config.PointsPerApprovedHour) },
            "member_transfers_enabled" => config with { MemberTransfersEnabled = ReadBool(value, config.MemberTransfersEnabled) },
            "marketplace_redemption_enabled" => config with { MarketplaceRedemptionEnabled = ReadBool(value, config.MarketplaceRedemptionEnabled) },
            _ => config
        };
    }

    private async Task<RegionalPointMutationResult> CreditAsync(
        int tenantId,
        int userId,
        decimal points,
        string type,
        string description,
        int actorId,
        CancellationToken ct)
    {
        await AssertRegionalPointsEnabledAsync(tenantId, ct);
        points = NormalizePoints(points);
        await AssertTenantUserAsync(tenantId, userId, ct);
        await using var ownedTransaction = await BeginOwnedRelationalTransactionAsync(ct);
        var account = await LockAccountAsync(tenantId, userId, ct);
        var now = DateTime.UtcNow;
        var newBalance = RoundPoints(account.Balance + points);

        account.Balance = newBalance;
        account.LifetimeEarned = RoundPoints(account.LifetimeEarned + points);
        account.UpdatedAt = now;
        var transaction = new CaringRegionalPointTransaction
        {
            TenantId = tenantId,
            AccountId = account.Id,
            UserId = userId,
            ActorUserId = actorId > 0 ? actorId : null,
            Type = type,
            Direction = "credit",
            Points = points,
            BalanceAfter = newBalance,
            Description = NormalizeDescription(description),
            CreatedAt = now
        };
        _db.CaringRegionalPointTransactions.Add(transaction);
        await _db.SaveChangesAsync(ct);
        if (ownedTransaction is not null)
        {
            await ownedTransaction.CommitAsync(ct);
        }

        return new RegionalPointMutationResult(transaction.Id, userId, points, newBalance);
    }

    private async Task<RegionalPointMutationResult> DebitAsync(
        int tenantId,
        int userId,
        decimal points,
        string type,
        string description,
        int actorId,
        CancellationToken ct)
    {
        await AssertRegionalPointsEnabledAsync(tenantId, ct);
        points = NormalizePoints(points);
        await AssertTenantUserAsync(tenantId, userId, ct);
        await using var ownedTransaction = await BeginOwnedRelationalTransactionAsync(ct);
        var account = await LockAccountAsync(tenantId, userId, ct);
        if (account.Balance < points)
        {
            throw new RegionalPointOperationException("Not enough regional points.");
        }

        var now = DateTime.UtcNow;
        var newBalance = RoundPoints(account.Balance - points);
        account.Balance = newBalance;
        account.LifetimeSpent = RoundPoints(account.LifetimeSpent + points);
        account.UpdatedAt = now;
        var transaction = new CaringRegionalPointTransaction
        {
            TenantId = tenantId,
            AccountId = account.Id,
            UserId = userId,
            ActorUserId = actorId > 0 ? actorId : null,
            Type = type,
            Direction = "debit",
            Points = points,
            BalanceAfter = newBalance,
            Description = NormalizeDescription(description),
            CreatedAt = now
        };
        _db.CaringRegionalPointTransactions.Add(transaction);
        await _db.SaveChangesAsync(ct);
        if (ownedTransaction is not null)
        {
            await ownedTransaction.CommitAsync(ct);
        }

        return new RegionalPointMutationResult(transaction.Id, userId, -points, newBalance);
    }

    private async Task<CaringRegionalPointAccount> EnsureAccountAsync(
        int tenantId,
        int userId,
        CancellationToken ct)
    {
        var account = await _db.CaringRegionalPointAccounts
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.UserId == userId, ct);

        if (account is not null)
        {
            return account;
        }

        account = new CaringRegionalPointAccount
        {
            TenantId = tenantId,
            UserId = userId,
            Balance = 0m,
            LifetimeEarned = 0m,
            LifetimeSpent = 0m,
            CreatedAt = DateTime.UtcNow
        };
        _db.CaringRegionalPointAccounts.Add(account);
        await _db.SaveChangesAsync(ct);

        return account;
    }

    private async Task<CaringRegionalPointAccount> LockAccountAsync(
        int tenantId,
        int userId,
        CancellationToken ct)
    {
        await AcquireRegionalPointAccountLockAsync(tenantId, userId, ct);
        var account = await EnsureAccountAsync(tenantId, userId, ct);
        if (!UsesPostgreSql())
        {
            return account;
        }

        // Laravel's lockAccount helper takes a row lock after ensuring that the
        // unique tenant/user account exists. The advisory lock also serializes
        // the first-account insert, for which no row exists to lock yet.
        await _db.CaringRegionalPointAccounts
            .FromSqlInterpolated(
                $"SELECT * FROM caring_regional_point_accounts WHERE tenant_id = {tenantId} AND user_id = {userId} FOR UPDATE")
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleAsync(ct);
        await _db.Entry(account).ReloadAsync(ct);
        return account;
    }

    private async Task<CaringRegionalPointTransaction?> LockApprovedHoursAwardAsync(
        int tenantId,
        int volLogId,
        CancellationToken ct)
    {
        if (!UsesPostgreSql())
        {
            return await _db.CaringRegionalPointTransactions
                .IgnoreQueryFilters()
                .AsNoTracking()
                .FirstOrDefaultAsync(transaction => transaction.TenantId == tenantId
                    && transaction.ReferenceType == "vol_log"
                    && transaction.ReferenceId == volLogId
                    && transaction.Type == "earned_for_hours", ct);
        }

        return await _db.CaringRegionalPointTransactions
            .FromSqlInterpolated(
                $"SELECT * FROM caring_regional_point_transactions WHERE tenant_id = {tenantId} AND reference_type = 'vol_log' AND reference_id = {volLogId} AND type = 'earned_for_hours' FOR UPDATE")
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(ct);
    }

    private async Task<IReadOnlyList<CaringRegionalPointTransaction>> LockApprovedHoursAwardsAsync(
        int tenantId,
        int volLogId,
        CancellationToken ct)
    {
        if (!UsesPostgreSql())
        {
            return await _db.CaringRegionalPointTransactions
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(transaction => transaction.TenantId == tenantId
                    && transaction.ReferenceType == "vol_log"
                    && transaction.ReferenceId == volLogId
                    && transaction.Type == "earned_for_hours"
                    && transaction.Direction == "credit")
                .OrderBy(transaction => transaction.Id)
                .ToListAsync(ct);
        }

        return await _db.CaringRegionalPointTransactions
            .FromSqlInterpolated(
                $"SELECT * FROM caring_regional_point_transactions WHERE tenant_id = {tenantId} AND reference_type = 'vol_log' AND reference_id = {volLogId} AND type = 'earned_for_hours' AND direction = 'credit' ORDER BY id FOR UPDATE")
            .IgnoreQueryFilters()
            .AsNoTracking()
            .ToListAsync(ct);
    }

    private async Task<IReadOnlyList<CaringRegionalPointTransaction>> LockApprovedHoursReversalsAsync(
        int tenantId,
        int volLogId,
        CancellationToken ct)
    {
        if (!UsesPostgreSql())
        {
            return await _db.CaringRegionalPointTransactions
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(transaction => transaction.TenantId == tenantId
                    && transaction.ReferenceType == "vol_log_reversal"
                    && transaction.ReferenceId == volLogId)
                .OrderBy(transaction => transaction.Id)
                .ToListAsync(ct);
        }

        return await _db.CaringRegionalPointTransactions
            .FromSqlInterpolated(
                $"SELECT * FROM caring_regional_point_transactions WHERE tenant_id = {tenantId} AND reference_type = 'vol_log_reversal' AND reference_id = {volLogId} ORDER BY id FOR UPDATE")
            .IgnoreQueryFilters()
            .AsNoTracking()
            .ToListAsync(ct);
    }

    private Task AcquireApprovedHoursReferenceLockAsync(
        int tenantId,
        int volLogId,
        CancellationToken ct)
    {
        return AcquireRegionalPointLockAsync(
            lockNamespace: -17007,
            lockKey: unchecked((tenantId * 397) ^ volLogId),
            ct: ct);
    }

    private Task AcquireRegionalPointAccountLockAsync(
        int tenantId,
        int userId,
        CancellationToken ct)
    {
        return AcquireRegionalPointLockAsync(
            lockNamespace: -17008,
            lockKey: unchecked((tenantId * 397) ^ userId),
            ct: ct);
    }

    private async Task AcquireRegionalPointLockAsync(
        int lockNamespace,
        int lockKey,
        CancellationToken ct)
    {
        if (!UsesPostgreSql())
        {
            return;
        }

        if (_db.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException("A database transaction is required before locking regional points.");
        }

        await _db.Database.ExecuteSqlRawAsync(
            "SELECT pg_advisory_xact_lock({0}, {1})",
            [lockNamespace, lockKey],
            ct);
    }

    private bool UsesPostgreSql()
    {
        return string.Equals(
            _db.Database.ProviderName,
            "Npgsql.EntityFrameworkCore.PostgreSQL",
            StringComparison.Ordinal);
    }

    private async Task<IDbContextTransaction?> BeginOwnedRelationalTransactionAsync(CancellationToken ct)
    {
        if (!_db.Database.IsRelational() || _db.Database.CurrentTransaction is not null)
        {
            return null;
        }

        return await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
    }

    private static long? ReadOriginalTransactionId(string? metadata)
    {
        if (string.IsNullOrWhiteSpace(metadata))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(metadata);
            if (!document.RootElement.TryGetProperty("original_transaction_id", out var id))
            {
                return null;
            }

            if (id.ValueKind == JsonValueKind.Number && id.TryGetInt64(out var numericId))
            {
                return numericId;
            }

            return id.ValueKind == JsonValueKind.String
                && long.TryParse(id.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var stringId)
                    ? stringId
                    : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private async Task AssertRegionalPointsEnabledAsync(int tenantId, CancellationToken ct)
    {
        if (!await IsRegionalPointsEnabledAsync(tenantId, ct))
        {
            throw new RegionalPointFeatureDisabledException("Regional points are not enabled for this community.");
        }
    }

    private async Task AssertTenantUserAsync(int tenantId, int userId, CancellationToken ct)
    {
        if (userId <= 0 || !await _db.Users
                .IgnoreQueryFilters()
                .AnyAsync(user => user.TenantId == tenantId && user.Id == userId, ct))
        {
            throw new RegionalPointValidationException("User not found.");
        }
    }

    private async Task<bool> TenantUserExistsAsync(int tenantId, int userId, CancellationToken ct)
    {
        return userId > 0 && await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(user => user.TenantId == tenantId && user.Id == userId, ct);
    }

    private async Task<bool> MarketplaceListingBelongsToSellerAsync(
        int tenantId,
        int listingId,
        int sellerId,
        CancellationToken ct)
    {
        return await _db.MarketplaceListings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(listing => listing.TenantId == tenantId
                && listing.Id == listingId
                && listing.UserId == sellerId,
                ct);
    }

    private static RegionalPointPublicConfig PublicConfig(RegionalPointConfig config)
    {
        return new RegionalPointPublicConfig(
            Label: config.Label,
            Symbol: config.Symbol,
            MemberTransfersEnabled: config.MemberTransfersEnabled,
            MarketplaceRedemptionEnabled: config.MarketplaceRedemptionEnabled);
    }

    private static RegionalPointMarketplaceQuote DisabledQuote(string reason)
    {
        return new RegionalPointMarketplaceQuote(
            Accepts: false,
            MemberPoints: 0m,
            RegionalPointsPerChf: 0m,
            MaxDiscountPct: 0,
            MaxPointsUsable: 0m,
            MaxDiscountChf: 0m,
            Reason: reason);
    }

    private static RegionalPointTransactionDto FormatTransaction(
        CaringRegionalPointTransaction row,
        User? user,
        User? actor)
    {
        return new RegionalPointTransactionDto(
            Id: row.Id,
            UserId: row.UserId,
            ActorUserId: row.ActorUserId,
            Type: row.Type,
            Direction: row.Direction,
            Points: RoundPoints(row.Points),
            BalanceAfter: RoundPoints(row.BalanceAfter),
            Description: row.Description,
            CreatedAt: row.CreatedAt,
            UserName: DisplayName(user),
            UserEmail: user?.Email,
            ActorName: DisplayName(actor));
    }

    private static RegionalPointMemberTransactionDto FormatMemberTransaction(CaringRegionalPointTransaction row)
    {
        return new RegionalPointMemberTransactionDto(
            Id: row.Id,
            UserId: row.UserId,
            ActorUserId: row.ActorUserId,
            Type: row.Type,
            Direction: row.Direction,
            Points: RoundPoints(row.Points),
            BalanceAfter: RoundPoints(row.BalanceAfter),
            Description: row.Description,
            CreatedAt: row.CreatedAt);
    }

    private static string? DisplayName(User? user)
    {
        if (user is null)
        {
            return null;
        }

        var full = string.Join(' ', new[] { user.FirstName, user.LastName }
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .Select(part => part.Trim()));
        return full.Length > 0 ? full : null;
    }

    private static decimal NormalizePoints(decimal points)
    {
        points = RoundPoints(points);
        if (points <= 0m)
        {
            throw new RegionalPointValidationException("Points must be greater than zero.");
        }

        if (points > 1000000m)
        {
            throw new RegionalPointValidationException("Point amount exceeds the maximum allowed value.");
        }

        return points;
    }

    private static decimal RoundPoints(decimal value)
    {
        return decimal.Round(value, 2, MidpointRounding.AwayFromZero);
    }

    private static string? NormalizeDescription(string? description)
    {
        var trimmed = description?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        return trimmed.Length <= 500 ? trimmed : trimmed[..500];
    }

    private async Task UpsertSettingAsync(
        int tenantId,
        string key,
        string value,
        DateTime now,
        CancellationToken ct)
    {
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(config => config.TenantId == tenantId && config.Key == key, ct);

        if (row is null)
        {
            row = new TenantConfig
            {
                TenantId = tenantId,
                Key = key,
                CreatedAt = now
            };
            _db.TenantConfigs.Add(row);
        }

        row.Value = value;
        row.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);
    }

    private static RegionalPointConfig Normalize(RegionalPointConfig config)
    {
        var normalized = config with
        {
            Label = NormalizeBoundedString(config.Label, Defaults.Label, 80),
            Symbol = NormalizeBoundedString(config.Symbol, Defaults.Symbol, 12),
            PointsPerApprovedHour = Math.Clamp(decimal.Round(config.PointsPerApprovedHour, 2, MidpointRounding.AwayFromZero), 0m, 10000m)
        };

        if (!normalized.Enabled)
        {
            normalized = normalized with
            {
                AutoIssueEnabled = false,
                MemberTransfersEnabled = false,
                MarketplaceRedemptionEnabled = false
            };
        }

        return normalized;
    }

    private static string NormalizeBoundedString(string? value, string fallback, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return fallback;
        }

        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }

    private static IReadOnlyDictionary<string, string> Serialize(RegionalPointConfig config)
    {
        return new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["enabled"] = SerializeBool(config.Enabled),
            ["label"] = config.Label,
            ["symbol"] = config.Symbol,
            ["auto_issue_enabled"] = SerializeBool(config.AutoIssueEnabled),
            ["points_per_approved_hour"] = config.PointsPerApprovedHour.ToString("0.##", CultureInfo.InvariantCulture),
            ["member_transfers_enabled"] = SerializeBool(config.MemberTransfersEnabled),
            ["marketplace_redemption_enabled"] = SerializeBool(config.MarketplaceRedemptionEnabled)
        };
    }

    private static bool ReadBool(JsonElement value, bool fallback)
    {
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => value.TryGetDecimal(out var number) ? number != 0m : fallback,
            JsonValueKind.String => ParseBool(value.GetString()) ?? fallback,
            _ => fallback
        };
    }

    private static decimal ReadDecimal(JsonElement value, decimal fallback)
    {
        return value.ValueKind switch
        {
            JsonValueKind.Number => value.TryGetDecimal(out var number) ? number : fallback,
            JsonValueKind.String => ParseDecimalOrDefault(value.GetString(), fallback),
            _ => fallback
        };
    }

    private static string ReadString(JsonElement value, string fallback)
    {
        return value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? fallback
            : fallback;
    }

    private static bool ParseBoolOrDefault(string? raw, bool fallback)
    {
        return ParseBool(raw) ?? fallback;
    }

    private static decimal ParseDecimalOrDefault(string? raw, decimal fallback)
    {
        return decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out var value)
            ? value
            : fallback;
    }

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" or "enabled" => true,
            "false" or "0" or "no" or "off" or "disabled" => false,
            _ => null
        };
    }

    private static string SerializeBool(bool value)
    {
        return value ? "1" : "0";
    }
}

public sealed record RegionalPointConfig(
    [property: JsonPropertyName("enabled")] bool Enabled,
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("symbol")] string Symbol,
    [property: JsonPropertyName("auto_issue_enabled")] bool AutoIssueEnabled,
    [property: JsonPropertyName("points_per_approved_hour")] decimal PointsPerApprovedHour,
    [property: JsonPropertyName("member_transfers_enabled")] bool MemberTransfersEnabled,
    [property: JsonPropertyName("marketplace_redemption_enabled")] bool MarketplaceRedemptionEnabled);

public sealed record RegionalPointLedgerResult(
    [property: JsonPropertyName("stats")] RegionalPointStats Stats,
    [property: JsonPropertyName("items")] IReadOnlyList<RegionalPointTransactionDto> Items);

public sealed record RegionalPointStats(
    [property: JsonPropertyName("accounts_count")] int AccountsCount,
    [property: JsonPropertyName("circulating_points")] decimal CirculatingPoints,
    [property: JsonPropertyName("total_issued")] decimal TotalIssued,
    [property: JsonPropertyName("total_spent")] decimal TotalSpent);

public sealed record RegionalPointPublicConfig(
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("symbol")] string Symbol,
    [property: JsonPropertyName("member_transfers_enabled")] bool MemberTransfersEnabled,
    [property: JsonPropertyName("marketplace_redemption_enabled")] bool MarketplaceRedemptionEnabled);

public sealed record RegionalPointMemberAccount(
    [property: JsonPropertyName("user_id")] int UserId,
    [property: JsonPropertyName("balance")] decimal Balance,
    [property: JsonPropertyName("lifetime_earned")] decimal LifetimeEarned,
    [property: JsonPropertyName("lifetime_spent")] decimal LifetimeSpent);

public sealed record RegionalPointMemberSummary(
    [property: JsonPropertyName("enabled")] bool Enabled,
    [property: JsonPropertyName("config")] RegionalPointPublicConfig Config,
    [property: JsonPropertyName("account")] RegionalPointMemberAccount Account);

public sealed record RegionalPointMemberTransactionDto(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("user_id")] int UserId,
    [property: JsonPropertyName("actor_user_id")] int? ActorUserId,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("direction")] string Direction,
    [property: JsonPropertyName("points")] decimal Points,
    [property: JsonPropertyName("balance_after")] decimal BalanceAfter,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt);

public sealed record RegionalPointTransferResult(
    [property: JsonPropertyName("sender_transaction_id")] long SenderTransactionId,
    [property: JsonPropertyName("recipient_transaction_id")] long RecipientTransactionId,
    [property: JsonPropertyName("sender_user_id")] int SenderUserId,
    [property: JsonPropertyName("recipient_user_id")] int RecipientUserId,
    [property: JsonPropertyName("points")] decimal Points,
    [property: JsonPropertyName("sender_balance")] decimal SenderBalance,
    [property: JsonPropertyName("recipient_balance")] decimal RecipientBalance);

public sealed record RegionalPointMarketplaceQuote(
    [property: JsonPropertyName("accepts")] bool Accepts,
    [property: JsonPropertyName("member_points")] decimal MemberPoints,
    [property: JsonPropertyName("regional_points_per_chf")] decimal RegionalPointsPerChf,
    [property: JsonPropertyName("max_discount_pct")] int MaxDiscountPct,
    [property: JsonPropertyName("max_points_usable")] decimal MaxPointsUsable,
    [property: JsonPropertyName("max_discount_chf")] decimal MaxDiscountChf,
    [property: JsonPropertyName("reason")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Reason);

public sealed record RegionalPointMarketplaceRedemptionResult(
    [property: JsonPropertyName("transaction_id")] long TransactionId,
    [property: JsonPropertyName("seller_user_id")] int SellerUserId,
    [property: JsonPropertyName("marketplace_listing_id")] int? MarketplaceListingId,
    [property: JsonPropertyName("points_used")] decimal PointsUsed,
    [property: JsonPropertyName("discount_chf")] decimal DiscountChf,
    [property: JsonPropertyName("new_regional_point_balance")] decimal NewRegionalPointBalance)
{
    [JsonPropertyName("success")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool Success { get; init; }
}

public sealed record RegionalPointTransactionDto(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("user_id")] int UserId,
    [property: JsonPropertyName("actor_user_id")] int? ActorUserId,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("direction")] string Direction,
    [property: JsonPropertyName("points")] decimal Points,
    [property: JsonPropertyName("balance_after")] decimal BalanceAfter,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("user_name")] string? UserName,
    [property: JsonPropertyName("user_email")] string? UserEmail,
    [property: JsonPropertyName("actor_name")] string? ActorName);

public sealed record RegionalPointMutationResult(
    [property: JsonPropertyName("transaction_id")] long TransactionId,
    [property: JsonPropertyName("user_id")] int UserId,
    [property: JsonPropertyName("points")] decimal Points,
    [property: JsonPropertyName("balance")] decimal Balance);

public sealed record RegionalPointHoursAwardResult(
    [property: JsonPropertyName("transaction_id")] long TransactionId,
    [property: JsonPropertyName("user_id")] int UserId,
    [property: JsonPropertyName("points")] decimal Points,
    [property: JsonPropertyName("balance")] decimal Balance,
    [property: JsonPropertyName("already_awarded")] bool AlreadyAwarded);

public sealed record RegionalPointSellerSettings(
    [property: JsonPropertyName("seller_user_id")] int SellerUserId,
    [property: JsonPropertyName("accepts_regional_points")] bool AcceptsRegionalPoints,
    [property: JsonPropertyName("regional_points_per_chf")] decimal RegionalPointsPerChf,
    [property: JsonPropertyName("regional_points_max_discount_pct")] int RegionalPointsMaxDiscountPct)
{
    public static RegionalPointSellerSettings Default(int sellerId)
    {
        return new RegionalPointSellerSettings(sellerId, false, 10m, 25);
    }
}

public sealed class RegionalPointFeatureDisabledException : Exception
{
    public RegionalPointFeatureDisabledException(string message) : base(message) { }
}

public sealed class RegionalPointValidationException : Exception
{
    public RegionalPointValidationException(string message) : base(message) { }
}

public sealed class RegionalPointOperationException : Exception
{
    public RegionalPointOperationException(string message) : base(message) { }
}
