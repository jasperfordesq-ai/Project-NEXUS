// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Tenant-scoped KISS support relationship read model matching Laravel admin endpoints.
/// </summary>
public sealed class CaringSupportRelationshipService
{
    private static readonly string[] Frequencies = ["weekly", "fortnightly", "monthly", "ad_hoc"];
    private static readonly string[] Statuses = ["active", "paused", "completed", "cancelled"];
    private const string DateFormat = "yyyy-MM-dd";
    private const string DefaultTitle = "Recurring support relationship";

    private readonly NexusDbContext _db;
    private readonly ICaringHelpRequestVoiceProcessor? _voiceProcessor;
    private readonly VolunteerHoursService _volunteerHours;
    private readonly CaringRegionalPointService _regionalPoints;

    public CaringSupportRelationshipService(
        NexusDbContext db,
        ICaringHelpRequestVoiceProcessor? voiceProcessor = null)
        : this(
            db,
            voiceProcessor,
            new VolunteerHoursService(db),
            new CaringRegionalPointService(db))
    {
    }

    public CaringSupportRelationshipService(
        NexusDbContext db,
        ICaringHelpRequestVoiceProcessor? voiceProcessor,
        VolunteerHoursService volunteerHours)
        : this(db, voiceProcessor, volunteerHours, new CaringRegionalPointService(db))
    {
    }

    public CaringSupportRelationshipService(
        NexusDbContext db,
        ICaringHelpRequestVoiceProcessor? voiceProcessor,
        VolunteerHoursService volunteerHours,
        CaringRegionalPointService regionalPoints)
    {
        _db = db;
        _voiceProcessor = voiceProcessor;
        _volunteerHours = volunteerHours;
        _regionalPoints = regionalPoints;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(config => config.TenantId == tenantId && config.Key == "features.caring_community")
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return IsTruthy(raw);
    }

    public async Task<object> ListAsync(int tenantId, string? status, CancellationToken ct)
    {
        var requestedStatus = NormalizeStatus(status);
        var relationships = await _db.CaringSupportRelationships
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(relationship => relationship.TenantId == tenantId)
            .ToListAsync(ct);

        var userIds = relationships
            .SelectMany(relationship => new[] { relationship.SupporterId, relationship.RecipientId, relationship.CoordinatorId ?? 0 })
            .Where(id => id > 0)
            .Distinct()
            .ToArray();
        var users = userIds.Length == 0
            ? new Dictionary<int, User>()
            : await _db.Users
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(user => user.TenantId == tenantId && userIds.Contains(user.Id))
                .ToDictionaryAsync(user => user.Id, ct);

        var categoryIds = relationships
            .Where(relationship => relationship.CategoryId is not null)
            .Select(relationship => relationship.CategoryId!.Value)
            .Distinct()
            .ToArray();
        var categories = categoryIds.Length == 0
            ? new Dictionary<int, string>()
            : await _db.Categories
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(category => category.TenantId == tenantId && categoryIds.Contains(category.Id))
                .ToDictionaryAsync(category => category.Id, category => category.Name, ct);

        var items = relationships
            .Where(relationship => requestedStatus == "all" || relationship.Status == requestedStatus)
            .OrderBy(relationship => StatusRank(relationship.Status))
            .ThenBy(relationship => relationship.NextCheckInAt ?? relationship.CreatedAt)
            .ThenByDescending(relationship => relationship.Id)
            .Take(100)
            .Select(relationship => RelationshipRow(relationship, users, categories))
            .Cast<object>()
            .ToArray();

        return new
        {
            stats = Stats(relationships),
            items
        };
    }

    public async Task<SupportRelationshipCreateResult> CreateAsync(
        int tenantId,
        int coordinatorId,
        IReadOnlyDictionary<string, object?>? input,
        CancellationToken ct)
    {
        var supporterId = IntValue(input, "supporter_id");
        var recipientId = IntValue(input, "recipient_id");
        if (supporterId <= 0 || recipientId <= 0 || supporterId == recipientId)
        {
            return SupportRelationshipCreateResult.Fail("VALIDATION_ERROR");
        }

        var tenantUserIds = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.TenantId == tenantId && (user.Id == supporterId || user.Id == recipientId))
            .Select(user => user.Id)
            .Distinct()
            .ToArrayAsync(ct);
        if (!tenantUserIds.Contains(supporterId) || !tenantUserIds.Contains(recipientId))
        {
            return SupportRelationshipCreateResult.Fail("USER_NOT_FOUND");
        }

        var frequency = NormalizeFrequency(StringValue(input, "frequency"));
        var startDate = DateValue(StringValue(input, "start_date"))
            ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var now = DateTime.UtcNow;
        var relationship = new CaringSupportRelationship
        {
            TenantId = tenantId,
            SupporterId = supporterId,
            RecipientId = recipientId,
            CoordinatorId = coordinatorId > 0 ? coordinatorId : null,
            OrganizationId = null,
            CategoryId = await TenantCategoryIdAsync(tenantId, IntValue(input, "category_id"), ct),
            Title = Truncate((StringValue(input, "title") ?? DefaultTitle).Trim(), 255),
            Description = NullIfEmpty(StringValue(input, "description")?.Trim()),
            Frequency = frequency,
            ExpectedHours = Math.Clamp(DecimalValue(input, "expected_hours") ?? 1m, 0.25m, 24m),
            StartDate = startDate,
            EndDate = DateValue(StringValue(input, "end_date")),
            Status = "active",
            NextCheckInAt = NextCheckIn(startDate, frequency),
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringSupportRelationships.Add(relationship);
        await UpsertSuggestionLogAsync(tenantId, supporterId, recipientId, coordinatorId, now, ct);
        await _db.SaveChangesAsync(ct);

        var users = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user =>
                user.TenantId == tenantId
                && (user.Id == supporterId || user.Id == recipientId || user.Id == relationship.CoordinatorId))
            .ToDictionaryAsync(user => user.Id, ct);
        var categories = relationship.CategoryId is null
            ? new Dictionary<int, string>()
            : await _db.Categories
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(category => category.TenantId == tenantId && category.Id == relationship.CategoryId.Value)
                .ToDictionaryAsync(category => category.Id, category => category.Name, ct);

        return SupportRelationshipCreateResult.Success(RelationshipRow(relationship, users, categories));
    }

    public async Task<SupportRelationshipUpdateResult> UpdateAsync(
        int tenantId,
        int relationshipId,
        IReadOnlyDictionary<string, object?>? input,
        CancellationToken ct)
    {
        var relationship = await _db.CaringSupportRelationships
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == relationshipId, ct);
        if (relationship is null)
        {
            return SupportRelationshipUpdateResult.NotFound();
        }

        if (HasKey(input, "status"))
        {
            var status = StringValue(input, "status") ?? string.Empty;
            if (Statuses.Contains(status, StringComparer.Ordinal))
            {
                relationship.Status = status;
            }
        }

        if (HasKey(input, "frequency"))
        {
            relationship.Frequency = NormalizeFrequency(StringValue(input, "frequency"));
        }

        if (HasKey(input, "expected_hours"))
        {
            relationship.ExpectedHours = Math.Clamp(DecimalValue(input, "expected_hours") ?? 0m, 0.25m, 24m);
        }

        if (HasKey(input, "title"))
        {
            relationship.Title = Truncate((StringValue(input, "title") ?? string.Empty).Trim(), 255);
        }

        if (HasKey(input, "description"))
        {
            relationship.Description = NullIfEmpty((StringValue(input, "description") ?? string.Empty).Trim());
        }

        if (HasKey(input, "next_check_in_at"))
        {
            relationship.NextCheckInAt = DateTimeValue(StringValue(input, "next_check_in_at"));
        }

        if (HasKey(input, "last_logged_at"))
        {
            relationship.LastLoggedAt = DateTimeValue(StringValue(input, "last_logged_at"));
        }

        relationship.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var users = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user =>
                user.TenantId == tenantId
                && (user.Id == relationship.SupporterId
                    || user.Id == relationship.RecipientId
                    || user.Id == relationship.CoordinatorId))
            .ToDictionaryAsync(user => user.Id, ct);
        var categories = relationship.CategoryId is null
            ? new Dictionary<int, string>()
            : await _db.Categories
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(category => category.TenantId == tenantId && category.Id == relationship.CategoryId.Value)
                .ToDictionaryAsync(category => category.Id, category => category.Name, ct);

        return SupportRelationshipUpdateResult.Success(RelationshipRow(relationship, users, categories));
    }

    public async Task<MemberHelpRequestResult> CreateMemberHelpRequestAsync(
        int tenantId,
        int userId,
        IReadOnlyDictionary<string, object?>? input,
        CancellationToken ct)
    {
        var errors = new List<MemberHelpRequestError>();
        var what = (StringValue(input, "what") ?? string.Empty).Trim();
        var whenNeeded = (StringValue(input, "when") ?? string.Empty).Trim();
        var contactPreference = NormalizeContactPreference(StringValue(input, "contact_preference"));

        if (what.Length == 0)
        {
            errors.Add(new MemberHelpRequestError("VALIDATION_ERROR", "Validation failed.", "what"));
        }
        else if (what.Length > 500)
        {
            errors.Add(new MemberHelpRequestError("VALIDATION_ERROR", "Validation failed.", "what"));
        }

        if (whenNeeded.Length == 0)
        {
            errors.Add(new MemberHelpRequestError("VALIDATION_ERROR", "Validation failed.", "when"));
        }
        else if (whenNeeded.Length > 200)
        {
            errors.Add(new MemberHelpRequestError("VALIDATION_ERROR", "Validation failed.", "when"));
        }

        if (errors.Count > 0)
        {
            return MemberHelpRequestResult.Validation(errors);
        }

        var now = DateTime.UtcNow;
        var request = new CaringHelpRequest
        {
            TenantId = tenantId,
            UserId = userId,
            What = what,
            WhenNeeded = whenNeeded,
            ContactPreference = contactPreference,
            Status = "pending",
            IsOnBehalf = false,
            RequestedById = null,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringHelpRequests.Add(request);
        await _db.SaveChangesAsync(ct);

        return MemberHelpRequestResult.Created();
    }

    public async Task<MemberHelpRequestVoiceResult> ProcessMemberHelpRequestVoiceAsync(
        int tenantId,
        int userId,
        Stream audio,
        string? fileName,
        string contentType,
        string locale,
        CancellationToken ct)
    {
        if (_voiceProcessor is null)
        {
            return MemberHelpRequestVoiceResult.Failed("TRANSCRIPTION_FAILED");
        }

        return await _voiceProcessor.ProcessAsync(
            tenantId,
            userId,
            audio,
            fileName,
            contentType,
            locale,
            ct);
    }

    public async Task<SupportRelationshipLogHoursResult> LogHoursAsync(
        int tenantId,
        int relationshipId,
        int coordinatorId,
        IReadOnlyDictionary<string, object?>? input,
        CancellationToken ct)
    {
        var date = DateValue(StringValue(input, "date"));
        var hours = DecimalValue(input, "hours") ?? 0m;
        if (date is null || date.Value > DateOnly.FromDateTime(DateTime.UtcNow) || hours <= 0m || hours > 24m)
        {
            return SupportRelationshipLogHoursResult.Fail("VALIDATION_ERROR");
        }

        var ledgerResult = await _volunteerHours.LogCaringRelationshipAsync(
            tenantId,
            relationshipId,
            date.Value,
            hours,
            StringValue(input, "description"),
            await _volunteerHours.ResolveCaringRelationshipStatusAsync(tenantId, coordinatorId, ct),
            ct);
        if (!ledgerResult.IsSuccess)
            return SupportRelationshipLogHoursResult.Fail(ledgerResult.ErrorCode ?? "SERVER_ERROR");

        var log = ledgerResult.Log!;
        var relationship = ledgerResult.Relationship!;
        RegionalPointHoursAwardResult? regionalPointsResult = null;
        if (string.Equals(log.Status, "approved", StringComparison.Ordinal))
        {
            try
            {
                regionalPointsResult = await _regionalPoints.AwardForApprovedHoursAsync(
                    tenantId,
                    log.UserId,
                    log.Id,
                    hours,
                    coordinatorId,
                    ct);
            }
            catch
            {
                // Laravel treats regional points as an additive, best-effort
                // reward; a provider/storage failure must not undo paid hours.
                regionalPointsResult = null;
            }
        }

        var users = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user =>
                user.TenantId == tenantId
                && (user.Id == relationship.SupporterId
                    || user.Id == relationship.RecipientId
                    || user.Id == relationship.CoordinatorId))
            .ToDictionaryAsync(user => user.Id, ct);
        var categories = relationship.CategoryId is null
            ? new Dictionary<int, string>()
            : await _db.Categories
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(category => category.TenantId == tenantId && category.Id == relationship.CategoryId.Value)
                .ToDictionaryAsync(category => category.Id, category => category.Name, ct);

        return SupportRelationshipLogHoursResult.Success(new
        {
            success = true,
            log = new
            {
                id = log.Id,
                status = log.Status,
                hours = Math.Round(log.Hours, 2, MidpointRounding.AwayFromZero),
                date_logged = log.DateLogged.ToString(DateFormat, CultureInfo.InvariantCulture),
                payment_result = ledgerResult.PaymentOutcome,
                regional_points_result = regionalPointsResult
            },
            relationship = RelationshipRow(relationship, users, categories)
        });
    }

    public async Task<IReadOnlyList<object>> ListForMemberAsync(int tenantId, int userId, CancellationToken ct)
    {
        var relationships = await _db.CaringSupportRelationships
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(relationship =>
                relationship.TenantId == tenantId
                && (relationship.SupporterId == userId || relationship.RecipientId == userId)
                && (relationship.Status == "active" || relationship.Status == "paused"))
            .OrderBy(relationship => relationship.Status == "active" ? 0 : 1)
            .ThenBy(relationship => relationship.NextCheckInAt ?? relationship.CreatedAt)
            .ThenByDescending(relationship => relationship.Id)
            .Take(50)
            .ToListAsync(ct);

        if (relationships.Count == 0)
        {
            return [];
        }

        var userIds = relationships
            .SelectMany(relationship => new[] { relationship.SupporterId, relationship.RecipientId })
            .Distinct()
            .ToArray();
        var users = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.TenantId == tenantId && userIds.Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, ct);

        var relationshipIds = relationships
            .Select(relationship => relationship.Id)
            .ToArray();
        var logs = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(log =>
                log.TenantId == tenantId
                && log.CaringSupportRelationshipId != null
                && relationshipIds.Contains(log.CaringSupportRelationshipId.Value))
            .OrderByDescending(log => log.DateLogged)
            .ThenByDescending(log => log.Id)
            .ToListAsync(ct);

        var logsByRelationship = logs
            .GroupBy(log => log.CaringSupportRelationshipId!.Value)
            .ToDictionary(
                group => group.Key,
                group => group.Take(3).Select(LogRow).Cast<object>().ToArray());

        return relationships
            .Select(relationship => MemberRelationshipRow(relationship, userId, users, logsByRelationship))
            .Cast<object>()
            .ToArray();
    }

    public Task<RelationshipLifecycleResult> PauseRelationshipAsync(
        int tenantId,
        int userId,
        int relationshipId,
        string? resumeAt,
        CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(resumeAt)
            && !DateOnly.TryParseExact(
                resumeAt,
                DateFormat,
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out _))
        {
            return Task.FromResult(RelationshipLifecycleResult.ValidationError("resume_at"));
        }

        return ChangeRelationshipStatusAsync(
            tenantId,
            userId,
            relationshipId,
            allowedStatuses: ["active"],
            targetStatus: "paused",
            endDate: null,
            ct);
    }

    public Task<RelationshipLifecycleResult> EndRelationshipAsync(
        int tenantId,
        int userId,
        int relationshipId,
        CancellationToken ct)
    {
        return ChangeRelationshipStatusAsync(
            tenantId,
            userId,
            relationshipId,
            allowedStatuses: ["active", "paused"],
            targetStatus: "cancelled",
            endDate: DateOnly.FromDateTime(DateTime.UtcNow),
            ct);
    }

    public Task<RelationshipLifecycleResult> ResumeRelationshipAsync(
        int tenantId,
        int userId,
        int relationshipId,
        CancellationToken ct)
    {
        return ChangeRelationshipStatusAsync(
            tenantId,
            userId,
            relationshipId,
            allowedStatuses: ["paused"],
            targetStatus: "active",
            endDate: null,
            ct);
    }

    private async Task<RelationshipLifecycleResult> ChangeRelationshipStatusAsync(
        int tenantId,
        int userId,
        int relationshipId,
        string[] allowedStatuses,
        string targetStatus,
        DateOnly? endDate,
        CancellationToken ct)
    {
        var relationship = await _db.CaringSupportRelationships
            .IgnoreQueryFilters()
            .Where(row =>
                row.TenantId == tenantId
                && row.Id == relationshipId
                && (row.SupporterId == userId || row.RecipientId == userId))
            .FirstOrDefaultAsync(ct);

        if (relationship is null)
        {
            return RelationshipLifecycleResult.NotFound();
        }

        if (!allowedStatuses.Contains(relationship.Status))
        {
            return RelationshipLifecycleResult.InvalidState();
        }

        relationship.Status = targetStatus;
        relationship.EndDate = endDate ?? relationship.EndDate;
        relationship.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return RelationshipLifecycleResult.Success(targetStatus);
    }

    private async Task UpsertSuggestionLogAsync(
        int tenantId,
        int supporterId,
        int recipientId,
        int coordinatorId,
        DateTime now,
        CancellationToken ct)
    {
        var low = Math.Min(supporterId, recipientId);
        var high = Math.Max(supporterId, recipientId);
        var existing = await _db.CaringTandemSuggestionLogs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row =>
                row.TenantId == tenantId
                && row.SupporterUserId == low
                && row.RecipientUserId == high,
                ct);

        if (existing is null)
        {
            _db.CaringTandemSuggestionLogs.Add(new CaringTandemSuggestionLog
            {
                TenantId = tenantId,
                SupporterUserId = low,
                RecipientUserId = high,
                Action = "created_relationship",
                CreatedByUserId = coordinatorId > 0 ? coordinatorId : null,
                CreatedAt = now
            });
            return;
        }

        existing.Action = "created_relationship";
        existing.CreatedByUserId = coordinatorId > 0 ? coordinatorId : null;
        existing.CreatedAt = now;
    }

    private async Task<int?> TenantCategoryIdAsync(int tenantId, int categoryId, CancellationToken ct)
    {
        if (categoryId <= 0)
        {
            return null;
        }

        return await _db.Categories
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(category => category.TenantId == tenantId && category.Id == categoryId, ct)
            ? categoryId
            : null;
    }

    private static string NormalizeFrequency(string? frequency)
    {
        return !string.IsNullOrWhiteSpace(frequency) && Frequencies.Contains(frequency)
            ? frequency
            : "weekly";
    }

    private static string NormalizeStatus(string? status)
    {
        if (status == "all")
        {
            return "all";
        }

        return !string.IsNullOrWhiteSpace(status) && Statuses.Contains(status)
            ? status
            : "active";
    }

    private static DateOnly? DateValue(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        if (DateOnly.TryParseExact(
                value,
                DateFormat,
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var date))
        {
            return date;
        }

        return DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? DateOnly.FromDateTime(parsed)
            : null;
    }

    private static DateTime? DateTimeValue(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            value,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? DateTime.SpecifyKind(parsed.UtcDateTime, DateTimeKind.Utc)
            : null;
    }

    private static DateTime NextCheckIn(DateOnly startDate, string frequency)
    {
        var date = frequency switch
        {
            "fortnightly" => startDate.AddDays(14),
            "monthly" => startDate.AddMonths(1),
            "ad_hoc" => startDate.AddDays(30),
            _ => startDate.AddDays(7)
        };

        return DateTime.SpecifyKind(date.ToDateTime(new TimeOnly(9, 0)), DateTimeKind.Utc);
    }

    private static object Stats(IReadOnlyList<CaringSupportRelationship> relationships)
    {
        var now = DateTime.UtcNow;
        return new
        {
            active_count = relationships.Count(relationship => relationship.Status == "active"),
            paused_count = relationships.Count(relationship => relationship.Status == "paused"),
            check_ins_due = relationships.Count(relationship =>
                relationship.Status == "active"
                && relationship.NextCheckInAt is not null
                && relationship.NextCheckInAt.Value < now),
            expected_active_hours = Math.Round(
                relationships
                    .Where(relationship => relationship.Status == "active")
                    .Sum(relationship => relationship.ExpectedHours),
                2,
                MidpointRounding.AwayFromZero)
        };
    }

    private static object RelationshipRow(
        CaringSupportRelationship row,
        IReadOnlyDictionary<int, User> users,
        IReadOnlyDictionary<int, string> categories)
    {
        users.TryGetValue(row.SupporterId, out var supporter);
        users.TryGetValue(row.RecipientId, out var recipient);
        var coordinator = row.CoordinatorId is not null && users.TryGetValue(row.CoordinatorId.Value, out var foundCoordinator)
            ? foundCoordinator
            : null;

        return new
        {
            id = row.Id,
            supporter = new
            {
                id = row.SupporterId,
                name = DisplayName(supporter)
            },
            recipient = new
            {
                id = row.RecipientId,
                name = DisplayName(recipient)
            },
            coordinator = row.CoordinatorId is null
                ? null
                : new
                {
                    id = row.CoordinatorId.Value,
                    name = DisplayName(coordinator)
                },
            organization_name = string.Empty,
            category_name = row.CategoryId is not null && categories.TryGetValue(row.CategoryId.Value, out var categoryName)
                ? categoryName
                : string.Empty,
            title = row.Title,
            description = row.Description ?? string.Empty,
            frequency = row.Frequency,
            expected_hours = Math.Round(row.ExpectedHours, 2, MidpointRounding.AwayFromZero),
            start_date = row.StartDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            end_date = row.EndDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            status = row.Status,
            last_logged_at = DbDateTimeOrNull(row.LastLoggedAt),
            next_check_in_at = DbDateTimeOrNull(row.NextCheckInAt),
            created_at = DbDateTime(row.CreatedAt),
            updated_at = DbDateTimeOrNull(row.UpdatedAt)
        };
    }

    private static object MemberRelationshipRow(
        CaringSupportRelationship row,
        int authUserId,
        IReadOnlyDictionary<int, User> users,
        IReadOnlyDictionary<int, object[]> logsByRelationship)
    {
        users.TryGetValue(row.SupporterId, out var supporter);
        users.TryGetValue(row.RecipientId, out var recipient);

        var role = row.SupporterId == authUserId ? "supporter" : "recipient";
        var partnerId = role == "supporter" ? row.RecipientId : row.SupporterId;
        var partner = role == "supporter" ? recipient : supporter;
        logsByRelationship.TryGetValue(row.Id, out var recentLogs);

        return new
        {
            id = row.Id,
            title = row.Title,
            description = row.Description ?? string.Empty,
            frequency = row.Frequency,
            expected_hours = Math.Round(row.ExpectedHours, 2, MidpointRounding.AwayFromZero),
            status = row.Status,
            start_date = row.StartDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            end_date = row.EndDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            last_logged_at = DbDateTimeOrNull(row.LastLoggedAt),
            next_check_in_at = DbDateTimeOrNull(row.NextCheckInAt),
            role,
            intergenerational = false,
            partner = new
            {
                id = partnerId,
                name = DisplayName(partner),
                avatar_url = partner?.AvatarUrl
            },
            recent_logs = recentLogs ?? []
        };
    }

    private static object LogRow(VolunteerLog log)
    {
        return new
        {
            date = log.DateLogged.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            hours = Math.Round(log.Hours, 2, MidpointRounding.AwayFromZero),
            status = log.Status
        };
    }

    private static int StatusRank(string status)
    {
        return status switch
        {
            "active" => 0,
            "paused" => 1,
            "completed" => 2,
            _ => 3
        };
    }

    private static string NormalizeContactPreference(string? value)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        return normalized is "phone" or "message" or "either"
            ? normalized
            : "either";
    }

    private static string DisplayName(User? user)
    {
        if (user is null)
        {
            return string.Empty;
        }

        var name = string.Join(' ', new[] { user.FirstName, user.LastName }
            .Where(part => !string.IsNullOrWhiteSpace(part)));
        return string.IsNullOrWhiteSpace(name) ? user.Email : name;
    }

    private static string DbDateTime(DateTime value)
    {
        var utc = value.Kind == DateTimeKind.Utc
            ? value
            : DateTime.SpecifyKind(value, DateTimeKind.Utc).ToUniversalTime();

        return utc.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
    }

    private static string? DbDateTimeOrNull(DateTime? value)
    {
        return value is null ? null : DbDateTime(value.Value);
    }

    private static int IntValue(IReadOnlyDictionary<string, object?>? input, string key)
    {
        if (input is null || !input.TryGetValue(key, out var value) || value is null)
        {
            return 0;
        }

        return value switch
        {
            int i => i,
            long l when l is >= int.MinValue and <= int.MaxValue => (int)l,
            decimal d => (int)d,
            double d => (int)d,
            float f => (int)f,
            string s when int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) => i,
            JsonElement element when element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var i) => i,
            JsonElement element when element.ValueKind == JsonValueKind.String
                && int.TryParse(element.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) => i,
            _ => 0
        };
    }

    private static decimal? DecimalValue(IReadOnlyDictionary<string, object?>? input, string key)
    {
        if (input is null || !input.TryGetValue(key, out var value) || value is null)
        {
            return null;
        }

        return value switch
        {
            decimal d => d,
            int i => i,
            long l => l,
            double d => (decimal)d,
            float f => (decimal)f,
            string s when decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out var d) => d,
            JsonElement element when element.ValueKind == JsonValueKind.Number && element.TryGetDecimal(out var d) => d,
            JsonElement element when element.ValueKind == JsonValueKind.String
                && decimal.TryParse(element.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var d) => d,
            _ => null
        };
    }

    private static string? StringValue(IReadOnlyDictionary<string, object?>? input, string key)
    {
        if (input is null || !input.TryGetValue(key, out var value) || value is null)
        {
            return null;
        }

        return value switch
        {
            string s => s,
            JsonElement element when element.ValueKind == JsonValueKind.String => element.GetString(),
            JsonElement element when element.ValueKind == JsonValueKind.Number => element.ToString(),
            JsonElement element when element.ValueKind is JsonValueKind.True or JsonValueKind.False => element.GetBoolean().ToString(CultureInfo.InvariantCulture),
            _ => Convert.ToString(value, CultureInfo.InvariantCulture)
        };
    }

    private static bool HasKey(IReadOnlyDictionary<string, object?>? input, string key)
    {
        return input is not null && input.ContainsKey(key);
    }

    private static string Truncate(string value, int maxLength)
    {
        return value.Length <= maxLength ? value : value[..maxLength];
    }

    private static string? NullIfEmpty(string? value)
    {
        return string.IsNullOrEmpty(value) ? null : value;
    }

    private static bool IsTruthy(string? value)
    {
        return value?.Trim().ToLowerInvariant() is "1" or "true" or "yes" or "on" or "enabled";
    }
}

public sealed record SupportRelationshipCreateResult(
    bool Succeeded,
    object? Relationship,
    string? ErrorCode)
{
    public static SupportRelationshipCreateResult Success(object relationship)
    {
        return new SupportRelationshipCreateResult(true, relationship, null);
    }

    public static SupportRelationshipCreateResult Fail(string code)
    {
        return new SupportRelationshipCreateResult(false, null, code);
    }
}

public sealed record SupportRelationshipUpdateResult(
    bool Succeeded,
    object? Relationship)
{
    public static SupportRelationshipUpdateResult Success(object relationship)
    {
        return new SupportRelationshipUpdateResult(true, relationship);
    }

    public static SupportRelationshipUpdateResult NotFound()
    {
        return new SupportRelationshipUpdateResult(false, null);
    }
}

public sealed record MemberHelpRequestResult(
    bool Succeeded,
    IReadOnlyList<MemberHelpRequestError>? Errors = null)
{
    public static MemberHelpRequestResult Created()
    {
        return new MemberHelpRequestResult(true);
    }

    public static MemberHelpRequestResult Validation(IReadOnlyList<MemberHelpRequestError> errors)
    {
        return new MemberHelpRequestResult(false, errors);
    }
}

public sealed record MemberHelpRequestError(
    string Code,
    string Message,
    string Field);

public sealed record MemberHelpRequestVoiceResult(
    bool Succeeded,
    string? ErrorCode = null,
    string? Transcript = null,
    string? DetectedLanguage = null,
    string? SuggestedCategory = null,
    string? SuggestedWhen = null,
    string? SuggestedContactPreference = null,
    string? RawText = null)
{
    public static MemberHelpRequestVoiceResult Success(
        string transcript,
        string detectedLanguage,
        string? suggestedCategory,
        string? suggestedWhen,
        string? suggestedContactPreference,
        string rawText)
    {
        return new MemberHelpRequestVoiceResult(
            true,
            Transcript: transcript,
            DetectedLanguage: detectedLanguage,
            SuggestedCategory: suggestedCategory,
            SuggestedWhen: suggestedWhen,
            SuggestedContactPreference: suggestedContactPreference,
            RawText: rawText);
    }

    public static MemberHelpRequestVoiceResult Failed(string errorCode)
    {
        return new MemberHelpRequestVoiceResult(false, errorCode);
    }
}

public interface ICaringHelpRequestVoiceProcessor
{
    Task<MemberHelpRequestVoiceResult> ProcessAsync(
        int tenantId,
        int userId,
        Stream audio,
        string? fileName,
        string contentType,
        string locale,
        CancellationToken ct);
}

public sealed record SupportRelationshipLogHoursResult(
    bool Succeeded,
    object? Payload,
    string? ErrorCode)
{
    public static SupportRelationshipLogHoursResult Success(object payload)
    {
        return new SupportRelationshipLogHoursResult(true, payload, null);
    }

    public static SupportRelationshipLogHoursResult Fail(string code)
    {
        return new SupportRelationshipLogHoursResult(false, null, code);
    }
}

public sealed record RelationshipLifecycleResult(
    bool Succeeded,
    string? Status,
    string? ErrorCode,
    string? ErrorField)
{
    public static RelationshipLifecycleResult Success(string status)
    {
        return new RelationshipLifecycleResult(true, status, null, null);
    }

    public static RelationshipLifecycleResult NotFound()
    {
        return new RelationshipLifecycleResult(false, null, "NOT_FOUND", null);
    }

    public static RelationshipLifecycleResult InvalidState()
    {
        return new RelationshipLifecycleResult(false, null, "INVALID_STATE", null);
    }

    public static RelationshipLifecycleResult ValidationError(string field)
    {
        return new RelationshipLifecycleResult(false, null, "VALIDATION_ERROR", field);
    }
}
