// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class CaringHourTransferService
{
    private const string StatusPending = "pending";
    private const string StatusSent = "sent";
    private const string StatusCompleted = "completed";
    private const string StatusRejected = "rejected";
    private const decimal MaxSingleExternalCreditHours = 24m;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        WriteIndented = false
    };

    private readonly NexusDbContext _db;
    private readonly PersonalWalletLedgerService _personalWallet;

    public CaringHourTransferService(
        NexusDbContext db,
        PersonalWalletLedgerService personalWallet)
    {
        _db = db;
        _personalWallet = personalWallet;
    }

    public CaringHourTransferService(NexusDbContext db)
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

    public async Task<HourTransferMutationResult> InitiateAsync(
        int sourceTenantId,
        int sourceMemberId,
        CaringHourTransferInitiateRequest request,
        CancellationToken ct)
    {
        var destinationSlug = request.DestinationTenantSlug?.Trim() ?? string.Empty;
        if (destinationSlug.Length == 0)
        {
            return SingleError("VALIDATION_ERROR", "Field is required.", "destination_tenant_slug");
        }

        if (request.Hours <= 0)
        {
            return SingleError("VALIDATION_ERROR", "Field is required.", "hours");
        }

        if (!IsAcceptableHourAmount(request.Hours))
        {
            return SingleError("VALIDATION_ERROR", "Hours exceed the permitted single-transfer limit.");
        }

        var sourceUser = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.TenantId == sourceTenantId && u.Id == sourceMemberId, ct);

        if (sourceUser is null)
        {
            return SingleError("TRANSFER_FAILED", "Source member not found.");
        }

        var destinationTenant = await _db.Tenants
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Slug == destinationSlug, ct);

        if (destinationTenant is null)
        {
            return SingleError("DESTINATION_NOT_FOUND", "Destination cooperative not found.");
        }

        if (destinationTenant.Id == sourceTenantId)
        {
            return SingleError("VALIDATION_ERROR", "Destination cooperative must be different from source.");
        }

        var destinationUserExists = await _db.Users
            .IgnoreQueryFilters()
            .AnyAsync(u => u.TenantId == destinationTenant.Id && u.Email == sourceUser.Email, ct);

        if (!destinationUserExists)
        {
            return SingleError("NO_MATCHING_EMAIL", "No matching member at destination cooperative - register there first.");
        }

        var balance = await GetBalanceAsync(sourceTenantId, sourceMemberId, ct);
        if (balance < request.Hours)
        {
            return SingleError("INSUFFICIENT_HOURS", "Insufficient banked hours.");
        }

        var now = DateTime.UtcNow;
        var transfer = new CaringHourTransfer
        {
            TenantId = sourceTenantId,
            CounterpartTenantSlug = destinationTenant.Slug,
            Role = "source",
            MemberUserId = sourceMemberId,
            CounterpartMemberEmail = sourceUser.Email,
            HoursTransferred = Math.Round(request.Hours, 2, MidpointRounding.AwayFromZero),
            Status = StatusPending,
            Reason = TrimToNull(request.Reason, 4000),
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringHourTransfers.Add(transfer);
        await _db.SaveChangesAsync(ct);

        return new HourTransferMutationResult(Data: new Dictionary<string, object?>
        {
            ["transfer_id"] = transfer.Id,
            ["status"] = StatusPending,
            ["success"] = true
        }, StatusCode: StatusCodes.Status201Created);
    }

    public async Task<IReadOnlyList<HourTransferHistoryRow>> MemberHistoryAsync(
        int tenantId,
        int memberId,
        CancellationToken ct)
    {
        var rows = await _db.CaringHourTransfers
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(t => t.TenantId == tenantId && t.MemberUserId == memberId && t.Role == "source")
            .OrderByDescending(t => t.Id)
            .Take(100)
            .ToListAsync(ct);

        return rows.Select(MapHistory).ToArray();
    }

    public async Task<IReadOnlyList<HourTransferPendingRow>> PendingAtSourceAsync(
        int tenantId,
        CancellationToken ct)
    {
        var rows = await _db.CaringHourTransfers
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(t => t.TenantId == tenantId && t.Role == "source" && t.Status == StatusPending)
            .OrderBy(t => t.CreatedAt)
            .ToListAsync(ct);

        var users = await LoadUsersAsync(tenantId, rows.Select(t => (int?)t.MemberUserId), ct);
        return rows.Select(row => MapPending(row, users)).ToArray();
    }

    public async Task<IReadOnlyList<HourTransferInboundRow>> RecentAtDestinationAsync(
        int tenantId,
        CancellationToken ct)
    {
        var cutoff = DateTime.UtcNow.AddDays(-90);
        var rows = await _db.CaringHourTransfers
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(t => t.TenantId == tenantId && t.Role == "destination" && t.CreatedAt >= cutoff)
            .OrderByDescending(t => t.CreatedAt)
            .Take(200)
            .ToListAsync(ct);

        var users = await LoadUsersAsync(tenantId, rows.Select(t => (int?)t.MemberUserId), ct);
        return rows.Select(row => MapInbound(row, users)).ToArray();
    }

    public async Task<HourTransferMutationResult> RejectAtSourceAsync(
        int tenantId,
        long transferId,
        int approverUserId,
        CaringHourTransferRejectRequest request,
        CancellationToken ct)
    {
        await using var databaseTransaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct)
            : null;
        if (databaseTransaction is not null)
        {
            await AcquireTransferLifecycleLockAsync(tenantId, transferId, ct);
        }

        var transfer = await FindSourceTransferAsync(tenantId, transferId, tracking: true, ct);
        if (transfer is null)
        {
            return SingleError("TRANSFER_FAILED", "Transfer not found.");
        }

        if (transfer.Status != StatusPending)
        {
            return SingleError("TRANSFER_FAILED", "Only pending transfers can be rejected.");
        }

        var reason = request.Reason?.Trim() ?? string.Empty;
        if (reason.Length > 0)
        {
            var existing = transfer.Reason ?? string.Empty;
            transfer.Reason = existing + $"{Environment.NewLine}[rejected by admin #{approverUserId}] " + Trim(reason, 1000);
        }

        transfer.Status = StatusRejected;
        transfer.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        if (databaseTransaction is not null)
        {
            await databaseTransaction.CommitAsync(ct);
        }

        return new HourTransferMutationResult(Data: new Dictionary<string, object?>
        {
            ["success"] = true,
            ["status"] = StatusRejected
        });
    }

    public async Task<HourTransferMutationResult> ApproveAtSourceAsync(
        int tenantId,
        long transferId,
        int approverUserId,
        CancellationToken ct)
    {
        await using var databaseTransaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct)
            : null;
        if (databaseTransaction is not null)
        {
            await AcquireTransferLifecycleLockAsync(tenantId, transferId, ct);
        }

        var transfer = await FindSourceTransferAsync(tenantId, transferId, tracking: true, ct);
        if (transfer is null)
        {
            return SingleError("TRANSFER_FAILED", "Transfer not found.");
        }

        if (transfer.Status != StatusPending)
        {
            return SingleError("TRANSFER_FAILED", "Transfer is not pending and cannot be approved.");
        }

        var payerUserId = transfer.MemberUserId;
        if (databaseTransaction is not null)
        {
            await _personalWallet.AcquireSpendLockAsync(payerUserId, ct);
        }

        if (transfer.Status != StatusPending)
        {
            if (databaseTransaction is not null)
            {
                await databaseTransaction.RollbackAsync(ct);
            }
            return SingleError("TRANSFER_FAILED", "Transfer is not pending and cannot be approved.");
        }

        var sourceTenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        if (sourceTenant is null)
        {
            return SingleError("TRANSFER_FAILED", "Source cooperative not found.");
        }

        var sourceUser = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.TenantId == tenantId && u.Id == transfer.MemberUserId, ct);

        if (sourceUser is null)
        {
            return SingleError("TRANSFER_FAILED", "Source member not found.");
        }

        var destinationTenant = await _db.Tenants
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Slug == transfer.CounterpartTenantSlug, ct);

        if (destinationTenant is null)
        {
            return SingleError("TRANSFER_FAILED", "Destination cooperative no longer exists.");
        }

        var destinationUser = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.TenantId == destinationTenant.Id && u.Email == transfer.CounterpartMemberEmail, ct);

        if (destinationUser is null)
        {
            return SingleError("TRANSFER_FAILED", "No matching destination member - they may have removed their account.");
        }

        var hours = Math.Round(transfer.HoursTransferred, 2, MidpointRounding.AwayFromZero);
        if (!IsAcceptableHourAmount(hours))
        {
            return SingleError("TRANSFER_FAILED", "Transfer amount exceeds the permitted single-transfer limit.");
        }

        var balance = await _personalWallet.GetBalanceAsync(tenantId, transfer.MemberUserId, ct);
        if (balance < hours)
        {
            if (databaseTransaction is not null)
            {
                await databaseTransaction.RollbackAsync(ct);
            }
            return SingleError("TRANSFER_FAILED", "Source member no longer has enough banked hours.");
        }

        var now = DateTime.UtcNow;
        var payload = new SortedDictionary<string, object?>
        {
            ["source_tenant_slug"] = sourceTenant.Slug,
            ["destination_tenant_slug"] = destinationTenant.Slug,
            ["source_member_email"] = transfer.CounterpartMemberEmail,
            ["hours"] = hours,
            ["reason"] = transfer.Reason ?? string.Empty,
            ["transfer_id"] = transfer.Id,
            ["generated_at"] = now.ToString("O")
        };
        var payloadJson = JsonSerializer.Serialize(payload, JsonOptions);
        var signature = SignPayload(payloadJson);

        _db.Transactions.Add(new Transaction
        {
            TenantId = tenantId,
            SenderId = transfer.MemberUserId,
            ReceiverId = null,
            Amount = hours,
            Description = "[hour_transfer_out] " + (transfer.Reason ?? string.Empty),
            TransactionType = "other",
            Status = TransactionStatus.Completed,
            CreatedAt = now
        });

        var destinationTransfer = new CaringHourTransfer
        {
            TenantId = destinationTenant.Id,
            CounterpartTenantSlug = sourceTenant.Slug,
            Role = "destination",
            MemberUserId = destinationUser.Id,
            CounterpartMemberEmail = transfer.CounterpartMemberEmail,
            HoursTransferred = hours,
            Status = StatusCompleted,
            Reason = transfer.Reason,
            Signature = signature,
            PayloadJson = payloadJson,
            LinkedTransferId = transfer.Id,
            CreatedAt = now,
            UpdatedAt = now
        };
        _db.CaringHourTransfers.Add(destinationTransfer);

        _db.Transactions.Add(new Transaction
        {
            TenantId = destinationTenant.Id,
            SenderId = null,
            ReceiverId = destinationUser.Id,
            Amount = hours,
            Description = "[hour_transfer_in] from " + sourceTenant.Slug
                + (string.IsNullOrWhiteSpace(transfer.Reason) ? string.Empty : " - " + transfer.Reason),
            TransactionType = "other",
            Status = TransactionStatus.Completed,
            CreatedAt = now
        });

        transfer.Status = StatusCompleted;
        transfer.Signature = signature;
        transfer.PayloadJson = payloadJson;
        transfer.IsRemote = false;
        transfer.UpdatedAt = now;

        await _db.SaveChangesAsync(ct);

        transfer.LinkedTransferId = destinationTransfer.Id;
        transfer.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        if (databaseTransaction is not null)
        {
            await databaseTransaction.CommitAsync(ct);
        }

        return new HourTransferMutationResult(Data: new Dictionary<string, object?>
        {
            ["transfer_id"] = transfer.Id,
            ["status"] = StatusCompleted,
            ["destination_transfer_id"] = destinationTransfer.Id,
            ["remote"] = false,
            ["source_transaction_id"] = null,
            ["success"] = true
        });
    }

    private async Task<CaringHourTransfer?> FindSourceTransferAsync(
        int tenantId,
        long transferId,
        bool tracking,
        CancellationToken ct)
    {
        var query = _db.CaringHourTransfers
            .IgnoreQueryFilters()
            .Where(t => t.TenantId == tenantId && t.Id == transferId && t.Role == "source");

        if (!tracking)
        {
            query = query.AsNoTracking();
        }

        return await query.FirstOrDefaultAsync(ct);
    }

    private async Task AcquireTransferLifecycleLockAsync(
        int tenantId,
        long transferId,
        CancellationToken ct)
    {
        if (!_db.Database.IsRelational())
        {
            return;
        }

        var lockKey = unchecked((int)(transferId ^ ((long)tenantId << 32)));
        await _db.Database.ExecuteSqlRawAsync(
            "SELECT pg_advisory_xact_lock({0}, {1})",
            [-17004, lockKey],
            ct);
    }

    private async Task<decimal> GetBalanceAsync(int tenantId, int userId, CancellationToken ct)
    {
        var received = await _db.Transactions
            .IgnoreQueryFilters()
            .Where(t => t.TenantId == tenantId && t.ReceiverId == userId && t.Status == TransactionStatus.Completed)
            .SumAsync(t => t.Amount, ct);

        var sent = await _db.Transactions
            .IgnoreQueryFilters()
            .Where(t => t.TenantId == tenantId && t.SenderId == userId && t.Status == TransactionStatus.Completed)
            .SumAsync(t => t.Amount, ct);

        return Math.Round(received - sent, 2, MidpointRounding.AwayFromZero);
    }

    private async Task<IReadOnlyDictionary<int, User>> LoadUsersAsync(
        int tenantId,
        IEnumerable<int?> userIds,
        CancellationToken ct)
    {
        var ids = userIds
            .Where(id => id.HasValue && id.Value > 0)
            .Select(id => id!.Value)
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

    private static HourTransferHistoryRow MapHistory(CaringHourTransfer transfer)
    {
        return new HourTransferHistoryRow(
            Id: transfer.Id,
            DestinationTenantSlug: transfer.CounterpartTenantSlug,
            DestinationMemberEmail: transfer.CounterpartMemberEmail,
            Hours: transfer.HoursTransferred,
            Status: transfer.Status,
            Reason: transfer.Reason ?? string.Empty,
            CreatedAt: FormatDate(transfer.CreatedAt));
    }

    private static HourTransferPendingRow MapPending(
        CaringHourTransfer transfer,
        IReadOnlyDictionary<int, User> users)
    {
        users.TryGetValue(transfer.MemberUserId, out var user);

        return new HourTransferPendingRow(
            Id: transfer.Id,
            MemberUserId: transfer.MemberUserId,
            MemberName: DisplayName(user),
            MemberEmail: user?.Email ?? string.Empty,
            DestinationTenantSlug: transfer.CounterpartTenantSlug,
            DestinationMemberEmail: transfer.CounterpartMemberEmail,
            Hours: transfer.HoursTransferred,
            Status: transfer.Status,
            Reason: transfer.Reason ?? string.Empty,
            CreatedAt: FormatDate(transfer.CreatedAt));
    }

    private static HourTransferInboundRow MapInbound(
        CaringHourTransfer transfer,
        IReadOnlyDictionary<int, User> users)
    {
        users.TryGetValue(transfer.MemberUserId, out var user);

        return new HourTransferInboundRow(
            Id: transfer.Id,
            MemberUserId: transfer.MemberUserId,
            MemberName: DisplayName(user),
            MemberEmail: user?.Email ?? string.Empty,
            SourceTenantSlug: transfer.CounterpartTenantSlug,
            Hours: transfer.HoursTransferred,
            Status: transfer.Status,
            Reason: transfer.Reason ?? string.Empty,
            CreatedAt: FormatDate(transfer.CreatedAt));
    }

    private static HourTransferMutationResult SingleError(string code, string message, string? field = null)
    {
        return new HourTransferMutationResult(Errors: [new LaravelErrorRow(code, message, field)]);
    }

    private static bool IsAcceptableHourAmount(decimal hours)
    {
        return hours > 0
            && hours <= MaxSingleExternalCreditHours
            && decimal.Round(hours, 2, MidpointRounding.AwayFromZero) == hours;
    }

    private static string SignPayload(string canonicalJson)
    {
        var secret = Encoding.UTF8.GetBytes("nexus-dotnet-caring-hour-transfer");
        var bytes = Encoding.UTF8.GetBytes(canonicalJson);
        return Convert.ToHexString(HMACSHA256.HashData(secret, bytes)).ToLowerInvariant();
    }

    private static string? TrimToNull(string? value, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        return Trim(trimmed, maxLength);
    }

    private static string Trim(string value, int maxLength)
    {
        return value.Length <= maxLength ? value : value[..maxLength];
    }

    private static string DisplayName(User? user)
    {
        if (user is null)
        {
            return string.Empty;
        }

        return $"{user.FirstName} {user.LastName}".Trim();
    }

    private static string FormatDate(DateTime value)
    {
        return value.ToUniversalTime().ToString("O");
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

public sealed class CaringHourTransferInitiateRequest
{
    [JsonPropertyName("destination_tenant_slug")] public string? DestinationTenantSlug { get; set; }
    [JsonPropertyName("hours")] public decimal Hours { get; set; }
    [JsonPropertyName("reason")] public string? Reason { get; set; }
}

public sealed class CaringHourTransferRejectRequest
{
    [JsonPropertyName("reason")] public string? Reason { get; set; }
}

public sealed record HourTransferHistoryRow(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("destination_tenant_slug")] string DestinationTenantSlug,
    [property: JsonPropertyName("destination_member_email")] string DestinationMemberEmail,
    [property: JsonPropertyName("hours")] decimal Hours,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("reason")] string Reason,
    [property: JsonPropertyName("created_at")] string CreatedAt);

public sealed record HourTransferPendingRow(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("member_user_id")] int MemberUserId,
    [property: JsonPropertyName("member_name")] string MemberName,
    [property: JsonPropertyName("member_email")] string MemberEmail,
    [property: JsonPropertyName("destination_tenant_slug")] string DestinationTenantSlug,
    [property: JsonPropertyName("destination_member_email")] string DestinationMemberEmail,
    [property: JsonPropertyName("hours")] decimal Hours,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("reason")] string Reason,
    [property: JsonPropertyName("created_at")] string CreatedAt);

public sealed record HourTransferInboundRow(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("member_user_id")] int MemberUserId,
    [property: JsonPropertyName("member_name")] string MemberName,
    [property: JsonPropertyName("member_email")] string MemberEmail,
    [property: JsonPropertyName("source_tenant_slug")] string SourceTenantSlug,
    [property: JsonPropertyName("hours")] decimal Hours,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("reason")] string Reason,
    [property: JsonPropertyName("created_at")] string CreatedAt);

public sealed record HourTransferMutationResult(
    IReadOnlyDictionary<string, object?>? Data = null,
    IReadOnlyList<LaravelErrorRow>? Errors = null,
    int StatusCode = StatusCodes.Status200OK);
