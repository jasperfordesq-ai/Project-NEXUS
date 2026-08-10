// Copyright © 2024–2026 Jasper Ford
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

public sealed record RecurringPatternView(
    int Id,
    int OpportunityId,
    string? Title,
    string Frequency,
    JsonElement DaysOfWeek,
    TimeSpan StartTime,
    TimeSpan EndTime,
    int SpotsPerShift,
    int Capacity,
    DateOnly StartDate,
    DateOnly? EndDate,
    int? MaxOccurrences,
    int OccurrencesGenerated,
    bool IsActive,
    int CreatedBy,
    string? CreatedByName,
    DateTime CreatedAt,
    DateTime? UpdatedAt);

public sealed class RecurringPatternContractException : Exception
{
    public RecurringPatternContractException(string code, string message) : base(message)
    {
        Code = code;
    }

    public string Code { get; }
}

public record SwapRequest(
    [property: JsonPropertyName("from_shift_id")]
    int FromShiftId,
    [property: JsonPropertyName("to_shift_id")]
    int? ToShiftId,
    [property: JsonPropertyName("to_user_id")]
    int? ToUserId,
    [property: JsonPropertyName("message")]
    string? Message);

public record GroupReservationRequest(
    [property: JsonPropertyName("group_id")]
    int GroupId,
    [property: JsonPropertyName("reserved_slots")]
    int ReservedSlots,
    [property: JsonPropertyName("notes")]
    string? Notes);

public record AddGroupMemberRequest([property: JsonPropertyName("user_id")] int UserId);

public sealed record WaitlistListItem(
    int Id,
    int Position,
    string Status,
    DateTime? NotifiedAt,
    DateTime JoinedAt,
    WaitlistShiftItem Shift,
    WaitlistOpportunityItem Opportunity);

public sealed record WaitlistShiftItem(int Id, DateTime StartsAt, DateTime EndsAt, int? Capacity);
public sealed record WaitlistOpportunityItem(int Id, string Title, string Location);

public sealed record GroupReservationListItem(
    int Id,
    string GroupName,
    string Status,
    bool IsLeader,
    GroupReservationShiftItem Shift,
    GroupReservationOpportunityItem Opportunity,
    IReadOnlyList<GroupReservationMemberItem> Members,
    int MaxMembers,
    DateTime CreatedAt);

public sealed record GroupReservationShiftItem(int Id, DateTime StartsAt, DateTime EndsAt);
public sealed record GroupReservationOpportunityItem(int Id, string Title, string Location);
public sealed record GroupReservationMemberItem(
    int Id,
    string Name,
    string? AvatarUrl,
    string Status,
    DateTime CreatedAt);

public sealed record RecurringShiftGenerationResult(int Processed, int Generated, int Errors);

public class ShiftManagementService
{
    public const string RecurringShiftsEnabledConfigKey = "volunteering.enable_recurring_shifts";
    public const string SwapRequiresAdminConfigKey = "volunteering.swap_requires_admin";
    private const string VolunteeringModuleConfigKey = "admin_explicit.module_config.volunteering";
    private static readonly HashSet<string> ValidRecurringFrequencies =
        new(StringComparer.Ordinal) { "daily", "weekly", "biweekly", "monthly" };

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;
    private readonly ILogger<ShiftManagementService> _logger;
    private readonly VolunteerGuardianConsentService _guardianConsent;
    private readonly VolunteerOrganisationService _volunteerOrganisations;
    private readonly PushNotificationService? _pushNotifications;
    private readonly EmailNotificationService? _emailNotifications;

    public ShiftManagementService(
        NexusDbContext db,
        TenantContext tenant,
        ILogger<ShiftManagementService> logger,
        VolunteerGuardianConsentService guardianConsent,
        VolunteerOrganisationService volunteerOrganisations,
        PushNotificationService? pushNotifications = null,
        EmailNotificationService? emailNotifications = null)
    {
        _db = db;
        _tenant = tenant;
        _logger = logger;
        _guardianConsent = guardianConsent;
        _volunteerOrganisations = volunteerOrganisations;
        _pushNotifications = pushNotifications;
        _emailNotifications = emailNotifications;
    }

    // ── Recurring Patterns ────────────────────────────────────────────────────

    public async Task<IReadOnlyList<RecurringPatternView>> GetPatternsAsync(
        int opportunityId,
        CancellationToken ct = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        try
        {
            var patterns = await _db.RecurringShiftPatterns
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(pattern =>
                    pattern.TenantId == tenantId
                    && pattern.OpportunityId == opportunityId)
                .OrderByDescending(pattern => pattern.CreatedAt)
                .ThenByDescending(pattern => pattern.Id)
                .ToListAsync(ct);

            return await ToRecurringPatternViewsAsync(patterns, tenantId, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(
                exception,
                "Recurring shift pattern list failed for opportunity {OpportunityId} in tenant {TenantId}",
                opportunityId,
                tenantId);
            throw new RecurringPatternContractException(
                "SERVER_ERROR",
                "An internal error occurred");
        }
    }

    public async Task<RecurringPatternView> CreatePatternAsync(
        int opportunityId,
        int userId,
        JsonElement body,
        CancellationToken ct = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        await EnsureCanManageOpportunityAsync(
            opportunityId,
            userId,
            tenantId,
            "Opportunity not found",
            ct);

        EnsureObject(body);
        var frequency = ReadString(body, "frequency") ?? "weekly";
        if (!ValidRecurringFrequencies.Contains(frequency))
        {
            throw new RecurringPatternContractException("VALIDATION_ERROR", "Invalid frequency");
        }

        var startTimeText = ReadString(body, "start_time");
        var endTimeText = ReadString(body, "end_time");
        if (string.IsNullOrWhiteSpace(startTimeText)
            || string.IsNullOrWhiteSpace(endTimeText)
            || startTimeText == "0"
            || endTimeText == "0"
            || !TimeSpan.TryParse(startTimeText, CultureInfo.InvariantCulture, out var startTime)
            || !TimeSpan.TryParse(endTimeText, CultureInfo.InvariantCulture, out var endTime))
        {
            throw new RecurringPatternContractException("VALIDATION_ERROR", "Invalid input");
        }

        var startDate = DateOnly.FromDateTime(DateTime.UtcNow);
        if (TryGetProperty(body, "start_date", out var startDateElement)
            && startDateElement.ValueKind is not JsonValueKind.Null)
        {
            if (!DateOnly.TryParse(
                    ToPhpString(startDateElement),
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None,
                    out startDate))
            {
                throw new RecurringPatternContractException(
                    "SERVER_ERROR",
                    "An internal error occurred");
            }
        }

        var endDate = ReadNullableDate(body, "end_date");
        var capacity = ReadCreateInteger(body, "capacity", 1);
        var maxOccurrences = ReadCreateNullableInteger(body, "max_occurrences");
        if (capacity < 0 || maxOccurrences < 0)
        {
            throw new RecurringPatternContractException(
                "SERVER_ERROR",
                "An internal error occurred");
        }

        var now = DateTime.UtcNow;
        var pattern = new RecurringShiftPattern
        {
            TenantId = tenantId,
            OpportunityId = opportunityId,
            CreatedBy = userId,
            Title = ReadString(body, "title"),
            Frequency = frequency,
            DaysOfWeek = ReadDaysOfWeekStorage(body),
            StartTime = startTime,
            EndTime = endTime,
            SpotsPerShift = 1,
            Capacity = capacity,
            StartDate = startDate,
            EndDate = endDate,
            MaxOccurrences = maxOccurrences,
            OccurrencesGenerated = 0,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now
        };

        try
        {
            _db.RecurringShiftPatterns.Add(pattern);
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogError(
                exception,
                "Recurring shift pattern creation failed for opportunity {OpportunityId} in tenant {TenantId}",
                opportunityId,
                tenantId);
            throw new RecurringPatternContractException(
                "SERVER_ERROR",
                "An internal error occurred");
        }

        return await ToRecurringPatternViewAsync(pattern, tenantId, ct);
    }

    public async Task<RecurringPatternView> UpdatePatternAsync(
        int patternId,
        int userId,
        JsonElement body,
        CancellationToken ct = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var pattern = await _db.RecurringShiftPatterns
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(candidate =>
                candidate.Id == patternId
                && candidate.TenantId == tenantId,
                ct)
            ?? throw new RecurringPatternContractException("NOT_FOUND", "Not found");

        await EnsureCanManageOpportunityAsync(
            pattern.OpportunityId,
            userId,
            tenantId,
            null,
            ct);
        EnsureObject(body);

        var touchedAllowedField = false;
        if (TryGetProperty(body, "title", out var titleElement))
        {
            var title = ToNullablePhpString(titleElement);
            touchedAllowedField = true;
            pattern.Title = title;
        }

        if (TryGetProperty(body, "frequency", out var frequencyElement))
        {
            var frequency = ToNullablePhpString(frequencyElement);
            if (frequency is null || !ValidRecurringFrequencies.Contains(frequency))
            {
                throw new RecurringPatternContractException("VALIDATION_ERROR", "Invalid frequency");
            }

            touchedAllowedField = true;
            pattern.Frequency = frequency;
        }

        if (TryGetProperty(body, "start_time", out var startTimeElement))
        {
            var startTime = ParseRequiredTime(startTimeElement);
            touchedAllowedField = true;
            pattern.StartTime = startTime;
        }

        if (TryGetProperty(body, "end_time", out var endTimeElement))
        {
            var endTime = ParseRequiredTime(endTimeElement);
            touchedAllowedField = true;
            pattern.EndTime = endTime;
        }

        if (TryGetProperty(body, "spots_per_shift", out var spotsElement))
        {
            var spots = ToPhpInteger(spotsElement);
            if (spots < 0)
            {
                throw new RecurringPatternContractException(
                    "SERVER_ERROR",
                    "An internal error occurred");
            }

            touchedAllowedField = true;
            pattern.SpotsPerShift = spots;
        }

        if (TryGetProperty(body, "capacity", out var capacityElement))
        {
            var capacity = ToPhpInteger(capacityElement);
            if (capacity < 0)
            {
                throw new RecurringPatternContractException(
                    "SERVER_ERROR",
                    "An internal error occurred");
            }

            touchedAllowedField = true;
            pattern.Capacity = capacity;
        }

        if (TryGetProperty(body, "start_date", out var updateStartDateElement))
        {
            if (updateStartDateElement.ValueKind == JsonValueKind.Null
                || !DateOnly.TryParse(
                    ToPhpString(updateStartDateElement),
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None,
                    out var updateStartDate))
            {
                throw new RecurringPatternContractException(
                    "SERVER_ERROR",
                    "An internal error occurred");
            }

            touchedAllowedField = true;
            pattern.StartDate = updateStartDate;
        }

        if (TryGetProperty(body, "end_date", out var updateEndDateElement))
        {
            DateOnly? updateEndDate = null;
            if (updateEndDateElement.ValueKind != JsonValueKind.Null)
            {
                if (!DateOnly.TryParse(
                    ToPhpString(updateEndDateElement),
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None,
                    out var parsedEndDate))
                {
                    throw new RecurringPatternContractException(
                        "SERVER_ERROR",
                        "An internal error occurred");
                }

                updateEndDate = parsedEndDate;
            }

            touchedAllowedField = true;
            pattern.EndDate = updateEndDate;
        }

        if (TryGetProperty(body, "max_occurrences", out var maximumElement))
        {
            var maximum = ToPhpInteger(maximumElement);
            if (maximum < 0)
            {
                throw new RecurringPatternContractException(
                    "SERVER_ERROR",
                    "An internal error occurred");
            }

            touchedAllowedField = true;
            pattern.MaxOccurrences = maximum;
        }

        if (TryGetProperty(body, "days_of_week", out _))
        {
            var daysOfWeek = ReadDaysOfWeekStorage(body);
            touchedAllowedField = true;
            pattern.DaysOfWeek = daysOfWeek;
        }

        if (touchedAllowedField)
        {
            pattern.UpdatedAt = DateTime.UtcNow;
            try
            {
                await _db.SaveChangesAsync(ct);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                _logger.LogError(
                    exception,
                    "Recurring shift pattern update failed for pattern {PatternId} in tenant {TenantId}",
                    patternId,
                    tenantId);
                throw new RecurringPatternContractException(
                    "SERVER_ERROR",
                    "An internal error occurred");
            }
        }

        return await ToRecurringPatternViewAsync(pattern, tenantId, ct);
    }

    public async Task<int> DeactivatePatternAsync(
        int patternId,
        int userId,
        CancellationToken ct = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var pattern = await _db.RecurringShiftPatterns
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(candidate =>
                candidate.Id == patternId
                && candidate.TenantId == tenantId,
                ct)
            ?? throw new RecurringPatternContractException("NOT_FOUND", "Not found");

        await EnsureCanManageOpportunityAsync(
            pattern.OpportunityId,
            userId,
            tenantId,
            null,
            ct);

        pattern.IsActive = false;
        pattern.UpdatedAt = DateTime.UtcNow;
        try
        {
            // Laravel commits deactivation before attempting best-effort cleanup.
            await _db.SaveChangesAsync(ct);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogError(
                exception,
                "Recurring shift pattern deactivation failed for pattern {PatternId} in tenant {TenantId}",
                patternId,
                tenantId);
            throw new RecurringPatternContractException(
                "SERVER_ERROR",
                "An internal error occurred");
        }

        try
        {
            await using var transaction = await _db.Database.BeginTransactionAsync(ct);
            var now = DateTime.UtcNow;
            var shiftIds = await _db.VolunteerShifts
                .IgnoreQueryFilters()
                .Where(shift =>
                    shift.TenantId == tenantId
                    && shift.RecurringPatternId == patternId
                    && shift.StartsAt > now)
                .Select(shift => shift.Id)
                .ToListAsync(ct);

            if (shiftIds.Count == 0)
            {
                await transaction.CommitAsync(ct);
                return 0;
            }

            await _db.VolunteerEmergencyAlerts
                .IgnoreQueryFilters()
                .Where(alert =>
                    alert.TenantId == tenantId
                    && alert.IsActive
                    && alert.ShiftId.HasValue
                    && shiftIds.Contains(alert.ShiftId.Value))
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(alert => alert.IsActive, false)
                    .SetProperty(alert => alert.UpdatedAt, now), ct);

            // These ASP.NET soft references do not have the SET NULL foreign
            // keys used by Laravel. Preserve their historical rows explicitly.
            await _db.VolunteerExpenses
                .IgnoreQueryFilters()
                .Where(expense =>
                    expense.TenantId == tenantId
                    && expense.ShiftId.HasValue
                    && shiftIds.Contains(expense.ShiftId.Value))
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(expense => expense.ShiftId, (int?)null)
                    .SetProperty(expense => expense.UpdatedAt, now), ct);

            await _db.VolunteerWellbeings
                .IgnoreQueryFilters()
                .Where(wellbeing =>
                    wellbeing.TenantId == tenantId
                    && wellbeing.ShiftId.HasValue
                    && shiftIds.Contains(wellbeing.ShiftId.Value))
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(wellbeing => wellbeing.ShiftId, (int?)null)
                    .SetProperty(wellbeing => wellbeing.UpdatedAt, now), ct);

            // ToShiftId uses NO ACTION; FromShiftId cascades with the deleted
            // shift and therefore does not need a separate mutation.
            await _db.ShiftSwapRequests
                .IgnoreQueryFilters()
                .Where(swap =>
                    swap.TenantId == tenantId
                    && swap.ToShiftId.HasValue
                    && shiftIds.Contains(swap.ToShiftId.Value))
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(swap => swap.ToShiftId, (int?)null)
                    .SetProperty(swap => swap.UpdatedAt, now), ct);

            var deleted = await _db.VolunteerShifts
                .IgnoreQueryFilters()
                .Where(shift =>
                    shift.TenantId == tenantId
                    && shiftIds.Contains(shift.Id))
                .ExecuteDeleteAsync(ct);

            await transaction.CommitAsync(ct);
            return deleted;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            // Match Laravel's two-stage lifecycle: the pattern remains inactive
            // and the endpoint still succeeds when future-shift cleanup fails.
            _logger.LogError(
                exception,
                "Recurring shift cleanup failed for pattern {PatternId} in tenant {TenantId}",
                patternId,
                tenantId);
            return 0;
        }
    }

    private async Task EnsureCanManageOpportunityAsync(
        int opportunityId,
        int userId,
        int tenantId,
        string? notFoundMessage,
        CancellationToken ct)
    {
        var access = await _volunteerOrganisations.EvaluateOpportunityAccessAsync(
            opportunityId,
            userId,
            tenantId,
            includeCreator: true,
            ct);
        if (!access.Exists)
        {
            if (notFoundMessage is not null)
            {
                throw new RecurringPatternContractException("NOT_FOUND", notFoundMessage);
            }

            throw new RecurringPatternContractException("FORBIDDEN", "Forbidden");
        }

        if (!access.Allowed)
        {
            throw new RecurringPatternContractException("FORBIDDEN", "Forbidden");
        }
    }

    private async Task<IReadOnlyList<RecurringPatternView>> ToRecurringPatternViewsAsync(
        IReadOnlyList<RecurringShiftPattern> patterns,
        int tenantId,
        CancellationToken ct)
    {
        var creatorIds = patterns
            .Select(pattern => pattern.CreatedBy)
            .Distinct()
            .ToArray();
        var creators = creatorIds.Length == 0
            ? new Dictionary<int, string?>()
            : await _db.Users
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(user => user.TenantId == tenantId && creatorIds.Contains(user.Id))
                .ToDictionaryAsync(
                    user => user.Id,
                    user => string.IsNullOrWhiteSpace((user.FirstName + " " + user.LastName).Trim())
                        ? null
                        : (user.FirstName + " " + user.LastName).Trim(),
                    ct);

        return patterns
            .Select(pattern => ToRecurringPatternView(
                pattern,
                creators.GetValueOrDefault(pattern.CreatedBy)))
            .ToArray();
    }

    private async Task<RecurringPatternView> ToRecurringPatternViewAsync(
        RecurringShiftPattern pattern,
        int tenantId,
        CancellationToken ct)
    {
        var creatorName = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.Id == pattern.CreatedBy && user.TenantId == tenantId)
            .Select(user => (user.FirstName + " " + user.LastName).Trim())
            .SingleOrDefaultAsync(ct);

        return ToRecurringPatternView(
            pattern,
            string.IsNullOrWhiteSpace(creatorName) ? null : creatorName);
    }

    private static RecurringPatternView ToRecurringPatternView(
        RecurringShiftPattern pattern,
        string? creatorName) => new(
            pattern.Id,
            pattern.OpportunityId,
            pattern.Title,
            pattern.Frequency,
            ParseResponseDaysOfWeek(pattern.DaysOfWeek),
            pattern.StartTime,
            pattern.EndTime,
            pattern.SpotsPerShift,
            pattern.Capacity,
            pattern.StartDate,
            pattern.EndDate,
            pattern.MaxOccurrences is null or 0 ? null : pattern.MaxOccurrences,
            pattern.OccurrencesGenerated,
            pattern.IsActive,
            pattern.CreatedBy,
            creatorName,
            pattern.CreatedAt,
            pattern.UpdatedAt);

    private static JsonElement ParseResponseDaysOfWeek(string? stored)
    {
        if (string.IsNullOrWhiteSpace(stored))
        {
            return EmptyJsonArray();
        }

        try
        {
            using var document = JsonDocument.Parse(stored);
            var decoded = document.RootElement;
            if (DecodedJsonIsPhpFalsy(decoded))
            {
                return EmptyJsonArray();
            }

            return decoded.Clone();
        }
        catch (JsonException)
        {
            return EmptyJsonArray();
        }
    }

    private static JsonElement EmptyJsonArray() =>
        JsonSerializer.SerializeToElement(Array.Empty<int>());

    private static bool DecodedJsonIsPhpFalsy(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.False => true,
        JsonValueKind.Number => value.TryGetDouble(out var number) && number == 0,
        JsonValueKind.String => value.GetString() is null or "" or "0",
        JsonValueKind.Array => value.GetArrayLength() == 0,
        JsonValueKind.Object => !value.EnumerateObject().Any(),
        _ => false
    };

    private static void EnsureObject(JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object)
        {
            throw new RecurringPatternContractException("VALIDATION_ERROR", "Invalid input");
        }
    }

    private static bool TryGetProperty(
        JsonElement body,
        string name,
        out JsonElement value)
    {
        if (body.ValueKind == JsonValueKind.Object)
        {
            return body.TryGetProperty(name, out value);
        }

        value = default;
        return false;
    }

    private static string? ReadString(JsonElement body, string name) =>
        TryGetProperty(body, name, out var value) ? ToNullablePhpString(value) : null;

    private static string? ToNullablePhpString(JsonElement value) =>
        value.ValueKind == JsonValueKind.Null ? null : ToPhpString(value);

    private static string ToPhpString(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString() ?? string.Empty,
        JsonValueKind.True => "1",
        JsonValueKind.False or JsonValueKind.Null => string.Empty,
        _ => value.ToString()
    };

    private static int ToPhpInteger(JsonElement value)
    {
        try
        {
            return value.ValueKind switch
            {
                JsonValueKind.Number when value.TryGetInt32(out var integer) => integer,
                JsonValueKind.Number => checked((int)Math.Truncate(value.GetDouble())),
                JsonValueKind.String when int.TryParse(
                    value.GetString(),
                    NumberStyles.Integer,
                    CultureInfo.InvariantCulture,
                    out var parsed) => parsed,
                JsonValueKind.String when double.TryParse(
                    value.GetString(),
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out var numeric) => checked((int)Math.Truncate(numeric)),
                JsonValueKind.True => 1,
                _ => 0
            };
        }
        catch (Exception exception) when (exception is FormatException or OverflowException)
        {
            return 0;
        }
    }

    private static int ReadCreateInteger(JsonElement body, string name, int defaultValue)
    {
        if (!TryGetProperty(body, name, out var value)
            || value.ValueKind == JsonValueKind.Null
            || (value.ValueKind == JsonValueKind.String
                && string.IsNullOrEmpty(value.GetString())))
        {
            return defaultValue;
        }

        if (value.ValueKind is JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False)
        {
            return ToPhpInteger(value);
        }

        if (value.ValueKind == JsonValueKind.String
            && double.TryParse(
                value.GetString(),
                NumberStyles.Float,
                CultureInfo.InvariantCulture,
                out _))
        {
            return ToPhpInteger(value);
        }

        return defaultValue;
    }

    private static int? ReadCreateNullableInteger(JsonElement body, string name)
    {
        if (!TryGetProperty(body, name, out var value)
            || value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        return ToPhpInteger(value);
    }

    private static string? ReadDaysOfWeekStorage(JsonElement body)
    {
        if (!TryGetProperty(body, "days_of_week", out var value)
            || value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        return value.ValueKind == JsonValueKind.Array
            ? value.GetRawText()
            : ToPhpString(value);
    }

    private static DateOnly? ReadNullableDate(JsonElement body, string name)
    {
        if (!TryGetProperty(body, name, out var value)
            || value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        if (DateOnly.TryParse(
            ToPhpString(value),
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out var parsed))
        {
            return parsed;
        }

        throw new RecurringPatternContractException(
            "SERVER_ERROR",
            "An internal error occurred");
    }

    private static TimeSpan ParseRequiredTime(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Null
            && TimeSpan.TryParse(
                ToPhpString(value),
                CultureInfo.InvariantCulture,
                out var parsed))
        {
            return parsed;
        }

        throw new RecurringPatternContractException(
            "SERVER_ERROR",
            "An internal error occurred");
    }

    public async Task<int> GenerateOccurrencesAsync(
        int patternId,
        int daysAhead,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        await using var transaction = await _db.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken);

        // Serialize every generator for one pattern. The database uniqueness
        // constraint remains the final guard against inserts outside this
        // service or process.
        var pattern = await _db.RecurringShiftPatterns
            .FromSqlInterpolated(
                $"""
                SELECT *
                FROM "RecurringShiftPatterns"
                WHERE "Id" = {patternId} AND "TenantId" = {tenantId}
                FOR UPDATE
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (pattern is null || !pattern.IsActive)
        {
            return 0;
        }

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var current = pattern.StartDate > today ? pattern.StartDate : today;
        var cutoff = today.AddDays(Math.Max(0, daysAhead));
        if (pattern.EndDate is { } endDate && endDate < cutoff)
        {
            cutoff = endDate;
        }

        if (pattern.MaxOccurrences is < 0)
        {
            throw new InvalidOperationException(
                $"Recurring shift pattern {pattern.Id} has a negative max-occurrences value.");
        }

        var maxOccurrences = pattern.MaxOccurrences is null or 0
            ? int.MaxValue
            : pattern.MaxOccurrences.Value;
        var remaining = maxOccurrences - pattern.OccurrencesGenerated;
        if (remaining <= 0 || current > cutoff)
        {
            return 0;
        }

        var frequency = pattern.Frequency;
        if (frequency is not ("daily" or "weekly" or "biweekly" or "monthly"))
        {
            throw new InvalidOperationException(
                $"Recurring shift pattern {pattern.Id} has unsupported frequency '{frequency}'.");
        }

        var isoDays = ParseIsoDaysOfWeek(pattern.DaysOfWeek);
        var generated = 0;
        while (current <= cutoff && generated < remaining)
        {
            if (ShouldGenerateOccurrence(pattern, current, isoDays))
            {
                var startsAt = DateTime.SpecifyKind(
                    current.ToDateTime(TimeOnly.FromTimeSpan(pattern.StartTime)),
                    DateTimeKind.Utc);
                var endsAt = DateTime.SpecifyKind(
                    current.ToDateTime(TimeOnly.FromTimeSpan(pattern.EndTime)),
                    DateTimeKind.Utc);
                var createdAt = DateTime.UtcNow;

                // The filtered recurring occurrence key keeps retries and
                // concurrent callers safe without masking unrelated conflicts.
                generated += await _db.Database.ExecuteSqlInterpolatedAsync(
                    $"""
                    INSERT INTO volunteer_shifts
                        ("TenantId", "OpportunityId", "RecurringPatternId", "Title",
                         "StartsAt", "EndsAt", "MaxVolunteers", "Status", "CreatedAt")
                    VALUES
                        ({pattern.TenantId}, {pattern.OpportunityId}, {pattern.Id}, {pattern.Title},
                         {startsAt}, {endsAt}, {pattern.Capacity}, {ShiftStatus.Scheduled.ToString()}, {createdAt})
                    ON CONFLICT ("TenantId", "RecurringPatternId", "StartsAt")
                    WHERE "RecurringPatternId" IS NOT NULL
                    DO NOTHING
                    """,
                    cancellationToken);
            }

            current = current.AddDays(1);
        }

        if (generated > 0)
        {
            pattern.OccurrencesGenerated += generated;
            pattern.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return generated;
    }

    public async Task<RecurringShiftGenerationResult> ProcessAllPatternsAsync(
        int daysAhead = 14,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var patternIds = await _db.RecurringShiftPatterns
            .AsNoTracking()
            .Where(pattern =>
                pattern.TenantId == tenantId
                && pattern.IsActive
                && (pattern.EndDate == null || pattern.EndDate >= today))
            .OrderBy(pattern => pattern.Id)
            .Select(pattern => pattern.Id)
            .ToListAsync(cancellationToken);

        var processed = 0;
        var generated = 0;
        var errors = 0;
        foreach (var patternId in patternIds)
        {
            try
            {
                generated += await GenerateOccurrencesAsync(
                    patternId,
                    daysAhead,
                    cancellationToken);
                processed++;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                errors++;
                _db.ChangeTracker.Clear();
                _logger.LogError(
                    exception,
                    "Recurring shift generation failed for pattern {PatternId} in tenant {TenantId}",
                    patternId,
                    tenantId);
            }
        }

        return new RecurringShiftGenerationResult(processed, generated, errors);
    }

    private static bool ShouldGenerateOccurrence(
        RecurringShiftPattern pattern,
        DateOnly date,
        ParsedIsoDays isoDays)
    {
        return pattern.Frequency switch
        {
            "daily" => true,
            "weekly" => isoDays.MatchEveryDay || isoDays.Days.Contains(ToIsoDayOfWeek(date.DayOfWeek)),
            "biweekly" =>
                ((date.DayNumber - pattern.StartDate.DayNumber) / 7) % 2 == 0
                && (isoDays.MatchEveryDay || isoDays.Days.Contains(ToIsoDayOfWeek(date.DayOfWeek))),
            "monthly" => date.Day == Math.Min(
                pattern.StartDate.Day,
                DateTime.DaysInMonth(date.Year, date.Month)),
            _ => false
        };
    }

    private static ParsedIsoDays ParseIsoDaysOfWeek(string? value)
    {
        var days = new HashSet<int>();
        if (string.IsNullOrWhiteSpace(value))
        {
            return new ParsedIsoDays(days, MatchEveryDay: true);
        }

        try
        {
            using var document = JsonDocument.Parse(value);
            if (document.RootElement.ValueKind == JsonValueKind.Array)
            {
                var elementCount = 0;
                foreach (var element in document.RootElement.EnumerateArray())
                {
                    elementCount++;
                    if (element.ValueKind == JsonValueKind.Number
                        && element.TryGetInt32(out var numeric)
                        && numeric is >= 1 and <= 7)
                    {
                        days.Add(numeric);
                    }
                }

                // Laravel uses strict integer membership. A genuinely empty
                // JSON array means every day, but a non-empty array whose
                // values are invalid or strings must not collapse to that.
                return new ParsedIsoDays(days, MatchEveryDay: elementCount == 0);
            }

            return new ParsedIsoDays(days, MatchEveryDay: false);
        }
        catch (JsonException)
        {
            // Legacy ASP.NET rows used comma-separated DayOfWeek names.
        }

        var legacyItems = value.Split(',', StringSplitOptions.RemoveEmptyEntries);
        foreach (var item in legacyItems)
        {
            AddIsoDay(days, item);
        }

        return new ParsedIsoDays(days, MatchEveryDay: legacyItems.Length == 0);
    }

    private static void AddIsoDay(ISet<int> days, string? value)
    {
        var normalized = value?.Trim().Trim('"');
        if (int.TryParse(normalized, out var numeric) && numeric is >= 1 and <= 7)
        {
            days.Add(numeric);
            return;
        }

        if (Enum.TryParse<DayOfWeek>(normalized, true, out var legacyDay))
        {
            days.Add(ToIsoDayOfWeek(legacyDay));
        }
    }

    private static int ToIsoDayOfWeek(DayOfWeek day) =>
        day == DayOfWeek.Sunday ? 7 : (int)day;

    private sealed record ParsedIsoDays(IReadOnlySet<int> Days, bool MatchEveryDay);

    // ── Shift Swaps ───────────────────────────────────────────────────────────

    public async Task<List<ShiftSwapRequest>> GetSwapRequestsAsync(
        int userId,
        string direction = "all")
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var query = SwapDetailsQuery()
            .Where(s => s.TenantId == tenantId);
        query = direction switch
        {
            "incoming" => query.Where(swap => swap.ToUserId == userId),
            "outgoing" => query.Where(swap => swap.FromUserId == userId),
            _ => query.Where(swap => swap.FromUserId == userId || swap.ToUserId == userId)
        };

        return await query
            .OrderByDescending(s => s.CreatedAt)
            .Take(50)
            .ToListAsync();
    }

    public Task<List<ShiftSwapRequest>> GetAdminPendingSwapsAsync() =>
        SwapDetailsQuery()
            .Where(swap =>
                swap.TenantId == _tenant.GetTenantIdOrThrow()
                && swap.Status == "admin_pending")
            .OrderByDescending(swap => swap.CreatedAt)
            .Take(100)
            .ToListAsync();

    private IQueryable<ShiftSwapRequest> SwapDetailsQuery() =>
        _db.ShiftSwapRequests
            .IgnoreQueryFilters()
            .AsNoTracking()
            // Laravel's member/admin list queries use inner joins for both
            // volunteers and shifts. Historical rows whose optional target was
            // cleared during shift deletion are therefore omitted, not rendered.
            .Where(swap => swap.ToUserId.HasValue && swap.ToShiftId.HasValue)
            .Include(swap => swap.FromUser)
            .Include(swap => swap.ToUser)
            .Include(swap => swap.FromShift)
                .ThenInclude(shift => shift!.Opportunity)
                    .ThenInclude(opportunity => opportunity!.VolunteerOrganisation)
            .Include(swap => swap.ToShift)
                .ThenInclude(shift => shift!.Opportunity)
                    .ThenInclude(opportunity => opportunity!.VolunteerOrganisation);

    public async Task<(ShiftSwapRequest? Swap, string? Error)> RequestSwapAsync(
        int userId, SwapRequest req)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (req.FromShiftId <= 0
            || !req.ToShiftId.HasValue
            || req.ToShiftId.Value <= 0
            || !req.ToUserId.HasValue
            || req.ToUserId.Value <= 0)
            return (null, "Both shifts and the target volunteer are required");
        if (req.ToUserId.Value == userId)
            return (null, "You cannot swap a shift with yourself");
        var normalizedMessage = req.Message?.Trim();
        if (normalizedMessage?.Length > 1000)
            return (null, "Message must not exceed 1000 characters");

        var ownsTransaction = _db.Database.IsRelational()
            && _db.Database.CurrentTransaction is null;
        IDbContextTransaction? transaction = _db.Database.CurrentTransaction;
        if (ownsTransaction)
        {
            transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        }

        try
        {
            var shiftIds = new[] { req.FromShiftId, req.ToShiftId.Value }
                .Distinct()
                .OrderBy(id => id)
                .ToArray();
            if (_db.Database.IsRelational())
            {
                // The stable lock order serializes identical requests and every
                // other request/decision involving either shift.
                foreach (var shiftId in shiftIds)
                {
                    if (!await LockShiftAsync(shiftId, tenantId))
                        return (null, "Shift not found");
                }
            }

            var shifts = await _db.VolunteerShifts
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(shift => shift.TenantId == tenantId && shiftIds.Contains(shift.Id))
                .ToDictionaryAsync(shift => shift.Id);
            if (!shifts.TryGetValue(req.FromShiftId, out var fromShift)
                || !shifts.TryGetValue(req.ToShiftId.Value, out var toShift))
            {
                return (null, "Shift not found");
            }

            if (fromShift.OpportunityId != toShift.OpportunityId)
                return (null, "Shifts must belong to the same opportunity");

            var now = DateTime.UtcNow;
            if (fromShift.StartsAt < now || toShift.StartsAt < now)
                return (null, "A shift has already started");

            var ownsShift = await _db.VolunteerApplications
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(application =>
                    application.TenantId == tenantId
                    && application.UserId == userId
                    && application.ShiftId == req.FromShiftId
                    && application.Status == ApplicationStatus.Approved);
            if (!ownsShift) return (null, "You are not assigned to this shift");

            var targetOwnsShift = await _db.VolunteerApplications
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(application =>
                    application.TenantId == tenantId
                    && application.UserId == req.ToUserId.Value
                    && application.ShiftId == req.ToShiftId.Value
                    && application.Status == ApplicationStatus.Approved);
            if (!targetOwnsShift)
                return (null, "The target volunteer is not assigned to that shift");

            var duplicate = await _db.ShiftSwapRequests
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(swap =>
                    swap.TenantId == tenantId
                    && swap.FromUserId == userId
                    && swap.ToUserId == req.ToUserId.Value
                    && swap.FromShiftId == req.FromShiftId
                    && swap.ToShiftId == req.ToShiftId.Value
                    && (swap.Status == "pending" || swap.Status == "admin_pending"));
            if (duplicate) return (null, "A matching swap request is already pending");

            var swap = new ShiftSwapRequest
            {
                TenantId = tenantId,
                FromUserId = userId,
                ToUserId = req.ToUserId.Value,
                FromShiftId = req.FromShiftId,
                ToShiftId = req.ToShiftId.Value,
                Message = normalizedMessage,
                Status = "pending",
                RequiresAdminApproval = await SwapRequiresAdminApprovalAsync(tenantId)
            };

            _db.ShiftSwapRequests.Add(swap);
            await _db.SaveChangesAsync();
            if (ownsTransaction) await transaction!.CommitAsync();
            return (swap, null);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            if (ownsTransaction && transaction is not null)
            {
                await transaction.RollbackAsync(CancellationToken.None);
            }

            _logger.LogError(
                exception,
                "Failed to request shift swap for user {UserId}, tenant {TenantId}",
                userId,
                tenantId);
            return (null, "Failed to create the shift swap request");
        }
        finally
        {
            if (ownsTransaction && transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    public Task<(ShiftSwapRequest? Swap, string? Error)> RespondToSwapAsync(
        int swapId,
        int userId,
        bool accept) =>
        DecideSwapAsync(swapId, userId, accept, adminDecision: false);

    public Task<(ShiftSwapRequest? Swap, string? Error)> AdminDecideSwapAsync(
        int swapId,
        int adminId,
        bool approve) =>
        DecideSwapAsync(swapId, adminId, approve, adminDecision: true);

    private async Task<(ShiftSwapRequest? Swap, string? Error)> DecideSwapAsync(
        int swapId,
        int actorUserId,
        bool accept,
        bool adminDecision)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var ownsTransaction = _db.Database.IsRelational()
            && _db.Database.CurrentTransaction is null;
        IDbContextTransaction? transaction = _db.Database.CurrentTransaction;
        if (ownsTransaction)
        {
            transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        }

        try
        {
            if (_db.Database.IsRelational()
                && !await LockSwapRequestAsync(swapId, tenantId))
            {
                return (null, "Swap request not found");
            }

            var swap = await _db.ShiftSwapRequests
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(candidate =>
                    candidate.Id == swapId && candidate.TenantId == tenantId);
            if (swap == null) return (null, "Swap request not found");
            if (!adminDecision && swap.ToUserId != actorUserId)
                return (null, "Not authorized");
            var expectedStatus = adminDecision ? "admin_pending" : "pending";
            if (swap.Status != expectedStatus)
                return (null, "Swap request not found or already processed");

            if (!accept)
            {
                swap.Status = adminDecision ? "admin_rejected" : "rejected";
                if (adminDecision) swap.AdminId = actorUserId;
                swap.UpdatedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync();
                if (ownsTransaction) await transaction!.CommitAsync();
                return (swap, null);
            }

            if (!adminDecision && swap.RequiresAdminApproval)
            {
                swap.Status = "admin_pending";
                swap.UpdatedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync();
                if (ownsTransaction) await transaction!.CommitAsync();
                return (swap, null);
            }

            if (!swap.ToUserId.HasValue || !swap.ToShiftId.HasValue)
                return (null, "Swap assignments are incomplete");

            var shiftIds = new[] { swap.FromShiftId, swap.ToShiftId.Value }
                .Distinct()
                .OrderBy(id => id)
                .ToArray();
            if (_db.Database.IsRelational())
            {
                foreach (var shiftId in shiftIds)
                {
                    if (!await LockShiftAsync(shiftId, tenantId))
                        return (null, "Shift not found");
                }
            }

            var shifts = await _db.VolunteerShifts
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(shift => shift.TenantId == tenantId && shiftIds.Contains(shift.Id))
                .ToDictionaryAsync(shift => shift.Id);
            if (!shifts.TryGetValue(swap.FromShiftId, out var fromShift)
                || !shifts.TryGetValue(swap.ToShiftId.Value, out var toShift))
            {
                return (null, "Shift not found");
            }

            if (fromShift.OpportunityId != toShift.OpportunityId)
                return (null, "Shifts must belong to the same opportunity");
            if (fromShift.StartsAt < DateTime.UtcNow || toShift.StartsAt < DateTime.UtcNow)
                return (null, "A shift has already started");

            var fromApplicationId = await LockApprovedSwapApplicationAsync(
                tenantId,
                swap.FromUserId,
                swap.FromShiftId);
            var toApplicationId = await LockApprovedSwapApplicationAsync(
                tenantId,
                swap.ToUserId.Value,
                swap.ToShiftId.Value);
            if (!fromApplicationId.HasValue || !toApplicationId.HasValue)
                return (null, "Both volunteers must still be assigned to their shifts");

            if (await HasOverlappingApprovedShiftAsync(
                    tenantId,
                    swap.FromUserId,
                    toShift,
                    swap.FromShiftId)
                || await HasOverlappingApprovedShiftAsync(
                    tenantId,
                    swap.ToUserId.Value,
                    fromShift,
                    swap.ToShiftId.Value))
            {
                return (null, "The swap would create an overlapping shift assignment");
            }

            var applications = await _db.VolunteerApplications
                .IgnoreQueryFilters()
                .Where(application =>
                    application.Id == fromApplicationId.Value
                    || application.Id == toApplicationId.Value)
                .ToDictionaryAsync(application => application.Id);
            if (!applications.TryGetValue(fromApplicationId.Value, out var fromApplication)
                || !applications.TryGetValue(toApplicationId.Value, out var toApplication))
            {
                return (null, "Both volunteers must still be assigned to their shifts");
            }

            // Laravel swaps the approved assignments only. QR rows are durable
            // attendance evidence and remain attached to their original shifts.
            fromApplication.ShiftId = swap.ToShiftId.Value;
            fromApplication.UpdatedAt = DateTime.UtcNow;
            toApplication.ShiftId = swap.FromShiftId;
            toApplication.UpdatedAt = DateTime.UtcNow;
            swap.Status = adminDecision ? "admin_approved" : "accepted";
            if (adminDecision) swap.AdminId = actorUserId;
            swap.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync();
            if (ownsTransaction) await transaction!.CommitAsync();
            return (swap, null);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            if (ownsTransaction && transaction is not null)
            {
                await transaction.RollbackAsync(CancellationToken.None);
            }

            _logger.LogError(
                exception,
                "Failed to decide shift swap {SwapId} for tenant {TenantId}",
                swapId,
                tenantId);
            return (null, "Failed to update the shift swap");
        }
        finally
        {
            if (ownsTransaction && transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    public async Task<string?> CancelSwapAsync(int swapId, int userId)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var ownsTransaction = _db.Database.IsRelational()
            && _db.Database.CurrentTransaction is null;
        IDbContextTransaction? transaction = _db.Database.CurrentTransaction;
        if (ownsTransaction)
        {
            transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        }

        try
        {
            if (_db.Database.IsRelational()
                && !await LockSwapRequestAsync(swapId, tenantId))
            {
                return "Swap request not found or not cancellable";
            }

            var swap = await _db.ShiftSwapRequests
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(s =>
                    s.Id == swapId
                    && s.TenantId == tenantId
                    && s.FromUserId == userId
                    && (s.Status == "pending" || s.Status == "admin_pending"));
            if (swap == null) return "Swap request not found or not cancellable";

            swap.Status = "cancelled";
            swap.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            if (ownsTransaction) await transaction!.CommitAsync();
            return null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            if (ownsTransaction && transaction is not null)
            {
                await transaction.RollbackAsync(CancellationToken.None);
            }

            _logger.LogError(
                exception,
                "Failed to cancel shift swap {SwapId} for tenant {TenantId}",
                swapId,
                tenantId);
            return "Failed to cancel the shift swap";
        }
        finally
        {
            if (ownsTransaction && transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    private async Task<bool> LockSwapRequestAsync(
        int swapId,
        int tenantId,
        CancellationToken ct = default)
    {
        var connection = _db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText =
            "SELECT \"Id\" FROM \"ShiftSwapRequests\" "
            + "WHERE \"Id\" = @swap_id AND \"TenantId\" = @tenant_id FOR UPDATE";

        var swapParameter = command.CreateParameter();
        swapParameter.ParameterName = "swap_id";
        swapParameter.Value = swapId;
        command.Parameters.Add(swapParameter);

        var tenantParameter = command.CreateParameter();
        tenantParameter.ParameterName = "tenant_id";
        tenantParameter.Value = tenantId;
        command.Parameters.Add(tenantParameter);

        return await command.ExecuteScalarAsync(ct) is not null;
    }

    private async Task<int?> LockApprovedSwapApplicationAsync(
        int tenantId,
        int userId,
        int shiftId,
        CancellationToken ct = default)
    {
        if (!_db.Database.IsRelational())
        {
            return await _db.VolunteerApplications
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(application =>
                    application.TenantId == tenantId
                    && application.UserId == userId
                    && application.ShiftId == shiftId
                    && application.Status == ApplicationStatus.Approved)
                .Select(application => (int?)application.Id)
                .SingleOrDefaultAsync(ct);
        }

        var connection = _db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText =
            "SELECT \"Id\" FROM volunteer_applications "
            + "WHERE \"TenantId\" = @tenant_id AND \"UserId\" = @user_id "
            + "AND \"ShiftId\" = @shift_id AND \"Status\" = @status "
            + "ORDER BY \"Id\" FOR UPDATE";

        var tenantParameter = command.CreateParameter();
        tenantParameter.ParameterName = "tenant_id";
        tenantParameter.Value = tenantId;
        command.Parameters.Add(tenantParameter);

        var userParameter = command.CreateParameter();
        userParameter.ParameterName = "user_id";
        userParameter.Value = userId;
        command.Parameters.Add(userParameter);

        var shiftParameter = command.CreateParameter();
        shiftParameter.ParameterName = "shift_id";
        shiftParameter.Value = shiftId;
        command.Parameters.Add(shiftParameter);

        var statusParameter = command.CreateParameter();
        statusParameter.ParameterName = "status";
        statusParameter.Value = ApplicationStatus.Approved.ToString();
        command.Parameters.Add(statusParameter);

        var result = await command.ExecuteScalarAsync(ct);
        return result is null or DBNull ? null : Convert.ToInt32(result, CultureInfo.InvariantCulture);
    }

    private Task<bool> HasOverlappingApprovedShiftAsync(
        int tenantId,
        int userId,
        VolunteerShift targetShift,
        int excludedShiftId,
        CancellationToken ct = default) =>
        (
            from application in _db.VolunteerApplications.IgnoreQueryFilters().AsNoTracking()
            join shift in _db.VolunteerShifts.IgnoreQueryFilters().AsNoTracking()
                on new { application.TenantId, ShiftId = application.ShiftId!.Value }
                equals new { shift.TenantId, ShiftId = shift.Id }
            where application.TenantId == tenantId
                && application.UserId == userId
                && application.Status == ApplicationStatus.Approved
                && application.ShiftId.HasValue
                && application.ShiftId.Value != excludedShiftId
                && application.ShiftId.Value != targetShift.Id
                && shift.StartsAt < targetShift.EndsAt
                && shift.EndsAt > targetShift.StartsAt
            select application.Id
        ).AnyAsync(ct);

    // ── Waitlist ──────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<WaitlistListItem>> GetUserWaitlistsAsync(
        int userId,
        CancellationToken ct = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        return await (
            from waitlist in _db.ShiftWaitlistEntries.IgnoreQueryFilters().AsNoTracking()
            join shift in _db.VolunteerShifts.IgnoreQueryFilters().AsNoTracking()
                on new { waitlist.ShiftId, waitlist.TenantId }
                equals new { ShiftId = shift.Id, shift.TenantId }
            join opportunity in _db.VolunteerOpportunities.IgnoreQueryFilters().AsNoTracking()
                on new { shift.OpportunityId, shift.TenantId }
                equals new { OpportunityId = opportunity.Id, opportunity.TenantId }
            where waitlist.TenantId == tenantId
                && waitlist.UserId == userId
                && (waitlist.Status == "waiting" || waitlist.Status == "notified")
            orderby shift.StartsAt, waitlist.Position
            select new WaitlistListItem(
                waitlist.Id,
                waitlist.Position,
                waitlist.Status,
                waitlist.NotifiedAt,
                waitlist.CreatedAt,
                new WaitlistShiftItem(
                    shift.Id,
                    shift.StartsAt,
                    shift.EndsAt,
                    shift.MaxVolunteers > 0 ? shift.MaxVolunteers : null),
                new WaitlistOpportunityItem(
                    opportunity.Id,
                    opportunity.Title,
                    opportunity.Location ?? string.Empty)))
            .ToListAsync(ct);
    }

    public async Task<(ShiftWaitlistEntry? Entry, string? Error)> JoinWaitlistAsync(
        int shiftId,
        int userId,
        CancellationToken ct = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        ShiftWaitlistEntry? entry = null;
        await using var transaction = await _db.Database.BeginTransactionAsync(ct);
        try
        {
            // The transaction-scoped queue lock exists even when the queue is
            // empty. It serializes duplicate checks and position allocation for
            // this tenant/shift without relying on a row that may not exist yet.
            await LockWaitlistQueueAsync(shiftId, tenantId, ct);

            if (!await LockShiftAsync(shiftId, tenantId, ct))
            {
                await transaction.RollbackAsync(ct);
                return (null, "Shift not found");
            }

            var shift = await _db.VolunteerShifts
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(candidate => candidate.Id == shiftId && candidate.TenantId == tenantId)
                .Select(candidate => new
                {
                    candidate.OpportunityId,
                    candidate.StartsAt,
                    candidate.MaxVolunteers
                })
                .SingleAsync(ct);

            if (shift.StartsAt <= DateTime.UtcNow)
            {
                await transaction.RollbackAsync(ct);
                return (null, "This shift has already started");
            }

            var opportunityIsActive = await _db.VolunteerOpportunities
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(opportunity =>
                    opportunity.Id == shift.OpportunityId
                    && opportunity.TenantId == tenantId
                    && opportunity.Status == OpportunityStatus.Published,
                    ct);
            if (!opportunityIsActive)
            {
                await transaction.RollbackAsync(ct);
                return (null, "Opportunity not found or is not active");
            }

            if (await _guardianConsent.IsBlockedAsync(
                userId,
                tenantId,
                shift.OpportunityId,
                ct))
            {
                await transaction.RollbackAsync(ct);
                return (null, VolunteerGuardianConsentService.RequiredMessage);
            }

            var hasApprovedApplication = await _db.VolunteerApplications
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(application =>
                    application.TenantId == tenantId
                    && application.OpportunityId == shift.OpportunityId
                    && application.UserId == userId
                    && application.Status == ApplicationStatus.Approved,
                    ct);
            if (!hasApprovedApplication)
            {
                await transaction.RollbackAsync(ct);
                return (null, "You must have an approved application to sign up for shifts");
            }

            var alreadyOnWaitlist = await _db.ShiftWaitlistEntries
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(waitlist =>
                    waitlist.TenantId == tenantId
                    && waitlist.ShiftId == shiftId
                    && waitlist.UserId == userId
                    && (waitlist.Status == "waiting" || waitlist.Status == "notified"),
                    ct);
            if (alreadyOnWaitlist)
            {
                await transaction.RollbackAsync(ct);
                return (null, "You are already on the waitlist for this shift");
            }

            var alreadySignedUp = await _db.VolunteerApplications
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(application =>
                    application.TenantId == tenantId
                    && application.ShiftId == shiftId
                    && application.UserId == userId
                    && application.Status == ApplicationStatus.Approved,
                    ct);
            if (alreadySignedUp)
            {
                await transaction.RollbackAsync(ct);
                return (null, "You are already signed up for this shift");
            }

            if (shift.MaxVolunteers <= 0
                || await GetUsedShiftSlotsAsync(
                    shiftId,
                    tenantId,
                    includeOutstandingOffers: false,
                    ct: ct)
                    < shift.MaxVolunteers)
            {
                await transaction.RollbackAsync(ct);
                return (null, "This shift still has open places, so you do not need the waitlist yet.");
            }

            var maxPosition = await _db.ShiftWaitlistEntries
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(waitlist =>
                    waitlist.TenantId == tenantId
                    && waitlist.ShiftId == shiftId
                    && (waitlist.Status == "waiting" || waitlist.Status == "notified"))
                .Select(waitlist => (int?)waitlist.Position)
                .MaxAsync(ct) ?? 0;

            entry = new ShiftWaitlistEntry
            {
                TenantId = tenantId,
                ShiftId = shiftId,
                UserId = userId,
                Position = maxPosition + 1,
                Status = "waiting",
                CreatedAt = DateTime.UtcNow
            };

            _db.ShiftWaitlistEntries.Add(entry);
            await _db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return (entry, null);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync(CancellationToken.None);
            if (entry is not null)
            {
                _db.Entry(entry).State = EntityState.Detached;
            }

            _logger.LogError(
                ex,
                "Failed to join waitlist for user {UserId}, shift {ShiftId}, tenant {TenantId}",
                userId,
                shiftId,
                tenantId);
            return (null, "Failed to join waitlist");
        }
    }

    public async Task<string?> LeaveWaitlistAsync(
        int shiftId,
        int userId,
        CancellationToken ct = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var reoffer = false;
        try
        {
            await using (var transaction = await _db.Database.BeginTransactionAsync(ct))
            {
                await LockWaitlistQueueAsync(shiftId, tenantId, ct);
                var entry = await LockWaitlistOfferAsync(shiftId, userId, tenantId, ct);
                if (entry is null)
                {
                    await transaction.RollbackAsync(ct);
                    return "You are not on the waitlist for this shift";
                }

                var updated = await _db.ShiftWaitlistEntries
                    .IgnoreQueryFilters()
                    .Where(candidate =>
                        candidate.Id == entry.Id
                        && candidate.TenantId == tenantId
                        && (candidate.Status == "waiting" || candidate.Status == "notified"))
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(candidate => candidate.Status, "cancelled"),
                        ct);
                if (updated != 1)
                {
                    await transaction.RollbackAsync(ct);
                    return "You are not on the waitlist for this shift";
                }

                await _db.ShiftWaitlistEntries
                    .IgnoreQueryFilters()
                    .Where(candidate =>
                        candidate.TenantId == tenantId
                        && candidate.ShiftId == shiftId
                        && candidate.Status == "waiting"
                        && candidate.Position > entry.Position)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(candidate => candidate.Position, candidate => candidate.Position - 1),
                        ct);

                reoffer = entry.Status == "notified";
                await transaction.CommitAsync(ct);
            }

            if (reoffer)
            {
                await NotifyNextWaitlistedVolunteerAsync(shiftId, tenantId, ct);
            }

            return null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Failed to leave waitlist for user {UserId}, shift {ShiftId}, tenant {TenantId}",
                userId,
                shiftId,
                tenantId);
            return "Failed to leave waitlist";
        }
    }

    public async Task<(ShiftWaitlistEntry? Entry, string? Error)> PromoteFromWaitlistAsync(
        int shiftId,
        int userId,
        CancellationToken ct = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        await using var transaction = await _db.Database.BeginTransactionAsync(ct);
        try
        {
            await LockWaitlistQueueAsync(shiftId, tenantId, ct);

            // Lock the caller's offer before the shift. This matches Laravel's
            // claim ordering and ensures only one request can consume a notified
            // row. Waiting rows are locked only to return the precise "not yet"
            // failure without ever promoting them.
            var offer = await LockWaitlistOfferAsync(shiftId, userId, tenantId, ct);
            if (offer is null)
            {
                await transaction.RollbackAsync(ct);
                return (null, "Waitlist entry not found");
            }

            if (offer.Status != "notified")
            {
                await transaction.RollbackAsync(ct);
                return (null, "Your turn has not come up yet \u2014 you will be notified when a spot opens up.");
            }

            // Approval, direct signup, and group reservation all serialize their
            // capacity snapshots on this same tenant-scoped shift row.
            if (!await LockShiftAsync(shiftId, tenantId, ct))
            {
                await transaction.RollbackAsync(ct);
                return (null, "Shift not found");
            }

            var shift = await _db.VolunteerShifts
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(candidate => candidate.Id == shiftId && candidate.TenantId == tenantId)
                .Select(candidate => new
                {
                    candidate.OpportunityId,
                    candidate.StartsAt,
                    candidate.MaxVolunteers
                })
                .SingleAsync(ct);

            if (shift.StartsAt <= DateTime.UtcNow)
            {
                await transaction.RollbackAsync(ct);
                return (null, "This shift has already started");
            }

            var opportunityIsActive = await _db.VolunteerOpportunities
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(opportunity =>
                    opportunity.Id == shift.OpportunityId
                    && opportunity.TenantId == tenantId
                    && opportunity.Status == OpportunityStatus.Published,
                    ct);
            if (!opportunityIsActive)
            {
                await transaction.RollbackAsync(ct);
                return (null, "Opportunity not found or is not active");
            }

            if (shift.MaxVolunteers > 0)
            {
                var approvedApplications = await _db.VolunteerApplications
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .LongCountAsync(application =>
                        application.TenantId == tenantId
                        && application.ShiftId == shiftId
                        && application.Status == ApplicationStatus.Approved,
                        ct);

                var activeReservedSlots = await _db.ShiftGroupReservations
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(reservation =>
                        reservation.TenantId == tenantId
                        && reservation.ShiftId == shiftId
                        && reservation.Status == "active")
                    .SumAsync(reservation => reservation.ReservedSlots > 0
                        ? (long)reservation.ReservedSlots
                        : 0L,
                        ct);

                if (approvedApplications + activeReservedSlots >= shift.MaxVolunteers)
                {
                    await transaction.RollbackAsync(ct);
                    return (null, "That spot is no longer available.");
                }
            }

            var application = await LockApprovedWaitlistApplicationAsync(
                shift.OpportunityId,
                userId,
                tenantId,
                ct);
            if (application is null)
            {
                await transaction.RollbackAsync(ct);
                return (null, "You must have an approved application to sign up for shifts");
            }

            var displacedShiftId = application.ShiftId.HasValue && application.ShiftId.Value != shiftId
                ? application.ShiftId
                : null;

            var now = DateTime.UtcNow;
            var applicationUpdated = await _db.VolunteerApplications
                .IgnoreQueryFilters()
                .Where(candidate =>
                    candidate.Id == application.Id
                    && candidate.TenantId == tenantId
                    && candidate.OpportunityId == shift.OpportunityId
                    && candidate.UserId == userId
                    && candidate.Status == ApplicationStatus.Approved
                    && candidate.ShiftId == application.ShiftId)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(candidate => candidate.ShiftId, shiftId)
                    .SetProperty(candidate => candidate.UpdatedAt, now),
                    ct);
            if (applicationUpdated != 1)
            {
                await transaction.RollbackAsync(ct);
                return (null, "You must have an approved application to sign up for shifts");
            }

            var offerUpdated = await _db.ShiftWaitlistEntries
                .IgnoreQueryFilters()
                .Where(candidate =>
                    candidate.Id == offer.Id
                    && candidate.TenantId == tenantId
                    && candidate.ShiftId == shiftId
                    && candidate.UserId == userId
                    && candidate.Status == "notified")
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(candidate => candidate.Status, "promoted")
                    .SetProperty(candidate => candidate.PromotedAt, now),
                    ct);
            if (offerUpdated != 1)
            {
                await transaction.RollbackAsync(ct);
                return (null, "Could not claim the spot. Please try again.");
            }

            var promoted = await _db.ShiftWaitlistEntries
                .IgnoreQueryFilters()
                .AsNoTracking()
                .SingleAsync(candidate => candidate.Id == offer.Id && candidate.TenantId == tenantId, ct);

            await transaction.CommitAsync(ct);

            // The released shift is offered only after the durable move commits.
            // Dispose first because the producer starts a separate transaction.
            await transaction.DisposeAsync();
            if (displacedShiftId.HasValue)
            {
                try
                {
                    await NotifyNextWaitlistedVolunteerAsync(
                        displacedShiftId.Value,
                        tenantId,
                        CancellationToken.None);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(
                        ex,
                        "Waitlist claim moved user {UserId} from shift {OldShiftId}, but the next offer could not be queued",
                        userId,
                        displacedShiftId.Value);
                }
            }

            return (promoted, null);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync(CancellationToken.None);
            _logger.LogError(
                ex,
                "Failed to claim waitlist offer for user {UserId}, shift {ShiftId}, tenant {TenantId}",
                userId,
                shiftId,
                tenantId);
            return (null, "Could not claim the spot. Please try again.");
        }
    }

    private async Task<LockedWaitlistOffer?> LockWaitlistOfferAsync(
        int shiftId,
        int userId,
        int tenantId,
        CancellationToken ct)
    {
        var connection = _db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText =
            "SELECT \"Id\", \"Status\", \"Position\" FROM \"ShiftWaitlistEntries\" " +
            "WHERE \"ShiftId\" = @shift_id AND \"UserId\" = @user_id " +
            "AND \"TenantId\" = @tenant_id AND \"Status\" IN ('waiting', 'notified') " +
            "ORDER BY CASE WHEN \"Status\" = 'notified' THEN 0 ELSE 1 END, \"Position\" " +
            "LIMIT 1 FOR UPDATE";

        var shiftParameter = command.CreateParameter();
        shiftParameter.ParameterName = "shift_id";
        shiftParameter.Value = shiftId;
        command.Parameters.Add(shiftParameter);

        var userParameter = command.CreateParameter();
        userParameter.ParameterName = "user_id";
        userParameter.Value = userId;
        command.Parameters.Add(userParameter);

        var tenantParameter = command.CreateParameter();
        tenantParameter.ParameterName = "tenant_id";
        tenantParameter.Value = tenantId;
        command.Parameters.Add(tenantParameter);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return null;
        }

        return new LockedWaitlistOffer(reader.GetInt32(0), reader.GetString(1), reader.GetInt32(2));
    }

    private async Task<LockedApprovedWaitlistApplication?> LockApprovedWaitlistApplicationAsync(
        int opportunityId,
        int userId,
        int tenantId,
        CancellationToken ct)
    {
        var connection = _db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText =
            "SELECT \"Id\", \"ShiftId\" FROM volunteer_applications " +
            "WHERE \"OpportunityId\" = @opportunity_id AND \"UserId\" = @user_id " +
            "AND \"TenantId\" = @tenant_id AND \"Status\" = @approved_status FOR UPDATE";

        var opportunityParameter = command.CreateParameter();
        opportunityParameter.ParameterName = "opportunity_id";
        opportunityParameter.Value = opportunityId;
        command.Parameters.Add(opportunityParameter);

        var userParameter = command.CreateParameter();
        userParameter.ParameterName = "user_id";
        userParameter.Value = userId;
        command.Parameters.Add(userParameter);

        var tenantParameter = command.CreateParameter();
        tenantParameter.ParameterName = "tenant_id";
        tenantParameter.Value = tenantId;
        command.Parameters.Add(tenantParameter);

        var statusParameter = command.CreateParameter();
        statusParameter.ParameterName = "approved_status";
        statusParameter.Value = ApplicationStatus.Approved.ToString();
        command.Parameters.Add(statusParameter);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return null;
        }

        return new LockedApprovedWaitlistApplication(
            reader.GetInt32(0),
            reader.IsDBNull(1) ? null : reader.GetInt32(1));
    }

    /// <summary>
    /// Durably offers one genuinely available place to the next waiting user.
    /// Callers invoke this only after committing the operation that freed the
    /// place. False is a safe no-op (missing/started/full/no waiter or a caught
    /// producer failure); caller cancellation is allowed to propagate.
    /// </summary>
    public async Task<bool> NotifyNextWaitlistedVolunteerAsync(
        int shiftId,
        int tenantId,
        CancellationToken ct = default)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync(ct);
        try
        {
            // Queue -> waitlist row -> shift is the single waitlist lock order.
            // Claim and expiration use the same queue lock before touching rows.
            await LockWaitlistQueueAsync(shiftId, tenantId, ct);
            var candidate = await LockNextWaitingOfferAsync(shiftId, tenantId, ct);
            if (candidate is null)
            {
                await transaction.RollbackAsync(ct);
                return false;
            }

            if (!await LockShiftAsync(shiftId, tenantId, ct))
            {
                await transaction.RollbackAsync(ct);
                return false;
            }

            var shift = await _db.VolunteerShifts
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(row => row.Id == shiftId && row.TenantId == tenantId)
                .Select(row => new { row.OpportunityId, row.StartsAt, row.MaxVolunteers })
                .SingleAsync(ct);
            if (shift.StartsAt <= DateTime.UtcNow)
            {
                await transaction.RollbackAsync(ct);
                return false;
            }

            var opportunityIsActive = await _db.VolunteerOpportunities
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(opportunity =>
                    opportunity.Id == shift.OpportunityId
                    && opportunity.TenantId == tenantId
                    && opportunity.Status == OpportunityStatus.Published,
                    ct);
            if (!opportunityIsActive)
            {
                await transaction.RollbackAsync(ct);
                return false;
            }

            if (shift.MaxVolunteers > 0
                && await GetUsedShiftSlotsAsync(
                    shiftId,
                    tenantId,
                    includeOutstandingOffers: true,
                    ct: ct) >= shift.MaxVolunteers)
            {
                await transaction.RollbackAsync(ct);
                return false;
            }

            var recipientExists = await _db.Users
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(user => user.Id == candidate.UserId && user.TenantId == tenantId, ct);
            if (!recipientExists)
            {
                await transaction.RollbackAsync(ct);
                return false;
            }

            var now = DateTime.UtcNow;
            var updated = await _db.ShiftWaitlistEntries
                .IgnoreQueryFilters()
                .Where(waitlist =>
                    waitlist.Id == candidate.Id
                    && waitlist.TenantId == tenantId
                    && waitlist.ShiftId == shiftId
                    && waitlist.Status == "waiting")
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(waitlist => waitlist.Status, "notified")
                    .SetProperty(waitlist => waitlist.NotifiedAt, now),
                    ct);
            if (updated != 1)
            {
                await transaction.RollbackAsync(ct);
                return false;
            }

            await transaction.CommitAsync(ct);

            // Match Laravel's durability boundary: commit the offer before any
            // delivery channel runs so a channel outage cannot lose the place.
            await transaction.DisposeAsync();
            await TryDispatchWaitlistOfferAsync(
                candidate.UserId,
                candidate.Id,
                shiftId,
                tenantId);
            return true;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync(CancellationToken.None);
            _logger.LogError(
                ex,
                "Failed to notify next waitlisted volunteer for shift {ShiftId}, tenant {TenantId}",
                shiftId,
                tenantId);
            return false;
        }
    }

    private async Task TryDispatchWaitlistOfferAsync(
        int userId,
        int waitlistId,
        int shiftId,
        int tenantId)
    {
        const string title = "Volunteer shift spot available";
        const string body = "A spot opened up on a shift you're waitlisted for \u2014 claim it before it expires";
        const string link = "/volunteering?tab=waitlist";
        var data = JsonSerializer.Serialize(new
        {
            url = link,
            shift_id = shiftId,
            waitlist_id = waitlistId
        });
        var notification = new Notification
        {
            TenantId = tenantId,
            UserId = userId,
            Type = "vol_waitlist_spot",
            Title = title,
            Body = body,
            Data = data,
            Link = link,
            CreatedAt = DateTime.UtcNow
        };

        var bellCreated = false;
        try
        {
            _db.Notifications.Add(notification);
            await _db.SaveChangesAsync(CancellationToken.None);
            bellCreated = true;
        }
        catch (Exception ex)
        {
            _db.Entry(notification).State = EntityState.Detached;
            _logger.LogWarning(
                ex,
                "Waitlist offer {WaitlistId} committed, but its in-app notification could not be created",
                waitlistId);
        }

        if (bellCreated && _pushNotifications is not null)
        {
            var existingPushEntries = _db.ChangeTracker
                .Entries<PushNotificationLog>()
                .Select(entry => entry.Entity)
                .ToHashSet(ReferenceEqualityComparer.Instance);
            try
            {
                await _pushNotifications.SendPushAsync(
                    userId,
                    title,
                    body,
                    data,
                    tenantId);
            }
            catch (Exception ex)
            {
                foreach (var entry in _db.ChangeTracker.Entries<PushNotificationLog>()
                    .Where(entry => !existingPushEntries.Contains(entry.Entity)))
                {
                    entry.State = EntityState.Detached;
                }

                _logger.LogWarning(
                    ex,
                    "Waitlist offer {WaitlistId} committed, but its push could not be queued",
                    waitlistId);
            }
        }

        if (_emailNotifications is not null)
        {
            try
            {
                await _emailNotifications.SendTemplatedEmailAsync(
                    userId,
                    "vol_waitlist_spot",
                    new Dictionary<string, string>
                    {
                        ["message"] = body,
                        ["shift_id"] = shiftId.ToString(CultureInfo.InvariantCulture),
                        ["waitlist_id"] = waitlistId.ToString(CultureInfo.InvariantCulture),
                        ["volunteering_url"] = link
                    },
                    tenantId);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Waitlist offer {WaitlistId} committed, but its instant email could not be queued",
                    waitlistId);
            }
        }
    }

    public async Task<int> ExpireStaleWaitlistedVolunteerOffersAsync(
        int hours = 48,
        CancellationToken ct = default)
    {
        var cutoff = DateTime.UtcNow.AddHours(-Math.Max(1, hours));
        var stale = await _db.ShiftWaitlistEntries
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(waitlist =>
                waitlist.Status == "notified"
                && waitlist.NotifiedAt.HasValue
                && waitlist.NotifiedAt.Value < cutoff)
            .OrderBy(waitlist => waitlist.NotifiedAt)
            .Select(waitlist => new { waitlist.Id, waitlist.ShiftId, waitlist.TenantId })
            .Take(500)
            .ToListAsync(ct);

        var expired = 0;
        foreach (var snapshot in stale)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var didExpire = false;
                await using (var transaction = await _db.Database.BeginTransactionAsync(ct))
                {
                    await LockWaitlistQueueAsync(snapshot.ShiftId, snapshot.TenantId, ct);
                    if (!await LockNotifiedOfferByIdAsync(snapshot.Id, snapshot.TenantId, ct))
                    {
                        await transaction.RollbackAsync(ct);
                        continue;
                    }

                    var updated = await _db.ShiftWaitlistEntries
                        .IgnoreQueryFilters()
                        .Where(waitlist =>
                            waitlist.Id == snapshot.Id
                            && waitlist.TenantId == snapshot.TenantId
                            && waitlist.Status == "notified"
                            && waitlist.NotifiedAt.HasValue
                            && waitlist.NotifiedAt.Value < cutoff)
                        .ExecuteUpdateAsync(setters => setters
                            .SetProperty(waitlist => waitlist.Status, "expired"),
                            ct);
                    if (updated != 1)
                    {
                        await transaction.RollbackAsync(ct);
                        continue;
                    }

                    await transaction.CommitAsync(ct);
                    didExpire = true;
                }

                if (didExpire)
                {
                    expired++;
                    await NotifyNextWaitlistedVolunteerAsync(
                        snapshot.ShiftId,
                        snapshot.TenantId,
                        ct);
                }
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Failed to expire waitlist offer {WaitlistId} for tenant {TenantId}",
                    snapshot.Id,
                    snapshot.TenantId);
            }
        }

        return expired;
    }

    public Task<bool> IsVolunteeringEnabledAsync(CancellationToken ct = default) =>
        IsVolunteeringEnabledAsync(_tenant.GetTenantIdOrThrow(), ct);

    public async Task<bool> IsVolunteeringEnabledAsync(
        int tenantId,
        CancellationToken ct = default)
    {
        var value = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config =>
                config.TenantId == tenantId
                && config.Key == AdminVolunteerApprovalService.FeatureConfigKey)
            .Select(config => config.Value)
            .SingleOrDefaultAsync(ct);

        return string.IsNullOrWhiteSpace(value)
            || value.Trim().ToLowerInvariant() is not ("0" or "false" or "no" or "off" or "disabled");
    }

    public Task<bool> IsRecurringShiftsEnabledAsync(CancellationToken ct = default) =>
        IsRecurringShiftsEnabledAsync(_tenant.GetTenantIdOrThrow(), ct);

    public async Task<bool> SwapRequiresAdminApprovalAsync(
        int tenantId,
        CancellationToken ct = default)
    {
        var values = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config =>
                config.TenantId == tenantId
                && (config.Key == SwapRequiresAdminConfigKey
                    || config.Key == VolunteeringModuleConfigKey))
            .Select(config => new { config.Key, config.Value })
            .ToListAsync(ct);

        var direct = values.FirstOrDefault(config =>
            config.Key == SwapRequiresAdminConfigKey);
        if (direct is not null)
        {
            return ConfigValueIsEnabled(direct.Value, defaultValue: false);
        }

        var module = values.FirstOrDefault(config =>
            config.Key == VolunteeringModuleConfigKey);
        if (module is null || string.IsNullOrWhiteSpace(module.Value))
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(module.Value);
            return document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty(SwapRequiresAdminConfigKey, out var configured)
                && JsonValueIsEnabled(configured, defaultValue: false);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public async Task<bool> IsRecurringShiftsEnabledAsync(
        int tenantId,
        CancellationToken ct = default)
    {
        var values = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config =>
                config.TenantId == tenantId
                && (config.Key == RecurringShiftsEnabledConfigKey
                    || config.Key == VolunteeringModuleConfigKey))
            .Select(config => new { config.Key, config.Value })
            .ToListAsync(ct);

        var direct = values.FirstOrDefault(config =>
            config.Key == RecurringShiftsEnabledConfigKey);
        if (direct is not null)
        {
            return ConfigValueIsEnabled(direct.Value, defaultValue: true);
        }

        var module = values.FirstOrDefault(config =>
            config.Key == VolunteeringModuleConfigKey);
        if (module is null || string.IsNullOrWhiteSpace(module.Value))
        {
            return true;
        }

        try
        {
            using var document = JsonDocument.Parse(module.Value);
            return document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty(
                    RecurringShiftsEnabledConfigKey,
                    out var configured)
                || JsonValueIsEnabled(configured, defaultValue: true);
        }
        catch (JsonException)
        {
            return true;
        }
    }

    private static bool ConfigValueIsEnabled(string? value, bool defaultValue)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return defaultValue;
        }

        try
        {
            using var document = JsonDocument.Parse(value);
            return JsonValueIsEnabled(document.RootElement, defaultValue);
        }
        catch (JsonException)
        {
            var normalized = value.Trim().Trim('"').ToLowerInvariant();
            return normalized switch
            {
                "1" or "true" or "yes" or "on" or "enabled" => true,
                "0" or "false" or "no" or "off" or "disabled" => false,
                _ => defaultValue
            };
        }
    }

    private static bool JsonValueIsEnabled(JsonElement value, bool defaultValue) =>
        value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when value.TryGetInt32(out var number) => number != 0,
            JsonValueKind.String => ConfigValueIsEnabled(value.GetString(), defaultValue),
            _ => defaultValue
        };

    private async Task<long> GetUsedShiftSlotsAsync(
        int shiftId,
        int tenantId,
        bool includeOutstandingOffers,
        CancellationToken ct)
    {
        var approvedApplications = await _db.VolunteerApplications
            .IgnoreQueryFilters()
            .AsNoTracking()
            .LongCountAsync(application =>
                application.TenantId == tenantId
                && application.ShiftId == shiftId
                && application.Status == ApplicationStatus.Approved,
                ct);

        var activeReservedSlots = await _db.ShiftGroupReservations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(reservation =>
                reservation.TenantId == tenantId
                && reservation.ShiftId == shiftId
                && reservation.Status == "active")
            .SumAsync(reservation => reservation.ReservedSlots > 0
                ? (long)reservation.ReservedSlots
                : 0L,
                ct);

        if (!includeOutstandingOffers)
        {
            return approvedApplications + activeReservedSlots;
        }

        var outstandingOffers = await _db.ShiftWaitlistEntries
            .IgnoreQueryFilters()
            .AsNoTracking()
            .LongCountAsync(waitlist =>
                waitlist.TenantId == tenantId
                && waitlist.ShiftId == shiftId
                && waitlist.Status == "notified",
                ct);
        return approvedApplications + activeReservedSlots + outstandingOffers;
    }

    private async Task LockWaitlistQueueAsync(
        int shiftId,
        int tenantId,
        CancellationToken ct)
    {
        var connection = _db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText = "SELECT pg_advisory_xact_lock(@queue_key)";

        var keyParameter = command.CreateParameter();
        keyParameter.ParameterName = "queue_key";
        keyParameter.Value = ((long)tenantId << 32) | (uint)shiftId;
        command.Parameters.Add(keyParameter);
        await command.ExecuteScalarAsync(ct);
    }

    private async Task<LockedWaitingOffer?> LockNextWaitingOfferAsync(
        int shiftId,
        int tenantId,
        CancellationToken ct)
    {
        var connection = _db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText =
            "SELECT w.\"Id\", w.\"UserId\" FROM \"ShiftWaitlistEntries\" w " +
            "WHERE w.\"ShiftId\" = @shift_id AND w.\"TenantId\" = @tenant_id " +
            "AND w.\"Status\" = 'waiting' " +
            "AND EXISTS (SELECT 1 FROM users u WHERE u.\"Id\" = w.\"UserId\" " +
            "AND u.\"TenantId\" = @tenant_id) " +
            "ORDER BY w.\"Position\", w.\"Id\" LIMIT 1 FOR UPDATE";

        var shiftParameter = command.CreateParameter();
        shiftParameter.ParameterName = "shift_id";
        shiftParameter.Value = shiftId;
        command.Parameters.Add(shiftParameter);

        var tenantParameter = command.CreateParameter();
        tenantParameter.ParameterName = "tenant_id";
        tenantParameter.Value = tenantId;
        command.Parameters.Add(tenantParameter);

        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct)
            ? new LockedWaitingOffer(reader.GetInt32(0), reader.GetInt32(1))
            : null;
    }

    private async Task<bool> LockNotifiedOfferByIdAsync(
        int waitlistId,
        int tenantId,
        CancellationToken ct)
    {
        var connection = _db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText =
            "SELECT \"Id\" FROM \"ShiftWaitlistEntries\" " +
            "WHERE \"Id\" = @waitlist_id AND \"TenantId\" = @tenant_id " +
            "AND \"Status\" = 'notified' FOR UPDATE";

        var waitlistParameter = command.CreateParameter();
        waitlistParameter.ParameterName = "waitlist_id";
        waitlistParameter.Value = waitlistId;
        command.Parameters.Add(waitlistParameter);

        var tenantParameter = command.CreateParameter();
        tenantParameter.ParameterName = "tenant_id";
        tenantParameter.Value = tenantId;
        command.Parameters.Add(tenantParameter);

        return await command.ExecuteScalarAsync(ct) is not null;
    }

    private sealed record LockedWaitlistOffer(int Id, string Status, int Position);
    private sealed record LockedApprovedWaitlistApplication(int Id, int? ShiftId);
    private sealed record LockedWaitingOffer(int Id, int UserId);

    // ── Group Reservations ────────────────────────────────────────────────────

    public async Task<IReadOnlyList<GroupReservationListItem>> GetUserGroupReservationsAsync(
        int userId,
        CancellationToken ct = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var rows = await (
            from reservation in _db.ShiftGroupReservations.IgnoreQueryFilters().AsNoTracking()
            join shift in _db.VolunteerShifts.IgnoreQueryFilters().AsNoTracking()
                on new { reservation.ShiftId, reservation.TenantId }
                equals new { ShiftId = shift.Id, shift.TenantId }
            join opportunity in _db.VolunteerOpportunities.IgnoreQueryFilters().AsNoTracking()
                on new { shift.OpportunityId, shift.TenantId }
                equals new { OpportunityId = opportunity.Id, opportunity.TenantId }
            join groupSeed in _db.Groups.IgnoreQueryFilters().AsNoTracking()
                on new { reservation.GroupId, reservation.TenantId }
                equals new { GroupId = groupSeed.Id, groupSeed.TenantId }
                into groups
            from groupRow in groups.DefaultIfEmpty()
            where reservation.TenantId == tenantId
                && (reservation.ReservedBy == userId
                    || _db.ShiftGroupMembers.IgnoreQueryFilters().Any(member =>
                        member.TenantId == tenantId
                        && member.ReservationId == reservation.Id
                        && member.UserId == userId
                        && member.Status == "confirmed"))
            orderby shift.StartsAt, reservation.Id
            select new
            {
                reservation.Id,
                reservation.GroupId,
                GroupName = groupRow == null ? string.Empty : groupRow.Name,
                reservation.Status,
                reservation.ReservedBy,
                reservation.ReservedSlots,
                reservation.CreatedAt,
                ShiftId = shift.Id,
                shift.StartsAt,
                shift.EndsAt,
                OpportunityId = opportunity.Id,
                OpportunityTitle = opportunity.Title,
                OpportunityLocation = opportunity.Location ?? string.Empty
            })
            .ToListAsync(ct);

        if (rows.Count == 0)
        {
            return Array.Empty<GroupReservationListItem>();
        }

        var reservationIds = rows.Select(row => row.Id).ToList();
        var memberRows = await (
            from member in _db.ShiftGroupMembers.IgnoreQueryFilters().AsNoTracking()
            join user in _db.Users.IgnoreQueryFilters().AsNoTracking()
                on new { member.UserId, member.TenantId }
                equals new { UserId = user.Id, user.TenantId }
            where member.TenantId == tenantId
                && reservationIds.Contains(member.ReservationId)
            orderby member.CreatedAt, member.Id
            select new
            {
                member.ReservationId,
                member.UserId,
                user.FirstName,
                user.LastName,
                user.AvatarUrl,
                member.Status,
                member.CreatedAt
            })
            .ToListAsync(ct);

        var membersByReservation = memberRows
            .GroupBy(member => member.ReservationId)
            .ToDictionary(
                memberGroup => memberGroup.Key,
                memberGroup => (IReadOnlyList<GroupReservationMemberItem>)memberGroup
                    .Select(member => new GroupReservationMemberItem(
                        member.UserId,
                        $"{member.FirstName} {member.LastName}".Trim(),
                        member.AvatarUrl,
                        member.Status,
                        member.CreatedAt))
                    .ToList());

        return rows.Select(row => new GroupReservationListItem(
                row.Id,
                row.GroupName,
                row.Status,
                row.ReservedBy == userId,
                new GroupReservationShiftItem(row.ShiftId, row.StartsAt, row.EndsAt),
                new GroupReservationOpportunityItem(
                    row.OpportunityId,
                    row.OpportunityTitle,
                    row.OpportunityLocation),
                membersByReservation.GetValueOrDefault(
                    row.Id,
                    Array.Empty<GroupReservationMemberItem>()),
                row.ReservedSlots,
                row.CreatedAt))
            .ToList();
    }

    public async Task<(ShiftGroupReservation? Reservation, string? Error)> CreateGroupReservationAsync(
        int shiftId, int userId, GroupReservationRequest req)
    {
        if (req.ReservedSlots < 1)
        {
            return (null, "Must reserve at least 1 slot");
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        ShiftGroupReservation? reservation = null;

        await using var transaction = await _db.Database.BeginTransactionAsync();
        try
        {
            // AdminVolunteerApprovalService takes this same tenant-scoped row lock
            // before approving a shift application. Serializing both workflows on
            // the shift prevents an approval and a group reservation from each
            // consuming the final place from stale capacity snapshots.
            if (!await LockShiftAsync(shiftId, tenantId))
            {
                await transaction.RollbackAsync();
                return (null, "Shift not found");
            }

            var shift = await _db.VolunteerShifts
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(s => s.Id == shiftId && s.TenantId == tenantId)
                .Select(s => new { s.OpportunityId, s.StartsAt, s.MaxVolunteers })
                .SingleAsync();

            if (shift.StartsAt <= DateTime.UtcNow)
            {
                await transaction.RollbackAsync();
                return (null, "Cannot reserve slots for a shift that has already started");
            }

            var opportunityIsActive = await _db.VolunteerOpportunities
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(o =>
                    o.Id == shift.OpportunityId
                    && o.TenantId == tenantId
                    && o.Status == OpportunityStatus.Published);
            if (!opportunityIsActive)
            {
                await transaction.RollbackAsync();
                return (null, "Opportunity not found or is not active");
            }

            var group = await _db.Groups
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(g => g.Id == req.GroupId && g.TenantId == tenantId)
                .Select(g => new { g.Id, g.CreatedById })
                .SingleOrDefaultAsync();
            if (group is null)
            {
                await transaction.RollbackAsync();
                return (null, "Group not found");
            }

            if (!await CanManageGroupAsync(group.Id, group.CreatedById, userId, tenantId))
            {
                await transaction.RollbackAsync();
                return (null, "Only group leaders/admins can reserve slots for this group");
            }

            if (shift.MaxVolunteers > 0)
            {
                var approvedApplications = await _db.VolunteerApplications
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .LongCountAsync(application =>
                        application.TenantId == tenantId
                        && application.ShiftId == shiftId
                        && application.Status == ApplicationStatus.Approved);

                var activeReservedSlots = await _db.ShiftGroupReservations
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(existing =>
                        existing.TenantId == tenantId
                        && existing.ShiftId == shiftId
                        && existing.Status == "active")
                    .SumAsync(existing => existing.ReservedSlots > 0
                        ? (long)existing.ReservedSlots
                        : 0L);

                var availableSlots = Math.Max(0L, shift.MaxVolunteers - approvedApplications - activeReservedSlots);
                if (req.ReservedSlots > availableSlots)
                {
                    await transaction.RollbackAsync();
                    return (null, $"Only {availableSlots} slots available");
                }
            }

            var alreadyExists = await _db.ShiftGroupReservations
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(existing =>
                    existing.TenantId == tenantId
                    && existing.ShiftId == shiftId
                    && existing.GroupId == req.GroupId
                    && existing.Status == "active");
            if (alreadyExists)
            {
                await transaction.RollbackAsync();
                return (null, "This group already has a reservation for this shift");
            }

            reservation = new ShiftGroupReservation
            {
                TenantId = tenantId,
                ShiftId = shiftId,
                GroupId = req.GroupId,
                ReservedBy = userId,
                ReservedSlots = req.ReservedSlots,
                Notes = req.Notes,
                Status = "active"
            };

            _db.ShiftGroupReservations.Add(reservation);
            await _db.SaveChangesAsync();
            await transaction.CommitAsync();
            return (reservation, null);
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync();
            if (reservation is not null)
            {
                _db.Entry(reservation).State = EntityState.Detached;
            }

            _logger.LogError(
                ex,
                "Failed to create group reservation for tenant {TenantId}, shift {ShiftId}, group {GroupId}",
                tenantId,
                shiftId,
                req.GroupId);
            return (null, "Failed to create reservation");
        }
    }

    private async Task<bool> LockShiftAsync(
        int shiftId,
        int tenantId,
        CancellationToken ct = default)
    {
        var connection = _db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText =
            "SELECT \"Id\" FROM volunteer_shifts " +
            "WHERE \"Id\" = @shift_id AND \"TenantId\" = @tenant_id FOR UPDATE";

        var shiftParameter = command.CreateParameter();
        shiftParameter.ParameterName = "shift_id";
        shiftParameter.Value = shiftId;
        command.Parameters.Add(shiftParameter);

        var tenantParameter = command.CreateParameter();
        tenantParameter.ParameterName = "tenant_id";
        tenantParameter.Value = tenantId;
        command.Parameters.Add(tenantParameter);

        return await command.ExecuteScalarAsync(ct) is not null;
    }

    private async Task<bool> CanManageGroupAsync(
        int groupId,
        int groupCreatorId,
        int userId,
        int tenantId)
    {
        var user = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(candidate =>
                candidate.Id == userId
                && candidate.TenantId == tenantId
                && candidate.IsActive)
            .Select(candidate => new
            {
                candidate.Role,
                candidate.IsAdmin,
                candidate.IsSuperAdmin,
                candidate.IsTenantSuperAdmin,
                candidate.IsGod
            })
            .SingleOrDefaultAsync();

        if (user is null)
        {
            return false;
        }

        if (groupCreatorId == userId
            || user.IsAdmin
            || user.IsSuperAdmin
            || user.IsTenantSuperAdmin
            || user.IsGod
            || user.Role is "admin" or "tenant_admin" or "tenant_super_admin" or "super_admin")
        {
            return true;
        }

        return await _db.GroupMembers
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(member =>
                member.TenantId == tenantId
                && member.GroupId == groupId
                && member.UserId == userId
                && (member.Role == Group.Roles.Owner || member.Role == Group.Roles.Admin));
    }

    private async Task<bool> CanManageGroupAsync(int groupId, int userId, int tenantId)
    {
        var groupCreatorId = await _db.Groups
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(group => group.Id == groupId && group.TenantId == tenantId)
            .Select(group => (int?)group.CreatedById)
            .SingleOrDefaultAsync();

        return groupCreatorId.HasValue
            && await CanManageGroupAsync(groupId, groupCreatorId.Value, userId, tenantId);
    }

    public async Task<(ShiftGroupMember? Member, string? Error)> AddGroupMemberAsync(
        int reservationId, int userId, AddGroupMemberRequest req)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        await using var transaction = await _db.Database.BeginTransactionAsync();
        try
        {
            // Cancellation and member additions take the same reservation lock,
            // so a cancelled reservation cannot gain a late member and two adds
            // cannot both consume the final reserved place.
            var reservation = await LockGroupReservationAsync(reservationId, tenantId);
            if (reservation is null)
            {
                await transaction.RollbackAsync();
                return (null, "Reservation not found");
            }

            if (reservation.ReservedBy != userId
                && !await CanManageGroupAsync(reservation.GroupId, userId, tenantId))
            {
                await transaction.RollbackAsync();
                return (null, "Only group leaders/admins can manage this reservation");
            }

            var targetIsTenantUser = await _db.Users
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(candidate => candidate.Id == req.UserId && candidate.TenantId == tenantId);
            if (!targetIsTenantUser)
            {
                await transaction.RollbackAsync();
                return (null, "Invalid user");
            }

            var opportunityId = await _db.VolunteerShifts
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(shift => shift.Id == reservation.ShiftId && shift.TenantId == tenantId)
                .Select(shift => (int?)shift.OpportunityId)
                .SingleOrDefaultAsync();
            if (await _guardianConsent.IsBlockedAsync(
                req.UserId,
                tenantId,
                opportunityId))
            {
                await transaction.RollbackAsync();
                return (null, VolunteerGuardianConsentService.RequiredMessage);
            }

            if (reservation.FilledSlots >= reservation.ReservedSlots)
            {
                await transaction.RollbackAsync();
                return (null, "All reserved slots are filled");
            }

            // Cancelled members retain their row in the Laravel workflow. Heal a
            // legacy/malformed tenant id when reactivating instead of inserting a
            // second row for the same reservation and user.
            var member = await _db.ShiftGroupMembers
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(existing =>
                    existing.ReservationId == reservationId
                    && existing.UserId == req.UserId);
            if (member?.Status == "confirmed")
            {
                await transaction.RollbackAsync();
                return (null, "User is already in this group reservation");
            }

            if (member is null)
            {
                member = new ShiftGroupMember
                {
                    TenantId = tenantId,
                    ReservationId = reservationId,
                    UserId = req.UserId,
                    Status = "confirmed"
                };
                _db.ShiftGroupMembers.Add(member);
            }
            else
            {
                member.TenantId = tenantId;
                member.Status = "confirmed";
            }

            var updated = await _db.ShiftGroupReservations
                .IgnoreQueryFilters()
                .Where(existing =>
                    existing.Id == reservationId
                    && existing.TenantId == tenantId
                    && existing.Status == "active"
                    && existing.FilledSlots < existing.ReservedSlots)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(existing => existing.FilledSlots, existing => existing.FilledSlots + 1));
            if (updated != 1)
            {
                await transaction.RollbackAsync();
                return (null, "All reserved slots are filled");
            }

            await _db.SaveChangesAsync();
            await transaction.CommitAsync();
            return (member, null);
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync();
            _logger.LogError(
                ex,
                "Failed to add user {TargetUserId} to group reservation {ReservationId} for tenant {TenantId}",
                req.UserId,
                reservationId,
                tenantId);
            return (null, "Failed to add member");
        }
    }

    public async Task<string?> RemoveGroupMemberAsync(
        int reservationId,
        int targetIdentifier,
        int leaderUserId,
        bool identifierIsLegacyMemberId = false,
        CancellationToken ct = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        await using var transaction = await _db.Database.BeginTransactionAsync(ct);
        try
        {
            var reservation = await LockGroupReservationAsync(
                reservationId,
                tenantId,
                activeOnly: false,
                ct: ct);
            if (reservation is null)
            {
                await transaction.RollbackAsync(ct);
                return "Reservation not found";
            }

            if (reservation.ReservedBy != leaderUserId
                && !await CanManageGroupAsync(reservation.GroupId, leaderUserId, tenantId))
            {
                await transaction.RollbackAsync(ct);
                return "Only group leaders/admins can manage this reservation";
            }

            var targetUserId = targetIdentifier;
            if (identifierIsLegacyMemberId)
            {
                var legacyTarget = await _db.ShiftGroupMembers
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(member =>
                        member.Id == targetIdentifier
                        && member.ReservationId == reservationId
                        && member.Status == "confirmed")
                    .Select(member => (int?)member.UserId)
                    .SingleOrDefaultAsync(ct);
                if (!legacyTarget.HasValue)
                {
                    await transaction.RollbackAsync(ct);
                    return "Member not found in this reservation";
                }

                targetUserId = legacyTarget.Value;
            }

            var targetIsTenantUser = await _db.Users
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(user => user.Id == targetUserId && user.TenantId == tenantId, ct);
            if (!targetIsTenantUser)
            {
                await transaction.RollbackAsync(ct);
                return "Invalid user";
            }

            var memberUpdated = await _db.ShiftGroupMembers
                .IgnoreQueryFilters()
                .Where(member =>
                    member.ReservationId == reservationId
                    && member.UserId == targetUserId
                    && member.Status == "confirmed")
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(member => member.Status, "cancelled"),
                    ct);
            if (memberUpdated != 1)
            {
                await transaction.RollbackAsync(ct);
                return "Member not found in this reservation";
            }

            var reservationUpdated = await _db.ShiftGroupReservations
                .IgnoreQueryFilters()
                .Where(row => row.Id == reservationId && row.TenantId == tenantId)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(
                        row => row.FilledSlots,
                        row => row.FilledSlots > 0 ? row.FilledSlots - 1 : 0),
                    ct);
            if (reservationUpdated != 1)
            {
                await transaction.RollbackAsync(ct);
                return "Reservation not found";
            }

            await transaction.CommitAsync(ct);
            return null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync(CancellationToken.None);
            _logger.LogError(
                ex,
                "Failed to remove user {TargetIdentifier} from group reservation {ReservationId} in tenant {TenantId}",
                targetIdentifier,
                reservationId,
                tenantId);
            return "Failed to remove member";
        }
    }

    public async Task<string?> CancelGroupReservationAsync(int reservationId, int userId)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        await using var transaction = await _db.Database.BeginTransactionAsync();
        try
        {
            var reservation = await LockGroupReservationAsync(reservationId, tenantId);
            if (reservation is null)
            {
                await transaction.RollbackAsync();
                return "Reservation not found";
            }

            if (reservation.ReservedBy != userId
                && !await CanManageGroupAsync(reservation.GroupId, userId, tenantId))
            {
                await transaction.RollbackAsync();
                return "Only group leaders/admins can cancel this reservation";
            }

            var updated = await _db.ShiftGroupReservations
                .IgnoreQueryFilters()
                .Where(existing =>
                    existing.Id == reservationId
                    && existing.TenantId == tenantId
                    && existing.Status == "active")
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(existing => existing.Status, "cancelled"));
            if (updated != 1)
            {
                await transaction.RollbackAsync();
                return "Reservation not found";
            }

            await _db.ShiftGroupMembers
                .IgnoreQueryFilters()
                .Where(member =>
                    member.ReservationId == reservationId
                    && member.Status == "confirmed")
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(member => member.Status, "cancelled"));

            await transaction.CommitAsync();
            return null;
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync();
            _logger.LogError(
                ex,
                "Failed to cancel group reservation {ReservationId} for tenant {TenantId}",
                reservationId,
                tenantId);
            return "Failed to cancel reservation";
        }
    }

    private async Task<LockedGroupReservation?> LockGroupReservationAsync(
        int reservationId,
        int tenantId,
        bool activeOnly = true,
        CancellationToken ct = default)
    {
        var connection = _db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText =
            "SELECT \"GroupId\", \"ReservedBy\", \"ReservedSlots\", \"FilledSlots\", \"ShiftId\" " +
            "FROM \"ShiftGroupReservations\" " +
            "WHERE \"Id\" = @reservation_id AND \"TenantId\" = @tenant_id " +
            (activeOnly ? "AND \"Status\" = 'active' " : string.Empty) +
            "FOR UPDATE";

        var reservationParameter = command.CreateParameter();
        reservationParameter.ParameterName = "reservation_id";
        reservationParameter.Value = reservationId;
        command.Parameters.Add(reservationParameter);

        var tenantParameter = command.CreateParameter();
        tenantParameter.ParameterName = "tenant_id";
        tenantParameter.Value = tenantId;
        command.Parameters.Add(tenantParameter);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return null;
        }

        return new LockedGroupReservation(
            reader.GetInt32(0),
            reader.GetInt32(1),
            reader.GetInt32(2),
            reader.GetInt32(3),
            reader.GetInt32(4));
    }

    private sealed record LockedGroupReservation(
        int GroupId,
        int ReservedBy,
        int ReservedSlots,
        int FilledSlots,
        int ShiftId);
}
