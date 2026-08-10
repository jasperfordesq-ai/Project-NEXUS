// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class CaringLoyaltyService
{
    private const decimal MaxCreditsPerRedemption = 1000m;

    private readonly NexusDbContext _db;
    private readonly PersonalWalletLedgerService _personalWallet;

    public CaringLoyaltyService(
        NexusDbContext db,
        PersonalWalletLedgerService personalWallet)
    {
        _db = db;
        _personalWallet = personalWallet;
    }

    public CaringLoyaltyService(NexusDbContext db)
        : this(
            db,
            new PersonalWalletLedgerService(
                db,
                NullLogger<PersonalWalletLedgerService>.Instance))
    {
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == "features.caring_community")
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public async Task<CaringLoyaltyQuote> CalculateAvailableDiscountAsync(
        int tenantId,
        int memberId,
        int sellerId,
        decimal orderTotalChf,
        int? listingId,
        CancellationToken ct)
    {
        var unavailable = CaringLoyaltyQuote.Unavailable();
        if (orderTotalChf <= 0)
        {
            return unavailable with { Reason = "invalid_order_total" };
        }

        var listingState = await ValidateListingAsync(tenantId, sellerId, listingId, ct);
        if (listingState is not null)
        {
            return unavailable with { Reason = listingState };
        }

        var settings = await _db.MarketplaceSellerLoyaltySettings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.SellerUserId == sellerId, ct);

        if (settings is null || !settings.AcceptsTimeCredits)
        {
            return unavailable with { Reason = "merchant_disabled" };
        }

        var rate = settings.LoyaltyChfPerHour;
        var maxPct = settings.LoyaltyMaxDiscountPct;
        if (rate <= 0 || maxPct <= 0)
        {
            return unavailable with { Reason = "merchant_misconfigured" };
        }

        var memberCredits = await BalanceAsync(tenantId, memberId, ct);
        var maxDiscountChf = Math.Round(orderTotalChf * maxPct / 100m, 2);
        var maxCreditsByPolicy = rate > 0 ? Math.Round(maxDiscountChf / rate, 2) : 0m;
        var maxCreditsUsable = Math.Max(0m, Math.Round(
            Math.Min(memberCredits, Math.Min(maxCreditsByPolicy, MaxCreditsPerRedemption)), 2));
        var effectiveDiscount = Math.Round(maxCreditsUsable * rate, 2);

        return new CaringLoyaltyQuote(
            Accepts: true,
            MemberCredits: Math.Round(memberCredits, 2),
            ExchangeRateChf: Math.Round(rate, 2),
            MaxDiscountPct: maxPct,
            MaxCreditsUsable: maxCreditsUsable,
            MaxDiscountChf: effectiveDiscount);
    }

    public async Task<CaringLoyaltyMutationResult> RedeemAsync(
        int tenantId,
        int memberId,
        CaringLoyaltyRedeemRequest request,
        CancellationToken ct)
    {
        if (request.CreditsToUse <= 0)
        {
            return Validation("credits must be positive");
        }

        if (request.OrderTotalChf <= 0)
        {
            return Validation("invalid order total");
        }

        if (Math.Abs(Math.Round(request.CreditsToUse, 2) - request.CreditsToUse) > 0.0001m)
        {
            return Validation("credits must use no more than two decimal places");
        }

        if (request.CreditsToUse > MaxCreditsPerRedemption)
        {
            return Validation("credits exceed maximum redemption");
        }

        if (memberId == request.SellerId)
        {
            return Failure("REDEMPTION_FAILED", "self redemption is forbidden");
        }

        var listingState = await ValidateListingAsync(tenantId, request.SellerId, request.ListingId, ct);
        if (listingState is not null)
        {
            return Failure("REDEMPTION_FAILED", listingState);
        }

        var settings = await _db.MarketplaceSellerLoyaltySettings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.SellerUserId == request.SellerId, ct);

        if (settings is null || !settings.AcceptsTimeCredits)
        {
            return Failure("MERCHANT_DISABLED", "merchant disabled");
        }

        if (settings.LoyaltyChfPerHour <= 0 || settings.LoyaltyMaxDiscountPct <= 0)
        {
            return Failure("REDEMPTION_FAILED", "merchant misconfigured");
        }

        var discountChf = Math.Round(request.CreditsToUse * settings.LoyaltyChfPerHour, 2);
        var maxDiscountChf = Math.Round(request.OrderTotalChf * settings.LoyaltyMaxDiscountPct / 100m, 2);
        if (discountChf > maxDiscountChf + 0.005m)
        {
            return Failure("EXCEEDS_MAX_DISCOUNT", "exceeds max discount");
        }

        await using var databaseTransaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct)
            : null;
        if (databaseTransaction is not null)
        {
            await AcquireSellerSettingsLockAsync(tenantId, request.SellerId, ct);
            await _personalWallet.AcquireSpendLockAsync(memberId, ct);
        }

        settings = await _db.MarketplaceSellerLoyaltySettings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.SellerUserId == request.SellerId, ct);
        if (settings is null || !settings.AcceptsTimeCredits)
        {
            return Failure("MERCHANT_DISABLED", "merchant disabled");
        }
        if (settings.LoyaltyChfPerHour <= 0 || settings.LoyaltyMaxDiscountPct <= 0)
        {
            return Failure("REDEMPTION_FAILED", "merchant misconfigured");
        }
        discountChf = Math.Round(request.CreditsToUse * settings.LoyaltyChfPerHour, 2);
        maxDiscountChf = Math.Round(request.OrderTotalChf * settings.LoyaltyMaxDiscountPct / 100m, 2);
        if (discountChf > maxDiscountChf + 0.005m)
        {
            return Failure("EXCEEDS_MAX_DISCOUNT", "exceeds max discount");
        }

        var balance = await _personalWallet.GetBalanceAsync(tenantId, memberId, ct);
        if (balance <= 0 || balance < request.CreditsToUse)
        {
            if (databaseTransaction is not null)
            {
                await databaseTransaction.RollbackAsync(ct);
            }
            return Failure("INSUFFICIENT_CREDITS", "insufficient credits");
        }

        var now = DateTime.UtcNow;
        var redemption = new CaringLoyaltyRedemption
        {
            TenantId = tenantId,
            MemberUserId = memberId,
            MerchantUserId = request.SellerId,
            MarketplaceListingId = request.ListingId,
            CreditsUsed = Math.Round(request.CreditsToUse, 2),
            ExchangeRateChf = Math.Round(settings.LoyaltyChfPerHour, 2),
            DiscountChf = discountChf,
            OrderTotalChf = Math.Round(request.OrderTotalChf, 2),
            Status = "applied",
            RedeemedAt = now,
            CreatedAt = now,
            UpdatedAt = now
        };

        var debit = new Transaction
        {
            TenantId = tenantId,
            SenderId = memberId,
            ReceiverId = null,
            Amount = redemption.CreditsUsed,
            Description = $"[loyalty_redemption] seller:{request.SellerId} listing:{request.ListingId}",
            TransactionType = PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType,
            Status = TransactionStatus.Completed,
            CreatedAt = now
        };
        redemption.RedemptionTransaction = debit;
        _db.CaringLoyaltyRedemptions.Add(redemption);
        _db.Transactions.Add(debit);
        await _db.SaveChangesAsync(ct);
        if (databaseTransaction is not null)
        {
            await databaseTransaction.CommitAsync(ct);
        }

        return new CaringLoyaltyMutationResult(new
        {
            discount_chf = discountChf,
            redemption_id = redemption.Id,
            new_wallet_balance = Math.Round(balance - redemption.CreditsUsed, 2),
            success = true
        });
    }

    public async Task<IReadOnlyList<CaringLoyaltyRedemptionRow>> ListMemberHistoryAsync(
        int tenantId,
        int memberId,
        int limit,
        CancellationToken ct)
    {
        limit = Math.Clamp(limit, 1, 200);
        var rows = await _db.CaringLoyaltyRedemptions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(r => r.TenantId == tenantId && r.MemberUserId == memberId)
            .OrderByDescending(r => r.RedeemedAt)
            .Take(limit)
            .ToListAsync(ct);

        return await FormatRowsAsync(tenantId, rows, includeMember: false, ct);
    }

    public async Task<CaringLoyaltyAdminList> ListTenantRedemptionsAsync(
        int tenantId,
        int limit,
        CancellationToken ct)
    {
        limit = Math.Clamp(limit, 1, 500);
        var rows = await _db.CaringLoyaltyRedemptions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(r => r.TenantId == tenantId)
            .OrderByDescending(r => r.RedeemedAt)
            .Take(limit)
            .ToListAsync(ct);

        var statsRows = await _db.CaringLoyaltyRedemptions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(r => r.TenantId == tenantId && r.Status == "applied")
            .ToListAsync(ct);

        var formatted = await FormatRowsAsync(tenantId, rows, includeMember: true, ct);
        return new CaringLoyaltyAdminList(
            new CaringLoyaltyStats(
                statsRows.Count,
                Math.Round(statsRows.Sum(r => r.CreditsUsed), 2),
                Math.Round(statsRows.Sum(r => r.DiscountChf), 2)),
            formatted);
    }

    public async Task<CaringLoyaltySellerSettingsResponse> GetSellerSettingsAsync(
        int tenantId,
        int sellerId,
        CancellationToken ct)
    {
        var row = await _db.MarketplaceSellerLoyaltySettings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.SellerUserId == sellerId, ct);

        return row is null
            ? CaringLoyaltySellerSettingsResponse.Default(sellerId)
            : new CaringLoyaltySellerSettingsResponse(
                sellerId,
                row.AcceptsTimeCredits,
                Math.Round(row.LoyaltyChfPerHour, 2),
                row.LoyaltyMaxDiscountPct);
    }

    public async Task<CaringLoyaltyMutationResult> UpdateSellerSettingsAsync(
        int tenantId,
        CaringLoyaltySellerSettingsRequest request,
        CancellationToken ct)
    {
        if (request.SellerUserId <= 0)
        {
            return new CaringLoyaltyMutationResult(null,
                [new LaravelErrorRow("VALIDATION_ERROR", "Field is required.", "seller_user_id")],
                StatusCodes.Status422UnprocessableEntity);
        }

        if (request.LoyaltyChfPerHour <= 0 || request.LoyaltyChfPerHour > 9999m)
        {
            return Validation("invalid exchange rate");
        }

        if (request.LoyaltyMaxDiscountPct < 0 || request.LoyaltyMaxDiscountPct > 100)
        {
            return Validation("invalid max discount percent");
        }

        await using var databaseTransaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct)
            : null;
        if (databaseTransaction is not null)
        {
            await AcquireSellerSettingsLockAsync(tenantId, request.SellerUserId, ct);
        }

        var now = DateTime.UtcNow;
        var row = await _db.MarketplaceSellerLoyaltySettings
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.SellerUserId == request.SellerUserId, ct);

        if (row is null)
        {
            row = new MarketplaceSellerLoyaltySetting
            {
                TenantId = tenantId,
                SellerUserId = request.SellerUserId,
                CreatedAt = now
            };
            _db.MarketplaceSellerLoyaltySettings.Add(row);
        }

        row.AcceptsTimeCredits = request.AcceptsTimeCredits;
        row.LoyaltyChfPerHour = Math.Round(request.LoyaltyChfPerHour, 2);
        row.LoyaltyMaxDiscountPct = request.LoyaltyMaxDiscountPct;
        row.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);
        if (databaseTransaction is not null)
        {
            await databaseTransaction.CommitAsync(ct);
        }

        return new CaringLoyaltyMutationResult(
            await GetSellerSettingsAsync(tenantId, request.SellerUserId, ct));
    }

    public async Task<CaringLoyaltyMutationResult> ReverseAsync(
        int tenantId,
        int redemptionId,
        string? reason,
        int adminUserId,
        CancellationToken ct)
    {
        var reasonClean = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        if (reasonClean is { Length: > 500 })
        {
            return Validation("reversal reason too long");
        }

        var target = await _db.CaringLoyaltyRedemptions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(r => r.TenantId == tenantId && r.Id == redemptionId)
            .Select(r => new { r.MemberUserId })
            .FirstOrDefaultAsync(ct);

        if (target is null)
        {
            return new CaringLoyaltyMutationResult(null,
                [new LaravelErrorRow("NOT_FOUND", "redemption not found")],
                StatusCodes.Status404NotFound);
        }

        await using var databaseTransaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct)
            : null;
        if (databaseTransaction is not null)
        {
            await _personalWallet.AcquireSpendLockAsync(target.MemberUserId, ct);
        }

        var row = await _db.CaringLoyaltyRedemptions
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Id == redemptionId, ct);

        if (row is null)
        {
            if (databaseTransaction is not null)
            {
                await databaseTransaction.RollbackAsync(ct);
            }
            return new CaringLoyaltyMutationResult(null,
                [new LaravelErrorRow("NOT_FOUND", "redemption not found")],
                StatusCodes.Status404NotFound);
        }

        if (row.Status != "applied" || row.ReversalTransactionId is not null)
        {
            if (databaseTransaction is not null)
            {
                await databaseTransaction.RollbackAsync(ct);
            }
            return Failure("REVERSAL_FAILED", "redemption not reversible");
        }

        if (row.RedemptionTransactionId is not int redemptionTransactionId)
        {
            return Failure(
                "REVERSAL_FAILED",
                "redemption has no authoritative wallet debit evidence and requires manual reconciliation");
        }

        var debitIsValid = await _db.Transactions
            .IgnoreQueryFilters()
            .AnyAsync(transaction => transaction.TenantId == tenantId
                && transaction.Id == redemptionTransactionId
                && transaction.SenderId == row.MemberUserId
                && transaction.ReceiverId == null
                && transaction.Amount == row.CreditsUsed
                && transaction.TransactionType == PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
                && transaction.Status == TransactionStatus.Completed, ct);
        if (!debitIsValid)
        {
            return Failure(
                "REVERSAL_FAILED",
                "redemption wallet debit evidence is invalid and requires manual reconciliation");
        }

        var balance = await _personalWallet.GetBalanceAsync(tenantId, row.MemberUserId, ct);
        var now = DateTime.UtcNow;
        row.Status = "reversed";
        row.ReversedAt = now;
        row.ReversedBy = adminUserId;
        row.ReversalReason = reasonClean;
        row.UpdatedAt = now;

        var refund = new Transaction
        {
            TenantId = tenantId,
            SenderId = null,
            ReceiverId = row.MemberUserId,
            Amount = row.CreditsUsed,
            Description = $"[loyalty_reversal] redemption:{row.Id}",
            TransactionType = PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType,
            Status = TransactionStatus.Completed,
            CreatedAt = now
        };
        row.ReversalTransaction = refund;
        _db.Transactions.Add(refund);

        await _db.SaveChangesAsync(ct);
        if (databaseTransaction is not null)
        {
            await databaseTransaction.CommitAsync(ct);
        }

        return new CaringLoyaltyMutationResult(new
        {
            redemption_id = row.Id,
            credits_restored = Math.Round(row.CreditsUsed, 2),
            member_new_balance = Math.Round(balance + row.CreditsUsed, 2)
        });
    }

    private async Task<IReadOnlyList<CaringLoyaltyRedemptionRow>> FormatRowsAsync(
        int tenantId,
        IReadOnlyList<CaringLoyaltyRedemption> rows,
        bool includeMember,
        CancellationToken ct)
    {
        var userIds = rows.SelectMany(r => new[] { r.MemberUserId, r.MerchantUserId }).Distinct().ToArray();
        var listingIds = rows.Where(r => r.MarketplaceListingId.HasValue)
            .Select(r => r.MarketplaceListingId!.Value)
            .Distinct()
            .ToArray();

        var users = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId && userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, ct);

        var listings = await _db.MarketplaceListings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(l => l.TenantId == tenantId && listingIds.Contains(l.Id))
            .ToDictionaryAsync(l => l.Id, ct);

        return rows.Select(row =>
        {
            users.TryGetValue(row.MerchantUserId, out var merchant);
            var listing = row.MarketplaceListingId.HasValue && listings.TryGetValue(row.MarketplaceListingId.Value, out var foundListing)
                ? foundListing
                : null;
            User? member = null;
            if (includeMember)
            {
                users.TryGetValue(row.MemberUserId, out member);
            }

            return new CaringLoyaltyRedemptionRow(
                row.Id,
                Math.Round(row.CreditsUsed, 2),
                Math.Round(row.ExchangeRateChf, 2),
                Math.Round(row.DiscountChf, 2),
                Math.Round(row.OrderTotalChf, 2),
                row.Status,
                row.RedeemedAt,
                row.MerchantUserId,
                BuildName(merchant),
                row.MarketplaceListingId,
                listing?.Title,
                includeMember ? row.MemberUserId : null,
                includeMember ? BuildName(member) : null);
        }).ToArray();
    }

    private async Task<string?> ValidateListingAsync(
        int tenantId,
        int sellerId,
        int? listingId,
        CancellationToken ct)
    {
        if (listingId is null or <= 0)
        {
            return "invalid_listing";
        }

        var listing = await _db.MarketplaceListings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(l => l.TenantId == tenantId && l.Id == listingId.Value, ct);

        if (listing is null || listing.UserId != sellerId)
        {
            return "invalid_listing";
        }

        return listing.Status == "active" && listing.ModerationStatus == "approved"
            ? null
            : "listing_unavailable";
    }

    private async Task<decimal> BalanceAsync(int tenantId, int userId, CancellationToken ct)
    {
        var received = await _db.Transactions
            .IgnoreQueryFilters()
            .Where(t => t.TenantId == tenantId && t.ReceiverId == userId && t.Status == TransactionStatus.Completed)
            .SumAsync(t => t.Amount, ct);

        var sent = await _db.Transactions
            .IgnoreQueryFilters()
            .Where(t => t.TenantId == tenantId && t.SenderId == userId && t.Status == TransactionStatus.Completed)
            .SumAsync(t => t.Amount, ct);

        return received - sent;
    }

    private async Task AcquireSellerSettingsLockAsync(
        int tenantId,
        int sellerUserId,
        CancellationToken ct)
    {
        if (!_db.Database.IsRelational())
        {
            return;
        }

        var lockKey = unchecked((tenantId * 397) ^ sellerUserId);
        await _db.Database.ExecuteSqlRawAsync(
            "SELECT pg_advisory_xact_lock({0}, {1})",
            [-17005, lockKey],
            ct);
    }

    private static CaringLoyaltyMutationResult Validation(string message)
    {
        return new CaringLoyaltyMutationResult(null,
            [new LaravelErrorRow("VALIDATION_ERROR", message)],
            StatusCodes.Status422UnprocessableEntity);
    }

    private static CaringLoyaltyMutationResult Failure(string code, string message)
    {
        return new CaringLoyaltyMutationResult(null,
            [new LaravelErrorRow(code, message)],
            StatusCodes.Status422UnprocessableEntity);
    }

    private static string BuildName(User? user)
    {
        if (user is null)
        {
            return string.Empty;
        }

        var combined = (user.FirstName + " " + user.LastName).Trim();
        return combined.Length > 0 ? combined : user.Email;
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
}

public sealed record CaringLoyaltyQuote(
    [property: JsonPropertyName("accepts")] bool Accepts,
    [property: JsonPropertyName("member_credits")] decimal MemberCredits,
    [property: JsonPropertyName("exchange_rate_chf")] decimal ExchangeRateChf,
    [property: JsonPropertyName("max_discount_pct")] int MaxDiscountPct,
    [property: JsonPropertyName("max_credits_usable")] decimal MaxCreditsUsable,
    [property: JsonPropertyName("max_discount_chf")] decimal MaxDiscountChf,
    [property: JsonPropertyName("reason")] string? Reason = null)
{
    public static CaringLoyaltyQuote Unavailable()
    {
        return new CaringLoyaltyQuote(false, 0m, 0m, 0, 0m, 0m);
    }
}

public sealed class CaringLoyaltyRedeemRequest
{
    [JsonPropertyName("seller_id")] public int SellerId { get; set; }
    [JsonPropertyName("listing_id")] public int? ListingId { get; set; }
    [JsonPropertyName("credits_to_use")] public decimal CreditsToUse { get; set; }
    [JsonPropertyName("order_total_chf")] public decimal OrderTotalChf { get; set; }
}

public sealed class CaringLoyaltySellerSettingsRequest
{
    [JsonPropertyName("seller_user_id")] public int SellerUserId { get; set; }
    [JsonPropertyName("accepts_time_credits")] public bool AcceptsTimeCredits { get; set; }
    [JsonPropertyName("loyalty_chf_per_hour")] public decimal LoyaltyChfPerHour { get; set; } = 25m;
    [JsonPropertyName("loyalty_max_discount_pct")] public int LoyaltyMaxDiscountPct { get; set; } = 50;
}

public sealed class CaringLoyaltyReverseRequest
{
    [JsonPropertyName("reason")] public string? Reason { get; set; }
}

public sealed record CaringLoyaltySellerSettingsResponse(
    [property: JsonPropertyName("seller_user_id")] int SellerUserId,
    [property: JsonPropertyName("accepts_time_credits")] bool AcceptsTimeCredits,
    [property: JsonPropertyName("loyalty_chf_per_hour")] decimal LoyaltyChfPerHour,
    [property: JsonPropertyName("loyalty_max_discount_pct")] int LoyaltyMaxDiscountPct)
{
    public static CaringLoyaltySellerSettingsResponse Default(int sellerId)
    {
        return new CaringLoyaltySellerSettingsResponse(sellerId, false, 25m, 50);
    }
}

public sealed record CaringLoyaltyStats(
    [property: JsonPropertyName("total_redemptions")] int TotalRedemptions,
    [property: JsonPropertyName("total_credits")] decimal TotalCredits,
    [property: JsonPropertyName("total_discount_chf")] decimal TotalDiscountChf);

public sealed record CaringLoyaltyAdminList(
    [property: JsonPropertyName("stats")] CaringLoyaltyStats Stats,
    [property: JsonPropertyName("redemptions")] IReadOnlyList<CaringLoyaltyRedemptionRow> Redemptions);

public sealed record CaringLoyaltyRedemptionRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("credits_used")] decimal CreditsUsed,
    [property: JsonPropertyName("exchange_rate_chf")] decimal ExchangeRateChf,
    [property: JsonPropertyName("discount_chf")] decimal DiscountChf,
    [property: JsonPropertyName("order_total_chf")] decimal OrderTotalChf,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("redeemed_at")] DateTime RedeemedAt,
    [property: JsonPropertyName("merchant_id")] int? MerchantId,
    [property: JsonPropertyName("merchant_name")] string MerchantName,
    [property: JsonPropertyName("marketplace_listing_id")] int? MarketplaceListingId,
    [property: JsonPropertyName("listing_title")] string? ListingTitle,
    [property: JsonPropertyName("member_id")] int? MemberId = null,
    [property: JsonPropertyName("member_name")] string? MemberName = null);

public sealed record CaringLoyaltyMutationResult(
    object? Data = null,
    IReadOnlyList<LaravelErrorRow>? Errors = null,
    int StatusCode = StatusCodes.Status200OK);
