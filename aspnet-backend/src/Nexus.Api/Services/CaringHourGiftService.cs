// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class CaringHourGiftService
{
    private const string StatusPending = "pending";
    private const string StatusAccepted = "accepted";
    private const string StatusDeclined = "declined";
    private const string StatusReverted = "reverted";
    private const string ReservationDescription = "Caring hour gift reservation";
    private const string AcceptedSettlementDescription = "Caring hour gift accepted";
    private const string DeclinedRefundDescription = "Caring hour gift declined refund";
    private const string RevertedRefundDescription = "Caring hour gift reverted refund";
    private const int MaxMessageLength = 500;

    private readonly NexusDbContext _db;
    private readonly PersonalWalletLedgerService _personalWallet;

    public CaringHourGiftService(
        NexusDbContext db,
        TenantContext tenantContext,
        PersonalWalletLedgerService personalWallet)
    {
        _db = db;
        _personalWallet = personalWallet;
        _ = tenantContext;
    }

    public CaringHourGiftService(NexusDbContext db, TenantContext tenantContext)
        : this(
            db,
            tenantContext,
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

    public async Task<IReadOnlyList<CaringHourGiftItemDto>> InboxAsync(
        int tenantId,
        int userId,
        CancellationToken ct)
    {
        var rows = await _db.CaringHourGifts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(g => g.TenantId == tenantId
                && g.RecipientUserId == userId
                && g.Status == StatusPending)
            .OrderByDescending(g => g.CreatedAt)
            .ToListAsync(ct);

        var partners = await LoadUsersAsync(tenantId, rows.Select(g => g.SenderUserId), ct);
        return rows.Select(row => Map(row, row.SenderUserId, partners)).ToArray();
    }

    public async Task<IReadOnlyList<CaringHourGiftItemDto>> SentAsync(
        int tenantId,
        int userId,
        CancellationToken ct)
    {
        var rows = await _db.CaringHourGifts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(g => g.TenantId == tenantId && g.SenderUserId == userId)
            .OrderByDescending(g => g.CreatedAt)
            .Take(100)
            .ToListAsync(ct);

        var partners = await LoadUsersAsync(tenantId, rows.Select(g => g.RecipientUserId), ct);
        return rows.Select(row => Map(row, row.RecipientUserId, partners)).ToArray();
    }

    public async Task<CaringHourGiftSendResult> SendAsync(
        int tenantId,
        int senderUserId,
        int recipientUserId,
        decimal hours,
        string? message,
        CancellationToken ct)
    {
        if (senderUserId <= 0 || recipientUserId <= 0)
        {
            throw new ArgumentException("Sender and recipient are required.");
        }

        if (senderUserId == recipientUserId)
        {
            throw new ArgumentException("You cannot gift hours to yourself.");
        }

        if (hours <= 0)
        {
            throw new ArgumentException("Hours must be greater than zero.");
        }

        if (Math.Round(hours, 2, MidpointRounding.AwayFromZero) != hours)
        {
            throw new ArgumentException("Hours must have at most 2 decimal places.");
        }

        var cleanMessage = NormalizeMessage(message);
        var roundedHours = Math.Round(hours, 2, MidpointRounding.AwayFromZero);

        await using var databaseTransaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct)
            : null;
        if (databaseTransaction is not null)
        {
            await _personalWallet.AcquireSpendLockAsync(senderUserId, ct);
        }

        var senderExists = await _db.Users
            .IgnoreQueryFilters()
            .AnyAsync(u => u.TenantId == tenantId
                && u.Id == senderUserId
                && u.IsActive
                && u.SuspendedAt == null, ct);
        if (!senderExists)
        {
            throw new InvalidOperationException("Sender not found.");
        }

        var availableBalance = await _personalWallet.GetBalanceAsync(tenantId, senderUserId, ct);
        if (availableBalance < roundedHours)
        {
            throw new InvalidOperationException("Insufficient banked hours.");
        }

        var recipientExists = await _db.Users
            .IgnoreQueryFilters()
            .AnyAsync(u => u.TenantId == tenantId
                && u.Id == recipientUserId
                && u.IsActive
                && u.SuspendedAt == null, ct);
        if (!recipientExists)
        {
            throw new InvalidOperationException("Recipient not found.");
        }

        var now = DateTime.UtcNow;
        var reservation = new Transaction
        {
            TenantId = tenantId,
            SenderId = senderUserId,
            ReceiverId = null,
            Amount = roundedHours,
            Description = ReservationDescription,
            TransactionType = PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType,
            Status = TransactionStatus.Completed,
            CreatedAt = now
        };
        var gift = new CaringHourGift
        {
            TenantId = tenantId,
            SenderUserId = senderUserId,
            RecipientUserId = recipientUserId,
            ReservationTransaction = reservation,
            Hours = roundedHours,
            Message = cleanMessage,
            Status = StatusPending,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringHourGifts.Add(gift);
        await _db.SaveChangesAsync(ct);
        if (databaseTransaction is not null)
        {
            await databaseTransaction.CommitAsync(ct);
        }

        return new CaringHourGiftSendResult(gift.Id, StatusPending, true);
    }

    public async Task AcceptAsync(
        int tenantId,
        long giftId,
        int recipientUserId,
        CancellationToken ct)
    {
        await using var databaseTransaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct)
            : null;
        if (databaseTransaction is not null)
        {
            await AcquireGiftLockAsync(giftId, ct);
        }

        var gift = await _db.CaringHourGifts
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == giftId, ct);
        if (gift is null)
        {
            throw new InvalidOperationException("Gift not found.");
        }

        if (gift.RecipientUserId != recipientUserId)
        {
            throw new InvalidOperationException("Only the recipient can accept this gift.");
        }

        if (gift.Status != StatusPending)
        {
            throw new InvalidOperationException("Gift is no longer pending.");
        }

        var roundedHours = Math.Round(gift.Hours, 2, MidpointRounding.AwayFromZero);
        await RequireReservationAsync(gift, roundedHours, ct);
        if (gift.SettlementTransactionId.HasValue)
            throw new InvalidOperationException("Gift already has a settlement transaction.");

        var now = DateTime.UtcNow;
        gift.Status = StatusAccepted;
        gift.AcceptedAt = now;
        gift.UpdatedAt = now;
        gift.SettlementTransaction = new Transaction
        {
            TenantId = tenantId,
            SenderId = null,
            ReceiverId = gift.RecipientUserId,
            Amount = roundedHours,
            Description = AcceptedSettlementDescription,
            TransactionType = PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType,
            Status = TransactionStatus.Completed,
            CreatedAt = now
        };

        await _db.SaveChangesAsync(ct);
        if (databaseTransaction is not null)
        {
            await databaseTransaction.CommitAsync(ct);
        }
    }

    public async Task DeclineAsync(
        int tenantId,
        long giftId,
        int recipientUserId,
        string? reason,
        CancellationToken ct)
    {
        await using var databaseTransaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct)
            : null;
        if (databaseTransaction is not null)
        {
            await AcquireGiftLockAsync(giftId, ct);
        }

        var gift = await _db.CaringHourGifts
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == giftId, ct);

        if (gift is null)
        {
            throw new InvalidOperationException("Gift not found.");
        }

        if (gift.RecipientUserId != recipientUserId)
        {
            throw new InvalidOperationException("Only the recipient can decline this gift.");
        }

        if (gift.Status != StatusPending)
        {
            throw new InvalidOperationException("Gift is no longer pending.");
        }

        var roundedHours = Math.Round(gift.Hours, 2, MidpointRounding.AwayFromZero);
        await RequireReservationAsync(gift, roundedHours, ct);
        if (gift.SettlementTransactionId.HasValue)
            throw new InvalidOperationException("Gift already has a settlement transaction.");

        var now = DateTime.UtcNow;
        gift.Status = StatusDeclined;
        gift.DeclinedAt = now;
        gift.DeclineReason = NormalizeReason(reason);
        gift.UpdatedAt = now;
        gift.SettlementTransaction = new Transaction
        {
            TenantId = tenantId,
            SenderId = null,
            ReceiverId = gift.SenderUserId,
            Amount = roundedHours,
            Description = DeclinedRefundDescription,
            TransactionType = PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType,
            Status = TransactionStatus.Completed,
            CreatedAt = now
        };

        await _db.SaveChangesAsync(ct);
        if (databaseTransaction is not null)
        {
            await databaseTransaction.CommitAsync(ct);
        }
    }

    public async Task RevertAsync(
        int tenantId,
        long giftId,
        int senderUserId,
        CancellationToken ct)
    {
        await using var databaseTransaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct)
            : null;
        if (databaseTransaction is not null)
        {
            await AcquireGiftLockAsync(giftId, ct);
        }

        var gift = await _db.CaringHourGifts
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == giftId, ct);

        if (gift is null)
        {
            throw new InvalidOperationException("Gift not found.");
        }

        if (gift.SenderUserId != senderUserId)
        {
            throw new InvalidOperationException("Only the sender can withdraw this gift.");
        }

        if (gift.Status != StatusPending)
        {
            throw new InvalidOperationException("Only pending gifts can be withdrawn.");
        }

        var roundedHours = Math.Round(gift.Hours, 2, MidpointRounding.AwayFromZero);
        await RequireReservationAsync(gift, roundedHours, ct);
        if (gift.SettlementTransactionId.HasValue)
            throw new InvalidOperationException("Gift already has a settlement transaction.");

        var now = DateTime.UtcNow;
        gift.Status = StatusReverted;
        gift.RevertedAt = now;
        gift.UpdatedAt = now;
        gift.SettlementTransaction = new Transaction
        {
            TenantId = tenantId,
            SenderId = null,
            ReceiverId = gift.SenderUserId,
            Amount = roundedHours,
            Description = RevertedRefundDescription,
            TransactionType = PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType,
            Status = TransactionStatus.Completed,
            CreatedAt = now
        };

        await _db.SaveChangesAsync(ct);
        if (databaseTransaction is not null)
        {
            await databaseTransaction.CommitAsync(ct);
        }
    }

    private async Task AcquireGiftLockAsync(long giftId, CancellationToken ct)
    {
        if (_db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("A database transaction is required before locking an hour gift.");

        // Personal-wallet spend locks use positive user IDs. A negative bigint
        // namespace keeps gift lifecycle locks disjoint while remaining stable.
        var lockKey = unchecked(long.MinValue + giftId);
        await _db.Database.ExecuteSqlRawAsync(
            "SELECT pg_advisory_xact_lock({0})",
            new object[] { lockKey },
            ct);
    }

    private async Task RequireReservationAsync(
        CaringHourGift gift,
        decimal roundedHours,
        CancellationToken ct)
    {
        if (!gift.ReservationTransactionId.HasValue)
            throw new InvalidOperationException("Gift reservation is unavailable.");

        var reservation = await _db.Transactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(t => t.Id == gift.ReservationTransactionId.Value
                && t.TenantId == gift.TenantId, ct);
        if (reservation is null
            || reservation.SenderId != gift.SenderUserId
            || reservation.ReceiverId is not null
            || reservation.Amount != roundedHours
            || reservation.Status != TransactionStatus.Completed
            || reservation.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType)
        {
            throw new InvalidOperationException("Gift reservation is invalid.");
        }
    }

    private async Task<IReadOnlyDictionary<int, User>> LoadUsersAsync(
        int tenantId,
        IEnumerable<int> userIds,
        CancellationToken ct)
    {
        var ids = userIds
            .Where(id => id > 0)
            .Distinct()
            .ToArray();

        if (ids.Length == 0)
        {
            return new Dictionary<int, User>();
        }

        return await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId && ids.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, ct);
    }

    private static CaringHourGiftItemDto Map(
        CaringHourGift gift,
        int partnerUserId,
        IReadOnlyDictionary<int, User> partners)
    {
        partners.TryGetValue(partnerUserId, out var partner);

        return new CaringHourGiftItemDto(
            Id: gift.Id,
            Hours: Math.Round(gift.Hours, 2, MidpointRounding.AwayFromZero),
            Message: gift.Message,
            Status: gift.Status,
            CreatedAt: gift.CreatedAt,
            Partner: new CaringHourGiftPartnerDto(
                Id: partnerUserId,
                Name: DisplayName(partner),
                AvatarUrl: partner?.AvatarUrl));
    }

    private static string DisplayName(User? user)
    {
        if (user is null)
        {
            return string.Empty;
        }

        return $"{user.FirstName} {user.LastName}".Trim();
    }

    private static string? NormalizeReason(string? reason)
    {
        if (reason is null)
        {
            return null;
        }

        var trimmed = reason.Trim();
        if (trimmed.Length == 0)
        {
            return null;
        }

        return trimmed.Length <= MaxMessageLength
            ? trimmed
            : trimmed[..MaxMessageLength];
    }

    private static string? NormalizeMessage(string? message)
    {
        if (message is null)
        {
            return null;
        }

        var trimmed = message.Trim();
        if (trimmed.Length == 0)
        {
            return null;
        }

        if (trimmed.Length > MaxMessageLength)
        {
            throw new ArgumentException("Message is too long.");
        }

        return trimmed;
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

public sealed record CaringHourGiftItemDto(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("hours")] decimal Hours,
    [property: JsonPropertyName("message")] string? Message,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("partner")] CaringHourGiftPartnerDto Partner);

public sealed record CaringHourGiftPartnerDto(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("avatar_url")] string? AvatarUrl);

public sealed record CaringHourGiftSendResult(
    [property: JsonPropertyName("gift_id")] long GiftId,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("success")] bool Success);
