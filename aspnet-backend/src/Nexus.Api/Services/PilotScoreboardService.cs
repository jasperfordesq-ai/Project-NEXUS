// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class PilotScoreboardService
{
    public const string PrePilotLabel = "pre_pilot";

    private const int SwissHourlyRateChf = 35;
    private const int PreventionMultiplier = 2;
    private const int RollingWindowDays = 90;

    private static readonly string[] MetricKeys =
    [
        "active_members",
        "first_response_hours",
        "approved_hours",
        "recurring_relationships",
        "coordinator_workload_hrs",
        "satisfaction_score",
        "social_isolation_pct",
        "comms_reach_pct",
        "business_participation",
        "cost_offset_chf"
    ];

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly NexusDbContext _db;

    public PilotScoreboardService(NexusDbContext db)
    {
        _db = db;
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

    public async Task<PilotScoreboardView> ScoreboardAsync(int tenantId, CancellationToken ct)
    {
        var current = await CaptureCurrentMetricsAsync(tenantId, ct);
        var prePilot = await LatestBaselineAsync(tenantId, PrePilotLabel, ct);
        var latestQuarterly = await LatestQuarterlyReviewAsync(tenantId, ct);
        var comparison = prePilot is null ? null : CompareMetrics(prePilot.Metrics, current);
        var quarterlyDue = QuarterlyReviewDueAt(prePilot, latestQuarterly);

        return new PilotScoreboardView(
            Current: current,
            PrePilotBaseline: prePilot,
            LatestQuarterly: latestQuarterly,
            Comparison: comparison,
            QuarterlyReview: new PilotQuarterlyReview(
                NextDueAt: FormatDate(quarterlyDue),
                IsOverdue: quarterlyDue.HasValue && DateTime.UtcNow > quarterlyDue.Value,
                CadenceMonths: 3));
    }

    public async Task<IReadOnlyList<PilotScoreboardBaselineRow>> ListBaselinesAsync(
        int tenantId,
        CancellationToken ct)
    {
        var rows = await _db.CaringKpiBaselines
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId)
            .OrderByDescending(row => row.CapturedAt)
            .ThenByDescending(row => row.Id)
            .ToListAsync(ct);

        return rows
            .Select(RowToScoreboardBaseline)
            .Where(row => row is not null)
            .Cast<PilotScoreboardBaselineRow>()
            .ToArray();
    }

    public Task<PilotScoreboardBaselineRow> CapturePrePilotBaselineAsync(
        int tenantId,
        int? adminUserId,
        string? notes,
        CancellationToken ct)
    {
        return CaptureBaselineAsync(
            tenantId,
            PrePilotLabel,
            adminUserId,
            notes,
            isPrePilot: true,
            ct);
    }

    public async Task<PilotScoreboardBaselineRow> CaptureBaselineAsync(
        int tenantId,
        string label,
        int? adminUserId,
        string? notes,
        bool isPrePilot,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var metrics = await CaptureCurrentMetricsAsync(tenantId, ct);
        var period = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["start"] = now.AddDays(-RollingWindowDays).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            ["end"] = now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
        };
        var envelope = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["kind"] = "pilot_scoreboard",
            ["is_pre_pilot"] = isPrePilot,
            ["metrics"] = metrics
        };

        var baseline = new CaringKpiBaseline
        {
            TenantId = tenantId,
            Label = label,
            BaselinePeriod = JsonSerializer.Serialize(period, JsonOptions),
            CapturedAt = now,
            Metrics = JsonSerializer.Serialize(envelope, JsonOptions),
            Notes = TrimToNull(notes),
            CapturedBy = adminUserId,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringKpiBaselines.Add(baseline);
        await _db.SaveChangesAsync(ct);

        return RowToScoreboardBaseline(baseline)
            ?? throw new InvalidOperationException("Captured pilot scoreboard baseline could not be mapped.");
    }

    public async Task<IReadOnlyDictionary<string, object?>> CaptureCurrentMetricsAsync(
        int tenantId,
        CancellationToken ct)
    {
        var windowStart = DateTime.UtcNow.AddDays(-RollingWindowDays);
        var approvedHours = await ApprovedHoursInWindowAsync(tenantId, windowStart, ct);
        var activeMembers = await ActiveMembersInWindowAsync(tenantId, windowStart, ct);
        var firstResponseHours = await MedianFirstResponseHoursAsync(tenantId, windowStart, ct);
        var recurringRelationships = await RecurringRelationshipsAsync(tenantId, ct);
        var coordinatorWorkload = await CoordinatorWorkloadAsync(tenantId, ct);
        var satisfactionScore = await SatisfactionScoreAsync(tenantId, ct);
        var socialIsolation = await SocialIsolationProxyPctAsync(tenantId, windowStart, ct);
        var communicationsReach = await CommunicationsReachPctAsync(tenantId, windowStart, ct);
        var businessParticipation = await BusinessParticipationAsync(tenantId, windowStart, ct);
        var costOffset = Round(approvedHours * SwissHourlyRateChf * PreventionMultiplier, 2);

        return new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["active_members"] = activeMembers,
            ["first_response_hours"] = firstResponseHours,
            ["approved_hours"] = approvedHours,
            ["recurring_relationships"] = recurringRelationships,
            ["coordinator_workload_hrs"] = coordinatorWorkload,
            ["satisfaction_score"] = satisfactionScore,
            ["social_isolation_pct"] = socialIsolation,
            ["comms_reach_pct"] = communicationsReach,
            ["business_participation"] = businessParticipation,
            ["cost_offset_chf"] = costOffset,
            ["methodology"] = new Dictionary<string, object>(StringComparer.Ordinal)
            {
                ["window_days"] = RollingWindowDays,
                ["hourly_rate_chf"] = SwissHourlyRateChf,
                ["prevention_multiplier"] = PreventionMultiplier
            }
        };
    }

    private async Task<PilotScoreboardBaselineRow?> LatestBaselineAsync(
        int tenantId,
        string label,
        CancellationToken ct)
    {
        var row = await _db.CaringKpiBaselines
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(baseline => baseline.TenantId == tenantId && baseline.Label == label)
            .OrderByDescending(baseline => baseline.CapturedAt)
            .ThenByDescending(baseline => baseline.Id)
            .FirstOrDefaultAsync(ct);

        return RowToScoreboardBaseline(row);
    }

    private async Task<PilotScoreboardBaselineRow?> LatestQuarterlyReviewAsync(
        int tenantId,
        CancellationToken ct)
    {
        var rows = await _db.CaringKpiBaselines
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(baseline => baseline.TenantId == tenantId && baseline.Label != PrePilotLabel)
            .OrderByDescending(baseline => baseline.CapturedAt)
            .ThenByDescending(baseline => baseline.Id)
            .ToListAsync(ct);

        return rows
            .Select(RowToScoreboardBaseline)
            .FirstOrDefault(row => row is not null);
    }

    private static PilotScoreboardBaselineRow? RowToScoreboardBaseline(CaringKpiBaseline? row)
    {
        if (row is null)
        {
            return null;
        }

        using var envelope = ParseJson(row.Metrics);
        if (envelope is null
            || envelope.RootElement.ValueKind != JsonValueKind.Object
            || !envelope.RootElement.TryGetProperty("kind", out var kind)
            || kind.GetString() != "pilot_scoreboard")
        {
            return null;
        }

        var metrics = envelope.RootElement.TryGetProperty("metrics", out var rawMetrics)
            && rawMetrics.ValueKind == JsonValueKind.Object
                ? rawMetrics.Clone()
                : EmptyObject();

        return new PilotScoreboardBaselineRow(
            Id: row.Id,
            Label: row.Label,
            IsPrePilot: envelope.RootElement.TryGetProperty("is_pre_pilot", out var prePilot)
                && prePilot.ValueKind == JsonValueKind.True,
            BaselinePeriod: ParseObject(row.BaselinePeriod),
            CapturedAt: FormatDate(row.CapturedAt),
            Metrics: metrics,
            Notes: row.Notes,
            CapturedBy: row.CapturedBy);
    }

    private static IReadOnlyDictionary<string, PilotScoreboardComparisonMetric> CompareMetrics(
        JsonElement baseline,
        IReadOnlyDictionary<string, object?> current)
    {
        var output = new Dictionary<string, PilotScoreboardComparisonMetric>(StringComparer.Ordinal);
        foreach (var key in MetricKeys)
        {
            var baselineValue = ReadDecimal(baseline, key);
            var currentValue = ReadDecimal(current.TryGetValue(key, out var rawCurrent) ? rawCurrent : null);
            var delta = baselineValue.HasValue && currentValue.HasValue
                ? Round(currentValue.Value - baselineValue.Value, 2)
                : (decimal?)null;
            var pctChange = delta.HasValue && baselineValue is not null and not 0m
                ? Round((delta.Value / baselineValue.Value) * 100m, 1)
                : (decimal?)null;

            output[key] = new PilotScoreboardComparisonMetric(
                Baseline: baselineValue,
                Current: currentValue,
                Delta: delta,
                PctChange: pctChange);
        }

        return output;
    }

    private static DateTime? QuarterlyReviewDueAt(
        PilotScoreboardBaselineRow? prePilot,
        PilotScoreboardBaselineRow? latestQuarterly)
    {
        var anchor = latestQuarterly?.CapturedAt ?? prePilot?.CapturedAt;
        if (anchor is null)
        {
            return null;
        }

        return DateTime.TryParse(
            anchor,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed.AddMonths(3)
            : null;
    }

    private async Task<decimal> ApprovedHoursInWindowAsync(
        int tenantId,
        DateTime windowStart,
        CancellationToken ct)
    {
        if (!await HasColumnsAsync("vol_logs", ["tenant_id", "status", "created_at", "hours"], ct))
        {
            return 0m;
        }

        return await ScalarDecimalAsync(
            """
            SELECT COALESCE(SUM(hours), 0)
            FROM vol_logs
            WHERE tenant_id = @tenant_id
              AND status = 'approved'
              AND created_at >= @window_start
            """,
            ct,
            ("tenant_id", tenantId),
            ("window_start", windowStart)) ?? 0m;
    }

    private async Task<int> ActiveMembersInWindowAsync(
        int tenantId,
        DateTime windowStart,
        CancellationToken ct)
    {
        var ids = new HashSet<int>();

        if (await HasColumnsAsync("vol_logs", ["tenant_id", "status", "created_at", "user_id"], ct))
        {
            foreach (var id in await QueryIntColumnAsync(
                """
                SELECT DISTINCT user_id
                FROM vol_logs
                WHERE tenant_id = @tenant_id
                  AND status = 'approved'
                  AND created_at >= @window_start
                  AND user_id IS NOT NULL
                """,
                ct,
                ("tenant_id", tenantId),
                ("window_start", windowStart)))
            {
                ids.Add(id);
            }
        }

        var transactions = await _db.Transactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId
                && row.Status == TransactionStatus.Completed
                && row.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType
                && row.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType
                && row.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
                && row.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType
                && row.CreatedAt >= windowStart)
            .Select(row => new { row.SenderId, row.ReceiverId })
            .ToListAsync(ct);
        foreach (var transaction in transactions)
        {
            if (transaction.SenderId.HasValue)
                ids.Add(transaction.SenderId.Value);
            if (transaction.ReceiverId.HasValue)
                ids.Add(transaction.ReceiverId.Value);
        }

        return ids.Count;
    }

    private async Task<decimal?> MedianFirstResponseHoursAsync(
        int tenantId,
        DateTime windowStart,
        CancellationToken ct)
    {
        if (!await HasColumnsAsync("caring_help_requests", ["tenant_id", "created_at", "updated_at", "status"], ct))
        {
            return null;
        }

        var values = await QueryDecimalColumnAsync(
            """
            SELECT EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600.0
            FROM caring_help_requests
            WHERE tenant_id = @tenant_id
              AND created_at >= @window_start
              AND status <> 'pending'
              AND updated_at IS NOT NULL
              AND updated_at > created_at
            ORDER BY 1
            """,
            ct,
            ("tenant_id", tenantId),
            ("window_start", windowStart));

        if (values.Count == 0)
        {
            return null;
        }

        var mid = values.Count / 2;
        var median = values.Count % 2 == 0
            ? (values[mid - 1] + values[mid]) / 2m
            : values[mid];
        return Round(median, 2);
    }

    private async Task<int> RecurringRelationshipsAsync(int tenantId, CancellationToken ct)
    {
        if (!await HasColumnsAsync("caring_support_relationships", ["tenant_id", "status"], ct))
        {
            return 0;
        }

        return (int)(await ScalarDecimalAsync(
            """
            SELECT COUNT(*)
            FROM caring_support_relationships
            WHERE tenant_id = @tenant_id
              AND status = 'active'
            """,
            ct,
            ("tenant_id", tenantId)) ?? 0m);
    }

    private async Task<decimal?> CoordinatorWorkloadAsync(int tenantId, CancellationToken ct)
    {
        if (!await HasColumnsAsync("caring_help_requests", ["tenant_id", "status"], ct))
        {
            return null;
        }

        var coordinatorCount = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(user => user.TenantId == tenantId
                && user.IsActive
                && (user.Role == Role.Names.Admin
                    || user.Role == "super_admin"
                    || user.Role == "tenant_super_admin"), ct);

        if (coordinatorCount == 0)
        {
            return null;
        }

        var pending = await ScalarDecimalAsync(
            """
            SELECT COUNT(*)
            FROM caring_help_requests
            WHERE tenant_id = @tenant_id
              AND status = 'pending'
            """,
            ct,
            ("tenant_id", tenantId)) ?? 0m;

        return Round(pending / coordinatorCount, 2);
    }

    private async Task<decimal?> SatisfactionScoreAsync(int tenantId, CancellationToken ct)
    {
        if (!await HasColumnsAsync("municipality_surveys", ["tenant_id", "id"], ct)
            || !await HasColumnsAsync("municipality_survey_questions", ["tenant_id", "survey_id", "question_type", "question_text"], ct)
            || !await HasColumnsAsync("municipality_survey_responses", ["tenant_id", "answers"], ct))
        {
            return null;
        }

        var result = await ScalarDecimalAsync(
            """
            WITH question_ids AS (
                SELECT q.id::text AS id
                FROM municipality_survey_questions q
                JOIN municipality_surveys s ON s.id = q.survey_id
                WHERE q.tenant_id = @tenant_id
                  AND s.tenant_id = @tenant_id
                  AND q.question_type = 'likert'
                  AND (
                    q.question_text ILIKE '%satisfaction%'
                    OR q.question_text ILIKE '%satisfied%'
                    OR q.question_text ILIKE '%zufrieden%'
                    OR q.question_text ILIKE '%zufriedenheit%'
                  )
            )
            SELECT AVG((value)::numeric)
            FROM municipality_survey_responses r,
                 jsonb_each_text(r.answers::jsonb) answer(key, value)
            WHERE r.tenant_id = @tenant_id
              AND answer.key IN (SELECT id FROM question_ids)
              AND answer.value ~ '^[0-9]+(\.[0-9]+)?$'
              AND (answer.value)::numeric BETWEEN 1 AND 5
            """,
            ct,
            ("tenant_id", tenantId));

        return result.HasValue ? Round(result.Value, 2) : null;
    }

    private async Task<decimal?> SocialIsolationProxyPctAsync(
        int tenantId,
        DateTime windowStart,
        CancellationToken ct)
    {
        var totalActive = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(user => user.TenantId == tenantId && user.IsActive, ct);
        if (totalActive == 0)
        {
            return null;
        }

        var engaged = new HashSet<int>();
        var transactions = await _db.Transactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId
                && row.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType
                && row.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType
                && row.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
                && row.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType
                && row.CreatedAt >= windowStart)
            .Select(row => new { row.SenderId, row.ReceiverId })
            .ToListAsync(ct);
        foreach (var transaction in transactions)
        {
            if (transaction.SenderId.HasValue)
                engaged.Add(transaction.SenderId.Value);
            if (transaction.ReceiverId.HasValue)
                engaged.Add(transaction.ReceiverId.Value);
        }

        if (await HasColumnsAsync("vol_logs", ["tenant_id", "created_at", "user_id"], ct))
        {
            foreach (var id in await QueryIntColumnAsync(
                """
                SELECT DISTINCT user_id
                FROM vol_logs
                WHERE tenant_id = @tenant_id
                  AND created_at >= @window_start
                  AND user_id IS NOT NULL
                """,
                ct,
                ("tenant_id", tenantId),
                ("window_start", windowStart)))
            {
                engaged.Add(id);
            }
        }

        var isolated = Math.Max(totalActive - engaged.Count, 0);
        return Round(((decimal)isolated / totalActive) * 100m, 1);
    }

    private async Task<decimal?> CommunicationsReachPctAsync(
        int tenantId,
        DateTime windowStart,
        CancellationToken ct)
    {
        var totalActive = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(user => user.TenantId == tenantId && user.IsActive, ct);
        if (totalActive == 0)
        {
            return null;
        }

        var latest = await _db.CaringEmergencyAlerts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(alert => alert.TenantId == tenantId && alert.CreatedAt >= windowStart)
            .OrderByDescending(alert => alert.CreatedAt)
            .ThenByDescending(alert => alert.Id)
            .FirstOrDefaultAsync(ct);
        if (latest is null)
        {
            return null;
        }

        var awareLowerBound = Math.Max(latest.DismissedCount, 0);
        if (awareLowerBound == 0 && latest.PushSent)
        {
            awareLowerBound = totalActive;
        }

        return Round(Math.Min((decimal)awareLowerBound / totalActive, 1m) * 100m, 1);
    }

    private async Task<int> BusinessParticipationAsync(
        int tenantId,
        DateTime windowStart,
        CancellationToken ct)
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        if (await HasColumnsAsync("vol_organizations", ["tenant_id", "id", "created_at", "updated_at"], ct))
        {
            foreach (var id in await QueryIntColumnAsync(
                """
                SELECT id
                FROM vol_organizations
                WHERE tenant_id = @tenant_id
                  AND (created_at >= @window_start OR updated_at >= @window_start)
                """,
                ct,
                ("tenant_id", tenantId),
                ("window_start", windowStart)))
            {
                ids.Add($"vol_{id}");
            }
        }

        if (await HasColumnsAsync("merchant_coupons", ["tenant_id", "seller_id", "created_at"], ct))
        {
            foreach (var id in await QueryIntColumnAsync(
                """
                SELECT DISTINCT seller_id
                FROM merchant_coupons
                WHERE tenant_id = @tenant_id
                  AND created_at >= @window_start
                  AND seller_id IS NOT NULL
                """,
                ct,
                ("tenant_id", tenantId),
                ("window_start", windowStart)))
            {
                ids.Add($"merchant_{id}");
            }
        }

        return ids.Count;
    }

    private async Task<bool> HasColumnsAsync(string tableName, IReadOnlyList<string> columnNames, CancellationToken ct)
    {
        if (!_db.Database.IsRelational())
        {
            return false;
        }

        foreach (var column in columnNames)
        {
            var result = await ScalarObjectAsync(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = ANY (current_schemas(false))
                      AND table_name = @table_name
                      AND column_name = @column_name
                )
                """,
                ct,
                ("table_name", tableName),
                ("column_name", column));

            if (result is not bool exists || !exists)
            {
                return false;
            }
        }

        return true;
    }

    private async Task<decimal?> ScalarDecimalAsync(
        string sql,
        CancellationToken ct,
        params (string Name, object? Value)[] parameters)
    {
        var result = await ScalarObjectAsync(sql, ct, parameters);
        return result switch
        {
            null or DBNull => null,
            decimal value => value,
            double value => (decimal)value,
            float value => (decimal)value,
            int value => value,
            long value => value,
            _ when decimal.TryParse(Convert.ToString(result, CultureInfo.InvariantCulture), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => null
        };
    }

    private async Task<IReadOnlyList<int>> QueryIntColumnAsync(
        string sql,
        CancellationToken ct,
        params (string Name, object? Value)[] parameters)
    {
        if (!_db.Database.IsRelational())
        {
            return [];
        }

        var connection = _db.Database.GetDbConnection();
        await using var _ = await EnsureOpenAsync(connection, ct);
        await using var command = BuildCommand(connection, sql, parameters);
        var output = new List<int>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            if (!reader.IsDBNull(0))
            {
                output.Add(Convert.ToInt32(reader.GetValue(0), CultureInfo.InvariantCulture));
            }
        }

        return output;
    }

    private async Task<IReadOnlyList<decimal>> QueryDecimalColumnAsync(
        string sql,
        CancellationToken ct,
        params (string Name, object? Value)[] parameters)
    {
        if (!_db.Database.IsRelational())
        {
            return [];
        }

        var connection = _db.Database.GetDbConnection();
        await using var _ = await EnsureOpenAsync(connection, ct);
        await using var command = BuildCommand(connection, sql, parameters);
        var output = new List<decimal>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            if (!reader.IsDBNull(0))
            {
                output.Add(Convert.ToDecimal(reader.GetValue(0), CultureInfo.InvariantCulture));
            }
        }

        return output;
    }

    private async Task<object?> ScalarObjectAsync(
        string sql,
        CancellationToken ct,
        params (string Name, object? Value)[] parameters)
    {
        if (!_db.Database.IsRelational())
        {
            return null;
        }

        var connection = _db.Database.GetDbConnection();
        await using var _ = await EnsureOpenAsync(connection, ct);
        await using var command = BuildCommand(connection, sql, parameters);
        return await command.ExecuteScalarAsync(ct);
    }

    private static DbCommand BuildCommand(
        DbConnection connection,
        string sql,
        params (string Name, object? Value)[] parameters)
    {
        var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = "@" + name;
            parameter.Value = value ?? DBNull.Value;
            command.Parameters.Add(parameter);
        }

        return command;
    }

    private static async Task<IAsyncDisposable> EnsureOpenAsync(DbConnection connection, CancellationToken ct)
    {
        if (connection.State == System.Data.ConnectionState.Open)
        {
            return NoopAsyncDisposable.Instance;
        }

        await connection.OpenAsync(ct);
        return new ConnectionCloser(connection);
    }

    private static JsonDocument? ParseJson(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        try
        {
            return JsonDocument.Parse(raw);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static IReadOnlyDictionary<string, object?> ParseObject(string? raw)
    {
        using var document = ParseJson(raw);
        if (document is null || document.RootElement.ValueKind != JsonValueKind.Object)
        {
            return new Dictionary<string, object?>(StringComparer.Ordinal);
        }

        var output = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var property in document.RootElement.EnumerateObject())
        {
            output[property.Name] = property.Value.ValueKind switch
            {
                JsonValueKind.Null => null,
                JsonValueKind.Number when property.Value.TryGetInt64(out var integer) => integer,
                JsonValueKind.Number when property.Value.TryGetDecimal(out var number) => number,
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => property.Value.ToString()
            };
        }

        return output;
    }

    private static JsonElement EmptyObject()
    {
        using var document = JsonDocument.Parse("{}");
        return document.RootElement.Clone();
    }

    private static decimal? ReadDecimal(JsonElement element, string propertyName)
    {
        return element.ValueKind == JsonValueKind.Object && element.TryGetProperty(propertyName, out var value)
            ? ReadDecimal(value)
            : null;
    }

    private static decimal? ReadDecimal(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number))
        {
            return number;
        }

        if (value.ValueKind == JsonValueKind.String
            && decimal.TryParse(value.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed;
        }

        return null;
    }

    private static decimal? ReadDecimal(object? value)
    {
        return value switch
        {
            null => null,
            decimal number => number,
            int number => number,
            long number => number,
            double number => (decimal)number,
            float number => (decimal)number,
            _ when decimal.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => null
        };
    }

    private static string? TrimToNull(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    private static decimal Round(decimal value, int decimals) =>
        Math.Round(value, decimals, MidpointRounding.AwayFromZero);

    private static string? FormatDate(DateTime? value) =>
        value?.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

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

    private sealed class ConnectionCloser : IAsyncDisposable
    {
        private readonly DbConnection _connection;

        public ConnectionCloser(DbConnection connection)
        {
            _connection = connection;
        }

        public ValueTask DisposeAsync()
        {
            return new ValueTask(_connection.CloseAsync());
        }
    }

    private sealed class NoopAsyncDisposable : IAsyncDisposable
    {
        public static readonly NoopAsyncDisposable Instance = new();

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}

public sealed class PilotScoreboardCaptureRequest
{
    [JsonPropertyName("label")] public string? Label { get; set; }
    [JsonPropertyName("notes")] public string? Notes { get; set; }
}

public sealed record PilotScoreboardView(
    [property: JsonPropertyName("current")] IReadOnlyDictionary<string, object?> Current,
    [property: JsonPropertyName("pre_pilot_baseline")] PilotScoreboardBaselineRow? PrePilotBaseline,
    [property: JsonPropertyName("latest_quarterly")] PilotScoreboardBaselineRow? LatestQuarterly,
    [property: JsonPropertyName("comparison")] IReadOnlyDictionary<string, PilotScoreboardComparisonMetric>? Comparison,
    [property: JsonPropertyName("quarterly_review")] PilotQuarterlyReview QuarterlyReview);

public sealed record PilotScoreboardBaselineRow(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("is_pre_pilot")] bool IsPrePilot,
    [property: JsonPropertyName("baseline_period")] IReadOnlyDictionary<string, object?> BaselinePeriod,
    [property: JsonPropertyName("captured_at")] string? CapturedAt,
    [property: JsonPropertyName("metrics")] JsonElement Metrics,
    [property: JsonPropertyName("notes")] string? Notes,
    [property: JsonPropertyName("captured_by")] int? CapturedBy);

public sealed record PilotScoreboardComparisonMetric(
    [property: JsonPropertyName("baseline")] decimal? Baseline,
    [property: JsonPropertyName("current")] decimal? Current,
    [property: JsonPropertyName("delta")] decimal? Delta,
    [property: JsonPropertyName("pct_change")] decimal? PctChange);

public sealed record PilotQuarterlyReview(
    [property: JsonPropertyName("next_due_at")] string? NextDueAt,
    [property: JsonPropertyName("is_overdue")] bool IsOverdue,
    [property: JsonPropertyName("cadence_months")] int CadenceMonths);
