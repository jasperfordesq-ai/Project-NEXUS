// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Owns the Laravel-compatible, QR-backed volunteer attendance lifecycle.
/// This service deliberately does not create volunteer logs, wallet
/// transactions, rewards, XP, or notifications: a QR scan is attendance
/// evidence only.
/// </summary>
public sealed class VolunteerAttendanceService
{
    public const string QrFeatureConfigKey = "volunteering.enable_qr_checkin";

    private static readonly HashSet<string> PlatformAdminRoles =
        new(StringComparer.Ordinal)
        {
            "admin",
            "tenant_admin",
            "tenant_super_admin",
            "super_admin",
            "god"
        };

    private readonly NexusDbContext _db;
    private readonly ILogger<VolunteerAttendanceService> _logger;

    public VolunteerAttendanceService(
        NexusDbContext db,
        ILogger<VolunteerAttendanceService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<VolunteerAttendanceResult<VolunteerPersonalAttendance>>
        GetOrCreatePersonalTokenAsync(
            int tenantId,
            int volunteerUserId,
            int shiftId,
            CancellationToken ct = default)
    {
        var gateError = await GetFeatureGateErrorAsync(tenantId, ct);
        if (gateError is not null)
        {
            return VolunteerAttendanceResult<VolunteerPersonalAttendance>.Failed(gateError);
        }

        await using var transaction = await BeginTransactionAsync(ct);
        try
        {
            if (!await LockShiftAsync(tenantId, shiftId, ct))
            {
                return VolunteerAttendanceResult<VolunteerPersonalAttendance>.Failed(
                    AttendanceErrors.NoCheckInAvailable);
            }

            var shift = await LoadShiftAsync(tenantId, shiftId, ct);
            if (shift?.Opportunity is null)
            {
                return VolunteerAttendanceResult<VolunteerPersonalAttendance>.Failed(
                    AttendanceErrors.NoCheckInAvailable);
            }

            if (!await HasCurrentApprovedAssignmentAsync(
                tenantId,
                shiftId,
                shift.OpportunityId,
                volunteerUserId,
                ct))
            {
                return VolunteerAttendanceResult<VolunteerPersonalAttendance>.Failed(
                    AttendanceErrors.NoCheckInAvailable);
            }

            var now = DateTime.UtcNow;
            var checkIn = await _db.VolunteerCheckIns
                .IgnoreQueryFilters()
                .SingleOrDefaultAsync(row =>
                    row.TenantId == tenantId
                    && row.ShiftId == shiftId
                    && row.UserId == volunteerUserId,
                    ct);

            if (checkIn is null)
            {
                checkIn = new VolunteerCheckIn
                {
                    TenantId = tenantId,
                    ShiftId = shiftId,
                    UserId = volunteerUserId,
                    QrToken = CreateToken(),
                    Status = "pending",
                    CreatedAt = now,
                    UpdatedAt = now
                };
                _db.VolunteerCheckIns.Add(checkIn);
            }
            else if (string.IsNullOrWhiteSpace(checkIn.QrToken))
            {
                // A historical, pre-QR attendance row may be adopted without
                // changing its attendance evidence.
                checkIn.QrToken = CreateToken();
                checkIn.Status = StatusFromEvidence(checkIn);
                checkIn.UpdatedAt = now;
            }

            await _db.SaveChangesAsync(ct);
            await CommitAsync(transaction, ct);

            return VolunteerAttendanceResult<VolunteerPersonalAttendance>.Succeeded(
                new(
                    checkIn.Id,
                    checkIn.QrToken!,
                    checkIn.Status,
                    checkIn.CheckedInAt,
                    checkIn.CheckedOutAt));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(
                exception,
                "Failed to create volunteer attendance token for user {UserId}, shift {ShiftId}, tenant {TenantId}",
                volunteerUserId,
                shiftId,
                tenantId);
            return VolunteerAttendanceResult<VolunteerPersonalAttendance>.Failed(
                AttendanceErrors.SaveFailed);
        }
    }

    public async Task<VolunteerAttendanceResult<VolunteerAttendanceVerification>> VerifyAsync(
        int tenantId,
        int coordinatorUserId,
        string token,
        CancellationToken ct = default)
    {
        var gateError = await GetFeatureGateErrorAsync(tenantId, ct);
        if (gateError is not null)
        {
            return VolunteerAttendanceResult<VolunteerAttendanceVerification>.Failed(gateError);
        }

        var normalizedToken = NormalizeToken(token);
        if (normalizedToken is null)
        {
            return VolunteerAttendanceResult<VolunteerAttendanceVerification>.Failed(
                AttendanceErrors.InvalidToken);
        }

        var shiftId = await ResolveShiftIdAsync(tenantId, normalizedToken, ct);
        if (!shiftId.HasValue)
        {
            return VolunteerAttendanceResult<VolunteerAttendanceVerification>.Failed(
                AttendanceErrors.InvalidToken);
        }

        await using var transaction = await BeginTransactionAsync(ct);
        try
        {
            if (!await LockShiftAsync(tenantId, shiftId.Value, ct))
            {
                return VolunteerAttendanceResult<VolunteerAttendanceVerification>.Failed(
                    AttendanceErrors.InvalidToken);
            }

            var shift = await LoadShiftAsync(tenantId, shiftId.Value, ct);
            if (shift?.Opportunity is null)
            {
                return VolunteerAttendanceResult<VolunteerAttendanceVerification>.Failed(
                    AttendanceErrors.InvalidToken);
            }

            var checkIn = await _db.VolunteerCheckIns
                .IgnoreQueryFilters()
                .SingleOrDefaultAsync(row =>
                    row.TenantId == tenantId
                    && row.ShiftId == shiftId.Value
                    && row.QrToken == normalizedToken,
                    ct);
            if (checkIn is null)
            {
                return VolunteerAttendanceResult<VolunteerAttendanceVerification>.Failed(
                    AttendanceErrors.InvalidToken);
            }

            if (!await CanCoordinateAsync(
                tenantId,
                coordinatorUserId,
                shift.Opportunity!.VolunteerOrganisationId,
                ct))
            {
                return VolunteerAttendanceResult<VolunteerAttendanceVerification>.Failed(
                    AttendanceErrors.CannotVerify);
            }

            var now = DateTime.UtcNow;
            var windowError = ValidateWindow(shift, now);
            if (windowError is not null)
            {
                return VolunteerAttendanceResult<VolunteerAttendanceVerification>.Failed(
                    AttendanceErrors.VerificationFailed);
            }

            var responseStatus = checkIn.Status == "checked_in"
                ? "already_checked_in"
                : "checked_in";
            if (checkIn.Status == "checked_out")
            {
                return VolunteerAttendanceResult<VolunteerAttendanceVerification>.Failed(
                    AttendanceErrors.VerificationFailed);
            }

            if (checkIn.Status != "checked_in")
            {
                checkIn.Status = "checked_in";
                checkIn.CheckedInAt = now;
                checkIn.CheckedInById = coordinatorUserId;
                checkIn.UpdatedAt = now;
                await _db.SaveChangesAsync(ct);
            }

            var user = await LoadUserViewAsync(tenantId, checkIn.UserId, ct);
            if (user is null)
            {
                return VolunteerAttendanceResult<VolunteerAttendanceVerification>.Failed(
                    AttendanceErrors.VerificationFailed);
            }

            await CommitAsync(transaction, ct);
            return VolunteerAttendanceResult<VolunteerAttendanceVerification>.Succeeded(
                new(
                    responseStatus,
                    checkIn.CheckedInAt,
                    user,
                    new(shift.Id, shift.StartsAt, shift.EndsAt)));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(
                exception,
                "Failed to verify volunteer attendance token in tenant {TenantId}",
                tenantId);
            return VolunteerAttendanceResult<VolunteerAttendanceVerification>.Failed(
                AttendanceErrors.Unexpected);
        }
    }

    public async Task<VolunteerAttendanceResult<VolunteerAttendanceCheckout>> CheckOutAsync(
        int tenantId,
        int coordinatorUserId,
        string token,
        CancellationToken ct = default)
    {
        var gateError = await GetFeatureGateErrorAsync(tenantId, ct);
        if (gateError is not null)
        {
            return VolunteerAttendanceResult<VolunteerAttendanceCheckout>.Failed(gateError);
        }

        var normalizedToken = NormalizeToken(token);
        if (normalizedToken is null)
        {
            return VolunteerAttendanceResult<VolunteerAttendanceCheckout>.Failed(
                AttendanceErrors.InvalidToken);
        }

        var shiftId = await ResolveShiftIdAsync(tenantId, normalizedToken, ct);
        if (!shiftId.HasValue)
        {
            return VolunteerAttendanceResult<VolunteerAttendanceCheckout>.Failed(
                AttendanceErrors.InvalidToken);
        }

        await using var transaction = await BeginTransactionAsync(ct);
        try
        {
            if (!await LockShiftAsync(tenantId, shiftId.Value, ct))
            {
                return VolunteerAttendanceResult<VolunteerAttendanceCheckout>.Failed(
                    AttendanceErrors.InvalidToken);
            }

            var shift = await LoadShiftAsync(tenantId, shiftId.Value, ct);
            if (shift?.Opportunity is null)
            {
                return VolunteerAttendanceResult<VolunteerAttendanceCheckout>.Failed(
                    AttendanceErrors.InvalidToken);
            }

            var checkIn = await _db.VolunteerCheckIns
                .IgnoreQueryFilters()
                .SingleOrDefaultAsync(row =>
                    row.TenantId == tenantId
                    && row.ShiftId == shiftId.Value
                    && row.QrToken == normalizedToken,
                    ct);
            if (checkIn is null)
            {
                return VolunteerAttendanceResult<VolunteerAttendanceCheckout>.Failed(
                    AttendanceErrors.InvalidToken);
            }

            if (!await CanCoordinateAsync(
                tenantId,
                coordinatorUserId,
                shift.Opportunity!.VolunteerOrganisationId,
                ct))
            {
                return VolunteerAttendanceResult<VolunteerAttendanceCheckout>.Failed(
                    AttendanceErrors.CannotCheckOut);
            }

            if (checkIn.Status != "checked_in" || !checkIn.CheckedInAt.HasValue)
            {
                return VolunteerAttendanceResult<VolunteerAttendanceCheckout>.Failed(
                    AttendanceErrors.NotCheckedIn);
            }

            // The shift lock and this state transition make checkout
            // single-winner. No hours, credits, or rewards are inferred here.
            var now = DateTime.UtcNow;
            checkIn.Status = "checked_out";
            checkIn.CheckedOutAt = now;
            checkIn.CheckedOutById = coordinatorUserId;
            checkIn.UpdatedAt = now;
            await _db.SaveChangesAsync(ct);
            await CommitAsync(transaction, ct);

            return VolunteerAttendanceResult<VolunteerAttendanceCheckout>.Succeeded(
                new("Successfully checked out"));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(
                exception,
                "Failed to check out volunteer attendance token in tenant {TenantId}",
                tenantId);
            return VolunteerAttendanceResult<VolunteerAttendanceCheckout>.Failed(
                AttendanceErrors.Unexpected);
        }
    }

    public async Task<VolunteerAttendanceResult<IReadOnlyList<VolunteerAttendanceRosterEntry>>>
        GetRosterAsync(
            int tenantId,
            int coordinatorUserId,
            int shiftId,
            CancellationToken ct = default)
    {
        var gateError = await GetFeatureGateErrorAsync(tenantId, ct);
        if (gateError is not null)
        {
            return VolunteerAttendanceResult<IReadOnlyList<VolunteerAttendanceRosterEntry>>.Failed(
                gateError);
        }

        await using var transaction = await BeginTransactionAsync(ct);
        try
        {
            if (!await LockShiftAsync(tenantId, shiftId, ct))
            {
                return VolunteerAttendanceResult<IReadOnlyList<VolunteerAttendanceRosterEntry>>.Failed(
                    AttendanceErrors.CannotViewRoster);
            }

            var shift = await LoadShiftAsync(tenantId, shiftId, ct);
            if (shift?.Opportunity is null)
            {
                return VolunteerAttendanceResult<IReadOnlyList<VolunteerAttendanceRosterEntry>>.Failed(
                    AttendanceErrors.CannotViewRoster);
            }

            if (!await CanCoordinateAsync(
                tenantId,
                coordinatorUserId,
                shift!.Opportunity!.VolunteerOrganisationId,
                ct))
            {
                return VolunteerAttendanceResult<IReadOnlyList<VolunteerAttendanceRosterEntry>>.Failed(
                    AttendanceErrors.CannotViewRoster);
            }

            // Deliberately project only the Laravel roster fields. Tokens and
            // email addresses never leave the volunteer's personal endpoint.
            var entries = await (
                from checkIn in _db.VolunteerCheckIns.IgnoreQueryFilters().AsNoTracking()
                join user in _db.Users.IgnoreQueryFilters().AsNoTracking()
                    on new { checkIn.TenantId, Id = checkIn.UserId }
                    equals new { user.TenantId, user.Id }
                where checkIn.TenantId == tenantId
                    && checkIn.ShiftId == shiftId
                orderby checkIn.CreatedAt, checkIn.Id
                select new VolunteerAttendanceRosterEntry(
                    checkIn.Id,
                    new VolunteerAttendanceUser(
                        user.Id,
                        (user.FirstName + " " + user.LastName).Trim(),
                        user.AvatarUrl),
                    checkIn.Status,
                    checkIn.CheckedInAt,
                    checkIn.CheckedOutAt))
                .ToListAsync(ct);

            await CommitAsync(transaction, ct);
            return VolunteerAttendanceResult<IReadOnlyList<VolunteerAttendanceRosterEntry>>.Succeeded(
                entries);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(
                exception,
                "Failed to read volunteer attendance roster for shift {ShiftId}, tenant {TenantId}",
                shiftId,
                tenantId);
            return VolunteerAttendanceResult<IReadOnlyList<VolunteerAttendanceRosterEntry>>.Failed(
                AttendanceErrors.Unexpected);
        }
    }

    private async Task<VolunteerAttendanceError?> GetFeatureGateErrorAsync(
        int tenantId,
        CancellationToken ct)
    {
        var values = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config => config.TenantId == tenantId
                && (config.Key == AdminVolunteerApprovalService.FeatureConfigKey
                    || config.Key == QrFeatureConfigKey))
            .OrderBy(config => config.Id)
            .Select(config => new { config.Key, config.Value })
            .ToListAsync(ct);

        var volunteering = values.LastOrDefault(row =>
            row.Key == AdminVolunteerApprovalService.FeatureConfigKey)?.Value;
        if (!IsEnabled(volunteering))
        {
            return AttendanceErrors.VolunteeringDisabled;
        }

        var qrCheckIn = values.LastOrDefault(row => row.Key == QrFeatureConfigKey)?.Value;
        return IsEnabled(qrCheckIn) ? null : AttendanceErrors.QrDisabled;
    }

    private async Task<VolunteerShift?> LoadShiftAsync(
        int tenantId,
        int shiftId,
        CancellationToken ct) =>
        await _db.VolunteerShifts
            .IgnoreQueryFilters()
            .Include(shift => shift.Opportunity)
            .SingleOrDefaultAsync(shift =>
                shift.Id == shiftId && shift.TenantId == tenantId,
                ct);

    private async Task<bool> HasCurrentApprovedAssignmentAsync(
        int tenantId,
        int shiftId,
        int opportunityId,
        int volunteerUserId,
        CancellationToken ct)
    {
        if (!_db.Database.IsRelational())
        {
            return await _db.VolunteerApplications
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(application =>
                    application.TenantId == tenantId
                    && application.OpportunityId == opportunityId
                    && application.ShiftId == shiftId
                    && application.UserId == volunteerUserId
                    && application.Status == ApplicationStatus.Approved,
                    ct);
        }

        var connection = _db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText =
            "SELECT \"Id\" FROM volunteer_applications "
            + "WHERE \"TenantId\" = @tenant_id "
            + "AND \"OpportunityId\" = @opportunity_id "
            + "AND \"ShiftId\" = @shift_id "
            + "AND \"UserId\" = @user_id "
            + "AND \"Status\" = 'Approved' "
            + "ORDER BY \"Id\" FOR UPDATE";

        AddParameter(command, "tenant_id", tenantId);
        AddParameter(command, "opportunity_id", opportunityId);
        AddParameter(command, "shift_id", shiftId);
        AddParameter(command, "user_id", volunteerUserId);

        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct);
    }

    private async Task<bool> CanCoordinateAsync(
        int tenantId,
        int coordinatorUserId,
        int? volunteerOrganisationId,
        CancellationToken ct)
    {
        // Laravel resolves the volunteering organisation before evaluating any
        // actor role. An opportunity without a tenant-owned organisation is not
        // manageable even by a platform administrator.
        if (!volunteerOrganisationId.HasValue
            || !await _db.VolunteerOrganisations
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(organisation =>
                    organisation.TenantId == tenantId
                    && organisation.Id == volunteerOrganisationId.Value,
                    ct))
        {
            return false;
        }

        var actor = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user =>
                user.Id == coordinatorUserId
                && user.TenantId == tenantId
                && user.IsActive)
            .Select(user => new
            {
                user.Role,
                user.IsAdmin,
                user.IsSuperAdmin,
                user.IsTenantSuperAdmin,
                user.IsGod
            })
            .SingleOrDefaultAsync(ct);
        if (actor is null)
        {
            return false;
        }

        if (actor.IsAdmin
            || actor.IsSuperAdmin
            || actor.IsTenantSuperAdmin
            || actor.IsGod
            || PlatformAdminRoles.Contains(actor.Role))
        {
            return true;
        }

        var directOwner = await _db.VolunteerOrganisations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(organisation =>
                organisation.TenantId == tenantId
                && organisation.Id == volunteerOrganisationId.Value
                && organisation.OwnerUserId == coordinatorUserId,
                ct);
        if (directOwner)
        {
            return true;
        }

        return await _db.VolunteerOrganisationMembers
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(member =>
                member.TenantId == tenantId
                && member.VolunteerOrganisationId == volunteerOrganisationId.Value
                && member.OrgType == "volunteer"
                && member.UserId == coordinatorUserId
                && member.Status == "active"
                && (member.Role == "owner"
                    || member.Role == "admin"
                    || member.Role == "manager"
                    || member.Role == "coordinator"),
                ct);
    }

    private async Task<VolunteerAttendanceUser?> LoadUserViewAsync(
        int tenantId,
        int userId,
        CancellationToken ct) =>
        await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.TenantId == tenantId && user.Id == userId)
            .Select(user => new VolunteerAttendanceUser(
                user.Id,
                (user.FirstName + " " + user.LastName).Trim(),
                user.AvatarUrl))
            .SingleOrDefaultAsync(ct);

    private Task<int?> ResolveShiftIdAsync(
        int tenantId,
        string token,
        CancellationToken ct) =>
        _db.VolunteerCheckIns
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.QrToken == token)
            .Select(row => (int?)row.ShiftId)
            .SingleOrDefaultAsync(ct);

    private async Task<IDbContextTransaction?> BeginTransactionAsync(CancellationToken ct) =>
        _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct)
            : null;

    private static async Task CommitAsync(
        IDbContextTransaction? transaction,
        CancellationToken ct)
    {
        if (transaction is not null)
        {
            await transaction.CommitAsync(ct);
        }
    }

    private async Task<bool> LockShiftAsync(
        int tenantId,
        int shiftId,
        CancellationToken ct)
    {
        if (!_db.Database.IsRelational())
        {
            return await _db.VolunteerShifts
                .IgnoreQueryFilters()
                .AnyAsync(shift => shift.Id == shiftId && shift.TenantId == tenantId, ct);
        }

        var connection = _db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText =
            "SELECT \"Id\" FROM volunteer_shifts "
            + "WHERE \"TenantId\" = @tenant_id AND \"Id\" = @shift_id FOR UPDATE";

        AddParameter(command, "tenant_id", tenantId);
        AddParameter(command, "shift_id", shiftId);

        var lockedId = await command.ExecuteScalarAsync(ct);
        if (lockedId is null || lockedId is DBNull)
        {
            return false;
        }

        // Attendance writers share a tenant/shift advisory namespace in
        // addition to the row lock used by signup and assignment writers.
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock({tenantId}, {shiftId})",
            ct);
        return true;
    }

    private static void AddParameter(
        System.Data.Common.DbCommand command,
        string name,
        object value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }

    private static VolunteerAttendanceError? ValidateWindow(
        VolunteerShift shift,
        DateTime now)
    {
        var earliest = shift.StartsAt.AddMinutes(-30);
        if (now < earliest)
        {
            return new(
                StatusCodes.Status400BadRequest,
                "VALIDATION_ERROR",
                $"Check-in is not yet available. Shift starts at {FormatUtc(shift.StartsAt)}");
        }

        var latest = shift.EndsAt > shift.StartsAt
            ? shift.EndsAt.AddHours(4)
            : shift.StartsAt.AddHours(24);
        return now > latest
            ? new(
                StatusCodes.Status400BadRequest,
                "VALIDATION_ERROR",
                $"Check-in is no longer available for this shift. The check-in window closed at {FormatUtc(latest)}")
            : null;
    }

    private static string StatusFromEvidence(VolunteerCheckIn row) =>
        row.Status == "no_show"
            ? "no_show"
            : row.CheckedOutAt.HasValue
                ? "checked_out"
                : row.CheckedInAt.HasValue
                    ? "checked_in"
                    : "pending";

    private static string CreateToken() =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();

    private static string? NormalizeToken(string token)
    {
        if (token is null || token.Length != 64)
        {
            return null;
        }

        return token.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f')
            ? token
            : null;
    }

    private static bool IsEnabled(string? raw) =>
        string.IsNullOrWhiteSpace(raw)
        || raw.Trim().Trim('"').ToLowerInvariant()
            is not ("0" or "false" or "no" or "off" or "disabled");

    private static string FormatUtc(DateTime value) =>
        value.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
}

public sealed record VolunteerPersonalAttendance(
    int Id,
    string QrToken,
    string Status,
    DateTime? CheckedInAt,
    DateTime? CheckedOutAt);

public sealed record VolunteerAttendanceUser(int Id, string Name, string? AvatarUrl);

public sealed record VolunteerAttendanceShift(int Id, DateTime StartsAt, DateTime EndsAt);

public sealed record VolunteerAttendanceVerification(
    string Status,
    DateTime? CheckedInAt,
    VolunteerAttendanceUser User,
    VolunteerAttendanceShift Shift);

public sealed record VolunteerAttendanceCheckout(string Message);

public sealed record VolunteerAttendanceRosterEntry(
    int Id,
    VolunteerAttendanceUser User,
    string Status,
    DateTime? CheckedInAt,
    DateTime? CheckedOutAt);

public sealed record VolunteerAttendanceError(
    int StatusCode,
    string Code,
    string Message,
    string? Field = null);

public sealed record VolunteerAttendanceResult<T>(T? Value, VolunteerAttendanceError? Error)
{
    public bool IsSuccess => Error is null;

    public static VolunteerAttendanceResult<T> Succeeded(T value) => new(value, null);
    public static VolunteerAttendanceResult<T> Failed(VolunteerAttendanceError error) => new(default, error);
}

internal static class AttendanceErrors
{
    public static readonly VolunteerAttendanceError VolunteeringDisabled = new(
        StatusCodes.Status403Forbidden,
        "FEATURE_DISABLED",
        "Volunteering module is not enabled for this community");

    public static readonly VolunteerAttendanceError QrDisabled = new(
        StatusCodes.Status403Forbidden,
        "FEATURE_DISABLED",
        "This module is not enabled for this community.");

    public static readonly VolunteerAttendanceError NoCheckInAvailable = new(
        StatusCodes.Status404NotFound,
        "NOT_FOUND",
        "No check-in available for this shift");

    public static readonly VolunteerAttendanceError InvalidToken = new(
        StatusCodes.Status404NotFound,
        "NOT_FOUND",
        "Invalid check-in code");

    public static readonly VolunteerAttendanceError VerificationFailed = new(
        StatusCodes.Status404NotFound,
        "NOT_FOUND",
        "Check-in not found or already completed");

    public static readonly VolunteerAttendanceError ShiftNotFound = new(
        StatusCodes.Status404NotFound,
        "NOT_FOUND",
        "Shift not found");

    public static readonly VolunteerAttendanceError ShiftCancelled = new(
        StatusCodes.Status400BadRequest,
        "VALIDATION_ERROR",
        "This shift has been cancelled");

    public static readonly VolunteerAttendanceError ShiftCompleted = new(
        StatusCodes.Status400BadRequest,
        "VALIDATION_ERROR",
        "This shift has already been completed");

    public static readonly VolunteerAttendanceError AssignmentNoLongerCurrent = new(
        StatusCodes.Status404NotFound,
        "NOT_FOUND",
        "Check-in not found or already completed");

    public static readonly VolunteerAttendanceError CannotVerify = new(
        StatusCodes.Status403Forbidden,
        "FORBIDDEN",
        "You do not have permission to verify check-ins for this shift");

    public static readonly VolunteerAttendanceError CannotCheckOut = new(
        StatusCodes.Status403Forbidden,
        "FORBIDDEN",
        "You do not have permission to check out volunteers for this shift");

    public static readonly VolunteerAttendanceError CannotViewRoster = new(
        StatusCodes.Status403Forbidden,
        "FORBIDDEN",
        "You do not have permission to view check-ins for this shift");

    public static readonly VolunteerAttendanceError AlreadyCheckedOut = new(
        StatusCodes.Status400BadRequest,
        "VALIDATION_ERROR",
        "Volunteer has already checked out.");

    public static readonly VolunteerAttendanceError NotCheckedIn = new(
        StatusCodes.Status400BadRequest,
        "VALIDATION_ERROR",
        "Volunteer is not currently checked in.");

    public static readonly VolunteerAttendanceError NotPending = new(
        StatusCodes.Status400BadRequest,
        "VALIDATION_ERROR",
        "Check-in is not available for this attendance record.");

    public static readonly VolunteerAttendanceError SaveFailed = new(
        StatusCodes.Status500InternalServerError,
        "SERVER_ERROR",
        "Failed to save volunteer check-in");

    public static readonly VolunteerAttendanceError Unexpected = new(
        StatusCodes.Status500InternalServerError,
        "INTERNAL_ERROR",
        "An unexpected error occurred.");
}
