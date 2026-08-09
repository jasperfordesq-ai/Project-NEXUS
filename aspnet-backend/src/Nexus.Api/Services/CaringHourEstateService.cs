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

public sealed class CaringHourEstateService
{
    private static readonly string[] PolicyActions =
    [
        "transfer_to_beneficiary",
        "donate_to_solidarity",
        "expire"
    ];

    private static readonly string[] AdminFilterStatuses =
    [
        "nominated",
        "reported",
        "settled",
        "cancelled"
    ];

    private readonly NexusDbContext _db;
    private readonly PersonalWalletLedgerService _personalWallet;

    public CaringHourEstateService(
        NexusDbContext db,
        PersonalWalletLedgerService personalWallet)
    {
        _db = db;
        _personalWallet = personalWallet;
    }

    public CaringHourEstateService(NexusDbContext db)
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

    public async Task<HourEstateRow> MyEstateAsync(int tenantId, int memberUserId, CancellationToken ct)
    {
        var estate = await _db.CaringHourEstates
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.TenantId == tenantId && e.MemberUserId == memberUserId, ct);

        if (estate is null)
        {
            return new HourEstateRow(
                Id: null,
                TenantId: tenantId,
                MemberUserId: memberUserId,
                MemberName: null,
                BeneficiaryUserId: null,
                BeneficiaryName: null,
                PolicyAction: null,
                Status: "not_set",
                ReportedBalanceHours: null,
                SettledHours: null,
                PolicyDocumentReference: null,
                MemberNotes: null,
                CoordinatorNotes: null,
                NominatedAt: null,
                ReportedDeceasedAt: null,
                SettledAt: null);
        }

        var users = await LoadUsersAsync(tenantId, [estate.MemberUserId, estate.BeneficiaryUserId], ct);
        return Map(estate, users);
    }

    public async Task<HourEstateMutationResult> NominateAsync(
        int tenantId,
        int memberUserId,
        HourEstateNominateRequest request,
        CancellationToken ct)
    {
        var policyAction = string.IsNullOrWhiteSpace(request.PolicyAction)
            ? "donate_to_solidarity"
            : request.PolicyAction.Trim();

        if (!IsAllowed(policyAction, PolicyActions))
        {
            return ValidationError("Legacy hour policy must be one of: transfer_to_beneficiary, donate_to_solidarity, expire.");
        }

        int? beneficiaryUserId = request.BeneficiaryUserId;
        if (policyAction == "transfer_to_beneficiary")
        {
            if (beneficiaryUserId is null or <= 0)
            {
                return ValidationError("A beneficiary is required when transferring legacy hours.");
            }

            if (beneficiaryUserId.Value == memberUserId)
            {
                return ValidationError("You cannot nominate yourself as the beneficiary.");
            }

            var beneficiaryExists = await _db.Users
                .IgnoreQueryFilters()
                .AnyAsync(u => u.TenantId == tenantId && u.Id == beneficiaryUserId.Value, ct);

            if (!beneficiaryExists)
            {
                return ValidationError("User not found.");
            }
        }
        else
        {
            beneficiaryUserId = null;
        }

        await using var databaseTransaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct)
            : null;
        if (databaseTransaction is not null)
        {
            await AcquireEstateLifecycleLockAsync(tenantId, memberUserId, ct);
        }

        var now = DateTime.UtcNow;
        var estate = await _db.CaringHourEstates
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(e => e.TenantId == tenantId && e.MemberUserId == memberUserId, ct);

        if (estate is null)
        {
            estate = new CaringHourEstate
            {
                TenantId = tenantId,
                MemberUserId = memberUserId,
                CreatedAt = now
            };
            _db.CaringHourEstates.Add(estate);
        }
        else if (estate.Status != "nominated")
        {
            return EstateFailed("This legacy hour estate can no longer be changed after it has been reported.");
        }

        if (beneficiaryUserId.HasValue)
        {
            var beneficiaryStillExists = await _db.Users
                .IgnoreQueryFilters()
                .AnyAsync(u => u.TenantId == tenantId && u.Id == beneficiaryUserId.Value, ct);
            if (!beneficiaryStillExists)
            {
                return ValidationError("User not found.");
            }
        }

        estate.BeneficiaryUserId = beneficiaryUserId;
        estate.PolicyAction = policyAction;
        estate.Status = "nominated";
        estate.PolicyDocumentReference = TrimToNull(request.PolicyDocumentReference, 255);
        estate.MemberNotes = TrimToNull(request.MemberNotes, 2000);
        estate.NominatedAt = now;
        estate.UpdatedAt = now;

        await _db.SaveChangesAsync(ct);
        if (databaseTransaction is not null)
        {
            await databaseTransaction.CommitAsync(ct);
        }
        return new HourEstateMutationResult(Row: await MyEstateAsync(tenantId, memberUserId, ct));
    }

    public async Task<IReadOnlyList<HourEstateRow>> ListEstatesAsync(
        int tenantId,
        string? status,
        CancellationToken ct)
    {
        var query = _db.CaringHourEstates
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(e => e.TenantId == tenantId);

        if (IsAllowed(status, AdminFilterStatuses))
        {
            query = query.Where(e => e.Status == status);
        }

        var estates = await query
            .OrderByDescending(e => e.UpdatedAt ?? e.CreatedAt)
            .ToListAsync(ct);

        var users = await LoadUsersAsync(
            tenantId,
            estates.SelectMany(e => new int?[] { e.MemberUserId, e.BeneficiaryUserId }),
            ct);

        return estates.Select(e => Map(e, users)).ToArray();
    }

    public async Task<HourEstateMutationResult> ReportDeceasedAsync(
        int tenantId,
        long estateId,
        int actorUserId,
        HourEstateAdminNotesRequest request,
        CancellationToken ct)
    {
        var memberUserId = await _db.CaringHourEstates
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(e => e.TenantId == tenantId && e.Id == estateId)
            .Select(e => (int?)e.MemberUserId)
            .SingleOrDefaultAsync(ct);
        if (!memberUserId.HasValue)
        {
            return EstateFailed("Legacy hour estate record not found.");
        }

        await using var databaseTransaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct)
            : null;
        if (databaseTransaction is not null)
        {
            await AcquireEstateLifecycleLockAsync(tenantId, memberUserId.Value, ct);
        }

        var estate = await FindTrackingAsync(tenantId, estateId, ct);
        if (estate is null)
        {
            return EstateFailed("Legacy hour estate record not found.");
        }

        if (estate.Status is not ("nominated" or "reported"))
        {
            return EstateFailed("This legacy hour estate cannot be reported in its current status.");
        }

        var now = DateTime.UtcNow;
        estate.Status = "reported";
        estate.ReportedBalanceHours = await GetRoundedBalanceAsync(tenantId, estate.MemberUserId, ct);
        estate.ReportedDeceasedAt = now;
        estate.ReportedBy = actorUserId;
        estate.CoordinatorNotes = TrimToNull(request.CoordinatorNotes, 2000);
        estate.UpdatedAt = now;

        await _db.SaveChangesAsync(ct);
        if (databaseTransaction is not null)
        {
            await databaseTransaction.CommitAsync(ct);
        }
        return new HourEstateMutationResult(Row: await MapByIdAsync(tenantId, estate.Id, ct));
    }

    public async Task<HourEstateMutationResult> SettleAsync(
        int tenantId,
        long estateId,
        int actorUserId,
        HourEstateAdminNotesRequest request,
        CancellationToken ct)
    {
        var payerUserId = await _db.CaringHourEstates
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(e => e.TenantId == tenantId && e.Id == estateId)
            .Select(e => (int?)e.MemberUserId)
            .SingleOrDefaultAsync(ct);
        if (!payerUserId.HasValue)
        {
            return EstateFailed("Legacy hour estate record not found.");
        }

        await using var databaseTransaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct)
            : null;
        if (databaseTransaction is not null)
        {
            await AcquireEstateLifecycleLockAsync(tenantId, payerUserId.Value, ct);
            await _personalWallet.AcquireSpendLockAsync(payerUserId.Value, ct);
        }

        var estate = await FindTrackingAsync(tenantId, estateId, ct);
        if (estate is null || estate.MemberUserId != payerUserId.Value)
        {
            return EstateFailed("Legacy hour estate record not found.");
        }

        if (estate.Status != "reported")
        {
            if (databaseTransaction is not null)
            {
                await databaseTransaction.RollbackAsync(ct);
            }
            return EstateFailed("This legacy hour estate must be reported before it can be settled.");
        }

        var memberExists = await _db.Users
            .IgnoreQueryFilters()
            .AnyAsync(u => u.TenantId == tenantId && u.Id == estate.MemberUserId, ct);
        if (!memberExists)
        {
            return EstateFailed("User not found.");
        }

        var hours = Math.Max(
            0m,
            Math.Round(
                await _personalWallet.GetBalanceAsync(tenantId, estate.MemberUserId, ct),
                2,
                MidpointRounding.AwayFromZero));
        var now = DateTime.UtcNow;

        if (hours > 0)
        {
            int? receiverId;
            if (estate.PolicyAction == "transfer_to_beneficiary")
            {
                if (estate.BeneficiaryUserId is null or <= 0)
                {
                    return EstateFailed("A beneficiary is required when transferring legacy hours.");
                }

                var beneficiaryExists = await _db.Users
                    .IgnoreQueryFilters()
                    .AnyAsync(u => u.TenantId == tenantId && u.Id == estate.BeneficiaryUserId.Value, ct);

                if (!beneficiaryExists)
                {
                    return EstateFailed("User not found.");
                }

                receiverId = estate.BeneficiaryUserId.Value;
            }
            else
            {
                receiverId = null;
            }

            var settlement = new Transaction
            {
                TenantId = tenantId,
                SenderId = estate.MemberUserId,
                ReceiverId = receiverId,
                Amount = hours,
                Description = "Legacy hour estate settlement",
                TransactionType = PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType,
                Status = TransactionStatus.Completed,
                CreatedAt = now
            };
            estate.SettlementTransaction = settlement;
            _db.Transactions.Add(settlement);
        }

        var notes = TrimToNull(request.CoordinatorNotes, 2000);
        estate.Status = "settled";
        estate.SettledHours = hours;
        estate.SettledAt = now;
        estate.SettledBy = actorUserId;
        estate.CoordinatorNotes = notes ?? estate.CoordinatorNotes;
        estate.UpdatedAt = now;

        await _db.SaveChangesAsync(ct);
        if (databaseTransaction is not null)
        {
            await databaseTransaction.CommitAsync(ct);
        }
        return new HourEstateMutationResult(Row: await MapByIdAsync(tenantId, estate.Id, ct));
    }

    private async Task AcquireEstateLifecycleLockAsync(
        int tenantId,
        int memberUserId,
        CancellationToken ct)
    {
        if (!_db.Database.IsRelational())
        {
            return;
        }

        var lockKey = unchecked((tenantId * 397) ^ memberUserId);
        await _db.Database.ExecuteSqlRawAsync(
            "SELECT pg_advisory_xact_lock({0}, {1})",
            [-17006, lockKey],
            ct);
    }

    private async Task<CaringHourEstate?> FindTrackingAsync(int tenantId, long estateId, CancellationToken ct)
    {
        return await _db.CaringHourEstates
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(e => e.TenantId == tenantId && e.Id == estateId, ct);
    }

    private async Task<HourEstateRow?> MapByIdAsync(int tenantId, long estateId, CancellationToken ct)
    {
        var estate = await _db.CaringHourEstates
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.TenantId == tenantId && e.Id == estateId, ct);

        if (estate is null)
        {
            return null;
        }

        var users = await LoadUsersAsync(tenantId, [estate.MemberUserId, estate.BeneficiaryUserId], ct);
        return Map(estate, users);
    }

    private async Task<decimal> GetRoundedBalanceAsync(int tenantId, int userId, CancellationToken ct)
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

    private static HourEstateRow Map(CaringHourEstate estate, IReadOnlyDictionary<int, User> users)
    {
        users.TryGetValue(estate.MemberUserId, out var member);
        User? beneficiary = null;
        if (estate.BeneficiaryUserId.HasValue)
        {
            users.TryGetValue(estate.BeneficiaryUserId.Value, out beneficiary);
        }

        return new HourEstateRow(
            Id: estate.Id,
            TenantId: estate.TenantId,
            MemberUserId: estate.MemberUserId,
            MemberName: DisplayName(member),
            BeneficiaryUserId: estate.BeneficiaryUserId,
            BeneficiaryName: DisplayName(beneficiary),
            PolicyAction: estate.PolicyAction,
            Status: estate.Status,
            ReportedBalanceHours: estate.ReportedBalanceHours,
            SettledHours: estate.SettledHours,
            PolicyDocumentReference: estate.PolicyDocumentReference,
            MemberNotes: estate.MemberNotes,
            CoordinatorNotes: estate.CoordinatorNotes,
            NominatedAt: FormatDate(estate.NominatedAt),
            ReportedDeceasedAt: FormatDate(estate.ReportedDeceasedAt),
            SettledAt: FormatDate(estate.SettledAt));
    }

    private static HourEstateMutationResult ValidationError(string message)
    {
        return SingleError("VALIDATION_ERROR", message);
    }

    private static HourEstateMutationResult EstateFailed(string message)
    {
        return SingleError("ESTATE_FAILED", message);
    }

    private static HourEstateMutationResult SingleError(string code, string message)
    {
        return new HourEstateMutationResult(Errors: [new LaravelErrorRow(code, message)]);
    }

    private static string? DisplayName(User? user)
    {
        if (user is null)
        {
            return null;
        }

        var fullName = $"{user.FirstName} {user.LastName}".Trim();
        return fullName.Length > 0 ? fullName : null;
    }

    private static string? TrimToNull(string? value, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }

    private static string? FormatDate(DateTime? value)
    {
        return value?.ToUniversalTime().ToString("O");
    }

    private static bool IsAllowed(string? value, IReadOnlyCollection<string> allowed)
    {
        return !string.IsNullOrWhiteSpace(value) && allowed.Contains(value, StringComparer.Ordinal);
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

public sealed class HourEstateNominateRequest
{
    [JsonPropertyName("policy_action")] public string? PolicyAction { get; set; }
    [JsonPropertyName("beneficiary_user_id")] public int? BeneficiaryUserId { get; set; }
    [JsonPropertyName("policy_document_reference")] public string? PolicyDocumentReference { get; set; }
    [JsonPropertyName("member_notes")] public string? MemberNotes { get; set; }
}

public sealed class HourEstateAdminNotesRequest
{
    [JsonPropertyName("coordinator_notes")] public string? CoordinatorNotes { get; set; }
}

public sealed record HourEstateRow(
    [property: JsonPropertyName("id")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    long? Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("member_user_id")] int MemberUserId,
    [property: JsonPropertyName("member_name")] string? MemberName,
    [property: JsonPropertyName("beneficiary_user_id")] int? BeneficiaryUserId,
    [property: JsonPropertyName("beneficiary_name")] string? BeneficiaryName,
    [property: JsonPropertyName("policy_action")] string? PolicyAction,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("reported_balance_hours")] decimal? ReportedBalanceHours,
    [property: JsonPropertyName("settled_hours")] decimal? SettledHours,
    [property: JsonPropertyName("policy_document_reference")] string? PolicyDocumentReference,
    [property: JsonPropertyName("member_notes")] string? MemberNotes,
    [property: JsonPropertyName("coordinator_notes")] string? CoordinatorNotes,
    [property: JsonPropertyName("nominated_at")] string? NominatedAt,
    [property: JsonPropertyName("reported_deceased_at")] string? ReportedDeceasedAt,
    [property: JsonPropertyName("settled_at")] string? SettledAt);

public sealed record HourEstateMutationResult(
    HourEstateRow? Row = null,
    IReadOnlyList<LaravelErrorRow>? Errors = null);
