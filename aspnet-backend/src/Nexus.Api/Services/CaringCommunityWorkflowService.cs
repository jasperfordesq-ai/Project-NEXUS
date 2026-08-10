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
/// Laravel-compatible Caring Community workflow summary read model.
/// </summary>
public sealed class CaringCommunityWorkflowService
{
    private const string PolicyPrefix = "caring_community.workflow.";
    private const string FeatureKey = "features.caring_community";
    private const string PendingStatus = "pending";
    private const string ApprovedStatus = "approved";
    private const string DeclinedStatus = "declined";

    private static readonly HashSet<string> CoordinatorRoles = new(StringComparer.OrdinalIgnoreCase)
    {
        "admin",
        "tenant_admin",
        "broker",
        "super_admin"
    };

    private static readonly HashSet<string> ReportPeriods = new(StringComparer.Ordinal)
    {
        "last_30_days",
        "last_90_days",
        "year_to_date",
        "previous_quarter"
    };

    private readonly NexusDbContext _db;
    private readonly CaringCommunityRolePresetService _rolePresets;
    private readonly VolunteerHoursService _volunteerHours;
    private readonly CaringRegionalPointService _regionalPoints;

    public CaringCommunityWorkflowService(
        NexusDbContext db,
        CaringCommunityRolePresetService rolePresets)
        : this(
            db,
            rolePresets,
            new VolunteerHoursService(db),
            new CaringRegionalPointService(db))
    {
    }

    public CaringCommunityWorkflowService(
        NexusDbContext db,
        CaringCommunityRolePresetService rolePresets,
        VolunteerHoursService volunteerHours)
        : this(db, rolePresets, volunteerHours, new CaringRegionalPointService(db))
    {
    }

    public CaringCommunityWorkflowService(
        NexusDbContext db,
        CaringCommunityRolePresetService rolePresets,
        VolunteerHoursService volunteerHours,
        CaringRegionalPointService regionalPoints)
    {
        _db = db;
        _rolePresets = rolePresets;
        _volunteerHours = volunteerHours;
        _regionalPoints = regionalPoints;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var value = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config => config.TenantId == tenantId && config.Key == FeatureKey)
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return IsTruthy(value);
    }

    public async Task<object> SummaryAsync(int tenantId, CancellationToken ct)
    {
        var policy = await LoadPolicyAsync(tenantId, ct);
        return new
        {
            stats = await StatsAsync(tenantId, policy, ct),
            pending_reviews = await PendingReviewsAsync(tenantId, policy, ct),
            recent_decisions = await RecentDecisionsAsync(tenantId, ct),
            coordinator_signals = await CoordinatorSignalsAsync(tenantId, ct),
            coordinators = await CoordinatorsAsync(tenantId, ct),
            role_pack = await _rolePresets.StatusAsync(tenantId, ct),
            policy = PolicyPayload(policy)
        };
    }

    public async Task<object> UpdatePolicyAsync(int tenantId, IReadOnlyDictionary<string, object?>? input, CancellationToken ct)
    {
        var current = await LoadPolicyAsync(tenantId, ct);
        var policy = NormalizePolicy(new WorkflowPolicy(
            ApprovalRequired: BoolInput(input, "approval_required", current.ApprovalRequired),
            AutoApproveTrustedReviewers: BoolInput(input, "auto_approve_trusted_reviewers", current.AutoApproveTrustedReviewers),
            ReviewSlaDays: IntInput(input, "review_sla_days", current.ReviewSlaDays),
            EscalationSlaDays: IntInput(input, "escalation_sla_days", current.EscalationSlaDays),
            AllowMemberSelfLog: BoolInput(input, "allow_member_self_log", current.AllowMemberSelfLog),
            RequireOrganisationForPartnerHours: BoolInput(input, "require_organisation_for_partner_hours", current.RequireOrganisationForPartnerHours),
            MonthlyStatementDay: IntInput(input, "monthly_statement_day", current.MonthlyStatementDay),
            MunicipalReportDefaultPeriod: StringInput(input, "municipal_report_default_period", current.MunicipalReportDefaultPeriod),
            IncludeSocialValueEstimate: BoolInput(input, "include_social_value_estimate", current.IncludeSocialValueEstimate),
            DefaultHourValueChf: IntInput(input, "default_hour_value_chf", current.DefaultHourValueChf)));

        await UpsertPolicyConfigAsync(tenantId, "approval_required", SerializeBool(policy.ApprovalRequired), ct);
        await UpsertPolicyConfigAsync(tenantId, "auto_approve_trusted_reviewers", SerializeBool(policy.AutoApproveTrustedReviewers), ct);
        await UpsertPolicyConfigAsync(tenantId, "review_sla_days", policy.ReviewSlaDays.ToString(CultureInfo.InvariantCulture), ct);
        await UpsertPolicyConfigAsync(tenantId, "escalation_sla_days", policy.EscalationSlaDays.ToString(CultureInfo.InvariantCulture), ct);
        await UpsertPolicyConfigAsync(tenantId, "allow_member_self_log", SerializeBool(policy.AllowMemberSelfLog), ct);
        await UpsertPolicyConfigAsync(tenantId, "require_organisation_for_partner_hours", SerializeBool(policy.RequireOrganisationForPartnerHours), ct);
        await UpsertPolicyConfigAsync(tenantId, "monthly_statement_day", policy.MonthlyStatementDay.ToString(CultureInfo.InvariantCulture), ct);
        await UpsertPolicyConfigAsync(tenantId, "municipal_report_default_period", policy.MunicipalReportDefaultPeriod, ct);
        await UpsertPolicyConfigAsync(tenantId, "include_social_value_estimate", SerializeBool(policy.IncludeSocialValueEstimate), ct);
        await UpsertPolicyConfigAsync(tenantId, "default_hour_value_chf", policy.DefaultHourValueChf.ToString(CultureInfo.InvariantCulture), ct);
        await _db.SaveChangesAsync(ct);

        return PolicyPayload(await LoadPolicyAsync(tenantId, ct));
    }

    public async Task<object?> AssignReviewAsync(int tenantId, int logId, IReadOnlyDictionary<string, object?>? input, CancellationToken ct)
    {
        var assigneeId = NullableIntInput(input, "assigned_to");
        if (assigneeId is int userId && !await IsCoordinatorAsync(tenantId, userId, ct))
        {
            return null;
        }

        var log = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item =>
                item.TenantId == tenantId
                && item.Id == logId
                && item.Status == PendingStatus,
                ct);

        if (log is null)
        {
            return null;
        }

        log.AssignedTo = assigneeId;
        log.AssignedAt = assigneeId is null ? null : DateTime.UtcNow;
        log.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var policy = await LoadPolicyAsync(tenantId, ct);
        return await ReviewByIdAsync(tenantId, logId, policy, ct);
    }

    public async Task<object?> DecideReviewAsync(int tenantId, int logId, int reviewerId, string action, CancellationToken ct)
    {
        if (action is not ("approve" or "decline"))
        {
            return null;
        }

        var decision = await _volunteerHours.VerifyCaringAsync(
            tenantId,
            reviewerId,
            logId,
            action,
            ct);
        if (!decision.IsSuccess)
        {
            if (decision.Error?.StatusCode >= StatusCodes.Status500InternalServerError)
            {
                throw new InvalidOperationException(
                    $"Caring volunteer-hour decision failed for log {logId}: {decision.Error.Code}");
            }
            return null;
        }

        RegionalPointHoursAwardResult? regionalPointsResult = null;
        if (string.Equals(decision.Value!.Status, ApprovedStatus, StringComparison.Ordinal))
        {
            try
            {
                var approvedLog = await _db.VolunteerLogs
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(log => log.TenantId == tenantId && log.Id == logId)
                    .Select(log => new { log.UserId, log.Hours })
                    .SingleAsync(ct);
                regionalPointsResult = await _regionalPoints.AwardForApprovedHoursAsync(
                    tenantId,
                    approvedLog.UserId,
                    logId,
                    approvedLog.Hours,
                    reviewerId,
                    ct);
            }
            catch
            {
                // Regional points are an additive reward in Laravel. Approval,
                // payment and XP remain committed if the award cannot be written.
                regionalPointsResult = null;
            }
        }

        return new
        {
            id = logId,
            status = decision.Value.Status,
            payment_result = decision.Value.PaymentOutcome,
            regional_points_result = regionalPointsResult,
            summary = await SummaryAsync(tenantId, ct)
        };
    }

    public async Task<object?> EscalateReviewAsync(int tenantId, int logId, string? note, CancellationToken ct)
    {
        var log = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item =>
                item.TenantId == tenantId
                && item.Id == logId
                && item.Status == PendingStatus,
                ct);

        if (log is null)
        {
            return null;
        }

        log.EscalatedAt = DateTime.UtcNow;
        log.EscalationNote = TruncateOrNull(note, 1000);
        log.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        var policy = await LoadPolicyAsync(tenantId, ct);
        return await ReviewByIdAsync(tenantId, logId, policy, ct);
    }

    private async Task<WorkflowPolicy> LoadPolicyAsync(int tenantId, CancellationToken ct)
    {
        var settings = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config => config.TenantId == tenantId && config.Key.StartsWith(PolicyPrefix))
            .ToDictionaryAsync(
                config => config.Key[PolicyPrefix.Length..],
                config => config.Value,
                StringComparer.Ordinal,
                ct);

        var reviewSla = Clamp(ParseInt(settings, "review_sla_days", 7), 1, 30);
        var escalationSla = Clamp(ParseInt(settings, "escalation_sla_days", 14), reviewSla, 60);
        var reportPeriod = ParseString(settings, "municipal_report_default_period", "last_90_days");
        if (!ReportPeriods.Contains(reportPeriod))
        {
            reportPeriod = "last_90_days";
        }

        return NormalizePolicy(new WorkflowPolicy(
            ApprovalRequired: ParseBool(settings, "approval_required", true),
            AutoApproveTrustedReviewers: ParseBool(settings, "auto_approve_trusted_reviewers", false),
            ReviewSlaDays: reviewSla,
            EscalationSlaDays: escalationSla,
            AllowMemberSelfLog: ParseBool(settings, "allow_member_self_log", true),
            RequireOrganisationForPartnerHours: ParseBool(settings, "require_organisation_for_partner_hours", true),
            MonthlyStatementDay: Clamp(ParseInt(settings, "monthly_statement_day", 1), 1, 28),
            MunicipalReportDefaultPeriod: reportPeriod,
            IncludeSocialValueEstimate: ParseBool(settings, "include_social_value_estimate", true),
            DefaultHourValueChf: Clamp(ParseInt(settings, "default_hour_value_chf", 35), 0, 500)));
    }

    private async Task<object> StatsAsync(int tenantId, WorkflowPolicy policy, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var reviewCutoff = now.AddDays(-policy.ReviewSlaDays);
        var escalationCutoff = now.AddDays(-policy.EscalationSlaDays);
        var last30Days = now.AddDays(-30);

        var logs = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(log => log.TenantId == tenantId)
            .ToListAsync(ct);

        var pendingLogs = logs
            .Where(log => IsStatus(log.Status, PendingStatus))
            .ToArray();

        var approved30dLogs = logs
            .Where(log => IsStatus(log.Status, ApprovedStatus) && log.CreatedAt >= last30Days)
            .ToArray();

        var declined30dCount = logs
            .Count(log => IsStatus(log.Status, DeclinedStatus) && log.CreatedAt >= last30Days);

        return new
        {
            pending_count = pendingLogs.Length,
            pending_hours = RoundHours(pendingLogs.Sum(log => log.Hours)),
            overdue_count = pendingLogs.Count(log => log.CreatedAt < reviewCutoff),
            escalated_count = pendingLogs.Count(log => log.EscalatedAt is not null || log.CreatedAt < escalationCutoff),
            approved_30d_hours = RoundHours(approved30dLogs.Sum(log => log.Hours)),
            declined_30d_count = declined30dCount,
            coordinator_count = await CoordinatorCountAsync(tenantId, ct),
            intergenerational_tandem_count = 0
        };
    }

    private async Task<object[]> PendingReviewsAsync(int tenantId, WorkflowPolicy policy, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var reviewCutoff = now.AddDays(-policy.ReviewSlaDays);
        var escalationCutoff = now.AddDays(-policy.EscalationSlaDays);

        var logs = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Include(log => log.User)
            .Where(log => log.TenantId == tenantId && log.Status == PendingStatus)
            .OrderBy(log => log.CreatedAt)
            .ThenBy(log => log.Id)
            .Take(12)
            .ToListAsync(ct);

        var assignedIds = logs
            .Select(log => log.AssignedTo)
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .Distinct()
            .ToArray();

        var assignedUsers = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.TenantId == tenantId && assignedIds.Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, user => DisplayName(user), ct);

        var opportunityIds = logs
            .Select(log => log.OpportunityId)
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .Distinct()
            .ToArray();

        var opportunityTitles = await _db.VolunteerOpportunities
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(opportunity => opportunity.TenantId == tenantId && opportunityIds.Contains(opportunity.Id))
            .ToDictionaryAsync(opportunity => opportunity.Id, opportunity => opportunity.Title, ct);

        return logs.Select(log => new
        {
            id = log.Id,
            member_name = DisplayName(log.User),
            organisation_name = string.Empty,
            opportunity_title = log.OpportunityId is int opportunityId && opportunityTitles.TryGetValue(opportunityId, out var title)
                ? title
                : string.Empty,
            assigned_to = log.AssignedTo,
            assigned_name = log.AssignedTo is int assignedTo && assignedUsers.TryGetValue(assignedTo, out var name)
                ? name
                : null,
            assigned_at = FormatTimestamp(log.AssignedAt),
            escalated_at = FormatTimestamp(log.EscalatedAt),
            escalation_note = log.EscalationNote,
            hours = RoundHours(log.Hours),
            date_logged = log.DateLogged.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            created_at = FormatTimestamp(log.CreatedAt),
            age_days = Math.Max(0, (int)Math.Floor((now - log.CreatedAt).TotalDays)),
            is_overdue = log.CreatedAt < reviewCutoff,
            is_escalated = log.EscalatedAt is not null || log.CreatedAt < escalationCutoff
        }).Cast<object>().ToArray();
    }

    private async Task<object?> ReviewByIdAsync(int tenantId, int logId, WorkflowPolicy policy, CancellationToken ct)
    {
        var log = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Include(item => item.User)
            .FirstOrDefaultAsync(item => item.TenantId == tenantId && item.Id == logId && item.Status == PendingStatus, ct);

        if (log is null)
        {
            return null;
        }

        var assignedUser = log.AssignedTo is int assignedTo
            ? await _db.Users
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(user => user.TenantId == tenantId && user.Id == assignedTo)
                .FirstOrDefaultAsync(ct)
            : null;
        var assignedName = assignedUser is null ? null : DisplayName(assignedUser);

        string? opportunityTitle = null;
        if (log.OpportunityId is int opportunityId)
        {
            opportunityTitle = await _db.VolunteerOpportunities
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(opportunity => opportunity.TenantId == tenantId && opportunity.Id == opportunityId)
                .Select(opportunity => opportunity.Title)
                .FirstOrDefaultAsync(ct);
        }

        return ReviewPayload(log, policy, assignedName, opportunityTitle, DateTime.UtcNow);
    }

    private async Task<object[]> RecentDecisionsAsync(int tenantId, CancellationToken ct)
    {
        var logs = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Include(log => log.User)
            .Where(log => log.TenantId == tenantId && (log.Status == ApprovedStatus || log.Status == DeclinedStatus))
            .ToListAsync(ct);

        return logs
            .OrderByDescending(log => log.UpdatedAt ?? log.CreatedAt)
            .ThenByDescending(log => log.Id)
            .Take(8)
            .Select(log => new
            {
                id = log.Id,
                member_name = DisplayName(log.User),
                organisation_name = string.Empty,
                hours = RoundHours(log.Hours),
                status = log.Status,
                decided_at = FormatTimestamp(log.UpdatedAt ?? log.CreatedAt)
            })
            .Cast<object>()
            .ToArray();
    }

    private async Task<object> CoordinatorSignalsAsync(int tenantId, CancellationToken ct)
    {
        var activeListings = await _db.Listings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(listing => listing.TenantId == tenantId && listing.Status == ListingStatus.Active)
            .Select(listing => listing.Type)
            .ToListAsync(ct);

        return new
        {
            active_requests = activeListings.Count(type => type == ListingType.Request),
            active_offers = activeListings.Count(type => type == ListingType.Offer),
            trusted_organisations = 0
        };
    }

    private async Task<int> CoordinatorCountAsync(int tenantId, CancellationToken ct)
    {
        return await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .CountAsync(user => user.TenantId == tenantId
                && user.IsActive
                && CoordinatorRoles.Contains(user.Role), ct);
    }

    private async Task<bool> IsCoordinatorAsync(int tenantId, int userId, CancellationToken ct)
    {
        return await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(user =>
                user.TenantId == tenantId
                && user.Id == userId
                && user.IsActive
                && CoordinatorRoles.Contains(user.Role),
                ct);
    }

    private async Task<object[]> CoordinatorsAsync(int tenantId, CancellationToken ct)
    {
        var users = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.TenantId == tenantId
                && user.IsActive
                && CoordinatorRoles.Contains(user.Role))
            .ToListAsync(ct);

        return users
            .OrderBy(DisplayName, StringComparer.OrdinalIgnoreCase)
            .Take(50)
            .Select(user => new
            {
                id = user.Id,
                name = DisplayName(user),
                role = user.Role
            })
            .Cast<object>()
            .ToArray();
    }

    private static object PolicyPayload(WorkflowPolicy policy)
    {
        return new
        {
            approval_required = policy.ApprovalRequired,
            auto_approve_trusted_reviewers = policy.AutoApproveTrustedReviewers,
            review_sla_days = policy.ReviewSlaDays,
            escalation_sla_days = policy.EscalationSlaDays,
            allow_member_self_log = policy.AllowMemberSelfLog,
            require_organisation_for_partner_hours = policy.RequireOrganisationForPartnerHours,
            monthly_statement_day = policy.MonthlyStatementDay,
            municipal_report_default_period = policy.MunicipalReportDefaultPeriod,
            include_social_value_estimate = policy.IncludeSocialValueEstimate,
            default_hour_value_chf = policy.DefaultHourValueChf
        };
    }

    private static object ReviewPayload(
        VolunteerLog log,
        WorkflowPolicy policy,
        string? assignedName,
        string? opportunityTitle,
        DateTime now)
    {
        return new
        {
            id = log.Id,
            member_name = DisplayName(log.User),
            organisation_name = string.Empty,
            opportunity_title = opportunityTitle ?? string.Empty,
            assigned_to = log.AssignedTo,
            assigned_name = string.IsNullOrWhiteSpace(assignedName) ? null : assignedName,
            assigned_at = FormatTimestamp(log.AssignedAt),
            escalated_at = FormatTimestamp(log.EscalatedAt),
            escalation_note = log.EscalationNote,
            hours = RoundHours(log.Hours),
            date_logged = log.DateLogged.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            created_at = FormatTimestamp(log.CreatedAt),
            age_days = Math.Max(0, (int)Math.Floor((now - log.CreatedAt).TotalDays)),
            is_overdue = log.CreatedAt < now.AddDays(-policy.ReviewSlaDays),
            is_escalated = log.EscalatedAt is not null || log.CreatedAt < now.AddDays(-policy.EscalationSlaDays)
        };
    }

    private async Task UpsertPolicyConfigAsync(int tenantId, string key, string value, CancellationToken ct)
    {
        var settingKey = PolicyPrefix + key;
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(config => config.TenantId == tenantId && config.Key == settingKey, ct);

        if (row is null)
        {
            row = new TenantConfig
            {
                TenantId = tenantId,
                Key = settingKey,
                Value = value,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            _db.TenantConfigs.Add(row);
            return;
        }

        row.Value = value;
        row.UpdatedAt = DateTime.UtcNow;
    }

    private static WorkflowPolicy NormalizePolicy(WorkflowPolicy policy)
    {
        var reviewSla = Clamp(policy.ReviewSlaDays, 1, 30);
        var reportPeriod = ReportPeriods.Contains(policy.MunicipalReportDefaultPeriod)
            ? policy.MunicipalReportDefaultPeriod
            : "last_90_days";

        return policy with
        {
            ReviewSlaDays = reviewSla,
            EscalationSlaDays = Clamp(policy.EscalationSlaDays, reviewSla, 60),
            MonthlyStatementDay = Clamp(policy.MonthlyStatementDay, 1, 28),
            MunicipalReportDefaultPeriod = reportPeriod,
            DefaultHourValueChf = Clamp(policy.DefaultHourValueChf, 0, 500)
        };
    }

    private static int Clamp(int value, int min, int max)
    {
        return Math.Min(max, Math.Max(min, value));
    }

    private static int ParseInt(IReadOnlyDictionary<string, string> settings, string key, int fallback)
    {
        return settings.TryGetValue(key, out var value)
            && int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;
    }

    private static bool ParseBool(IReadOnlyDictionary<string, string> settings, string key, bool fallback)
    {
        return settings.TryGetValue(key, out var value)
            ? IsTruthy(value) || (!IsFalsy(value) && fallback)
            : fallback;
    }

    private static string ParseString(IReadOnlyDictionary<string, string> settings, string key, string fallback)
    {
        return settings.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value.Trim()
            : fallback;
    }

    private static bool BoolInput(IReadOnlyDictionary<string, object?>? input, string key, bool fallback)
    {
        if (input is null || !input.TryGetValue(key, out var value) || value is null)
        {
            return fallback;
        }

        if (value is JsonElement json)
        {
            return json.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.Number => json.TryGetInt32(out var number) && number != 0,
                JsonValueKind.String => StringToBool(json.GetString(), fallback),
                _ => fallback
            };
        }

        return value switch
        {
            bool boolean => boolean,
            int number => number != 0,
            long number => number != 0,
            decimal number => number != 0m,
            double number => Math.Abs(number) > double.Epsilon,
            string text => StringToBool(text, fallback),
            _ => fallback
        };
    }

    private static int IntInput(IReadOnlyDictionary<string, object?>? input, string key, int fallback)
    {
        if (input is null || !input.TryGetValue(key, out var value) || value is null)
        {
            return fallback;
        }

        if (value is JsonElement json)
        {
            return json.ValueKind switch
            {
                JsonValueKind.Number => json.TryGetInt32(out var number) ? number : fallback,
                JsonValueKind.True => 1,
                JsonValueKind.False => 0,
                JsonValueKind.String => int.TryParse(json.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) ? number : 0,
                _ => 0
            };
        }

        return value switch
        {
            int number => number,
            long number => number > int.MaxValue ? int.MaxValue : number < int.MinValue ? int.MinValue : (int)number,
            decimal number => (int)number,
            double number => (int)number,
            bool boolean => boolean ? 1 : 0,
            string text => int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) ? number : 0,
            _ => 0
        };
    }

    private static string StringInput(IReadOnlyDictionary<string, object?>? input, string key, string fallback)
    {
        if (input is null || !input.TryGetValue(key, out var value) || value is null)
        {
            return fallback;
        }

        if (value is JsonElement json)
        {
            return json.ValueKind == JsonValueKind.String
                ? json.GetString()?.Trim() ?? string.Empty
                : json.ToString().Trim();
        }

        return Convert.ToString(value, CultureInfo.InvariantCulture)?.Trim() ?? string.Empty;
    }

    private static int? NullableIntInput(IReadOnlyDictionary<string, object?>? input, string key)
    {
        if (input is null || !input.TryGetValue(key, out var value) || value is null)
        {
            return null;
        }

        var parsed = value switch
        {
            JsonElement json => json.ValueKind switch
            {
                JsonValueKind.Number => json.TryGetInt32(out var number) ? number : 0,
                JsonValueKind.String => int.TryParse(json.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) ? number : 0,
                _ => 0
            },
            int number => number,
            long number => number > int.MaxValue ? int.MaxValue : number < int.MinValue ? int.MinValue : (int)number,
            decimal number => (int)number,
            double number => (int)number,
            string text => int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) ? number : 0,
            _ => 0
        };

        return parsed >= 1 ? parsed : null;
    }

    private static string? TruncateOrNull(string? value, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }

    private static bool StringToBool(string? value, bool fallback)
    {
        return value?.Trim().ToLowerInvariant() switch
        {
            "1" or "true" or "yes" or "on" => true,
            "0" or "false" or "no" or "off" or "" => false,
            _ => fallback
        };
    }

    private static string SerializeBool(bool value)
    {
        return value ? "1" : "0";
    }

    private static bool IsStatus(string status, string expected)
    {
        return string.Equals(status, expected, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsTruthy(string? value)
    {
        return value?.Trim().ToLowerInvariant() is "1" or "true" or "yes" or "on";
    }

    private static bool IsFalsy(string? value)
    {
        return value?.Trim().ToLowerInvariant() is "0" or "false" or "no" or "off";
    }

    private static decimal RoundHours(decimal value)
    {
        return Math.Round(value, 1, MidpointRounding.AwayFromZero);
    }

    private static string DisplayName(User? user)
    {
        if (user is null)
        {
            return string.Empty;
        }

        var name = string.Join(
            " ",
            new[] { user.FirstName, user.LastName }.Where(part => !string.IsNullOrWhiteSpace(part)));

        return string.IsNullOrWhiteSpace(name) ? user.Email : name;
    }

    private static string? FormatTimestamp(DateTime? value)
    {
        return value?.ToString("O", CultureInfo.InvariantCulture);
    }

    private sealed record WorkflowPolicy(
        bool ApprovalRequired,
        bool AutoApproveTrustedReviewers,
        int ReviewSlaDays,
        int EscalationSlaDays,
        bool AllowMemberSelfLog,
        bool RequireOrganisationForPartnerHours,
        int MonthlyStatementDay,
        string MunicipalReportDefaultPeriod,
        bool IncludeSocialValueEstimate,
        int DefaultHourValueChf);
}
